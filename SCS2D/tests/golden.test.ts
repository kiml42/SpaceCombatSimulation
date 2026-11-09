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
    // ships=4 inFlight=2 p.fired=111 p.hits=340 b.fired=0 b.hits=0 contacts=316 severed=2 culled=0 scrap=34.5t · 249.1 µs/step
    duel: "1905d7e9",
    // ships=3 inFlight=4 p.fired=39 p.hits=148 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=35.3t · 126.2 µs/step
    railDuel: "007fb645",
    // ships=5 inFlight=4 p.fired=157 p.hits=611 b.fired=2 b.hits=246 contacts=514 severed=3 culled=0 scrap=132.3t · 220.3 µs/step
    lanceDuel: "08ae5f1a",
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
    // ships=12 inFlight=14 p.fired=180 p.hits=531 b.fired=0 b.hits=0 contacts=2215 severed=2 culled=1 scrap=112.9t · 2183.0 µs/step
    rivalMines: "58e80b9c",
    // ships=22 inFlight=18 p.fired=117 p.hits=149 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=2.0t · 567.2 µs/step
    swarm: "fc504ca7",
    // ships=304 inFlight=228 p.fired=1004 p.hits=1350 b.fired=0 b.hits=0 contacts=175 severed=6 culled=4 scrap=33.1t · 13995.7 µs/step
    superSwarm: "ce719a0c",
    // ships=12 inFlight=0 p.fired=0 p.hits=0 b.fired=6 b.hits=528 contacts=80 severed=1 culled=0 scrap=26.9t · 123.6 µs/step
    torpedoes: "bc4485b1",
    // ships=2 inFlight=0 p.fired=45 p.hits=228 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.2t · 94.9 µs/step
    ordering: "dac00a46",
    // ships=16 inFlight=4 p.fired=108 p.hits=311 b.fired=12 b.hits=476 contacts=120 severed=6 culled=0 scrap=97.4t · 232.3 µs/step
    standoff: "0b55cee9",
    // ships=12 inFlight=0 p.fired=175 p.hits=615 b.fired=22 b.hits=2199 contacts=786 severed=15 culled=0 scrap=292.6t · 233.5 µs/step
    column: "241e94f2",
    // ships=5 inFlight=1 p.fired=17 p.hits=95 b.fired=0 b.hits=0 contacts=923 severed=8 culled=4 scrap=55.3t · 162.2 µs/step
    split: "508415ee",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 severed=0 culled=0 scrap=64507.6t · 2971.9 µs/step
    crash: "4048d492",
    // ships=14 inFlight=0 p.fired=0 p.hits=0 b.fired=7 b.hits=947 contacts=542 severed=10 culled=0 scrap=134.9t · 230.1 µs/step
    torchRun: "3ba83455",
    // ships=8 inFlight=29 p.fired=141 p.hits=405 b.fired=0 b.hits=0 contacts=483 severed=7 culled=0 scrap=92.0t · 172.6 µs/step
    hooked: "925c6ee6",
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
    // ships=5 inFlight=0 p.fired=20 p.hits=63 b.fired=0 b.hits=0 contacts=36 severed=0 culled=0 scrap=1.6t · 78.9 µs/step
    factory: "9c532b1e",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.1t · 128.1 µs/step
    shipyard: "ed2487e5",
    // ships=5 inFlight=0 p.fired=15 p.hits=60 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.4t · 121.8 µs/step
    rearm: "e70ff061",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=12 severed=2 culled=0 scrap=0.2t · 90.0 µs/step
    tanker: "69ab665b",
    // ships=21 inFlight=0 p.fired=9 p.hits=13 b.fired=229 b.hits=7495 contacts=95 severed=4 culled=1 scrap=14.8t · 684.5 µs/step
    beamCarrier: "d4c13baf",
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
