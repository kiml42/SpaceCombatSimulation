import { describe, expect, it } from "vitest";
import {
    billOf,
    compileBlueprint,
    EXPLOSIVE_YIELD,
    FUEL_DENSITY,
    moduleStats,
    parseBlueprint,
    Projectiles,
    ROUND_WRECKAGE,
    serialiseBlueprint,
    Ships,
    SpatialGrid,
    warheadBurst,
    World,
    type Blueprint,
    type ModuleSpec,
} from "../sim/index.js";
import { COOK_OFF_CHANCE, cookOff, cookOffChance, detonateWarheads, tripped, WARHEAD_FILL_RATE } from "../sim/warheads.js";

/**
 * A warhead is a sealed tank that fires by blowing itself apart: its walls fly
 * out as fragments across its spread when an enemy comes within its standoff.
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
    standoff: 20,
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

    it("keeps its spread in degrees in a file", () => {
        const file = serialiseBlueprint(CARRIER);
        const raw = (file["modules"] as Record<string, unknown>[])[2]!;
        expect(raw["spread"]).toBeCloseTo(60, 9);
        expect(raw["standoff"]).toBe(20);
        const back = parseBlueprint(file).modules[2] as ModuleSpec;
        expect(back.spread).toBeCloseTo(Math.PI / 3, 12);
        expect(back.fragments).toBe(8);
    });

    it("trips on an enemy ahead within its standoff, and on nothing else", () => {
        const fuzed = (s: ReturnType<typeof scene>) =>
            tripped(s.ships, s.world.bodies, s.grid, s.carrier, s.b, s.design, s.head, s.world.dt);
        // The target's core reaches 2 m back from its centre; the warhead's centre is 1.5 m ahead of the carrier's.
        expect(fuzed(scene(1.5 + 2 + 15))).toBe(true);
        expect(fuzed(scene(1.5 + 2 + 40))).toBe(false);
        // Behind it, close.
        expect(fuzed(scene(-15))).toBe(false);
        // Off to the side, outside a 60° cone.
        expect(fuzed(scene(5, 15))).toBe(false);
        // A friend ahead is no target.
        expect(fuzed(scene(1.5 + 2 + 15, 0, 1))).toBe(false);
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
                { ...HEAD, x: 2, standoff: 20 },
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

    it("does nothing with nobody in reach", () => {
        const s = scene(500);
        expect(detonateWarheads(s.ships, s.world, s.projectiles, s.grid)).toBe(0);
        expect(s.projectiles.count).toBe(0);
    });
});
