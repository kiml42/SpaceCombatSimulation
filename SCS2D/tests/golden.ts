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
    // ships=3 inFlight=13 p.fired=109 p.hits=314 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=0 culled=0 scrap=71.7t · 214.2 µs/step
    duel: "b056a81a",
    // ships=3 inFlight=1 p.fired=44 p.hits=172 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=39.1t · 96.5 µs/step
    railDuel: "99f76740",
    // ships=4 inFlight=8 p.fired=145 p.hits=446 b.fired=2 b.hits=240 contacts=121 bumps=1 crashes=0 severed=3 culled=0 scrap=134.2t · 152.2 µs/step
    lanceDuel: "ff282eaf",
    // ships=7 inFlight=0 p.fired=0 p.hits=54 b.fired=41 b.hits=3957 contacts=2 bumps=1 crashes=1 severed=4 culled=0 scrap=59.3t · 126.9 µs/step
    beamDuel: "930d4445",
    // ships=2 inFlight=18 p.fired=41 p.hits=130 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.9t · 61.9 µs/step
    binary: "9c504683",
    // ships=4 inFlight=0 p.fired=175 p.hits=744 b.fired=0 b.hits=0 contacts=368 bumps=3 crashes=0 severed=3 culled=0 scrap=33.7t · 59.4 µs/step
    kernels: "b0d12a36",
    // ships=13 inFlight=0 p.fired=109 p.hits=397 b.fired=0 b.hits=0 contacts=817 bumps=3 crashes=0 severed=2 culled=0 scrap=65.4t · 58.7 µs/step
    asteroidField: "c5fdd2b2",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 38.6 µs/step
    mining: "0095f392",
    // ships=12 inFlight=0 p.fired=585 p.hits=1359 b.fired=0 b.hits=0 contacts=797 bumps=5 crashes=8 severed=0 culled=0 scrap=99.7t · 512.7 µs/step
    rivalMines: "b5888e7d",
    // ships=22 inFlight=36 p.fired=110 p.hits=115 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.3t · 482.8 µs/step
    swarm: "1d6ce8c1",
    // ships=302 inFlight=184 p.fired=556 p.hits=651 b.fired=0 b.hits=0 contacts=51 bumps=0 crashes=7 severed=3 culled=2 scrap=20.3t · 20833.7 µs/step
    superSwarm: "bb6c348d",
    // ships=9 inFlight=0 p.fired=0 p.hits=62 b.fired=5 b.hits=908 contacts=153 bumps=1 crashes=2 severed=2 culled=0 scrap=64.4t · 80.5 µs/step
    torpedoes: "1d009dd6",
    // ships=6 inFlight=0 p.fired=3 p.hits=92 b.fired=0 b.hits=0 contacts=28 bumps=0 crashes=6 severed=1 culled=0 scrap=55.9t · 74.7 µs/step
    torpedoesGunPlatform: "a66ef64f",
    // ships=6 inFlight=13 p.fired=146 p.hits=476 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=2 culled=0 scrap=44.6t · 96.0 µs/step
    disarm: "af93d935",
    // ships=3 inFlight=0 p.fired=44 p.hits=110 b.fired=37 b.hits=1775 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=53.5t · 111.9 µs/step
    disarmBeams: "d23eb146",
    // ships=3 inFlight=0 p.fired=79 p.hits=316 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=26.7t · 69.7 µs/step
    disarmRails: "d82830a8",
    // ships=2 inFlight=10 p.fired=51 p.hits=183 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=2.7t · 65.3 µs/step
    ordering: "44769462",
    // ships=10 inFlight=22 p.fired=282 p.hits=989 b.fired=22 b.hits=1531 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=134.3t · 249.5 µs/step
    standoff: "cdd091b4",
    // ships=16 inFlight=30 p.fired=311 p.hits=1289 b.fired=20 b.hits=1442 contacts=1309 bumps=18 crashes=10 severed=22 culled=0 scrap=351.1t · 198.6 µs/step
    column: "ee3d5e7b",
    // ships=4 inFlight=9 p.fired=15 p.hits=87 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=2 culled=0 scrap=31.1t · 68.3 µs/step
    split: "06975867",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74329.7t · 1809.8 µs/step
    crash: "195a4442",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=2163 contacts=74 bumps=2 crashes=1 severed=2 culled=0 scrap=36.1t · 189.8 µs/step
    torchRun: "8e228649",
    // ships=4 inFlight=51 p.fired=131 p.hits=398 b.fired=0 b.hits=0 contacts=1 bumps=1 crashes=0 severed=0 culled=0 scrap=23.1t · 111.9 µs/step
    hooked: "35eaff3a",
    // ships=2 inFlight=0 p.fired=43 p.hits=288 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.8t · 50.8 µs/step
    broadside: "be7b03a5",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=1 crashes=0 severed=0 culled=0 scrap=5.0t · 17.2 µs/step
    salvageRun: "53124c5d",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=1.4t · 22.0 µs/step
    refitting: "35d04241",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=144.1t · 28.8 µs/step
    catamaranRefits: "725f0e88",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=34 bumps=3 crashes=0 severed=3 culled=0 scrap=108.3t · 37.8 µs/step
    scavenge: "df825eca",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.0t · 35.5 µs/step
    padRebuild: "0d31c912",
    // ships=5 inFlight=0 p.fired=23 p.hits=88 b.fired=0 b.hits=0 contacts=38 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 77.7 µs/step
    factory: "c4894673",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 134.4 µs/step
    shipyard: "3a5a0509",
    // ships=5 inFlight=0 p.fired=15 p.hits=60 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.4t · 68.0 µs/step
    rearm: "c1b31b68",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=2 culled=0 scrap=0.1t · 85.5 µs/step
    tanker: "cbe039d9",
    // ships=20 inFlight=0 p.fired=13 p.hits=52 b.fired=151 b.hits=5952 contacts=89 bumps=1 crashes=5 severed=1 culled=0 scrap=9.7t · 522.1 µs/step
    beamCarrier: "a4bf2199",
    // ships=2 inFlight=0 p.fired=57 p.hits=211 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 23.4 µs/step
    passes: "6ec58c3e",
    // ships=2 inFlight=0 p.fired=2 p.hits=16 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 37.2 µs/step
    circling: "26d1998b",
    // ships=4 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.0t · 35.1 µs/step
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
