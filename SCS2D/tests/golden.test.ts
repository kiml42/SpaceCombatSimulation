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
    // ships=7 inFlight=15 p.fired=144 p.hits=412 b.fired=0 b.hits=0 contacts=18 bumps=0 crashes=1 severed=4 culled=0 scrap=64.0t · 369.1 µs/step
    duel: "a18912eb",
    // ships=4 inFlight=1 p.fired=46 p.hits=150 b.fired=0 b.hits=0 contacts=2 bumps=1 crashes=0 severed=1 culled=0 scrap=21.1t · 232.7 µs/step
    railDuel: "41bfd831",
    // ships=5 inFlight=16 p.fired=140 p.hits=448 b.fired=2 b.hits=230 contacts=1 bumps=1 crashes=0 severed=3 culled=0 scrap=135.0t · 231.8 µs/step
    lanceDuel: "a72d61ef",
    // ships=9 inFlight=0 p.fired=0 p.hits=0 b.fired=39 b.hits=3460 contacts=9 bumps=0 crashes=3 severed=6 culled=0 scrap=55.3t · 152.6 µs/step
    beamDuel: "f631e59c",
    // ships=2 inFlight=13 p.fired=58 p.hits=169 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=7.8t · 121.8 µs/step
    binary: "6be91af1",
    // ships=5 inFlight=0 p.fired=86 p.hits=355 b.fired=0 b.hits=0 contacts=234 bumps=3 crashes=19 severed=8 culled=0 scrap=39.0t · 104.4 µs/step
    kernels: "42663f84",
    // ships=15 inFlight=8 p.fired=186 p.hits=871 b.fired=0 b.hits=0 contacts=839 bumps=5 crashes=0 severed=8 culled=0 scrap=31.4t · 144.0 µs/step
    asteroidField: "b020503c",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-25.1t · 40.7 µs/step
    mining: "ba358939",
    // ships=14 inFlight=0 p.fired=711 p.hits=1757 b.fired=0 b.hits=0 contacts=24 bumps=2 crashes=4 severed=2 culled=2 scrap=13.0t · 2441.6 µs/step
    rivalMines: "19410665",
    // ships=22 inFlight=15 p.fired=114 p.hits=108 b.fired=0 b.hits=0 contacts=76 bumps=0 crashes=0 severed=1 culled=1 scrap=4.9t · 969.4 µs/step
    swarm: "d252a244",
    // ships=303 inFlight=101 p.fired=274 p.hits=257 b.fired=0 b.hits=0 contacts=70 bumps=1 crashes=16 severed=8 culled=7 scrap=29.7t · 25965.0 µs/step
    superSwarm: "aede86e5",
    // ships=14 inFlight=0 p.fired=0 p.hits=0 b.fired=7 b.hits=653 contacts=215 severed=1 culled=0 scrap=21.1t · 112.6 µs/step
    torpedoes: "f3e51aa3",
    // ships=2 inFlight=15 p.fired=53 p.hits=225 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=3.1t · 105.0 µs/step
    ordering: "840086c7",
    // ships=12 inFlight=0 p.fired=79 p.hits=307 b.fired=10 b.hits=700 contacts=11 bumps=1 crashes=0 severed=2 culled=0 scrap=101.6t · 349.3 µs/step
    standoff: "cc74ac60",
    // ships=17 inFlight=0 p.fired=132 p.hits=535 b.fired=34 b.hits=2381 contacts=160 bumps=2 crashes=4 severed=10 culled=0 scrap=124.6t · 292.1 µs/step
    column: "d2789e62",
    // ships=5 inFlight=0 p.fired=9 p.hits=75 b.fired=0 b.hits=0 contacts=898 bumps=7 crashes=1 severed=8 culled=3 scrap=41.5t · 223.2 µs/step
    split: "23380118",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 severed=0 culled=0 scrap=64849.3t · 2070.2 µs/step
    crash: "bd8c5319",
    // ships=12 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=1191 contacts=1338 severed=7 culled=0 scrap=53.3t · 219.6 µs/step
    torchRun: "6a69f0f1",
    // ships=5 inFlight=46 p.fired=208 p.hits=995 b.fired=0 b.hits=0 contacts=20 bumps=3 crashes=0 severed=4 culled=0 scrap=35.5t · 181.4 µs/step
    hooked: "c8133d86",
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
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 42.5 µs/step
    padRebuild: "6d03b457",
    // ships=5 inFlight=0 p.fired=22 p.hits=86 b.fired=0 b.hits=0 contacts=34 severed=0 culled=0 scrap=1.6t · 84.9 µs/step
    factory: "c8d8f8f2",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.1t · 128.1 µs/step
    shipyard: "ed2487e5",
    // ships=5 inFlight=0 p.fired=19 p.hits=66 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.4t · 126.5 µs/step
    rearm: "672d603c",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=11 bumps=2 crashes=0 severed=2 culled=0 scrap=0.2t · 59.6 µs/step
    tanker: "f2dde2c5",
    // ships=21 inFlight=0 p.fired=16 p.hits=40 b.fired=253 b.hits=8367 contacts=87 bumps=1 crashes=10 severed=3 culled=1 scrap=19.9t · 1058.7 µs/step
    beamCarrier: "c17b90d2",
    // ships=2 inFlight=0 p.fired=56 p.hits=186 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 50.1 µs/step
    passes: "8fe96119",
    // ships=2 inFlight=0 p.fired=2 p.hits=12 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 72.0 µs/step
    circling: "5959197d",
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
