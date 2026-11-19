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
    // ships=3 inFlight=10 p.fired=113 p.hits=339 b.fired=0 b.hits=0 contacts=77 bumps=1 crashes=0 severed=1 culled=0 scrap=46.0t · 229.6 µs/step
    duel: "8a256827",
    // ships=3 inFlight=2 p.fired=45 p.hits=173 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=67.3t · 98.0 µs/step
    railDuel: "c6c3498d",
    // ships=4 inFlight=10 p.fired=145 p.hits=441 b.fired=2 b.hits=243 contacts=252 bumps=0 crashes=0 severed=3 culled=0 scrap=136.1t · 151.7 µs/step
    lanceDuel: "a86a2324",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=40 b.hits=3430 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=28.9t · 114.2 µs/step
    beamDuel: "f06de504",
    // ships=2 inFlight=22 p.fired=42 p.hits=142 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=10.7t · 47.1 µs/step
    binary: "003bc56d",
    // ships=4 inFlight=0 p.fired=160 p.hits=708 b.fired=0 b.hits=0 contacts=363 bumps=2 crashes=0 severed=3 culled=0 scrap=39.4t · 61.2 µs/step
    kernels: "f953f57d",
    // ships=13 inFlight=8 p.fired=189 p.hits=793 b.fired=0 b.hits=0 contacts=494 bumps=0 crashes=0 severed=2 culled=0 scrap=38.1t · 53.5 µs/step
    asteroidField: "0bf35200",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 38.6 µs/step
    mining: "0095f392",
    // ships=20 inFlight=0 p.fired=739 p.hits=1972 b.fired=0 b.hits=0 contacts=88 bumps=3 crashes=6 severed=3 culled=3 scrap=88.6t · 566.6 µs/step
    rivalMines: "397f9fde",
    // ships=22 inFlight=30 p.fired=62 p.hits=49 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.6t · 624.6 µs/step
    swarm: "21dc1589",
    // ships=302 inFlight=81 p.fired=374 p.hits=478 b.fired=0 b.hits=0 contacts=41 bumps=0 crashes=9 severed=4 culled=4 scrap=22.1t · 20947.5 µs/step
    superSwarm: "3a9b88ca",
    // ships=12 inFlight=0 p.fired=0 p.hits=74 b.fired=7 b.hits=411 contacts=150 bumps=0 crashes=9 severed=1 culled=0 scrap=17.4t · 82.9 µs/step
    torpedoes: "7a976278",
    // ships=6 inFlight=0 p.fired=6 p.hits=69 b.fired=0 b.hits=0 contacts=10 bumps=0 crashes=2 severed=0 culled=0 scrap=26.9t · 121.8 µs/step
    torpedoesGunPlatform: "e0cb4188",
    // ships=4 inFlight=9 p.fired=96 p.hits=293 b.fired=0 b.hits=0 contacts=33 bumps=0 crashes=0 severed=1 culled=0 scrap=73.6t · 86.4 µs/step
    disarm: "46eebc61",
    // ships=3 inFlight=0 p.fired=45 p.hits=134 b.fired=37 b.hits=1900 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=54.5t · 127.2 µs/step
    disarmBeams: "06d2267f",
    // ships=5 inFlight=1 p.fired=80 p.hits=310 b.fired=0 b.hits=0 contacts=168 bumps=1 crashes=1 severed=2 culled=0 scrap=114.9t · 66.6 µs/step
    disarmRails: "c323d752",
    // ships=2 inFlight=10 p.fired=51 p.hits=182 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=2.7t · 60.4 µs/step
    ordering: "21985a2e",
    // ships=10 inFlight=0 p.fired=113 p.hits=408 b.fired=18 b.hits=1262 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=76.2t · 200.3 µs/step
    standoff: "d9912559",
    // ships=20 inFlight=0 p.fired=167 p.hits=708 b.fired=20 b.hits=1605 contacts=1861 bumps=20 crashes=13 severed=24 culled=0 scrap=295.2t · 181.7 µs/step
    column: "9dfc2b07",
    // ships=4 inFlight=1 p.fired=16 p.hits=105 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=2 culled=0 scrap=30.0t · 77.1 µs/step
    split: "2d534f2f",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74679.6t · 1660.5 µs/step
    crash: "0be427e9",
    // ships=15 inFlight=0 p.fired=0 p.hits=28 b.fired=7 b.hits=2326 contacts=664 bumps=1 crashes=17 severed=10 culled=0 scrap=306.0t · 214.2 µs/step
    torchRun: "db5cc0b7",
    // ships=4 inFlight=44 p.fired=127 p.hits=409 b.fired=0 b.hits=0 contacts=1 bumps=1 crashes=0 severed=0 culled=0 scrap=25.7t · 104.7 µs/step
    hooked: "608d6390",
    // ships=2 inFlight=0 p.fired=43 p.hits=290 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.8t · 52.6 µs/step
    broadside: "01b441d4",
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
    // ships=20 inFlight=0 p.fired=21 p.hits=68 b.fired=198 b.hits=6795 contacts=66 bumps=1 crashes=3 severed=1 culled=0 scrap=9.6t · 511.3 µs/step
    beamCarrier: "fd133b3c",
    // ships=2 inFlight=0 p.fired=58 p.hits=203 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 30.6 µs/step
    passes: "665b5ff5",
    // ships=2 inFlight=0 p.fired=2 p.hits=17 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 72.4 µs/step
    circling: "f11c5210",
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
