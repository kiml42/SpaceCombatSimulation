import { describe, expect, it } from "vitest";
import { ROCK_CRIPPLINGS, rockLanding } from "../scenarios/rockLanding.js";
import { SCENE_SEED } from "../scenarios/scenes.js";
import { landings } from "./landingRecord.js";

/**
 * The Rock Landing scene: that it sets out as it should, and, for every variant, when each fighter lands on
 * any of the moored Replicators, or that it has not by `LIMIT`, and how many contacts there were. Recorded in
 * `__snapshots__` as the goldens are, describing what happens rather than judging it, so a change either way
 * shows. After a deliberate change, re-record with `pnpm exec vitest run tests/rockLanding.test.ts -u`.
 */

/** How long each variant runs for at most, seconds. */
const LIMIT = 150;

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

    it.each(ROCK_CRIPPLINGS.map((crippling) => [crippling.name, crippling] as const))(
        "%s",
        (_, crippling) => {
            const run = rockLanding(SCENE_SEED, crippling);
            const home = (k: number): boolean => run.outposts.includes(run.ships.parkedCarrier(run.fighters[k]!));
            expect(landings(run, run.fighters, home, LIMIT)).toMatchSnapshot();
        },
        600_000,
    );

    it("has an undamaged Raider and every Raider crippling as variants", () => {
        expect(ROCK_CRIPPLINGS[0]!.lost).toEqual([]);
        expect(new Set(ROCK_CRIPPLINGS.map((c) => c.name)).size).toBe(ROCK_CRIPPLINGS.length);
    });
});
