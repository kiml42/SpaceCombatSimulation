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
    // ships=4 inFlight=0 p.fired=85 p.hits=249 b.fired=0 b.hits=0 contacts=56 severed=1 culled=0 scrap=47.5t · 221.5 µs/step
    duel: "0ff8cb1b",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=53 b.hits=2646 contacts=0 severed=0 culled=0 scrap=21.2t · 207.0 µs/step
    beamDuel: "563db521",
    // ships=2 inFlight=19 p.fired=63 p.hits=188 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=5.4t · 78.4 µs/step
    binary: "62526054",
    // ships=7 inFlight=0 p.fired=107 p.hits=391 b.fired=0 b.hits=0 contacts=168 severed=9 culled=0 scrap=41.1t · 132.4 µs/step
    kernels: "d0a24f07",
    // ships=12 inFlight=6 p.fired=117 p.hits=426 b.fired=0 b.hits=0 contacts=122 severed=1 culled=0 scrap=23.2t · 124.3 µs/step
    asteroidField: "724c4a31",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-26.3t · 51.5 µs/step
    mining: "bbe926cb",
    // ships=15 inFlight=19 p.fired=506 p.hits=1509 b.fired=0 b.hits=0 contacts=966 severed=1 culled=0 scrap=122.4t · 2263.2 µs/step
    rivalMines: "845e5161",
    // ships=22 inFlight=53 p.fired=140 p.hits=177 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=2.0t · 758.2 µs/step
    swarm: "a9c9b673",
    // ships=304 inFlight=216 p.fired=911 p.hits=1228 b.fired=0 b.hits=0 contacts=105 severed=6 culled=4 scrap=30.2t · 20429.5 µs/step
    superSwarm: "8437ad6e",
    // ships=10 inFlight=0 p.fired=0 p.hits=0 b.fired=12 b.hits=516 contacts=38 severed=0 culled=0 scrap=22.4t · 156.9 µs/step
    torpedoes: "a44002e2",
    // ships=2 inFlight=0 p.fired=46 p.hits=230 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.3t · 108.3 µs/step
    ordering: "746c8efb",
    // ships=16 inFlight=0 p.fired=100 p.hits=309 b.fired=14 b.hits=502 contacts=196 severed=8 culled=0 scrap=107.3t · 280.6 µs/step
    standoff: "b07132bd",
    // ships=15 inFlight=1 p.fired=159 p.hits=531 b.fired=31 b.hits=2228 contacts=2218 severed=21 culled=1 scrap=229.1t · 343.7 µs/step
    column: "1468c968",
    // ships=4 inFlight=2 p.fired=17 p.hits=91 b.fired=0 b.hits=0 contacts=844 severed=8 culled=6 scrap=61.0t · 272.0 µs/step
    split: "04e4df10",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 severed=0 culled=0 scrap=64439.8t · 2798.4 µs/step
    crash: "e8aaa276",
    // ships=18 inFlight=0 p.fired=0 p.hits=0 b.fired=11 b.hits=900 contacts=1681 severed=20 culled=0 scrap=111.1t · 307.3 µs/step
    torchRun: "75972fd8",
    // ships=4 inFlight=0 p.fired=4 p.hits=4 b.fired=0 b.hits=0 contacts=1 severed=0 culled=0 scrap=30.5t · 95.7 µs/step
    hooked: "bea338f8",
    // ships=3 inFlight=0 p.fired=24 p.hits=227 b.fired=0 b.hits=0 contacts=120 severed=2 culled=0 scrap=13.5t · 61.1 µs/step
    broadside: "40b5d92c",
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
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.2t · 62.4 µs/step
    padRebuild: "c311dfbd",
    // ships=5 inFlight=0 p.fired=18 p.hits=57 b.fired=0 b.hits=0 contacts=34 severed=0 culled=0 scrap=1.6t · 118.2 µs/step
    factory: "2e21ab82",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.0t · 201.2 µs/step
    shipyard: "88a913a8",
    // ships=5 inFlight=1 p.fired=19 p.hits=64 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.3t · 127.6 µs/step
    rearm: "15102a05",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=10 severed=2 culled=0 scrap=0.2t · 80.5 µs/step
    tanker: "5d78cc4f",
    // ships=20 inFlight=0 p.fired=11 p.hits=28 b.fired=183 b.hits=6351 contacts=36 severed=3 culled=0 scrap=10.7t · 659.4 µs/step
    beamCarrier: "ad98b697",
    // ships=2 inFlight=4 p.fired=56 p.hits=174 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=8.5t · 34.0 µs/step
    passes: "1351fe4c",
    // ships=2 inFlight=4 p.fired=10 p.hits=33 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=8.5t · 63.4 µs/step
    circling: "2e06ce79",
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
