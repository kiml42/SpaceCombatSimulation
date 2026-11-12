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
    // ships=4 inFlight=13 p.fired=112 p.hits=367 b.fired=0 b.hits=0 contacts=155 bumps=1 crashes=0 severed=3 culled=0 scrap=72.7t · 288.3 µs/step
    duel: "75fa4be9",
    // ships=3 inFlight=1 p.fired=44 p.hits=187 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=44.3t · 133.3 µs/step
    railDuel: "9026cee6",
    // ships=4 inFlight=10 p.fired=141 p.hits=444 b.fired=2 b.hits=235 contacts=238 bumps=0 crashes=0 severed=3 culled=0 scrap=141.6t · 181.0 µs/step
    lanceDuel: "9f9942da",
    // ships=9 inFlight=0 p.fired=0 p.hits=0 b.fired=40 b.hits=3602 contacts=3 bumps=0 crashes=3 severed=6 culled=0 scrap=55.9t · 221.2 µs/step
    beamDuel: "337aab03",
    // ships=2 inFlight=13 p.fired=57 p.hits=159 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.2t · 99.4 µs/step
    binary: "6ce9d685",
    // ships=9 inFlight=0 p.fired=90 p.hits=465 b.fired=0 b.hits=0 contacts=50 bumps=0 crashes=7 severed=8 culled=0 scrap=28.2t · 85.8 µs/step
    kernels: "6ab0c5ca",
    // ships=15 inFlight=0 p.fired=179 p.hits=711 b.fired=0 b.hits=0 contacts=865 bumps=2 crashes=0 severed=7 culled=0 scrap=28.3t · 128.7 µs/step
    asteroidField: "69d881cf",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-25.1t · 40.7 µs/step
    mining: "ba358939",
    // ships=13 inFlight=0 p.fired=293 p.hits=879 b.fired=0 b.hits=0 contacts=56 bumps=3 crashes=2 severed=1 culled=1 scrap=142.7t · 2083.8 µs/step
    rivalMines: "52268883",
    // ships=22 inFlight=37 p.fired=121 p.hits=83 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=1 scrap=5.4t · 753.3 µs/step
    swarm: "79c43f51",
    // ships=302 inFlight=229 p.fired=498 p.hits=602 b.fired=0 b.hits=0 contacts=26 bumps=0 crashes=7 severed=0 culled=0 scrap=19.4t · 19667.3 µs/step
    superSwarm: "63c97fec",
    // ships=13 inFlight=0 p.fired=0 p.hits=0 b.fired=7 b.hits=410 contacts=142 bumps=0 crashes=9 severed=1 culled=0 scrap=21.0t · 144.8 µs/step
    torpedoes: "5c3659a8",
    // ships=2 inFlight=39 p.fired=62 p.hits=224 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=3.1t · 86.7 µs/step
    ordering: "972ba439",
    // ships=10 inFlight=0 p.fired=65 p.hits=264 b.fired=13 b.hits=728 contacts=120 bumps=1 crashes=0 severed=1 culled=0 scrap=107.6t · 238.1 µs/step
    standoff: "4062a774",
    // ships=32 inFlight=0 p.fired=134 p.hits=569 b.fired=35 b.hits=2311 contacts=63 bumps=4 crashes=9 severed=24 culled=0 scrap=141.6t · 291.4 µs/step
    column: "10871d38",
    // ships=5 inFlight=0 p.fired=5 p.hits=26 b.fired=0 b.hits=0 contacts=925 bumps=7 crashes=1 severed=8 culled=3 scrap=40.0t · 167.8 µs/step
    split: "db003aff",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 severed=0 culled=0 scrap=64849.3t · 2070.2 µs/step
    crash: "bd8c5319",
    // ships=8 inFlight=0 p.fired=0 p.hits=0 b.fired=9 b.hits=1387 contacts=1697 bumps=2 crashes=2 severed=3 culled=0 scrap=23.0t · 262.2 µs/step
    torchRun: "d23d2f58",
    // ships=9 inFlight=31 p.fired=158 p.hits=725 b.fired=0 b.hits=0 contacts=32 bumps=2 crashes=0 severed=7 culled=0 scrap=34.1t · 179.5 µs/step
    hooked: "eb99d891",
    // ships=2 inFlight=0 p.fired=43 p.hits=301 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.2t · 77.9 µs/step
    broadside: "a7d7c05c",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 severed=0 culled=0 scrap=5.1t · 25.6 µs/step
    salvageRun: "804efd7f",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 22.0 µs/step
    refitting: "35d04241",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=144.1t · 87.6 µs/step
    catamaranRefits: "2b1a25f3",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=46 bumps=1 crashes=2 severed=3 culled=0 scrap=108.3t · 56.4 µs/step
    scavenge: "daa190be",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 42.5 µs/step
    padRebuild: "6d03b457",
    // ships=5 inFlight=0 p.fired=22 p.hits=86 b.fired=0 b.hits=0 contacts=34 bumps=0 crashes=0 severed=0 culled=0 scrap=1.6t · 95.6 µs/step
    factory: "f62b447c",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=32.1t · 115.5 µs/step
    shipyard: "c06171cb",
    // ships=5 inFlight=0 p.fired=17 p.hits=63 b.fired=0 b.hits=0 contacts=35 bumps=0 crashes=1 severed=0 culled=0 scrap=0.4t · 122.0 µs/step
    rearm: "37971fe8",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=6 bumps=3 crashes=0 severed=2 culled=0 scrap=0.1t · 90.0 µs/step
    tanker: "4de63ce8",
    // ships=21 inFlight=0 p.fired=27 p.hits=90 b.fired=243 b.hits=6986 contacts=110 bumps=1 crashes=12 severed=2 culled=0 scrap=14.6t · 927.9 µs/step
    beamCarrier: "df31736c",
    // ships=2 inFlight=0 p.fired=54 p.hits=191 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 45.1 µs/step
    passes: "792bb71e",
    // ships=2 inFlight=0 p.fired=2 p.hits=22 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 90.0 µs/step
    circling: "bdc6bd8c",
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
