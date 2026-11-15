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
 *   - You did mean to change it. Say so in the commit message and run
 *     `pnpm golden`, which writes the new constants in and reports what moved.
 *     Never take a new value without understanding what moved: doing that turns
 *     a regression into the new expected behaviour, permanently.
 *
 * Above each constant is how that battle came out and its time per step when
 * the constant was recorded: the baseline `pnpm golden` reports against.
 *
 * Written by: pnpm golden
 */

const GOLDEN: Record<ScenarioName, string> = {
    // bodies=1 · 0.6 µs/step
    orbit: "0441a895",
    // bodies=8 · 3.5 µs/step
    tumble: "52118178",
    // bodies=9 inFlight=65 projectilesPending=0 projectileHits=1688 · 14.7 µs/step
    gunnery: "b2054d50",
    // ships=3 inFlight=22 p.fired=83 p.hits=267 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=15.7t · 141.6 µs/step
    duel: "4b19254d",
    // ships=4 inFlight=1 p.fired=47 p.hits=194 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=64.0t · 110.3 µs/step
    railDuel: "1f1ea699",
    // ships=3 inFlight=7 p.fired=143 p.hits=406 b.fired=2 b.hits=227 contacts=238 bumps=0 crashes=0 severed=2 culled=0 scrap=131.8t · 125.2 µs/step
    lanceDuel: "cfb6c3da",
    // ships=8 inFlight=0 p.fired=0 p.hits=0 b.fired=40 b.hits=3671 contacts=80 bumps=0 crashes=3 severed=5 culled=0 scrap=58.4t · 127.0 µs/step
    beamDuel: "96ac58e3",
    // ships=2 inFlight=21 p.fired=68 p.hits=212 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=12.2t · 62.2 µs/step
    binary: "2c7daa21",
    // ships=5 inFlight=0 p.fired=105 p.hits=536 b.fired=0 b.hits=0 contacts=240 bumps=1 crashes=16 severed=7 culled=0 scrap=35.8t · 55.0 µs/step
    kernels: "9038992b",
    // ships=13 inFlight=10 p.fired=181 p.hits=677 b.fired=0 b.hits=0 contacts=120 bumps=0 crashes=0 severed=2 culled=0 scrap=37.7t · 70.4 µs/step
    asteroidField: "d84d3c9b",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 32.5 µs/step
    mining: "e6410e3f",
    // ships=17 inFlight=19 p.fired=598 p.hits=1603 b.fired=0 b.hits=0 contacts=2842 bumps=2 crashes=8 severed=1 culled=0 scrap=110.5t · 1446.0 µs/step
    rivalMines: "1180be8a",
    // ships=22 inFlight=39 p.fired=96 p.hits=71 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=2.0t · 515.6 µs/step
    swarm: "d7b6fe0b",
    // ships=302 inFlight=178 p.fired=885 p.hits=861 b.fired=0 b.hits=0 contacts=22 bumps=1 crashes=6 severed=3 culled=3 scrap=36.2t · 17952.8 µs/step
    superSwarm: "6f65340a",
    // ships=13 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=815 contacts=27 bumps=0 crashes=8 severed=0 culled=0 scrap=25.6t · 104.9 µs/step
    torpedoes: "e254348c",
    // ships=2 inFlight=30 p.fired=63 p.hits=226 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=3.1t · 67.8 µs/step
    ordering: "dd94b4e1",
    // ships=10 inFlight=2 p.fired=60 p.hits=257 b.fired=12 b.hits=994 contacts=4 bumps=0 crashes=1 severed=1 culled=1 scrap=107.9t · 180.8 µs/step
    standoff: "d3d3784a",
    // ships=17 inFlight=0 p.fired=138 p.hits=636 b.fired=41 b.hits=2817 contacts=520 bumps=2 crashes=10 severed=11 culled=0 scrap=132.9t · 204.4 µs/step
    column: "2b88dd71",
    // ships=4 inFlight=0 p.fired=8 p.hits=61 b.fired=0 b.hits=0 contacts=282 bumps=9 crashes=2 severed=7 culled=4 scrap=48.2t · 89.9 µs/step
    split: "91eb7079",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=79761.6t · 1678.5 µs/step
    crash: "9c1584bf",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=10 b.hits=1326 contacts=8 bumps=0 crashes=1 severed=2 culled=0 scrap=16.2t · 159.9 µs/step
    torchRun: "6e1f5016",
    // ships=4 inFlight=57 p.fired=186 p.hits=718 b.fired=0 b.hits=0 contacts=12 bumps=1 crashes=0 severed=1 culled=0 scrap=25.5t · 106.6 µs/step
    hooked: "f15a00e1",
    // ships=2 inFlight=0 p.fired=43 p.hits=290 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.8t · 54.8 µs/step
    broadside: "23bec723",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=1 crashes=0 severed=0 culled=0 scrap=5.1t · 21.2 µs/step
    salvageRun: "d4a588c2",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 22.0 µs/step
    refitting: "35d04241",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=144.1t · 64.0 µs/step
    catamaranRefits: "95f51e51",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=41 bumps=3 crashes=0 severed=3 culled=0 scrap=108.3t · 41.1 µs/step
    scavenge: "66198670",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 51.6 µs/step
    padRebuild: "36a4f7f7",
    // ships=5 inFlight=0 p.fired=23 p.hits=88 b.fired=0 b.hits=0 contacts=38 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 80.3 µs/step
    factory: "d1daba43",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 91.9 µs/step
    shipyard: "288b36ba",
    // ships=5 inFlight=0 p.fired=17 p.hits=66 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.4t · 79.9 µs/step
    rearm: "13b01f7b",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=10 bumps=2 crashes=0 severed=2 culled=0 scrap=0.2t · 63.3 µs/step
    tanker: "920b7ef2",
    // ships=20 inFlight=0 p.fired=4 p.hits=8 b.fired=296 b.hits=8637 contacts=68 bumps=0 crashes=5 severed=1 culled=0 scrap=15.7t · 528.3 µs/step
    beamCarrier: "2d1f44cb",
    // ships=2 inFlight=0 p.fired=58 p.hits=199 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 33.3 µs/step
    passes: "91964cf7",
    // ships=2 inFlight=0 p.fired=2 p.hits=18 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 48.6 µs/step
    circling: "895e4183",
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
