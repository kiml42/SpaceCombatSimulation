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
    // ships=4 inFlight=0 p.fired=85 p.hits=249 b.fired=0 b.hits=0 contacts=56 severed=1 culled=0 scrap=47.5t · 240.5 µs/step
    duel: "0ff8cb1b",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=53 b.hits=2646 contacts=0 severed=0 culled=0 scrap=21.2t · 207.0 µs/step
    beamDuel: "563db521",
    // ships=2 inFlight=19 p.fired=63 p.hits=188 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=5.4t · 78.4 µs/step
    binary: "62526054",
    // ships=13 inFlight=0 p.fired=111 p.hits=439 b.fired=0 b.hits=0 contacts=9865 severed=22 culled=0 scrap=25.7t · 137.3 µs/step
    kernels: "8d94f835",
    // ships=12 inFlight=6 p.fired=117 p.hits=426 b.fired=0 b.hits=0 contacts=122 severed=1 culled=0 scrap=23.2t · 157.5 µs/step
    asteroidField: "724c4a31",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=134 severed=0 culled=0 scrap=-26.1t · 43.9 µs/step
    mining: "db287179",
    // ships=11 inFlight=0 p.fired=274 p.hits=752 b.fired=0 b.hits=0 contacts=15488 severed=1 culled=1 scrap=76.6t · 1636.5 µs/step
    rivalMines: "7339a105",
    // ships=22 inFlight=46 p.fired=137 p.hits=162 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=2.0t · 962.4 µs/step
    swarm: "dee07648",
    // ships=304 inFlight=298 p.fired=1286 p.hits=1525 b.fired=0 b.hits=0 contacts=271 severed=2 culled=0 scrap=23.3t · 23915.2 µs/step
    superSwarm: "3fe82ab1",
    // ships=13 inFlight=0 p.fired=0 p.hits=0 b.fired=15 b.hits=817 contacts=74 severed=24 culled=24 scrap=23.9t · 233.3 µs/step
    torpedoes: "2f75a935",
    // ships=2 inFlight=0 p.fired=46 p.hits=230 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.3t · 108.3 µs/step
    ordering: "746c8efb",
    // ships=17 inFlight=0 p.fired=96 p.hits=329 b.fired=15 b.hits=637 contacts=526 severed=7 culled=0 scrap=90.1t · 364.8 µs/step
    standoff: "effdf936",
    // ships=19 inFlight=0 p.fired=136 p.hits=473 b.fired=34 b.hits=2397 contacts=1651 severed=20 culled=0 scrap=176.7t · 308.5 µs/step
    column: "008a3e73",
    // ships=4 inFlight=1 p.fired=17 p.hits=86 b.fired=0 b.hits=0 contacts=895 severed=8 culled=6 scrap=63.7t · 291.2 µs/step
    split: "08d48444",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=10 b.hits=891 contacts=1950 severed=20 culled=0 scrap=123.4t · 337.4 µs/step
    torchRun: "849c3223",
    // ships=6 inFlight=26 p.fired=164 p.hits=886 b.fired=0 b.hits=0 contacts=10 severed=2 culled=0 scrap=39.4t · 224.4 µs/step
    hooked: "f026b9ba",
    // ships=3 inFlight=0 p.fired=24 p.hits=227 b.fired=0 b.hits=0 contacts=120 severed=2 culled=0 scrap=13.5t · 56.7 µs/step
    broadside: "dfe3b0d7",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 severed=0 culled=0 scrap=4.7t · 18.3 µs/step
    salvageRun: "ee7cba03",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 20.1 µs/step
    refitting: "052760e4",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=144.1t · 90.9 µs/step
    catamaranRefits: "eb579586",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=30 severed=3 culled=0 scrap=108.7t · 52.6 µs/step
    scavenge: "77fcc5a9",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.2t · 69.4 µs/step
    padRebuild: "e144c19e",
    // ships=4 inFlight=0 p.fired=19 p.hits=72 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.0t · 45.1 µs/step
    factory: "c3bc0966",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.0t · 121.9 µs/step
    shipyard: "4b069157",
    // ships=5 inFlight=0 p.fired=16 p.hits=61 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.4t · 102.4 µs/step
    rearm: "b1b26e42",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=10 severed=2 culled=0 scrap=0.2t · 85.1 µs/step
    tanker: "b262ee58",
    // ships=20 inFlight=0 p.fired=11 p.hits=12 b.fired=209 b.hits=5549 contacts=49 severed=4 culled=1 scrap=12.6t · 554.2 µs/step
    beamCarrier: "fef52909",
    // ships=2 inFlight=1 p.fired=76 p.hits=257 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=8.5t · 57.6 µs/step
    passes: "01d12228",
    // ships=2 inFlight=4 p.fired=10 p.hits=33 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=8.5t · 38.1 µs/step
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
