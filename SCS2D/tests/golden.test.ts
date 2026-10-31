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
    duel: "198b971f",
    beamDuel: "d8cc48c0",
    binary: "c1aca395",
    kernels: "1b5dc861",
    asteroidField: "dd3cc4d3",
    mining: "ab3363b4",
    rivalMines: "cb922a02",
    swarm: "276227cd",
    superSwarm: "d54c94d2",
    torpedoes: "21cf01b7",
    ordering: "377a154b",
    split: "390d217b",
    column: "4f274454",
    standoff: "637aa1c1",
    torchRun: "8be84a27",
    hooked: "610cd2e4",
    broadside: "d49c35c4",
    salvageRun: "45d6c014",
    mending: "f63e907e",
    refitting: "052760e4",
    catamaranRefits: "eb579586",
    scavenge: "fde3de85",
    padRebuild: "e144c19e",
    factory: "51e07b05",
    shipyard: "4b069157",
    rearm: "6b68485b",
    tanker: "b262ee58",
    beamCarrier: "a9a1b3ae",
    passes: "cdf13844",
    circling: "ccd5aad6",
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
