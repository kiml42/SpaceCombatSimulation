import { describe, expect, it } from "vitest";
import { formatChecksum } from "../sim/checksum.js";
import { SCENARIO_TIMEOUT, SCENARIOS, type ScenarioName } from "./fixtures/scenarios.js";

/**
 * Golden tests: the simulation's behaviour, pinned.
 *
 * The determinism tests prove the simulation is reproducible. These prove it
 * still does the *same thing* it did before — which is the check that makes it
 * safe to refactor the physics after months away. Run `npm test` from a cold
 * checkout: if these pass, the simulation is intact.
 *
 * WHEN ONE FAILS, that means simulated behaviour changed. Either:
 *
 *   - You did not mean to change it. Find out what you broke. Do not touch
 *     this file.
 *   - You did mean to change it. Say so in the commit message, run
 *     `npm run golden`, and paste the new constants in. Never copy a value out
 *     of a test failure without understanding what moved: doing that turns a
 *     regression into the new expected behaviour, permanently.
 *
 * Generated with: npm run golden
 */

const GOLDEN: Record<ScenarioName, string> = {
    orbit: "0441a895",
    tumble: "52118178",
    gunnery: "b2054d50",
    duel: "f5558b88",
    beamDuel: "f21608a6",
    binary: "1bf85068",
    kernels: "81e39626",
    asteroidField: "f6f91086",
    mining: "ab3363b4",
    rivalMines: "a7bb0d29",
    swarm: "e978ac59",
    superSwarm: "6df092a9",
    torpedoes: "12f0cd5b",
    ordering: "40f2221a",
    split: "13417e20",
    column: "92a36e73",
    standoff: "ce1be976",
    torchRun: "a3d85fd5",
    hooked: "c17d21d0",
    broadside: "61790eb4",
    salvageRun: "45d6c014",
    mending: "f63e907e",
    refitting: "052760e4",
    catamaranRefits: "eb579586",
    scavenge: "fde3de85",
    padRebuild: "e144c19e",
    factory: "6fb2fa8d",
    shipyard: "4b069157",
    rearm: "dd016907",
    tanker: "b262ee58",
    beamCarrier: "a1a2a01a",
    passes: "816d4617",
    circling: "efc282e6",
};

describe("golden scenarios", () => {
    for (const name of Object.keys(GOLDEN) as ScenarioName[]) {
        const scenario = SCENARIOS[name];

        it(
            `${name} matches its recorded checksum after ${scenario.steps} steps`,
            () => {
                const run = scenario.build();
                for (let i = 0; i < scenario.steps; i++) run.step();
                expect(formatChecksum(run.checksum())).toBe(GOLDEN[name]);
            },
            SCENARIO_TIMEOUT,
        );
    }

    it("covers every fixture scenario", () => {
        // A new scenario without a golden constant would otherwise go unnoticed.
        expect(Object.keys(GOLDEN).sort()).toEqual(Object.keys(SCENARIOS).sort());
    });
});
