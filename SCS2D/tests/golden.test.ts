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
    // ships=10 inFlight=12 p.fired=125 p.hits=352 b.fired=0 b.hits=0 contacts=71 bumps=0 crashes=7 severed=7 culled=0 scrap=120.1t · 267.6 µs/step
    duel: "7183a55f",
    // ships=3 inFlight=1 p.fired=45 p.hits=171 b.fired=0 b.hits=0 contacts=70 bumps=0 crashes=0 severed=1 culled=0 scrap=74.6t · 162.1 µs/step
    railDuel: "cfcce349",
    // ships=4 inFlight=6 p.fired=142 p.hits=415 b.fired=2 b.hits=258 contacts=258 bumps=0 crashes=0 severed=3 culled=0 scrap=152.1t · 198.4 µs/step
    lanceDuel: "5ba5c6f6",
    // ships=6 inFlight=0 p.fired=0 p.hits=0 b.fired=40 b.hits=3332 contacts=3 bumps=0 crashes=2 severed=3 culled=0 scrap=44.0t · 197.1 µs/step
    beamDuel: "6c1df556",
    // ships=2 inFlight=11 p.fired=37 p.hits=126 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=7.8t · 91.9 µs/step
    binary: "4c5073d8",
    // ships=7 inFlight=8 p.fired=209 p.hits=965 b.fired=0 b.hits=0 contacts=771 bumps=5 crashes=0 severed=4 culled=0 scrap=48.3t · 102.8 µs/step
    kernels: "7f1688dd",
    // ships=14 inFlight=0 p.fired=108 p.hits=392 b.fired=0 b.hits=0 contacts=2699 bumps=5 crashes=0 severed=2 culled=0 scrap=65.7t · 96.6 µs/step
    asteroidField: "b4556b07",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 48.2 µs/step
    mining: "c70bad69",
    // ships=12 inFlight=0 p.fired=238 p.hits=551 b.fired=0 b.hits=0 contacts=9 bumps=2 crashes=3 severed=0 culled=0 scrap=63.4t · 2004.6 µs/step
    rivalMines: "a4998b27",
    // ships=22 inFlight=16 p.fired=91 p.hits=72 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=2.0t · 747.1 µs/step
    swarm: "57062a12",
    // ships=302 inFlight=168 p.fired=357 p.hits=463 b.fired=0 b.hits=0 contacts=169 bumps=0 crashes=12 severed=4 culled=4 scrap=31.1t · 22174.0 µs/step
    superSwarm: "a1a1b942",
    // ships=11 inFlight=0 p.fired=0 p.hits=0 b.fired=9 b.hits=1183 contacts=60 bumps=0 crashes=8 severed=1 culled=0 scrap=24.5t · 213.0 µs/step
    torpedoes: "b62b3ad4",
    // ships=2 inFlight=5 p.fired=44 p.hits=186 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=2.6t · 112.5 µs/step
    ordering: "4e0a916f",
    // ships=11 inFlight=1 p.fired=57 p.hits=257 b.fired=17 b.hits=1198 contacts=6 bumps=0 crashes=1 severed=2 culled=1 scrap=117.3t · 282.8 µs/step
    standoff: "27a130b1",
    // ships=14 inFlight=0 p.fired=130 p.hits=529 b.fired=33 b.hits=2004 contacts=89 bumps=2 crashes=4 severed=6 culled=0 scrap=115.5t · 277.3 µs/step
    column: "f42743d5",
    // ships=5 inFlight=0 p.fired=9 p.hits=84 b.fired=0 b.hits=0 contacts=10 bumps=2 crashes=1 severed=6 culled=1 scrap=41.6t · 210.4 µs/step
    split: "421e5e75",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=79761.6t · 1678.5 µs/step
    crash: "9c1584bf",
    // ships=10 inFlight=0 p.fired=0 p.hits=0 b.fired=5 b.hits=2006 contacts=259 bumps=2 crashes=8 severed=5 culled=0 scrap=147.0t · 219.8 µs/step
    torchRun: "e4dce1ba",
    // ships=4 inFlight=52 p.fired=147 p.hits=469 b.fired=0 b.hits=0 contacts=1 bumps=1 crashes=0 severed=0 culled=0 scrap=28.5t · 151.2 µs/step
    hooked: "ba6ff179",
    // ships=2 inFlight=0 p.fired=43 p.hits=293 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.8t · 81.7 µs/step
    broadside: "ff520618",
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
    // ships=5 inFlight=0 p.fired=23 p.hits=88 b.fired=0 b.hits=0 contacts=38 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 132.6 µs/step
    factory: "443d15bf",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 134.4 µs/step
    shipyard: "3a5a0509",
    // ships=5 inFlight=0 p.fired=18 p.hits=68 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.4t · 124.9 µs/step
    rearm: "54c36898",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=2 culled=0 scrap=0.1t · 85.5 µs/step
    tanker: "cbe039d9",
    // ships=20 inFlight=0 p.fired=18 p.hits=66 b.fired=325 b.hits=7490 contacts=101 bumps=3 crashes=3 severed=1 culled=0 scrap=11.9t · 801.5 µs/step
    beamCarrier: "037f0cdd",
    // ships=2 inFlight=0 p.fired=58 p.hits=199 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 48.9 µs/step
    passes: "20600d2b",
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
