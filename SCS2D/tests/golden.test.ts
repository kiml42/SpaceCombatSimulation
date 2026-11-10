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
    // ships=3 inFlight=11 p.fired=135 p.hits=407 b.fired=0 b.hits=0 contacts=152 severed=2 culled=1 scrap=34.0t · 239.5 µs/step
    duel: "6e4fb3e2",
    // ships=3 inFlight=1 p.fired=47 p.hits=142 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=32.4t · 130.4 µs/step
    railDuel: "787d04a9",
    // ships=5 inFlight=19 p.fired=163 p.hits=747 b.fired=1 b.hits=60 contacts=7 severed=2 culled=0 scrap=19.4t · 211.1 µs/step
    lanceDuel: "2c492d8d",
    // ships=8 inFlight=0 p.fired=0 p.hits=0 b.fired=41 b.hits=3446 contacts=92 severed=5 culled=0 scrap=54.0t · 163.9 µs/step
    beamDuel: "e6a81c9f",
    // ships=2 inFlight=10 p.fired=62 p.hits=221 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.6t · 74.3 µs/step
    binary: "c3b72e7a",
    // ships=6 inFlight=0 p.fired=125 p.hits=479 b.fired=0 b.hits=0 contacts=473 severed=9 culled=0 scrap=41.3t · 80.2 µs/step
    kernels: "1cc1a11e",
    // ships=12 inFlight=10 p.fired=184 p.hits=670 b.fired=0 b.hits=0 contacts=818 severed=4 culled=0 scrap=28.2t · 99.1 µs/step
    asteroidField: "b6119cb0",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-25.1t · 36.8 µs/step
    mining: "5a04cf24",
    // ships=14 inFlight=0 p.fired=515 p.hits=1445 b.fired=0 b.hits=0 contacts=1320 severed=2 culled=1 scrap=149.8t · 1912.2 µs/step
    rivalMines: "2e778c16",
    // ships=22 inFlight=35 p.fired=123 p.hits=105 b.fired=0 b.hits=0 contacts=76 severed=1 culled=1 scrap=5.0t · 647.2 µs/step
    swarm: "55516a1e",
    // ships=302 inFlight=69 p.fired=221 p.hits=226 b.fired=0 b.hits=0 contacts=66 severed=7 culled=7 scrap=29.5t · 17668.9 µs/step
    superSwarm: "741990eb",
    // ships=14 inFlight=0 p.fired=0 p.hits=0 b.fired=7 b.hits=653 contacts=215 severed=1 culled=0 scrap=21.1t · 112.6 µs/step
    torpedoes: "f3e51aa3",
    // ships=2 inFlight=0 p.fired=45 p.hits=228 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.2t · 64.7 µs/step
    ordering: "c3abdcf6",
    // ships=10 inFlight=0 p.fired=98 p.hits=295 b.fired=11 b.hits=659 contacts=0 severed=0 culled=0 scrap=94.8t · 220.1 µs/step
    standoff: "15ff03ce",
    // ships=10 inFlight=0 p.fired=108 p.hits=571 b.fired=36 b.hits=2499 contacts=298 severed=4 culled=0 scrap=105.8t · 260.3 µs/step
    column: "7aaeb355",
    // ships=4 inFlight=1 p.fired=12 p.hits=53 b.fired=0 b.hits=0 contacts=772 severed=8 culled=6 scrap=57.1t · 186.5 µs/step
    split: "d3f3ccc6",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 severed=0 culled=0 scrap=64849.3t · 2070.2 µs/step
    crash: "bd8c5319",
    // ships=12 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=1191 contacts=1338 severed=7 culled=0 scrap=53.3t · 219.6 µs/step
    torchRun: "6a69f0f1",
    // ships=4 inFlight=49 p.fired=241 p.hits=1008 b.fired=0 b.hits=0 contacts=153 severed=4 culled=0 scrap=67.3t · 144.3 µs/step
    hooked: "0b987697",
    // ships=6 inFlight=0 p.fired=32 p.hits=300 b.fired=0 b.hits=0 contacts=52 severed=4 culled=0 scrap=14.1t · 71.6 µs/step
    broadside: "a58f96e2",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 severed=0 culled=0 scrap=5.1t · 25.6 µs/step
    salvageRun: "804efd7f",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 22.0 µs/step
    refitting: "35d04241",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=144.1t · 87.6 µs/step
    catamaranRefits: "2b1a25f3",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=38 severed=3 culled=0 scrap=108.2t · 56.5 µs/step
    scavenge: "53e5831e",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.2t · 56.2 µs/step
    padRebuild: "6d03b457",
    // ships=5 inFlight=0 p.fired=22 p.hits=86 b.fired=0 b.hits=0 contacts=34 severed=0 culled=0 scrap=1.6t · 84.9 µs/step
    factory: "c8d8f8f2",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.1t · 128.1 µs/step
    shipyard: "ed2487e5",
    // ships=5 inFlight=0 p.fired=20 p.hits=67 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.3t · 90.1 µs/step
    rearm: "9d479408",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=9 severed=2 culled=0 scrap=0.2t · 67.4 µs/step
    tanker: "419f6cca",
    // ships=21 inFlight=0 p.fired=31 p.hits=41 b.fired=265 b.hits=9367 contacts=245 severed=3 culled=1 scrap=20.5t · 736.2 µs/step
    beamCarrier: "63f30f5d",
    // ships=2 inFlight=0 p.fired=55 p.hits=182 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.3t · 40.7 µs/step
    passes: "cee4ef1b",
    // ships=2 inFlight=0 p.fired=2 p.hits=8 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.3t · 67.4 µs/step
    circling: "3716c1d0",
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
