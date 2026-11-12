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
    // ships=6 inFlight=14 p.fired=95 p.hits=318 b.fired=0 b.hits=0 contacts=8 bumps=0 crashes=1 severed=4 culled=0 scrap=33.6t · 365.1 µs/step
    duel: "60280b45",
    // ships=3 inFlight=1 p.fired=45 p.hits=173 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=41.6t · 165.2 µs/step
    railDuel: "e2db273a",
    // ships=3 inFlight=10 p.fired=139 p.hits=418 b.fired=2 b.hits=225 contacts=238 bumps=0 crashes=0 severed=2 culled=0 scrap=132.6t · 261.8 µs/step
    lanceDuel: "721ac4a8",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=39 b.hits=3317 contacts=127 bumps=1 crashes=5 severed=4 culled=0 scrap=47.4t · 291.7 µs/step
    beamDuel: "412649ca",
    // ships=2 inFlight=13 p.fired=54 p.hits=170 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=6.4t · 118.0 µs/step
    binary: "51b7fa83",
    // ships=6 inFlight=0 p.fired=74 p.hits=289 b.fired=0 b.hits=0 contacts=202 bumps=1 crashes=17 severed=8 culled=0 scrap=41.1t · 101.9 µs/step
    kernels: "e2ac1ad1",
    // ships=14 inFlight=9 p.fired=186 p.hits=821 b.fired=0 b.hits=0 contacts=1087 bumps=4 crashes=0 severed=8 culled=0 scrap=31.0t · 180.9 µs/step
    asteroidField: "8729f724",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-25.1t · 40.7 µs/step
    mining: "ba358939",
    // ships=13 inFlight=24 p.fired=337 p.hits=947 b.fired=0 b.hits=0 contacts=5440 bumps=5 crashes=12 severed=2 culled=0 scrap=102.7t · 2742.4 µs/step
    rivalMines: "9be1163e",
    // ships=22 inFlight=14 p.fired=100 p.hits=97 b.fired=0 b.hits=0 contacts=76 bumps=0 crashes=0 severed=1 culled=1 scrap=4.9t · 979.1 µs/step
    swarm: "88678080",
    // ships=302 inFlight=86 p.fired=234 p.hits=286 b.fired=0 b.hits=0 contacts=66 bumps=0 crashes=15 severed=7 culled=7 scrap=28.7t · 28873.3 µs/step
    superSwarm: "b5196cb3",
    // ships=12 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=543 contacts=95 bumps=2 crashes=7 severed=1 culled=0 scrap=19.4t · 178.5 µs/step
    torpedoes: "8cd71e2a",
    // ships=2 inFlight=0 p.fired=39 p.hits=184 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=2.5t · 105.3 µs/step
    ordering: "1a112715",
    // ships=11 inFlight=0 p.fired=83 p.hits=363 b.fired=9 b.hits=586 contacts=5 bumps=0 crashes=1 severed=1 culled=0 scrap=90.4t · 329.8 µs/step
    standoff: "2919cf62",
    // ships=17 inFlight=0 p.fired=133 p.hits=556 b.fired=30 b.hits=2175 contacts=205 bumps=2 crashes=10 severed=9 culled=0 scrap=125.9t · 286.8 µs/step
    column: "083eb0a2",
    // ships=5 inFlight=0 p.fired=9 p.hits=67 b.fired=0 b.hits=0 contacts=898 bumps=7 crashes=1 severed=8 culled=3 scrap=50.2t · 225.7 µs/step
    split: "b4400026",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 severed=0 culled=0 scrap=64849.3t · 2070.2 µs/step
    crash: "bd8c5319",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=1210 contacts=1648 bumps=1 crashes=1 severed=2 culled=0 scrap=19.5t · 306.2 µs/step
    torchRun: "3d70d326",
    // ships=5 inFlight=37 p.fired=161 p.hits=766 b.fired=0 b.hits=0 contacts=22 bumps=3 crashes=0 severed=4 culled=0 scrap=33.0t · 179.0 µs/step
    hooked: "9b83cc64",
    // ships=6 inFlight=0 p.fired=33 p.hits=294 b.fired=0 b.hits=0 contacts=52 bumps=1 crashes=0 severed=4 culled=0 scrap=14.1t · 84.1 µs/step
    broadside: "6921c18e",
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
    // ships=5 inFlight=0 p.fired=19 p.hits=66 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.4t · 156.6 µs/step
    rearm: "e558169f",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=11 bumps=2 crashes=0 severed=2 culled=0 scrap=0.2t · 59.6 µs/step
    tanker: "f2dde2c5",
    // ships=21 inFlight=0 p.fired=10 p.hits=32 b.fired=243 b.hits=7470 contacts=182 bumps=1 crashes=14 severed=4 culled=2 scrap=18.3t · 954.3 µs/step
    beamCarrier: "a576b964",
    // ships=2 inFlight=0 p.fired=54 p.hits=185 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 49.1 µs/step
    passes: "5b1498c4",
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
