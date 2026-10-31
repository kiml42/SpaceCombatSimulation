import { describe, expect, it } from "vitest";
import { compileBlueprint, DEFAULT_DOCTRINE, edgeFade, math } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { CATAMARAN } from "../scenarios/blueprints.js";
import { circling } from "../scenarios/passes.js";

/** A band's edges are soft (`bandFade`): the pull back in eases in across each edge. */

describe("the fade at a band's edge", () => {
    it("runs from nothing inside it to all of it outside, a half on the edge", () => {
        expect(edgeFade(-10, 100, 0.1)).toBe(0);
        expect(edgeFade(0, 100, 0.1)).toBe(0.5);
        expect(edgeFade(10, 100, 0.1)).toBe(1);
        expect(edgeFade(-5, 100, 0.1)).toBeGreaterThan(0);
        expect(edgeFade(-5, 100, 0.1)).toBeLessThan(0.5);
    });

    it("is a hard edge at zero", () => {
        expect(edgeFade(-1e-9, 100, 0)).toBe(0);
        expect(edgeFade(1e-9, 100, 0)).toBe(1);
    });

    it("is soft by default", () => {
        expect(DEFAULT_DOCTRINE.approach.bandFade).toBeGreaterThan(0);
    });
});

describe("two ships covering each other and keeping clear of each other", () => {
    it("settle where the two cancel, without flying apart past their station", () => {
        const design = compileBlueprint(CATAMARAN);
        const run = makeBattle({ seed: 1, projectiles: 16, beams: 4 }, (ships, world) => {
            ships.spawn(world, { design, x: 0, y: 0, angle: math.PI / 2, team: 0 });
            ships.spawn(world, { design, x: 2.4 * design.radius, y: 0, angle: math.PI / 2, team: 0 });
        });
        const bodies = run.world.bodies;
        const gap = (): number => {
            const a = bodies.indexOf(run.ships.body(0));
            const b = bodies.indexOf(run.ships.body(1));
            return Math.hypot(bodies.x[a]! - bodies.x[b]!, bodies.y[a]! - bodies.y[b]!);
        };
        const station = run.ships.coverBandOf(0, 1);
        let widest = 0;
        for (let s = 0; s < 60 * 60; s++) {
            run.step();
            widest = Math.max(widest, gap());
        }
        expect(widest).toBeLessThan(station);
        const settled = gap();
        for (let s = 0; s < 10 * 60; s++) run.step();
        expect(Math.abs(gap() - settled)).toBeLessThan(1);
        expect(settled).toBeGreaterThan(0.9 * station);
    });
});

describe("a fighter circling at its band's outer edge", () => {
    it("burns steadily rather than in bursts", () => {
        const run = circling();
        const ships = run.ships;
        const engines = ships.currentStructure(1).engines.length;
        let low = Infinity;
        let high = 0;
        for (let s = 1; s <= 100 * 60; s++) {
            run.step();
            if (s < 70 * 60) continue;
            let throttle = 0;
            for (let e = 0; e < engines; e++) throttle += ships.throttleOf(1, e);
            low = Math.min(low, throttle / engines);
            high = Math.max(high, throttle / engines);
        }
        expect(low).toBeGreaterThan(0.05);
        expect(high).toBeLessThan(0.3);
    });
});
