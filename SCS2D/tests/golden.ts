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
    // ships=7 inFlight=13 p.fired=143 p.hits=268 b.fired=0 b.hits=0 contacts=663 bumps=1 crashes=0 severed=4 culled=0 scrap=67.0t · 263.1 µs/step
    duel: "0d19687e",
    // ships=3 inFlight=2 p.fired=45 p.hits=87 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=69.4t · 103.2 µs/step
    railDuel: "eb6ee925",
    // ships=3 inFlight=11 p.fired=145 p.hits=210 b.fired=2 b.hits=242 contacts=242 bumps=0 crashes=0 severed=2 culled=0 scrap=128.2t · 136.5 µs/step
    lanceDuel: "ec3222f6",
    // ships=7 inFlight=0 p.fired=0 p.hits=6 b.fired=42 b.hits=3889 contacts=5 bumps=0 crashes=1 severed=4 culled=0 scrap=60.9t · 183.1 µs/step
    beamDuel: "d18deb2a",
    // ships=2 inFlight=34 p.fired=52 p.hits=86 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=11.6t · 66.1 µs/step
    binary: "592f7d6b",
    // ships=4 inFlight=22 p.fired=246 p.hits=642 b.fired=0 b.hits=0 contacts=70 bumps=0 crashes=0 severed=1 culled=0 scrap=52.9t · 78.6 µs/step
    kernels: "cbee1af9",
    // ships=12 inFlight=8 p.fired=191 p.hits=366 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=44.9t · 70.8 µs/step
    asteroidField: "cc3e5333",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 38.6 µs/step
    mining: "0095f392",
    // ships=15 inFlight=0 p.fired=394 p.hits=874 b.fired=0 b.hits=0 contacts=974 bumps=11 crashes=6 severed=1 culled=0 scrap=88.3t · 573.4 µs/step
    rivalMines: "abb76e5e",
    // ships=22 inFlight=17 p.fired=57 p.hits=36 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.5t · 516.1 µs/step
    swarm: "57bb8d13",
    // ships=302 inFlight=77 p.fired=373 p.hits=504 b.fired=0 b.hits=0 contacts=67 bumps=0 crashes=7 severed=3 culled=3 scrap=18.8t · 15099.4 µs/step
    superSwarm: "66dbbc94",
    // ships=7 inFlight=0 p.fired=0 p.hits=61 b.fired=7 b.hits=1009 contacts=55 bumps=0 crashes=3 severed=1 culled=0 scrap=25.3t · 83.9 µs/step
    torpedoes: "2720730a",
    // ships=3 inFlight=0 p.fired=2 p.hits=84 b.fired=0 b.hits=0 contacts=22 bumps=1 crashes=0 severed=1 culled=0 scrap=65.5t · 82.7 µs/step
    torpedoesGunPlatform: "9d8b6ba3",
    // ships=10 inFlight=0 p.fired=0 p.hits=90 b.fired=4 b.hits=43 contacts=4 bumps=0 crashes=2 severed=0 culled=0 scrap=19.1t · 115.0 µs/step
    torpedoesWarhead: "edba0488",
    // ships=11 inFlight=0 p.fired=0 p.hits=28 b.fired=7 b.hits=77 contacts=51 bumps=0 crashes=1 severed=1 culled=0 scrap=15.5t · 108.4 µs/step
    torpedoesShaped: "6292b574",
    // ships=7 inFlight=0 p.fired=18 p.hits=62 b.fired=0 b.hits=0 contacts=36 bumps=0 crashes=1 severed=0 culled=0 scrap=12.5t · 144.1 µs/step
    torpedoBoatTorpedoes: "f38f18e1",
    // ships=5 inFlight=12 p.fired=150 p.hits=274 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=37.8t · 97.5 µs/step
    disarm: "6ea74795",
    // ships=3 inFlight=0 p.fired=46 p.hits=41 b.fired=37 b.hits=1937 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=48.0t · 87.8 µs/step
    disarmBeams: "98f22ceb",
    // ships=3 inFlight=0 p.fired=96 p.hits=159 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=27.7t · 63.3 µs/step
    disarmRails: "9596cc18",
    // ships=2 inFlight=32 p.fired=57 p.hits=104 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.0t · 53.7 µs/step
    ordering: "8dd1cf78",
    // ships=10 inFlight=0 p.fired=86 p.hits=174 b.fired=28 b.hits=1769 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=79.5t · 204.2 µs/step
    standoff: "836ca2ac",
    // ships=18 inFlight=1 p.fired=282 p.hits=609 b.fired=18 b.hits=1607 contacts=2057 bumps=22 crashes=20 severed=26 culled=0 scrap=298.9t · 196.0 µs/step
    column: "8c88398a",
    // ships=3 inFlight=1 p.fired=11 p.hits=30 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=31.9t · 77.8 µs/step
    split: "4a58f7bc",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74329.7t · 1745.1 µs/step
    crash: "195a4442",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=2163 contacts=74 bumps=2 crashes=1 severed=2 culled=0 scrap=36.1t · 189.8 µs/step
    torchRun: "8e228649",
    // ships=4 inFlight=69 p.fired=130 p.hits=425 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=1 culled=0 scrap=26.4t · 123.1 µs/step
    hooked: "19a882f6",
    // ships=2 inFlight=0 p.fired=45 p.hits=200 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=6.8t · 53.4 µs/step
    broadside: "5a99bac8",
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
    // ships=5 inFlight=0 p.fired=83 p.hits=78 b.fired=0 b.hits=0 contacts=38 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 57.4 µs/step
    factory: "81215bbe",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 134.4 µs/step
    shipyard: "3a5a0509",
    // ships=5 inFlight=4 p.fired=36 p.hits=40 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 81.0 µs/step
    rearm: "dcf337c0",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=2 culled=0 scrap=0.1t · 85.5 µs/step
    tanker: "cbe039d9",
    // ships=20 inFlight=0 p.fired=33 p.hits=97 b.fired=161 b.hits=5812 contacts=70 bumps=1 crashes=5 severed=1 culled=0 scrap=9.1t · 585.4 µs/step
    beamCarrier: "0ae7c121",
    // ships=2 inFlight=0 p.fired=58 p.hits=129 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 31.9 µs/step
    passes: "49eb5a68",
    // ships=2 inFlight=0 p.fired=2 p.hits=2 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 43.6 µs/step
    circling: "6af81a24",
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
