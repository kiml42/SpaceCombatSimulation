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
    // ships=3 inFlight=0 p.fired=86 p.hits=246 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=53.5t · 260.3 µs/step
    duel: "7421b1a1",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=53 b.hits=2646 contacts=0 severed=0 culled=0 scrap=21.2t · 207.0 µs/step
    beamDuel: "563db521",
    // ships=2 inFlight=17 p.fired=62 p.hits=188 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=5.2t · 106.5 µs/step
    binary: "a0e5ac97",
    // ships=6 inFlight=0 p.fired=101 p.hits=335 b.fired=0 b.hits=0 contacts=162 severed=8 culled=0 scrap=38.1t · 138.5 µs/step
    kernels: "5b686013",
    // ships=13 inFlight=0 p.fired=27 p.hits=126 b.fired=0 b.hits=0 contacts=319 severed=2 culled=0 scrap=17.5t · 128.2 µs/step
    asteroidField: "572dfdd1",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-26.3t · 51.5 µs/step
    mining: "bbe926cb",
    // ships=14 inFlight=21 p.fired=383 p.hits=1106 b.fired=0 b.hits=0 contacts=2280 severed=2 culled=1 scrap=50.3t · 2321.6 µs/step
    rivalMines: "3ef9fb5c",
    // ships=22 inFlight=43 p.fired=142 p.hits=178 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=2.1t · 670.7 µs/step
    swarm: "a1bb70b1",
    // ships=304 inFlight=214 p.fired=973 p.hits=1215 b.fired=0 b.hits=0 contacts=73 severed=6 culled=4 scrap=31.1t · 16514.6 µs/step
    superSwarm: "288e59ad",
    // ships=10 inFlight=0 p.fired=0 p.hits=0 b.fired=12 b.hits=516 contacts=38 severed=0 culled=0 scrap=22.4t · 156.9 µs/step
    torpedoes: "a44002e2",
    // ships=2 inFlight=0 p.fired=46 p.hits=229 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.2t · 78.9 µs/step
    ordering: "696c2fec",
    // ships=11 inFlight=1 p.fired=102 p.hits=329 b.fired=15 b.hits=701 contacts=63 severed=1 culled=0 scrap=86.8t · 267.1 µs/step
    standoff: "37fdbe50",
    // ships=14 inFlight=0 p.fired=143 p.hits=507 b.fired=33 b.hits=2514 contacts=2081 severed=22 culled=0 scrap=213.1t · 291.4 µs/step
    column: "0f3de4a8",
    // ships=5 inFlight=2 p.fired=17 p.hits=62 b.fired=0 b.hits=0 contacts=917 severed=9 culled=3 scrap=42.9t · 200.1 µs/step
    split: "e0867dd4",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 severed=0 culled=0 scrap=64439.8t · 2798.4 µs/step
    crash: "e8aaa276",
    // ships=18 inFlight=0 p.fired=0 p.hits=0 b.fired=11 b.hits=900 contacts=1681 severed=20 culled=0 scrap=111.1t · 307.3 µs/step
    torchRun: "75972fd8",
    // ships=6 inFlight=26 p.fired=97 p.hits=288 b.fired=0 b.hits=0 contacts=616 severed=6 culled=0 scrap=31.3t · 161.9 µs/step
    hooked: "7f99161d",
    // ships=3 inFlight=0 p.fired=24 p.hits=210 b.fired=0 b.hits=0 contacts=120 severed=2 culled=0 scrap=13.4t · 55.5 µs/step
    broadside: "34848024",
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
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.2t · 62.4 µs/step
    padRebuild: "c311dfbd",
    // ships=5 inFlight=0 p.fired=19 p.hits=63 b.fired=0 b.hits=0 contacts=34 severed=0 culled=0 scrap=1.6t · 99.5 µs/step
    factory: "fdec7f63",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.0t · 201.2 µs/step
    shipyard: "88a913a8",
    // ships=5 inFlight=0 p.fired=17 p.hits=62 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.3t · 109.1 µs/step
    rearm: "8bf84697",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=10 severed=2 culled=0 scrap=0.2t · 80.5 µs/step
    tanker: "5d78cc4f",
    // ships=20 inFlight=0 p.fired=10 p.hits=21 b.fired=165 b.hits=6072 contacts=24 severed=3 culled=0 scrap=15.2t · 688.5 µs/step
    beamCarrier: "19556803",
    // ships=2 inFlight=5 p.fired=56 p.hits=173 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=8.5t · 40.9 µs/step
    passes: "b3a38808",
    // ships=2 inFlight=4 p.fired=10 p.hits=33 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=8.5t · 45.6 µs/step
    circling: "865ddcc9",
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
