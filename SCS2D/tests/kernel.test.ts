import { describe, expect, it } from "vitest";
import {
    bareKernel,
    blueprintProblem,
    compileBlueprint,
    kernelModule,
    kernelOutline,
    moduleOutline,
    moduleProblem,
    moduleStats,
    NEUTRAL_TEAM,
    strike,
    Terminal,
    World,
} from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { kernels } from "../scenarios/kernels.js";
import { CORVETTE } from "../scenarios/blueprints.js";

const OUTLINE = kernelOutline(100, [1, 0.9, 1.05, 0.95, 1, 0.85, 1.1, 0.95]);

describe("a kernel", () => {
    it("is a convex polygon of five to twelve corners, centred on its middle", () => {
        expect(moduleProblem(kernelModule(OUTLINE))).toBeNull();
        expect(moduleProblem(kernelModule([50, 0, 0, 50, -50, 0, 0, -50]))).toMatch(/5 to 12 corners/);
        // A corner pulled in past its neighbours makes a dent.
        expect(moduleProblem(kernelModule(kernelOutline(50, [1, 1, 0.2, 1, 1, 1])))).toMatch(/convex/);
        const off = kernelModule(OUTLINE);
        expect(moduleProblem({ ...off, vertices: off.vertices!.map((v, i) => (i % 2 === 0 ? v + 5 : v)) })).toMatch(/centred/);
    });

    it("is outlined by all its corners", () => {
        const out: number[] = [];
        expect(moduleOutline(kernelModule(OUTLINE), out)).toBe(8);
        expect(out.length).toBe(16);
    });

    it("is solid, so a round stops in it", () => {
        const stats = moduleStats(kernelModule(OUTLINE));
        expect(stats.wallThickness).toBeGreaterThan(100);
        expect(stats.interior).toBe(0);
        // A heavy shell, fast and square on.
        expect(strike(50, 0.2, 1500, stats.wallThickness, 0).outcome).not.toBe(Terminal.Perforate);
    });

    it("is a hull that needs no core", () => {
        expect(blueprintProblem(bareKernel("Rock", OUTLINE))).toBeNull();
        expect(blueprintProblem({ name: "Plate", modules: [{ kind: "structure", x: 0, y: 0, length: 4, width: 4 }] })).toMatch(/no core/);
    });
});

describe("a pinned body", () => {
    it("keeps no mass whatever it is given, and still turns", () => {
        const world = new World({ dt: 0.1, seed: 1 });
        const id = world.spawn({ mass: 100, inertia: 50, pinned: true });
        const b = world.bodies;
        world.bodies.setMass(id, 500);
        expect(b.mass[b.indexOf(id)]).toBe(0);
        expect(b.invMass[b.indexOf(id)]).toBe(0);
        expect(b.invInertia[b.indexOf(id)]).toBeCloseTo(1 / 50, 12);
    });
});

describe("a kernel riding its rail", () => {
    it("stays on its well through a fight, turning as it was set", () => {
        const run = kernels();
        const b = run.world.bodies;
        for (let t = 0; t < 3000; t++) {
            run.step();
            if (t % 250 !== 0) continue;
            for (let k = 0; k < 2; k++) {
                const i = b.indexOf(run.ships.body(run.asteroids[k]!));
                // Its kernel is all of it, so its middle is the body's.
                expect(b.x[i]).toBeCloseTo(run.wells[k]!.x, 9);
                expect(b.y[i]).toBeCloseTo(run.wells[k]!.y, 9);
                expect(b.mass[i]).toBe(0);
            }
        }
    });

    it("turns back a ship flown into it, takes no harm, and stays put", () => {
        const well = { x: 0, y: 0, gm: 0 };
        const run = makeBattle({ seed: 1, wells: [well], pilots: false }, (ships, world, wells) => {
            const rock = ships.spawn(world, {
                design: compileBlueprint(bareKernel("Rock", OUTLINE)),
                rides: wells[0]!,
                team: NEUTRAL_TEAM,
            });
            const ship = ships.spawn(world, { design: compileBlueprint(CORVETTE), x: -300, y: 0, vx: 40, team: 0 });
            return { rock, ship };
        });
        const b = run.world.bodies;
        const rock = b.indexOf(run.ships.body(run.rock));
        const ship = b.indexOf(run.ships.body(run.ship));
        for (let t = 0; t < 900; t++) run.step();
        expect(run.totalContacts).toBeGreaterThan(0);
        expect(b.vx[ship]).toBeLessThan(0);
        expect(b.x[rock]).toBe(0);
        expect(b.y[rock]).toBe(0);
        expect(run.ships.damage.integrity(rock, 0)).toBe(1);
    });
});
