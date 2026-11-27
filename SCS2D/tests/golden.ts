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
    // ships=3 inFlight=16 p.fired=74 p.hits=144 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=34.9t · 219.3 µs/step
    duel: "2f7bd812",
    // ships=3 inFlight=1 p.fired=46 p.hits=97 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=35.8t · 81.1 µs/step
    railDuel: "543ed4ee",
    // ships=2 inFlight=1 p.fired=21 p.hits=71 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=42.9t · 75.6 µs/step
    armourCorvettes: "87404c5d",
    // ships=2 inFlight=0 p.fired=12 p.hits=13 b.fired=24 b.hits=1091 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=13.8t · 75.9 µs/step
    armourBeamCorvettes: "8d2e2643",
    // ships=2 inFlight=0 p.fired=1 p.hits=1 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=39.9t · 17.0 µs/step
    armourRailCorvettes: "bb50ef18",
    // ships=2 inFlight=0 p.fired=12 p.hits=10 b.fired=3 b.hits=284 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=47.1t · 51.4 µs/step
    armourLanceCorvettes: "790e34c7",
    // ships=3 inFlight=10 p.fired=143 p.hits=225 b.fired=2 b.hits=205 contacts=121 bumps=1 crashes=0 severed=2 culled=0 scrap=128.5t · 146.1 µs/step
    lanceDuel: "d48746fd",
    // ships=4 inFlight=0 p.fired=0 p.hits=0 b.fired=43 b.hits=3797 contacts=131 bumps=0 crashes=1 severed=1 culled=0 scrap=38.2t · 168.1 µs/step
    beamDuel: "725ba1ab",
    // ships=2 inFlight=32 p.fired=49 p.hits=97 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=11.0t · 73.7 µs/step
    binary: "0af3d4bb",
    // ships=8 inFlight=0 p.fired=121 p.hits=298 b.fired=0 b.hits=0 contacts=205 bumps=2 crashes=16 severed=9 culled=0 scrap=46.5t · 65.8 µs/step
    kernels: "af09d85a",
    // ships=12 inFlight=0 p.fired=62 p.hits=116 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=25.9t · 50.6 µs/step
    asteroidField: "33e16242",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.2t · 34.5 µs/step
    mining: "4d523235",
    // ships=12 inFlight=0 p.fired=470 p.hits=943 b.fired=0 b.hits=0 contacts=620 bumps=2 crashes=3 severed=0 culled=0 scrap=72.7t · 550.9 µs/step
    rivalMines: "5fd99a98",
    // ships=22 inFlight=47 p.fired=100 p.hits=117 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.4t · 578.5 µs/step
    swarm: "c89ca3aa",
    // ships=302 inFlight=230 p.fired=671 p.hits=1009 b.fired=0 b.hits=0 contacts=23 bumps=1 crashes=9 severed=5 culled=5 scrap=27.2t · 20432.2 µs/step
    superSwarm: "107b668a",
    // ships=10 inFlight=0 p.fired=0 p.hits=640 b.fired=8 b.hits=1118 contacts=6 bumps=0 crashes=2 severed=0 culled=0 scrap=10.8t · 100.8 µs/step
    torpedoes: "6f3aebaf",
    // ships=10 inFlight=0 p.fired=0 p.hits=245 b.fired=8 b.hits=70 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=17.6t · 134.2 µs/step
    torpedoesWarhead: "01404cde",
    // ships=12 inFlight=0 p.fired=0 p.hits=294 b.fired=8 b.hits=210 contacts=5 bumps=0 crashes=2 severed=0 culled=0 scrap=11.9t · 103.7 µs/step
    torpedoesShaped: "7f1304cb",
    // ships=8 inFlight=0 p.fired=4 p.hits=94 b.fired=0 b.hits=0 contacts=11 bumps=0 crashes=4 severed=0 culled=0 scrap=14.9t · 100.8 µs/step
    torpedoesGunPlatform: "9fb49b98",
    // ships=5 inFlight=0 p.fired=2 p.hits=412 b.fired=0 b.hits=0 contacts=111 bumps=0 crashes=1 severed=1 culled=0 scrap=56.7t · 139.5 µs/step
    torpedoesWarheadGunPlatform: "95cb2f04",
    // ships=12 inFlight=0 p.fired=2 p.hits=66 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=0 culled=0 scrap=8.5t · 200.6 µs/step
    torpedoesShapedGunPlatform: "62f303c9",
    // ships=6 inFlight=0 p.fired=17 p.hits=118 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=0 culled=0 scrap=12.8t · 214.3 µs/step
    torpedoBoatTorpedoes: "67a2ee66",
    // ships=4 inFlight=32 p.fired=127 p.hits=224 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=63.7t · 95.1 µs/step
    disarm: "cde3b538",
    // ships=3 inFlight=0 p.fired=38 p.hits=67 b.fired=40 b.hits=2266 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=69.4t · 93.9 µs/step
    disarmBeams: "e26b13d7",
    // ships=3 inFlight=0 p.fired=53 p.hits=126 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=17.0t · 65.5 µs/step
    disarmRails: "3ff21c43",
    // ships=3 inFlight=36 p.fired=175 p.hits=383 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=17.5t · 72.6 µs/step
    ordering: "5afd719f",
    // ships=10 inFlight=0 p.fired=102 p.hits=208 b.fired=23 b.hits=1225 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=84.7t · 227.1 µs/step
    standoff: "3e8983a2",
    // ships=26 inFlight=7 p.fired=116 p.hits=228 b.fired=29 b.hits=2621 contacts=611 bumps=10 crashes=9 severed=22 culled=0 scrap=210.2t · 187.9 µs/step
    column: "5617fa6d",
    // ships=3 inFlight=1 p.fired=12 p.hits=52 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=21.6t · 83.3 µs/step
    split: "d650fe2f",
    // ships=20 inFlight=2 p.fired=0 p.hits=10 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74345.9t · 2049.1 µs/step
    crash: "63f34837",
    // ships=11 inFlight=0 p.fired=0 p.hits=8 b.fired=14 b.hits=2809 contacts=459 bumps=5 crashes=9 severed=8 culled=0 scrap=120.7t · 226.0 µs/step
    torchRun: "8dfa1f3c",
    // ships=5 inFlight=48 p.fired=196 p.hits=735 b.fired=0 b.hits=0 contacts=2 bumps=1 crashes=0 severed=1 culled=0 scrap=72.5t · 128.4 µs/step
    hooked: "a30af97d",
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
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=41 bumps=2 crashes=1 severed=3 culled=0 scrap=108.3t · 36.1 µs/step
    scavenge: "7af075ae",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.0t · 31.2 µs/step
    padRebuild: "5b96e51e",
    // ships=5 inFlight=0 p.fired=75 p.hits=73 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 65.8 µs/step
    factory: "47103a97",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 11.4 µs/step
    shipyard: "4cf72d8d",
    // ships=5 inFlight=1 p.fired=25 p.hits=25 b.fired=0 b.hits=0 contacts=74 bumps=0 crashes=2 severed=0 culled=0 scrap=0.2t · 83.7 µs/step
    rearm: "562fe9c0",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=9 bumps=2 crashes=0 severed=2 culled=0 scrap=0.3t · 47.2 µs/step
    tanker: "258c3353",
    // ships=20 inFlight=0 p.fired=9 p.hits=27 b.fired=267 b.hits=8826 contacts=127 bumps=2 crashes=5 severed=1 culled=0 scrap=10.4t · 479.5 µs/step
    beamCarrier: "57d57932",
    // ships=2 inFlight=1 p.fired=55 p.hits=107 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.4t · 28.1 µs/step
    passes: "166a96d9",
    // ships=2 inFlight=0 p.fired=2 p.hits=6 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.4t · 41.8 µs/step
    circling: "0c9be5a6",
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
