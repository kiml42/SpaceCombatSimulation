import type { Bodies } from "./bodies.js";
import type { ShipDesign } from "./blueprint.js";
import { DamageEffect, IMPACT_BURST, resolveCollision, SHATTER, type ImpactLog } from "./damage.js";
import { BOTH_LAYERS, HullPath, moduleLayers } from "./hull.js";
import { abs, angleDelta, asin, atan2, cos, log, max, min, pow, sin, sqrt, TAU } from "./math.js";
import { DEFAULT_STANDOFF, DEFAULT_WARHEAD_SPREAD, warheadBurst } from "./modules.js";
import { ROUND_WRECKAGE, type Projectiles } from "./projectiles.js";
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
 * the edge of an enemy hull inside its spread comes within its `standoff`,
 * unless a friend inside the spread is nearer. A collision does not: a ram is still a ram.
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

/** Seconds a warhead's fragment flies: as long as a shattered module's. */
export const WARHEAD_FRAGMENT_LIFE = 0.5;

/**
 * The fastest a hull can close and still be caught before it touches, m/s:
 * how far beyond its standoff a fuze looks for one, a step's travel at this.
 */
const FUZE_CLOSING = 5000;

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

/** How many lines a blast crushes its carrier along, each with an even share of it. */
export const BLAST_LINES = 64;

const path = new HullPath();

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
 * Whether warhead `m` of ship `i`, on body `b`, would go off now: an enemy
 * module's nearest point inside its spread and within its standoff, or
 * within a step of it, and no friend's nearer inside the spread.
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
    const standoff = spec.standoff ?? DEFAULT_STANDOFF;
    const spread = spec.spread ?? DEFAULT_WARHEAD_SPREAD;
    const half = spread >= TAU ? Infinity : 0.5 * spread;
    const angle = bodies.angle[b]!;
    const c = cos(angle);
    const s = sin(angle);
    const wx = bodies.x[b]! + placed.x * c - placed.y * s;
    const wy = bodies.y[b]! + placed.x * s + placed.y * c;
    const facing = angle + placed.angle;
    const spin = bodies.angularVel[b]!;
    const wvx = bodies.vx[b]! - spin * (wy - bodies.y[b]!);
    const wvy = bodies.vy[b]! + spin * (wx - bodies.x[b]!);

    let enemy = Infinity;
    let friend = Infinity;
    grid.queryCircle(bodies, wx, wy, standoff + FUZE_CLOSING * dt, near);
    for (let q = 0; q < near.count; q++) {
        const tb = near.data[q]!;
        if (tb === b) continue;
        const t = ships.shipByBody[tb] ?? -1;
        if (t < 0 || ships.alive[t] === 0) continue;
        const theirs = ships.designs[t]!;
        const pilots = ships.pilots[tb];
        // Into the other hull's frame, once.
        const ta = bodies.angle[tb]!;
        const tc = cos(ta);
        const ts = sin(ta);
        const rx = wx - bodies.x[tb]!;
        const ry = wy - bodies.y[tb]!;
        const lx = rx * tc + ry * ts;
        const ly = -rx * ts + ry * tc;
        const lf = facing - ta;
        // How fast the two close, along the line between their centres.
        const tvx = bodies.vx[tb]!;
        const tvy = bodies.vy[tb]!;
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
            if (d > standoff + slack) continue;
            if (!inSpread(theirs, k, lx, ly, lf, half, d)) continue;
            if (hostile) enemy = min(enemy, d);
            else friend = min(friend, d);
        }
    }
    return enemy < Infinity && !(friend <= enemy);
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
            const round = projectiles.spawnRaw(wx, wy, vx + ux, vy + uy, width, WARHEAD_FRAGMENT_LIFE, each, 0, 0, b, 0, m, BOTH_LAYERS);
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
            resolveCollision(design, damage, bodies, b, path, wx, wy, cos(heading), sin(heading), blast / BLAST_LINES, 0, 0, m);
        }
    }
    // And the warhead is gone.
    damage.absorb(b, m, SHATTER * damage.capacityOf(b, m) * 2);
    ships.thrown.add(blowKey(b, m));
    throwBlasted(ships, bodies, projectiles, rng, i, b, design, m);
    log?.push(wx, wy, burst.energy, IMPACT_BURST, undefined, -1, vx, vy, burst.speed);
}

const masses: number[] = [];

/** Throw on as wreckage every module of ship `i`'s hull a blast from its warhead `m` shattered this step. */
function throwBlasted(
    ships: Ships,
    bodies: Bodies,
    projectiles: Projectiles,
    rng: World["rng"],
    i: number,
    b: number,
    design: ShipDesign,
    m: number,
): void {
    const damage = ships.damage;
    const placed = design.modules[m]!;
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
        const out = atan2(other.y - placed.y, other.x - placed.x) + angle;

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
