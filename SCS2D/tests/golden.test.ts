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
    // ships=6 inFlight=12 p.fired=154 p.hits=535 b.fired=0 b.hits=0 contacts=1365 bumps=3 crashes=0 severed=5 culled=0 scrap=40.5t · 212.1 µs/step
    duel: "8bb69e57",
    // ships=4 inFlight=1 p.fired=44 p.hits=152 b.fired=0 b.hits=0 contacts=6 bumps=1 crashes=0 severed=1 culled=0 scrap=21.1t · 108.6 µs/step
    railDuel: "f192adbe",
    // ships=4 inFlight=10 p.fired=141 p.hits=440 b.fired=2 b.hits=236 contacts=259 bumps=0 crashes=0 severed=3 culled=0 scrap=144.0t · 127.8 µs/step
    lanceDuel: "0b1bb893",
    // ships=8 inFlight=0 p.fired=0 p.hits=0 b.fired=39 b.hits=3617 contacts=2 bumps=0 crashes=1 severed=5 culled=0 scrap=74.2t · 134.2 µs/step
    beamDuel: "c5eac77e",
    // ships=2 inFlight=13 p.fired=58 p.hits=181 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=7.6t · 61.7 µs/step
    binary: "fe517463",
    // ships=4 inFlight=0 p.fired=98 p.hits=415 b.fired=0 b.hits=0 contacts=22 bumps=0 crashes=11 severed=8 culled=0 scrap=26.7t · 57.2 µs/step
    kernels: "699c9834",
    // ships=15 inFlight=0 p.fired=180 p.hits=739 b.fired=0 b.hits=0 contacts=1478 bumps=4 crashes=2 severed=7 culled=0 scrap=32.1t · 71.8 µs/step
    asteroidField: "425428a9",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-25.1t · 40.7 µs/step
    mining: "ba358939",
    // ships=13 inFlight=0 p.fired=377 p.hits=980 b.fired=0 b.hits=0 contacts=155 bumps=2 crashes=4 severed=1 culled=1 scrap=122.0t · 1638.4 µs/step
    rivalMines: "ef961967",
    // ships=23 inFlight=20 p.fired=114 p.hits=96 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=3.6t · 525.6 µs/step
    swarm: "5230c4e9",
    // ships=302 inFlight=242 p.fired=542 p.hits=542 b.fired=0 b.hits=0 contacts=72 bumps=0 crashes=10 severed=3 culled=3 scrap=19.7t · 15152.4 µs/step
    superSwarm: "fa2c4ea5",
    // ships=13 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=707 contacts=99 bumps=1 crashes=11 severed=1 culled=0 scrap=23.3t · 109.8 µs/step
    torpedoes: "dd3efc43",
    // ships=3 inFlight=22 p.fired=182 p.hits=725 b.fired=0 b.hits=0 contacts=148 bumps=0 crashes=0 severed=1 culled=0 scrap=17.8t · 63.8 µs/step
    ordering: "e3066153",
    // ships=10 inFlight=0 p.fired=107 p.hits=327 b.fired=11 b.hits=715 contacts=1 bumps=0 crashes=0 severed=0 culled=0 scrap=103.6t · 193.1 µs/step
    standoff: "bc14854c",
    // ships=14 inFlight=0 p.fired=90 p.hits=401 b.fired=29 b.hits=2202 contacts=304 bumps=1 crashes=10 severed=6 culled=0 scrap=99.2t · 182.1 µs/step
    column: "bd314535",
    // ships=4 inFlight=1 p.fired=14 p.hits=77 b.fired=0 b.hits=0 contacts=772 bumps=7 crashes=1 severed=8 culled=6 scrap=67.9t · 139.4 µs/step
    split: "92e93416",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 severed=0 culled=0 scrap=64849.3t · 2070.2 µs/step
    crash: "bd8c5319",
    // ships=6 inFlight=0 p.fired=0 p.hits=0 b.fired=9 b.hits=1319 contacts=1649 bumps=1 crashes=0 severed=1 culled=0 scrap=18.6t · 166.5 µs/step
    torchRun: "70afeb62",
    // ships=8 inFlight=69 p.fired=260 p.hits=1060 b.fired=0 b.hits=0 contacts=156 bumps=4 crashes=0 severed=9 culled=0 scrap=55.2t · 127.7 µs/step
    hooked: "22255ae4",
    // ships=2 inFlight=0 p.fired=24 p.hits=156 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.8t · 48.6 µs/step
    broadside: "aad2bc12",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 severed=0 culled=0 scrap=5.1t · 25.6 µs/step
    salvageRun: "804efd7f",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 22.0 µs/step
    refitting: "35d04241",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=144.1t · 87.6 µs/step
    catamaranRefits: "2b1a25f3",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=46 bumps=1 crashes=2 severed=3 culled=0 scrap=108.3t · 38.6 µs/step
    scavenge: "daa190be",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 42.5 µs/step
    padRebuild: "6d03b457",
    // ships=5 inFlight=0 p.fired=22 p.hits=86 b.fired=0 b.hits=0 contacts=34 bumps=0 crashes=0 severed=0 culled=0 scrap=1.6t · 67.6 µs/step
    factory: "6a9f94e9",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=32.1t · 90.6 µs/step
    shipyard: "c06171cb",
    // ships=5 inFlight=0 p.fired=18 p.hits=65 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.4t · 77.4 µs/step
    rearm: "88167d46",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=6 bumps=3 crashes=0 severed=2 culled=0 scrap=0.1t · 58.7 µs/step
    tanker: "4de63ce8",
    // ships=21 inFlight=0 p.fired=12 p.hits=26 b.fired=242 b.hits=7275 contacts=81 bumps=1 crashes=6 severed=3 culled=1 scrap=16.0t · 523.6 µs/step
    beamCarrier: "bae6dd3c",
    // ships=2 inFlight=0 p.fired=55 p.hits=182 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.3t · 40.7 µs/step
    passes: "cee4ef1b",
    // ships=2 inFlight=0 p.fired=2 p.hits=8 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.3t · 67.4 µs/step
    circling: "3716c1d0",
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
