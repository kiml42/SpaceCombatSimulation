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
    // ships=3 inFlight=0 p.fired=86 p.hits=210 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=53.8t · 233.9 µs/step
    duel: "52e54e0d",
    // ships=3 inFlight=1 p.fired=46 p.hits=97 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=36.1t · 103.1 µs/step
    railDuel: "20e2e2f1",
    // ships=2 inFlight=0 p.fired=21 p.hits=58 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=42.1t · 58.4 µs/step
    armourCorvettes: "b76d2a53",
    // ships=2 inFlight=0 p.fired=12 p.hits=13 b.fired=24 b.hits=1081 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=13.8t · 79.0 µs/step
    armourBeamCorvettes: "41789c34",
    // ships=2 inFlight=0 p.fired=1 p.hits=1 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=39.9t · 16.9 µs/step
    armourRailCorvettes: "e26d8210",
    // ships=2 inFlight=0 p.fired=12 p.hits=10 b.fired=3 b.hits=284 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=46.8t · 56.7 µs/step
    armourLanceCorvettes: "203a92bf",
    // ships=3 inFlight=13 p.fired=144 p.hits=223 b.fired=2 b.hits=225 contacts=121 bumps=1 crashes=0 severed=2 culled=0 scrap=141.5t · 134.5 µs/step
    lanceDuel: "e248fa14",
    // ships=7 inFlight=0 p.fired=0 p.hits=5 b.fired=42 b.hits=2926 contacts=82 bumps=1 crashes=4 severed=4 culled=0 scrap=40.9t · 168.5 µs/step
    beamDuel: "558a31c3",
    // ships=2 inFlight=23 p.fired=49 p.hits=76 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=7.1t · 66.4 µs/step
    binary: "19f64cf8",
    // ships=6 inFlight=0 p.fired=118 p.hits=298 b.fired=0 b.hits=0 contacts=139 bumps=0 crashes=14 severed=7 culled=0 scrap=25.8t · 63.4 µs/step
    kernels: "60453425",
    // ships=12 inFlight=0 p.fired=63 p.hits=101 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=24.3t · 48.4 µs/step
    asteroidField: "7012b78d",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.2t · 34.5 µs/step
    mining: "4d523235",
    // ships=15 inFlight=0 p.fired=1247 p.hits=2543 b.fired=0 b.hits=0 contacts=123 bumps=4 crashes=3 severed=1 culled=1 scrap=-23.6t · 621.5 µs/step
    rivalMines: "6666160a",
    // ships=22 inFlight=17 p.fired=100 p.hits=81 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.2t · 548.7 µs/step
    swarm: "bc6ab599",
    // ships=304 inFlight=187 p.fired=1000 p.hits=1141 b.fired=0 b.hits=0 contacts=126 bumps=3 crashes=4 severed=6 culled=4 scrap=26.0t · 21103.2 µs/step
    superSwarm: "c4427205",
    // ships=8 inFlight=0 p.fired=0 p.hits=71 b.fired=6 b.hits=943 contacts=134 bumps=1 crashes=6 severed=2 culled=0 scrap=24.8t · 113.1 µs/step
    torpedoes: "f710d794",
    // ships=11 inFlight=0 p.fired=0 p.hits=252 b.fired=6 b.hits=73 contacts=6 bumps=0 crashes=3 severed=1 culled=0 scrap=18.3t · 154.1 µs/step
    torpedoesWarhead: "8cb4ea86",
    // ships=11 inFlight=0 p.fired=0 p.hits=650 b.fired=6 b.hits=160 contacts=14 bumps=0 crashes=1 severed=1 culled=0 scrap=15.4t · 130.0 µs/step
    torpedoesShaped: "13dea3e7",
    // ships=2 inFlight=0 p.fired=3 p.hits=90 b.fired=0 b.hits=0 contacts=11 bumps=0 crashes=1 severed=0 culled=0 scrap=67.7t · 90.0 µs/step
    torpedoesGunPlatform: "c4360658",
    // ships=8 inFlight=0 p.fired=2 p.hits=382 b.fired=0 b.hits=0 contacts=6 bumps=0 crashes=0 severed=1 culled=0 scrap=49.8t · 120.8 µs/step
    torpedoesWarheadGunPlatform: "85005162",
    // ships=7 inFlight=0 p.fired=2 p.hits=156 b.fired=0 b.hits=0 contacts=6 bumps=0 crashes=0 severed=0 culled=0 scrap=41.8t · 112.5 µs/step
    torpedoesShapedGunPlatform: "c4216836",
    // ships=6 inFlight=0 p.fired=19 p.hits=176 b.fired=0 b.hits=0 contacts=2 bumps=0 crashes=0 severed=0 culled=0 scrap=20.9t · 171.8 µs/step
    torpedoBoatTorpedoes: "8ba7809b",
    // ships=4 inFlight=12 p.fired=113 p.hits=204 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=20.5t · 90.6 µs/step
    disarm: "4573d34e",
    // ships=3 inFlight=0 p.fired=51 p.hits=62 b.fired=35 b.hits=1908 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=40.3t · 110.3 µs/step
    disarmBeams: "26c3b2c3",
    // ships=3 inFlight=0 p.fired=52 p.hits=128 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=42.0t · 66.4 µs/step
    disarmRails: "e23fa42c",
    // ships=2 inFlight=0 p.fired=150 p.hits=346 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=17.4t · 65.2 µs/step
    ordering: "1de31bcf",
    // ships=10 inFlight=1 p.fired=101 p.hits=236 b.fired=19 b.hits=1312 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=84.8t · 242.5 µs/step
    standoff: "df626688",
    // ships=17 inFlight=0 p.fired=176 p.hits=256 b.fired=28 b.hits=2069 contacts=987 bumps=9 crashes=15 severed=13 culled=1 scrap=144.2t · 230.3 µs/step
    column: "321309ef",
    // ships=3 inFlight=1 p.fired=12 p.hits=52 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=21.6t · 83.3 µs/step
    split: "d650fe2f",
    // ships=20 inFlight=2 p.fired=0 p.hits=10 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74345.9t · 2049.1 µs/step
    crash: "63f34837",
    // ships=11 inFlight=0 p.fired=0 p.hits=15 b.fired=8 b.hits=2224 contacts=750 bumps=4 crashes=15 severed=9 culled=0 scrap=133.4t · 299.4 µs/step
    torchRun: "3b4de0cd",
    // ships=4 inFlight=55 p.fired=157 p.hits=550 b.fired=0 b.hits=0 contacts=21 bumps=2 crashes=0 severed=1 culled=0 scrap=43.6t · 163.8 µs/step
    hooked: "5768f1e9",
    // ships=2 inFlight=0 p.fired=24 p.hits=116 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=15.6t · 46.8 µs/step
    broadside: "ba4c4fb0",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=1 crashes=0 severed=0 culled=0 scrap=5.1t · 21.2 µs/step
    salvageRun: "391c62d6",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.4t · 7.9 µs/step
    refitting: "ad4647fd",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=144.1t · 29.6 µs/step
    catamaranRefits: "d012c79a",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=28 bumps=3 crashes=0 severed=3 culled=0 scrap=108.3t · 43.5 µs/step
    scavenge: "5feaf258",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.0t · 34.4 µs/step
    padRebuild: "ade4427a",
    // ships=5 inFlight=0 p.fired=75 p.hits=66 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 86.5 µs/step
    factory: "236dda11",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 12.8 µs/step
    shipyard: "b5d153a6",
    // ships=5 inFlight=4 p.fired=39 p.hits=36 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 109.4 µs/step
    rearm: "44983515",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=9 bumps=2 crashes=0 severed=2 culled=0 scrap=0.3t · 47.2 µs/step
    tanker: "258c3353",
    // ships=20 inFlight=0 p.fired=30 p.hits=111 b.fired=287 b.hits=7840 contacts=142 bumps=2 crashes=9 severed=3 culled=2 scrap=11.7t · 579.3 µs/step
    beamCarrier: "6f9d2a7f",
    // ships=2 inFlight=1 p.fired=56 p.hits=93 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.4t · 29.5 µs/step
    passes: "3f90718c",
    // ships=2 inFlight=5 p.fired=70 p.hits=90 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.4t · 28.2 µs/step
    circling: "57f2b3b4",
    // ships=4 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.0t · 37.1 µs/step
    orbiting: "af1d16d8",
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
