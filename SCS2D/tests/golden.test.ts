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
    // ships=6 inFlight=15 p.fired=94 p.hits=311 b.fired=0 b.hits=0 contacts=8 bumps=0 crashes=1 severed=4 culled=0 scrap=32.4t · 308.4 µs/step
    duel: "a567ae4f",
    // ships=3 inFlight=1 p.fired=44 p.hits=195 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=42.9t · 153.2 µs/step
    railDuel: "e640aa30",
    // ships=3 inFlight=10 p.fired=139 p.hits=418 b.fired=2 b.hits=225 contacts=238 bumps=0 crashes=0 severed=2 culled=0 scrap=132.6t · 261.8 µs/step
    lanceDuel: "721ac4a8",
    // ships=6 inFlight=0 p.fired=0 p.hits=0 b.fired=40 b.hits=3375 contacts=102 bumps=0 crashes=4 severed=3 culled=0 scrap=47.4t · 257.2 µs/step
    beamDuel: "db9cac8b",
    // ships=2 inFlight=13 p.fired=55 p.hits=180 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.4t · 135.5 µs/step
    binary: "5aa9f6c1",
    // ships=4 inFlight=0 p.fired=164 p.hits=822 b.fired=0 b.hits=0 contacts=246 bumps=4 crashes=0 severed=3 culled=0 scrap=47.8t · 131.1 µs/step
    kernels: "764f8a48",
    // ships=17 inFlight=0 p.fired=185 p.hits=818 b.fired=0 b.hits=0 contacts=2965 bumps=5 crashes=1 severed=12 culled=0 scrap=35.7t · 153.6 µs/step
    asteroidField: "35423edf",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-25.1t · 40.7 µs/step
    mining: "ba358939",
    // ships=14 inFlight=0 p.fired=299 p.hits=900 b.fired=0 b.hits=0 contacts=56 bumps=3 crashes=2 severed=1 culled=1 scrap=139.8t · 2439.1 µs/step
    rivalMines: "44c1a703",
    // ships=22 inFlight=49 p.fired=110 p.hits=105 b.fired=0 b.hits=0 contacts=76 bumps=0 crashes=0 severed=1 culled=1 scrap=4.9t · 892.3 µs/step
    swarm: "7cb01328",
    // ships=303 inFlight=168 p.fired=350 p.hits=392 b.fired=0 b.hits=0 contacts=77 bumps=0 crashes=14 severed=3 culled=2 scrap=15.6t · 21435.8 µs/step
    superSwarm: "eed9f224",
    // ships=12 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=543 contacts=95 bumps=2 crashes=7 severed=1 culled=0 scrap=19.4t · 178.5 µs/step
    torpedoes: "8cd71e2a",
    // ships=2 inFlight=0 p.fired=42 p.hits=197 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=2.8t · 121.4 µs/step
    ordering: "46391eb3",
    // ships=11 inFlight=1 p.fired=80 p.hits=328 b.fired=10 b.hits=612 contacts=6 bumps=0 crashes=2 severed=2 culled=1 scrap=96.4t · 400.1 µs/step
    standoff: "827e9676",
    // ships=17 inFlight=0 p.fired=136 p.hits=582 b.fired=30 b.hits=1916 contacts=841 bumps=7 crashes=2 severed=12 culled=0 scrap=167.7t · 344.0 µs/step
    column: "c1a8d138",
    // ships=5 inFlight=0 p.fired=5 p.hits=33 b.fired=0 b.hits=0 contacts=925 bumps=7 crashes=1 severed=8 culled=3 scrap=41.6t · 226.9 µs/step
    split: "e052115b",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 severed=0 culled=0 scrap=64849.3t · 2070.2 µs/step
    crash: "bd8c5319",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=1210 contacts=1648 bumps=1 crashes=1 severed=2 culled=0 scrap=19.5t · 306.2 µs/step
    torchRun: "3d70d326",
    // ships=5 inFlight=21 p.fired=165 p.hits=772 b.fired=0 b.hits=0 contacts=30 bumps=3 crashes=0 severed=4 culled=0 scrap=32.7t · 188.9 µs/step
    hooked: "cf21b050",
    // ships=2 inFlight=0 p.fired=43 p.hits=293 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.7t · 85.3 µs/step
    broadside: "222cf58a",
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
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 42.5 µs/step
    padRebuild: "6d03b457",
    // ships=5 inFlight=0 p.fired=22 p.hits=86 b.fired=0 b.hits=0 contacts=34 severed=0 culled=0 scrap=1.6t · 84.9 µs/step
    factory: "c8d8f8f2",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.1t · 128.1 µs/step
    shipyard: "ed2487e5",
    // ships=5 inFlight=0 p.fired=19 p.hits=64 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.4t · 136.2 µs/step
    rearm: "903b9646",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=11 bumps=2 crashes=0 severed=2 culled=0 scrap=0.2t · 59.6 µs/step
    tanker: "f2dde2c5",
    // ships=21 inFlight=0 p.fired=13 p.hits=47 b.fired=250 b.hits=7653 contacts=86 bumps=1 crashes=15 severed=3 culled=1 scrap=18.3t · 924.5 µs/step
    beamCarrier: "86eaef74",
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
