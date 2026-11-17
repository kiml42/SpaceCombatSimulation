import { describe, expect, it } from "vitest";
import { ROCK_CRIPPLINGS, rockLanding } from "../scenarios/rockLanding.js";
import { SCENE_SEED } from "../scenarios/scenes.js";

/** How long a fighter is given to come home, seconds. */
const LIMIT = 150;

/**
 * The Raiders left able to fly home: a turn far weaker one way, or the main gone with the thrusters to push instead.
 * Those that spin one way or are turned by their own pushes are the scene's to show, not this test's to judge.
 */
const STEERABLE = ["Raider, undamaged", "Raider, one turn far weaker [1, 8]", "Raider, one turn far weaker [3, 7]", "Raider, no main [4]"];

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

    it.each(STEERABLE)(
        "has a %s come home, one fighter to one Replicator moored to the rock, under its pull",
        (name) => {
            const crippling = ROCK_CRIPPLINGS.find((c) => c.name === name)!;
            const run = rockLanding(SCENE_SEED, crippling, 1, 1);
            const fighter = run.fighters[0]!;
            for (let t = 0; t < LIMIT * 60 && run.ships.parkedCarrier(fighter) !== run.outposts[0]; t++) run.step();
            expect(run.ships.parkedCarrier(fighter)).toBe(run.outposts[0]);
        },
        120_000,
    );

    it("has an undamaged Raider and every Raider crippling as variants", () => {
        expect(ROCK_CRIPPLINGS[0]!.lost).toEqual([]);
        expect(new Set(ROCK_CRIPPLINGS.map((c) => c.name)).size).toBe(ROCK_CRIPPLINGS.length);
        for (const name of STEERABLE) expect(ROCK_CRIPPLINGS.map((c) => c.name)).toContain(name);
    });
});
