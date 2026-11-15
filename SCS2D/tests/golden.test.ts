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
    // ships=3 inFlight=0 p.fired=93 p.hits=304 b.fired=0 b.hits=0 contacts=121 bumps=1 crashes=1 severed=1 culled=0 scrap=115.4t · 232.5 µs/step
    duel: "fd371423",
    // ships=3 inFlight=0 p.fired=47 p.hits=230 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=47.2t · 116.8 µs/step
    railDuel: "e2558985",
    // ships=5 inFlight=0 p.fired=134 p.hits=443 b.fired=2 b.hits=265 contacts=121 bumps=1 crashes=0 severed=4 culled=0 scrap=162.8t · 138.3 µs/step
    lanceDuel: "8021a1d8",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=40 b.hits=3456 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=29.0t · 140.4 µs/step
    beamDuel: "5ab50048",
    // ships=2 inFlight=18 p.fired=41 p.hits=156 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=10.2t · 59.1 µs/step
    binary: "06b8fd5a",
    // ships=5 inFlight=0 p.fired=154 p.hits=710 b.fired=0 b.hits=0 contacts=3 bumps=1 crashes=0 severed=2 culled=0 scrap=92.1t · 63.3 µs/step
    kernels: "05990156",
    // ships=13 inFlight=10 p.fired=192 p.hits=759 b.fired=0 b.hits=0 contacts=126 bumps=0 crashes=0 severed=2 culled=0 scrap=38.5t · 65.2 µs/step
    asteroidField: "7fdd5f89",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 48.2 µs/step
    mining: "c70bad69",
    // ships=15 inFlight=0 p.fired=238 p.hits=698 b.fired=0 b.hits=0 contacts=160 bumps=3 crashes=6 severed=3 culled=0 scrap=-10.8t · 1518.5 µs/step
    rivalMines: "2eadeb7b",
    // ships=22 inFlight=88 p.fired=97 p.hits=63 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=1 scrap=6.2t · 555.7 µs/step
    swarm: "e1ee1b8f",
    // ships=302 inFlight=214 p.fired=691 p.hits=868 b.fired=0 b.hits=0 contacts=23 bumps=0 crashes=8 severed=3 culled=3 scrap=34.1t · 17705.2 µs/step
    superSwarm: "adb610da",
    // ships=11 inFlight=0 p.fired=0 p.hits=0 b.fired=10 b.hits=796 contacts=58 bumps=0 crashes=9 severed=0 culled=0 scrap=21.6t · 115.5 µs/step
    torpedoes: "dc007fa0",
    // ships=2 inFlight=10 p.fired=51 p.hits=182 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=2.7t · 63.4 µs/step
    ordering: "21985a2e",
    // ships=18 inFlight=0 p.fired=107 p.hits=399 b.fired=16 b.hits=1086 contacts=249 bumps=2 crashes=6 severed=8 culled=0 scrap=127.3t · 212.4 µs/step
    standoff: "39bdb4ea",
    // ships=12 inFlight=0 p.fired=141 p.hits=661 b.fired=38 b.hits=2862 contacts=93 bumps=0 crashes=0 severed=5 culled=0 scrap=122.8t · 188.0 µs/step
    column: "cf17d80a",
    // ships=4 inFlight=0 p.fired=11 p.hits=75 b.fired=0 b.hits=0 contacts=60 bumps=3 crashes=1 severed=6 culled=4 scrap=54.5t · 100.6 µs/step
    split: "fd7809e0",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=79761.6t · 1678.5 µs/step
    crash: "9c1584bf",
    // ships=10 inFlight=0 p.fired=0 p.hits=0 b.fired=5 b.hits=2014 contacts=359 bumps=0 crashes=8 severed=5 culled=0 scrap=141.8t · 149.0 µs/step
    torchRun: "9cbb5589",
    // ships=4 inFlight=44 p.fired=127 p.hits=399 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=1 culled=0 scrap=24.4t · 100.0 µs/step
    hooked: "8f682a28",
    // ships=2 inFlight=0 p.fired=43 p.hits=290 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.8t · 52.6 µs/step
    broadside: "01b441d4",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=1 crashes=0 severed=0 culled=0 scrap=5.1t · 36.1 µs/step
    salvageRun: "4d767312",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 22.0 µs/step
    refitting: "35d04241",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=144.1t · 64.0 µs/step
    catamaranRefits: "95f51e51",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=35 bumps=3 crashes=0 severed=3 culled=0 scrap=108.3t · 65.4 µs/step
    scavenge: "f79ea4da",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 83.6 µs/step
    padRebuild: "e0d9f044",
    // ships=5 inFlight=0 p.fired=23 p.hits=88 b.fired=0 b.hits=0 contacts=38 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 66.9 µs/step
    factory: "eb1f062b",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 134.4 µs/step
    shipyard: "3a5a0509",
    // ships=5 inFlight=0 p.fired=18 p.hits=68 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.4t · 73.2 µs/step
    rearm: "3f3c1496",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=2 culled=0 scrap=0.1t · 85.5 µs/step
    tanker: "cbe039d9",
    // ships=20 inFlight=0 p.fired=4 p.hits=17 b.fired=319 b.hits=8809 contacts=53 bumps=1 crashes=3 severed=1 culled=0 scrap=12.1t · 554.4 µs/step
    beamCarrier: "0ecd01ba",
    // ships=2 inFlight=0 p.fired=58 p.hits=203 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 30.6 µs/step
    passes: "665b5ff5",
    // ships=2 inFlight=0 p.fired=2 p.hits=17 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 72.4 µs/step
    circling: "f11c5210",
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
