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
    // ships=15 inFlight=21 p.fired=192 p.hits=738 b.fired=0 b.hits=0 contacts=870 bumps=2 crashes=0 severed=7 culled=0 scrap=28.8t · 81.9 µs/step
    asteroidField: "94403cb5",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-25.1t · 40.7 µs/step
    mining: "ba358939",
    // ships=15 inFlight=2 p.fired=133 p.hits=448 b.fired=0 b.hits=0 contacts=273 bumps=2 crashes=2 severed=4 culled=4 scrap=123.6t · 1344.3 µs/step
    rivalMines: "5b86faf0",
    // ships=23 inFlight=47 p.fired=130 p.hits=101 b.fired=0 b.hits=0 contacts=115 bumps=2 crashes=0 severed=2 culled=0 scrap=2.5t · 528.9 µs/step
    swarm: "75fba420",
    // ships=303 inFlight=204 p.fired=660 p.hits=800 b.fired=0 b.hits=0 contacts=196 bumps=2 crashes=8 severed=11 culled=10 scrap=47.7t · 15879.8 µs/step
    superSwarm: "850c1455",
    // ships=11 inFlight=0 p.fired=0 p.hits=0 b.fired=9 b.hits=761 contacts=26 bumps=0 crashes=7 severed=0 culled=0 scrap=19.1t · 107.3 µs/step
    torpedoes: "9a0042cb",
    // ships=2 inFlight=39 p.fired=62 p.hits=224 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=3.1t · 86.7 µs/step
    ordering: "972ba439",
    // ships=11 inFlight=0 p.fired=58 p.hits=233 b.fired=13 b.hits=661 contacts=61 bumps=2 crashes=0 severed=1 culled=0 scrap=99.2t · 170.8 µs/step
    standoff: "e57af10d",
    // ships=32 inFlight=0 p.fired=134 p.hits=569 b.fired=35 b.hits=2311 contacts=63 bumps=4 crashes=9 severed=24 culled=0 scrap=141.6t · 291.4 µs/step
    column: "10871d38",
    // ships=5 inFlight=0 p.fired=5 p.hits=33 b.fired=0 b.hits=0 contacts=1062 bumps=7 crashes=1 severed=10 culled=4 scrap=44.8t · 124.1 µs/step
    split: "28a70d2b",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=985 bumps=0 crashes=6 severed=4 culled=0 scrap=62476.8t · 1653.0 µs/step
    crash: "3a81def3",
    // ships=8 inFlight=0 p.fired=0 p.hits=0 b.fired=9 b.hits=1387 contacts=1697 bumps=2 crashes=2 severed=3 culled=0 scrap=23.0t · 262.2 µs/step
    torchRun: "d23d2f58",
    // ships=7 inFlight=33 p.fired=164 p.hits=727 b.fired=0 b.hits=0 contacts=385 bumps=3 crashes=0 severed=6 culled=0 scrap=33.7t · 107.6 µs/step
    hooked: "4b214fe8",
    // ships=2 inFlight=0 p.fired=43 p.hits=301 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.2t · 77.9 µs/step
    broadside: "a7d7c05c",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 severed=0 culled=0 scrap=5.1t · 25.6 µs/step
    salvageRun: "804efd7f",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 22.0 µs/step
    refitting: "35d04241",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=144.1t · 62.3 µs/step
    catamaranRefits: "452aa874",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=46 bumps=1 crashes=2 severed=3 culled=0 scrap=108.3t · 56.4 µs/step
    scavenge: "daa190be",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 42.5 µs/step
    padRebuild: "6d03b457",
    // ships=5 inFlight=0 p.fired=22 p.hits=86 b.fired=0 b.hits=0 contacts=34 bumps=0 crashes=0 severed=0 culled=0 scrap=1.6t · 95.6 µs/step
    factory: "f62b447c",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=32.1t · 115.5 µs/step
    shipyard: "c06171cb",
    // ships=5 inFlight=0 p.fired=17 p.hits=63 b.fired=0 b.hits=0 contacts=47 bumps=0 crashes=1 severed=0 culled=0 scrap=0.5t · 71.8 µs/step
    rearm: "236e1d77",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=6 bumps=3 crashes=0 severed=2 culled=0 scrap=0.1t · 90.0 µs/step
    tanker: "4de63ce8",
    // ships=21 inFlight=0 p.fired=32 p.hits=118 b.fired=217 b.hits=6949 contacts=83 bumps=1 crashes=10 severed=2 culled=0 scrap=19.4t · 490.6 µs/step
    beamCarrier: "1bfec549",
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
