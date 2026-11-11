import { Bodies } from "./bodies.js";
import { footprintOf, approachTurn, originOf, type ShipDesign } from "./blueprint.js";
import { WEAPONS_LAYER } from "./hull.js";
import { DamageEffect } from "./damage.js";

import { abs, atan2, angleDelta, PI, cos, length, max, min, sin, sqrt } from "./math.js";
import { padApproaches, type PadApproach } from "./padApproach.js";
import type { World } from "./world.js";
import { DOCK_POWER_PER_METRE } from "./modules.js";
import * as shipRebuild from "./shipRebuild.js";
import * as shipSupply from "./shipSupply.js";
import * as shipBreakup from "./shipBreakup.js";
import * as shipForage from "./shipForage.js";
import { type Ships, NO_TARGET, movable, STEER, type Spot } from "./ships.js";

/** The corner a fighter coming in to land makes for, when it has one. */
const ROUTE: Spot = { x: 0, y: 0, vx: 0, vy: 0, radius: 0 };
import * as shipBuild from "./shipBuild.js";
import * as shipFlight from "./shipFlight.js";
import * as shipRoute from "./shipRoute.js";
import { HELD_LOWEST } from "./padField.js";
import * as shipDecide from "./shipDecide.js";
import { WELD_SETTLE } from "./shipWeld.js";
import { URGE_REFERENCE, stoppingSpeed } from "./shipFlight.js";

/**
 * Coming aboard another hull: landing on a carrier's pad and parking there,
 * docking port to port, and finding a way in round the carrier's hull.
 */

/** How fast a pilot brings its fighter in over a pad, m/s, for the pad's field to take hold of (`padField`). */
export const PAD_ARRIVAL_SPEED = 1;

/** The most a fighter the pad's field holds may be moving against the pad and still land on it, m/s: at rest on it. */
export const PAD_SPEED = 0.25;

/** The fastest a fighter the pad's field holds may be turning against the pad and still land on it, rad/s. */
export const PAD_SPIN = 0.1;

/** The most two ports may be closing at and still mate, m/s: a nudge, not a bump. */
export const PORT_SPEED = 1;

/** The speed a pilot closes the last stretch onto a port at, m/s. */
const PORT_APPROACH = 0.5;

/** How far off a port, in its own radii, a pilot lines up before closing in. */
const PORT_STANDOFF_RADII = 1;

/** How far off its heading, radians, a pilot may be and still close the last stretch. */
const PORT_HEADING_SLACK = 0.1;

/**
 * How far out a fighter making for a pad lines itself up with it, in its own
 * radii. Further off it points where it is going.
 */
const PAD_ALIGN_RADII = 4;

/**
 * The share of its doctrine's braking a craft plans on coming in to a pad or a
 * port. A doctrine's `brake` is for holding a range band, where stopping a little
 * long costs nothing; here it has to stop on a spot, so it leaves itself room.
 */
const PLACING_BRAKE = 0.5;

/** How far round its carrier, radians, a fighter steers at a time while it circles to a pad's way in. */
const HULL_ORBIT_STEP = 0.5;

/**
 * How much shorter a trip round a carrier, radians, another way in to a pad
 * has to be before a fighter gives up the one it is taking, so one coming in
 * dead astern does not swing between the two corners either side.
 */
const WAY_STICK = 0.3;

/** Whether module `pad` of ship `t` is a pad still working, with nothing on it. */
export function padFree(ships: Ships, bodies: Bodies, t: number, pad: number): boolean {
    const design = ships.designs[t]!;
    if (design.modules[pad]?.spec.kind !== "pad") return false;
    const tb = bodies.indexOf(ships.bodyIds[t]!);
    if (tb < 0 || !(ships.left(t, tb, pad, DamageEffect.Grip) > 0)) return false;
    // Only a pad of its launch design is one a fighter can be parked on.
    const l = shipRebuild.rebuildFor(ships, t, design).at.indexOf(pad);
    if (l < 0) return false;
    for (let k = 0; k < ships.parkedShips.length; k++) {
        const f = ships.parkedShips[k]!;
        if (ships.parkedOn[f] === t && ships.parkedPad[f] === l) return false;
    }
    return true;
}

/**
 * The best friend's pad to land on of those it fits, by the fuel, metal and
 * charge its ship can spare for the time it would take to get there and be
 * filled, put off by armed enemies near it by its `dockDanger`, and by every
 * other fighter already making for it. None for one that has lost the turn it set out with.
 */
export function pickPad(
    ships: Ships,
    bodies: Bodies,
    i: number,
    b: number,
    room: number,
    metalRoom: number,
    chargeRoom: number,
    hurt: boolean,
    only = NO_TARGET,
): void {
    const approach = ships.doctrines[i]!.approach;
    ships.salvaging[i] = NO_TARGET;
    ships.landingPad[i] = -1;
    ships.dockPort[i] = -1;
    if (!(approach.approachSpeed > 0)) return;
    // One that has lost all its turn cannot bring its mains round to steer in, and would
    // hang by its carrier for good; one still being built has yet to get it. One that
    // can turn one way spins in (`spinWay`).
    const set = (ships.launched[i] ?? ships.designs[i]!).engineLayout;
    const now = ships.layoutOf(i);
    if (ships.unfinished[i] !== 1 && (set.maxTorque(1) > 0 || set.maxTorque(-1) > 0) && !(now.maxTorque(1) > 0 || now.maxTorque(-1) > 0))
        return;
    const box = footprintOf(ships.designs[i]!);
    let bestScore = 0;
    for (let t = 0; t < ships.alive.length; t++) {
        if (t === i || ships.alive[t] === 0 || ships.derelict[t] === 1 || (only !== NO_TARGET && t !== only)) continue;
        if (ships.team[t] !== ships.team[i] || ships.hostile(i, t)) continue;
        const tb = bodies.indexOf(ships.bodyIds[t]!);
        if (tb < 0 || tb === b) continue;
        const design = ships.designs[t]!;
        // Sent to it, it goes whatever is near.
        let danger = only !== NO_TARGET ? 0 : -1;
        for (let pad = 0; pad < design.modules.length; pad++) {
            const spec = design.modules[pad]!.spec;
            if (spec.kind !== "pad" || !padFree(ships, bodies, t, pad) || !shipDecide.fitsPad(box, spec)) continue;
            const spare = ships.fuel.pieceHeld(tb, pad) - shipSupply.fuelReserve(ships, tb, pad);
            const spareMetal = ships.metal.pieceHeld(tb, pad) - shipSupply.metalReserve(ships, tb, pad);
            const pump = design.modules[pad]!.stats.pumpRate;
            const fuelTake = max(0, min(spare, room));
            const metalTake = max(0, min(spareMetal, metalRoom));
            const take = fuelTake + metalTake;
            const spareCharge = ships.power.pieceHeld(tb, pad) - shipSupply.chargeReserve(ships, tb, pad);
            const chargeTake = max(0, min(spareCharge, chargeRoom));
            const cable = DOCK_POWER_PER_METRE * spec.width;
            // Mending is paid for in charge and metal, reserves and all.
            const mends = hurt && ships.power.pieceHeld(tb, pad) > 0 && ships.metal.pieceHeld(tb, pad) > 0;
            if (!(take > 0 || chargeTake > 0 || mends) || !(pump > 0)) continue;
            // To the pad, not the carrier's middle: one waiting at a pad would otherwise
            // take the far one as soon as it is free, and cross whoever is coming the other way.
            const place = modulePlace(bodies, tb, design, pad);
            const gap = length(place.x - bodies.x[b]!, place.y - bodies.y[b]!);
            if (danger < 0) danger = approach.dockDanger > 0 ? shipForage.dangerNear(ships, bodies, i, tb) : 0;
            // A pad another fighter is already making for is a wait behind it.
            let queue = 0;
            for (let o = 0; o < ships.alive.length; o++) {
                if (o !== i && ships.alive[o] === 1 && ships.salvaging[o] === t && ships.landingPad[o] === pad) queue++;
            }
            // Fuel and metal come aboard together, each at the pad's rate. For
            // charge alone, the pad that has it soonest.
            const time = gap / approach.approachSpeed + max(fuelTake / pump, metalTake / pump, chargeTake / cable);
            const score = (take > 0 ? take : 1) / time / (1 + max(0, approach.dockDanger) * danger) / (1 + queue);
            if (score > bestScore) {
                bestScore = score;
                ships.salvaging[i] = t;
                ships.landingPad[i] = pad;
            }
        }
    }
}

/**
 * Park fighter `f` on pad `pad` of ship `c` where it lies: from now on it
 * is pinned there and weighs on the carrier, the two moving off together
 * with the momentum they had between them. False, changing nothing, for a
 * pad that is no pad of the carrier's launch design.
 */
export function park(ships: Ships, bodies: Bodies, c: number, f: number, pad: number): boolean {
    const design = ships.designs[c]!;
    const l = shipRebuild.rebuildFor(ships, c, design).at.indexOf(pad);
    const cb = bodies.indexOf(ships.bodyIds[c]!);
    const fb = bodies.indexOf(ships.bodyIds[f]!);
    if (l < 0 || cb < 0 || fb < 0) return false;
    const module = design.modules[pad]!;
    const angle = bodies.angle[cb]!;
    const c0 = cos(angle);
    const s0 = sin(angle);
    const facing = angle + (module.spec.angle ?? 0);
    const pc = cos(facing);
    const ps = sin(facing);
    // Its blueprint's origin rather than its middle, which moves as it is built.
    const own = ships.designs[f]!;
    const fc = cos(bodies.angle[fb]!);
    const fs = sin(bodies.angle[fb]!);
    const ox = bodies.x[fb]! - (own.centreOfMassX * fc - own.centreOfMassY * fs);
    const oy = bodies.y[fb]! - (own.centreOfMassX * fs + own.centreOfMassY * fc);
    const dx = ox - (bodies.x[cb]! + module.x * c0 - module.y * s0);
    const dy = oy - (bodies.y[cb]! + module.x * s0 + module.y * c0);
    ships.parkedX[f] = dx * pc + dy * ps;
    ships.parkedY[f] = -dx * ps + dy * pc;
    ships.parkedAngle[f] = bodies.angle[fb]! - facing;

    // About the carrier's middle, which stays put: what each brought. A
    // carrier on a pinned body takes none of it, as nothing moves it.
    const mc = bodies.mass[cb]!;
    const mf = bodies.mass[fb]!;
    const vx = (mc * bodies.vx[cb]! + mf * bodies.vx[fb]!) / (mc + mf);
    const vy = (mc * bodies.vy[cb]! + mf * bodies.vy[fb]!) / (mc + mf);
    const rx = bodies.x[fb]! - bodies.x[cb]!;
    const ry = bodies.y[fb]! - bodies.y[cb]!;
    const spin =
        bodies.inertia[cb]! * bodies.angularVel[cb]! +
        bodies.inertia[fb]! * bodies.angularVel[fb]! +
        mf * (rx * (bodies.vy[fb]! - vy) - ry * (bodies.vx[fb]! - vx));
    const moves = mc > 0;
    if (moves) {
        bodies.vx[cb] = vx;
        bodies.vy[cb] = vy;
    }

    ships.parkedOn[f] = c;
    ships.parkedPad[f] = l;
    ships.parkedShips.push(f);
    shipBreakup.settleMass(ships, bodies, cb);
    if (moves) bodies.angularVel[cb] = spin / bodies.inertia[cb]!;
    pin(ships, bodies, f);
    return true;
}

/**
 * Let fighter `f` off its pad, moving as the pad was: the carrier no longer
 * carries its weight, nor the momentum it had going round with it.
 */
export function unpark(ships: Ships, bodies: Bodies, f: number, tick: number): void {
    const k = ships.parkedShips.indexOf(f);
    if (k < 0) return;
    const cb = ships.carrierBodyOf(bodies, f);
    const fb = bodies.indexOf(ships.bodyIds[f]!);
    ships.parkedShips.splice(k, 1);
    ships.parkedOn[f] = -1;
    ships.parkedPad[f] = -1;
    ships.mooredClaw[f] = -1;
    ships.partedAt[f] = tick;
    if (cb < 0) return;
    shipBreakup.settleMass(ships, bodies, cb);
    if (fb < 0) return;
    // Counted at the carrier's middle while parked, it was going round it as well.
    const share = bodies.mass[fb]! / movable(bodies.mass[cb]!);
    bodies.vx[cb] = bodies.vx[cb]! - share * (bodies.vx[fb]! - bodies.vx[cb]!);
    bodies.vy[cb] = bodies.vy[cb]! - share * (bodies.vy[fb]! - bodies.vy[cb]!);
}

/** Put parked fighter `f` where it sits on its pad, moving with it. Nothing, while its pad is gone. */
export function pin(ships: Ships, bodies: Bodies, f: number): void {
    if (ships.mooredClaw[f]! >= 0) {
        shipForage.pinMoored(ships, bodies, f);
        return;
    }
    const fb = bodies.indexOf(ships.bodyIds[f]!);
    const pad = ships.parkedPadOf(bodies, f);
    if (fb < 0 || pad < 0) return;
    const cb = ships.carrierBodyOf(bodies, f);
    const module = ships.designs[ships.parkedOn[f]!]!.modules[pad]!;
    const angle = bodies.angle[cb]!;
    const c = cos(angle);
    const s = sin(angle);
    const facing = angle + (module.spec.angle ?? 0);
    const pc = cos(facing);
    const ps = sin(facing);
    const own = ships.designs[f]!;
    const heading = facing + ships.parkedAngle[f]!;
    const fc = cos(heading);
    const fs = sin(heading);
    const lx = ships.parkedX[f]!;
    const ly = ships.parkedY[f]!;
    const rx = module.x * c - module.y * s + lx * pc - ly * ps + own.centreOfMassX * fc - own.centreOfMassY * fs;
    const ry = module.x * s + module.y * c + lx * ps + ly * pc + own.centreOfMassX * fs + own.centreOfMassY * fc;
    const spin = bodies.angularVel[cb]!;
    bodies.x[fb] = bodies.x[cb]! + rx;
    bodies.y[fb] = bodies.y[cb]! + ry;
    bodies.angle[fb] = heading;
    bodies.vx[fb] = bodies.vx[cb]! - spin * ry;
    bodies.vy[fb] = bodies.vy[cb]! + spin * rx;
    bodies.angularVel[fb] = spin;
    // Its weight changes as it is filled, mended and shot at.
    if (bodies.mass[fb] !== ships.parkedMass[f]) shipBreakup.settleMass(ships, bodies, cb);
}

/**
 * Where module `m` of body `tb` is and how it is moving, world frame, and
 * which way it faces.
 */
export function modulePlace(
    bodies: Bodies,
    tb: number,
    design: ShipDesign,
    m: number,
): { x: number; y: number; vx: number; vy: number; angle: number } {
    const module = design.modules[m]!;
    const angle = bodies.angle[tb]!;
    const c = cos(angle);
    const s = sin(angle);
    const rx = module.x * c - module.y * s;
    const ry = module.x * s + module.y * c;
    const spin = bodies.angularVel[tb]!;
    return {
        x: bodies.x[tb]! + rx,
        y: bodies.y[tb]! + ry,
        vx: bodies.vx[tb]! - spin * ry,
        vy: bodies.vy[tb]! + spin * rx,
        angle: angle + (module.spec.angle ?? 0),
    };
}

/**
 * Fly onto a pad: down a stopping curve onto its middle, matching how it is
 * moving. Like a ram it points its mains along the change of velocity it
 * still needs, and plans to brake on them with a half turn allowed for,
 * since a fighter mostly pushes one way. Once near and nearly matched it
 * lines up with the pad, unless it would fit inside it at any heading.
 * Returns the heading to hold.
 */
export function landOn(ships: Ships, dt: number, bodies: Bodies, i: number, b: number, tb: number, pad: number): number {
    const host = ships.designOf(tb);
    if (host === null || host.modules[pad] === undefined) return bodies.angle[b]!;
    const design = ships.designs[i]!;
    const approach = ships.doctrines[i]!.approach;
    const place = modulePlace(bodies, tb, host, pad);
    // Matching how the pad is speeding up as well as how it is moving, as if it keeps on.
    shipFlight.dockingAccel(ships, i, place.vx, place.vy, dt);
    const ax = ships.dockAx[i]!;
    const ay = ships.dockAy[i]!;
    const mine = bodies.radius[b]!;
    // Its outline, not its centre of mass, centred on the pad: a fighter whose
    // mass is towards one end only fits a pad just long enough lying there.
    const box = footprintOf(design);
    const ox = (box.minX + box.maxX) / 2;
    const oy = (box.minY + box.maxY) / 2;
    const heading = bodies.angle[b]!;
    const px = place.x - (ox * cos(heading) - oy * sin(heading));
    const py = place.y - (ox * sin(heading) + oy * cos(heading));
    const range = length(px - bodies.x[b]!, py - bodies.y[b]!);
    // Come in by one of the pad's ways in, from where it leaves the hull's
    // circle, by a corner round what stands up from the deck on the way there (`shipRoute`).
    wayIn(ships, bodies, i, b, tb, host, pad, place.x, place.y);
    const nx = cos(ships.wayAngle);
    const ny = sin(ships.wayAngle);
    const rx = bodies.x[b]! - px;
    const ry = bodies.y[b]! - py;
    const ahead = rx * nx + ry * ny;
    // Near enough to ease in on the pad, from whichever side.
    const near = range <= PAD_ALIGN_RADII * mine;
    // Nothing in its layer between it and the pad: asked from afar as well as over the hull, so one
    // heading in across it starts round in time.
    const clear = !crossesCarrier(ships, bodies, b, tb, bodies.x[b]!, bodies.y[b]!, -rx, -ry);
    // Lined up on its way in, or near the pad from any side: either way it goes straight in rather
    // than back out to the way in, throwing away how near it has come.
    const lined = clear && ((ahead > 0 && abs(ry * nx - rx * ny) <= ahead) || range <= PAD_ALIGN_RADII * mine);
    let gx = px;
    let gy = py;
    let left = range;
    ships.destX[i] = place.x;
    ships.destY[i] = place.y;
    if (!near && !lined) {
        ships.viaX[i] = ships.entryX;
        ships.viaY[i] = ships.entryY;
        const entry = length(ships.entryX - place.x, ships.entryY - place.y);
        gx = ships.entryX;
        gy = ships.entryY;
        if (shipRoute.route(ships, bodies, i, b, ships.entryX, ships.entryY, ships.salvaging[i]!, shipRoute.GOAL_DECK, ROUTE)) {
            gx = ROUTE.x;
            gy = ROUTE.y;
        } else {
            // Nothing in the way: still round the carrier's ring to the way in, not straight across to it,
            // so it comes to it moving along the ring as a crippled fighter can settle from.
            const cx = bodies.x[tb]!;
            const cy = bodies.y[tb]!;
            const from = atan2(bodies.y[b]! - cy, bodies.x[b]! - cx);
            const off = angleDelta(from, atan2(ships.entryY - cy, ships.entryX - cx));
            if (abs(off) > HULL_ORBIT_STEP) {
                const ring = max(length(ships.entryX - cx, ships.entryY - cy), bodies.radius[tb]! + 2 * mine);
                const step = from + (off > 0 ? HULL_ORBIT_STEP : -HULL_ORBIT_STEP);
                gx = cx + cos(step) * ring;
                gy = cy + sin(step) * ring;
            }
        }
        left = length(gx - bodies.x[b]!, gy - bodies.y[b]!) + length(ships.entryX - gx, ships.entryY - gy) + entry;
    }
    const dx = gx - bodies.x[b]!;
    const dy = gy - bodies.y[b]!;
    const gap = length(dx, dy);
    let vx = place.vx;
    let vy = place.vy;
    if (gap > 0) {
        const ux = dx / gap;
        const uy = dy / gap;
        let radial: number;
        if (near) {
            // The last few metres eased in at what it may land at, so it settles
            // rather than overshooting and turning back.
            radial = min(PAD_ARRIVAL_SPEED, range / approach.responseTime);
        } else {
            // Braking on what is left once it is keeping up.
            // Less what it takes to keep up with the pad and hold off the strongest pull on the way.
            const pull = shipFlight.pullOnWay(ships, bodies.x[b]!, bodies.y[b]!, ux, uy, left);
            const spare = max(0, shipFlight.pushAbility(ships, bodies, i, b) - length(ax, ay) - pull);
            radial = min(approach.approachSpeed, stoppingSpeed(PLACING_BRAKE * approach.brake * spare, left, ships.pushDelay));
        }
        vx += ux * radial;
        vy += uy * radial;
    }
    shipFlight.urge(ships, URGE_REFERENCE, vx, vy, ax, ay);

    // Where it faces is the helm's to choose all the way in. It turns for a small change only when it
    // cannot push that way as it faces: chasing every one, a fighter that turns on thrusters at its stern
    // pushes itself off its way in with each turn. The pad's field squares it up (`padField`).
    ships.intent = STEER;
    return heading;
}

/**
 * Which of pad `pad`'s ways in (`PadApproach`) fighter `i` on body `b` takes
 * to it, into `wayAngle`, and where that way leaves the circle round carrier
 * body `tb` it keeps outside, into `entryX`, `entryY`: the one reached
 * soonest going round the carrier, unless the one it is already taking is
 * nearly as soon, or it is inside that circle and in front of it. The ways were worked out once, for the carrier as it was
 * compiled, and turn with the pad into whatever hull it is now.
 */
export function wayIn(
    ships: Ships,
    bodies: Bodies,
    i: number,
    b: number,
    tb: number,
    host: ShipDesign,
    pad: number,
    px: number,
    py: number,
): void {
    const origin = originOf(host, pad);
    const turn = bodies.angle[tb]! + approachTurn(host, pad);
    const same = ships.landingWayPad[i] === pad && ships.landingWayBody[i] === tb;
    const was = same ? ships.landingWay[i]! : NaN;
    const compiled: readonly PadApproach[] = origin.design.approaches ?? [];
    let best = NaN;
    let soonest = Infinity;
    // Inside the circle, round the carrier means nothing: it keeps the way it is on, while still in front of it.
    const ring = bodies.radius[tb]! + 2 * bodies.radius[b]!;
    const inside = length(bodies.x[b]! - bodies.x[tb]!, bodies.y[b]! - bodies.y[tb]!) < ring;
    if (inside && !Number.isNaN(was) && inFront(bodies, b, px, py, was + bodies.angle[tb]!)) {
        soonest = -Infinity;
        best = was + bodies.angle[tb]!;
    }
    // A way something is in now, a fighter on the next pad say, is passed over while another is clear.
    let fallback = NaN;
    for (let k = 0; k < compiled.length; k++) {
        if (compiled[k]!.pad !== origin.module) continue;
        const cost = wayCost(ships, bodies, b, tb, px, py, compiled[k]!.angle + turn, was);
        if (!(cost < soonest)) continue;
        if (wayBlocked(ships, bodies, b, tb, px, py)) {
            if (Number.isNaN(fallback)) fallback = compiled[k]!.angle + turn;
            continue;
        }
        soonest = cost;
        best = compiled[k]!.angle + turn;
    }
    if (Number.isNaN(best)) best = fallback;
    // Compiled with none: worked out for the hull as it is.
    if (Number.isNaN(best)) {
        for (const way of padApproaches(host, pad)) {
            const cost = wayCost(ships, bodies, b, tb, px, py, way.angle + bodies.angle[tb]!, was);
            if (cost < soonest) {
                soonest = cost;
                best = way.angle + bodies.angle[tb]!;
            }
        }
    }
    ships.landingWay[i] = best - bodies.angle[tb]!;
    ships.landingWayPad[i] = pad;
    ships.landingWayBody[i] = tb;
    ships.wayAngle = best;
    wayCost(ships, bodies, b, tb, px, py, best, NaN);
}

/** Whether body `b` is out in front of the pad at `px`, `py` along the way at `angle`. */
function inFront(bodies: Bodies, b: number, px: number, py: number, angle: number): boolean {
    return (bodies.x[b]! - px) * cos(angle) + (bodies.y[b]! - py) * sin(angle) > 0;
}

/**
 * Whether anything in the weapons layer of carrier body `tb` stands between
 * where the way `wayCost` last worked out leaves its circle and the pad at
 * `px`, `py`, across body `b`'s width.
 */
export function wayBlocked(ships: Ships, bodies: Bodies, b: number, tb: number, px: number, py: number): boolean {
    const dx = px - ships.entryX;
    const dy = py - ships.entryY;
    const span = length(dx, dy);
    if (!(span > 0)) return false;
    const side = bodies.radius[b]!;
    const ox = (-dy / span) * side;
    const oy = (dx / span) * side;
    let blocked = false;
    for (let k = -1; k <= 1 && !blocked; k++)
        blocked = crossesCarrier(ships, bodies, b, tb, ships.entryX + k * ox, ships.entryY + k * oy, dx, dy);
    return blocked;
}

/**
 * Whether the line from `x0`, `y0` along `dx`, `dy` crosses anything in the
 * weapons layer of carrier body `tb`, or any fighter parked on it but body `b`.
 */
export function crossesCarrier(
    ships: Ships,
    bodies: Bodies,
    b: number,
    tb: number,
    x0: number,
    y0: number,
    dx: number,
    dy: number,
): boolean {
    ships.hulls.castFrom(WEAPONS_LAYER, -1, -1);
    let crosses = ships.hulls.confirm(bodies, tb, x0, y0, dx, dy) >= 0;
    for (let k = 0; k < ships.parkedShips.length && !crosses; k++) {
        const f = ships.parkedShips[k]!;
        const fb = bodies.indexOf(ships.bodyIds[f]!);
        if (fb >= 0 && fb !== b && ships.carrierBodyOf(bodies, f) === tb) crosses = ships.hulls.confirm(bodies, fb, x0, y0, dx, dy) >= 0;
    }
    ships.hulls.reset();
    return crosses;
}

/**
 * How far round carrier body `tb` body `b` is from where the way in at
 * `angle` off the pad at `px`, `py` leaves the circle it keeps outside,
 * radians, less `WAY_STICK` for the way it was taking, `was` in the
 * carrier's frame. Leaves that point in `entryX`, `entryY`.
 */
export function wayCost(ships: Ships, bodies: Bodies, b: number, tb: number, px: number, py: number, angle: number, was: number): number {
    const cx = bodies.x[tb]!;
    const cy = bodies.y[tb]!;
    const nx = cos(angle);
    const ny = sin(angle);
    const ring = bodies.radius[tb]! + 2 * bodies.radius[b]!;
    // How far out along it the circle is crossed.
    const along = (px - cx) * nx + (py - cy) * ny;
    const disc = along * along - ((px - cx) * (px - cx) + (py - cy) * (py - cy)) + ring * ring;
    const out = disc > 0 ? max(0, -along + sqrt(disc)) : 0;
    ships.entryX = px + nx * out;
    ships.entryY = py + ny * out;
    const round = abs(angleDelta(atan2(bodies.y[b]! - cy, bodies.x[b]! - cx), atan2(ships.entryY - cy, ships.entryX - cx)));
    const kept = !Number.isNaN(was) && abs(angleDelta(angle - bodies.angle[tb]!, was)) < 1e-6;
    return kept ? round - WAY_STICK : round;
}

/** The first of this ship's ports still working and not already mated, or -1. */
export function workingPort(ships: Ships, bodies: Bodies, i: number, b: number): number {
    const design = ships.designs[i]!;
    for (let m = 0; m < design.modules.length; m++) {
        if (design.modules[m]!.spec.kind === "port" && ships.ownsAt(i, b, m) && portFree(ships, bodies, i, m)) return m;
    }
    return -1;
}

/** Whether module `port` of ship `t` is a port still working, mated to nothing. */
export function portFree(ships: Ships, bodies: Bodies, t: number, port: number): boolean {
    const design = ships.designs[t]!;
    if (design.modules[port]?.spec.kind !== "port") return false;
    const tb = bodies.indexOf(ships.bodyIds[t]!);
    if (tb < 0 || !(ships.left(t, tb, port, DamageEffect.Grip) > 0)) return false;
    for (const seam of design.seams ?? []) {
        if (seam.dock === "port" && (seam.a === port || seam.b === port)) return false;
    }
    return true;
}

/**
 * The best friend's port to dock with, as a pad is chosen: the fuel its ship
 * can spare for the time to get there and be filled through the slower of
 * the two ports, put off by armed enemies near it and by every other ship
 * already making for it. A friend that is refuelling itself has none to spare.
 */
export function pickPort(
    ships: Ships,
    bodies: Bodies,
    i: number,
    b: number,
    own: number,
    room: number,
    metalRoom = 0,
    chargeRoom = 0,
    only = NO_TARGET,
): void {
    const design = ships.designs[i]!;
    const approach = ships.doctrines[i]!.approach;
    ships.salvaging[i] = NO_TARGET;
    ships.landingPad[i] = -1;
    ships.dockPort[i] = -1;
    ships.ownPort[i] = -1;
    if (!(approach.approachSpeed > 0)) return;
    const ownPump = design.modules[own]!.stats.pumpRate;
    let bestScore = 0;
    for (let t = 0; t < ships.alive.length; t++) {
        if (t === i || ships.alive[t] === 0 || ships.derelict[t] === 1 || ships.docking[t] === 1) continue;
        if (only !== NO_TARGET && t !== only) continue;
        if (ships.team[t] !== ships.team[i] || ships.hostile(i, t) || !ships.hasControl(t)) continue;
        const tb = bodies.indexOf(ships.bodyIds[t]!);
        if (tb < 0 || tb === b) continue;
        const host = ships.designs[t]!;
        let danger = only !== NO_TARGET ? 0 : -1;
        for (let p = 0; p < host.modules.length; p++) {
            if (host.modules[p]!.spec.kind !== "port" || !ships.ownsAt(t, tb, p) || !portFree(ships, bodies, t, p)) continue;
            const spare = ships.fuel.pieceHeld(tb, p) - shipSupply.fuelReserve(ships, tb, p);
            const pump = min(ownPump, host.modules[p]!.stats.pumpRate);
            const spareMetal = metalRoom > 0 ? ships.metal.pieceHeld(tb, p) - shipSupply.metalReserve(ships, tb, p) : 0;
            const spareCharge = chargeRoom > 0 ? ships.power.pieceHeld(tb, p) - shipSupply.chargeReserve(ships, tb, p) : 0;
            const others = max(0, min(spareMetal, metalRoom)) + (spareCharge > 0 ? 1 : 0);
            if (!(spare > 0 || others > 0) || !(pump > 0)) continue;
            const take = max(0, spare < room ? spare : room) + others;
            const gap = length(bodies.x[tb]! - bodies.x[b]!, bodies.y[tb]! - bodies.y[b]!);
            if (danger < 0) danger = approach.dockDanger > 0 ? shipForage.dangerNear(ships, bodies, i, tb) : 0;
            let queue = 0;
            for (let o = 0; o < ships.alive.length; o++) {
                if (o !== i && ships.alive[o] === 1 && ships.salvaging[o] === t && ships.dockPort[o] === p) queue++;
            }
            const score = take / (gap / approach.approachSpeed + take / pump) / (1 + max(0, approach.dockDanger) * danger) / (1 + queue);
            if (score > bestScore) {
                bestScore = score;
                ships.salvaging[i] = t;
                ships.dockPort[i] = p;
                ships.ownPort[i] = own;
            }
        }
    }
}

/**
 * Bring this ship's port `own` onto port `theirs` of body `tb`, face to face.
 * It flies to a point a little off their port first, mains along the change
 * of velocity it needs as a ram does, and round their hull to the front of
 * the port if it starts anywhere else; once there, lined up and on the port's
 * axis, it closes the last stretch at `PORT_APPROACH`, slow enough to mate.
 * Returns the heading to hold.
 */
export function dockOn(ships: Ships, dt: number, bodies: Bodies, i: number, b: number, tb: number, theirs: number, own: number): number {
    const host = ships.designOf(tb);
    const design = ships.designs[i]!;
    if (host === null || host.modules[theirs] === undefined || design.modules[own] === undefined) return bodies.angle[b]!;
    const approach = ships.doctrines[i]!.approach;
    const place = modulePlace(bodies, tb, host, theirs);
    shipFlight.dockingAccel(ships, i, place.vx, place.vy, dt);
    const ax = ships.dockAx[i]!;
    const ay = ships.dockAy[i]!;
    const nx = cos(place.angle);
    const ny = sin(place.angle);
    const face = host.modules[theirs]!.spec.length / 2;
    // Where its own port's face is from its centre of mass, in its own frame.
    const mine = design.modules[own]!;
    const turned = mine.spec.angle ?? 0;
    const ox = mine.x + cos(turned) * mine.spec.length * 0.5;
    const oy = mine.y + sin(turned) * mine.spec.length * 0.5;
    const heading = place.angle + PI - turned;
    const c = cos(heading);
    const s = sin(heading);
    // Its centre of mass with the two faces touching.
    const gx = place.x + nx * face - (ox * c - oy * s);
    const gy = place.y + ny * face - (ox * s + oy * c);
    const rx = bodies.x[b]! - gx;
    const ry = bodies.y[b]! - gy;
    const lateral = abs(-rx * ny + ry * nx);
    const width = min(mine.spec.width, host.modules[theirs]!.spec.width);
    const lined = abs(angleDelta(bodies.angle[b]!, heading)) <= PORT_HEADING_SLACK && lateral <= width * 0.25;
    const standoff = PORT_STANDOFF_RADII * bodies.radius[b]!;
    let tx = lined ? gx : gx + nx * standoff;
    let ty = lined ? gy : gy + ny * standoff;
    ships.destX[i] = place.x + nx * face;
    ships.destY[i] = place.y + ny * face;
    if (!lined) {
        ships.viaX[i] = tx;
        ships.viaY[i] = ty;
    }
    // Not out in front of their port: round their hull to a point a radius of
    // theirs off it first, rather than through the hull.
    const fx = bodies.x[b]! - (place.x + nx * face);
    const fy = bodies.y[b]! - (place.y + ny * face);
    const ahead = fx * nx + fy * ny;
    let left = -1;
    if (!lined && !(ahead > 0 && abs(fy * nx - fx * ny) <= ahead)) {
        // Round their hull, and whatever else is in the way, to a point a radius of theirs off it (`shipRoute`).
        const reach = bodies.radius[tb]!;
        tx = place.x + nx * (face + reach);
        ty = place.y + ny * (face + reach);
        const offX = tx;
        const offY = ty;
        ships.viaX[i] = offX;
        ships.viaY[i] = offY;
        if (shipRoute.route(ships, bodies, i, b, offX, offY, ships.salvaging[i]!, shipRoute.GOAL_SOLID, ROUTE)) {
            tx = ROUTE.x;
            ty = ROUTE.y;
        }
        left = length(tx - bodies.x[b]!, ty - bodies.y[b]!) + length(offX - tx, offY - ty) + reach;
    }
    const dx = tx - bodies.x[b]!;
    const dy = ty - bodies.y[b]!;
    const range = length(dx, dy);
    if (left < 0) left = range;
    let vx = place.vx;
    let vy = place.vy;
    if (range > 0) {
        let radial: number;
        if (lined) {
            radial = PORT_APPROACH;
        } else {
            // Braking on what is left once it is keeping up.
            // Less what it takes to keep up with the port and hold off the strongest pull on the way.
            const pull = shipFlight.pullOnWay(ships, bodies.x[b]!, bodies.y[b]!, dx / range, dy / range, left);
            const spare = max(0, shipFlight.pushAbility(ships, bodies, i, b) - length(ax, ay) - pull);
            radial = min(approach.approachSpeed, stoppingSpeed(PLACING_BRAKE * approach.brake * spare, left, ships.pushDelay));
        }
        vx += (dx / range) * radial;
        vy += (dy / range) * radial;
    }
    shipFlight.urge(ships, URGE_REFERENCE, vx, vy, ax, ay);
    // Far off, where it faces is the helm's to choose, so long as it turns for
    // any change it could not mate at; near, it faces the port it mates with.
    if (left > PAD_ALIGN_RADII * bodies.radius[b]!) {
        ships.intent = STEER;
        ships.steerSlack = PORT_SPEED;
    }
    return heading;
}

/** The ship docked to this one by a port on the body they share, or -1. */
export function portPartner(ships: Ships, i: number, b: number): number {
    const seams = ships.designs[i]!.seams;
    if (seams === undefined) return -1;
    for (const seam of seams) {
        if (seam.dock !== "port") continue;
        const pa = ships.pilotAt(b, seam.a);
        const pb = ships.pilotAt(b, seam.b);
        if (pa === i && pb !== i) return pb;
        if (pb === i && pa !== i) return pa;
    }
    return -1;
}

/** The mass of the modules ship `i` works on body `b`, kg: what it brought to a dock. */
export function ownMass(ships: Ships, i: number, b: number): number {
    const design = ships.designs[i]!;
    let mass = 0;
    for (let m = 0; m < design.modules.length; m++) if (ships.ownsAt(i, b, m)) mass += design.modules[m]!.stats.mass;
    return mass;
}

/**
 * Take aboard every fighter that has settled onto the pad it was making for:
 * its whole outline inside the pad's, and moving with it to within
 * `PAD_SPEED` and turning with it to within `PAD_SPIN`, held there by the
 * pad's field (`padField`), which is what brings it to rest. Say how many landed.
 *
 * A fighter flies above a deck, so it never touches a pad; landing is the
 * two meeting at the boundary between the layers, and no commitment.
 */
export function land(ships: Ships, world: World): number {
    ships.tick = world.tick;
    const bodies = world.bodies;
    ships.bodyStore = bodies;
    const settled = world.tick - WELD_SETTLE / world.dt;
    let landed = 0;
    for (let i = 0; i < ships.alive.length; i++) {
        const pad = ships.landingPad[i]!;
        if (ships.alive[i] === 0 || pad < 0 || ships.committed[i] === 1 || !ships.designs[i]!.fighter) continue;
        const c = ships.salvaging[i]!;
        if (c === NO_TARGET || ships.alive[c] === 0 || ships.partedAt[i]! > settled) continue;
        const b = bodies.indexOf(ships.bodyIds[i]!);
        const cb = bodies.indexOf(ships.bodyIds[c]!);
        if (b < 0 || cb < 0 || b === cb || !padFree(ships, bodies, c, pad)) continue;
        if (ships.damage.isProtected(b) || ships.damage.isProtected(cb) || shipSupply.threatened(ships, bodies, i, cb, true)) continue;
        const host = ships.designs[c]!;
        const place = modulePlace(bodies, cb, host, pad);
        // Held by a powered pad, it lands once lowered all the way, which it is only while in place and squared up;
        // a pad with no charge to hold it takes it as it settles, at any angle it fits.
        if (ships.padHeld[i] === 1 && ships.lowered[i]! < HELD_LOWEST) continue;
        if (length(bodies.vx[b]! - place.vx, bodies.vy[b]! - place.vy) > PAD_SPEED) continue;
        if (abs(bodies.angularVel[b]! - bodies.angularVel[cb]!) > PAD_SPIN) continue;
        if (!shipBuild.within(bodies, b, ships.designs[i]!, place, host.modules[pad]!.spec)) continue;
        if (!park(ships, bodies, c, i, pad)) continue;
        ships.landedReach[i] = shipSupply.fightReach(ships, i);
        ships.home[i] = c;
        landed++;
    }
    return landed;
}
