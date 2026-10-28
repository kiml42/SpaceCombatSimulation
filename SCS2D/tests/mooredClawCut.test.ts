import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFleet } from "../sim/index.js";
import { customBattle } from "../scenarios/customBattle.js";
import { DEFAULT_SKIRMISH_SETTINGS, roundBattle } from "../scenarios/skirmish.js";

/** A skirmish round in which a ship moored to a rock by its claw has its hull cut down, at 283 s. */
const ROUND = JSON.parse(readFileSync(new URL("./fixtures/moored-claw-cut.json", import.meta.url), "utf8")) as {
    seed: number;
    settings: Record<string, unknown>;
    player: unknown;
    enemy: unknown;
};

describe("a moored ship cut down", () => {
    it("keeps its claw with its hull, or lets go of the rock if the claw went", { timeout: 300_000 }, () => {
        const battle = customBattle(
            roundBattle(parseFleet(ROUND.player), parseFleet(ROUND.enemy), ROUND.seed, { ...DEFAULT_SKIRMISH_SETTINGS, ...ROUND.settings }),
        );
        // Past step 16,983, where the claw's index, left as it was in the uncut hull, ran off its end.
        expect(() => {
            for (let step = 0; step < 17_100; step++) battle.step();
        }).not.toThrow();
    });
});
