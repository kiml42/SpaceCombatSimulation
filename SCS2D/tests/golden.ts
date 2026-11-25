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
    // ships=4 inFlight=24 p.fired=114 p.hits=173 b.fired=0 b.hits=0 contacts=2 bumps=0 crashes=0 severed=1 culled=0 scrap=42.2t · 256.8 µs/step
    duel: "f4f697cf",
    // ships=3 inFlight=2 p.fired=45 p.hits=87 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=69.5t · 120.4 µs/step
    railDuel: "7717e9cf",
    // ships=2 inFlight=0 p.fired=21 p.hits=66 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=43.3t · 64.0 µs/step
    armourCorvettes: "6a36b980",
    // ships=2 inFlight=0 p.fired=12 p.hits=26 b.fired=24 b.hits=1064 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=14.8t · 77.2 µs/step
    armourBeamCorvettes: "f19e065b",
    // ships=2 inFlight=0 p.fired=1 p.hits=1 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=39.9t · 18.1 µs/step
    armourRailCorvettes: "52803faa",
    // ships=2 inFlight=0 p.fired=12 p.hits=10 b.fired=3 b.hits=285 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=46.8t · 56.0 µs/step
    armourLanceCorvettes: "8f5c6e59",
    // ships=3 inFlight=11 p.fired=145 p.hits=211 b.fired=2 b.hits=241 contacts=235 bumps=0 crashes=0 severed=2 culled=0 scrap=126.4t · 162.9 µs/step
    lanceDuel: "c083240b",
    // ships=7 inFlight=0 p.fired=0 p.hits=5 b.fired=41 b.hits=3809 contacts=90 bumps=0 crashes=2 severed=4 culled=0 scrap=60.8t · 126.4 µs/step
    beamDuel: "af9159f3",
    // ships=2 inFlight=24 p.fired=54 p.hits=98 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=12.0t · 82.5 µs/step
    binary: "f7fcdabb",
    // ships=4 inFlight=0 p.fired=153 p.hits=463 b.fired=0 b.hits=0 contacts=7 bumps=1 crashes=0 severed=1 culled=0 scrap=44.4t · 70.3 µs/step
    kernels: "c11cfb10",
    // ships=12 inFlight=0 p.fired=90 p.hits=155 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=30.1t · 65.7 µs/step
    asteroidField: "12e72334",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 38.6 µs/step
    mining: "0095f392",
    // ships=13 inFlight=0 p.fired=377 p.hits=768 b.fired=0 b.hits=0 contacts=2664 bumps=5 crashes=10 severed=3 culled=2 scrap=91.5t · 697.3 µs/step
    rivalMines: "f119cabc",
    // ships=22 inFlight=17 p.fired=57 p.hits=38 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.5t · 584.0 µs/step
    swarm: "c6d0d0b3",
    // ships=302 inFlight=102 p.fired=413 p.hits=592 b.fired=0 b.hits=0 contacts=63 bumps=1 crashes=9 severed=3 culled=3 scrap=17.6t · 20737.0 µs/step
    superSwarm: "bb5430e1",
    // ships=9 inFlight=0 p.fired=0 p.hits=756 b.fired=4 b.hits=784 contacts=334 bumps=1 crashes=4 severed=4 culled=0 scrap=62.2t · 134.1 µs/step
    torpedoes: "dabe71a0",
    // ships=9 inFlight=0 p.fired=0 p.hits=356 b.fired=4 b.hits=36 contacts=54 bumps=1 crashes=3 severed=1 culled=0 scrap=37.4t · 162.6 µs/step
    torpedoesWarhead: "6329466e",
    // ships=10 inFlight=0 p.fired=0 p.hits=385 b.fired=9 b.hits=129 contacts=3 bumps=0 crashes=0 severed=0 culled=0 scrap=15.6t · 131.0 µs/step
    torpedoesShaped: "a2aa0a53",
    // ships=4 inFlight=0 p.fired=3 p.hits=89 b.fired=0 b.hits=0 contacts=19 bumps=0 crashes=3 severed=1 culled=0 scrap=60.8t · 88.3 µs/step
    torpedoesGunPlatform: "da78ddac",
    // ships=8 inFlight=0 p.fired=1 p.hits=387 b.fired=0 b.hits=0 contacts=93 bumps=1 crashes=1 severed=2 culled=0 scrap=51.7t · 159.8 µs/step
    torpedoesWarheadGunPlatform: "074c2db9",
    // ships=9 inFlight=0 p.fired=2 p.hits=104 b.fired=0 b.hits=0 contacts=5 bumps=0 crashes=1 severed=0 culled=0 scrap=29.5t · 131.5 µs/step
    torpedoesShapedGunPlatform: "6b4b49a7",
    // ships=6 inFlight=0 p.fired=29 p.hits=156 b.fired=0 b.hits=0 contacts=41 bumps=0 crashes=2 severed=0 culled=0 scrap=14.7t · 188.0 µs/step
    torpedoBoatTorpedoes: "d4100953",
    // ships=5 inFlight=12 p.fired=122 p.hits=209 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=21.9t · 99.2 µs/step
    disarm: "96bc62da",
    // ships=3 inFlight=0 p.fired=55 p.hits=61 b.fired=33 b.hits=1809 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=49.9t · 117.3 µs/step
    disarmBeams: "3d1b7d1c",
    // ships=3 inFlight=0 p.fired=96 p.hits=158 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=27.7t · 78.4 µs/step
    disarmRails: "de64302b",
    // ships=2 inFlight=32 p.fired=57 p.hits=104 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.0t · 82.9 µs/step
    ordering: "dae0623a",
    // ships=10 inFlight=1 p.fired=115 p.hits=222 b.fired=29 b.hits=1833 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=77.2t · 220.6 µs/step
    standoff: "cbe54eec",
    // ships=22 inFlight=12 p.fired=259 p.hits=552 b.fired=23 b.hits=1649 contacts=2066 bumps=17 crashes=12 severed=25 culled=1 scrap=274.1t · 222.6 µs/step
    column: "cd872b3d",
    // ships=3 inFlight=1 p.fired=11 p.hits=28 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 103.2 µs/step
    split: "94e62562",
    // ships=20 inFlight=2 p.fired=0 p.hits=10 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74346.4t · 2329.4 µs/step
    crash: "cc2f0a18",
    // ships=6 inFlight=0 p.fired=0 p.hits=0 b.fired=9 b.hits=2502 contacts=24 bumps=0 crashes=1 severed=1 culled=0 scrap=37.4t · 185.7 µs/step
    torchRun: "21e7d1f4",
    // ships=4 inFlight=69 p.fired=130 p.hits=425 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=1 culled=0 scrap=26.4t · 144.8 µs/step
    hooked: "84ffbc5f",
    // ships=2 inFlight=0 p.fired=45 p.hits=200 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=6.8t · 54.5 µs/step
    broadside: "620f33f4",
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
    // ships=5 inFlight=0 p.fired=85 p.hits=82 b.fired=0 b.hits=0 contacts=38 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 81.5 µs/step
    factory: "37164758",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 134.4 µs/step
    shipyard: "3a5a0509",
    // ships=5 inFlight=4 p.fired=36 p.hits=40 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 94.4 µs/step
    rearm: "04f5d165",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=2 culled=0 scrap=0.1t · 85.5 µs/step
    tanker: "cbe039d9",
    // ships=20 inFlight=0 p.fired=84 p.hits=238 b.fired=281 b.hits=9022 contacts=65 bumps=1 crashes=2 severed=1 culled=0 scrap=9.5t · 482.6 µs/step
    beamCarrier: "b5aaf404",
    // ships=2 inFlight=0 p.fired=58 p.hits=129 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 31.4 µs/step
    passes: "5a9e8ce4",
    // ships=2 inFlight=0 p.fired=2 p.hits=2 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 42.9 µs/step
    circling: "3a84be80",
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
