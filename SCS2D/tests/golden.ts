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
    // ships=3 inFlight=23 p.fired=117 p.hits=392 b.fired=0 b.hits=0 contacts=120 bumps=1 crashes=0 severed=1 culled=0 scrap=31.2t · 288.8 µs/step
    duel: "71bc5a0f",
    // ships=5 inFlight=2 p.fired=46 p.hits=178 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=2 culled=0 scrap=103.4t · 111.3 µs/step
    railDuel: "5decbede",
    // ships=4 inFlight=9 p.fired=146 p.hits=438 b.fired=2 b.hits=241 contacts=121 bumps=1 crashes=0 severed=3 culled=0 scrap=134.9t · 99.3 µs/step
    lanceDuel: "78c2fdba",
    // ships=7 inFlight=0 p.fired=0 p.hits=3 b.fired=40 b.hits=3520 contacts=70 bumps=2 crashes=7 severed=4 culled=0 scrap=46.1t · 137.1 µs/step
    beamDuel: "f894969e",
    // ships=2 inFlight=22 p.fired=42 p.hits=137 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=10.7t · 64.6 µs/step
    binary: "453f6c07",
    // ships=5 inFlight=0 p.fired=131 p.hits=584 b.fired=0 b.hits=0 contacts=4 bumps=1 crashes=0 severed=1 culled=0 scrap=27.8t · 58.2 µs/step
    kernels: "602bcd5e",
    // ships=19 inFlight=0 p.fired=178 p.hits=723 b.fired=0 b.hits=0 contacts=1043 bumps=6 crashes=7 severed=10 culled=0 scrap=47.8t · 76.5 µs/step
    asteroidField: "0b120949",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 38.6 µs/step
    mining: "0095f392",
    // ships=18 inFlight=0 p.fired=743 p.hits=2000 b.fired=0 b.hits=0 contacts=56 bumps=3 crashes=5 severed=1 culled=1 scrap=129.6t · 589.1 µs/step
    rivalMines: "64c77bd0",
    // ships=22 inFlight=29 p.fired=61 p.hits=49 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.6t · 515.2 µs/step
    swarm: "b698fdf7",
    // ships=302 inFlight=70 p.fired=366 p.hits=480 b.fired=0 b.hits=0 contacts=41 bumps=0 crashes=9 severed=4 culled=4 scrap=22.0t · 20421.4 µs/step
    superSwarm: "90ca100b",
    // ships=11 inFlight=0 p.fired=0 p.hits=62 b.fired=7 b.hits=744 contacts=204 bumps=3 crashes=6 severed=3 culled=0 scrap=27.2t · 129.1 µs/step
    torpedoes: "d46e4789",
    // ships=7 inFlight=0 p.fired=5 p.hits=85 b.fired=0 b.hits=0 contacts=114 bumps=0 crashes=5 severed=2 culled=0 scrap=32.9t · 113.5 µs/step
    torpedoesGunPlatform: "a8c9b915",
    // ships=4 inFlight=11 p.fired=102 p.hits=315 b.fired=0 b.hits=0 contacts=6 bumps=1 crashes=0 severed=2 culled=0 scrap=72.0t · 84.2 µs/step
    disarm: "ac4c3d64",
    // ships=3 inFlight=10 p.fired=88 p.hits=260 b.fired=43 b.hits=2279 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=48.3t · 97.3 µs/step
    disarmBeams: "20b06932",
    // ships=4 inFlight=1 p.fired=80 p.hits=312 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=40.2t · 68.0 µs/step
    disarmRails: "00faa5ce",
    // ships=2 inFlight=10 p.fired=51 p.hits=182 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=2.7t · 72.3 µs/step
    ordering: "47bd1f83",
    // ships=10 inFlight=1 p.fired=61 p.hits=214 b.fired=22 b.hits=1816 contacts=5 bumps=0 crashes=1 severed=2 culled=2 scrap=83.5t · 212.3 µs/step
    standoff: "ff51d0df",
    // ships=22 inFlight=0 p.fired=215 p.hits=889 b.fired=15 b.hits=1410 contacts=1616 bumps=15 crashes=9 severed=28 culled=1 scrap=283.8t · 198.5 µs/step
    column: "60c8ad0a",
    // ships=4 inFlight=1 p.fired=16 p.hits=114 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=2 culled=0 scrap=30.1t · 96.0 µs/step
    split: "b12a18c6",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74679.6t · 1660.5 µs/step
    crash: "0be427e9",
    // ships=15 inFlight=0 p.fired=0 p.hits=28 b.fired=7 b.hits=2326 contacts=664 bumps=1 crashes=17 severed=10 culled=0 scrap=306.0t · 214.2 µs/step
    torchRun: "db5cc0b7",
    // ships=4 inFlight=43 p.fired=138 p.hits=418 b.fired=0 b.hits=0 contacts=31 bumps=3 crashes=0 severed=2 culled=0 scrap=26.3t · 104.2 µs/step
    hooked: "c736aff8",
    // ships=2 inFlight=0 p.fired=43 p.hits=294 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.8t · 46.1 µs/step
    broadside: "103918d3",
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
    // ships=20 inFlight=0 p.fired=19 p.hits=65 b.fired=185 b.hits=6844 contacts=72 bumps=2 crashes=3 severed=1 culled=0 scrap=9.7t · 554.5 µs/step
    beamCarrier: "be85d7ff",
    // ships=2 inFlight=0 p.fired=58 p.hits=203 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 32.2 µs/step
    passes: "9e0152cf",
    // ships=2 inFlight=0 p.fired=2 p.hits=20 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 37.6 µs/step
    circling: "fa60265c",
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
