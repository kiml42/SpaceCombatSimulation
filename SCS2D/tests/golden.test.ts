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
    // ships=7 inFlight=0 p.fired=111 p.hits=439 b.fired=0 b.hits=0 contacts=155 severed=9 culled=0 scrap=23.9t · 104.5 µs/step
    kernels: "1ae3da86",
    // ships=12 inFlight=6 p.fired=117 p.hits=426 b.fired=0 b.hits=0 contacts=122 severed=1 culled=0 scrap=23.2t · 157.5 µs/step
    asteroidField: "724c4a31",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-26.3t · 51.5 µs/step
    mining: "bbe926cb",
    // ships=11 inFlight=2 p.fired=91 p.hits=254 b.fired=0 b.hits=0 contacts=19130 severed=2 culled=0 scrap=101.1t · 1734.3 µs/step
    rivalMines: "80849211",
    // ships=22 inFlight=53 p.fired=140 p.hits=177 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=2.0t · 684.2 µs/step
    swarm: "e006d2fa",
    // ships=304 inFlight=190 p.fired=909 p.hits=1314 b.fired=0 b.hits=0 contacts=128 severed=7 culled=5 scrap=31.0t · 12403.9 µs/step
    superSwarm: "eeade246",
    // ships=13 inFlight=0 p.fired=0 p.hits=0 b.fired=11 b.hits=452 contacts=210 severed=24 culled=24 scrap=21.8t · 113.8 µs/step
    torpedoes: "87503b47",
    // ships=2 inFlight=0 p.fired=46 p.hits=230 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.3t · 108.3 µs/step
    ordering: "746c8efb",
    // ships=16 inFlight=0 p.fired=98 p.hits=325 b.fired=14 b.hits=502 contacts=3 severed=8 culled=0 scrap=98.6t · 177.0 µs/step
    standoff: "61eb8f05",
    // ships=19 inFlight=0 p.fired=136 p.hits=473 b.fired=34 b.hits=2397 contacts=1651 severed=20 culled=0 scrap=176.7t · 308.5 µs/step
    column: "008a3e73",
    // ships=4 inFlight=1 p.fired=18 p.hits=105 b.fired=0 b.hits=0 contacts=864 severed=8 culled=6 scrap=66.9t · 184.7 µs/step
    split: "cfe23d7c",
    // ships=19 inFlight=0 p.fired=0 p.hits=0 b.fired=9 b.hits=662 contacts=2524 severed=25 culled=0 scrap=129.6t · 412.0 µs/step
    torchRun: "93cf2675",
    // ships=6 inFlight=26 p.fired=164 p.hits=886 b.fired=0 b.hits=0 contacts=10 severed=2 culled=0 scrap=39.4t · 171.7 µs/step
    hooked: "d77951c9",
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
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.2t · 100.3 µs/step
    padRebuild: "408984d3",
    // ships=5 inFlight=0 p.fired=18 p.hits=57 b.fired=0 b.hits=0 contacts=34 severed=0 culled=0 scrap=1.6t · 157.4 µs/step
    factory: "6a3f447f",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.0t · 201.2 µs/step
    shipyard: "88a913a8",
    // ships=5 inFlight=0 p.fired=18 p.hits=64 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.4t · 168.7 µs/step
    rearm: "cbed1f4a",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=10 severed=2 culled=0 scrap=0.2t · 111.9 µs/step
    tanker: "3eaa5d70",
    // ships=20 inFlight=0 p.fired=18 p.hits=42 b.fired=183 b.hits=6073 contacts=241 severed=2 culled=0 scrap=10.4t · 513.1 µs/step
    beamCarrier: "c076ca18",
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
