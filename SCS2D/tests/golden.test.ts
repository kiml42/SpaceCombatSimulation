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
    // ships=4 inFlight=12 p.fired=116 p.hits=340 b.fired=0 b.hits=0 contacts=42 severed=1 culled=0 scrap=50.9t · 293.3 µs/step
    duel: "26df4d28",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=53 b.hits=2390 contacts=0 severed=0 culled=0 scrap=20.8t · 251.9 µs/step
    beamDuel: "c5e5abd9",
    // ships=2 inFlight=24 p.fired=74 p.hits=204 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 120.1 µs/step
    binary: "21b83049",
    // ships=6 inFlight=0 p.fired=111 p.hits=416 b.fired=0 b.hits=0 contacts=228 severed=9 culled=0 scrap=46.6t · 137.0 µs/step
    kernels: "24c4b66d",
    // ships=12 inFlight=0 p.fired=27 p.hits=63 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=15.1t · 102.3 µs/step
    asteroidField: "dd799be7",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-26.3t · 51.5 µs/step
    mining: "bbe926cb",
    // ships=12 inFlight=0 p.fired=313 p.hits=822 b.fired=0 b.hits=0 contacts=4943 severed=1 culled=0 scrap=85.9t · 2181.6 µs/step
    rivalMines: "a64c3eec",
    // ships=22 inFlight=52 p.fired=139 p.hits=177 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.8t · 1188.3 µs/step
    swarm: "80a77095",
    // ships=303 inFlight=260 p.fired=910 p.hits=1187 b.fired=0 b.hits=0 contacts=12 severed=4 culled=3 scrap=24.7t · 27912.1 µs/step
    superSwarm: "3f9e1b01",
    // ships=12 inFlight=0 p.fired=0 p.hits=0 b.fired=9 b.hits=569 contacts=77 severed=0 culled=0 scrap=22.2t · 180.6 µs/step
    torpedoes: "dcfd5ffd",
    // ships=2 inFlight=0 p.fired=46 p.hits=231 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.2t · 86.9 µs/step
    ordering: "503351da",
    // ships=16 inFlight=1 p.fired=121 p.hits=381 b.fired=14 b.hits=332 contacts=62 severed=6 culled=0 scrap=106.6t · 249.0 µs/step
    standoff: "5df7f06f",
    // ships=23 inFlight=0 p.fired=128 p.hits=464 b.fired=31 b.hits=1927 contacts=970 severed=23 culled=1 scrap=265.9t · 235.5 µs/step
    column: "7514b5b9",
    // ships=4 inFlight=2 p.fired=17 p.hits=91 b.fired=0 b.hits=0 contacts=844 severed=8 culled=6 scrap=61.0t · 272.0 µs/step
    split: "04e4df10",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=29 severed=0 culled=0 scrap=64439.8t · 2798.4 µs/step
    crash: "e8aaa276",
    // ships=18 inFlight=0 p.fired=0 p.hits=0 b.fired=11 b.hits=898 contacts=1681 severed=20 culled=0 scrap=111.1t · 247.5 µs/step
    torchRun: "e836277b",
    // ships=5 inFlight=25 p.fired=128 p.hits=509 b.fired=0 b.hits=0 contacts=242 severed=3 culled=0 scrap=15.6t · 165.8 µs/step
    hooked: "3bf43a3c",
    // ships=5 inFlight=0 p.fired=15 p.hits=161 b.fired=0 b.hits=0 contacts=61 severed=3 culled=0 scrap=14.5t · 61.6 µs/step
    broadside: "a152f110",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 severed=0 culled=0 scrap=5.0t · 30.4 µs/step
    salvageRun: "fa736e64",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 20.1 µs/step
    refitting: "052760e4",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=144.1t · 90.9 µs/step
    catamaranRefits: "eb579586",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=22 severed=3 culled=0 scrap=108.2t · 72.8 µs/step
    scavenge: "a024a6a1",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.2t · 62.4 µs/step
    padRebuild: "c311dfbd",
    // ships=5 inFlight=0 p.fired=18 p.hits=57 b.fired=0 b.hits=0 contacts=34 severed=0 culled=0 scrap=1.6t · 118.2 µs/step
    factory: "2e21ab82",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.0t · 201.2 µs/step
    shipyard: "88a913a8",
    // ships=5 inFlight=1 p.fired=19 p.hits=64 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.3t · 105.7 µs/step
    rearm: "332c6929",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=10 severed=2 culled=0 scrap=0.2t · 80.5 µs/step
    tanker: "5d78cc4f",
    // ships=20 inFlight=0 p.fired=15 p.hits=42 b.fired=179 b.hits=5273 contacts=5 severed=1 culled=0 scrap=15.3t · 772.3 µs/step
    beamCarrier: "dcac750f",
    // ships=2 inFlight=3 p.fired=56 p.hits=179 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=8.5t · 37.2 µs/step
    passes: "d6649dd2",
    // ships=2 inFlight=4 p.fired=10 p.hits=33 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=8.5t · 40.6 µs/step
    circling: "4f4d4898",
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
