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
    // ships=3 inFlight=0 p.fired=47 p.hits=230 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=46.8t · 113.6 µs/step
    railDuel: "7dfd8a31",
    // ships=4 inFlight=10 p.fired=145 p.hits=441 b.fired=2 b.hits=243 contacts=252 bumps=0 crashes=0 severed=3 culled=0 scrap=136.1t · 151.7 µs/step
    lanceDuel: "a86a2324",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=40 b.hits=3430 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=28.9t · 187.7 µs/step
    beamDuel: "f06de504",
    // ships=2 inFlight=22 p.fired=42 p.hits=142 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=10.7t · 47.1 µs/step
    binary: "003bc56d",
    // ships=4 inFlight=0 p.fired=160 p.hits=708 b.fired=0 b.hits=0 contacts=363 bumps=2 crashes=0 severed=3 culled=0 scrap=39.4t · 79.3 µs/step
    kernels: "f953f57d",
    // ships=13 inFlight=8 p.fired=189 p.hits=793 b.fired=0 b.hits=0 contacts=494 bumps=0 crashes=0 severed=2 culled=0 scrap=38.1t · 90.7 µs/step
    asteroidField: "0bf35200",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 38.6 µs/step
    mining: "0095f392",
    // ships=16 inFlight=0 p.fired=871 p.hits=2340 b.fired=0 b.hits=0 contacts=1375 bumps=4 crashes=7 severed=3 culled=2 scrap=88.2t · 406.9 µs/step
    rivalMines: "bb3ac504",
    // ships=22 inFlight=81 p.fired=100 p.hits=63 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=3.3t · 342.8 µs/step
    swarm: "a546273e",
    // ships=302 inFlight=186 p.fired=515 p.hits=691 b.fired=0 b.hits=0 contacts=47 bumps=0 crashes=13 severed=8 culled=8 scrap=34.2t · 22727.6 µs/step
    superSwarm: "9feb523c",
    // ships=12 inFlight=0 p.fired=0 p.hits=74 b.fired=7 b.hits=411 contacts=150 bumps=0 crashes=9 severed=1 culled=0 scrap=17.4t · 139.4 µs/step
    torpedoes: "7a976278",
    // ships=6 inFlight=0 p.fired=6 p.hits=69 b.fired=0 b.hits=0 contacts=10 bumps=0 crashes=2 severed=0 culled=0 scrap=26.7t · 131.9 µs/step
    torpedoesGunPlatform: "7edafc8c",
    // ships=2 inFlight=10 p.fired=51 p.hits=182 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=2.7t · 60.4 µs/step
    ordering: "21985a2e",
    // ships=10 inFlight=1 p.fired=100 p.hits=390 b.fired=16 b.hits=1096 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=104.6t · 206.9 µs/step
    standoff: "727d85c5",
    // ships=14 inFlight=0 p.fired=136 p.hits=542 b.fired=34 b.hits=2386 contacts=162 bumps=5 crashes=6 severed=6 culled=0 scrap=106.7t · 198.8 µs/step
    column: "182cd548",
    // ships=3 inFlight=1 p.fired=13 p.hits=74 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=31.4t · 48.7 µs/step
    split: "662d07cc",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74679.6t · 1660.5 µs/step
    crash: "0be427e9",
    // ships=11 inFlight=0 p.fired=0 p.hits=43 b.fired=5 b.hits=2014 contacts=884 bumps=3 crashes=8 severed=6 culled=0 scrap=148.9t · 124.6 µs/step
    torchRun: "981d54f3",
    // ships=4 inFlight=44 p.fired=127 p.hits=408 b.fired=0 b.hits=0 contacts=1 bumps=1 crashes=0 severed=0 culled=0 scrap=25.7t · 116.8 µs/step
    hooked: "35067ea6",
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
    // ships=20 inFlight=0 p.fired=4 p.hits=6 b.fired=328 b.hits=8381 contacts=51 bumps=1 crashes=2 severed=1 culled=0 scrap=10.0t · 456.3 µs/step
    beamCarrier: "1365d9d6",
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
