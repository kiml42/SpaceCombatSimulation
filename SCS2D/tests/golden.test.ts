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
    // ships=4 inFlight=0 p.fired=85 p.hits=249 b.fired=0 b.hits=0 contacts=56 severed=1 culled=0 scrap=47.5t · 226.2 µs/step
    duel: "582e6c36",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=53 b.hits=2646 contacts=0 severed=0 culled=0 scrap=21.2t · 207.0 µs/step
    beamDuel: "563db521",
    // ships=2 inFlight=19 p.fired=63 p.hits=188 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=5.4t · 78.4 µs/step
    binary: "62526054",
    // ships=3 inFlight=0 p.fired=131 p.hits=474 b.fired=0 b.hits=0 contacts=104 severed=3 culled=0 scrap=160.8t · 116.3 µs/step
    kernels: "a6351239",
    // ships=12 inFlight=6 p.fired=117 p.hits=426 b.fired=0 b.hits=0 contacts=122 severed=1 culled=0 scrap=23.2t · 115.5 µs/step
    asteroidField: "bbb3938a",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-26.3t · 51.5 µs/step
    mining: "bbe926cb",
    // ships=14 inFlight=0 p.fired=539 p.hits=1518 b.fired=0 b.hits=0 contacts=1254 severed=1 culled=0 scrap=121.1t · 2214.9 µs/step
    rivalMines: "4ef9d5a4",
    // ships=22 inFlight=53 p.fired=140 p.hits=177 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=2.0t · 758.2 µs/step
    swarm: "a9c9b673",
    // ships=303 inFlight=253 p.fired=895 p.hits=1301 b.fired=0 b.hits=0 contacts=65 severed=5 culled=4 scrap=30.0t · 16824.7 µs/step
    superSwarm: "8cccbe7b",
    // ships=9 inFlight=0 p.fired=0 p.hits=0 b.fired=14 b.hits=920 contacts=99 severed=0 culled=0 scrap=23.7t · 130.6 µs/step
    torpedoes: "8d3b49f6",
    // ships=2 inFlight=0 p.fired=46 p.hits=230 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.3t · 108.3 µs/step
    ordering: "746c8efb",
    // ships=17 inFlight=0 p.fired=98 p.hits=301 b.fired=14 b.hits=502 contacts=20 severed=8 culled=0 scrap=99.3t · 273.0 µs/step
    standoff: "825e152d",
    // ships=15 inFlight=1 p.fired=159 p.hits=531 b.fired=31 b.hits=2222 contacts=2220 severed=21 culled=1 scrap=229.1t · 248.1 µs/step
    column: "d5917a0c",
    // ships=4 inFlight=4 p.fired=15 p.hits=84 b.fired=0 b.hits=0 contacts=1 severed=2 culled=0 scrap=51.7t · 136.1 µs/step
    split: "bebc00ce",
    // ships=36 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=5697 severed=33 culled=0 scrap=139308.6t · 2749.2 µs/step
    crash: "845ceb71",
    // ships=23 inFlight=0 p.fired=0 p.hits=0 b.fired=11 b.hits=881 contacts=2105 severed=24 culled=0 scrap=144.8t · 279.1 µs/step
    torchRun: "be4f80b5",
    // ships=4 inFlight=20 p.fired=188 p.hits=1142 b.fired=0 b.hits=0 contacts=285 severed=4 culled=0 scrap=35.1t · 210.9 µs/step
    hooked: "1bac1c9b",
    // ships=3 inFlight=0 p.fired=24 p.hits=227 b.fired=0 b.hits=0 contacts=120 severed=2 culled=0 scrap=13.5t · 61.1 µs/step
    broadside: "40b5d92c",
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
    // ships=5 inFlight=0 p.fired=18 p.hits=57 b.fired=0 b.hits=0 contacts=34 severed=0 culled=0 scrap=1.6t · 118.2 µs/step
    factory: "2e21ab82",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.0t · 201.2 µs/step
    shipyard: "88a913a8",
    // ships=5 inFlight=1 p.fired=19 p.hits=64 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.3t · 127.6 µs/step
    rearm: "15102a05",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=10 severed=2 culled=0 scrap=0.2t · 80.5 µs/step
    tanker: "5d78cc4f",
    // ships=20 inFlight=0 p.fired=13 p.hits=36 b.fired=184 b.hits=6598 contacts=19 severed=3 culled=0 scrap=10.5t · 796.3 µs/step
    beamCarrier: "aeba7b5d",
    // ships=2 inFlight=4 p.fired=56 p.hits=174 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=8.5t · 34.0 µs/step
    passes: "1351fe4c",
    // ships=2 inFlight=4 p.fired=10 p.hits=33 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=8.5t · 63.4 µs/step
    circling: "2e06ce79",
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
