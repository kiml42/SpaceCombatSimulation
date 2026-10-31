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
    // ships=4 inFlight=22 p.fired=129 p.hits=372 b.fired=0 b.hits=0 contacts=225 severed=2 culled=0 scrap=36.9t · 237.4 µs/step
    duel: "f5558b88",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=49 b.hits=2263 contacts=0 severed=0 culled=0 scrap=20.3t · 184.5 µs/step
    beamDuel: "f21608a6",
    // ships=2 inFlight=11 p.fired=53 p.hits=146 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.6t · 73.1 µs/step
    binary: "1bf85068",
    // ships=15 inFlight=0 p.fired=141 p.hits=547 b.fired=0 b.hits=0 contacts=371 severed=12 culled=0 scrap=34.1t · 119.3 µs/step
    kernels: "81e39626",
    // ships=12 inFlight=13 p.fired=113 p.hits=377 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=17.9t · 86.0 µs/step
    asteroidField: "f6f91086",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=134 severed=0 culled=0 scrap=-26.2t · 46.5 µs/step
    mining: "ab3363b4",
    // ships=12 inFlight=0 p.fired=445 p.hits=1194 b.fired=0 b.hits=0 contacts=85 severed=1 culled=1 scrap=136.2t · 1844.8 µs/step
    rivalMines: "a7bb0d29",
    // ships=22 inFlight=23 p.fired=140 p.hits=144 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=2.3t · 606.6 µs/step
    swarm: "e978ac59",
    // ships=305 inFlight=111 p.fired=1129 p.hits=2124 b.fired=0 b.hits=0 contacts=158 severed=3 culled=0 scrap=24.0t · 13425.5 µs/step
    superSwarm: "6df092a9",
    // ships=14 inFlight=0 p.fired=0 p.hits=0 b.fired=9 b.hits=715 contacts=61 severed=21 culled=20 scrap=26.1t · 165.7 µs/step
    torpedoes: "12f0cd5b",
    // ships=2 inFlight=0 p.fired=46 p.hits=227 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=3.2t · 71.4 µs/step
    ordering: "40f2221a",
    // ships=10 inFlight=1 p.fired=99 p.hits=336 b.fired=16 b.hits=769 contacts=125 severed=2 culled=1 scrap=93.2t · 203.5 µs/step
    standoff: "ce1be976",
    // ships=15 inFlight=30 p.fired=311 p.hits=1085 b.fired=18 b.hits=1324 contacts=1685 severed=20 culled=0 scrap=172.0t · 296.3 µs/step
    column: "92a36e73",
    // ships=6 inFlight=2 p.fired=16 p.hits=89 b.fired=0 b.hits=0 contacts=717 severed=10 culled=4 scrap=33.2t · 200.2 µs/step
    split: "13417e20",
    // ships=13 inFlight=0 p.fired=0 p.hits=0 b.fired=12 b.hits=1208 contacts=526 severed=10 culled=0 scrap=64.8t · 262.4 µs/step
    torchRun: "a3d85fd5",
    // ships=4 inFlight=41 p.fired=218 p.hits=1210 b.fired=0 b.hits=0 contacts=14 severed=1 culled=1 scrap=42.7t · 166.0 µs/step
    hooked: "c17d21d0",
    // ships=2 inFlight=4 p.fired=49 p.hits=310 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=7.9t · 62.5 µs/step
    broadside: "61790eb4",
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
    // ships=4 inFlight=0 p.fired=17 p.hits=64 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.0t · 52.4 µs/step
    factory: "6fb2fa8d",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=1 culled=0 scrap=32.0t · 121.9 µs/step
    shipyard: "4b069157",
    // ships=5 inFlight=0 p.fired=17 p.hits=59 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=0.4t · 98.5 µs/step
    rearm: "dd016907",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=10 severed=2 culled=0 scrap=0.2t · 85.1 µs/step
    tanker: "b262ee58",
    // ships=21 inFlight=0 p.fired=18 p.hits=51 b.fired=194 b.hits=6113 contacts=94 severed=6 culled=3 scrap=18.8t · 621.7 µs/step
    beamCarrier: "a1a2a01a",
    // ships=2 inFlight=0 p.fired=51 p.hits=163 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=8.5t · 33.3 µs/step
    passes: "816d4617",
    // ships=2 inFlight=4 p.fired=10 p.hits=33 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=8.5t · 38.6 µs/step
    circling: "efc282e6",
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
