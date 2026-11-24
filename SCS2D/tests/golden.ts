import { describe, expect, it } from "vitest";
import { formatChecksum } from "../sim/checksum.js";
import { SCENARIO_TIMEOUT, SCENARIOS, type ScenarioName } from "./fixtures/scenarios.js";

/**
 * Golden tests: the simulation's behaviour, pinned.
 *
 * These prove the simulation still does the *same thing* it did before — the
 * check that makes it safe to refactor the physics after months away. Run
 * `npm test` from a cold checkout: if these pass, the simulation is intact.
 *
 * A few quick scenarios are also fought a second time in the same process, and
 * must reach the same state halfway and at the end. That needs no recorded
 * value, so re-recording cannot "fix" it, and it catches state leaking from one
 * run into the next. It needs each system exercised, not every battle, so only
 * those listed in `RERUN` are.
 *
 * The constants are here, and the tests in `golden*.test.ts`, so the slowest
 * battles can have files of their own and run beside the rest.
 *
 * WHEN ONE FAILS, that means simulated behaviour changed. Either:
 *
 *   - You did not mean to change it. Find out what you broke. Do not touch
 *     the constants.
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

export const GOLDEN: Record<ScenarioName, string> = {
    // bodies=1 · 0.6 µs/step
    orbit: "0441a895",
    // bodies=8 · 3.5 µs/step
    tumble: "52118178",
    // bodies=9 inFlight=65 projectilesPending=0 projectileHits=1688 · 14.7 µs/step
    gunnery: "b2054d50",
    // ships=3 inFlight=2 p.fired=77 p.hits=172 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=19.2t · 205.6 µs/step
    duel: "9f2f9189",
    // ships=5 inFlight=0 p.fired=54 p.hits=105 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=2 culled=0 scrap=112.3t · 151.1 µs/step
    railDuel: "806f1e3f",
    // ships=3 inFlight=24 p.fired=144 p.hits=198 b.fired=2 b.hits=243 contacts=121 bumps=1 crashes=0 severed=2 culled=0 scrap=128.3t · 193.4 µs/step
    lanceDuel: "3b21a79d",
    // ships=7 inFlight=0 p.fired=0 p.hits=5 b.fired=41 b.hits=3809 contacts=90 bumps=0 crashes=2 severed=4 culled=0 scrap=60.8t · 126.4 µs/step
    beamDuel: "af9159f3",
    // ships=2 inFlight=27 p.fired=46 p.hits=83 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.1t · 63.0 µs/step
    binary: "cb7246b2",
    // ships=4 inFlight=0 p.fired=175 p.hits=549 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=41.3t · 77.3 µs/step
    kernels: "78323905",
    // ships=12 inFlight=0 p.fired=147 p.hits=298 b.fired=0 b.hits=0 contacts=112 bumps=0 crashes=0 severed=1 culled=0 scrap=31.5t · 71.5 µs/step
    asteroidField: "ee3133ad",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 38.6 µs/step
    mining: "0095f392",
    // ships=11 inFlight=0 p.fired=343 p.hits=796 b.fired=0 b.hits=0 contacts=183 bumps=3 crashes=0 severed=2 culled=2 scrap=112.1t · 539.7 µs/step
    rivalMines: "10466f94",
    // ships=22 inFlight=14 p.fired=97 p.hits=68 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.2t · 562.8 µs/step
    swarm: "29660a7a",
    // ships=303 inFlight=214 p.fired=694 p.hits=915 b.fired=0 b.hits=0 contacts=75 bumps=1 crashes=9 severed=4 culled=3 scrap=21.1t · 17345.8 µs/step
    superSwarm: "014c2556",
    // ships=8 inFlight=0 p.fired=0 p.hits=229 b.fired=5 b.hits=874 contacts=171 bumps=0 crashes=1 severed=2 culled=0 scrap=62.7t · 90.8 µs/step
    torpedoes: "7083a739",
    // ships=10 inFlight=0 p.fired=0 p.hits=352 b.fired=6 b.hits=30 contacts=14 bumps=0 crashes=1 severed=1 culled=0 scrap=28.9t · 110.5 µs/step
    torpedoesWarhead: "8e3e4d70",
    // ships=8 inFlight=0 p.fired=0 p.hits=330 b.fired=7 b.hits=75 contacts=5 bumps=0 crashes=1 severed=0 culled=0 scrap=17.6t · 102.6 µs/step
    torpedoesShaped: "bd5856a4",
    // ships=3 inFlight=0 p.fired=4 p.hits=85 b.fired=0 b.hits=0 contacts=12 bumps=0 crashes=1 severed=0 culled=0 scrap=49.3t · 81.3 µs/step
    torpedoesGunPlatform: "09d29783",
    // ships=3 inFlight=0 p.fired=2 p.hits=618 b.fired=0 b.hits=0 contacts=14 bumps=0 crashes=1 severed=0 culled=0 scrap=70.8t · 125.9 µs/step
    torpedoesWarheadGunPlatform: "e9ab8e4b",
    // ships=9 inFlight=0 p.fired=2 p.hits=89 b.fired=0 b.hits=0 contacts=6 bumps=0 crashes=1 severed=0 culled=0 scrap=28.9t · 119.6 µs/step
    torpedoesShapedGunPlatform: "bc144324",
    // ships=6 inFlight=0 p.fired=18 p.hits=176 b.fired=0 b.hits=0 contacts=40 bumps=0 crashes=2 severed=0 culled=0 scrap=20.1t · 195.4 µs/step
    torpedoBoatTorpedoes: "85c11547",
    // ships=4 inFlight=12 p.fired=113 p.hits=179 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=20.2t · 101.8 µs/step
    disarm: "3c38e492",
    // ships=3 inFlight=0 p.fired=44 p.hits=47 b.fired=36 b.hits=1996 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=46.0t · 89.7 µs/step
    disarmBeams: "e365eac7",
    // ships=3 inFlight=0 p.fired=79 p.hits=155 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=27.4t · 81.6 µs/step
    disarmRails: "0b27fb58",
    // ships=2 inFlight=30 p.fired=53 p.hits=99 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.0t · 54.8 µs/step
    ordering: "a191f676",
    // ships=11 inFlight=4 p.fired=123 p.hits=292 b.fired=17 b.hits=1162 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=97.5t · 255.1 µs/step
    standoff: "e60b43b2",
    // ships=11 inFlight=1 p.fired=326 p.hits=791 b.fired=17 b.hits=1320 contacts=1259 bumps=11 crashes=0 severed=11 culled=0 scrap=223.2t · 218.2 µs/step
    column: "132cf3c7",
    // ships=4 inFlight=0 p.fired=11 p.hits=56 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=3 culled=1 scrap=28.5t · 117.6 µs/step
    split: "fe417e05",
    // ships=20 inFlight=1 p.fired=0 p.hits=8 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74360.6t · 2303.0 µs/step
    crash: "12c270fd",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=2163 contacts=74 bumps=2 crashes=1 severed=2 culled=0 scrap=36.1t · 189.8 µs/step
    torchRun: "8e228649",
    // ships=5 inFlight=89 p.fired=142 p.hits=508 b.fired=0 b.hits=0 contacts=3 bumps=1 crashes=0 severed=1 culled=0 scrap=27.7t · 175.0 µs/step
    hooked: "7ab83fff",
    // ships=2 inFlight=0 p.fired=37 p.hits=140 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.9t · 68.2 µs/step
    broadside: "98db38fe",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=1 crashes=0 severed=0 culled=0 scrap=5.0t · 19.2 µs/step
    salvageRun: "53124c5d",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 22.0 µs/step
    refitting: "35d04241",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=144.1t · 26.0 µs/step
    catamaranRefits: "725f0e88",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=34 bumps=3 crashes=0 severed=3 culled=0 scrap=108.3t · 29.9 µs/step
    scavenge: "df825eca",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.0t · 26.9 µs/step
    padRebuild: "0d31c912",
    // ships=5 inFlight=0 p.fired=67 p.hits=71 b.fired=0 b.hits=0 contacts=38 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 82.6 µs/step
    factory: "a8f70220",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 134.4 µs/step
    shipyard: "3a5a0509",
    // ships=5 inFlight=4 p.fired=36 p.hits=40 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 77.0 µs/step
    rearm: "564c2668",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=2 culled=0 scrap=0.1t · 85.5 µs/step
    tanker: "cbe039d9",
    // ships=20 inFlight=0 p.fired=35 p.hits=125 b.fired=148 b.hits=6231 contacts=84 bumps=2 crashes=8 severed=2 culled=0 scrap=10.8t · 698.2 µs/step
    beamCarrier: "b78c0a2d",
    // ships=2 inFlight=0 p.fired=55 p.hits=103 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 35.1 µs/step
    passes: "04bc529b",
    // ships=2 inFlight=0 p.fired=2 p.hits=3 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 45.4 µs/step
    circling: "e41786bc",
    // ships=4 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.0t · 38.9 µs/step
    orbiting: "cdaa6ce2",
};

/** The battles slow enough to need a test file each, so they run beside the rest. */
export const ALONE: readonly ScenarioName[] = ["superSwarm", "rivalMines"];

/** Fought twice, between them covering guns, beams, torpedoes, severing, welding, mining, pads and building. */
const RERUN: readonly ScenarioName[] = ["duel", "beamDuel", "torpedoes", "split", "hooked", "mining", "rearm", "factory"];

/** A scenario's checksums halfway through and at the end. */
function fight(name: ScenarioName): { half: number; end: number } {
    const scenario = SCENARIOS[name];
    const run = scenario.build();
    const halfway = Math.floor(scenario.steps / 2);
    for (let i = 0; i < halfway; i++) run.step();
    const half = run.checksum();
    for (let i = halfway; i < scenario.steps; i++) run.step();
    return { half, end: run.checksum() };
}

/** Each scenario against its recorded checksum, and fought again to the same state. */
export function goldenTests(names: readonly ScenarioName[]): void {
    describe("golden scenarios", () => {
        for (const name of names) {
            const scenario = SCENARIOS[name];
            // Kept for the rerun, which fights it itself if this test was filtered out.
            let first: { half: number; end: number } | undefined;

            it(
                `${name} matches its recorded checksum after ${scenario.steps} steps`,
                () => {
                    first = fight(name);
                    expect(formatChecksum(first.end)).toBe(GOLDEN[name]);
                },
                SCENARIO_TIMEOUT,
            );

            if (!RERUN.includes(name)) continue;
            it(
                `${name} reaches the same state halfway and at the end on a rerun`,
                () => {
                    const was = first ?? fight(name);
                    expect(fight(name)).toEqual(was);
                },
                SCENARIO_TIMEOUT,
            );
        }
    });
}
