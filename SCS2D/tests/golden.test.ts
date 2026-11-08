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
    // ships=3 inFlight=0 p.fired=101 p.hits=291 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=36.4t · 248.2 µs/step
    duel: "473bed97",
    // ships=3 inFlight=3 p.fired=39 p.hits=150 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=19.4t · 157.3 µs/step
    railDuel: "0f086da8",
    // ships=3 inFlight=2 p.fired=112 p.hits=500 b.fired=7 b.hits=452 contacts=0 severed=0 culled=0 scrap=20.7t · 334.3 µs/step
    lanceDuel: "4e964a11",
    // ships=9 inFlight=0 p.fired=0 p.hits=0 b.fired=36 b.hits=2370 contacts=307 severed=6 culled=0 scrap=35.1t · 272.2 µs/step
    beamDuel: "76c40842",
    // ships=2 inFlight=23 p.fired=78 p.hits=216 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=10.2t · 120.5 µs/step
    binary: "76c001bd",
    // ships=6 inFlight=0 p.fired=135 p.hits=630 b.fired=0 b.hits=0 contacts=356 severed=9 culled=0 scrap=37.7t · 149.2 µs/step
    kernels: "acd9ad55",
    // ships=12 inFlight=13 p.fired=111 p.hits=355 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=31.8t · 120.5 µs/step
    asteroidField: "cce76cfb",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-25.1t · 48.7 µs/step
    mining: "eb814177",
    // ships=13 inFlight=2 p.fired=182 p.hits=508 b.fired=0 b.hits=0 contacts=1272 severed=4 culled=2 scrap=191.3t · 2572.4 µs/step
    rivalMines: "899fbb84",
    // ships=22 inFlight=48 p.fired=151 p.hits=169 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=2.0t · 706.6 µs/step
    swarm: "a2f68acd",
    // ships=302 inFlight=212 p.fired=988 p.hits=1076 b.fired=0 b.hits=0 contacts=75 severed=4 culled=4 scrap=31.9t · 18871.9 µs/step
    superSwarm: "d1757cc4",
    // ships=12 inFlight=0 p.fired=0 p.hits=0 b.fired=7 b.hits=528 contacts=80 severed=1 culled=0 scrap=26.9t · 216.4 µs/step
    torpedoes: "a9f5b3fc",
    // ships=2 inFlight=0 p.fired=45 p.hits=228 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.2t · 163.6 µs/step
    ordering: "4bcaf0b3",
    // ships=10 inFlight=0 p.fired=119 p.hits=371 b.fired=12 b.hits=442 contacts=0 severed=0 culled=0 scrap=88.4t · 360.3 µs/step
    standoff: "bd228f80",
    // ships=15 inFlight=0 p.fired=160 p.hits=526 b.fired=20 b.hits=2531 contacts=1170 severed=21 culled=1 scrap=223.6t · 458.3 µs/step
    column: "1c469837",
    // ships=5 inFlight=1 p.fired=19 p.hits=95 b.fired=0 b.hits=0 contacts=995 severed=8 culled=4 scrap=54.8t · 336.3 µs/step
    split: "09747952",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 severed=0 culled=0 scrap=64507.6t · 2971.9 µs/step
    crash: "4048d492",
    // ships=11 inFlight=0 p.fired=0 p.hits=0 b.fired=5 b.hits=647 contacts=1284 severed=9 culled=0 scrap=111.1t · 295.4 µs/step
    torchRun: "46113805",
    // ships=6 inFlight=0 p.fired=121 p.hits=374 b.fired=0 b.hits=0 contacts=438 severed=5 culled=0 scrap=92.0t · 157.2 µs/step
    hooked: "7bee16c2",
    // ships=2 inFlight=0 p.fired=24 p.hits=151 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.8t · 90.9 µs/step
    broadside: "ff9425ee",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 severed=0 culled=0 scrap=5.0t · 27.7 µs/step
    salvageRun: "3f83894b",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 22.0 µs/step
    refitting: "35d04241",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=144.1t · 95.0 µs/step
    catamaranRefits: "d9b363a3",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=32 severed=3 culled=0 scrap=108.3t · 62.4 µs/step
    scavenge: "72e16f6f",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.2t · 75.6 µs/step
    padRebuild: "f9b9e208",
    // ships=5 inFlight=0 p.fired=19 p.hits=61 b.fired=0 b.hits=0 contacts=34 severed=0 culled=0 scrap=1.6t · 107.4 µs/step
    factory: "b309b069",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.1t · 128.1 µs/step
    shipyard: "ed2487e5",
    // ships=5 inFlight=0 p.fired=15 p.hits=60 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.4t · 121.8 µs/step
    rearm: "e70ff061",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=12 severed=2 culled=0 scrap=0.2t · 90.0 µs/step
    tanker: "69ab665b",
    // ships=21 inFlight=0 p.fired=10 p.hits=14 b.fired=218 b.hits=6973 contacts=66 severed=3 culled=0 scrap=12.2t · 809.3 µs/step
    beamCarrier: "45ea287c",
    // ships=2 inFlight=0 p.fired=54 p.hits=185 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.3t · 46.6 µs/step
    passes: "0de6b99c",
    // ships=2 inFlight=0 p.fired=2 p.hits=8 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.3t · 135.3 µs/step
    circling: "212fd5d1",
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
