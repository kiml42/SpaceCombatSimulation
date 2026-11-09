import { describe, expect, it } from "vitest";
import { ROCK_CRIPPLINGS, rockLanding } from "../scenarios/rockLanding.js";

describe("Rock Landing", () => {
    it("sets out with every carrier moored to the rock, a fighter for each of their pads, and every pad free", () => {
        const run = rockLanding();
        const bodies = run.world.bodies;
        for (const o of run.outposts) {
            expect(run.ships.isMoored(o)).toBe(true);
            expect(run.ships.parkedOn[o]).toBe(run.rock);
        }
        const pads = run.outposts.reduce((n, o) => n + run.ships.designs[o]!.modules.filter((m) => m.spec.kind === "pad").length, 0);
        expect(run.fighters).toHaveLength(pads);
        for (const f of run.fighters) expect(run.ships.parkedCarrier(f)).toBe(-1);
        // Moored where it was put: still on the rock a minute on, under its pull.
        for (let t = 0; t < 60 * 60; t++) run.step();
        for (const o of run.outposts) expect(run.ships.isMoored(o)).toBe(true);
        const rb = bodies.indexOf(run.ships.body(run.rock));
        for (const o of run.outposts) {
            const ob = bodies.indexOf(run.ships.body(o));
            expect(Math.hypot(bodies.x[ob]! - bodies.x[rb]!, bodies.y[ob]! - bodies.y[rb]!)).toBeLessThan(300);
        }
    });

    it("has an undamaged Raider and every Raider crippling as variants", () => {
        expect(ROCK_CRIPPLINGS[0]!.lost).toEqual([]);
        expect(new Set(ROCK_CRIPPLINGS.map((c) => c.name)).size).toBe(ROCK_CRIPPLINGS.length);
    });
});
