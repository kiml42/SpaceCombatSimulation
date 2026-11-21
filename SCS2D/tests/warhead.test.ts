import { describe, expect, it } from "vitest";
import {
    billOf,
    compileBlueprint,
    EXPLOSIVE_YIELD,
    FUEL_DENSITY,
    moduleStats,
    parseBlueprint,
    Projectiles,
    serialiseBlueprint,
    Ships,
    SpatialGrid,
    warheadBurst,
    World,
    type Blueprint,
    type ModuleSpec,
} from "../sim/index.js";
import { detonateWarheads, tripped } from "../sim/warheads.js";

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

function scene(targetX: number, targetY = 0, team = 2) {
    const world = new World({ dt: 1 / 60, seed: 5 });
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
    it("is a tank sealed shut: walls for casing, fuel for charge, billed as fuel", () => {
        const stats = moduleStats(HEAD);
        expect(stats.fuel).toBe(0);
        expect(stats.explosive).toBeCloseTo(stats.interior * FUEL_DENSITY, 9);
        expect(stats.mass).toBeCloseTo(stats.structureMass + stats.explosive, 9);
        const design = compileBlueprint(CARRIER);
        const placed = design.modules.find((m) => m.spec.kind === "warhead")!;
        const without = billOf(compileBlueprint({ ...CARRIER, modules: CARRIER.modules.slice(0, 2) }));
        expect(billOf(design).fuel - without.fuel).toBeCloseTo(placed.stats.explosive, 6);
    });

    it("gives its fragments the share of its yield its spread takes, no less than a shaped liner's", () => {
        const stats = moduleStats(HEAD);
        const narrow = warheadBurst(HEAD, stats);
        expect(narrow.focus).toBe(0.2);
        expect(narrow.energy).toBeCloseTo(stats.explosive * EXPLOSIVE_YIELD, 3);
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
        expect(s.projectiles.count).toBe(8);
        // All ahead, inside the cone, as seen from the carrier.
        const vx = s.world.bodies.vx[s.b]!;
        const vy = s.world.bodies.vy[s.b]!;
        let mass = 0;
        for (let i = 0; i < s.projectiles.highWater; i++) {
            if (s.projectiles.alive[i] === 0) continue;
            mass += s.projectiles.mass[i]!;
            const bearing = Math.atan2(s.projectiles.vy[i]! - vy, s.projectiles.vx[i]! - vx);
            expect(Math.abs(bearing)).toBeLessThan(Math.PI / 6 + 0.05);
        }
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

    it("does nothing with nobody in reach", () => {
        const s = scene(500);
        expect(detonateWarheads(s.ships, s.world, s.projectiles, s.grid)).toBe(0);
        expect(s.projectiles.count).toBe(0);
    });
});
