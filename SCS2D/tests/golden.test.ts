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
    // ships=4 inFlight=2 p.fired=111 p.hits=340 b.fired=0 b.hits=0 contacts=316 severed=2 culled=0 scrap=34.5t · 299.4 µs/step
    duel: "0e5681dd",
    // ships=3 inFlight=4 p.fired=58 p.hits=212 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=32.2t · 180.2 µs/step
    railDuel: "eaaeedee",
    // ships=5 inFlight=4 p.fired=157 p.hits=611 b.fired=2 b.hits=246 contacts=514 severed=3 culled=0 scrap=132.3t · 232.9 µs/step
    lanceDuel: "6e3a21ba",
    // ships=11 inFlight=0 p.fired=0 p.hits=0 b.fired=37 b.hits=2317 contacts=206 severed=8 culled=0 scrap=44.3t · 211.7 µs/step
    beamDuel: "b0b387aa",
    // ships=2 inFlight=23 p.fired=78 p.hits=216 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=10.2t · 120.5 µs/step
    binary: "76c001bd",
    // ships=6 inFlight=0 p.fired=135 p.hits=630 b.fired=0 b.hits=0 contacts=356 severed=9 culled=0 scrap=37.7t · 149.2 µs/step
    kernels: "acd9ad55",
    // ships=14 inFlight=0 p.fired=102 p.hits=349 b.fired=0 b.hits=0 contacts=174 severed=3 culled=0 scrap=31.9t · 99.6 µs/step
    asteroidField: "71e45d14",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-25.1t · 48.7 µs/step
    mining: "eb814177",
    // ships=15 inFlight=16 p.fired=1036 p.hits=3171 b.fired=0 b.hits=0 contacts=3365 severed=1 culled=1 scrap=61.7t · 2240.3 µs/step
    rivalMines: "cd4a83ce",
    // ships=22 inFlight=18 p.fired=118 p.hits=141 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=2.1t · 664.1 µs/step
    swarm: "d62e0a22",
    // ships=304 inFlight=233 p.fired=984 p.hits=1288 b.fired=0 b.hits=0 contacts=185 severed=6 culled=4 scrap=32.9t · 16245.2 µs/step
    superSwarm: "9105edaa",
    // ships=12 inFlight=0 p.fired=0 p.hits=0 b.fired=6 b.hits=528 contacts=80 severed=1 culled=0 scrap=26.9t · 123.6 µs/step
    torpedoes: "bc4485b1",
    // ships=2 inFlight=0 p.fired=45 p.hits=228 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.2t · 163.6 µs/step
    ordering: "4bcaf0b3",
    // ships=15 inFlight=0 p.fired=105 p.hits=313 b.fired=12 b.hits=476 contacts=112 severed=5 culled=0 scrap=103.1t · 261.3 µs/step
    standoff: "6d4852e0",
    // ships=15 inFlight=1 p.fired=187 p.hits=609 b.fired=18 b.hits=1977 contacts=1122 severed=19 culled=0 scrap=200.0t · 276.1 µs/step
    column: "126730ce",
    // ships=5 inFlight=1 p.fired=19 p.hits=95 b.fired=0 b.hits=0 contacts=995 severed=8 culled=4 scrap=54.1t · 225.9 µs/step
    split: "02ae4d97",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 severed=0 culled=0 scrap=64507.6t · 2971.9 µs/step
    crash: "4048d492",
    // ships=21 inFlight=0 p.fired=0 p.hits=0 b.fired=6 b.hits=811 contacts=1287 severed=21 culled=0 scrap=193.4t · 241.9 µs/step
    torchRun: "26500083",
    // ships=8 inFlight=29 p.fired=141 p.hits=405 b.fired=0 b.hits=0 contacts=483 severed=7 culled=0 scrap=92.0t · 166.6 µs/step
    hooked: "9192978f",
    // ships=2 inFlight=0 p.fired=24 p.hits=151 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.8t · 66.7 µs/step
    broadside: "c9b592b4",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 severed=0 culled=0 scrap=5.0t · 27.7 µs/step
    salvageRun: "3f83894b",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 22.0 µs/step
    refitting: "35d04241",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=144.1t · 95.0 µs/step
    catamaranRefits: "d9b363a3",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=32 severed=3 culled=0 scrap=108.3t · 62.4 µs/step
    scavenge: "72e16f6f",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.2t · 75.6 µs/step
    padRebuild: "f9b9e208",
    // ships=5 inFlight=0 p.fired=19 p.hits=61 b.fired=0 b.hits=0 contacts=34 severed=0 culled=0 scrap=1.6t · 107.4 µs/step
    factory: "b309b069",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.1t · 128.1 µs/step
    shipyard: "ed2487e5",
    // ships=5 inFlight=0 p.fired=15 p.hits=60 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.4t · 121.8 µs/step
    rearm: "e70ff061",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=12 severed=2 culled=0 scrap=0.2t · 90.0 µs/step
    tanker: "69ab665b",
    // ships=20 inFlight=0 p.fired=7 p.hits=12 b.fired=215 b.hits=6892 contacts=59 severed=3 culled=1 scrap=16.4t · 708.2 µs/step
    beamCarrier: "984d3faa",
    // ships=2 inFlight=0 p.fired=54 p.hits=181 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.3t · 40.9 µs/step
    passes: "e721914a",
    // ships=2 inFlight=0 p.fired=2 p.hits=8 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.3t · 72.0 µs/step
    circling: "d757a70a",
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
