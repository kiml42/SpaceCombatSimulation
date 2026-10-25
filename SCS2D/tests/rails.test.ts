import { describe, expect, it } from "vitest";
import {
    eccentricAnomaly,
    gravityWell,
    orbitPeriod,
    orbitState,
    Railway,
    World,
    type Orbit,
    type Rails,
    type WellSpec,
} from "../sim/index.js";
import { sin } from "../sim/math.js";
import { binary, BINARY_RAILS } from "../scenarios/binary.js";

describe("Kepler's equation", () => {
    it("is solved at every eccentricity a rail may have", () => {
        for (const e of [0, 0.1, 0.5, 0.8, 0.95, 0.99]) {
            for (let m = -3.1; m <= 3.1; m += 0.1) {
                const E = eccentricAnomaly(m, e);
                expect(E - e * sin(E)).toBeCloseTo(m, 10);
            }
        }
    });
});

describe("an orbit on rails", () => {
    const GM = 3e6;
    const ORBIT: Orbit = { a: 2000, e: 0.6, periapsis: 0.7, phase: 2 };
    const out = new Float64Array(4);

    it("comes back to where it started after a period", () => {
        orbitState(ORBIT, GM, 0, out);
        const start = [...out];
        orbitState(ORBIT, GM, orbitPeriod(ORBIT, GM), out);
        for (let k = 0; k < 4; k++) expect(out[k]).toBeCloseTo(start[k]!, 6);
    });

    it("is the path a body falling round a fixed well follows", () => {
        // A test particle given the rail's start, integrated by the world: the two
        // should agree, since they are the same orbit worked out two ways.
        const world = new World({ dt: 0.05, seed: 1 });
        world.addForceProvider(gravityWell({ x: 0, y: 0, gm: GM }));
        orbitState(ORBIT, GM, 0, out);
        world.spawn({ x: out[0]!, y: out[1]!, vx: out[2]!, vy: out[3]!, mass: 1, inertia: 1, radius: 1 });
        const steps = Math.round(orbitPeriod(ORBIT, GM) / 0.05 / 3);
        world.run(steps);
        orbitState(ORBIT, GM, steps * 0.05, out);
        const b = world.bodies;
        expect(Math.hypot(b.x[0]! - out[0]!, b.y[0]! - out[1]!)).toBeLessThan(2);
        expect(Math.hypot(b.vx[0]! - out[2]!, b.vy[0]! - out[3]!)).toBeLessThan(0.05);
    });

    it("turns the other way when retrograde", () => {
        orbitState({ a: 1000, e: 0 }, GM, 0, out);
        const prograde = out[0]! * out[3]! - out[1]! * out[2]!;
        orbitState({ a: 1000, e: 0, retrograde: true }, GM, 0, out);
        const retrograde = out[0]! * out[3]! - out[1]! * out[2]!;
        expect(prograde).toBeGreaterThan(0);
        expect(retrograde).toBeLessThan(0);
    });
});

describe("a railway", () => {
    const wells = (): WellSpec[] => [
        { x: 0, y: 0, gm: 4e6 },
        { x: 0, y: 0, gm: 1e6 },
        { x: 0, y: 0, gm: 1e4 },
    ];
    // A moon round the lighter of a pair, the pair round its shared centre.
    const RAILS: Rails = {
        x: 100,
        y: -50,
        root: {
            pair: [{ well: 0 }, { pair: [{ well: 1 }, { well: 2 }], orbit: { a: 300, e: 0.2, phase: 1 } }],
            orbit: { a: 3000, e: 0.5, periapsis: 1 },
        },
    };

    it("keeps every pair about a shared centre that does not move", () => {
        const w = wells();
        const railway = new Railway(RAILS, w);
        for (const t of [0, 17, 250, 1234.5]) {
            railway.at(t);
            const gm = w[0]!.gm + w[1]!.gm + w[2]!.gm;
            const cx = (w[0]!.x * w[0]!.gm + w[1]!.x * w[1]!.gm + w[2]!.x * w[2]!.gm) / gm;
            const cy = (w[0]!.y * w[0]!.gm + w[1]!.y * w[1]!.gm + w[2]!.y * w[2]!.gm) / gm;
            expect(cx).toBeCloseTo(100, 6);
            expect(cy).toBeCloseTo(-50, 6);
            let px = 0;
            let py = 0;
            for (let k = 0; k < 3; k++) {
                px += w[k]!.vx! * w[k]!.gm;
                py += w[k]!.vy! * w[k]!.gm;
            }
            expect(px / gm).toBeCloseTo(0, 6);
            expect(py / gm).toBeCloseTo(0, 6);
        }
    });

    it("gives each well the velocity its position changes at", () => {
        const w = wells();
        const railway = new Railway(RAILS, w);
        const h = 1e-3;
        railway.at(40 - h);
        const before = w.map((well) => [well.x, well.y]);
        railway.at(40 + h);
        const after = w.map((well) => [well.x, well.y]);
        railway.at(40);
        for (let k = 0; k < 3; k++) {
            expect((after[k]![0]! - before[k]![0]!) / (2 * h)).toBeCloseTo(w[k]!.vx!, 3);
            expect((after[k]![1]! - before[k]![1]!) / (2 * h)).toBeCloseTo(w[k]!.vy!, 3);
        }
    });

    it("moves the wells a battle pulls with, rounds and all", () => {
        const run = binary();
        const start = run.wells.map((well) => [well.x, well.y]);
        for (let k = 0; k < 600; k++) run.step();
        // Ten seconds on: each well has moved, and is where its rail says.
        const railway = new Railway(
            BINARY_RAILS,
            run.wells.map((w) => ({ ...w })),
        );
        railway.at(run.world.tick * run.dt);
        for (let k = 0; k < 2; k++) {
            expect(Math.hypot(run.wells[k]!.x - start[k]![0]!, run.wells[k]!.y - start[k]![1]!)).toBeGreaterThan(10);
            expect(run.wells[k]!.x).toBeCloseTo(railway.wells[k]!.x, 9);
            expect(run.wells[k]!.y).toBeCloseTo(railway.wells[k]!.y, 9);
        }
    });

    it("starts a binary at its widest, above and below the fight", () => {
        const run = binary();
        expect(run.wells[0]!.x).toBeCloseTo(0, 6);
        expect(run.wells[1]!.x).toBeCloseTo(0, 6);
        expect(Math.abs(run.wells[0]!.y - run.wells[1]!.y)).toBeCloseTo(4000, 6);
    });
});
