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
    // ships=3 inFlight=1 p.fired=102 p.hits=193 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=41.1t · 136.4 µs/step
    duel: "c6eb340e",
    // ships=3 inFlight=2 p.fired=45 p.hits=105 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=22.6t · 104.8 µs/step
    railDuel: "e1bf157a",
    // ships=2 inFlight=0 p.fired=21 p.hits=58 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=42.1t · 68.0 µs/step
    armourCorvettes: "e9174e72",
    // ships=2 inFlight=0 p.fired=12 p.hits=25 b.fired=25 b.hits=1093 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=14.6t · 76.4 µs/step
    armourBeamCorvettes: "b3ab4330",
    // ships=2 inFlight=0 p.fired=1 p.hits=1 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=39.9t · 18.1 µs/step
    armourRailCorvettes: "52803faa",
    // ships=2 inFlight=0 p.fired=12 p.hits=10 b.fired=3 b.hits=285 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=46.8t · 56.0 µs/step
    armourLanceCorvettes: "8f5c6e59",
    // ships=3 inFlight=11 p.fired=145 p.hits=251 b.fired=2 b.hits=244 contacts=248 bumps=0 crashes=0 severed=2 culled=0 scrap=127.8t · 136.7 µs/step
    lanceDuel: "ede4f3fe",
    // ships=7 inFlight=0 p.fired=0 p.hits=5 b.fired=41 b.hits=3816 contacts=68 bumps=0 crashes=2 severed=4 culled=0 scrap=60.9t · 118.4 µs/step
    beamDuel: "4b8f428c",
    // ships=2 inFlight=22 p.fired=54 p.hits=94 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=11.9t · 84.1 µs/step
    binary: "ccf933d7",
    // ships=5 inFlight=0 p.fired=152 p.hits=420 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=41.2t · 75.3 µs/step
    kernels: "b7defdd3",
    // ships=12 inFlight=0 p.fired=86 p.hits=130 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=31.1t · 61.9 µs/step
    asteroidField: "5a38c52f",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 38.6 µs/step
    mining: "0095f392",
    // ships=17 inFlight=22 p.fired=380 p.hits=979 b.fired=0 b.hits=0 contacts=1500 bumps=6 crashes=1 severed=2 culled=1 scrap=72.9t · 593.6 µs/step
    rivalMines: "e67a15cb",
    // ships=22 inFlight=24 p.fired=92 p.hits=79 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.9t · 614.2 µs/step
    swarm: "d260e04c",
    // ships=302 inFlight=138 p.fired=700 p.hits=1054 b.fired=0 b.hits=0 contacts=63 bumps=1 crashes=9 severed=3 culled=3 scrap=24.8t · 18620.2 µs/step
    superSwarm: "c8018614",
    // ships=7 inFlight=0 p.fired=0 p.hits=209 b.fired=7 b.hits=1024 contacts=10 bumps=0 crashes=1 severed=1 culled=0 scrap=29.9t · 102.4 µs/step
    torpedoes: "b14eabae",
    // ships=9 inFlight=0 p.fired=0 p.hits=271 b.fired=6 b.hits=88 contacts=5 bumps=0 crashes=2 severed=0 culled=0 scrap=24.5t · 122.1 µs/step
    torpedoesWarhead: "b75d504f",
    // ships=12 inFlight=0 p.fired=0 p.hits=400 b.fired=8 b.hits=165 contacts=3 bumps=0 crashes=2 severed=0 culled=0 scrap=13.0t · 100.5 µs/step
    torpedoesShaped: "5c6ddd9b",
    // ships=4 inFlight=0 p.fired=3 p.hits=144 b.fired=0 b.hits=0 contacts=27 bumps=0 crashes=6 severed=1 culled=0 scrap=47.2t · 82.9 µs/step
    torpedoesGunPlatform: "813deabd",
    // ships=8 inFlight=0 p.fired=1 p.hits=403 b.fired=0 b.hits=0 contacts=24 bumps=1 crashes=3 severed=2 culled=0 scrap=55.7t · 117.7 µs/step
    torpedoesWarheadGunPlatform: "0d33e54e",
    // ships=7 inFlight=0 p.fired=2 p.hits=177 b.fired=0 b.hits=0 contacts=7 bumps=0 crashes=1 severed=0 culled=0 scrap=43.9t · 159.4 µs/step
    torpedoesShapedGunPlatform: "c9a171a1",
    // ships=6 inFlight=0 p.fired=25 p.hits=213 b.fired=0 b.hits=0 contacts=9 bumps=0 crashes=1 severed=0 culled=0 scrap=18.2t · 179.8 µs/step
    torpedoBoatTorpedoes: "34d08457",
    // ships=5 inFlight=12 p.fired=115 p.hits=191 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=27.7t · 114.9 µs/step
    disarm: "a0717deb",
    // ships=3 inFlight=0 p.fired=47 p.hits=61 b.fired=37 b.hits=1981 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=53.1t · 93.2 µs/step
    disarmBeams: "ec511754",
    // ships=3 inFlight=0 p.fired=77 p.hits=165 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=29.0t · 64.5 µs/step
    disarmRails: "959567f5",
    // ships=2 inFlight=12 p.fired=53 p.hits=110 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.0t · 57.3 µs/step
    ordering: "eca528f4",
    // ships=10 inFlight=4 p.fired=85 p.hits=166 b.fired=21 b.hits=1573 contacts=3 bumps=0 crashes=1 severed=1 culled=1 scrap=87.6t · 235.0 µs/step
    standoff: "1fdae888",
    // ships=13 inFlight=16 p.fired=264 p.hits=525 b.fired=30 b.hits=2103 contacts=1578 bumps=8 crashes=3 severed=16 culled=0 scrap=219.8t · 264.6 µs/step
    column: "4f3f4cc1",
    // ships=3 inFlight=0 p.fired=10 p.hits=33 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=40.9t · 72.3 µs/step
    split: "7900400b",
    // ships=20 inFlight=2 p.fired=0 p.hits=10 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74346.4t · 2329.4 µs/step
    crash: "cc2f0a18",
    // ships=6 inFlight=0 p.fired=0 p.hits=0 b.fired=9 b.hits=2502 contacts=24 bumps=0 crashes=1 severed=1 culled=0 scrap=37.4t · 205.7 µs/step
    torchRun: "21e7d1f4",
    // ships=4 inFlight=57 p.fired=130 p.hits=434 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=1 culled=0 scrap=28.3t · 111.8 µs/step
    hooked: "673fca81",
    // ships=2 inFlight=0 p.fired=43 p.hits=181 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=7.9t · 65.3 µs/step
    broadside: "70974ce6",
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
    // ships=5 inFlight=0 p.fired=69 p.hits=74 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 77.4 µs/step
    factory: "059bae4f",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 134.4 µs/step
    shipyard: "3a5a0509",
    // ships=5 inFlight=2 p.fired=36 p.hits=43 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.3t · 76.8 µs/step
    rearm: "e7c3e75d",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=2 culled=0 scrap=0.1t · 85.5 µs/step
    tanker: "cbe039d9",
    // ships=20 inFlight=0 p.fired=69 p.hits=208 b.fired=294 b.hits=9056 contacts=72 bumps=1 crashes=6 severed=2 culled=1 scrap=12.0t · 513.6 µs/step
    beamCarrier: "3cea0347",
    // ships=2 inFlight=0 p.fired=58 p.hits=121 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 32.6 µs/step
    passes: "be06fc24",
    // ships=2 inFlight=0 p.fired=2 p.hits=6 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 38.0 µs/step
    circling: "aeb4c240",
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
