import { Bodies } from "./bodies.js";
import { moduleLayers } from "./hull.js";
import { DamageEffect } from "./damage.js";
import { moduleOutline } from "./modules.js";
import { abs, atan2, angleDelta, clamp, cos, length, max, min, sin, sqrt } from "./math.js";
import { pushBearing } from "./helm.js";
import { CLAW_DEPTH, CLAW_STIFFNESS } from "./collision.js";
import * as shipForage from "./shipForage.js";
import { type Ships, movable, stoppingSpeed, URGE_REFERENCE } from "./ships.js";

/**
 * Bringing a claw to what it means to grip: matching the target's turn, choosing
 * a grip with a clear way in, squaring up to it and closing.
 */

/**
 * The closing speeds a claw takes best between, m/s: quicker than a ragged
 * edge hooks, since jaws are made to close on what meets them, and short of
 * a ram. Below the band it has too little to bite with; above it, up to
 * `CLAW_SPEED_MAX`, it is more likely to glance off.
 */
export const CLAW_SPEED_LOW = 1;
export const CLAW_SPEED_HIGH = 4;
export const CLAW_SPEED_MAX = 8;

/**
 * How fast a craft flying down `stoppingSpeed(brake, gap, delay)` slows as it
 * goes, m/s², where that curve is at `speed`: what its controller has to be
 * told to expect, or it lags the curve by this times its response time.
 */
function curveDeceleration(brake: number, speed: number, delay: number): number {
    if (!(brake > 0) || !(speed > 0) || !Number.isFinite(delay)) return 0;
    return (brake * speed) / (speed + brake * delay);
}

/** The closing speed a pilot brings its claw in at, m/s: the middle of its band. */
const CLAW_APPROACH = (CLAW_SPEED_LOW + CLAW_SPEED_HIGH) / 2;

/** Seconds a claw ship keeps the face it chose to grip before looking again, while still out past the gate. */
const GRIP_RECHOOSE = 1;

/**
 * How far out from a face, in the gripping ship's radii, nothing of its source
 * may stand for the face to have room in front of it: room to come in, and
 * for what docks with it once it holds on, rather than the floor of a notch.
 */
const GRIP_CLEAR = 4;

/** The share of the braking it has that a claw ship plans its last approach on. */
const GRIP_BRAKING = 0.5;

/** How far off square to its face, radians, a claw may be and still close on it. */
const GRIP_SQUARE = 0.15;

/** How far off the line out from its grip point a claw may be and still close, as a share of the jaws' width, where its face leaves it less. */
const GRIP_LINE = 0.5;

/**
 * How many times over a ship can push itself back from an asteroid, jaws
 * first, against its pull at the surface: Infinity for one with no well.
 */
export function holdsOff(ships: Ships, bodies: Bodies, i: number, b: number, claw: number, tb: number): number {
    const pull = surfacePull(ships, bodies, tb);
    if (!(pull > 0)) return Infinity;
    const jaws = ships.designs[i]!.modules[claw]!.spec.angle ?? 0;
    const back = ships.layoutOf(i).maxThrustAlong(-cos(jaws), -sin(jaws)) / movable(bodies.mass[b]!);
    return back / pull;
}

/** How hard body `tb`'s well pulls body `b` where it is, m/s², into `partAt`: nothing for a body that rides none. */
export function wellPullOn(ships: Ships, bodies: Bodies, b: number, tb: number): void {
    ships.partAt.x = 0;
    ships.partAt.y = 0;
    const well = ships.rides[tb];
    if (well === undefined) return;
    const dx = bodies.x[tb]! - bodies.x[b]!;
    const dy = bodies.y[tb]! - bodies.y[b]!;
    const soft = well.softening ?? 0;
    const r2 = dx * dx + dy * dy + soft * soft;
    if (!(r2 > 0)) return;
    const k = well.gm / (r2 * sqrt(r2));
    ships.partAt.x = dx * k;
    ships.partAt.y = dy * k;
}

/** How hard body `tb`'s well pulls at its edge, m/s²: none for a body that rides none. */
export function surfacePull(ships: Ships, bodies: Bodies, tb: number): number {
    const well = ships.rides[tb];
    if (well === undefined) return 0;
    const r = bodies.radius[tb]!;
    const soft = well.softening ?? 0;
    const r2 = r * r + soft * soft;
    return (well.gm * r) / (r2 * sqrt(r2));
}

/**
 * Whether the claw at module `claw` of body `b` shares a layer with any
 * module of body `tb`: a thin claw cannot close on a fighter or a piece of
 * one, which flies above the deck.
 */
export function clawReaches(ships: Ships, b: number, claw: number, tb: number): boolean {
    const mine = moduleLayers(ships.hullDesign[b]!.modules[claw]!, ships.layersOf(b));
    const design = ships.hullDesign[tb];
    if (design === null || design === undefined) return false;
    const theirs = ships.layersOf(tb);
    for (const module of design.modules) if ((moduleLayers(module, theirs) & mine) !== 0) return true;
    return false;
}

/** The first claw this ship works that can still close, or -1. */
export function workingClaw(ships: Ships, i: number, b: number): number {
    const design = ships.designs[i]!;
    for (let m = 0; m < design.modules.length; m++) {
        if (design.modules[m]!.spec.kind === "claw" && ships.left(i, b, m, DamageEffect.Grip) > 0) return m;
    }
    return -1;
}

/**
 * The heading to hold closing on an asteroid: `jawsOn`, the claw towards it,
 * unless its motion is off what `grapple` asks for (`radial`, closing) by
 * more than it can put right with its jaws held on before it arrives, and
 * turning its mains along the difference, and back, would put it right
 * sooner. An asteroid in orbit, or one pulling it in, is never as still as
 * a wreck.
 */
export function matchOrbit(ships: Ships, bodies: Bodies, i: number, b: number, tb: number, jawsOn: number, radial: number): number {
    const dx = bodies.x[tb]! - bodies.x[b]!;
    const dy = bodies.y[tb]! - bodies.y[b]!;
    const range = length(dx, dy);
    if (!(range > 0)) return jawsOn;
    const ux = dx / range;
    const uy = dy / range;
    const ex = bodies.vx[tb]! + ux * radial - bodies.vx[b]!;
    const ey = bodies.vy[tb]! + uy * radial - bodies.vy[b]!;
    const error = length(ex, ey);
    if (!(error > CLAW_SPEED_HIGH - CLAW_APPROACH)) return jawsOn;
    const closing = (bodies.vx[b]! - bodies.vx[tb]!) * ux + (bodies.vy[b]! - bodies.vy[tb]!) * uy;
    const left = max(0, range - bodies.radius[tb]!) / max(closing, CLAW_APPROACH);
    const jawsTime = error / ships.accelerationAlong(bodies, i, b, ex / error, ey / error, jawsOn);
    if (jawsTime <= left) return jawsOn;
    const mains = atan2(ey, ex) - pushBearing(ships.layoutOf(i), ships.designs[i]!.thrustBearing);
    const mainsTime = 4 * ships.halfTurnTime(bodies, i, b) + error / ships.accelerationAlong(bodies, i, b, ex / error, ey / error, mains);
    return mainsTime < left && mainsTime < jawsTime ? mains : jawsOn;
}

/**
 * How fast body `b` brings claw `claw` in to touch: `CLAW_APPROACH`, unless
 * that is more than the claw's spring could stop it from in its stroke, a
 * heavy ship's claw otherwise driven home hard and torn off.
 */
export function clawArrival(ships: Ships, bodies: Bodies, b: number, claw: number): number {
    const spec = ships.hullDesign[b]!.modules[claw]!.spec;
    const reach = CLAW_DEPTH * spec.length;
    const mass = bodies.mass[b]!;
    // Its spring's work over the stroke, half k·w·reach², as the hull's speed.
    const most = mass > 0 ? reach * sqrt((CLAW_STIFFNESS * spec.width) / mass) : CLAW_APPROACH;
    return min(CLAW_APPROACH, most);
}

/** Where the jaws of claw `claw` of ship `i` reach to, in its body frame about its centre of mass, into `partAt`. */
export function jawsTip(ships: Ships, i: number, claw: number): void {
    const module = ships.designs[i]!.modules[claw]!;
    const turned = module.spec.angle ?? 0;
    ships.partAt.x = module.x + (cos(turned) * module.spec.length) / 2;
    ships.partAt.y = module.y + (sin(turned) * module.spec.length) / 2;
}

/**
 * Choose, or keep, where ship `i`'s claw will take hold of body `tb`: a
 * point on an outside face of its hull facing the claw, the one whose gate,
 * out along its normal, is nearest the jaws, of those wide enough for the
 * jaws and with room in front of them for the ship to come straight in, if
 * any are, or else of those wide enough, or with room. Kept in `tb`'s frame so it turns with the hull, and kept
 * once the jaws are inside the gate, unless the hull changes or the module
 * is spent; looked at again every `GRIP_RECHOOSE` before that. False with
 * no outside face facing the claw, for it to close on the middle instead.
 */
export function chooseGrip(
    ships: Ships,
    bodies: Bodies,
    i: number,
    b: number,
    tb: number,
    source: number,
    claw: number,
    dt: number,
): boolean {
    const hull = ships.hullDesign[tb];
    if (hull === null || hull === undefined) return false;
    const angle = bodies.angle[tb]!;
    const c = cos(angle);
    const s = sin(angle);
    // The jaws in the target's frame.
    jawsTip(ships, i, claw);
    const reach = length(ships.partAt.x, ships.partAt.y);
    const shipAngle = bodies.angle[b]!;
    const wx = bodies.x[b]! + ships.partAt.x * cos(shipAngle) - ships.partAt.y * sin(shipAngle) - bodies.x[tb]!;
    const wy = bodies.y[b]! + ships.partAt.x * sin(shipAngle) + ships.partAt.y * cos(shipAngle) - bodies.y[tb]!;
    const qx = wx * c + wy * s;
    const qy = wy * c - wx * s;
    const gate = bodies.radius[b]!;
    const kept =
        ships.gripBody[i] === tb &&
        ships.gripHull[i] === hull &&
        ships.gripModule[i]! >= 0 &&
        !ships.damage.spent(tb, ships.gripModule[i]!);
    if (kept) {
        const out = (qx - ships.gripX[i]!) * ships.gripNx[i]! + (qy - ships.gripY[i]!) * ships.gripNy[i]!;
        if (out < 2 * gate || (ships.now - ships.gripAt[i]!) * dt < GRIP_RECHOOSE) return true;
    }

    const outlines = ships.gripOutlines;
    const starts = ships.gripStarts;
    const corners = ships.faceCorners;
    outlines.length = 0;
    starts.length = 0;
    for (let m = 0; m < hull.modules.length; m++) {
        starts.push(outlines.length);
        if (ships.damage.spent(tb, m)) continue;
        const count = moduleOutline(hull.modules[m]!.spec, corners);
        for (let v = 0; v < count * 2; v += 2) outlines.push(corners[v]! - hull.centreOfMassX, corners[v + 1]! - hull.centreOfMassY);
    }
    starts.push(outlines.length);
    gatherObstacles(ships, bodies, i, b, tb, source, c, s);
    const width = ships.designs[i]!.modules[claw]!.spec.width;
    let best = Infinity;
    // How good the best face so far is, before how near: wide enough for the jaws counts for more than room in front of it.
    let bestTier = -1;
    for (let m = 0; m < hull.modules.length; m++) {
        // Only the source's own: a friend anchored to the same rock stands in the way, and is no face to grip.
        if (ships.pilotAt(tb, m) !== source) continue;
        const from = starts[m]!;
        const n = (starts[m + 1]! - from) / 2;
        for (let e = 0; e < n; e++) {
            const ax = outlines[from + e * 2]!;
            const ay = outlines[from + e * 2 + 1]!;
            const bx = outlines[from + ((e + 1) % n) * 2]!;
            const by = outlines[from + ((e + 1) % n) * 2 + 1]!;
            const span = length(bx - ax, by - ay);
            if (!(span > 0)) continue;
            const tx = (bx - ax) / span;
            const ty = (by - ay) / span;
            // Outward, the outline being anticlockwise.
            const nx = ty;
            const ny = -tx;
            // Facing the jaws.
            if ((qx - ax) * nx + (qy - ay) * ny <= 0) continue;
            // Where the jaws are square across from, but the middle of a face only a few jaws wide.
            const margin = min(width, span) / 2;
            const slides = span >= 4 * width;
            const alongs = ships.gripAlongs;
            alongs.length = 0;
            alongs.push(slides ? clamp((qx - ax) * tx + (qy - ay) * ty, margin, span - margin) : span / 2);
            // Along a long face, also either side of what lies about it, just clear of it on the way in.
            for (let k = 0; slides && k < ships.gripObstacles.length; k += 3) {
                const ox = ships.gripObstacles[k]! - ax;
                const oy = ships.gripObstacles[k + 1]! - ay;
                const keep = ships.gripObstacles[k + 2]!;
                const on = ox * nx + oy * ny;
                const beyond = on - clamp(on, reach, reach + GRIP_CLEAR * gate);
                if (!(abs(beyond) < keep)) continue;
                const aside = sqrt(keep * keep - beyond * beyond) + 0.5;
                const oa = ox * tx + oy * ty;
                alongs.push(clamp(oa - aside, margin, span - margin), clamp(oa + aside, margin, span - margin));
            }
            for (let k = 0; k < alongs.length; k++) {
                const along = alongs[k]!;
                const px = ax + tx * along;
                const py = ay + ty * along;
                // Outside: no other module just beyond it.
                if (insideAnyOutline(ships, m, px + nx * 0.01, py + ny * 0.01)) continue;
                const cost = length(px + nx * gate - qx, py + ny * gate - qy);
                const fits = span >= width ? 2 : 0;
                // Not worth asking about room in front of one that could not win with it.
                if (fits + 1 < bestTier || (fits + 1 === bestTier && !(cost < best))) continue;
                // Room in front of it, as wide as the ship, to come straight in, and nothing on the way it would shy from.
                const room =
                    corridorClear(ships, px, py, nx, ny, gate, GRIP_CLEAR * gate) &&
                    wayInClear(ships, px, py, nx, ny, reach, GRIP_CLEAR * gate);
                const tier = fits + (room ? 1 : 0);
                if (tier < bestTier || (tier === bestTier && !(cost < best))) continue;
                bestTier = tier;
                best = cost;
                ships.gripModule[i] = m;
                ships.gripX[i] = px;
                ships.gripY[i] = py;
                ships.gripNx[i] = nx;
                ships.gripNy[i] = ny;
                ships.gripSlack[i] = max(0, min(along, span - along) - width / 2);
            }
        }
    }
    if (best === Infinity) {
        ships.gripBody[i] = -1;
        return false;
    }
    ships.gripBody[i] = tb;
    ships.gripHull[i] = hull;
    ships.gripAt[i] = ships.now;
    return true;
}

/**
 * Whether the strip in front of a face at `px`, `py` with outward normal
 * `nx`, `ny`, `half` either side of it and `depth` out, misses every
 * module of `gripOutlines`: room for a ship to come straight in to it.
 */
export function corridorClear(ships: Ships, px: number, py: number, nx: number, ny: number, half: number, depth: number): boolean {
    const outlines = ships.gripOutlines;
    const starts = ships.gripStarts;
    // From just off the face, so the module the face is on does not count.
    const lo = 0.05;
    for (let m = 0; m + 1 < starts.length; m++) {
        const from = starts[m]!;
        const n = (starts[m + 1]! - from) / 2;
        if (n < 3) continue;
        // Apart along the strip's own axes?
        let minOut = Infinity;
        let maxOut = -Infinity;
        let minSide = Infinity;
        let maxSide = -Infinity;
        for (let v = 0; v < n; v++) {
            const dx = outlines[from + v * 2]! - px;
            const dy = outlines[from + v * 2 + 1]! - py;
            const out = dx * nx + dy * ny;
            const side = dy * nx - dx * ny;
            minOut = min(minOut, out);
            maxOut = max(maxOut, out);
            minSide = min(minSide, side);
            maxSide = max(maxSide, side);
        }
        if (maxOut <= lo || minOut >= depth || maxSide <= -half || minSide >= half) continue;
        // Apart along one of the module's edge normals?
        let apart = false;
        for (let e = 0; e < n && !apart; e++) {
            const ax = outlines[from + e * 2]!;
            const ay = outlines[from + e * 2 + 1]!;
            const ex = outlines[from + ((e + 1) % n) * 2]! - ax;
            const ey = outlines[from + ((e + 1) % n) * 2 + 1]! - ay;
            // Outward, (ey, -ex): the strip apart if every corner of it lies beyond the edge.
            let nearest = Infinity;
            for (let k = 0; k < 4; k++) {
                const o = k < 2 ? lo : depth;
                const sd = k % 2 === 0 ? -half : half;
                const cx = px + nx * o - ny * sd - ax;
                const cy = py + ny * o + nx * sd - ay;
                nearest = min(nearest, cx * ey - cy * ex);
            }
            if (nearest >= 0) apart = true;
        }
        if (!apart) return false;
    }
    return true;
}

/**
 * Into `gripObstacles`, everything ship `i` closing on body `tb` would keep
 * clear of on the way in, as `avoid` does when it grapples: hulks, and a
 * friend moored to the same source. In `tb`'s frame, turned by `c`, `s`.
 */
export function gatherObstacles(
    ships: Ships,
    bodies: Bodies,
    i: number,
    b: number,
    tb: number,
    source: number,
    c: number,
    s: number,
): void {
    const out = ships.gripObstacles;
    out.length = 0;
    const approach = ships.doctrines[i]!.approach;
    if (!(approach.separation > 0) || !(approach.separationRadii > 0)) return;
    const mine = ships.designs[i]!.radius;
    for (let t = 0; t < ships.alive.length; t++) {
        if (t === i || t === source || ships.alive[t] === 0 || ships.home[t] === i) continue;
        const neighbour = ships.hasControl(t) && shipForage.isMoored(ships, t) && ships.parkedOn[t] === source;
        if (ships.hasControl(t) && !neighbour) continue;
        const ob = bodies.indexOf(ships.bodyIds[t]!);
        if (ob < 0 || ob === b || ob === tb || bodies.ghost[ob] === 1 || !ships.meets(b, ob)) continue;
        const touching = mine + ships.designs[t]!.radius;
        const keep = touching + (neighbour ? mine : touching * approach.separationRadii);
        const dx = bodies.x[ob]! - bodies.x[tb]!;
        const dy = bodies.y[ob]! - bodies.y[tb]!;
        if (length(dx, dy) > bodies.radius[tb]! + keep + GRIP_CLEAR * bodies.radius[b]!) continue;
        out.push(dx * c + dy * s, dy * c - dx * s, keep);
    }
}

/**
 * Whether a ship whose jaws reach `reach` ahead of its middle, coming
 * straight in to a face at `px`, `py` with outward normal `nx`, `ny` from
 * `depth` out, keeps clear of everything in `gripObstacles` all the way.
 */
export function wayInClear(ships: Ships, px: number, py: number, nx: number, ny: number, reach: number, depth: number): boolean {
    const obstacles = ships.gripObstacles;
    for (let k = 0; k < obstacles.length; k += 3) {
        const dx = obstacles[k]! - px;
        const dy = obstacles[k + 1]! - py;
        const out = dx * nx + dy * ny;
        const side = dy * nx - dx * ny;
        const along = out - clamp(out, reach, reach + depth);
        if (along * along + side * side < obstacles[k + 2]! * obstacles[k + 2]!) return false;
    }
    return true;
}

/** Whether a point in a hull's frame lies inside any module of `gripOutlines` but `skip`. */
export function insideAnyOutline(ships: Ships, skip: number, x: number, y: number): boolean {
    const outlines = ships.gripOutlines;
    const starts = ships.gripStarts;
    for (let m = 0; m + 1 < starts.length; m++) {
        if (m === skip) continue;
        const from = starts[m]!;
        const n = (starts[m + 1]! - from) / 2;
        if (n < 3) continue;
        let inside = true;
        for (let e = 0; e < n && inside; e++) {
            const ax = outlines[from + e * 2]!;
            const ay = outlines[from + e * 2 + 1]!;
            const bx = outlines[from + ((e + 1) % n) * 2]!;
            const by = outlines[from + ((e + 1) % n) * 2 + 1]!;
            if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) <= 0) inside = false;
        }
        if (inside) return true;
    }
    return false;
}

/**
 * Bring claw `claw` in square to the face `chooseGrip` chose: make for its
 * gate, a ship's radius out along its normal, down a stopping curve, the
 * jaws on the source's middle until it is near and then turned on to the
 * face; and there, once the jaws are on that
 * line and square to the face, straight in, down a stopping curve as
 * `grapple`'s, onto the face. All moving as that point of the hull does,
 * turning with it included, and held against its well's pull. Sets
 * `gripHeading`, and returns the speed it closes at, negative backing off.
 */
export function squareUp(ships: Ships, bodies: Bodies, i: number, b: number, tb: number, claw: number, standOff: boolean): number {
    const angle = bodies.angle[tb]!;
    const c = cos(angle);
    const s = sin(angle);
    const gx = ships.gripX[i]!;
    const gy = ships.gripY[i]!;
    const px = bodies.x[tb]! + gx * c - gy * s;
    const py = bodies.y[tb]! + gx * s + gy * c;
    const nx = ships.gripNx[i]! * c - ships.gripNy[i]! * s;
    const ny = ships.gripNx[i]! * s + ships.gripNy[i]! * c;

    const module = ships.designs[i]!.modules[claw]!;
    const jaws = module.spec.angle ?? 0;
    ships.gripHeading = atan2(-ny, -nx) - jaws;
    jawsTip(ships, i, claw);
    const shipAngle = bodies.angle[b]!;
    const tipX = bodies.x[b]! + ships.partAt.x * cos(shipAngle) - ships.partAt.y * sin(shipAngle);
    const tipY = bodies.y[b]! + ships.partAt.x * sin(shipAngle) + ships.partAt.y * cos(shipAngle);
    const out = (tipX - px) * nx + (tipY - py) * ny;
    const across = (tipX - px) * -ny + (tipY - py) * nx;

    const approach = ships.doctrines[i]!.approach;
    const gate = bodies.radius[b]!;
    // The gate, and how it moves with the hull.
    const gateX = px + nx * gate;
    const gateY = py + ny * gate;
    const spin = bodies.angularVel[tb]!;
    const vx = bodies.vx[tb]! - spin * (gateY - bodies.y[tb]!);
    const vy = bodies.vy[tb]! + spin * (gateX - bodies.x[tb]!);
    const pull = surfacePull(ships, bodies, tb);
    let wantX = 0;
    let wantY = 0;
    let closing = 0;
    let slowing = 0;
    // Once closing, it keeps on with twice the room it was let start with, so a wobble does not send it back.
    const loose = ships.gripClosing[i] === 1 ? 2 : 1;
    const lined =
        out <= 1.5 * gate &&
        abs(across) <= loose * max(GRIP_LINE * module.spec.width, ships.gripSlack[i]!) &&
        abs(angleDelta(shipAngle, ships.gripHeading)) <= loose * GRIP_SQUARE;
    // Turned off the way in, it looks again: what turned it may be in the way.
    if (ships.gripClosing[i] === 1 && !lined && !standOff) ships.gripBody[i] = -1;
    ships.gripClosing[i] = lined && !standOff ? 1 : 0;
    if (standOff) {
        closing = -CLAW_APPROACH;
        wantX = nx * CLAW_APPROACH;
        wantY = ny * CLAW_APPROACH;
    } else if (lined) {
        // Straight in, the jaws held on the line, planned on half the braking it
        // has less the well's pull: flying lags what it asks for, and a claw
        // driven home too fast is torn off.
        const retro = ships.accelerationAlong(bodies, i, b, nx, ny, ships.gripHeading);
        const braking = GRIP_BRAKING * max(approach.brake * retro - pull, 0.1 * approach.brake * retro);
        const stopping = stoppingSpeed(braking, max(0, out), approach.responseTime);
        const arrive = clawArrival(ships, bodies, b, claw);
        closing = min(approach.clawSpeed, sqrt(stopping * stopping + arrive * arrive));
        const sideways = clamp(-across / max(approach.responseTime, 1e-3), -arrive, arrive);
        // Out to the gate's line, then in: relative to the gate point, out by how far in it is.
        wantX = -nx * closing - ny * sideways;
        wantY = -ny * closing + nx * sideways;
        // Slowing down the curve as it goes, told so, or it runs fast by that slowing times its response time.
        if (closing < approach.clawSpeed) slowing = curveDeceleration(braking, stopping, approach.responseTime);
    } else {
        // To the gate, slowing as it gets there.
        const dx = gateX - tipX;
        const dy = gateY - tipY;
        const span = length(dx, dy);
        if (span > 0) {
            const ux = dx / span;
            const uy = dy / span;
            // Well short of it, the jaws on its middle as any claw ship closing on
            // a source holds them, so its mains carry it there.
            if (span > 2 * gate) ships.gripHeading = atan2(bodies.y[tb]! - bodies.y[b]!, bodies.x[tb]! - bodies.x[b]!) - jaws;
            const retro = ships.accelerationAlong(bodies, i, b, -ux, -uy, ships.gripHeading);
            const braking = GRIP_BRAKING * max(approach.brake * retro - pull, 0.1 * approach.brake * retro);
            const stopping = stoppingSpeed(braking, span, approach.responseTime);
            const arrive = clawArrival(ships, bodies, b, claw);
            const speed = min(approach.clawSpeed, sqrt(stopping * stopping + arrive * arrive), span / max(approach.responseTime, 1e-3));
            wantX = ux * speed;
            wantY = uy * speed;
            closing = -(wantX * nx + wantY * ny);
        }
    }
    // Held against the source's pull rather than lagging behind it.
    wellPullOn(ships, bodies, b, tb);
    ships.urge(URGE_REFERENCE, vx + wantX, vy + wantY, nx * slowing - ships.partAt.x, ny * slowing - ships.partAt.y);
    return closing;
}

/**
 * Close on a source jaws first: down a stopping curve onto its edge that
 * stops not at nothing but at `clawArrival`, so the claw arrives inside
 * its band. `facing` is the heading it holds to point the claw. `standOff`
 * backs it away instead, for another run at it.
 */
export function grapple(
    ships: Ships,
    bodies: Bodies,
    i: number,
    b: number,
    tb: number,
    claw: number,
    facing: number,
    standOff: boolean,
): number {
    const dx = bodies.x[tb]! - bodies.x[b]!;
    const dy = bodies.y[tb]! - bodies.y[b]!;
    const range = length(dx, dy);
    let vx = bodies.vx[tb]!;
    let vy = bodies.vy[tb]!;
    let radial = 0;
    let slowing = 0;
    let ax = 0;
    let ay = 0;
    if (range > 0) {
        const ux = dx / range;
        const uy = dy / range;
        const design = ships.designs[i]!;
        const module = design.modules[claw]!;
        const turned = module.spec.angle ?? 0;
        // How far ahead of the centre of mass its jaws reach.
        const jaws = module.x * cos(turned) + module.y * sin(turned) + module.spec.length / 2;
        const gap = max(0, range - bodies.radius[tb]! - jaws);
        const approach = ships.doctrines[i]!.approach;
        // Planned on what it really has astern with its jaws held on, with no
        // floor: a claw has to arrive slowly, so a craft that cannot brake
        // facing its source comes in no faster than it can stop.
        const retro = ships.accelerationAlong(bodies, i, b, -ux, -uy, facing);
        const braking = max(approach.brake * retro - surfacePull(ships, bodies, tb), 0.1 * approach.brake * retro);
        const stopping = stoppingSpeed(braking, gap, approach.responseTime);
        const arrive = clawArrival(ships, bodies, b, claw);
        radial = standOff ? -CLAW_APPROACH : min(approach.clawSpeed, sqrt(stopping * stopping + arrive * arrive));
        vx += ux * radial;
        vy += uy * radial;
        if (!standOff && radial < approach.clawSpeed) slowing = curveDeceleration(braking, stopping, approach.responseTime);
        ax = -ux * slowing;
        ay = -uy * slowing;
    }
    ships.urge(URGE_REFERENCE, vx, vy, ax, ay);
    return radial;
}
