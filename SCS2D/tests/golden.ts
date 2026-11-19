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
    // ships=4 inFlight=21 p.fired=138 p.hits=467 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=44.3t · 298.5 µs/step
    duel: "54ff3479",
    // ships=3 inFlight=2 p.fired=45 p.hits=178 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=41.6t · 131.0 µs/step
    railDuel: "238b85f9",
    // ships=4 inFlight=7 p.fired=144 p.hits=413 b.fired=2 b.hits=243 contacts=248 bumps=0 crashes=0 severed=3 culled=0 scrap=132.1t · 148.5 µs/step
    lanceDuel: "81d0f1c6",
    // ships=7 inFlight=0 p.fired=0 p.hits=193 b.fired=41 b.hits=4233 contacts=131 bumps=1 crashes=3 severed=4 culled=0 scrap=55.3t · 193.9 µs/step
    beamDuel: "7f8dd784",
    // ships=2 inFlight=22 p.fired=42 p.hits=137 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=10.7t · 80.1 µs/step
    binary: "453f6c07",
    // ships=4 inFlight=5 p.fired=193 p.hits=838 b.fired=0 b.hits=0 contacts=240 bumps=2 crashes=0 severed=2 culled=0 scrap=48.9t · 103.7 µs/step
    kernels: "be7f823f",
    // ships=19 inFlight=0 p.fired=178 p.hits=723 b.fired=0 b.hits=0 contacts=1043 bumps=6 crashes=7 severed=10 culled=0 scrap=47.8t · 81.9 µs/step
    asteroidField: "0b120949",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 38.6 µs/step
    mining: "0095f392",
    // ships=15 inFlight=0 p.fired=449 p.hits=1295 b.fired=0 b.hits=0 contacts=1519 bumps=4 crashes=6 severed=2 culled=2 scrap=103.1t · 682.4 µs/step
    rivalMines: "8ce92dff",
    // ships=22 inFlight=29 p.fired=61 p.hits=49 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.6t · 527.3 µs/step
    swarm: "b698fdf7",
    // ships=302 inFlight=80 p.fired=369 p.hits=480 b.fired=0 b.hits=0 contacts=41 bumps=0 crashes=9 severed=4 culled=4 scrap=22.0t · 23853.8 µs/step
    superSwarm: "e9dd346d",
    // ships=8 inFlight=0 p.fired=0 p.hits=70 b.fired=5 b.hits=656 contacts=53 bumps=0 crashes=4 severed=2 culled=0 scrap=30.4t · 95.0 µs/step
    torpedoes: "5bd7a2c6",
    // ships=5 inFlight=0 p.fired=5 p.hits=74 b.fired=0 b.hits=0 contacts=9 bumps=0 crashes=1 severed=0 culled=0 scrap=27.8t · 140.4 µs/step
    torpedoesGunPlatform: "9d0a74c8",
    // ships=5 inFlight=11 p.fired=124 p.hits=445 b.fired=0 b.hits=0 contacts=365 bumps=1 crashes=0 severed=3 culled=0 scrap=31.3t · 112.8 µs/step
    disarm: "bedc6ad6",
    // ships=4 inFlight=0 p.fired=50 p.hits=151 b.fired=37 b.hits=1716 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=51.7t · 101.4 µs/step
    disarmBeams: "0f42fc9f",
    // ships=3 inFlight=0 p.fired=79 p.hits=312 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=33.2t · 74.1 µs/step
    disarmRails: "f7c58420",
    // ships=2 inFlight=10 p.fired=51 p.hits=182 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=2.7t · 63.2 µs/step
    ordering: "47bd1f83",
    // ships=15 inFlight=0 p.fired=128 p.hits=451 b.fired=19 b.hits=1120 contacts=379 bumps=0 crashes=3 severed=8 culled=3 scrap=159.0t · 234.0 µs/step
    standoff: "dddaced7",
    // ships=23 inFlight=0 p.fired=222 p.hits=876 b.fired=15 b.hits=1400 contacts=1658 bumps=23 crashes=13 severed=31 culled=1 scrap=326.0t · 221.5 µs/step
    column: "6b0cc081",
    // ships=6 inFlight=1 p.fired=15 p.hits=106 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=4 culled=0 scrap=34.3t · 91.6 µs/step
    split: "b0e9a72f",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74679.6t · 1660.5 µs/step
    crash: "0be427e9",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=2163 contacts=74 bumps=2 crashes=1 severed=2 culled=0 scrap=36.1t · 207.8 µs/step
    torchRun: "edb44525",
    // ships=4 inFlight=53 p.fired=142 p.hits=473 b.fired=0 b.hits=0 contacts=44 bumps=2 crashes=0 severed=1 culled=0 scrap=21.1t · 118.6 µs/step
    hooked: "5301961a",
    // ships=2 inFlight=0 p.fired=43 p.hits=296 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.8t · 64.5 µs/step
    broadside: "66bec2e2",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=1 crashes=0 severed=0 culled=0 scrap=5.1t · 36.1 µs/step
    salvageRun: "4d767312",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 22.0 µs/step
    refitting: "35d04241",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=144.1t · 64.0 µs/step
    catamaranRefits: "95f51e51",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=35 bumps=3 crashes=0 severed=3 culled=0 scrap=108.3t · 65.4 µs/step
    scavenge: "f79ea4da",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 83.6 µs/step
    padRebuild: "e0d9f044",
    // ships=5 inFlight=0 p.fired=23 p.hits=88 b.fired=0 b.hits=0 contacts=38 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 77.7 µs/step
    factory: "c4894673",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 134.4 µs/step
    shipyard: "3a5a0509",
    // ships=5 inFlight=0 p.fired=15 p.hits=60 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.4t · 71.3 µs/step
    rearm: "acc32eb0",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=2 culled=0 scrap=0.1t · 85.5 µs/step
    tanker: "cbe039d9",
    // ships=20 inFlight=0 p.fired=13 p.hits=96 b.fired=174 b.hits=6071 contacts=87 bumps=1 crashes=10 severed=2 culled=1 scrap=11.0t · 604.4 µs/step
    beamCarrier: "41e6e4a3",
    // ships=2 inFlight=0 p.fired=58 p.hits=218 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 29.9 µs/step
    passes: "6b1e1b07",
    // ships=2 inFlight=0 p.fired=2 p.hits=17 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 38.6 µs/step
    circling: "8765d243",
    // ships=4 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.0t · 42.5 µs/step
    orbiting: "a8e4bbbf",
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
