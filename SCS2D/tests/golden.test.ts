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
    // ships=4 inFlight=0 p.fired=85 p.hits=249 b.fired=0 b.hits=0 contacts=56 severed=1 culled=0 scrap=47.5t · 240.5 µs/step
    duel: "0ff8cb1b",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=53 b.hits=2646 contacts=0 severed=0 culled=0 scrap=21.2t · 207.0 µs/step
    beamDuel: "563db521",
    // ships=2 inFlight=19 p.fired=63 p.hits=188 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=5.4t · 78.4 µs/step
    binary: "62526054",
    // ships=7 inFlight=0 p.fired=111 p.hits=439 b.fired=0 b.hits=0 contacts=155 severed=9 culled=0 scrap=23.9t · 104.5 µs/step
    kernels: "1ae3da86",
    // ships=12 inFlight=6 p.fired=117 p.hits=426 b.fired=0 b.hits=0 contacts=122 severed=1 culled=0 scrap=23.2t · 157.5 µs/step
    asteroidField: "724c4a31",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 severed=0 culled=0 scrap=-26.3t · 51.5 µs/step
    mining: "bbe926cb",
    // ships=11 inFlight=0 p.fired=122 p.hits=343 b.fired=0 b.hits=0 contacts=1015 severed=3 culled=1 scrap=193.7t · 2076.4 µs/step
    rivalMines: "548cca9d",
    // ships=22 inFlight=44 p.fired=145 p.hits=140 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=2.0t · 698.7 µs/step
    swarm: "04155d6d",
    // ships=304 inFlight=217 p.fired=1207 p.hits=1878 b.fired=0 b.hits=0 contacts=267 severed=4 culled=2 scrap=27.8t · 18037.0 µs/step
    superSwarm: "ae53f22a",
    // ships=13 inFlight=0 p.fired=0 p.hits=0 b.fired=12 b.hits=547 contacts=2004 severed=29 culled=29 scrap=27.7t · 199.2 µs/step
    torpedoes: "09090284",
    // ships=2 inFlight=0 p.fired=46 p.hits=230 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.3t · 108.3 µs/step
    ordering: "746c8efb",
    // ships=17 inFlight=0 p.fired=114 p.hits=386 b.fired=15 b.hits=660 contacts=11 severed=7 culled=0 scrap=92.8t · 222.3 µs/step
    standoff: "78679ae5",
    // ships=19 inFlight=0 p.fired=136 p.hits=473 b.fired=34 b.hits=2397 contacts=1651 severed=20 culled=0 scrap=176.7t · 308.5 µs/step
    column: "008a3e73",
    // ships=4 inFlight=1 p.fired=17 p.hits=86 b.fired=0 b.hits=0 contacts=895 severed=8 culled=6 scrap=63.7t · 291.2 µs/step
    split: "08d48444",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=10 b.hits=891 contacts=1950 severed=20 culled=0 scrap=123.4t · 337.4 µs/step
    torchRun: "849c3223",
    // ships=6 inFlight=26 p.fired=164 p.hits=886 b.fired=0 b.hits=0 contacts=10 severed=2 culled=0 scrap=39.4t · 224.4 µs/step
    hooked: "f026b9ba",
    // ships=3 inFlight=0 p.fired=24 p.hits=227 b.fired=0 b.hits=0 contacts=120 severed=2 culled=0 scrap=13.5t · 56.7 µs/step
    broadside: "dfe3b0d7",
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
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.2t · 73.6 µs/step
    padRebuild: "f4ee96a3",
    // ships=5 inFlight=0 p.fired=19 p.hits=66 b.fired=0 b.hits=0 contacts=10 severed=0 culled=0 scrap=1.6t · 89.0 µs/step
    factory: "6bc386ad",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.0t · 121.9 µs/step
    shipyard: "4b069157",
    // ships=5 inFlight=0 p.fired=17 p.hits=68 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.4t · 94.6 µs/step
    rearm: "dce47875",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=10 severed=2 culled=0 scrap=0.2t · 85.1 µs/step
    tanker: "b262ee58",
    // ships=23 inFlight=0 p.fired=8 p.hits=9 b.fired=191 b.hits=5631 contacts=550 severed=10 culled=4 scrap=19.9t · 637.3 µs/step
    beamCarrier: "8945c8dc",
    // ships=2 inFlight=2 p.fired=77 p.hits=243 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=8.5t · 46.5 µs/step
    passes: "e35ae8a2",
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
