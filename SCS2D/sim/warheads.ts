import type { Bodies } from "./bodies.js";
import type { ShipDesign } from "./blueprint.js";
import { DamageEffect, IMPACT_BURST, resolveCollision, SHATTER, type ImpactLog } from "./damage.js";
import { HullPath, moduleLayers } from "./hull.js";
import { abs, angleDelta, asin, atan2, cos, log, max, min, PI, pow, sin, sqrt, TAU } from "./math.js";
import { WARHEAD_FRAGMENT_LIFE, warheadBurst, warheadBurstSpeed, warheadSpread } from "./modules.js";
import { fragmentLayer, ROUND_WRECKAGE, type Projectiles } from "./projectiles.js";
import * as shipAim from "./shipAim.js";
import * as shipDocking from "./shipDocking.js";
import * as shipOrders from "./shipOrders.js";
import { blowKey, discardFrom, heldMass, settleMass } from "./shipBreakup.js";
import { MOST_FRAGMENTS, WRECKAGE_LIFE, WRECKAGE_SHARE } from "./wreckage.js";
import { IndexBuffer, type SpatialGrid } from "./spatialGrid.js";
import type { Ships } from "./ships.js";
import type { World } from "./world.js";

/**
 * Warheads: a hull weapon that fires by destroying itself.
 *
 * A warhead is a tank whose walls are the casing and whose fuel is the charge,
 * so what it yields is what it holds. Its ship burns it last
 * (`WARHEAD_DRAIN_PRIORITY`), and it tops itself up from the tanks drawn
 * before it, so one rebuilt or holed fills again. Its fuze sets it off when
 * the edge of an enemy hull comes inside the cone its fragments would fly in
 * relative to that hull, its own velocity added as a shotgun's is
 * (`fragmentCone`), and within their reach, which its mount's doctrine sets as
 * a gun's does; unless a friend inside it is nearer. A collision does not: a
 * ram is still a ram.
 *
 * Going off, the casing flies out across the spread as fragments, which are
 * rounds like any other and pass through nothing of the ship that threw them
 * but the warhead itself. The fragments take `focus` of the charge's energy
 * (`warheadBurst`); the rest crushes the carrier outward from the warhead, as a
 * collision crushes a hull inward, along `BLAST_LINES` lines spread evenly over
 * the turn outside the spread. So what is behind a module is shielded by it,
 * and what a line meets nothing of goes off into space. The hull keeps the momentum the fragments
 * leave with, the other way, and the warhead itself is shattered.
 *
 * A module the blast shatters flies on as wreckage, as one a collision
 * shatters does: `WRECKAGE_SHARE` of it, away from the warhead, with half the
 * energy it took. The charge's gas takes their momentum the other way. So a
 * warhead is dangerous all round its carrier, not only across its spread.
 */

/**
 * The fastest a hull can close and still be caught before it touches, m/s:
 * how far beyond its reach a fuze looks for one, a step's travel at this.
 */
const FUZE_CLOSING = 5000;

/** How many bearings each side of its facing a burst's cone is traced through (`fragmentCone`). */
const CONE_STEPS = 12;

/** The way a burst's fragments go as seen from what they are thrown at (`fragmentCone`). */
export interface FragmentCone {
    /** The bearing down its middle, radians, in the world. */
    centre: number;
    /** Half its width, radians: infinite all round. */
    half: number;
    /** How far it is worth going off at, metres: as `warheadReach`, at the speeds the fragments close at. */
    reach: number;
}

/**
 * Where a burst's fragments go relative to a hull, as a shotgun's pellets do
 * from a moving hull: each leaves at the burst's `speed` along its bearing in
 * the `spread` about `facing`, plus (`rvx`, `rvy`), the warhead's velocity
 * less the hull's. So a warhead closing fast throws a narrower cone, swung
 * towards the way it closes, and further, since its fragments close faster.
 * Traced bearing by bearing (`CONE_STEPS`), so a cone that swings past a half
 * turn stays one cone.
 */
export function fragmentCone(
    speed: number,
    spread: number,
    fragments: number,
    facing: number,
    rvx: number,
    rvy: number,
    targetRadius: number,
    fireRange: number,
    out: FragmentCone,
): FragmentCone {
    const drift = sqrt(rvx * rvx + rvy * rvy);
    const ring = spread >= TAU;
    const half = ring ? PI : 0.5 * spread;
    const mid = atan2(rvy + speed * sin(facing), rvx + speed * cos(facing));
    let lo = 0;
    let hi = 0;
    let slowest = length2(rvx + speed * cos(facing), rvy + speed * sin(facing));
    for (let side = -1; side <= 1; side += 2) {
        let previous = mid;
        let turned = 0;
        for (let k = 1; k <= CONE_STEPS && half > 0; k++) {
            const bearing = facing + (side * half * k) / CONE_STEPS;
            const fx = rvx + speed * cos(bearing);
            const fy = rvy + speed * sin(bearing);
            const heading = atan2(fy, fx);
            turned += angleDelta(previous, heading);
            previous = heading;
            if (turned < lo) lo = turned;
            if (turned > hi) hi = turned;
            const fast = length2(fx, fy);
            if (fast < slowest) slowest = fast;
        }
    }
    // All round, and slower than the burst: some go every way.
    const round = ring && drift < speed;
    out.centre = round ? facing : mid + 0.5 * (lo + hi);
    out.half = round || hi - lo >= TAU ? Infinity : 0.5 * (hi - lo);
    const width = out.half === Infinity ? TAU : 2 * out.half;
    const flight = slowest * WARHEAD_FRAGMENT_LIFE;
    const spaced = width > 0 && fragments > 1 ? (2 * targetRadius * fragments) / width : Infinity;
    out.reach = (spaced < flight ? spaced : flight) * fireRange;
    return out;
}

function length2(x: number, y: number): number {
    return sqrt(x * x + y * y);
}

/** Steel, which sizes a fragment's calibre from its mass. */
const FRAGMENT_DENSITY = 7800;

/** How fast a warhead tops itself up from its ship's tanks, kg/s. */
export const WARHEAD_FILL_RATE = 20;

/** The share of what a module shattered by a blast took that throws its wreckage. */
const BLAST_THROW = 0.5;

/** The least a piece of it weighs, kg, so a light module breaks into fewer. */
const LEAST_PIECE = 1;

/** How far a piece strays from straight out from the warhead, radians either way. */
const BLAST_STRAY = 0.3;

/**
 * The chance a warhead holding charge goes off in a step it is damaged in,
 * while sound. It rises to certain as its integrity falls to nothing, and one
 * the step shatters always goes off.
 */
export const COOK_OFF_CHANCE = 0.05;

/** The chance a warhead this whole goes off, damaged. */
export function cookOffChance(integrity: number): number {
    const worn = integrity < 0 ? 1 : integrity > 1 ? 0 : 1 - integrity;
    return COOK_OFF_CHANCE + (1 - COOK_OFF_CHANCE) * worn;
}

/** How many lines a blast crushes its carrier along, each with an even share of it. */
export const BLAST_LINES = 64;

const path = new HullPath();
const escaped = { left: 0 };

const warheadCache = new WeakMap<ShipDesign, readonly number[]>();

/** Which of a design's modules are warheads. */
function warheadsOf(design: ShipDesign): readonly number[] {
    let found = warheadCache.get(design);
    if (found === undefined) {
        const list: number[] = [];
        for (let m = 0; m < design.modules.length; m++) if (design.modules[m]!.spec.kind === "warhead") list.push(m);
        found = list;
        warheadCache.set(design, found);
    }
    return found;
}

const near = new IndexBuffer();

/**
 * Set off every warhead whose fuze is tripped, one a hull a step, and say how
 * many went off. Call after the index has been rebuilt and before rounds fly.
 */
export function detonateWarheads(ships: Ships, world: World, projectiles: Projectiles, grid: SpatialGrid, log?: ImpactLog): number {
    const bodies = world.bodies;
    let count = 0;
    for (let i = 0; i < ships.alive.length; i++) {
        if (ships.alive[i] === 0 || ships.derelict[i] === 1) continue;
        const design = ships.designs[i]!;
        const heads = warheadsOf(design);
        if (heads.length === 0) continue;
        const b = bodies.indexOf(ships.bodyIds[i]!);
        // Not while it rides another's hull, or carries another on its own.
        if (b < 0 || ships.shipByBody[b] !== i || ships.pilots[b] != null) continue;
        for (const m of heads) ships.fuel.topUp(b, m, WARHEAD_FILL_RATE * world.dt);
        // Not on a pad, over its own carrier.
        if (ships.parkedOn[i]! >= 0) continue;
        for (const m of heads) {
            if (ships.left(i, b, m, DamageEffect.Fuze) <= 0) continue;
            if (!tripped(ships, bodies, grid, i, b, design, m, world.dt)) continue;
            detonate(ships, world, projectiles, i, b, design, m, log);
            ships.firedAt[i] = world.tick;
            count++;
            // The hull is not the shape it was: any other waits for the next step.
            break;
        }
    }
    return count;
}

/**
 * Set off every warhead holding charge that this step's blows have damaged,
 * by `cookOffChance`, or certainly if they shattered it, and say how many went
 * off. Wherever it points, fuze or no fuze, and whoever is near. One going off
 * can set off another on the same hull. Call after the step's hits and before
 * severing, which forgets them.
 *
 * A craft parked on a pad is let off it first, so it goes as a free hull
 * does, and its blast goes on into the carrier's hull from where it leaves
 * the craft's. Not on a hull more than one ship rides, which severing does not
 * break up.
 */
export function cookOff(ships: Ships, world: World, projectiles: Projectiles, log?: ImpactLog): number {
    const damage = ships.damage;
    const bodies = world.bodies;
    let count = 0;
    // A blast adds entries as it goes, which is how one sets off another.
    for (let e = 0; e < damage.stepCount; e++) {
        const b = damage.stepBody[e]!;
        const m = damage.stepModule[e]!;
        if (damage.kindAt(b, m) !== "warhead" || !(damage.stepJoules[e]! > 0)) continue;
        const i = ships.shipByBody[b] ?? -1;
        if (i < 0 || ships.alive[i] === 0 || bodies.alive[b] === 0 || ships.pilots[b] != null) continue;
        if (!(ships.fuel.held(b, m) > 0)) continue;
        const shattered = damage.stepJoules[e]! >= SHATTER * damage.capacityOf(b, m);
        if (!shattered && !(world.rng.nextFloat() < cookOffChance(damage.integrity(b, m)))) continue;
        // Off its pad first, so it goes as a free hull does, into the one it sat on.
        const carrier = ships.parkedOn[i]! >= 0 ? ships.carrierBodyOf(bodies, i) : -1;
        if (ships.parkedOn[i]! >= 0) shipDocking.unpark(ships, bodies, i, world.tick);
        detonate(ships, world, projectiles, i, b, ships.designs[i]!, m, log, carrier);
        count++;
    }
    return count;
}

/**
 * Whether warhead `m` of ship `i`, on body `b`, would go off now: an enemy
 * module's nearest point inside its fragments' cone as that hull sees them
 * come (`fragmentCone`) and within its reach, or within a step of it, and no
 * friend's nearer inside it.
 */
export function tripped(
    ships: Ships,
    bodies: Bodies,
    grid: SpatialGrid,
    i: number,
    b: number,
    design: ShipDesign,
    m: number,
    dt: number,
): boolean {
    const placed = design.modules[m]!;
    const spec = placed.spec;
    const head = design.warheads.find((h) => h.module === m);
    if (head === undefined) return false;
    const speed = warheadBurstSpeed(spec, max(0, placed.stats.structureMass - ships.damage.shedAt(b, m)), ships.fuel.held(b, m));
    const fragments = spec.fragments !== undefined && spec.fragments > 1 ? spec.fragments : 1;
    const spread = warheadSpread(spec);
    const angle = bodies.angle[b]!;
    const c = cos(angle);
    const s = sin(angle);
    const wx = bodies.x[b]! + placed.x * c - placed.y * s;
    const wy = bodies.y[b]! + placed.x * s + placed.y * c;
    const facing = angle + placed.angle;
    const spin = bodies.angularVel[b]!;
    const wvx = bodies.vx[b]! - spin * (wy - bodies.y[b]!);
    const wvy = bodies.vy[b]! + spin * (wx - bodies.x[b]!);
    // Nothing closing faster than `FUZE_CLOSING` is reached further than this.
    const furthest = (speed + FUZE_CLOSING) * WARHEAD_FRAGMENT_LIFE * head.targeting.fireRange;

    let enemy = Infinity;
    let friend = Infinity;
    grid.queryCircle(bodies, wx, wy, furthest + FUZE_CLOSING * dt, near);
    for (let q = 0; q < near.count; q++) {
        const tb = near.data[q]!;
        if (tb === b) continue;
        const t = ships.shipByBody[tb] ?? -1;
        if (t < 0 || ships.alive[t] === 0) continue;
        const theirs = ships.designs[t]!;
        const pilots = ships.pilots[tb];
        // The fragments as that hull sees them come.
        const tvx = bodies.vx[tb]!;
        const tvy = bodies.vy[tb]!;
        fragmentCone(speed, spread, fragments, facing, wvx - tvx, wvy - tvy, head.targetRadius, head.targeting.fireRange, CONE);
        // Into the other hull's frame, once.
        const ta = bodies.angle[tb]!;
        const tc = cos(ta);
        const ts = sin(ta);
        const rx = wx - bodies.x[tb]!;
        const ry = wy - bodies.y[tb]!;
        const lx = rx * tc + ry * ts;
        const ly = -rx * ts + ry * tc;
        const lf = CONE.centre - ta;
        // How fast the two close, along the line between their centres.
        const run = sqrt(rx * rx + ry * ry);
        const closing = run > 0 ? ((wvx - tvx) * -rx + (wvy - tvy) * -ry) / run : 0;
        const slack = closing > 0 ? closing * dt : 0;
        for (let k = 0; k < theirs.modules.length; k++) {
            const owner = pilots == null ? t : pilots[k]!;
            if (owner < 0) continue;
            const hostile = ships.hostile(i, owner) && ships.derelict[owner] !== 1;
            // Neither side's: a rock, say, or a wreck nobody works.
            if (!hostile && ships.team[owner] !== ships.team[i]) continue;
            const d = boxDistance(theirs, k, lx, ly);
            if (!(d >= 0)) continue;
            if (d > CONE.reach + slack) continue;
            if (!inSpread(theirs, k, lx, ly, lf, CONE.half, d)) continue;
            if (hostile) enemy = min(enemy, d);
            else friend = min(friend, d);
        }
    }
    return enemy < Infinity && !(friend <= enemy);
}

const CONE: FragmentCone = { centre: 0, half: 0, reach: 0 };

/**
 * The cone warhead `w` of ship `i`, on body `b`, would throw its fragments in
 * at what it is going for: its order's target, a ram's among them, else the
 * one its doctrine chose, else at rest. Widened by the target's size as seen
 * from the warhead, so it shows where the fuze would go off, for drawing.
 */
export function warheadCone(ships: Ships, bodies: Bodies, i: number, b: number, w: number, out: FragmentCone): FragmentCone {
    const design = ships.designs[i]!;
    const head = design.warheads[w]!;
    const placed = design.modules[head.module]!;
    const spec = placed.spec;
    const speed = warheadBurstSpeed(
        spec,
        max(0, placed.stats.structureMass - ships.damage.shedAt(b, head.module)),
        ships.fuel.held(b, head.module),
    );
    const fragments = spec.fragments !== undefined && spec.fragments > 1 ? spec.fragments : 1;
    const angle = bodies.angle[b]!;
    const ox = placed.x * cos(angle) - placed.y * sin(angle);
    const oy = placed.x * sin(angle) + placed.y * cos(angle);
    const spin = bodies.angularVel[b]!;
    let rvx = bodies.vx[b]! - spin * oy;
    let rvy = bodies.vy[b]! + spin * ox;
    const ordered = shipOrders.effectiveOrder(ships, i)?.target ?? -1;
    const target = ordered >= 0 ? ordered : ships.chosenOf(i);
    const tb = target >= 0 && ships.alive[target] === 1 ? bodies.indexOf(ships.bodyIds[target]!) : -1;
    if (tb >= 0) {
        rvx -= bodies.vx[tb]!;
        rvy -= bodies.vy[tb]!;
    } else {
        rvx = 0;
        rvy = 0;
    }
    fragmentCone(speed, warheadSpread(spec), fragments, angle + placed.angle, rvx, rvy, head.targetRadius, head.targeting.fireRange, out);
    // Widened by how wide the target looks from here, as the fuze counts a module anywhere in it: wider as it closes.
    if (tb >= 0 && out.half < Infinity) {
        const range = length2(bodies.x[tb]! - bodies.x[b]! - ox, bodies.y[tb]! - bodies.y[b]! - oy);
        const size = bodies.radius[tb]!;
        out.half = range > size ? out.half + asin(size / range) : Infinity;
        if (out.half >= PI) out.half = Infinity;
    }
    return out;
}

/** How far `(lx, ly)`, in the design's frame, is from module `k`'s box, metres: 0 inside it. */
function boxDistance(design: ShipDesign, k: number, lx: number, ly: number): number {
    const placed = design.modules[k]!;
    const c = cos(placed.angle);
    const s = sin(placed.angle);
    const dx = lx - placed.x;
    const dy = ly - placed.y;
    const along = abs(dx * c + dy * s) - 0.5 * placed.spec.length;
    const across = abs(-dx * s + dy * c) - 0.5 * placed.spec.width;
    const ox = along > 0 ? along : 0;
    const oy = across > 0 ? across : 0;
    return sqrt(ox * ox + oy * oy);
}

/** Whether module `k` of `design` lies at all inside the spread `half` either side of `facing`, from `(lx, ly)` `d` from it. */
function inSpread(design: ShipDesign, k: number, lx: number, ly: number, facing: number, half: number, d: number): boolean {
    if (half === Infinity || !(d > 0)) return true;
    const placed = design.modules[k]!;
    const dx = placed.x - lx;
    const dy = placed.y - ly;
    const centre = sqrt(dx * dx + dy * dy);
    // As wide as the module looks from here.
    const size = 0.5 * sqrt(placed.spec.length * placed.spec.length + placed.spec.width * placed.spec.width);
    const across = centre > size ? asin(size / centre) : Infinity;
    return abs(angleDelta(facing, atan2(dy, dx))) <= half + across;
}

/** Set off warhead `m` of ship `i`, on body `b`. */
export function detonate(
    ships: Ships,
    world: World,
    projectiles: Projectiles,
    i: number,
    b: number,
    design: ShipDesign,
    m: number,
    log?: ImpactLog,
    /** The body of the hull it was parked on, which its blast goes on into; -1 for none. */
    carrier = -1,
): void {
    const bodies = world.bodies;
    const rng = world.rng;
    const damage = ships.damage;
    const placed = design.modules[m]!;
    const casing = max(0, placed.stats.structureMass - damage.shedAt(b, m));
    const burst = warheadBurst(placed.spec, placed.stats, casing, ships.fuel.held(b, m));

    // The charge goes to gas, at its hull's velocity.
    const mass = bodies.mass[b]!;
    const inertia = bodies.inertia[b]!;
    ships.fuel.empty(b, m);
    settleMass(ships, bodies, b);
    discardFrom(ships, bodies, b, mass, inertia);

    const angle = bodies.angle[b]!;
    const c = cos(angle);
    const s = sin(angle);
    const ox = placed.x * c - placed.y * s;
    const oy = placed.x * s + placed.y * c;
    const wx = bodies.x[b]! + ox;
    const wy = bodies.y[b]! + oy;
    const spin = bodies.angularVel[b]!;
    const vx = bodies.vx[b]! - spin * oy;
    const vy = bodies.vy[b]! + spin * ox;
    const facing = angle + placed.angle;

    // The casing, out across the spread: each fragment in its own slice of it.
    const n = burst.fragments;
    const home = shipAim.firedLayers(ships, i, b, design, m);
    const each = casing / n;
    const width = pow(each / FRAGMENT_DENSITY, 1 / 3);
    const all = burst.spread >= TAU;
    let px = 0;
    let py = 0;
    if (each > 0) {
        for (let k = 0; k < n; k++) {
            const slice = n === 1 && !all ? 0.5 : (k + rng.nextFloat()) / n;
            const heading = facing + (all ? slice * TAU : (slice - 0.5) * burst.spread);
            const ux = cos(heading) * burst.speed;
            const uy = sin(heading) * burst.speed;
            const round = projectiles.spawnRaw(
                wx,
                wy,
                vx + ux,
                vy + uy,
                width,
                WARHEAD_FRAGMENT_LIFE,
                each,
                0,
                0,
                b,
                0,
                m,
                fragmentLayer(home, rng, n === 1),
            );
            projectiles.ship[round] = i;
            projectiles.fragment[round] = 1;
            px += each * ux;
            py += each * uy;
        }
    }

    // The hull keeps what they left with, the other way.
    bodies.vx[b] = bodies.vx[b]! - px * bodies.invMass[b]!;
    bodies.vy[b] = bodies.vy[b]! - py * bodies.invMass[b]!;
    bodies.angularVel[b] = bodies.angularVel[b]! - (ox * py - oy * px) * bodies.invInertia[b]!;
    // The warhead is counted discarded when it goes, at its hull's velocity then;
    // its casing flew on, and is counted here instead, as it was before it flew.
    ships.discarded -= casing;
    ships.discardedPx -= casing * vx;
    ships.discardedPy -= casing * vy;
    ships.discardedL -= casing * (wx * vy - wy * vx);

    // What the fragments did not take, into the rest of the hull: a crush out
    // along each of `BLAST_LINES` lines across the turn outside the spread.
    const blast = (1 - burst.focus) * burst.energy;
    const arc = TAU - burst.spread;
    if (blast > 0 && arc > 0) {
        for (let k = 0; k < BLAST_LINES; k++) {
            const heading = facing + 0.5 * burst.spread + ((k + 0.5) * arc) / BLAST_LINES;
            const ux = cos(heading);
            const uy = sin(heading);
            resolveCollision(design, damage, bodies, b, path, wx, wy, ux, uy, blast / BLAST_LINES, 0, 0, m, escaped);
            // What came out of its own hull goes on into the one it sat on.
            const under = carrier >= 0 && escaped.left > 0 ? ships.designOf(carrier) : null;
            if (under !== null) resolveCollision(under, damage, bodies, carrier, path, wx, wy, ux, uy, escaped.left);
        }
    }
    // And the warhead is gone.
    damage.absorb(b, m, SHATTER * damage.capacityOf(b, m) * 2);
    ships.thrown.add(blowKey(b, m));
    throwBlasted(ships, bodies, projectiles, rng, i, b, design, m, wx, wy);
    const under = carrier >= 0 ? ships.designOf(carrier) : null;
    if (under !== null && (ships.shipByBody[carrier] ?? -1) >= 0 && ships.pilots[carrier] == null) {
        throwBlasted(ships, bodies, projectiles, rng, i, carrier, under, -1, wx, wy);
    }
    log?.push(wx, wy, burst.energy, IMPACT_BURST, undefined, -1, vx, vy, burst.speed);
}

const masses: number[] = [];

/**
 * Throw on as wreckage every module of the hull on body `b` this step's blows
 * shattered, but `m`, away from a blast at (`wx`, `wy`), credited to ship `i`.
 */
function throwBlasted(
    ships: Ships,
    bodies: Bodies,
    projectiles: Projectiles,
    rng: World["rng"],
    i: number,
    b: number,
    design: ShipDesign,
    m: number,
    wx: number,
    wy: number,
): void {
    const damage = ships.damage;
    const angle = bodies.angle[b]!;
    const c = cos(angle);
    const s = sin(angle);
    const spin = bodies.angularVel[b]!;
    const layers = ships.layersOf(b);
    let gasX = 0;
    let gasY = 0;
    let gasL = 0;
    for (let e = 0; e < damage.stepCount; e++) {
        if (damage.stepBody[e] !== b) continue;
        const k = damage.stepModule[e]!;
        const capacity = damage.capacityOf(b, k);
        if (k === m || !(capacity > 0) || damage.stepJoules[e]! < SHATTER * capacity) continue;
        if (ships.thrown.has(blowKey(b, k))) continue;
        ships.thrown.add(blowKey(b, k));
        const other = design.modules[k]!;
        const mass = WRECKAGE_SHARE * heldMass(ships, b, design, k);
        if (!(mass > 0)) continue;
        const speed = sqrt((2 * BLAST_THROW * damage.stepJoules[e]!) / mass);
        // Where it is and how it was moving, in the world.
        const rx = other.x * c - other.y * s;
        const ry = other.x * s + other.y * c;
        const mx = bodies.x[b]! + rx;
        const my = bodies.y[b]! + ry;
        const vx = bodies.vx[b]! - spin * ry;
        const vy = bodies.vy[b]! + spin * rx;
        // Straight out from the warhead.
        const out = atan2(my - wy, mx - wx);

        const count = min(MOST_FRAGMENTS, max(1, (mass / LEAST_PIECE) | 0), 2 + ((rng.nextFloat() * (MOST_FRAGMENTS - 1)) | 0));
        let total = 0;
        for (let f = 0; f < count; f++) {
            masses[f] = -log(1 - rng.nextFloat() * 0.999999);
            total += masses[f]!;
        }
        for (let f = 0; f < count; f++) {
            const piece = (mass * masses[f]!) / total;
            const heading = out + (rng.nextFloat() * 2 - 1) * BLAST_STRAY;
            const ux = cos(heading) * speed;
            const uy = sin(heading) * speed;
            const across = (rng.nextFloat() - 0.5) * other.spec.width;
            const x = mx - s * across;
            const y = my + c * across;
            gasX += piece * ux;
            gasY += piece * uy;
            gasL += piece * (x * uy - y * ux);
            // Counted discarded whole when its module goes; it is counted here instead.
            ships.discardedL -= piece * (x * vy - y * vx);
            projectiles.spawn({
                x,
                y,
                vx: vx + ux,
                vy: vy + uy,
                width: pow(piece / FRAGMENT_DENSITY, 1 / 3),
                ttl: WRECKAGE_LIFE,
                mass: piece,
                owner: b,
                ship: i,
                layers: moduleLayers(other, layers),
                kind: ROUND_WRECKAGE,
            });
        }
        ships.discarded -= mass;
        ships.discardedPx -= mass * vx;
        ships.discardedPy -= mass * vy;
    }
    // The gas went the other way.
    ships.discardedPx -= gasX;
    ships.discardedPy -= gasY;
    ships.discardedL -= gasL;
}
