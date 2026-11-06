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
    // ships=7 inFlight=0 p.fired=107 p.hits=400 b.fired=0 b.hits=0 contacts=220 severed=10 culled=0 scrap=86.5t · 99.4 µs/step
    kernels: "86381e4a",
    // ships=12 inFlight=6 p.fired=117 p.hits=426 b.fired=0 b.hits=0 contacts=120 severed=1 culled=0 scrap=23.2t · 96.1 µs/step
    asteroidField: "563da690",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-26.3t · 51.5 µs/step
    mining: "bbe926cb",
    // ships=14 inFlight=0 p.fired=526 p.hits=1480 b.fired=0 b.hits=0 contacts=461 severed=1 culled=1 scrap=115.0t · 1952.1 µs/step
    rivalMines: "000cc759",
    // ships=22 inFlight=53 p.fired=140 p.hits=177 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=2.0t · 758.2 µs/step
    swarm: "a9c9b673",
    // ships=303 inFlight=251 p.fired=905 p.hits=1239 b.fired=0 b.hits=0 contacts=76 severed=5 culled=4 scrap=30.0t · 14946.4 µs/step
    superSwarm: "3f54593e",
    // ships=12 inFlight=0 p.fired=0 p.hits=0 b.fired=10 b.hits=523 contacts=75 severed=0 culled=0 scrap=22.1t · 131.9 µs/step
    torpedoes: "403f9f7f",
    // ships=2 inFlight=0 p.fired=46 p.hits=230 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.3t · 108.3 µs/step
    ordering: "746c8efb",
    // ships=19 inFlight=0 p.fired=97 p.hits=295 b.fired=14 b.hits=502 contacts=1090 severed=12 culled=0 scrap=96.7t · 218.5 µs/step
    standoff: "73ea63a3",
    // ships=15 inFlight=0 p.fired=158 p.hits=530 b.fired=30 b.hits=2141 contacts=2078 severed=21 culled=1 scrap=230.5t · 208.9 µs/step
    column: "476b13ba",
    // ships=4 inFlight=2 p.fired=17 p.hits=91 b.fired=0 b.hits=0 contacts=844 severed=8 culled=6 scrap=61.0t · 272.0 µs/step
    split: "04e4df10",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 severed=0 culled=0 scrap=64439.8t · 2798.4 µs/step
    crash: "e8aaa276",
    // ships=18 inFlight=0 p.fired=0 p.hits=0 b.fired=11 b.hits=900 contacts=1681 severed=20 culled=0 scrap=111.1t · 307.3 µs/step
    torchRun: "75972fd8",
    // ships=5 inFlight=16 p.fired=188 p.hits=1242 b.fired=0 b.hits=0 contacts=652 severed=9 culled=0 scrap=44.8t · 172.0 µs/step
    hooked: "4188aefe",
    // ships=3 inFlight=0 p.fired=24 p.hits=227 b.fired=0 b.hits=0 contacts=120 severed=2 culled=0 scrap=13.5t · 61.1 µs/step
    broadside: "40b5d92c",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 severed=0 culled=0 scrap=4.8t · 20.5 µs/step
    salvageRun: "dd323b19",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 20.1 µs/step
    refitting: "052760e4",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=144.1t · 90.9 µs/step
    catamaranRefits: "eb579586",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=36 severed=3 culled=0 scrap=108.7t · 51.4 µs/step
    scavenge: "0c59e3b5",
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
    // ships=21 inFlight=0 p.fired=11 p.hits=25 b.fired=188 b.hits=6323 contacts=554 severed=3 culled=0 scrap=11.2t · 662.1 µs/step
    beamCarrier: "278c1971",
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
