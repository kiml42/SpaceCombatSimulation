import type { Bodies } from "./bodies.js";
import type { ShipDesign } from "./blueprint.js";
import { DamageEffect, IMPACT_BURST, SHATTER, type ImpactLog } from "./damage.js";
import { BOTH_LAYERS } from "./hull.js";
import { abs, angleDelta, atan2, cos, max, min, PI, pow, sin, sqrt, TAU } from "./math.js";
import {
    backblastBearing,
    WARHEAD_BACKBLAST_FRAGMENTS,
    WARHEAD_FRAGMENT_LIFE,
    WARHEAD_SIDE_FRAGMENTS,
    warheadBurst,
    warheadBurstSpeed,
    warheadFragments,
    warheadSpread,
} from "./modules.js";
import { fragmentLayer, type Projectiles } from "./projectiles.js";
import * as shipAim from "./shipAim.js";
import * as shipDocking from "./shipDocking.js";
import * as shipOrders from "./shipOrders.js";
import { blowKey, discardFrom, settleMass } from "./shipBreakup.js";
import type { SpatialGrid } from "./spatialGrid.js";
import { WHOLE_SHIP, type Ships } from "./ships.js";
import { solveLead, type Lead } from "./turrets.js";
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
 * Going off, it throws its casing both ways along its axis and lighter
 * fragments all round (`warheadBurst`), so what it throws carries no momentum
 * away from its hull. They are rounds like any other, and pass through
 * nothing of the ship that threw them but the warhead itself: all the harm a
 * warhead does, to its own ship as to any other, is its fragments'. A module
 * shields what is behind it, and a warhead inside a hull wrecks it.
 */

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
 * does, its fragments into the carrier it sat on as into anything else. Not
 * on a hull more than one ship rides, which severing does not break up.
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
        // Off its pad first, so it goes as a free hull does.
        if (ships.parkedOn[i]! >= 0) shipDocking.unpark(ships, bodies, i, world.tick);
        detonate(ships, world, projectiles, i, b, ships.designs[i]!, m, log);
        count++;
    }
    return count;
}

/**
 * Whether warhead `m` of ship `i`, on body `b`, would go off now: as a hull
 * gun fires (`warheadTrigger`), when its nose is inside the cone its lead
 * allows on what it is going for, and that is within its reach; and no
 * friend's module is across its line.
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
    const w = design.warheads.findIndex((head) => head.module === m);
    if (w < 0) return false;
    // Either way it throws: ahead, or behind for a spray.
    return trippedOneWay(ships, bodies, grid, i, b, w, dt, false) || trippedOneWay(ships, bodies, grid, i, b, w, dt, true);
}

/** `tripped` for the arc ahead of warhead `w`, or the one behind it. */
function trippedOneWay(
    ships: Ships,
    bodies: Bodies,
    grid: SpatialGrid,
    i: number,
    b: number,
    w: number,
    dt: number,
    rear: boolean,
): boolean {
    if (!warheadTrigger(ships, bodies, i, b, w, TRIGGER, rear)) return false;
    // Within a step of its reach, at the speed the two close.
    if (TRIGGER.range > TRIGGER.reach + max(0, TRIGGER.closing) * dt) return false;
    if (TRIGGER.half !== Infinity && abs(angleDelta(TRIGGER.facing, TRIGGER.centre)) > TRIGGER.half) return false;
    ships.solution.x = TRIGGER.x;
    ships.solution.y = TRIGGER.y;
    ships.solution.dirX = cos(TRIGGER.facing);
    ships.solution.dirY = sin(TRIGGER.facing);
    return !shipAim.friendAlong(ships, bodies, grid, i, b, TRIGGER.reach, TRIGGER.target, TRIGGER.layers);
}

/** Where and how a warhead would go off at what it is going for (`warheadTrigger`). */
export interface WarheadTrigger {
    /** What it is going for. */
    target: number;
    /** Where the warhead is, world metres. */
    x: number;
    y: number;
    /** The way its nose points, a world bearing. */
    facing: number;
    /** The bearing its lead says to point it along, and how far off that it may go off, radians. */
    centre: number;
    half: number;
    /** How far off what it goes off at is, and how far it is worth going off at, metres. */
    range: number;
    reach: number;
    /** How fast the two close, m/s. */
    closing: number;
    /** The layers its fragments are in: what it can hit. */
    layers: number;
}

const TRIGGER: WarheadTrigger = { target: -1, x: 0, y: 0, facing: 0, centre: 0, half: 0, range: 0, reach: 0, closing: 0, layers: 0 };
const POINT: shipAim.AimPoint = { x: 0, y: 0, sweepVx: 0, sweepVy: 0, rx: 0, ry: 0, middleX: 0, middleY: 0, near: 0, far: 0, size: 0 };
const LEAD: Lead = { x: 0, y: 0, t: 0, shooterVx: 0, shooterVy: 0 };

/**
 * Warhead `w` of ship `i`, on body `b`, as a hull gun whose muzzle speed is
 * its burst: what it is going for (its order's target, a ram's among them,
 * else the one its doctrine chose), the part (the one it rams, else the
 * ship), the lead to it (`solveLead`), and the cone and range a gun would
 * fire in (`aimPoint`, `fireCone`, `fireRangeTo`), widened by how far its
 * fragments spread across the target. Its reach is how far they are worth
 * throwing at the speed they close (`fragmentCone`). False with nothing to go
 * off at in the layers its fragments are in: one ramming a part on the deck
 * waits until it has dropped to it.
 */
export function warheadTrigger(ships: Ships, bodies: Bodies, i: number, b: number, w: number, out: WarheadTrigger, rear = false): boolean {
    const design = ships.designs[i]!;
    const head = design.warheads[w]!;
    const placed = design.modules[head.module]!;
    const spec = placed.spec;
    const fragments = warheadFragments(spec);
    const angle = bodies.angle[b]!;
    const ox = placed.x * cos(angle) - placed.y * sin(angle);
    const oy = placed.x * sin(angle) + placed.y * cos(angle);
    const spin = bodies.angularVel[b]!;
    out.x = bodies.x[b]! + ox;
    out.y = bodies.y[b]! + oy;
    out.facing = angle + placed.angle + (rear ? PI : 0);
    out.target = -1;
    // A slug's backblast is no trigger.
    if (rear && fragments === 1) return false;
    const order = shipOrders.effectiveOrder(ships, i);
    const target = order !== undefined && order.target >= 0 ? order.target : ships.chosenOf(i);
    if (target < 0 || ships.alive[target] !== 1 || !ships.hostile(i, target)) return false;
    const tb = bodies.indexOf(ships.bodyIds[target]!);
    if (tb < 0 || tb === b) return false;
    const theirs = ships.designs[target]!;
    // The part it rams, while it is there.
    const rammed = order?.ram === true ? ships.ramPart[i]! : WHOLE_SHIP;
    const part = rammed >= 0 && rammed < theirs.modules.length && !ships.damage.spent(tb, rammed) ? rammed : WHOLE_SHIP;
    // A lone slug is in its warhead's layer; a spray lands in either, as a shell's does.
    const layers = fragments > 1 ? BOTH_LAYERS : shipAim.firedLayers(ships, i, b, design, head.module);
    if (part >= 0 ? !shipAim.reaches(ships, layers, theirs, tb, target, part) : !shipAim.meetsWhole(ships, layers, target)) return false;
    out.layers = layers;
    const speed = warheadBurstSpeed(
        spec,
        max(0, placed.stats.structureMass - ships.damage.shedAt(b, head.module)),
        ships.fuel.held(b, head.module),
    );
    ships.gunPoint.x = out.x;
    ships.gunPoint.y = out.y;
    ships.gunPoint.vx = bodies.vx[b]! - spin * oy;
    ships.gunPoint.vy = bodies.vy[b]! + spin * ox;
    const point = shipAim.aimPoint(ships, bodies, target, tb, part, out.x, out.y, POINT);
    const lead = solveLead(bodies, b, placed.x, placed.y, out.facing, 0, speed, point.x, point.y, bodies.vx[tb]!, bodies.vy[tb]!, LEAD);
    const toward = atan2(lead.y, lead.x);
    // Its fragments, about its lead as the target sees them come: how wide they spread, and how far they are worth throwing.
    const rvx = ships.gunPoint.vx - bodies.vx[tb]!;
    const rvy = ships.gunPoint.vy - bodies.vy[tb]!;
    fragmentCone(speed, warheadSpread(spec), fragments, toward, rvx, rvy, head.targetRadius, head.targeting.fireRange, CONE);
    // Above the deck, the ship's middle is deck it passes over: only the part counts, as for a careful gun.
    const careful = shipAim.clingsToFriend(ships, i, target, tb) || (part >= 0 && !shipAim.meetsWhole(ships, layers, target));
    const range = shipAim.fireRangeTo(ships, head.targeting, part, point, careful);
    const spreads = CONE.half === Infinity ? range : range * sin(min(CONE.half, 0.5 * PI));
    out.target = target;
    if (warheadSpread(spec) >= TAU) {
        out.half = Infinity;
        out.centre = toward;
    } else {
        const slack = shipAim.fireCone(ships, head.targeting, target, part, point, lead.x, lead.y, lead.t, spreads, careful);
        // That cone is where its fragments go as the target sees them come; its nose is
        // what turns, and at a burst no faster than it closes, a turn of the nose moves them less.
        const sight = atan2(point.y - out.y, point.x - out.x);
        noseCone(speed, rvx, rvy, toward, sight + ships.slackOffset, slack > 0 ? slack : 0, out);
    }
    out.range = range;
    out.reach = CONE.reach;
    const run = length2(point.x - out.x, point.y - out.y);
    out.closing = run > 0 ? (rvx * (point.x - out.x) + rvy * (point.y - out.y)) / run : 0;
    return true;
}

const CONE: FragmentCone = { centre: 0, half: 0, reach: 0 };

/** How many steps each way `noseCone` looks for the edge of the cone in, over a half turn. */
const NOSE_STEPS = 32;

/**
 * The nose bearings, about `lead`, whose middle fragment, leaving at `speed`
 * from a warhead moving at (`rvx`, `rvy`) relative to its target, goes
 * within `half` of `centre` as the target sees it: a gun's cone, measured
 * where the barrel turns. Into `out.centre` and `out.half`. Stepped out each
 * way to where it leaves, then halved down to the edge.
 */
function noseCone(speed: number, rvx: number, rvy: number, lead: number, centre: number, half: number, out: WarheadTrigger): void {
    let edges = 0;
    let lo = 0;
    let hi = 0;
    for (let side = -1; side <= 1; side += 2) {
        let inside = 0;
        let outside = PI;
        for (let k = 1; k <= NOSE_STEPS; k++) {
            const turn = (PI * k) / NOSE_STEPS;
            if (!within(speed, rvx, rvy, lead + side * turn, centre, half)) {
                outside = turn;
                break;
            }
            inside = turn;
        }
        for (let k = 0; k < 12 && outside < PI; k++) {
            const mid = 0.5 * (inside + outside);
            if (within(speed, rvx, rvy, lead + side * mid, centre, half)) inside = mid;
            else outside = mid;
        }
        if (inside >= PI) edges++;
        if (side < 0) lo = -inside;
        else hi = inside;
    }
    // Every way it could point, its middle fragment hits.
    if (edges === 2) {
        out.centre = lead;
        out.half = Infinity;
        return;
    }
    out.centre = lead + 0.5 * (lo + hi);
    out.half = within(speed, rvx, rvy, lead, centre, half) ? 0.5 * (hi - lo) : 0;
}

/** Whether the middle fragment of a burst pointed along `nose` goes within `half` of `centre`, as its target sees it. */
function within(speed: number, rvx: number, rvy: number, nose: number, centre: number, half: number): boolean {
    return abs(angleDelta(centre, atan2(rvy + speed * sin(nose), rvx + speed * cos(nose)))) <= half;
}

/**
 * The trigger warhead `w` of ship `i`, on body `b`, draws ahead, or behind
 * (`rear`), as a gun's wedge is drawn: about the bearing its lead says to
 * point it along, as wide as it may go off off that, out to its reach
 * (`warheadTrigger`). With nothing to go off at, its own spread the way it
 * points; a slug's backblast, none.
 */
export function warheadCone(ships: Ships, bodies: Bodies, i: number, b: number, w: number, out: FragmentCone, rear = false): FragmentCone {
    if (warheadTrigger(ships, bodies, i, b, w, TRIGGER, rear)) {
        out.centre = TRIGGER.centre;
        out.half = TRIGGER.half;
        out.reach = TRIGGER.reach;
        return out;
    }
    const design = ships.designs[i]!;
    const head = design.warheads[w]!;
    const spec = design.modules[head.module]!.spec;
    out.centre = bodies.angle[b]! + design.modules[head.module]!.angle + (rear ? PI : 0);
    out.half = head.spread >= TAU ? Infinity : head.spread / 2;
    // A slug's backblast draws no trigger.
    out.reach = rear && warheadFragments(spec) === 1 ? 0 : head.reach;
    return out;
}

/**
 * Set off warhead `m` of ship `i`, on body `b`: its casing thrown ahead,
 * behind and all round (`warheadBurst`), each fragment one way and its twin
 * the other, so they carry no momentum away from the hull. They hit what is
 * in their way, the ship that threw them included, and the warhead is gone.
 */
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
    const ox = placed.x * cos(angle) - placed.y * sin(angle);
    const oy = placed.x * sin(angle) + placed.y * cos(angle);
    const spin = bodies.angularVel[b]!;
    BLAST.x = bodies.x[b]! + ox;
    BLAST.y = bodies.y[b]! + oy;
    BLAST.vx = bodies.vx[b]! - spin * oy;
    BLAST.vy = bodies.vy[b]! + spin * ox;
    BLAST.px = 0;
    BLAST.py = 0;
    BLAST.home = shipAim.firedLayers(ships, i, b, design, m);
    const facing = angle + placed.angle;
    const n = burst.fragments;

    if (n === 1) {
        // A slug ahead, and a backblast behind with the opposite of its momentum.
        throwOne(projectiles, rng, i, b, m, facing, burst.speed, burst.each, true);
        for (let k = 0; k < WARHEAD_BACKBLAST_FRAGMENTS; k++) {
            throwOne(projectiles, rng, i, b, m, facing + PI + backblastBearing(k), burst.backSpeed, burst.backEach, false);
        }
    } else {
        // Across the spread ahead, each in its own slice of it, and its mirror behind.
        const all = burst.spread >= TAU;
        for (let k = 0; k < n; k++) {
            const slice = (k + rng.nextFloat()) / n;
            const heading = facing + (all ? slice * TAU : (slice - 0.5) * burst.spread);
            throwOne(projectiles, rng, i, b, m, heading, burst.speed, burst.each, false);
            throwOne(projectiles, rng, i, b, m, heading + PI, burst.backSpeed, burst.backEach, false);
        }
    }
    // All round outside the arcs, lighter and slower: across the gap each side, and the opposite way.
    if (burst.sideEach > 0) {
        const half = n === 1 ? 0 : 0.5 * burst.spread;
        const gap = PI - 2 * half;
        const pairs = WARHEAD_SIDE_FRAGMENTS / 2;
        for (let k = 0; k < pairs; k++) {
            const heading = facing + half + ((k + rng.nextFloat()) / pairs) * gap;
            throwOne(projectiles, rng, i, b, m, heading, burst.sideSpeed, burst.sideEach, false);
            throwOne(projectiles, rng, i, b, m, heading + PI, burst.sideSpeed, burst.sideEach, false);
        }
    }

    // What little their momentum does not cancel to, the hull keeps the other way.
    bodies.vx[b] = bodies.vx[b]! - BLAST.px * bodies.invMass[b]!;
    bodies.vy[b] = bodies.vy[b]! - BLAST.py * bodies.invMass[b]!;
    bodies.angularVel[b] = bodies.angularVel[b]! - (ox * BLAST.py - oy * BLAST.px) * bodies.invInertia[b]!;
    // The warhead is counted discarded when it goes, at its hull's velocity then;
    // its casing flew on, and is counted here instead, as it was before it flew.
    ships.discarded -= casing;
    ships.discardedPx -= casing * BLAST.vx;
    ships.discardedPy -= casing * BLAST.vy;
    ships.discardedL -= casing * (BLAST.x * BLAST.vy - BLAST.y * BLAST.vx);
    // And the warhead is gone.
    damage.absorb(b, m, SHATTER * damage.capacityOf(b, m) * 2);
    ships.thrown.add(blowKey(b, m));
    log?.push(BLAST.x, BLAST.y, burst.energy, IMPACT_BURST, undefined, -1, BLAST.vx, BLAST.vy, burst.speed);
}

/** Where a warhead going off is, how it moves, what it has thrown, and the layer it throws from. */
const BLAST = { x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0, home: 0 };

/**
 * Throw one fragment of `each` kg from the warhead at `BLAST` along
 * `heading` at `speed`, into a layer as a shell's fragments land
 * (`fragmentLayer`): passing through nothing of ship `i` but warhead `m`.
 */
function throwOne(
    projectiles: Projectiles,
    rng: World["rng"],
    i: number,
    b: number,
    m: number,
    heading: number,
    speed: number,
    each: number,
    lone: boolean,
): void {
    if (!(each > 0)) return;
    const ux = cos(heading) * speed;
    const uy = sin(heading) * speed;
    const round = projectiles.spawnRaw(
        BLAST.x,
        BLAST.y,
        BLAST.vx + ux,
        BLAST.vy + uy,
        pow(each / FRAGMENT_DENSITY, 1 / 3),
        WARHEAD_FRAGMENT_LIFE,
        each,
        0,
        0,
        b,
        0,
        m,
        fragmentLayer(BLAST.home, rng, lone),
    );
    projectiles.ship[round] = i;
    projectiles.fragment[round] = 1;
    BLAST.px += each * ux;
    BLAST.py += each * uy;
}
