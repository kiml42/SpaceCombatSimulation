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
    // ships=4 inFlight=0 p.fired=107 p.hits=349 b.fired=0 b.hits=0 contacts=3 severed=1 culled=0 scrap=38.2t · 240.5 µs/step
    duel: "f654b71e",
    // ships=4 inFlight=3 p.fired=39 p.hits=160 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=126.1t · 154.4 µs/step
    railDuel: "49e9f5b7",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=37 b.hits=2147 contacts=20 severed=4 culled=0 scrap=48.3t · 204.1 µs/step
    beamDuel: "2f87205c",
    // ships=2 inFlight=12 p.fired=63 p.hits=177 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=7.6t · 105.2 µs/step
    binary: "63777fd7",
    // ships=6 inFlight=0 p.fired=229 p.hits=919 b.fired=0 b.hits=0 contacts=313 severed=3 culled=0 scrap=21.1t · 118.7 µs/step
    kernels: "cb1c27f6",
    // ships=12 inFlight=0 p.fired=83 p.hits=242 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=29.2t · 83.9 µs/step
    asteroidField: "563cd7a9",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-25.1t · 44.9 µs/step
    mining: "92bbb7d9",
    // ships=12 inFlight=15 p.fired=287 p.hits=845 b.fired=0 b.hits=0 contacts=17720 severed=2 culled=1 scrap=100.6t · 2181.1 µs/step
    rivalMines: "711f52e7",
    // ships=22 inFlight=44 p.fired=140 p.hits=190 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=2.0t · 559.2 µs/step
    swarm: "b05bde48",
    // ships=303 inFlight=221 p.fired=931 p.hits=1052 b.fired=0 b.hits=0 contacts=56 severed=6 culled=5 scrap=37.5t · 15756.2 µs/step
    superSwarm: "44363806",
    // ships=12 inFlight=0 p.fired=0 p.hits=0 b.fired=6 b.hits=475 contacts=151 severed=1 culled=0 scrap=24.7t · 119.2 µs/step
    torpedoes: "45ae85ee",
    // ships=2 inFlight=0 p.fired=45 p.hits=228 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.2t · 69.3 µs/step
    ordering: "2dc4260b",
    // ships=15 inFlight=2 p.fired=102 p.hits=310 b.fired=12 b.hits=580 contacts=122 severed=5 culled=0 scrap=99.2t · 245.0 µs/step
    standoff: "182efb4a",
    // ships=12 inFlight=0 p.fired=144 p.hits=483 b.fired=23 b.hits=2752 contacts=1297 severed=17 culled=0 scrap=202.6t · 223.5 µs/step
    column: "fcf747a7",
    // ships=5 inFlight=0 p.fired=15 p.hits=82 b.fired=0 b.hits=0 contacts=528 severed=7 culled=2 scrap=45.7t · 142.6 µs/step
    split: "9c8ea155",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 severed=0 culled=0 scrap=64507.6t · 2971.9 µs/step
    crash: "4048d492",
    // ships=16 inFlight=0 p.fired=0 p.hits=0 b.fired=5 b.hits=670 contacts=613 severed=12 culled=0 scrap=240.0t · 199.8 µs/step
    torchRun: "5c05d511",
    // ships=10 inFlight=29 p.fired=149 p.hits=536 b.fired=0 b.hits=0 contacts=1469 severed=14 culled=0 scrap=29.9t · 148.5 µs/step
    hooked: "b4924970",
    // ships=2 inFlight=0 p.fired=24 p.hits=141 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.9t · 61.7 µs/step
    broadside: "b3c44bf4",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 severed=0 culled=0 scrap=5.0t · 27.4 µs/step
    salvageRun: "1164ca33",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 22.0 µs/step
    refitting: "35d04241",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=144.1t · 95.0 µs/step
    catamaranRefits: "d9b363a3",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=27 severed=3 culled=0 scrap=108.2t · 54.9 µs/step
    scavenge: "7b6ffad3",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.2t · 58.6 µs/step
    padRebuild: "4d5398ce",
    // ships=5 inFlight=0 p.fired=18 p.hits=66 b.fired=0 b.hits=0 contacts=34 severed=0 culled=0 scrap=1.6t · 95.1 µs/step
    factory: "5313b9d9",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.1t · 118.4 µs/step
    shipyard: "094133cc",
    // ships=5 inFlight=0 p.fired=17 p.hits=66 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.4t · 102.5 µs/step
    rearm: "89afa814",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=9 severed=2 culled=0 scrap=0.2t · 76.8 µs/step
    tanker: "38ed4074",
    // ships=20 inFlight=0 p.fired=3 p.hits=0 b.fired=215 b.hits=7243 contacts=110 severed=2 culled=0 scrap=10.0t · 627.0 µs/step
    beamCarrier: "b1f40165",
    // ships=2 inFlight=0 p.fired=54 p.hits=183 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.3t · 38.8 µs/step
    passes: "99949d2c",
    // ships=2 inFlight=0 p.fired=2 p.hits=8 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.3t · 60.9 µs/step
    circling: "e5ca042e",
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
