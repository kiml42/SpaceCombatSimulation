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
    // ships=3 inFlight=11 p.fired=124 p.hits=372 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=48.4t · 165.2 µs/step
    duel: "d2c82d34",
    // ships=4 inFlight=4 p.fired=47 p.hits=185 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=80.8t · 125.3 µs/step
    railDuel: "0a9baff7",
    // ships=5 inFlight=4 p.fired=157 p.hits=611 b.fired=2 b.hits=246 contacts=514 severed=3 culled=0 scrap=132.3t · 120.9 µs/step
    lanceDuel: "f8d37aa5",
    // ships=11 inFlight=0 p.fired=0 p.hits=0 b.fired=37 b.hits=2317 contacts=206 severed=8 culled=0 scrap=44.3t · 211.7 µs/step
    beamDuel: "b0b387aa",
    // ships=2 inFlight=28 p.fired=77 p.hits=227 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=7.2t · 56.5 µs/step
    binary: "c565c277",
    // ships=6 inFlight=0 p.fired=126 p.hits=460 b.fired=0 b.hits=0 contacts=158 severed=8 culled=0 scrap=77.1t · 50.3 µs/step
    kernels: "3c1207ce",
    // ships=12 inFlight=11 p.fired=63 p.hits=190 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=29.8t · 68.7 µs/step
    asteroidField: "c1c058b4",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-25.1t · 48.7 µs/step
    mining: "eb814177",
    // ships=12 inFlight=2 p.fired=395 p.hits=1120 b.fired=0 b.hits=0 contacts=308 severed=3 culled=2 scrap=144.4t · 1459.6 µs/step
    rivalMines: "c40ee66f",
    // ships=22 inFlight=38 p.fired=143 p.hits=175 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=2.0t · 472.9 µs/step
    swarm: "389ff9cb",
    // ships=303 inFlight=209 p.fired=942 p.hits=1157 b.fired=0 b.hits=0 contacts=172 severed=8 culled=7 scrap=38.9t · 13656.7 µs/step
    superSwarm: "e66a91d6",
    // ships=13 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=730 contacts=109 severed=1 culled=0 scrap=25.2t · 140.4 µs/step
    torpedoes: "c4f0f558",
    // ships=2 inFlight=0 p.fired=45 p.hits=229 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.2t · 62.0 µs/step
    ordering: "f01eb36a",
    // ships=15 inFlight=0 p.fired=103 p.hits=311 b.fired=12 b.hits=473 contacts=45 severed=5 culled=0 scrap=100.6t · 179.3 µs/step
    standoff: "ac7dd57c",
    // ships=11 inFlight=8 p.fired=137 p.hits=485 b.fired=21 b.hits=2463 contacts=935 severed=14 culled=0 scrap=239.5t · 179.9 µs/step
    column: "0b77d349",
    // ships=5 inFlight=1 p.fired=17 p.hits=102 b.fired=0 b.hits=0 contacts=930 severed=8 culled=4 scrap=58.3t · 125.2 µs/step
    split: "8ce63e2b",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 severed=0 culled=0 scrap=64507.5t · 1568.7 µs/step
    crash: "833f30c7",
    // ships=14 inFlight=0 p.fired=0 p.hits=0 b.fired=7 b.hits=947 contacts=542 severed=10 culled=0 scrap=134.9t · 230.1 µs/step
    torchRun: "3ba83455",
    // ships=6 inFlight=21 p.fired=136 p.hits=437 b.fired=0 b.hits=0 contacts=438 severed=5 culled=0 scrap=79.4t · 113.0 µs/step
    hooked: "c392d51b",
    // ships=2 inFlight=0 p.fired=24 p.hits=151 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.8t · 47.0 µs/step
    broadside: "647eeab9",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 severed=0 culled=0 scrap=5.1t · 18.8 µs/step
    salvageRun: "394e018d",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 22.0 µs/step
    refitting: "35d04241",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=144.1t · 60.9 µs/step
    catamaranRefits: "f7f9e852",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=32 severed=3 culled=0 scrap=108.3t · 41.3 µs/step
    scavenge: "ad9da543",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.2t · 44.0 µs/step
    padRebuild: "1e06e459",
    // ships=5 inFlight=0 p.fired=20 p.hits=69 b.fired=0 b.hits=0 contacts=34 severed=0 culled=0 scrap=1.6t · 66.4 µs/step
    factory: "1e2ead36",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.1t · 128.1 µs/step
    shipyard: "ed2487e5",
    // ships=5 inFlight=0 p.fired=14 p.hits=56 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.4t · 68.4 µs/step
    rearm: "a30e7c22",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=12 severed=2 culled=0 scrap=0.2t · 90.0 µs/step
    tanker: "69ab665b",
    // ships=22 inFlight=0 p.fired=60 p.hits=176 b.fired=218 b.hits=7806 contacts=97 severed=3 culled=0 scrap=15.5t · 502.4 µs/step
    beamCarrier: "afb517b7",
    // ships=2 inFlight=0 p.fired=54 p.hits=182 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.3t · 28.9 µs/step
    passes: "8ad44a2b",
    // ships=2 inFlight=0 p.fired=2 p.hits=8 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.3t · 46.5 µs/step
    circling: "87851cbe",
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
