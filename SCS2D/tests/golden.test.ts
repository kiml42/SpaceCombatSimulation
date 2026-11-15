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
    // ships=3 inFlight=24 p.fired=108 p.hits=333 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=19.3t · 141.3 µs/step
    duel: "d846e987",
    // ships=3 inFlight=1 p.fired=42 p.hits=152 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=20.8t · 94.0 µs/step
    railDuel: "47e864fa",
    // ships=4 inFlight=10 p.fired=142 p.hits=420 b.fired=2 b.hits=252 contacts=121 bumps=1 crashes=0 severed=3 culled=0 scrap=150.8t · 136.7 µs/step
    lanceDuel: "825e8787",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=40 b.hits=3364 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=28.8t · 137.7 µs/step
    beamDuel: "0eda468e",
    // ships=2 inFlight=21 p.fired=36 p.hits=113 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=3.9t · 62.7 µs/step
    binary: "d5a20e3e",
    // ships=4 inFlight=0 p.fired=154 p.hits=714 b.fired=0 b.hits=0 contacts=123 bumps=2 crashes=0 severed=2 culled=0 scrap=57.0t · 72.5 µs/step
    kernels: "b982d066",
    // ships=13 inFlight=9 p.fired=209 p.hits=888 b.fired=0 b.hits=0 contacts=531 bumps=1 crashes=0 severed=3 culled=0 scrap=41.1t · 72.1 µs/step
    asteroidField: "47315f7c",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 48.2 µs/step
    mining: "c70bad69",
    // ships=14 inFlight=0 p.fired=258 p.hits=719 b.fired=0 b.hits=0 contacts=2132 bumps=9 crashes=14 severed=3 culled=2 scrap=76.5t · 1518.7 µs/step
    rivalMines: "c358868e",
    // ships=22 inFlight=16 p.fired=91 p.hits=60 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=2.1t · 545.8 µs/step
    swarm: "f80aa535",
    // ships=302 inFlight=24 p.fired=147 p.hits=228 b.fired=0 b.hits=0 contacts=22 bumps=0 crashes=8 severed=3 culled=3 scrap=19.1t · 16222.6 µs/step
    superSwarm: "2456604a",
    // ships=11 inFlight=0 p.fired=0 p.hits=0 b.fired=9 b.hits=840 contacts=30 bumps=0 crashes=8 severed=0 culled=0 scrap=21.2t · 110.3 µs/step
    torpedoes: "e8d64728",
    // ships=2 inFlight=5 p.fired=44 p.hits=186 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=2.6t · 59.7 µs/step
    ordering: "f61e09b7",
    // ships=11 inFlight=0 p.fired=52 p.hits=232 b.fired=15 b.hits=1019 contacts=41 bumps=1 crashes=0 severed=2 culled=1 scrap=108.5t · 159.0 µs/step
    standoff: "f967b202",
    // ships=11 inFlight=0 p.fired=129 p.hits=517 b.fired=39 b.hits=2409 contacts=0 bumps=0 crashes=0 severed=3 culled=0 scrap=114.6t · 180.9 µs/step
    column: "1bc2bafe",
    // ships=5 inFlight=0 p.fired=9 p.hits=84 b.fired=0 b.hits=0 contacts=10 bumps=2 crashes=1 severed=6 culled=1 scrap=41.5t · 137.1 µs/step
    split: "769efe0e",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=79761.6t · 1678.5 µs/step
    crash: "9c1584bf",
    // ships=10 inFlight=0 p.fired=0 p.hits=0 b.fired=5 b.hits=2006 contacts=259 bumps=2 crashes=8 severed=5 culled=0 scrap=147.0t · 219.8 µs/step
    torchRun: "e4dce1ba",
    // ships=4 inFlight=50 p.fired=146 p.hits=499 b.fired=0 b.hits=0 contacts=1 bumps=1 crashes=0 severed=0 culled=0 scrap=28.8t · 93.8 µs/step
    hooked: "c9d0956a",
    // ships=2 inFlight=0 p.fired=43 p.hits=290 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.8t · 52.3 µs/step
    broadside: "2122d9dc",
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
    // ships=20 inFlight=0 p.fired=2 p.hits=4 b.fired=311 b.hits=7956 contacts=61 bumps=1 crashes=4 severed=1 culled=0 scrap=15.7t · 547.1 µs/step
    beamCarrier: "1ad1f9d4",
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
