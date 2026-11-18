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
    // ships=3 inFlight=0 p.fired=113 p.hits=346 b.fired=0 b.hits=0 contacts=77 bumps=1 crashes=0 severed=1 culled=0 scrap=44.3t · 214.7 µs/step
    duel: "1e22f77e",
    // ships=4 inFlight=1 p.fired=61 p.hits=231 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=67.4t · 159.8 µs/step
    railDuel: "75e3d220",
    // ships=4 inFlight=10 p.fired=145 p.hits=441 b.fired=2 b.hits=243 contacts=252 bumps=0 crashes=0 severed=3 culled=0 scrap=136.1t · 151.7 µs/step
    lanceDuel: "a86a2324",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=40 b.hits=3435 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=28.9t · 165.2 µs/step
    beamDuel: "fd7a9a88",
    // ships=2 inFlight=22 p.fired=42 p.hits=142 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=10.7t · 47.1 µs/step
    binary: "003bc56d",
    // ships=4 inFlight=0 p.fired=160 p.hits=709 b.fired=0 b.hits=0 contacts=363 bumps=2 crashes=0 severed=3 culled=0 scrap=39.4t · 79.2 µs/step
    kernels: "aad6e692",
    // ships=13 inFlight=13 p.fired=193 p.hits=778 b.fired=0 b.hits=0 contacts=809 bumps=0 crashes=0 severed=2 culled=0 scrap=39.0t · 79.8 µs/step
    asteroidField: "0a6d95b0",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 38.6 µs/step
    mining: "0095f392",
    // ships=16 inFlight=0 p.fired=871 p.hits=2340 b.fired=0 b.hits=0 contacts=1375 bumps=4 crashes=7 severed=3 culled=2 scrap=88.2t · 406.9 µs/step
    rivalMines: "bb3ac504",
    // ships=23 inFlight=17 p.fired=118 p.hits=115 b.fired=0 b.hits=0 contacts=19 bumps=1 crashes=0 severed=1 culled=0 scrap=1.8t · 531.2 µs/step
    swarm: "71107557",
    // ships=302 inFlight=201 p.fired=1062 p.hits=1347 b.fired=0 b.hits=0 contacts=40 bumps=0 crashes=9 severed=6 culled=6 scrap=41.1t · 22291.1 µs/step
    superSwarm: "b11c6d2a",
    // ships=6 inFlight=0 p.fired=0 p.hits=114 b.fired=5 b.hits=617 contacts=183 bumps=2 crashes=5 severed=3 culled=0 scrap=40.0t · 59.6 µs/step
    torpedoes: "d4f39e2b",
    // ships=6 inFlight=0 p.fired=2 p.hits=99 b.fired=0 b.hits=0 contacts=124 bumps=1 crashes=7 severed=3 culled=0 scrap=42.4t · 282.1 µs/step
    torpedoesGunPlatform: "52a77a13",
    // ships=4 inFlight=22 p.fired=107 p.hits=294 b.fired=0 b.hits=0 contacts=33 bumps=0 crashes=0 severed=1 culled=0 scrap=70.3t · 91.2 µs/step
    disarm: "8f2ae15d",
    // ships=3 inFlight=0 p.fired=45 p.hits=134 b.fired=37 b.hits=1900 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=54.5t · 127.2 µs/step
    disarmBeams: "06d2267f",
    // ships=3 inFlight=0 p.fired=54 p.hits=216 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=24.9t · 60.7 µs/step
    disarmRails: "b820c998",
    // ships=2 inFlight=10 p.fired=51 p.hits=182 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=2.7t · 60.4 µs/step
    ordering: "21985a2e",
    // ships=11 inFlight=0 p.fired=90 p.hits=356 b.fired=15 b.hits=1013 contacts=1 bumps=0 crashes=1 severed=2 culled=1 scrap=98.0t · 173.9 µs/step
    standoff: "df22a6f9",
    // ships=25 inFlight=0 p.fired=136 p.hits=599 b.fired=37 b.hits=2202 contacts=879 bumps=12 crashes=29 severed=21 culled=0 scrap=126.0t · 225.6 µs/step
    column: "c5df9653",
    // ships=3 inFlight=1 p.fired=12 p.hits=80 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=31.8t · 73.1 µs/step
    split: "85178e25",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74679.6t · 1660.5 µs/step
    crash: "0be427e9",
    // ships=11 inFlight=0 p.fired=0 p.hits=44 b.fired=5 b.hits=2014 contacts=141 bumps=1 crashes=7 severed=7 culled=0 scrap=190.5t · 178.2 µs/step
    torchRun: "4985189b",
    // ships=4 inFlight=44 p.fired=127 p.hits=399 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=1 culled=0 scrap=24.4t · 100.0 µs/step
    hooked: "8f682a28",
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
    // ships=5 inFlight=0 p.fired=16 p.hits=60 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.4t · 64.4 µs/step
    rearm: "1d8e6c58",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=2 culled=0 scrap=0.1t · 85.5 µs/step
    tanker: "cbe039d9",
    // ships=20 inFlight=0 p.fired=4 p.hits=13 b.fired=333 b.hits=8597 contacts=51 bumps=1 crashes=2 severed=1 culled=0 scrap=9.6t · 590.1 µs/step
    beamCarrier: "658868ed",
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
