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
    // ships=12 inFlight=12 p.fired=105 p.hits=199 b.fired=0 b.hits=0 contacts=374 bumps=1 crashes=19 severed=9 culled=0 scrap=96.0t · 255.6 µs/step
    duel: "0fd86bea",
    // ships=3 inFlight=2 p.fired=45 p.hits=123 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=25.6t · 135.5 µs/step
    railDuel: "1015f6a4",
    // ships=3 inFlight=11 p.fired=145 p.hits=212 b.fired=2 b.hits=241 contacts=241 bumps=0 crashes=0 severed=2 culled=0 scrap=126.6t · 160.7 µs/step
    lanceDuel: "3c1924d3",
    // ships=7 inFlight=0 p.fired=0 p.hits=54 b.fired=41 b.hits=3957 contacts=2 bumps=1 crashes=1 severed=4 culled=0 scrap=59.3t · 126.9 µs/step
    beamDuel: "930d4445",
    // ships=2 inFlight=21 p.fired=41 p.hits=78 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.8t · 65.2 µs/step
    binary: "b7a6ee77",
    // ships=4 inFlight=0 p.fired=155 p.hits=452 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=24.4t · 58.6 µs/step
    kernels: "a9758c2f",
    // ships=12 inFlight=0 p.fired=164 p.hits=274 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=80.2t · 62.2 µs/step
    asteroidField: "940cce37",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 38.6 µs/step
    mining: "0095f392",
    // ships=16 inFlight=0 p.fired=580 p.hits=1286 b.fired=0 b.hits=0 contacts=824 bumps=4 crashes=7 severed=1 culled=0 scrap=100.5t · 668.8 µs/step
    rivalMines: "4a27a9a7",
    // ships=22 inFlight=25 p.fired=82 p.hits=40 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.7t · 536.9 µs/step
    swarm: "d52dc082",
    // ships=302 inFlight=109 p.fired=507 p.hits=541 b.fired=0 b.hits=0 contacts=51 bumps=0 crashes=7 severed=3 culled=2 scrap=17.2t · 20385.9 µs/step
    superSwarm: "0b090022",
    // ships=9 inFlight=0 p.fired=0 p.hits=62 b.fired=5 b.hits=908 contacts=153 bumps=1 crashes=2 severed=2 culled=0 scrap=64.4t · 80.5 µs/step
    torpedoes: "1d009dd6",
    // ships=2 inFlight=0 p.fired=2 p.hits=89 b.fired=0 b.hits=0 contacts=12 bumps=0 crashes=2 severed=0 culled=0 scrap=72.8t · 83.7 µs/step
    torpedoesGunPlatform: "32583615",
    // ships=10 inFlight=0 p.fired=0 p.hits=80 b.fired=3 b.hits=31 contacts=4 bumps=0 crashes=1 severed=0 culled=0 scrap=19.9t · 98.2 µs/step
    torpedoesWarhead: "dd9de815",
    // ships=10 inFlight=0 p.fired=0 p.hits=30 b.fired=7 b.hits=76 contacts=48 bumps=0 crashes=1 severed=1 culled=0 scrap=16.4t · 110.5 µs/step
    torpedoesShaped: "1008ff31",
    // ships=7 inFlight=0 p.fired=19 p.hits=62 b.fired=0 b.hits=0 contacts=38 bumps=0 crashes=2 severed=0 culled=0 scrap=14.6t · 139.9 µs/step
    torpedoBoatTorpedoes: "fa8ae14e",
    // ships=5 inFlight=12 p.fired=132 p.hits=240 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=31.5t · 93.6 µs/step
    disarm: "88104786",
    // ships=3 inFlight=0 p.fired=63 p.hits=48 b.fired=38 b.hits=1977 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=37.7t · 101.1 µs/step
    disarmBeams: "286da47f",
    // ships=3 inFlight=0 p.fired=78 p.hits=161 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=30.7t · 83.1 µs/step
    disarmRails: "50812f1e",
    // ships=2 inFlight=32 p.fired=57 p.hits=119 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.1t · 80.1 µs/step
    ordering: "589a4848",
    // ships=10 inFlight=0 p.fired=237 p.hits=483 b.fired=18 b.hits=1178 contacts=0 bumps=0 crashes=0 severed=2 culled=1 scrap=153.2t · 249.7 µs/step
    standoff: "5b9af0e0",
    // ships=18 inFlight=22 p.fired=249 p.hits=524 b.fired=20 b.hits=1606 contacts=1727 bumps=15 crashes=10 severed=23 culled=0 scrap=229.0t · 268.0 µs/step
    column: "032e5631",
    // ships=3 inFlight=0 p.fired=10 p.hits=34 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=34.1t · 104.6 µs/step
    split: "d619a057",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74329.7t · 1745.1 µs/step
    crash: "195a4442",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=2163 contacts=74 bumps=2 crashes=1 severed=2 culled=0 scrap=36.1t · 189.8 µs/step
    torchRun: "8e228649",
    // ships=4 inFlight=59 p.fired=132 p.hits=393 b.fired=0 b.hits=0 contacts=1 bumps=1 crashes=0 severed=0 culled=0 scrap=22.8t · 131.7 µs/step
    hooked: "89d3e357",
    // ships=2 inFlight=0 p.fired=45 p.hits=213 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=6.6t · 49.3 µs/step
    broadside: "f9af487b",
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
    // ships=5 inFlight=0 p.fired=83 p.hits=78 b.fired=0 b.hits=0 contacts=38 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 63.9 µs/step
    factory: "4dc6203d",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 134.4 µs/step
    shipyard: "3a5a0509",
    // ships=5 inFlight=4 p.fired=36 p.hits=40 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 81.1 µs/step
    rearm: "68d367c7",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=2 culled=0 scrap=0.1t · 85.5 µs/step
    tanker: "cbe039d9",
    // ships=20 inFlight=0 p.fired=14 p.hits=43 b.fired=151 b.hits=5950 contacts=93 bumps=1 crashes=6 severed=1 culled=0 scrap=9.8t · 590.6 µs/step
    beamCarrier: "43c9b1b9",
    // ships=2 inFlight=0 p.fired=58 p.hits=79 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 29.6 µs/step
    passes: "f2cbc599",
    // ships=2 inFlight=0 p.fired=2 p.hits=2 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 42.6 µs/step
    circling: "b2da67ec",
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
