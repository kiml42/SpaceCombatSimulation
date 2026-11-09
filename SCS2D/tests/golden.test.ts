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
    // ships=4 inFlight=11 p.fired=118 p.hits=352 b.fired=0 b.hits=0 contacts=38 severed=2 culled=1 scrap=43.8t · 172.2 µs/step
    duel: "176d0491",
    // ships=3 inFlight=1 p.fired=46 p.hits=166 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=28.9t · 109.6 µs/step
    railDuel: "a1864701",
    // ships=4 inFlight=16 p.fired=160 p.hits=562 b.fired=2 b.hits=261 contacts=461 severed=3 culled=0 scrap=122.9t · 152.9 µs/step
    lanceDuel: "291323fc",
    // ships=11 inFlight=0 p.fired=0 p.hits=0 b.fired=37 b.hits=2317 contacts=206 severed=8 culled=0 scrap=44.3t · 211.7 µs/step
    beamDuel: "b0b387aa",
    // ships=2 inFlight=23 p.fired=78 p.hits=216 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=10.2t · 91.6 µs/step
    binary: "4a82eaa1",
    // ships=7 inFlight=0 p.fired=126 p.hits=469 b.fired=0 b.hits=0 contacts=135 severed=8 culled=0 scrap=66.2t · 72.0 µs/step
    kernels: "af32fd78",
    // ships=12 inFlight=0 p.fired=76 p.hits=221 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=27.7t · 93.7 µs/step
    asteroidField: "0bcd2748",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-25.1t · 48.7 µs/step
    mining: "eb814177",
    // ships=16 inFlight=0 p.fired=483 p.hits=1304 b.fired=0 b.hits=0 contacts=1134 severed=3 culled=2 scrap=47.3t · 1740.6 µs/step
    rivalMines: "59e6b1c5",
    // ships=22 inFlight=75 p.fired=170 p.hits=148 b.fired=0 b.hits=0 contacts=0 severed=1 culled=1 scrap=5.8t · 612.9 µs/step
    swarm: "9da209ba",
    // ships=304 inFlight=257 p.fired=764 p.hits=972 b.fired=0 b.hits=0 contacts=231 severed=13 culled=11 scrap=46.0t · 15986.4 µs/step
    superSwarm: "7f70a122",
    // ships=13 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=730 contacts=109 severed=1 culled=0 scrap=25.2t · 140.4 µs/step
    torpedoes: "c4f0f558",
    // ships=2 inFlight=0 p.fired=45 p.hits=228 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.2t · 94.9 µs/step
    ordering: "dac00a46",
    // ships=10 inFlight=2 p.fired=139 p.hits=452 b.fired=15 b.hits=836 contacts=0 severed=0 culled=0 scrap=86.8t · 282.0 µs/step
    standoff: "abca367a",
    // ships=17 inFlight=0 p.fired=109 p.hits=566 b.fired=34 b.hits=2227 contacts=340 severed=11 culled=0 scrap=129.1t · 222.2 µs/step
    column: "52ac105d",
    // ships=5 inFlight=1 p.fired=16 p.hits=84 b.fired=0 b.hits=0 contacts=895 severed=8 culled=4 scrap=58.9t · 204.8 µs/step
    split: "70349a09",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 severed=0 culled=0 scrap=64507.6t · 2971.9 µs/step
    crash: "4048d492",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=9 b.hits=1399 contacts=969 severed=16 culled=0 scrap=190.1t · 185.5 µs/step
    torchRun: "32852521",
    // ships=7 inFlight=22 p.fired=150 p.hits=688 b.fired=0 b.hits=0 contacts=38 severed=5 culled=0 scrap=36.5t · 134.1 µs/step
    hooked: "e6c2c746",
    // ships=2 inFlight=0 p.fired=24 p.hits=151 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.8t · 66.7 µs/step
    broadside: "c9b592b4",
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
    // ships=5 inFlight=0 p.fired=22 p.hits=87 b.fired=0 b.hits=0 contacts=34 severed=0 culled=0 scrap=1.6t · 65.8 µs/step
    factory: "73907a8c",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.1t · 128.1 µs/step
    shipyard: "ed2487e5",
    // ships=5 inFlight=0 p.fired=19 p.hits=66 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.4t · 103.3 µs/step
    rearm: "075e535c",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=12 severed=2 culled=0 scrap=0.2t · 90.0 µs/step
    tanker: "69ab665b",
    // ships=21 inFlight=0 p.fired=14 p.hits=21 b.fired=224 b.hits=7262 contacts=80 severed=4 culled=1 scrap=13.9t · 695.1 µs/step
    beamCarrier: "7d035f1a",
    // ships=2 inFlight=0 p.fired=54 p.hits=181 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.3t · 40.9 µs/step
    passes: "e721914a",
    // ships=2 inFlight=0 p.fired=2 p.hits=8 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=9.3t · 60.6 µs/step
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
