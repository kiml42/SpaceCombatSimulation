import { describe, expect, it } from "vitest";
import {
    billOf,
    compileBlueprint,
    EXPLOSIVE_YIELD,
    FUEL_DENSITY,
    HULL_LAYER,
    moduleStats,
    parseBlueprint,
    Projectiles,
    ROUND_WRECKAGE,
    serialiseBlueprint,
    Ships,
    SpatialGrid,
    warheadBurst,
    warheadReach,
    warheadSpread,
    SPREAD_PER_FRAGMENT,
    WEAPONS_LAYER,
    World,
    type Blueprint,
    type ModuleSpec,
} from "../sim/index.js";
import * as shipDocking from "../sim/shipDocking.js";
import { Demonstration } from "../editor/demonstrate.js";
import { attackRosette, gunsBearing, previewSnapshot } from "../editor/preview.js";
import {
    COOK_OFF_CHANCE,
    cookOff,
    cookOffChance,
    detonateWarheads,
    fragmentCone,
    tripped,
    WARHEAD_FILL_RATE,
    warheadCone,
    warheadLead,
    type FragmentCone,
} from "../sim/warheads.js";
import { Beams, capture, Snapshot } from "../sim/index.js";

/**
 * A warhead is a sealed tank that fires by blowing itself apart: its walls fly
 * out as fragments across its spread when an enemy comes within its reach.
 */

const HEAD: ModuleSpec = {
    kind: "warhead",
    x: 1.5,
    y: 0,
    angle: 0,
    length: 1,
    width: 0.6,
    fragments: 8,
    spread: Math.PI / 3,
};

const CARRIER: Blueprint = {
    name: "Carrier",
    modules: [{ kind: "core", x: 0, y: 0, length: 2, width: 2 }, { kind: "structure", x: -1.5, y: 0, length: 1, width: 1 }, HEAD],
};

const TARGET: Blueprint = {
    name: "Target",
    modules: [
        { kind: "core", x: 0, y: 0, length: 4, width: 4 },
        { kind: "structure", x: 0, y: 4, length: 4, width: 4 },
    ],
};

function scene(targetX: number, targetY = 0, team = 2, seed = 5) {
    const world = new World({ dt: 1 / 60, seed });
    const ships = new Ships();
    const carrier = ships.spawn(world, { design: compileBlueprint(CARRIER), x: 0, y: 0, vx: 300, vy: 20, angularVel: 0.2, team: 1 });
    const target = ships.spawn(world, { design: compileBlueprint(TARGET), x: targetX, y: targetY, team });
    const grid = new SpatialGrid(64);
    grid.rebuild(world.bodies);
    const projectiles = new Projectiles();
    const b = world.bodies.indexOf(ships.body(carrier));
    const design = ships.designs[carrier]!;
    const head = design.modules.findIndex((m) => m.spec.kind === "warhead");
    return { world, ships, carrier, target, grid, projectiles, b, design, head };
}

/** Momentum along x and y, and about the origin, with what has been discarded and what is in flight. */
function momentum(s: ReturnType<typeof scene>): [number, number, number] {
    const bodies = s.world.bodies;
    let px = s.ships.discardedPx;
    let py = s.ships.discardedPy;
    let l = s.ships.discardedL;
    for (let i = 0; i < bodies.highWater; i++) {
        if (bodies.alive[i] === 0) continue;
        const m = bodies.mass[i]!;
        px += m * bodies.vx[i]!;
        py += m * bodies.vy[i]!;
        l += bodies.inertia[i]! * bodies.angularVel[i]! + m * (bodies.x[i]! * bodies.vy[i]! - bodies.y[i]! * bodies.vx[i]!);
    }
    const p = s.projectiles;
    for (let i = 0; i < p.highWater; i++) {
        if (p.alive[i] === 0) continue;
        const m = p.mass[i]!;
        px += m * p.vx[i]!;
        py += m * p.vy[i]!;
        l += m * (p.x[i]! * p.vy[i]! - p.y[i]! * p.vx[i]!);
    }
    return [px, py, l];
}

describe("warhead", () => {
    it("is a tank: walls for casing, fuel for charge, billed as fuel", () => {
        const stats = moduleStats(HEAD);
        expect(stats.fuel).toBeCloseTo(stats.interior * FUEL_DENSITY, 9);
        expect(stats.mass).toBeCloseTo(stats.structureMass + stats.fuel, 9);
        const design = compileBlueprint(CARRIER);
        const placed = design.modules.find((m) => m.spec.kind === "warhead")!;
        const without = billOf(compileBlueprint({ ...CARRIER, modules: CARRIER.modules.slice(0, 2) }));
        expect(billOf(design).fuel - without.fuel).toBeCloseTo(placed.stats.fuel, 6);
    });

    it("is drawn on last, and refuelling fills it first", () => {
        const s = scene(500);
        const core = s.design.modules.findIndex((m) => m.spec.kind === "core");
        const full = s.ships.fuel.held(s.b, s.head);
        const elsewhere = s.ships.fuel.held(s.b, core);
        expect(full).toBeGreaterThan(0);
        expect(elsewhere).toBeGreaterThan(0);
        s.ships.fuel.drain(s.b, core, elsewhere / 2);
        expect(s.ships.fuel.held(s.b, s.head)).toBe(full);
        s.ships.fuel.drain(s.b, core, elsewhere / 2 + full / 2);
        expect(s.ships.fuel.held(s.b, s.head)).toBeCloseTo(full / 2, 6);
        s.ships.fuel.add(s.b, core, full / 2);
        expect(s.ships.fuel.held(s.b, s.head)).toBeCloseTo(full, 6);
        expect(s.ships.fuel.held(s.b, core)).toBeCloseTo(0, 6);
    });

    it("tops itself up from the tanks drawn before it", () => {
        const s = scene(500);
        const spent = s.ships.fuel.empty(s.b, s.head);
        expect(spent).toBeGreaterThan(0);
        detonateWarheads(s.ships, s.world, s.projectiles, s.grid);
        expect(s.ships.fuel.held(s.b, s.head)).toBeCloseTo(WARHEAD_FILL_RATE * s.world.dt, 9);
    });

    it("gives its fragments the share of its yield its spread takes, no less than a shaped liner's", () => {
        const stats = moduleStats(HEAD);
        const narrow = warheadBurst(HEAD, stats);
        expect(narrow.focus).toBe(0.2);
        expect(narrow.energy).toBeCloseTo(stats.fuel * EXPLOSIVE_YIELD, 3);
        // What it yields is what it holds.
        expect(warheadBurst(HEAD, stats, stats.structureMass, stats.fuel / 2).energy).toBeCloseTo(narrow.energy / 2, 3);
        expect(0.5 * narrow.casing * narrow.speed ** 2).toBeCloseTo(narrow.focus * narrow.energy, 0);
        const round = warheadBurst({ ...HEAD, spread: 2 * Math.PI }, stats);
        expect(round.focus).toBe(1);
        expect(round.speed).toBeGreaterThan(narrow.speed);
    });

    it("throws a single slug straight ahead, and a crowd of fragments no narrower than they need", () => {
        expect(warheadSpread({ ...HEAD, fragments: 1, spread: Math.PI })).toBe(0);
        expect(warheadSpread({ ...HEAD, fragments: 64, spread: 0 })).toBeCloseTo((10 * Math.PI) / 180, 12);
        expect(warheadSpread({ ...HEAD, fragments: 2, spread: 0 })).toBeCloseTo(SPREAD_PER_FRAGMENT, 12);
        expect(warheadSpread({ ...HEAD, fragments: 8, spread: 2 * Math.PI })).toBe(2 * Math.PI);
        // A slug's share of its yield is a shaped liner's.
        expect(warheadBurst({ ...HEAD, fragments: 1 }, moduleStats(HEAD)).focus).toBe(0.2);
    });

    it("bears on the attack rosette across its spread, as a main weapon", () => {
        const design = compileBlueprint(CARRIER);
        expect(gunsBearing(design, 0).warheads).toEqual([true]);
        expect(gunsBearing(design, Math.PI / 4).warheads).toEqual([false]);
        expect(attackRosette(design).total).toBe(1);
        const spare = compileBlueprint({ ...CARRIER, modules: [...CARRIER.modules.slice(0, 2), { ...HEAD, main: false }] });
        expect(attackRosette(spare).total).toBe(0);
        expect(attackRosette(spare).secondaries).toBe(1);
    });

    it("goes off in the editor once the rosette's aim is inside its spread, and is back once it lets go", () => {
        const design = compileBlueprint(CARRIER);
        const head = design.warheads[0]!.module;
        const demo = new Demonstration();
        const snapshot = previewSnapshot(design);
        demo.step(design, [], 1 / 60, { bearing: Math.PI / 2 });
        demo.writeInto(snapshot);
        expect(snapshot.ships[0]!.drawn?.[head]).not.toBe(false);
        expect(snapshot.projectileCount).toBe(0);
        demo.step(design, [], 1 / 60, { bearing: 0 });
        demo.writeInto(snapshot);
        expect(snapshot.ships[0]!.drawn?.[head]).toBe(false);
        expect(snapshot.projectileCount).toBe(8);
        // Not again while the aim holds.
        demo.step(design, [], 1 / 60, { bearing: 0.1 });
        demo.writeInto(snapshot);
        expect(snapshot.projectileCount).toBe(8);
        demo.step(design, [], 1 / 60, null);
        demo.writeInto(snapshot);
        expect(snapshot.ships[0]!.drawn?.[head]).not.toBe(false);
        // Selecting it does not set it off.
        demo.step(design, [design.modules[head]!.index], 1 / 60, null);
        demo.writeInto(snapshot);
        expect(snapshot.ships[0]!.drawn?.[head]).not.toBe(false);
    });

    it("keeps its spread in degrees in a file", () => {
        const file = serialiseBlueprint(CARRIER);
        const raw = (file["modules"] as Record<string, unknown>[])[2]!;
        expect(raw["spread"]).toBeCloseTo(60, 9);
        const back = parseBlueprint(file).modules[2] as ModuleSpec;
        expect(back.spread).toBeCloseTo(Math.PI / 3, 12);
        expect(back.fragments).toBe(8);
    });

    it("reaches as far as its fragments are worth throwing at the size it wants, by its fire range", () => {
        const design = compileBlueprint(CARRIER);
        const head = design.warheads[0]!;
        const placed = design.modules[head.module]!;
        const wanted = design.radius * Math.sqrt(head.targeting.preferredMass > 0 ? head.targeting.preferredMass : 1);
        expect(head.reach).toBeCloseTo(warheadReach(placed.spec, placed.stats, wanted) * head.targeting.fireRange, 9);
        expect(head.reach).toBeGreaterThan(15);
        // Its doctrine's fire range takes its share, as a gun's does.
        const halved = compileBlueprint({
            ...CARRIER,
            modules: [...CARRIER.modules.slice(0, 2), { ...HEAD, targeting: { fireRange: 0.5 } }],
        });
        expect(halved.warheads[0]!.reach).toBeCloseTo(head.reach / 2, 9);
        // A main one is what the ship closes to, as a main gun is.
        expect(design.reach).toBeGreaterThan(0);
        const spare = compileBlueprint({ ...CARRIER, modules: [...CARRIER.modules.slice(0, 2), { ...HEAD, main: false }] });
        expect(spare.reach).toBe(0);
    });

    it("trips on an enemy ahead within its reach, and on nothing else", () => {
        const fuzed = (s: ReturnType<typeof scene>) =>
            tripped(s.ships, s.world.bodies, s.grid, s.carrier, s.b, s.design, s.head, s.world.dt);
        const reach = compileBlueprint(CARRIER).warheads[0]!.reach;
        // The target's core reaches 2 m back from its centre; the warhead's centre is 1.5 m ahead of the carrier's.
        expect(fuzed(scene(1.5 + 2 + 15))).toBe(true);
        expect(fuzed(scene(1.5 + 2 + reach + 20))).toBe(false);
        // Behind it, close.
        expect(fuzed(scene(-15))).toBe(false);
        // Off to the side, outside a 60° cone.
        expect(fuzed(scene(5, 15))).toBe(false);
        // A friend ahead is no target.
        expect(fuzed(scene(1.5 + 2 + 15, 0, 1))).toBe(false);
    });

    it("throws its cone as a shotgun does from a moving hull: narrower, swung the way it closes, and further", () => {
        const design = compileBlueprint(CARRIER);
        const head = design.warheads[0]!;
        const placed = design.modules[head.module]!;
        const speed = warheadBurst(placed.spec, placed.stats).speed;
        const cone = (rvx: number, rvy: number, facing = 0): FragmentCone =>
            fragmentCone(speed, head.spread, 8, facing, rvx, rvy, head.targetRadius, head.targeting.fireRange, {
                centre: 0,
                half: 0,
                reach: 0,
            });
        // At rest, its own spread and reach.
        const still = cone(0, 0);
        expect(still.centre).toBeCloseTo(0, 9);
        expect(still.half).toBeCloseTo(head.spread / 2, 9);
        expect(still.reach).toBeCloseTo(head.reach, 6);
        // Closing head on at twice its burst speed: a third as wide, as far as the gaps allow.
        const closing = cone(2 * speed, 0);
        expect(closing.centre).toBeCloseTo(0, 9);
        expect(closing.half).toBeLessThan(still.half / 2);
        expect(closing.reach).toBeGreaterThan(still.reach * 1.5);
        // Pointed 45° off the way it closes: the cone swings most of the way back, 5° to 23° off.
        const skewed = cone(2 * speed, 0, Math.PI / 4);
        expect(skewed.centre - skewed.half).toBeCloseTo(Math.atan2(Math.sin(Math.PI / 12), 2 + Math.cos(Math.PI / 12)), 2);
        expect(skewed.centre + skewed.half).toBeCloseTo(Math.atan2(Math.sin((5 * Math.PI) / 12), 2 + Math.cos((5 * Math.PI) / 12)), 2);
        // All round, and slower than its burst: still all round.
        const ring = fragmentCone(speed, Math.PI * 2, 8, 0, speed / 2, 0, 1, 1, { centre: 0, half: 0, reach: 0 });
        expect(ring.half).toBe(Infinity);
        // All round, but faster than its burst: only the way it closes.
        expect(fragmentCone(speed, Math.PI * 2, 8, 0, 2 * speed, 0, 1, 1, { centre: 0, half: 0, reach: 0 }).half).toBeLessThan(Math.PI / 4);
    });

    it("trips on what its fragments would hit, closing fast with its nose off to one side", () => {
        // Pointed 45° right of a hull dead ahead, away from its second module, closing on it at twice its burst speed.
        const design = compileBlueprint(CARRIER);
        const placed = design.modules[design.warheads[0]!.module]!;
        const speed = warheadBurst(placed.spec, placed.stats).speed;
        const fuzed = (vx: number): boolean => {
            const world = new World({ dt: 1 / 60, seed: 5 });
            const ships = new Ships();
            const carrier = ships.spawn(world, { design, x: 0, y: 0, angle: -Math.PI / 4, vx, team: 1 });
            ships.spawn(world, { design: compileBlueprint(TARGET), x: 1.5 + 2 + 15, y: 0, team: 2 });
            const grid = new SpatialGrid(64);
            grid.rebuild(world.bodies);
            const b = world.bodies.indexOf(ships.body(carrier));
            return tripped(ships, world.bodies, grid, carrier, b, design, design.warheads[0]!.module, world.dt);
        };
        // Still, the hull is outside its 60° cone; closing, its fragments go that way.
        expect(fuzed(0)).toBe(false);
        expect(fuzed(2 * speed)).toBe(true);
    });

    it("shows its cone at what it is going for, and at rest with nothing", () => {
        const s = scene(1.5 + 2 + 200, 0);
        const cone = { centre: 0, half: 0, reach: 0 };
        const head = s.design.warheads[0]!;
        // Nothing chosen yet: its own cone, the way it points.
        warheadCone(s.ships, s.world.bodies, s.carrier, s.b, 0, cone);
        expect(cone.centre).toBeCloseTo(s.world.bodies.angle[s.b]!, 9);
        expect(cone.half).toBeCloseTo(head.spread / 2, 9);
        s.ships.pushOrder(s.carrier, s.target, 0, 50, 10);
        warheadCone(s.ships, s.world.bodies, s.carrier, s.b, 0, cone);
        // Closing at 300 m/s, a little way to the side: narrower.
        expect(cone.half).toBeLessThan(head.spread / 2);
        const view = capture(new Snapshot(), s.world, s.ships, s.projectiles, new Beams(4));
        const shown = view.ships.find((ship) => ship.warheadCones !== undefined && ship.warheadCones.length > 0)!;
        expect(shown.warheadCones).toEqual([cone.centre, cone.half, cone.reach]);
    });

    it("leads its warhead onto a target as a gun leads a shot, and gives up where it cannot", () => {
        const design = compileBlueprint(CARRIER);
        const placed = design.modules[design.warheads[0]!.module]!;
        const speed = warheadBurst(placed.spec, placed.stats).speed;
        // From still, with the target 100 m ahead moving across at `across`.
        const lead = (across: number, dud = false): number | null => {
            const world = new World({ dt: 1 / 60, seed: 5 });
            const ships = new Ships();
            const i = ships.spawn(world, { design, x: 0, y: 0, team: 1 });
            const b = world.bodies.indexOf(ships.body(i));
            if (dud) ships.damage.absorb(b, design.warheads[0]!.module, 0.51 * ships.damage.capacityOf(b, design.warheads[0]!.module));
            const out = { heading: 0, reach: 0 };
            return warheadLead(ships, world.bodies, i, b, 101.5, 0, 0, across, out) ? out.heading : null;
        };
        expect(lead(0)).toBeCloseTo(0, 6);
        // Moving across, it throws ahead of it: the middle fragment's sideways speed matches the target's.
        expect(Math.sin(lead(speed / 2)!) * speed).toBeCloseTo(speed / 2, 6);
        // Faster across than its burst, no aim helps.
        expect(lead(speed * 1.1)).toBeNull();
        // A dead fuze has nothing to aim.
        expect(lead(0, true)).toBeNull();
    });

    it("throws its casing ahead, keeps the momentum balanced, and is gone", () => {
        const s = scene(1.5 + 2 + 15);
        const before = momentum(s);
        const casing = s.design.modules[s.head]!.stats.structureMass;
        expect(detonateWarheads(s.ships, s.world, s.projectiles, s.grid)).toBe(1);
        // All ahead, inside the cone, as seen from the carrier.
        const vx = s.world.bodies.vx[s.b]!;
        const vy = s.world.bodies.vy[s.b]!;
        let mass = 0;
        let count = 0;
        for (let i = 0; i < s.projectiles.highWater; i++) {
            if (s.projectiles.alive[i] === 0 || s.projectiles.kind[i] === ROUND_WRECKAGE) continue;
            count++;
            mass += s.projectiles.mass[i]!;
            const bearing = Math.atan2(s.projectiles.vy[i]! - vy, s.projectiles.vx[i]! - vx);
            expect(Math.abs(bearing)).toBeLessThan(Math.PI / 6 + 0.05);
        }
        expect(count).toBe(8);
        expect(mass).toBeCloseTo(casing, 6);
        // Pushed back by what it threw.
        expect(vx).toBeLessThan(300);
        const after = momentum(s);
        expect(after[0]).toBeCloseTo(before[0], 3);
        expect(after[1]).toBeCloseTo(before[1], 3);
        expect(after[2]).toBeCloseTo(before[2], 3);
        s.ships.sever(s.world);
        expect(s.ships.alive[s.carrier] === 0 || !s.ships.designs[s.carrier]!.modules.some((m) => m.spec.kind === "warhead")).toBe(true);
    });

    it("puts a lone fragment in its own layer: a fighter's, or once committed to ram, the hull layer", () => {
        const layer = (fighter: boolean, committed: boolean): number[] => {
            const head = { ...HEAD, fragments: 1 };
            const design = compileBlueprint({ ...CARRIER, fighter, modules: [...CARRIER.modules.slice(0, 2), head] });
            const world = new World({ dt: 1 / 60, seed: 5 });
            const ships = new Ships();
            const i = ships.spawn(world, { design, x: 0, y: 0, team: 1 });
            ships.spawn(world, { design: compileBlueprint(TARGET), x: 1.5 + 2 + 5, y: 0, team: 2 });
            if (committed) ships.committed[i] = 1;
            const grid = new SpatialGrid(64);
            grid.rebuild(world.bodies);
            const projectiles = new Projectiles();
            expect(detonateWarheads(ships, world, projectiles, grid)).toBe(1);
            const layers: number[] = [];
            for (let k = 0; k < projectiles.highWater; k++)
                if (projectiles.alive[k] === 1 && projectiles.kind[k] !== ROUND_WRECKAGE) layers.push(projectiles.layers[k]!);
            return layers;
        };
        expect(compileBlueprint({ ...CARRIER, fighter: true }).fighter).toBe(true);
        expect(layer(false, false)).toEqual([HULL_LAYER]);
        expect(layer(true, false)).toEqual([WEAPONS_LAYER]);
        expect(layer(true, true)).toEqual([HULL_LAYER]);
    });

    it("puts what its fragments do not take into the hull carrying it", () => {
        const s = scene(1.5 + 2 + 15);
        const core = s.design.modules.findIndex((m) => m.spec.kind === "core");
        expect(s.ships.damage.integrity(s.b, core)).toBe(1);
        detonateWarheads(s.ships, s.world, s.projectiles, s.grid);
        expect(s.ships.damage.integrity(s.b, core)).toBeLessThan(1);
    });

    it("crushes its carrier outward from it, so a module shields what is behind it", () => {
        const world = new World({ dt: 1 / 60, seed: 5 });
        const ships = new Ships();
        const row = compileBlueprint({
            name: "Row",
            modules: [
                { ...HEAD, x: 2 },
                { kind: "structure", x: 1, y: 0, length: 1, width: 1, reinforcement: 4 },
                { kind: "structure", x: 0, y: 0, length: 1, width: 1, reinforcement: 4 },
                { kind: "core", x: -1.5, y: 0, length: 2, width: 2 },
            ],
        });
        const carrier = ships.spawn(world, { design: row, team: 1 });
        ships.spawn(world, { design: compileBlueprint(TARGET), x: 2 + 2 + 15, team: 2 });
        const grid = new SpatialGrid(64);
        grid.rebuild(world.bodies);
        const b = world.bodies.indexOf(ships.body(carrier));
        // Modules are reordered by kind when compiled: find them by where they are from the warhead.
        const head = row.modules.find((m) => m.spec.kind === "warhead")!;
        const at = (x: number) => row.modules.findIndex((m) => m.spec.kind === "structure" && Math.abs(m.x - head.x + 2 - x) < 1e-6);
        expect(at(1)).toBeGreaterThanOrEqual(0);
        expect(at(0)).toBeGreaterThanOrEqual(0);
        expect(detonateWarheads(ships, world, new Projectiles(), grid)).toBe(1);
        const front = ships.damage.absorbedAt(b, at(1));
        const behind = ships.damage.absorbedAt(b, at(0));
        expect(front).toBeGreaterThan(0);
        expect(behind).toBeLessThan(front);
    });

    it("throws what it shatters of its carrier as wreckage, away from it", () => {
        const s = scene(1.5 + 2 + 15);
        detonateWarheads(s.ships, s.world, s.projectiles, s.grid);
        const vx = s.world.bodies.vx[s.b]!;
        let thrown = 0;
        for (let i = 0; i < s.projectiles.highWater; i++) {
            if (s.projectiles.alive[i] === 0 || s.projectiles.kind[i] !== ROUND_WRECKAGE) continue;
            thrown++;
            // Everything else on the carrier is behind its warhead.
            expect(s.projectiles.vx[i]!).toBeLessThan(vx);
        }
        expect(thrown).toBeGreaterThan(0);
    });

    it("is a dud once it is down to half its integrity", () => {
        const s = scene(1.5 + 2 + 15);
        s.ships.damage.absorb(s.b, s.head, 0.51 * s.ships.damage.capacityOf(s.b, s.head));
        s.ships.damage.clearStep();
        expect(detonateWarheads(s.ships, s.world, s.projectiles, s.grid)).toBe(0);
        expect(s.projectiles.count).toBe(0);
    });

    it("always goes off when shattered, wherever it points", () => {
        // Nobody in reach, and pointing nowhere in particular.
        const s = scene(500);
        s.ships.damage.absorb(s.b, s.head, 3.5 * s.ships.damage.capacityOf(s.b, s.head));
        expect(cookOff(s.ships, s.world, s.projectiles)).toBe(1);
        expect(s.ships.fuel.held(s.b, s.head)).toBe(0);
        expect(s.projectiles.count).toBeGreaterThanOrEqual(8);
    });

    it("cooks off, damaged, by a chance that rises as its integrity falls", () => {
        expect(cookOffChance(1)).toBe(COOK_OFF_CHANCE);
        expect(cookOffChance(0.5)).toBeCloseTo(COOK_OFF_CHANCE + (1 - COOK_OFF_CHANCE) / 2, 12);
        expect(cookOffChance(0)).toBe(1);
        let went = 0;
        const trials = 400;
        for (let seed = 0; seed < trials; seed++) {
            const s = scene(500, 0, 2, seed);
            // A light blow, which leaves it nearly whole.
            s.ships.damage.absorb(s.b, s.head, 0.01 * s.ships.damage.capacityOf(s.b, s.head));
            went += cookOff(s.ships, s.world, s.projectiles);
        }
        expect(went / trials).toBeGreaterThan(0.02);
        expect(went / trials).toBeLessThan(0.1);
    });

    it("does not cook off undamaged, or with no charge in it", () => {
        const s = scene(500);
        expect(cookOff(s.ships, s.world, s.projectiles)).toBe(0);
        s.ships.fuel.empty(s.b, s.head);
        s.ships.damage.absorb(s.b, s.head, 3.5 * s.ships.damage.capacityOf(s.b, s.head));
        expect(cookOff(s.ships, s.world, s.projectiles)).toBe(0);
    });

    it("does not go off parked on a pad", () => {
        const world = new World({ dt: 1 / 60, seed: 5 });
        const ships = new Ships();
        const deck = compileBlueprint({
            name: "Deck",
            modules: [
                { kind: "core", x: -3, y: 0, length: 4, width: 4 },
                // Small enough that the warhead overhangs it, so it is no friend in the way.
                { kind: "pad", x: 0, y: 0, length: 2, width: 2 },
            ],
        });
        const pad = deck.modules.findIndex((m) => m.spec.kind === "pad");
        // With its pad under the craft.
        const carrier = ships.spawn(world, { design: deck, x: -deck.modules[pad]!.x, team: 1 });
        const craft = ships.spawn(world, { design: compileBlueprint(CARRIER), x: 0, y: 0, team: 1 });
        expect(shipDocking.park(ships, world.bodies, carrier, craft, pad)).toBe(true);
        ships.spawn(world, { design: compileBlueprint(TARGET), x: 1.5 + 2 + 15, team: 2 });
        const grid = new SpatialGrid(64);
        grid.rebuild(world.bodies);
        const b = world.bodies.indexOf(ships.body(craft));
        const design = ships.designs[craft]!;
        const head = design.modules.findIndex((m) => m.spec.kind === "warhead");
        // It would, free.
        expect(tripped(ships, world.bodies, grid, craft, b, design, head, world.dt)).toBe(true);
        expect(detonateWarheads(ships, world, new Projectiles(), grid)).toBe(0);
    });

    it("cooks off parked on a pad: off it first, and into the carrier it sat on", () => {
        const world = new World({ dt: 1 / 60, seed: 5 });
        const ships = new Ships();
        const deck = compileBlueprint({
            name: "Deck",
            modules: [
                { kind: "core", x: -5, y: 0, length: 4, width: 4 },
                { kind: "pad", x: 0, y: 0, length: 6, width: 4 },
            ],
        });
        const pad = deck.modules.findIndex((m) => m.spec.kind === "pad");
        const carrier = ships.spawn(world, { design: deck, x: -deck.modules[pad]!.x, vx: 40, vy: -7, team: 1 });
        const craft = ships.spawn(world, { design: compileBlueprint(CARRIER), x: 0, y: 0, vx: 40, vy: -7, team: 1 });
        expect(shipDocking.park(ships, world.bodies, carrier, craft, pad)).toBe(true);
        const projectiles = new Projectiles();
        const bodies = world.bodies;
        const total = (): [number, number] => {
            let px = ships.discardedPx;
            let py = ships.discardedPy;
            for (let i = 0; i < bodies.highWater; i++) {
                if (bodies.alive[i] === 0) continue;
                // A parked craft's mass is counted in its carrier's.
                if (i === bodies.indexOf(ships.body(craft)) && ships.parkedOn[craft]! >= 0) continue;
                px += bodies.mass[i]! * bodies.vx[i]!;
                py += bodies.mass[i]! * bodies.vy[i]!;
            }
            for (let i = 0; i < projectiles.highWater; i++) {
                if (projectiles.alive[i] === 0) continue;
                px += projectiles.mass[i]! * projectiles.vx[i]!;
                py += projectiles.mass[i]! * projectiles.vy[i]!;
            }
            return [px, py];
        };
        const before = total();
        const b = bodies.indexOf(ships.body(craft));
        const cb = bodies.indexOf(ships.body(carrier));
        const head = ships.designs[craft]!.modules.findIndex((m) => m.spec.kind === "warhead");
        ships.damage.absorb(b, head, 3.5 * ships.damage.capacityOf(b, head));
        expect(cookOff(ships, world, projectiles)).toBe(1);
        expect(ships.parkedOn[craft]).toBe(-1);
        // Only the blast's crush has reached it: no round has flown yet.
        expect(ships.damage.absorbedAt(cb, pad)).toBeGreaterThan(0);
        const after = total();
        expect(after[0]).toBeCloseTo(before[0], 3);
        expect(after[1]).toBeCloseTo(before[1], 3);
    });

    it("does nothing with nobody in reach", () => {
        const s = scene(500);
        expect(detonateWarheads(s.ships, s.world, s.projectiles, s.grid)).toBe(0);
        expect(s.projectiles.count).toBe(0);
    });
});
