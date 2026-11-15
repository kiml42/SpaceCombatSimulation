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
    // ships=3 inFlight=11 p.fired=136 p.hits=463 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=34.2t · 182.5 µs/step
    duel: "7ab16933",
    // ships=3 inFlight=1 p.fired=42 p.hits=152 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=20.6t · 90.8 µs/step
    railDuel: "1a219073",
    // ships=4 inFlight=10 p.fired=139 p.hits=410 b.fired=2 b.hits=227 contacts=251 bumps=0 crashes=0 severed=3 culled=0 scrap=131.2t · 146.5 µs/step
    lanceDuel: "69c92cfb",
    // ships=6 inFlight=0 p.fired=0 p.hits=0 b.fired=41 b.hits=3955 contacts=496 bumps=2 crashes=1 severed=4 culled=0 scrap=54.8t · 146.8 µs/step
    beamDuel: "98c5e030",
    // ships=2 inFlight=11 p.fired=58 p.hits=156 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=7.9t · 69.6 µs/step
    binary: "c3dc4218",
    // ships=4 inFlight=0 p.fired=83 p.hits=347 b.fired=0 b.hits=0 contacts=395 bumps=1 crashes=11 severed=8 culled=0 scrap=34.7t · 68.2 µs/step
    kernels: "61f40c3e",
    // ships=12 inFlight=9 p.fired=189 p.hits=698 b.fired=0 b.hits=0 contacts=652 bumps=1 crashes=0 severed=2 culled=0 scrap=37.6t · 80.8 µs/step
    asteroidField: "b49a4fab",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 32.5 µs/step
    mining: "e6410e3f",
    // ships=15 inFlight=0 p.fired=429 p.hits=1202 b.fired=0 b.hits=0 contacts=250 bumps=3 crashes=1 severed=2 culled=1 scrap=118.6t · 1768.1 µs/step
    rivalMines: "b4a882de",
    // ships=22 inFlight=18 p.fired=79 p.hits=52 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=1 scrap=9.8t · 531.3 µs/step
    swarm: "72fea0a8",
    // ships=304 inFlight=154 p.fired=816 p.hits=864 b.fired=0 b.hits=0 contacts=52 bumps=2 crashes=6 severed=5 culled=3 scrap=33.5t · 17807.8 µs/step
    superSwarm: "523d1eaa",
    // ships=10 inFlight=0 p.fired=0 p.hits=0 b.fired=9 b.hits=796 contacts=29 bumps=0 crashes=9 severed=0 culled=0 scrap=28.5t · 108.1 µs/step
    torpedoes: "5de9fecb",
    // ships=2 inFlight=39 p.fired=62 p.hits=224 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=3.1t · 61.1 µs/step
    ordering: "c0479c75",
    // ships=11 inFlight=0 p.fired=58 p.hits=239 b.fired=11 b.hits=808 contacts=7 bumps=0 crashes=0 severed=3 culled=2 scrap=108.6t · 208.1 µs/step
    standoff: "d57c16c7",
    // ships=16 inFlight=0 p.fired=129 p.hits=508 b.fired=35 b.hits=2182 contacts=130 bumps=1 crashes=11 severed=8 culled=0 scrap=116.9t · 182.3 µs/step
    column: "594e4d89",
    // ships=5 inFlight=0 p.fired=8 p.hits=43 b.fired=0 b.hits=0 contacts=140 bumps=3 crashes=1 severed=5 culled=1 scrap=43.2t · 119.2 µs/step
    split: "a3e49a04",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=79761.6t · 1678.5 µs/step
    crash: "9c1584bf",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=10 b.hits=1377 contacts=13 bumps=0 crashes=1 severed=2 culled=0 scrap=16.3t · 157.8 µs/step
    torchRun: "efedeab4",
    // ships=4 inFlight=74 p.fired=135 p.hits=297 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=1 culled=0 scrap=26.9t · 103.0 µs/step
    hooked: "fa09c9b2",
    // ships=2 inFlight=0 p.fired=43 p.hits=290 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.8t · 52.1 µs/step
    broadside: "2ee245fc",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=1 crashes=0 severed=0 culled=0 scrap=5.1t · 21.2 µs/step
    salvageRun: "d4a588c2",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 22.0 µs/step
    refitting: "35d04241",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=144.1t · 64.0 µs/step
    catamaranRefits: "95f51e51",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=41 bumps=3 crashes=0 severed=3 culled=0 scrap=108.3t · 41.1 µs/step
    scavenge: "66198670",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 51.6 µs/step
    padRebuild: "36a4f7f7",
    // ships=5 inFlight=0 p.fired=23 p.hits=88 b.fired=0 b.hits=0 contacts=38 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 80.3 µs/step
    factory: "d1daba43",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 91.9 µs/step
    shipyard: "288b36ba",
    // ships=5 inFlight=0 p.fired=17 p.hits=66 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.4t · 79.9 µs/step
    rearm: "13b01f7b",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=10 bumps=2 crashes=0 severed=2 culled=0 scrap=0.2t · 63.3 µs/step
    tanker: "920b7ef2",
    // ships=20 inFlight=0 p.fired=6 p.hits=17 b.fired=306 b.hits=7731 contacts=56 bumps=1 crashes=4 severed=1 culled=0 scrap=17.4t · 549.0 µs/step
    beamCarrier: "69f0a976",
    // ships=2 inFlight=0 p.fired=58 p.hits=199 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 33.3 µs/step
    passes: "91964cf7",
    // ships=2 inFlight=0 p.fired=2 p.hits=18 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 48.6 µs/step
    circling: "895e4183",
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
