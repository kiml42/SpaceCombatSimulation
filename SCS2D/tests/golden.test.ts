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
    // ships=3 inFlight=8 p.fired=94 p.hits=262 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=31.9t · 190.7 µs/step
    duel: "198b971f",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=50 b.hits=2514 contacts=0 severed=0 culled=0 scrap=20.8t · 168.0 µs/step
    beamDuel: "d8cc48c0",
    // ships=2 inFlight=12 p.fired=51 p.hits=138 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.7t · 74.8 µs/step
    binary: "c1aca395",
    // ships=10 inFlight=0 p.fired=158 p.hits=519 b.fired=0 b.hits=0 contacts=7967 severed=17 culled=0 scrap=95.5t · 150.7 µs/step
    kernels: "923c9060",
    // ships=12 inFlight=17 p.fired=129 p.hits=421 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=14.8t · 83.4 µs/step
    asteroidField: "9a264dfd",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=134 severed=0 culled=0 scrap=-26.2t · 46.5 µs/step
    mining: "ab3363b4",
    // ships=13 inFlight=0 p.fired=411 p.hits=1200 b.fired=0 b.hits=0 contacts=19354 severed=5 culled=5 scrap=128.4t · 1716.4 µs/step
    rivalMines: "cb922a02",
    // ships=22 inFlight=42 p.fired=159 p.hits=176 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=2.2t · 593.6 µs/step
    swarm: "276227cd",
    // ships=305 inFlight=230 p.fired=1279 p.hits=1890 b.fired=0 b.hits=0 contacts=69 severed=3 culled=0 scrap=26.7t · 13097.8 µs/step
    superSwarm: "d54c94d2",
    // ships=14 inFlight=0 p.fired=0 p.hits=0 b.fired=5 b.hits=557 contacts=293 severed=33 culled=30 scrap=36.9t · 193.0 µs/step
    torpedoes: "21cf01b7",
    // ships=2 inFlight=0 p.fired=46 p.hits=227 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.2t · 76.8 µs/step
    ordering: "377a154b",
    // ships=14 inFlight=1 p.fired=110 p.hits=363 b.fired=15 b.hits=630 contacts=506 severed=7 culled=0 scrap=107.2t · 225.3 µs/step
    standoff: "637aa1c1",
    // ships=10 inFlight=8 p.fired=109 p.hits=402 b.fired=33 b.hits=2525 contacts=453 severed=6 culled=0 scrap=110.7t · 231.1 µs/step
    column: "4f274454",
    // ships=5 inFlight=3 p.fired=17 p.hits=59 b.fired=0 b.hits=0 contacts=867 severed=9 culled=6 scrap=38.5t · 167.7 µs/step
    split: "390d217b",
    // ships=19 inFlight=0 p.fired=0 p.hits=0 b.fired=11 b.hits=1006 contacts=1875 severed=23 culled=0 scrap=98.1t · 248.7 µs/step
    torchRun: "8be84a27",
    // ships=7 inFlight=6 p.fired=259 p.hits=1509 b.fired=0 b.hits=0 contacts=525 severed=3 culled=0 scrap=62.8t · 149.8 µs/step
    hooked: "610cd2e4",
    // ships=2 inFlight=9 p.fired=52 p.hits=309 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=10.5t · 51.3 µs/step
    broadside: "d49c35c4",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 severed=0 culled=0 scrap=5.1t · 29.0 µs/step
    salvageRun: "45d6c014",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 20.1 µs/step
    refitting: "052760e4",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=144.1t · 90.9 µs/step
    catamaranRefits: "eb579586",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=40 severed=3 culled=0 scrap=108.7t · 51.5 µs/step
    scavenge: "fde3de85",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.2t · 69.4 µs/step
    padRebuild: "e144c19e",
    // ships=4 inFlight=0 p.fired=17 p.hits=58 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.0t · 43.8 µs/step
    factory: "51e07b05",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.0t · 121.9 µs/step
    shipyard: "4b069157",
    // ships=5 inFlight=0 p.fired=16 p.hits=59 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.4t · 91.5 µs/step
    rearm: "6b68485b",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=10 severed=2 culled=0 scrap=0.2t · 85.1 µs/step
    tanker: "b262ee58",
    // ships=20 inFlight=0 p.fired=13 p.hits=25 b.fired=178 b.hits=5268 contacts=94 severed=8 culled=6 scrap=21.2t · 615.5 µs/step
    beamCarrier: "a9a1b3ae",
    // ships=2 inFlight=1 p.fired=59 p.hits=178 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=8.5t · 34.4 µs/step
    passes: "cdf13844",
    // ships=2 inFlight=4 p.fired=10 p.hits=33 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=8.5t · 38.1 µs/step
    circling: "ccd5aad6",
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
