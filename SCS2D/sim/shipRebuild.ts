import { Bodies } from "./bodies.js";
import { modulesOverlap, originOf, rebuiltDesign, sameOrigin, subDesign, type ShipDesign } from "./blueprint.js";
import { DamageEffect, REPAIR_ENERGY_PER_JOULE, REPAIR_WASTE } from "./damage.js";
import { faceToward, fittingOf, inFrame, SHELL_STEPS, shellOf } from "./rebuild.js";
import { Claim, mendClaim, Resource } from "./supply.js";
import { type ModuleSpec, type ModuleStats, ROBOT_REPAIR_RATE } from "./modules.js";
import { abs, angleDelta, min } from "./math.js";
import { neighbourOf, RobotMode, staysWhole } from "./robots.js";
import type { World } from "./world.js";
import { moduleOverlapsHull } from "./collision.js";
import { type Ships, movable, workforce, ROBOT_SPENT, NO_TARGET } from "./ships.js";
import * as shipSupply from "./shipSupply.js";
import * as shipBreakup from "./shipBreakup.js";

/**
 * Rebuilding a hull to its launch design and taking wreckage apart, which is
 * the same work run backwards: a shell grown a step at a time against a whole
 * module, or cut down a step at a time towards the face it was built from.
 */

/** What a module of wreckage being taken apart was whole, and how far down it has come. */
export interface StripShape {
    /** It whole, in its hull's frame. */
    readonly spec: ModuleSpec;
    readonly stats: ModuleStats;
    /** The face its walls go down towards. */
    readonly face: number;
    /** How much of its walls still stand. */
    readonly share: number;
}

/** A ship's hull matched to the design it set out as, for rebuilding what it has lost. */
export interface Rebuild {
    /** The hull this was worked out for. */
    readonly design: ShipDesign;
    /** Each launch module's index in the hull, or -1 for one it has lost. */
    readonly at: Int32Array;
    /** A hull module of the same compiled design as the launch, whole, for laying the rest out by; -1 for none. */
    readonly frame: number;
    /** Walls each launch module's next shell step has had, kg: kept while the hull is remade. */
    readonly work: Float64Array;
    /** Each hull module's launch module a refit fits out in its walls (`swapFor`), or -1; worked out when first asked. */
    swaps: Int32Array | null;
}

/** Whether two modules stand in the same place with walls of the same shape, whatever they are. */
function sameWalls(a: ModuleSpec, b: ModuleSpec): boolean {
    const near = (u: number, v: number): boolean => abs(u - v) <= 1e-6 * (1 + abs(u));
    if (!near(a.x, b.x) || !near(a.y, b.y) || !near(a.length, b.length) || !near(a.width, b.width)) return false;
    if (!(abs(angleDelta(a.angle ?? 0, b.angle ?? 0)) <= 1e-6)) return false;
    const va = a.vertices ?? [];
    const vb = b.vertices ?? [];
    return va.length === vb.length && va.every((v, k) => near(v, vb[k]!));
}

/** Put up every shell step finished since last asked (`grow`). */
export function growAll(ships: Ships, world: World): void {
    for (let k = 0; k < ships.grows.length; k += 5) {
        grow(ships, world, ships.grows[k]!, ships.grows[k + 1]!, ships.grows[k + 2]!, ships.grows[k + 3]!, ships.grows[k + 4]!);
    }
    ships.grows.length = 0;
}

/** Ship `i`'s hull matched to its launch design, worked out again when the hull has changed. */
export function rebuildFor(ships: Ships, i: number, design: ShipDesign): Rebuild {
    const known = ships.rebuilds[i];
    if (known !== null && known !== undefined && known.design === design) return known;
    const launch = ships.launched[i]!;
    const at = new Int32Array(launch.modules.length).fill(-1);
    for (let l = 0; l < launch.modules.length; l++) {
        for (let m = 0; m < design.modules.length; m++) {
            if (sameOrigin(launch, l, design, m)) {
                at[l] = m;
                break;
            }
        }
    }
    const compiled = originOf(launch, 0).design;
    let frame = -1;
    for (let m = 0; m < design.modules.length && frame < 0; m++) {
        if (design.modules[m]!.shell === undefined && originOf(design, m).design === compiled) frame = m;
    }
    const rebuild = { design, at, frame, work: known?.work ?? new Float64Array(launch.modules.length), swaps: null };
    ships.rebuilds[i] = rebuild;
    return rebuild;
}

/** Whether anything of hull `design` stands where launch module `l` of `launch` would be built. */
export function inTheWay(design: ShipDesign, rebuild: Rebuild, launch: ShipDesign, l: number): boolean {
    const origin = originOf(launch, l);
    const reference = originOf(design, rebuild.frame);
    const placed = inFrame(
        origin.design.modules[origin.module]!.spec,
        reference.design.modules[reference.module]!.spec,
        design.modules[rebuild.frame]!.spec,
    );
    for (const module of design.modules) if (modulesOverlap(module.spec, placed)) return true;
    return false;
}

/**
 * Put up the next step of the walls of launch module `l` of ship `i`, built
 * from module `from` of its hull, once robots or a pad have put the work in
 * and the piece of hull `payer` is on can pay for the metal: a shell first laid against `from`,
 * growing across the module, and at its last step the module itself, whole
 * but for its fittings. Not while anything else is in the way of it. The
 * payer is on body `payB`, the carrier a fighter is parked on, or -1 for its own.
 */
export function grow(ships: Ships, world: World, i: number, l: number, from: number, payer = from, payB = -1): void {
    const bodies = world.bodies;
    const b = bodies.indexOf(ships.bodyIds[i]!);
    const p = b < 0 ? -1 : ships.shipAt(bodies, b);
    if (p < 0) return;
    const design = ships.designs[p]!;
    const rebuild = rebuildFor(ships, i, design);
    const origin = originOf(ships.launched[i]!, l);
    const whole = origin.design.modules[origin.module]!;
    const wall = whole.stats.structureMass / SHELL_STEPS;
    if (!(rebuild.work[l]! >= wall) || from >= design.modules.length) return;
    const was = rebuild.at[l]!;
    const shell = was < 0 ? null : design.modules[was]!.shell;
    if (was >= 0 && shell === undefined) return;
    // Laid out by a whole module of its design, or by where its own walls say it goes.
    let placed = shell?.placed;
    if (rebuild.frame >= 0) {
        const reference = originOf(design, rebuild.frame);
        placed = inFrame(whole.spec, reference.design.modules[reference.module]!.spec, design.modules[rebuild.frame]!.spec);
    }
    if (placed === undefined) return;
    const face = shell?.face ?? faceToward(placed, design.modules[from]!.spec);
    const share = min(1, (shell?.share ?? 0) + 1 / SHELL_STEPS);
    const at = was < 0 ? design.modules.length : was;
    const piece = design.pieces?.[was < 0 ? from : was] ?? 0;
    let next: ShipDesign;
    if (share >= 1 - 1e-9) {
        next = rebuiltDesign(design, at, placed, whole.stats, origin, null, piece);
    } else {
        const part = shellOf(placed, whole.stats, face, share);
        next = rebuiltDesign(design, at, part.spec, part.stats, origin, { share, face, placed }, piece);
    }

    // Refitted, it waits for anything of its own hull in the way to come down.
    if (ships.refitting[i] === 1) {
        for (let k = 0; k < next.modules.length; k++) {
            if (k !== at && modulesOverlap(next.modules[k]!.spec, next.modules[at]!.spec)) return;
        }
    }

    // Where the hull will be, and whether anything else is.
    const offset = shipBreakup.offsetOf(bodies, b, design, next);
    const x = bodies.x[b]! + offset.x;
    const y = bodies.y[b]! + offset.y;
    for (let j = 0; j < bodies.highWater; j++) {
        // A fighter on a pad is in nothing's way on its own carrier.
        if (j === b || bodies.alive[j] === 0 || bodies.ghost[j] === 1 || !ships.meets(b, j)) continue;
        const other = ships.designOf(j);
        if (other !== null && moduleOverlapsHull(next, at, x, y, bodies.angle[b]!, bodies, j, other)) return;
    }
    const cost = wall * (1 + REPAIR_WASTE);
    if (payB >= 0) {
        // On a pad, paid for by the carrier, which carries it.
        if (shipSupply.allowed(ships, Resource.Metal, payB, payer, Claim.Pads, cost) < cost) return;
        const carried = bodies.mass[payB]!;
        const turning = bodies.inertia[payB]!;
        shipSupply.took(ships, Resource.Metal, payB, payer, Claim.Pads, ships.metal.drain(payB, payer, cost));
        rebuild.work[l] = 0;
        regrow(ships, world, p, b, design, next, at, i);
        if (share >= 1 - 1e-9) ships.damage.unfit(b, at, fittingOf(whole.stats));
        shipBreakup.settleMass(ships, bodies, b);
        shipBreakup.settleMass(ships, bodies, payB);
        shipBreakup.discardFrom(ships, bodies, payB, carried, turning);
        return;
    }
    const claim = mendClaim(origin.design, origin.module);
    if (shipSupply.allowed(ships, Resource.Metal, b, payer, claim, cost) < cost) return;

    shipBreakup.momentum(ships, bodies);
    const beforeX = ships.momentumX;
    const beforeY = ships.momentumY;
    const mass = bodies.mass[b]!;
    const inertia = bodies.inertia[b]!;
    shipSupply.took(ships, Resource.Metal, b, payer, claim, ships.metal.drain(b, payer, cost));
    rebuild.work[l] = 0;
    regrow(ships, world, p, b, design, next, at, i);
    if (share >= 1 - 1e-9) ships.damage.unfit(b, at, fittingOf(whole.stats));
    shipBreakup.settleMass(ships, bodies, b);
    // What it wasted left at the hull's speed; the hull's centre moved, and the
    // momentum it had with it.
    shipBreakup.discardFrom(ships, bodies, b, mass, inertia);
    shipBreakup.momentum(ships, bodies);
    bodies.vx[b] = bodies.vx[b]! + (beforeX - ships.momentumX) / movable(bodies.mass[b]!);
    bodies.vy[b] = bodies.vy[b]! + (beforeY - ships.momentumY) / movable(bodies.mass[b]!);
    // Robots about to start it are building it now, standing on it.
    for (const robot of ships.robots.on(b) ?? []) {
        if (robot.build === l && ships.pilotAt(b, robot.bay) === i) {
            robot.build = -1;
            robot.target = at;
            if (robot.mode === RobotMode.Working) robot.at = at;
        }
    }
}

/**
 * Make body `b`, primary `p`, carry `next`: its design with module `at` put
 * in or replaced, every other module where it was. Everything aboard stays
 * as it was, robots included; a module new to the hull is ship `builder`'s.
 */
export function regrow(
    ships: Ships,
    world: World,
    p: number,
    b: number,
    was: ShipDesign,
    next: ShipDesign,
    at: number,
    builder: number,
): void {
    const bodies = world.bodies;
    const id = ships.bodyIds[p]!;
    const offset = shipBreakup.offsetOf(bodies, b, was, next);
    const spin = bodies.angularVel[b]!;
    bodies.x[b] = bodies.x[b]! + offset.x;
    bodies.y[b] = bodies.y[b]! + offset.y;
    bodies.vx[b] = bodies.vx[b]! - spin * offset.y;
    bodies.vy[b] = bodies.vy[b]! + spin * offset.x;
    bodies.setMass(id, next.mass);
    bodies.setInertia(id, next.inertia);
    bodies.radius[b] = next.radius;
    const n = was.modules.length;
    const pilots = ships.pilots[b];
    if (pilots !== null && pilots !== undefined && at >= n) {
        const more = new Int32Array(next.modules.length);
        more.set(pilots);
        more[at] = builder;
        ships.pilots[b] = more;
    }
    shipBreakup.adopt(
        ships,
        p,
        b,
        next,
        () => p,
        (m) => (m < n ? m : -1),
        true,
        true,
        builder,
    );
    for (const r of ships.ridersOf(bodies, b)) if (r !== p) ships.board(r, p);
}

/** Whether module `m` of body `b` is of a ship one of ship `owner`'s slipways is building. */
export function buildingFor(ships: Ships, owner: number, b: number, m: number): boolean {
    const f = ships.pilotAt(b, m);
    if (f < 0 || f === owner || ships.unfinished[f] !== 1) return false;
    for (const seam of ships.hullDesign[b]?.seams ?? []) {
        if (seam.dock === "slipway" && ships.pilotAt(b, seam.a) === owner && ships.pilotAt(b, seam.b) === f) return true;
    }
    return false;
}

/**
 * Whether module `m` of body `b` is wreckage to ship `i`: hull nobody flies,
 * or that a ship with no control flies and no robots of its own are mending,
 * or a piece of ship `i`'s own body it hooked on rather than set out with.
 * Never a ship still under control, friend or foe.
 */
export function wreckage(ships: Ships, i: number, b: number, m: number): boolean {
    const owner = ships.pilots[b]?.[m] ?? i;
    if (owner === i) {
        const hull = ships.hullDesign[b];
        const pieces = hull?.pieces;
        if (pieces !== undefined) {
            const own = ownPiece(ships, i, b);
            if (own >= 0 && pieces[m] !== own) return true;
        }
        // Refitted, what is no module of the design it is refitted to comes down.
        return ships.refitting[i] === 1 && hull !== null && hull !== undefined && originOf(hull, m).design !== ships.launched[i];
    }
    if (owner < 0 || ships.alive[owner] === 0 || ships.derelict[owner] === 1) return true;
    // Being built on a pad or slipway, it has no working core or robots yet, and is not wreckage for that.
    if (ships.unfinished[owner] === 1) return false;
    return !ships.hasControl(owner) && !hasRobots(ships, b, owner);
}

/** The piece of body `b` ship `i` is flown from: that of a core of its own, a working one first. */
export function ownPiece(ships: Ships, i: number, b: number): number {
    const design = ships.hullDesign[b]!;
    let first = -1;
    for (const core of design.cores) {
        if (!ships.ownsAt(i, b, core)) continue;
        if (ships.damage.remaining(b, core, DamageEffect.Control) > 0) return design.pieces?.[core] ?? 0;
        if (first < 0) first = design.pieces?.[core] ?? 0;
    }
    return first;
}

/**
 * Whether ship `s` has a robot on body `b` with the charge for a step's
 * work, or a piece of hull at module `from` that has charge to give one or
 * makes it.
 */
export function canStrip(ships: Ships, b: number, s: number, from: number, dt: number): boolean {
    const step = ROBOT_REPAIR_RATE * REPAIR_ENERGY_PER_JOULE * dt;
    let any = false;
    for (const robot of ships.robots.on(b) ?? []) {
        if (ships.pilotAt(b, robot.bay) !== s) continue;
        if (robot.charge >= step) return true;
        any = true;
    }
    return any && (ships.power.pieceHeld(b, from) >= step || ships.power.pieceGeneration(b, from, ships.damage) > 0);
}

/** Whether module `m` of body `b` is a core, bay or generator of ship `owner`'s own that a refit is taking down. */
export function ownWorkforce(ships: Ships, owner: number, b: number, design: ShipDesign, m: number): boolean {
    return (
        ships.refitting[owner] === 1 &&
        ships.pilotAt(b, m) === owner &&
        workforce(design.modules[m]!.spec.kind) &&
        wreckage(ships, owner, b, m)
    );
}

/** Whether ship `owner` has anything of its own hull but cores, bays and generators left for its refit to take down. */
export function anyPlainWreckage(ships: Ships, owner: number, b: number, design: ShipDesign): boolean {
    if (ships.refitting[owner] !== 1) return false;
    for (let m = 0; m < design.modules.length; m++) {
        if (ships.pilotAt(b, m) !== owner || workforce(design.modules[m]!.spec.kind)) continue;
        if (wreckage(ships, owner, b, m) && comesOff(ships, owner, b, design, m)) return true;
    }
    return false;
}

/**
 * Whether ship `owner`'s refit is ready to take down core, bay or generator
 * `m`: nothing else of its own left to come down first, and for a core or a
 * bay, another of its kind built, fitted out and working, a bay with robots
 * of its own, so it is flown and worked on to the end.
 */
export function due(ships: Ships, owner: number, b: number, design: ShipDesign, m: number): boolean {
    if (!ownWorkforce(ships, owner, b, design, m) || anyPlainWreckage(ships, owner, b, design)) return false;
    const kind = design.modules[m]!.spec.kind;
    if (kind === "generator") return true;
    const effect = kind === "core" ? DamageEffect.Control : DamageEffect.Tending;
    for (let k = 0; k < design.modules.length; k++) {
        if (k === m || design.modules[k]!.spec.kind !== kind || design.modules[k]!.shell !== undefined) continue;
        if (ships.pilotAt(b, k) !== owner || ships.damage.unbuiltAt(b, k) > 0 || !(ships.left(owner, b, k, effect) > 0)) continue;
        if (kind === "robotBay" && !(ships.robots.on(b) ?? []).some((robot) => robot.bay === k)) continue;
        return true;
    }
    return false;
}

/** Whether ship `s` has robots of its own on body `b`. */
export function hasRobots(ships: Ships, b: number, s: number): boolean {
    for (const robot of ships.robots.on(b) ?? []) if (ships.pilotAt(b, robot.bay) === s) return true;
    return false;
}

/** Whether module `m`, wreckage to ship `owner`, can come off: without cutting the rest loose, or refitted in place. */
export function comesOff(ships: Ships, owner: number, b: number, design: ShipDesign, m: number): boolean {
    return staysWhole(design, m) || swapFor(ships, owner, b, design, m) >= 0;
}

/**
 * The module of its refit's design ship `owner` fits out in the walls of
 * module `m` of its hull, or -1: one not yet built, where `m` stands, with
 * walls of the same shape and mass. `m` is then refitted in place, its
 * fittings out and the new ones in, rather than taken down and built again.
 */
export function swapFor(ships: Ships, owner: number, b: number, design: ShipDesign, m: number): number {
    if (ships.refitting[owner] !== 1 || ships.pilotAt(b, m) !== owner) return -1;
    const rebuild = rebuildFor(ships, owner, design);
    if (rebuild.swaps === null) {
        const swaps = new Int32Array(design.modules.length).fill(-1);
        rebuild.swaps = swaps;
        if (rebuild.frame >= 0) {
            const launch = ships.launched[owner]!;
            const reference = originOf(design, rebuild.frame);
            const taken = new Uint8Array(launch.modules.length);
            for (let k = 0; k < design.modules.length; k++) {
                const module = design.modules[k]!;
                if (module.shell !== undefined || ships.pilotAt(b, k) !== owner || !wreckage(ships, owner, b, k)) continue;
                for (let l = 0; l < launch.modules.length; l++) {
                    if (rebuild.at[l]! >= 0 || taken[l] === 1) continue;
                    const origin = originOf(launch, l);
                    const whole = origin.design.modules[origin.module]!;
                    const placed = inFrame(
                        whole.spec,
                        reference.design.modules[reference.module]!.spec,
                        design.modules[rebuild.frame]!.spec,
                    );
                    if (
                        !sameWalls(module.spec, placed) ||
                        !(abs(module.stats.structureMass - whole.stats.structureMass) <= 1e-6 * whole.stats.structureMass)
                    )
                        continue;
                    swaps[k] = l;
                    taken[l] = 1;
                    break;
                }
            }
        }
    }
    return rebuild.swaps[m] ?? -1;
}

/**
 * Make module `m` of body `b`, its fittings out, launch module `l` of ship
 * `i`'s refit: the same walls, its fittings still to go in.
 */
export function refitInPlace(ships: Ships, world: World, b: number, m: number, i: number, l: number): void {
    const bodies = world.bodies;
    const p = ships.shipAt(bodies, b);
    if (p < 0) return;
    const design = ships.designs[p]!;
    const rebuild = rebuildFor(ships, i, design);
    const origin = originOf(ships.launched[i]!, l);
    const whole = origin.design.modules[origin.module]!;
    const reference = originOf(design, rebuild.frame);
    const placed = inFrame(whole.spec, reference.design.modules[reference.module]!.spec, design.modules[rebuild.frame]!.spec);
    const next = rebuiltDesign(design, m, placed, whole.stats, origin, null, design.pieces?.[m] ?? 0);
    const out = ships.damage.unbuiltAt(b, m);

    shipBreakup.momentum(ships, bodies);
    const beforeX = ships.momentumX;
    const beforeY = ships.momentumY;
    const mass = bodies.mass[b]!;
    const inertia = bodies.inertia[b]!;
    regrow(ships, world, p, b, design, next, m, i);
    ships.damage.fit(b, m, out);
    ships.damage.unfit(b, m, fittingOf(whole.stats));
    shipBreakup.settleMass(ships, bodies, b);
    shipBreakup.discardFrom(ships, bodies, b, mass, inertia);
    shipBreakup.momentum(ships, bodies);
    bodies.vx[b] = bodies.vx[b]! + (beforeX - ships.momentumX) / movable(bodies.mass[b]!);
    bodies.vy[b] = bodies.vy[b]! + (beforeY - ships.momentumY) / movable(bodies.mass[b]!);
}

/**
 * Whether ship `owner` has wreckage on body `b` its robots could take apart,
 * one that can come off without cutting the rest loose (`staysWhole`), and
 * room in the holds on its piece of hull at module `into` to bring it home to.
 */
export function strippable(ships: Ships, owner: number, b: number, design: ShipDesign, into: number): boolean {
    const metalRoom = ships.metal.pieceRoom(b, into) > ROBOT_SPENT;
    const fuelRoom = ships.fuel.pieceRoom(b, into) > ROBOT_SPENT;
    if (!metalRoom && !fuelRoom) return false;
    for (let m = 0; m < design.modules.length; m++) {
        if (wreckage(ships, owner, b, m) && comesOff(ships, owner, b, design, m) && minable(design, m, metalRoom, fuelRoom)) return true;
    }
    return false;
}

/**
 * Whether a robot may take module `m` apart for what its bay has room for:
 * anything but a kernel, and rock only if it holds ore or ice the bay can
 * take. Any other wreckage is metal.
 */
export function minable(design: ShipDesign, m: number, metalRoom: boolean, fuelRoom: boolean): boolean {
    const spec = design.modules[m]!.spec;
    if (spec.kind === "kernel") return false;
    if (spec.kind !== "rock") return metalRoom;
    return (metalRoom && (spec.ore ?? 0) > 0) || (fuelRoom && (spec.ice ?? 0) > 0);
}

/**
 * Where taking module `m` of body `b` apart has got to: what it was whole,
 * how much of its walls stand, the face they go down towards, and the
 * metal the next step down holds, kg — its fittings, while it has any, and a
 * step of its walls, less what damage has shed of them.
 */
export function stripStep(ships: Ships, b: number, design: ShipDesign, m: number): StripShape & { kg: number } {
    const module = design.modules[m]!;
    const shape = ships.stripShapes.get(module.spec);
    const stats = module.stats;
    const dry = stats.structureMass + stats.fittingMass;
    const kept = dry > 0 ? 1 - ships.damage.shedAt(b, m) / dry : 0;
    const whole = shape?.stats ?? stats;
    const fittings = shape === undefined ? fittingOf(stats) : 0;
    const kg = (fittings + whole.structureMass / SHELL_STEPS) * (kept > 0 ? kept : 0);
    if (shape !== undefined) return { ...shape, kg };
    const face = faceToward(module.spec, design.modules[neighbourOf(design, m)]!.spec);
    return { spec: module.spec, stats, face, share: 1, kg };
}

/**
 * Take a step of module `m` of body `b` down, the work for it done: a
 * module's fittings and the first step of its walls, then each step after,
 * the shell shrinking towards the face it was built against as a rebuilt
 * one grows, and at the last, what is left of it off the hull (`takeApart`).
 */
export function stepDown(ships: Ships, world: World, b: number, m: number): void {
    const bodies = world.bodies;
    const p = ships.shipAt(bodies, b);
    if (p < 0) return;
    const design = ships.designs[p]!;
    if (m >= design.modules.length) return;
    const owner = ships.pilotAt(b, m);
    const l = owner < 0 ? -1 : swapFor(ships, owner, b, design, m);
    if (l >= 0) {
        refitInPlace(ships, world, b, m, owner, l);
        return;
    }
    if (!staysWhole(design, m)) return;
    const step = stripStep(ships, b, design, m);
    const share = step.share - 1 / SHELL_STEPS;
    if (!(share > 1e-9)) {
        takeApart(ships, world, b, m);
        return;
    }
    shipBreakup.settleShed(ships, bodies);
    const part = shellOf(step.spec, step.stats, step.face, share);
    const next = rebuiltDesign(design, m, part.spec, part.stats, originOf(design, m), { share, face: step.face }, design.pieces?.[m] ?? 0);
    ships.stripShapes.set(part.spec, { spec: step.spec, stats: step.stats, face: step.face, share });

    shipBreakup.momentum(ships, bodies);
    const beforeX = ships.momentumX;
    const beforeY = ships.momentumY;
    const mass = bodies.mass[b]!;
    const inertia = bodies.inertia[b]!;
    regrow(ships, world, p, b, design, next, m, p);
    // A smaller shell takes what damage it had as harder hit, but nothing was
    // destroyed under a robot working it: it takes its footing again.
    for (const robot of ships.robots.on(b) ?? []) if (robot.stoodOn === m) robot.stoodOn = -1;
    // What was taken off is already out of it, as fittings not in.
    ships.damage.fit(b, m, step.kg);
    shipBreakup.settleMass(ships, bodies, b);
    // Never more of it than there was: what the walls left had shed is lost.
    if (bodies.mass[b]! > mass) {
        ships.damage.unfit(b, m, bodies.mass[b]! - mass);
        shipBreakup.settleMass(ships, bodies, b);
    }
    shipBreakup.discardFrom(ships, bodies, b, mass, inertia);
    shipBreakup.momentum(ships, bodies);
    bodies.vx[b] = bodies.vx[b]! + (beforeX - ships.momentumX) / movable(bodies.mass[b]!);
    bodies.vy[b] = bodies.vy[b]! + (beforeY - ships.momentumY) / movable(bodies.mass[b]!);
}

/**
 * Take what is left of module `m` of body `b` off its hull, its last step
 * taken apart: anything still in it leaves the world. Robots on it step back
 * onto a neighbour. A ship with nothing left of it goes.
 */
export function takeApart(ships: Ships, world: World, b: number, m: number): void {
    const bodies = world.bodies;
    const p = ships.shipAt(bodies, b);
    if (p < 0) return;
    const design = ships.designs[p]!;
    if (m >= design.modules.length || design.modules.length < 2 || !staysWhole(design, m)) return;
    shipBreakup.settleShed(ships, bodies);

    const keep: number[] = [];
    for (let k = 0; k < design.modules.length; k++) if (k !== m) keep.push(k);
    const next = subDesign(design, keep);
    const after = (k: number): number => (k > m ? k - 1 : k);
    // Every robot where it was and about what it was about, renumbered; one on
    // what is coming away steps onto what it was reached across.
    const step = neighbourOf(design, m);
    for (const robot of ships.robots.on(b) ?? []) {
        // Out on a rock, only its bay is this hull's.
        if (robot.away >= 0) {
            robot.bay = after(robot.bay);
            continue;
        }
        if (robot.at === m) robot.at = step;
        robot.at = after(robot.at);
        robot.bay = after(robot.bay);
        robot.stoodOn = robot.stoodOn === m ? -1 : after(robot.stoodOn);
        if (robot.target === m) {
            robot.target = -1;
            robot.strip = false;
        } else if (robot.target > m) {
            robot.target--;
        }
        const path = robot.path;
        if (path !== null && path.includes(m)) {
            robot.path = null;
            robot.leg = 0;
            robot.along = 0;
        } else if (path !== null) {
            for (let k = 0; k < path.length; k++) path[k] = after(path[k]!);
        }
    }
    const riders = ships.ridersOf(bodies, b);

    shipBreakup.momentum(ships, bodies);
    const beforeX = ships.momentumX;
    const beforeY = ships.momentumY;
    const mass = bodies.mass[b]!;
    const inertia = bodies.inertia[b]!;
    const id = ships.bodyIds[p]!;
    const offset = shipBreakup.offsetOf(bodies, b, design, next);
    const spin = bodies.angularVel[b]!;
    bodies.x[b] = bodies.x[b]! + offset.x;
    bodies.y[b] = bodies.y[b]! + offset.y;
    bodies.vx[b] = bodies.vx[b]! - spin * offset.y;
    bodies.vy[b] = bodies.vy[b]! + spin * offset.x;
    bodies.setMass(id, next.mass);
    bodies.setInertia(id, next.inertia);
    bodies.radius[b] = next.radius;
    const pilots = ships.pilots[b];
    if (pilots !== null && pilots !== undefined) ships.pilots[b] = Int32Array.from(keep, (k) => pilots[k]!);
    shipBreakup.adopt(
        ships,
        p,
        b,
        next,
        () => p,
        (k) => keep[k]!,
        true,
        true,
    );
    for (const r of riders) if (r !== p) ships.board(r, p);
    renumber(ships, bodies, b, riders, m, p);
    // A ship riding here with none of its hull left is gone, and the body
    // passes to one that has some, if it was this one's.
    const left = ships.pilots[b];
    if (left !== null && left !== undefined) {
        for (const r of riders) {
            if (left.includes(r)) continue;
            if (ships.shipByBody[b] === r) {
                const heir = riders.find((o) => o !== r && left.includes(o));
                if (heir === undefined) continue;
                ships.shipByBody[b] = heir;
            }
            // Its mounts are the body's, still worked by whoever is left.
            ships.turretIndex[r] = new Int32Array(0);
            ships.remove(r);
        }
    }
    shipBreakup.settleMass(ships, bodies, b);
    shipBreakup.discardFrom(ships, bodies, b, mass, inertia);
    shipBreakup.momentum(ships, bodies);
    bodies.vx[b] = bodies.vx[b]! + (beforeX - ships.momentumX) / movable(bodies.mass[b]!);
    bodies.vy[b] = bodies.vy[b]! + (beforeY - ships.momentumY) / movable(bodies.mass[b]!);
}

/**
 * Module `m` of body `b` gone: every ship's note of a module past it there moves down one. The claw
 * of `adopted`, which `adopt` has already moved with its hull, is not moved again.
 */
export function renumber(ships: Ships, bodies: Bodies, b: number, riders: readonly number[], m: number, adopted: number): void {
    const down = (k: number): number => (k > m ? k - 1 : k === m ? -1 : k);
    for (const r of riders) if (ships.ownPort[r]! >= 0) ships.ownPort[r] = down(ships.ownPort[r]!);
    for (const r of riders) {
        if (r === adopted || ships.mooredClaw[r]! < 0) continue;
        const claw = down(ships.mooredClaw[r]!);
        if (claw >= 0) ships.mooredClaw[r] = claw;
        else ships.unpark(bodies, r, ships.now);
    }
    for (let s = 0; s < ships.alive.length; s++) {
        if (ships.alive[s] === 0) continue;
        const t = ships.salvaging[s]!;
        if (t === NO_TARGET || ships.alive[t] !== 1 || bodies.indexOf(ships.bodyIds[t]!) !== b) continue;
        if (ships.landingPad[s]! >= 0) ships.landingPad[s] = down(ships.landingPad[s]!);
        if (ships.dockPort[s]! >= 0) ships.dockPort[s] = down(ships.dockPort[s]!);
    }
}
