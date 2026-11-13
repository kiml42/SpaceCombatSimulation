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
    // ships=3 inFlight=1 p.fired=44 p.hits=187 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=44.3t · 133.3 µs/step
    railDuel: "9026cee6",
    // ships=4 inFlight=10 p.fired=141 p.hits=438 b.fired=2 b.hits=235 contacts=238 bumps=0 crashes=0 severed=3 culled=0 scrap=141.5t · 148.7 µs/step
    lanceDuel: "137f1147",
    // ships=8 inFlight=0 p.fired=0 p.hits=0 b.fired=40 b.hits=3579 contacts=3 bumps=0 crashes=3 severed=5 culled=0 scrap=55.9t · 138.8 µs/step
    beamDuel: "4b175878",
    // ships=2 inFlight=13 p.fired=57 p.hits=159 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.2t · 99.4 µs/step
    binary: "6ce9d685",
    // ships=6 inFlight=0 p.fired=90 p.hits=466 b.fired=0 b.hits=0 contacts=12 bumps=0 crashes=6 severed=4 culled=0 scrap=28.2t · 56.2 µs/step
    kernels: "f0831ec8",
    // ships=13 inFlight=18 p.fired=183 p.hits=719 b.fired=0 b.hits=0 contacts=120 bumps=0 crashes=0 severed=2 culled=0 scrap=37.6t · 71.4 µs/step
    asteroidField: "312c573d",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-25.1t · 40.7 µs/step
    mining: "ba358939",
    // ships=17 inFlight=4 p.fired=807 p.hits=2203 b.fired=0 b.hits=0 contacts=210 bumps=4 crashes=3 severed=2 culled=1 scrap=23.2t · 1508.0 µs/step
    rivalMines: "3ae0c549",
    // ships=22 inFlight=37 p.fired=121 p.hits=83 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=1 scrap=5.4t · 511.0 µs/step
    swarm: "79c43f51",
    // ships=306 inFlight=258 p.fired=517 p.hits=640 b.fired=0 b.hits=0 contacts=144 bumps=1 crashes=12 severed=10 culled=6 scrap=32.0t · 15923.1 µs/step
    superSwarm: "35027c6f",
    // ships=11 inFlight=0 p.fired=0 p.hits=0 b.fired=9 b.hits=760 contacts=26 bumps=0 crashes=7 severed=0 culled=0 scrap=19.0t · 100.7 µs/step
    torpedoes: "4fc56e0d",
    // ships=2 inFlight=39 p.fired=62 p.hits=224 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=3.1t · 86.7 µs/step
    ordering: "972ba439",
    // ships=16 inFlight=0 p.fired=74 p.hits=295 b.fired=13 b.hits=725 contacts=257 bumps=0 crashes=15 severed=7 culled=1 scrap=113.8t · 186.2 µs/step
    standoff: "864bf1b3",
    // ships=19 inFlight=0 p.fired=134 p.hits=541 b.fired=32 b.hits=2284 contacts=392 bumps=2 crashes=25 severed=11 culled=0 scrap=137.2t · 172.6 µs/step
    column: "29f08ad0",
    // ships=5 inFlight=0 p.fired=5 p.hits=33 b.fired=0 b.hits=0 contacts=893 bumps=8 crashes=1 severed=8 culled=3 scrap=40.4t · 110.7 µs/step
    split: "a0cedd36",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 bumps=0 crashes=3 severed=0 culled=0 scrap=64849.3t · 1658.4 µs/step
    crash: "bd8c5319",
    // ships=8 inFlight=0 p.fired=0 p.hits=0 b.fired=9 b.hits=1387 contacts=1697 bumps=2 crashes=2 severed=3 culled=0 scrap=23.0t · 262.2 µs/step
    torchRun: "d23d2f58",
    // ships=5 inFlight=48 p.fired=240 p.hits=1035 b.fired=0 b.hits=0 contacts=319 bumps=1 crashes=0 severed=3 culled=0 scrap=48.9t · 111.2 µs/step
    hooked: "a99a917f",
    // ships=2 inFlight=0 p.fired=43 p.hits=301 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.2t · 77.9 µs/step
    broadside: "a7d7c05c",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 severed=0 culled=0 scrap=5.1t · 25.6 µs/step
    salvageRun: "804efd7f",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 22.0 µs/step
    refitting: "35d04241",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=144.1t · 61.6 µs/step
    catamaranRefits: "5a7a56c3",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=46 bumps=1 crashes=2 severed=3 culled=0 scrap=108.3t · 56.4 µs/step
    scavenge: "daa190be",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 42.5 µs/step
    padRebuild: "6d03b457",
    // ships=5 inFlight=0 p.fired=22 p.hits=86 b.fired=0 b.hits=0 contacts=34 bumps=0 crashes=0 severed=0 culled=0 scrap=1.6t · 95.6 µs/step
    factory: "f62b447c",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=32.1t · 115.5 µs/step
    shipyard: "c06171cb",
    // ships=5 inFlight=0 p.fired=17 p.hits=63 b.fired=0 b.hits=0 contacts=35 bumps=0 crashes=1 severed=0 culled=0 scrap=0.4t · 76.1 µs/step
    rearm: "37971fe8",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=6 bumps=3 crashes=0 severed=2 culled=0 scrap=0.1t · 90.0 µs/step
    tanker: "4de63ce8",
    // ships=20 inFlight=0 p.fired=26 p.hits=87 b.fired=225 b.hits=6164 contacts=61 bumps=1 crashes=3 severed=1 culled=0 scrap=12.9t · 507.9 µs/step
    beamCarrier: "40cf6db8",
    // ships=2 inFlight=0 p.fired=54 p.hits=191 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 45.1 µs/step
    passes: "792bb71e",
    // ships=2 inFlight=0 p.fired=2 p.hits=22 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 90.0 µs/step
    circling: "bdc6bd8c",
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
