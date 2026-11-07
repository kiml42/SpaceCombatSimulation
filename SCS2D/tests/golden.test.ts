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
    // ships=3 inFlight=0 p.fired=102 p.hits=341 b.fired=0 b.hits=0 contacts=16 severed=1 culled=1 scrap=45.2t · 303.0 µs/step
    duel: "40f057a9",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=53 b.hits=2390 contacts=0 severed=0 culled=0 scrap=20.8t · 251.9 µs/step
    beamDuel: "c5e5abd9",
    // ships=2 inFlight=24 p.fired=74 p.hits=198 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=5.9t · 102.1 µs/step
    binary: "76272482",
    // ships=9 inFlight=0 p.fired=92 p.hits=333 b.fired=0 b.hits=0 contacts=271 severed=16 culled=0 scrap=142.7t · 137.6 µs/step
    kernels: "2a52a245",
    // ships=13 inFlight=0 p.fired=27 p.hits=118 b.fired=0 b.hits=0 contacts=225 severed=2 culled=0 scrap=16.2t · 93.6 µs/step
    asteroidField: "e50c1a7b",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-25.1t · 47.1 µs/step
    mining: "acc415c4",
    // ships=13 inFlight=0 p.fired=510 p.hits=1483 b.fired=0 b.hits=0 contacts=3710 severed=5 culled=1 scrap=106.2t · 2290.0 µs/step
    rivalMines: "cb696e6b",
    // ships=22 inFlight=43 p.fired=142 p.hits=178 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.9t · 665.3 µs/step
    swarm: "e14708fe",
    // ships=304 inFlight=217 p.fired=945 p.hits=1247 b.fired=0 b.hits=0 contacts=21 severed=5 culled=3 scrap=25.7t · 17954.2 µs/step
    superSwarm: "6e8b424c",
    // ships=12 inFlight=0 p.fired=0 p.hits=0 b.fired=9 b.hits=569 contacts=77 severed=0 culled=0 scrap=22.2t · 180.6 µs/step
    torpedoes: "dcfd5ffd",
    // ships=2 inFlight=0 p.fired=46 p.hits=228 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.1t · 89.6 µs/step
    ordering: "d3ee5f85",
    // ships=11 inFlight=0 p.fired=116 p.hits=358 b.fired=15 b.hits=533 contacts=4 severed=1 culled=0 scrap=86.5t · 270.8 µs/step
    standoff: "c73653cf",
    // ships=13 inFlight=17 p.fired=238 p.hits=794 b.fired=32 b.hits=2186 contacts=933 severed=14 culled=1 scrap=270.8t · 287.3 µs/step
    column: "d4c8d635",
    // ships=5 inFlight=2 p.fired=17 p.hits=62 b.fired=0 b.hits=0 contacts=917 severed=9 culled=3 scrap=42.9t · 190.9 µs/step
    split: "aeba786d",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 severed=0 culled=0 scrap=64439.8t · 2798.4 µs/step
    crash: "e8aaa276",
    // ships=18 inFlight=0 p.fired=0 p.hits=0 b.fired=11 b.hits=898 contacts=1681 severed=20 culled=0 scrap=111.1t · 247.5 µs/step
    torchRun: "e836277b",
    // ships=6 inFlight=24 p.fired=97 p.hits=293 b.fired=0 b.hits=0 contacts=616 severed=6 culled=0 scrap=31.3t · 165.1 µs/step
    hooked: "41f8bb44",
    // ships=4 inFlight=0 p.fired=13 p.hits=144 b.fired=0 b.hits=0 contacts=66 severed=2 culled=0 scrap=11.8t · 69.6 µs/step
    broadside: "beb2a35e",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 severed=0 culled=0 scrap=5.0t · 26.8 µs/step
    salvageRun: "d12e716c",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 20.1 µs/step
    refitting: "052760e4",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=144.1t · 90.9 µs/step
    catamaranRefits: "eb579586",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=26 severed=3 culled=0 scrap=108.2t · 61.9 µs/step
    scavenge: "578836e5",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.2t · 62.4 µs/step
    padRebuild: "c311dfbd",
    // ships=5 inFlight=0 p.fired=19 p.hits=63 b.fired=0 b.hits=0 contacts=34 severed=0 culled=0 scrap=1.6t · 101.3 µs/step
    factory: "fdec7f63",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.0t · 201.2 µs/step
    shipyard: "88a913a8",
    // ships=5 inFlight=0 p.fired=17 p.hits=62 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.3t · 128.4 µs/step
    rearm: "8bf84697",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=10 severed=2 culled=0 scrap=0.2t · 80.5 µs/step
    tanker: "5d78cc4f",
    // ships=20 inFlight=0 p.fired=13 p.hits=38 b.fired=196 b.hits=5794 contacts=3 severed=1 culled=0 scrap=9.0t · 827.9 µs/step
    beamCarrier: "0e701235",
    // ships=2 inFlight=4 p.fired=55 p.hits=173 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=8.5t · 41.6 µs/step
    passes: "8c5f8702",
    // ships=2 inFlight=4 p.fired=10 p.hits=33 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=8.5t · 50.7 µs/step
    circling: "865ddcc9",
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
