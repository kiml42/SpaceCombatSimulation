import { Bodies } from "./bodies.js";
import {
    aboardPose,
    footprintOf,
    modulesOverlap,
    originOf,
    rebuiltDesign,
    keptAs,
    remarkedDesign,
    seamedDesign,
    twinOf,
    subDesign,
    weldDesigns,
    type ShipDesign,
} from "./blueprint.js";
import { components } from "./connectivity.js";
import { HULL_LAYER, WEAPONS_LAYER } from "./hull.js";
import { DamageEffect, REPAIR_ENERGY_PER_JOULE, REPAIR_WASTE, repairWork } from "./damage.js";
import { buildWork, faceNearest, fittingOf, SHELL_STEPS, shellOf } from "./rebuild.js";
import { printedCraft, printFrame, printLength, SLIPWAY_STEP, type Print } from "./slipway.js";
import { Claim, Resource } from "./supply.js";
import { moduleOutline, type ModuleSpec, PAD_REPAIR_PER_AREA, SLIPWAY_BUILD_PER_METRE, SLIPWAY_PUSH } from "./modules.js";
import { geometryOf, plumeLayers, plumeRays } from "./exhaust.js";
import { abs, cos, min, sin } from "./math.js";
import { overriddenDoctrine } from "./doctrine.js";
import type { World } from "./world.js";
import type { SpatialGrid } from "./index.js";
import { moduleOverlapsHull } from "./collision.js";
import * as shipRebuild from "./shipRebuild.js";
import * as shipWeld from "./shipWeld.js";
import * as shipSupply from "./shipSupply.js";
import * as shipBreakup from "./shipBreakup.js";
import * as shipClaw from "./shipClaw.js";
import * as shipDocking from "./shipDocking.js";
import { type Ships, yardFor, repairTier, movable } from "./ships.js";

/**
 * Building ships: refits to a new design, carriers laying fighters down on their
 * pads, and slipways printing a ship a slice at a time and pushing it off.
 */

/**
 * Refit ship `i` to `to`, a design compiled from a blueprint: from now on it
 * builds to that rather than to what it set out as. A module of its hull
 * that is a module of `to` by key (`ShipDesign.keys`), laid out the same, is
 * kept as that module; the rest of its own hull comes down, and what `to`
 * has that it has not is built, as robots build back what a ship has lost,
 * building before taking down, and a wall waiting while anything of its own
 * hull is in the way. Its cores, robot bays and generators come down last
 * and go up first, and never the last of its cores or bays, so it is flown
 * and worked on throughout. Refused, saying why, when `to` keeps nothing of
 * the ship to build the rest against.
 */
export function refit(ships: Ships, world: World, i: number, to: ShipDesign): string | null {
    const bodies = world.bodies;
    ships.bodyStore = bodies;
    if (ships.alive[i] === 0) return "the ship is gone";
    const keys = to.keys;
    if (keys === undefined) return `${to.name} was not compiled from a blueprint`;
    const b = bodies.indexOf(ships.bodyIds[i]!);
    const p = b < 0 ? -1 : ships.shipAt(bodies, b);
    if (p < 0) return "the ship is gone";
    const design = ships.designs[p]!;
    const as = keptAs(
        design.modules.map((_, m) => {
            if (!ships.ownsAt(i, b, m)) return null;
            const from = originOf(design, m);
            const was = from.design.modules[from.module]!;
            return { key: from.design.keys?.[was.index], spec: was.spec };
        }),
        to.modules.map((module) => ({ key: keys[module.index], spec: module.spec })),
    );
    let kept = 0;
    const origins = as.map((k) => {
        if (k < 0) return null;
        kept++;
        return { design: to, module: k };
    });
    if (kept === 0) return `${to.name} keeps nothing of this ship to build the rest against`;
    shipBreakup.adopt(
        ships,
        p,
        b,
        remarkedDesign(design, origins),
        () => p,
        (m) => m,
        true,
        true,
    );
    for (const r of ships.ridersOf(bodies, b)) if (r !== p) ships.board(r, p);
    ships.launched[i] = to;
    ships.rebuilds[i] = null;
    // What its robots were building is numbered by the design it no longer has.
    for (const robot of ships.robots.on(b) ?? []) if (ships.pilotAt(b, robot.bay) === i) robot.build = -1;
    ships.ownDoctrines[i] = to.doctrine;
    ships.doctrines[i] = overriddenDoctrine(to.doctrine, ships.overrides[i]);
    ships.mountDoctrines[i] = null;
    ships.couldFight[i] = to.turrets.some((t) => t.main) || to.engines.length > 0 ? 1 : 0;
    buildsFor(ships, i, to);
    ships.refitting[i] = 1;
    return null;
}

/**
 * What ship `i`'s pads and slipways build, as design `design` says: the one
 * it was launched as, not the slice of it a slipway or pad began with.
 */
export function buildsFor(ships: Ships, i: number, design: ShipDesign): void {
    const builds = design.builds ?? [];
    ships.broods[i] = builds.length === 0 ? null : { fighters: builds.map(() => []), work: new Float64Array(builds.length) };
    ships.yards[i] = yardFor(design);
}

/**
 * Lay down a fighter on every free pad keeping fewer in the fight than its
 * `keep`: the walls of its core, a shell's first step, laid on the pad
 * where a fighter set out docked would lie, from the face nearest the
 * carrier's middle. Its pad builds the rest as it builds back what a
 * landed fighter has lost (`padBuild`), and holds it until it is whole.
 *
 * Only while the carrier is under control, and never while a fighter of
 * its side is making for the pad: one coming in for fuel matters more than
 * one not yet begun.
 */
export function build(ships: Ships, world: World): void {
    ships.tick = world.tick;
    const bodies = world.bodies;
    ships.bodyStore = bodies;
    for (let i = 0; i < ships.alive.length; i++) {
        const brood = ships.broods[i];
        const yard = ships.yards[i];
        if ((brood === null || brood === undefined) && (yard === null || yard === undefined)) continue;
        if (!ships.hasControl(i)) continue;
        const b = bodies.indexOf(ships.bodyIds[i]!);
        // One still held by the slipway building it builds nothing until it is let go.
        if (b < 0 || ships.damage.isProtected(b) || ships.onSlipway(i, b)) continue;
        const design = ships.designs[i]!;
        const rebuild = shipRebuild.rebuildFor(ships, i, design);
        ships.waitsOnWreck[i] = 0;
        for (let k = 0; yard !== null && yard !== undefined && k < yard.building.length; k++) print(ships, world, i, b, rebuild.at, k);
        if (brood === null || brood === undefined) continue;
        const builds = ships.launched[i]!.builds!;
        for (let k = 0; k < builds.length; k++) {
            const order = builds[k]!;
            const pad = rebuild.at[order.pad]!;
            if (pad < 0 || !ships.ownsAt(i, b, pad)) continue;
            if (fielded(ships, bodies, i, brood.fighters[k]!) >= ships.keepFor(i, order.pad, order.keep)) continue;
            if (!shipDocking.padFree(ships, bodies, i, pad) || awaited(ships, i, pad)) continue;
            if (!mayBuild(ships, i, b, ships.launched[i]!.modules[order.pad]!.spec)) continue;
            layDown(ships, world, i, b, design, pad, k, ships.craftFor(i, order.pad, order.design));
        }
    }
}

/**
 * Put a step of slipway `k`'s work into the next slice of the ship it
 * builds, at `SLIPWAY_BUILD_PER_METRE` and the price robots build at, and
 * build the slice once the work is in and the metal is on the slipway's
 * piece of hull: the ship's first slice, short of the ships it keeps,
 * spawned and held against the slipway's face, and every later one pushing
 * it out by `SLIPWAY_STEP` (`reprint`). Its walls all up, the slipway fits
 * it out, fills it and lets it go (`pump`).
 */
export function print(ships: Ships, world: World, i: number, b: number, at: ArrayLike<number>, k: number): void {
    const bodies = world.bodies;
    const yard = ships.yards[i]!;
    const order = ships.launched[i]!.yards![k]!;
    const slipway = at[order.slipway]!;
    if (slipway < 0 || !ships.ownsAt(i, b, slipway)) return;
    if (!mayBuild(ships, i, b, ships.launched[i]!.modules[order.slipway]!.spec)) return;
    let f = yard.building[k]!;
    // Gone, or let go: the slipway is free for the next, and one let go is pushed off.
    if (f >= 0 && (ships.alive[f] === 0 || bodies.indexOf(ships.bodyIds[f]!) !== b)) {
        if (ships.alive[f] === 1) pushOff(ships, bodies, i, b, f, slipway);
        yard.building[k] = -1;
        ships.printing[f] = 0;
        f = -1;
    }
    if (f < 0 && fielded(ships, bodies, i, yard.ships[k]!) >= ships.keepFor(i, order.slipway, order.keep)) return;
    // One already on the slipway is finished as it was begun.
    if (f < 0) {
        const chosen = ships.craftFor(i, order.slipway, order.design);
        yard.craft[k] = chosen === ships.launched[i] ? twinOf(chosen) : chosen;
    }
    const craft = yard.craft[k] ?? order.design;
    const berth = ships.launched[i]!.modules[order.slipway]!.spec;
    const length = printLength(craft, berth);
    const depth = f < 0 ? 0 : yard.depth[k]!;
    if (f >= 0 && ships.printing[f] !== 1) return;
    const deeper = min(length, depth + SLIPWAY_STEP);
    const next = printedCraft(craft, berth, deeper);
    if (next === null) return;
    const before = f < 0 ? null : printedCraft(craft, berth, depth);

    // What the slice weighs, and the work it takes, module by module.
    let kg = 0;
    let joules = 0;
    const had = new Map<number, number>();
    before?.modules.forEach((m, d) => had.set(m, before.design.modules[d]!.stats.structureMass));
    next.modules.forEach((m, d) => {
        const more = next.design.modules[d]!.stats.structureMass - (had.get(m) ?? 0);
        kg += more;
        joules += more * buildWork(craft.modules[m]!.stats);
    });
    const working = ships.left(i, b, slipway, DamageEffect.Grip);
    const width = ships.designs[i]!.modules[slipway]!.spec.width;
    // What is at the face is finished before the next slice pushes it out of reach.
    if (f >= 0) {
        const busy = tendAtFace(ships, bodies, b, f, slipway, SLIPWAY_BUILD_PER_METRE * width * working * world.dt);
        if (busy) ships.builtAt[i] = world.tick;
        if (busy || atFace(ships, b, f, slipway)) return;
    }
    const charge = shipSupply.allowed(
        ships,
        Resource.Charge,
        b,
        slipway,
        Claim.Slipway,
        (joules - yard.work[k]!) * REPAIR_ENERGY_PER_JOULE,
    );
    const put = min(min(SLIPWAY_BUILD_PER_METRE * width * working * world.dt, joules - yard.work[k]!), charge / REPAIR_ENERGY_PER_JOULE);
    if (put > 0) {
        yard.work[k] = yard.work[k]! + put;
        shipSupply.took(ships, Resource.Charge, b, slipway, Claim.Slipway, ships.power.drain(b, slipway, put * REPAIR_ENERGY_PER_JOULE));
        ships.builtAt[i] = world.tick;
    }
    const cost = kg * (1 + REPAIR_WASTE);
    // What the slice will cost is set aside for it while its work goes in.
    const metal = shipSupply.allowed(ships, Resource.Metal, b, slipway, Claim.Slipway, cost);
    if (yard.work[k]! < joules) return;
    if (metal < cost) return;
    if (f < 0) {
        f = layKeel(ships, world, i, b, slipway, craft, next, deeper);
        if (f < 0) return;
        yard.building[k] = f;
        yard.ships[k]!.push(f);
    } else if (!reprint(ships, world, b, f, slipway, craft, next, deeper)) return;
    yard.work[k] = 0;
    yard.depth[k] = deeper;
    if (deeper >= length) ships.printing[f] = 0;
    const mass = bodies.mass[b]!;
    const inertia = bodies.inertia[b]!;
    shipSupply.took(ships, Resource.Metal, b, slipway, Claim.Slipway, ships.metal.drain(b, slipway, cost));
    shipBreakup.settleMass(ships, bodies, b);
    // What it wasted left at the hull's speed.
    shipBreakup.discardFrom(ships, bodies, b, mass, inertia);
}

/**
 * The module of ship `f`, being built on slipway `slipway` of body `b`, that
 * the slipway can reach and is not yet whole, fittings and all; -1 for none.
 * It reaches only what lies within a step of its face: what the slice just
 * built finished, and what the next pushes out. Cores first.
 */
export function atFaceIndex(ships: Ships, b: number, f: number, slipway: number): number {
    const design = ships.hullDesign[b]!;
    const spec = design.modules[slipway]!.spec;
    const angle = spec.angle ?? 0;
    const c = cos(angle);
    const s = sin(angle);
    const face = spec.length / 2 + SLIPWAY_STEP + 1e-6;
    const corners = ships.faceCorners;
    let best = -1;
    let bestTier = Infinity;
    const approach = ships.doctrines[f]!.approach;
    for (let m = 0; m < design.modules.length; m++) {
        if (ships.pilotAt(b, m) !== f) continue;
        if (!(ships.damage.unbuiltAt(b, m) > 0) && !(ships.damage.absorbedAt(b, m) > 0)) continue;
        const count = moduleOutline(design.modules[m]!.spec, corners);
        let near = Infinity;
        for (let v = 0; v < count; v++) near = min(near, (corners[v * 2]! - spec.x) * c + (corners[v * 2 + 1]! - spec.y) * s);
        if (near > face) continue;
        const tier = repairTier(approach, design, m);
        if (tier < bestTier) {
            best = m;
            bestTier = tier;
        }
    }
    return best;
}

/** Whether the slipway has anything of ship `f` at its face still to fit or mend. */
export function atFace(ships: Ships, b: number, f: number, slipway: number): boolean {
    return atFaceIndex(ships, b, f, slipway) >= 0;
}

/**
 * Put up to `joules` of slipway `slipway`'s work into what of ship `f` is at
 * its face and not yet whole: its fittings, then its damage, from the metal
 * and charge on the slipway's piece of hull at robots' prices. Says whether
 * it did any.
 */
export function tendAtFace(ships: Ships, bodies: Bodies, b: number, f: number, slipway: number, joules: number): boolean {
    const m = atFaceIndex(ships, b, f, slipway);
    if (m < 0 || !(joules > 0)) return false;
    const stats = ships.hullDesign[b]!.modules[m]!.stats;
    const mass = bodies.mass[b]!;
    const inertia = bodies.inertia[b]!;
    const waste = 1 + REPAIR_WASTE;
    if (ships.damage.unbuiltAt(b, m) > 0) {
        const work = buildWork(stats);
        const perKg = work * REPAIR_ENERGY_PER_JOULE;
        const most = min(joules / work, ships.damage.unbuiltAt(b, m));
        const charge = shipSupply.allowed(ships, Resource.Charge, b, slipway, Claim.Slipway, most * perKg);
        const metal = shipSupply.allowed(ships, Resource.Metal, b, slipway, Claim.Slipway, most * waste);
        const kg = min(min(joules / work, charge / perKg), metal / waste);
        const put = ships.damage.fit(b, m, kg);
        if (!(put > 0)) return false;
        shipSupply.took(ships, Resource.Metal, b, slipway, Claim.Slipway, ships.metal.drain(b, slipway, put * waste));
        shipSupply.took(ships, Resource.Charge, b, slipway, Claim.Slipway, ships.power.drain(b, slipway, put * perKg));
    } else {
        shipBreakup.settleShed(ships, bodies);
        const work = repairWork(stats);
        const most = joules / work;
        const charge = shipSupply.allowed(ships, Resource.Charge, b, slipway, Claim.Slipway, most * work * REPAIR_ENERGY_PER_JOULE);
        let undo = min(most, charge / (work * REPAIR_ENERGY_PER_JOULE));
        const kg = ships.damage.repairMetal(b, m, undo) * waste;
        const metal = shipSupply.allowed(ships, Resource.Metal, b, slipway, Claim.Slipway, ships.damage.repairMetal(b, m, most) * waste);
        if (kg > metal) undo *= metal / kg;
        const cost = ships.damage.repairMetal(b, m, undo) * waste;
        const undone = ships.damage.repair(b, m, undo);
        if (!(undone > 0)) return false;
        ships.fuel.seal(b, m);
        if (cost > 0) shipSupply.took(ships, Resource.Metal, b, slipway, Claim.Slipway, ships.metal.drain(b, slipway, cost));
        shipSupply.took(
            ships,
            Resource.Charge,
            b,
            slipway,
            Claim.Slipway,
            ships.power.drain(b, slipway, undone * work * REPAIR_ENERGY_PER_JOULE),
        );
    }
    shipBreakup.settleMass(ships, bodies, b);
    shipBreakup.discardFrom(ships, bodies, b, mass, inertia);
    return true;
}

/**
 * Push ship `f`, just let go by slipway `slipway` of builder `i`'s body `b`,
 * off along the slipway's facing at `SLIPWAY_PUSH` relative to its builder,
 * each moving as its share of the mass says, as a stage separates. Its
 * engines stay off, from when it is let go, until they would not burn the
 * ship that built it (`flyOne`).
 */
export function pushOff(ships: Ships, bodies: Bodies, i: number, b: number, f: number, slipway: number): void {
    const fb = bodies.indexOf(ships.bodyIds[f]!);
    if (fb < 0) return;
    const angle = bodies.angle[b]! + (ships.designs[i]!.modules[slipway]!.spec.angle ?? 0);
    const dx = cos(angle);
    const dy = sin(angle);
    // A builder anchored to a rock is pinned, and weighs nothing to this: it does not move.
    const mb = movable(bodies.mass[b]!);
    const mf = movable(bodies.mass[fb]!);
    const impulse = mb === Infinity ? SLIPWAY_PUSH * mf : (SLIPWAY_PUSH * mb * mf) / (mb + mf);
    bodies.vx[fb] = bodies.vx[fb]! + (impulse / mf) * dx;
    bodies.vy[fb] = bodies.vy[fb]! + (impulse / mf) * dy;
    bodies.vx[b] = bodies.vx[b]! - (impulse / mb) * dx;
    bodies.vy[b] = bodies.vy[b]! - (impulse / mb) * dy;
}

/** Whether any of ship `i`'s engines, at full throttle, would play on body `target`. */
export function wouldBurn(ships: Ships, bodies: Bodies, grid: SpatialGrid, i: number, target: number): boolean {
    const design = ships.designs[i]!;
    const b = bodies.indexOf(ships.bodyIds[i]!);
    if (b < 0) return false;
    for (let t = 0; t < design.engines.length; t++) {
        const force = ships.exhaustOf(i, design, b, t);
        if (!(force > 0)) continue;
        const engine = design.modules[design.engines[t]?.module ?? -1];
        const rays = engine === undefined ? 0 : plumeRays(geometryOf(engine));
        const layers = plumeLayers(design, t, ships.layersOf(b));
        for (let layer = HULL_LAYER; layer <= WEAPONS_LAYER; layer <<= 1) {
            if ((layers & layer) === 0) continue;
            for (let ray = 0; ray < rays; ray++) {
                if (ships.plumes.cast(design, t, ray, force, bodies, b, grid, ships.hulls, layer) && ships.plumes.body === target)
                    return true;
            }
        }
    }
    return false;
}

/**
 * Spawn the first slice of `craft` against slipway `slipway` of builder
 * `i`'s body `b`, and hold it there: a ship being built, which is one in
 * all but its parts. Its index, or -1 while anything is in its way.
 */
export function layKeel(
    ships: Ships,
    world: World,
    i: number,
    b: number,
    slipway: number,
    craft: ShipDesign,
    print: Print,
    depth: number,
): number {
    const bodies = world.bodies;
    const hull = ships.designs[i]!;
    const frame = printFrame(hull.modules[slipway]!.spec, craft, depth);
    const c = cos(frame.angle);
    const s = sin(frame.angle);
    const seed = print.design;
    // Its centre in the hull's blueprint frame, and then in the world.
    const hx = frame.dx + seed.centreOfMassX * c - seed.centreOfMassY * s - hull.centreOfMassX;
    const hy = frame.dy + seed.centreOfMassX * s + seed.centreOfMassY * c - hull.centreOfMassY;
    const angle = bodies.angle[b]!;
    const ca = cos(angle);
    const sa = sin(angle);
    const x = bodies.x[b]! + hx * ca - hy * sa;
    const y = bodies.y[b]! + hx * sa + hy * ca;
    for (let j = 0; j < bodies.highWater; j++) {
        if (j === b || bodies.alive[j] === 0 || bodies.ghost[j] === 1 || !ships.meets(b, j)) continue;
        const other = ships.designOf(j);
        if (other === null) continue;
        for (let m = 0; m < seed.modules.length; m++) {
            if (moduleOverlapsHull(seed, m, x, y, angle + frame.angle, bodies, j, other)) return -1;
        }
    }
    const spin = bodies.angularVel[b]!;
    const f = ships.spawn(world, {
        design: seed,
        x,
        y,
        angle: angle + frame.angle,
        vx: bodies.vx[b]! - spin * (y - bodies.y[b]!),
        vy: bodies.vy[b]! + spin * (x - bodies.x[b]!),
        angularVel: spin,
        team: ships.team[i]!,
    });
    ships.launched[f] = craft;
    buildsFor(ships, f, craft);
    ships.couldFight[f] = craft.turrets.some((t) => t.main) || craft.engines.length > 0 ? 1 : 0;
    ships.unfinished[f] = 1;
    ships.printing[f] = 1;
    shipWeld.merge(ships, world, i, f, slipway, print.held[0]!, { at: "a", kind: "slipway" });
    ships.home[f] = i;
    // Held by every piece, the first by the seam it was welded on with.
    if (print.held.length > 1) reprint(ships, world, b, f, slipway, craft, print, depth);
    return f;
}

/**
 * Make what ship `f`, being built on slipway `slipway` of body `b`, has of `craft` into `print`, built to `depth`: its modules taken out
 * of the hull and put back as `print` lays them, pushed out from the face,
 * each piece held by the slipway. Everything else aboard as it was. False,
 * changing nothing, while anything is in the way of where it goes.
 */
export function reprint(
    ships: Ships,
    world: World,
    b: number,
    f: number,
    slipway: number,
    craft: ShipDesign,
    print: Print,
    depth: number,
): boolean {
    const bodies = world.bodies;
    const p = ships.shipAt(bodies, b);
    if (p < 0) return false;
    const was = ships.designs[p]!;
    const keep: number[] = [];
    const old = new Map<number, number>();
    for (let m = 0; m < was.modules.length; m++) {
        if (ships.pilotAt(b, m) === f) old.set(originOf(was, m).module, m);
        else keep.push(m);
    }
    const n = keep.length;
    const at = keep.indexOf(slipway);
    if (at < 0) return false;
    // Anything caught on it alone would be left hanging on nothing: it waits for that to be taken apart.
    if (components(subDesign(was, keep), () => false).length > 1) {
        const builder = ships.pilotAt(b, slipway);
        if (builder >= 0) ships.waitsOnWreck[builder] = 1;
        return false;
    }
    const frame = printFrame(was.modules[slipway]!.spec, craft, depth);
    const width = was.modules[slipway]!.spec.width;
    const held = print.held.map((h) => ({ a: at, b: n + h, width, dock: "slipway" as const }));
    const welded = weldDesigns(subDesign(was, keep), print.design, frame.dx, frame.dy, frame.angle, at, print.held[0]!, width, {
        at: "a",
        kind: "slipway",
    });
    const next = seamedDesign(welded, held.slice(1));
    const moduleOf = (m: number): number => (m < n ? keep[m]! : (old.get(print.modules[m - n]!) ?? -1));

    // Nothing of its own hull, or of anything else, where it goes.
    for (let m = n; m < next.modules.length; m++) {
        for (let k = 0; k < n; k++) if (modulesOverlap(next.modules[k]!.spec, next.modules[m]!.spec)) return false;
    }
    const offset = shipBreakup.offsetOf(bodies, b, was, next);
    const x = bodies.x[b]! + offset.x;
    const y = bodies.y[b]! + offset.y;
    for (let j = 0; j < bodies.highWater; j++) {
        if (j === b || bodies.alive[j] === 0 || bodies.ghost[j] === 1 || !ships.meets(b, j)) continue;
        const other = ships.designOf(j);
        if (other === null) continue;
        for (let m = n; m < next.modules.length; m++) {
            if (moduleOverlapsHull(next, m, x, y, bodies.angle[b]!, bodies, j, other)) return false;
        }
    }

    shipBreakup.momentum(ships, bodies);
    const beforeX = ships.momentumX;
    const beforeY = ships.momentumY;
    const id = ships.bodyIds[p]!;
    const spin = bodies.angularVel[b]!;
    bodies.x[b] = x;
    bodies.y[b] = y;
    bodies.vx[b] = bodies.vx[b]! - spin * offset.y;
    bodies.vy[b] = bodies.vy[b]! + spin * offset.x;
    bodies.setMass(id, next.mass);
    bodies.setInertia(id, next.inertia);
    bodies.radius[b] = next.radius;
    const pilots = ships.pilots[b];
    const now = new Int32Array(next.modules.length);
    for (let m = 0; m < now.length; m++) now[m] = m < n ? (pilots?.[keep[m]!] ?? p) : f;
    shipBreakup.adopt(ships, p, b, next, () => p, moduleOf, true, false, f);
    ships.pilots[b] = now;
    for (const r of ships.ridersOf(bodies, b)) if (r !== p) ships.board(r, p);
    // A module just whole has its walls, and is waiting on its fittings.
    for (let m = n; m < next.modules.length; m++) {
        const from = moduleOf(m);
        if (next.modules[m]!.shell === undefined && (from < 0 || was.modules[from]!.shell !== undefined)) {
            ships.damage.unfit(b, m, fittingOf(craft.modules[print.modules[m - n]!]!.stats));
        }
    }
    shipBreakup.settleMass(ships, bodies, b);
    shipBreakup.momentum(ships, bodies);
    bodies.vx[b] = bodies.vx[b]! + (beforeX - ships.momentumX) / movable(bodies.mass[b]!);
    bodies.vy[b] = bodies.vy[b]! + (beforeY - ships.momentumY) / movable(bodies.mass[b]!);
    return true;
}

/**
 * How many of a pad's fighters are still in the fight, forgetting the dead:
 * one being built while it is on its carrier, one in control and not
 * mission killed, and one in control aboard a friend, which will be filled.
 */
export function fielded(ships: Ships, bodies: Bodies, i: number, fighters: number[]): number {
    let count = 0;
    let kept = 0;
    for (let k = 0; k < fighters.length; k++) {
        const f = fighters[k]!;
        if (ships.alive[f] === 0) continue;
        fighters[kept++] = f;
        if (ships.unfinished[f] === 1) {
            if (bodies.indexOf(ships.bodyIds[f]!) >= 0 && ships.parkedOn[f] === i) count++;
            continue;
        }
        if (!ships.hasControl(f)) continue;
        const b = bodies.indexOf(ships.bodyIds[f]!);
        const p = ships.parkedOn[f]! >= 0 ? ships.parkedOn[f]! : b < 0 ? -1 : ships.shipByBody[b]!;
        if (!ships.isMissionKilled(f) || (p !== f && p >= 0 && ships.team[p] === ships.team[f])) count++;
    }
    fighters.length = kept;
    return count;
}

/**
 * Whether a fighter of ship `i`'s side is making for its pad `pad` and can
 * still get there: under control, and with an engine that works.
 */
export function awaited(ships: Ships, i: number, pad: number): boolean {
    for (let o = 0; o < ships.alive.length; o++) {
        if (ships.alive[o] === 0 || ships.salvaging[o] !== i || ships.landingPad[o] !== pad) continue;
        if (ships.derelict[o] === 1 || !ships.hasControl(o) || ships.hasNoEngines(o)) continue;
        return true;
    }
    return false;
}

/**
 * Put a step of the pad's work into the walls of the core it lays next, at
 * the rate and price a pad mends at, and lay them down once there is a
 * shell's step of them and the metal to pay for it.
 */
export function layDown(
    ships: Ships,
    world: World,
    i: number,
    b: number,
    design: ShipDesign,
    pad: number,
    k: number,
    fighter: ShipDesign,
): void {
    const bodies = world.bodies;
    const core = fighter.cores[0];
    if (core === undefined) return;
    const whole = fighter.modules[core]!;
    const wall = whole.stats.structureMass / SHELL_STEPS;
    const cost = wall * (1 + REPAIR_WASTE);
    if (shipSupply.allowed(ships, Resource.Metal, b, pad, Claim.Pads, cost) < cost) return;
    const brood = ships.broods[i]!;
    const work = buildWork(whole.stats);
    const perKg = work * REPAIR_ENERGY_PER_JOULE;
    const working = ships.left(i, b, pad, DamageEffect.Grip);
    const deck = design.modules[pad]!.spec;
    const joules = PAD_REPAIR_PER_AREA * deck.length * deck.width * working * world.dt;
    const charge = shipSupply.allowed(ships, Resource.Charge, b, pad, Claim.Pads, (wall - brood.work[k]!) * perKg);
    const kg = min(min(joules / work, charge / perKg), wall - brood.work[k]!);
    if (kg > 0) {
        brood.work[k] = brood.work[k]! + kg;
        shipSupply.took(ships, Resource.Charge, b, pad, Claim.Pads, ships.power.drain(b, pad, kg * perKg));
        ships.builtAt[i] = world.tick;
    }
    if (brood.work[k]! < wall) return;
    brood.work[k] = 0;

    // Where the whole fighter would lie, and where its core's first step is in that.
    const pose = aboardPose(design, { pad, design: fighter });
    const pc = cos(pose.angle);
    const ps = sin(pose.angle);
    // The carrier's middle, in the fighter's blueprint frame.
    const mx = fighter.centreOfMassX - (pose.x * pc + pose.y * ps);
    const my = fighter.centreOfMassY - (-pose.x * ps + pose.y * pc);
    const face = faceNearest(whole.spec, mx, my);
    const share = 1 / SHELL_STEPS;
    const part = shellOf(whole.spec, whole.stats, face, share);
    const origin = { design: fighter, module: core };
    const seed = rebuiltDesign(subDesign(fighter, [core]), 0, part.spec, part.stats, origin, { share, face, placed: whole.spec });
    const ox = seed.centreOfMassX - fighter.centreOfMassX;
    const oy = seed.centreOfMassY - fighter.centreOfMassY;
    const lx = pose.x + ox * pc - oy * ps;
    const ly = pose.y + ox * ps + oy * pc;

    const mass = bodies.mass[b]!;
    const inertia = bodies.inertia[b]!;
    shipSupply.took(ships, Resource.Metal, b, pad, Claim.Pads, ships.metal.drain(b, pad, cost));
    shipBreakup.settleMass(ships, bodies, b);
    const angle = bodies.angle[b]!;
    const c = cos(angle);
    const s = sin(angle);
    const x = bodies.x[b]! + lx * c - ly * s;
    const y = bodies.y[b]! + lx * s + ly * c;
    const spin = bodies.angularVel[b]!;
    const f = ships.spawn(world, {
        design: seed,
        x,
        y,
        angle: angle + pose.angle,
        vx: bodies.vx[b]! - spin * (y - bodies.y[b]!),
        vy: bodies.vy[b]! + spin * (x - bodies.x[b]!),
        angularVel: spin,
        team: ships.team[i]!,
    });
    // It is building towards the whole fighter, and is one in all but its parts.
    ships.launched[f] = fighter;
    buildsFor(ships, f, fighter);
    ships.couldFight[f] = fighter.turrets.some((t) => t.main) || fighter.engines.length > 0 ? 1 : 0;
    ships.unfinished[f] = 1;
    shipDocking.park(ships, bodies, i, f, pad);
    ships.home[f] = i;
    brood.fighters[k]!.push(f);
    // What it wasted left at the hull's speed.
    shipBreakup.discardFrom(ships, bodies, bodies.indexOf(ships.bodyIds[i]!), mass, inertia);
}

/** Whether fighter `i`, being built on body `b` of design `design`, has every module its design has, whole and fitted. */
export function finished(ships: Ships, b: number, i: number, design: ShipDesign): boolean {
    const rebuild = shipRebuild.rebuildFor(ships, i, design);
    for (let l = 0; l < rebuild.at.length; l++) {
        const m = rebuild.at[l]!;
        if (m < 0 || design.modules[m]!.shell !== undefined || ships.damage.unbuiltAt(b, m) > 0) return false;
    }
    return true;
}

/**
 * Whether ship `i` can still put an armed fighter or ship in the fight:
 * under control, with a pad or slipway of its own working that builds one
 * and the metal on its piece of hull for at least the fighter's core or the
 * ship's first slice.
 */
export function canBuildArmed(ships: Ships, i: number): boolean {
    const builds = ships.launched[i]?.builds ?? [];
    const yards = ships.launched[i]?.yards ?? [];
    if ((builds.length === 0 && yards.length === 0) || !ships.hasControl(i)) return false;
    const bodies = ships.bodyStore!;
    const b = bodies.indexOf(ships.bodyIds[i]!);
    const design = ships.designs[i]!;
    const rebuild = shipRebuild.rebuildFor(ships, i, design);
    for (const order of yards) {
        const craft = ships.craftFor(i, order.slipway, order.design);
        if (!(craft.turrets.some((t) => t.main) || craft.mainWeaponEngines.length > 0)) continue;
        const slipway = rebuild.at[order.slipway]!;
        if (slipway < 0 || !(ships.left(i, b, slipway, DamageEffect.Grip) > 0)) continue;
        // The metal for its first slice, at least.
        const berth = ships.launched[i]!.modules[order.slipway]!.spec;
        const first = printedCraft(craft, berth, min(printLength(craft, berth), SLIPWAY_STEP));
        let kg = 0;
        for (const module of first?.design.modules ?? []) kg += module.stats.structureMass;
        if (ships.metal.pieceHeld(b, slipway) >= kg * (1 + REPAIR_WASTE)) return true;
    }
    for (const order of builds) {
        const fighter = ships.craftFor(i, order.pad, order.design);
        const core = fighter.cores[0];
        if (core === undefined || !(fighter.turrets.some((t) => t.main) || fighter.mainWeaponEngines.length > 0)) continue;
        const pad = rebuild.at[order.pad]!;
        if (pad < 0 || !(ships.left(i, b, pad, DamageEffect.Grip) > 0)) continue;
        const stats = fighter.modules[core]!.stats;
        if (ships.metal.pieceHeld(b, pad) >= (stats.structureMass + fittingOf(stats)) * (1 + REPAIR_WASTE)) return true;
    }
    return false;
}

/** Whether every corner of body `b`'s bounding box lies inside a pad of `spec` at `place`. */
export function within(
    bodies: Bodies,
    b: number,
    design: ShipDesign,
    place: { x: number; y: number; angle: number },
    spec: ModuleSpec,
): boolean {
    const box = footprintOf(design);
    const angle = bodies.angle[b]!;
    const c = cos(angle);
    const s = sin(angle);
    const pc = cos(place.angle);
    const ps = sin(place.angle);
    const halfL = spec.length / 2;
    const halfW = spec.width / 2;
    for (let k = 0; k < 4; k++) {
        const lx = k < 2 ? box.minX : box.maxX;
        const ly = k % 2 === 0 ? box.minY : box.maxY;
        const dx = bodies.x[b]! + lx * c - ly * s - place.x;
        const dy = bodies.y[b]! + lx * s + ly * c - place.y;
        if (abs(dx * pc + dy * ps) > halfL || abs(-dx * ps + dy * pc) > halfW) return false;
    }
    return true;
}

/** Whether ship `i` on body `b` may build on pad or slipway `spec`: anywhere, unless it builds only anchored (`buildAnchored`). */
export function mayBuild(ships: Ships, i: number, b: number, spec: ModuleSpec): boolean {
    if (spec.buildAnchored !== true || shipClaw.workingClaw(ships, i, b) < 0) return true;
    // Moored to a rock, or holding a wreck in its claw.
    if (ships.mooredClaw[i]! >= 0) return true;
    for (const seam of ships.hullDesign[b]?.seams ?? []) {
        if (seam.dock === "claw" && ships.pilotAt(b, seam.a) === i) return true;
    }
    return false;
}

/**
 * Whether ship `i` wants an anchor to build: a pad or slipway of it that
 * builds only anchored (`buildAnchored`) has a ship on it, or keeps more
 * than are in the fight.
 */
export function wantsAnchor(ships: Ships, bodies: Bodies, i: number): boolean {
    const launched = ships.launched[i];
    if (launched === undefined || !ships.hasControl(i)) return false;
    const yard = ships.yards[i];
    const yards = launched.yards ?? [];
    for (let k = 0; yard !== null && yard !== undefined && k < yards.length; k++) {
        const order = yards[k]!;
        if (launched.modules[order.slipway]!.spec.buildAnchored !== true) continue;
        if (yard.building[k]! >= 0 || fielded(ships, bodies, i, yard.ships[k]!) < ships.keepFor(i, order.slipway, order.keep)) return true;
    }
    const brood = ships.broods[i];
    const builds = launched.builds ?? [];
    for (let k = 0; brood !== null && brood !== undefined && k < builds.length; k++) {
        const order = builds[k]!;
        if (launched.modules[order.pad]!.spec.buildAnchored !== true) continue;
        if (fielded(ships, bodies, i, brood.fighters[k]!) < ships.keepFor(i, order.pad, order.keep)) return true;
    }
    return false;
}
