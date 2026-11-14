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
    // ships=4 inFlight=13 p.fired=112 p.hits=368 b.fired=0 b.hits=0 contacts=92 bumps=0 crashes=0 severed=2 culled=0 scrap=74.6t · 177.3 µs/step
    duel: "67cd5d9e",
    // ships=4 inFlight=1 p.fired=44 p.hits=177 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=71.8t · 115.6 µs/step
    railDuel: "3780c878",
    // ships=4 inFlight=10 p.fired=139 p.hits=406 b.fired=2 b.hits=227 contacts=121 bumps=1 crashes=0 severed=3 culled=0 scrap=132.4t · 134.5 µs/step
    lanceDuel: "9af1e662",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=40 b.hits=3814 contacts=460 bumps=0 crashes=1 severed=4 culled=0 scrap=54.2t · 130.5 µs/step
    beamDuel: "25da9654",
    // ships=2 inFlight=13 p.fired=57 p.hits=159 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.2t · 99.4 µs/step
    binary: "6ce9d685",
    // ships=6 inFlight=0 p.fired=90 p.hits=466 b.fired=0 b.hits=0 contacts=12 bumps=0 crashes=6 severed=4 culled=0 scrap=28.2t · 56.2 µs/step
    kernels: "f0831ec8",
    // ships=13 inFlight=18 p.fired=183 p.hits=719 b.fired=0 b.hits=0 contacts=120 bumps=0 crashes=0 severed=2 culled=0 scrap=37.6t · 71.4 µs/step
    asteroidField: "312c573d",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 32.5 µs/step
    mining: "e6410e3f",
    // ships=14 inFlight=0 p.fired=336 p.hits=953 b.fired=0 b.hits=0 contacts=1412 bumps=5 crashes=8 severed=3 culled=2 scrap=70.6t · 1530.6 µs/step
    rivalMines: "6ddd353a",
    // ships=22 inFlight=16 p.fired=81 p.hits=53 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=1 scrap=6.2t · 528.0 µs/step
    swarm: "cb38c28e",
    // ships=304 inFlight=169 p.fired=877 p.hits=889 b.fired=0 b.hits=0 contacts=20 bumps=1 crashes=7 severed=5 culled=3 scrap=33.4t · 17078.1 µs/step
    superSwarm: "76f0e080",
    // ships=11 inFlight=0 p.fired=0 p.hits=0 b.fired=9 b.hits=1260 contacts=49 bumps=0 crashes=9 severed=0 culled=0 scrap=25.5t · 112.5 µs/step
    torpedoes: "31d6381b",
    // ships=2 inFlight=39 p.fired=62 p.hits=224 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=3.1t · 86.7 µs/step
    ordering: "972ba439",
    // ships=14 inFlight=0 p.fired=59 p.hits=221 b.fired=11 b.hits=795 contacts=68 bumps=0 crashes=5 severed=6 culled=2 scrap=129.0t · 156.4 µs/step
    standoff: "61d18805",
    // ships=19 inFlight=8 p.fired=130 p.hits=519 b.fired=35 b.hits=2021 contacts=126 bumps=2 crashes=14 severed=12 culled=0 scrap=122.2t · 176.8 µs/step
    column: "7bf7e50c",
    // ships=5 inFlight=0 p.fired=8 p.hits=36 b.fired=0 b.hits=0 contacts=140 bumps=3 crashes=1 severed=5 culled=1 scrap=42.0t · 102.6 µs/step
    split: "0d7ae50a",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=79761.6t · 1678.5 µs/step
    crash: "9c1584bf",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=10 b.hits=1377 contacts=13 bumps=0 crashes=1 severed=2 culled=0 scrap=16.3t · 157.8 µs/step
    torchRun: "efedeab4",
    // ships=5 inFlight=48 p.fired=240 p.hits=1035 b.fired=0 b.hits=0 contacts=319 bumps=1 crashes=0 severed=3 culled=0 scrap=48.9t · 111.2 µs/step
    hooked: "a99a917f",
    // ships=2 inFlight=0 p.fired=43 p.hits=293 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.8t · 56.0 µs/step
    broadside: "a05d3d8b",
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
    // ships=5 inFlight=0 p.fired=23 p.hits=88 b.fired=0 b.hits=0 contacts=38 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 69.3 µs/step
    factory: "4d6d9d9f",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 91.9 µs/step
    shipyard: "288b36ba",
    // ships=5 inFlight=0 p.fired=17 p.hits=66 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.4t · 71.6 µs/step
    rearm: "d162eaa0",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=10 bumps=2 crashes=0 severed=2 culled=0 scrap=0.2t · 63.3 µs/step
    tanker: "920b7ef2",
    // ships=20 inFlight=0 p.fired=9 p.hits=36 b.fired=318 b.hits=7931 contacts=64 bumps=0 crashes=3 severed=1 culled=0 scrap=9.4t · 537.7 µs/step
    beamCarrier: "649694ff",
    // ships=2 inFlight=0 p.fired=58 p.hits=202 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 30.5 µs/step
    passes: "db14517c",
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
