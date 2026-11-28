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
    // ships=3 inFlight=25 p.fired=112 p.hits=210 b.fired=0 b.hits=0 contacts=16 bumps=2 crashes=0 severed=1 culled=0 scrap=30.4t · 144.5 µs/step
    duel: "87fa4981",
    // ships=3 inFlight=1 p.fired=45 p.hits=105 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=37.0t · 65.0 µs/step
    railDuel: "7ac2eaa0",
    // ships=2 inFlight=0 p.fired=22 p.hits=63 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=44.1t · 46.2 µs/step
    armourCorvettes: "cd8bae14",
    // ships=2 inFlight=0 p.fired=12 p.hits=22 b.fired=24 b.hits=1040 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=12.9t · 53.4 µs/step
    armourBeamCorvettes: "c9690081",
    // ships=2 inFlight=0 p.fired=1 p.hits=1 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=39.9t · 14.0 µs/step
    armourRailCorvettes: "1f0d5e06",
    // ships=2 inFlight=0 p.fired=12 p.hits=10 b.fired=3 b.hits=287 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=48.0t · 32.4 µs/step
    armourLanceCorvettes: "ca4a542e",
    // ships=3 inFlight=11 p.fired=153 p.hits=362 b.fired=1 b.hits=133 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=47.9t · 96.6 µs/step
    lanceDuel: "035f94ae",
    // ships=7 inFlight=0 p.fired=0 p.hits=5 b.fired=42 b.hits=2926 contacts=82 bumps=1 crashes=4 severed=4 culled=0 scrap=40.9t · 168.5 µs/step
    beamDuel: "558a31c3",
    // ships=2 inFlight=27 p.fired=89 p.hits=146 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=11.3t · 47.5 µs/step
    binary: "44429cf1",
    // ships=5 inFlight=0 p.fired=176 p.hits=335 b.fired=0 b.hits=0 contacts=10 bumps=2 crashes=0 severed=1 culled=0 scrap=53.4t · 53.4 µs/step
    kernels: "fbe7b072",
    // ships=12 inFlight=0 p.fired=143 p.hits=264 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=41.2t · 44.0 µs/step
    asteroidField: "4477d71e",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.2t · 34.5 µs/step
    mining: "4d523235",
    // ships=15 inFlight=0 p.fired=1247 p.hits=2543 b.fired=0 b.hits=0 contacts=123 bumps=4 crashes=3 severed=1 culled=1 scrap=-23.6t · 621.5 µs/step
    rivalMines: "6666160a",
    // ships=22 inFlight=17 p.fired=100 p.hits=81 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.2t · 548.7 µs/step
    swarm: "bc6ab599",
    // ships=304 inFlight=187 p.fired=1000 p.hits=1141 b.fired=0 b.hits=0 contacts=126 bumps=3 crashes=4 severed=6 culled=4 scrap=26.0t · 21103.2 µs/step
    superSwarm: "c4427205",
    // ships=8 inFlight=0 p.fired=0 p.hits=71 b.fired=6 b.hits=943 contacts=134 bumps=1 crashes=6 severed=2 culled=0 scrap=24.8t · 113.1 µs/step
    torpedoes: "f710d794",
    // ships=11 inFlight=0 p.fired=0 p.hits=252 b.fired=6 b.hits=73 contacts=6 bumps=0 crashes=3 severed=1 culled=0 scrap=18.3t · 154.1 µs/step
    torpedoesWarhead: "8cb4ea86",
    // ships=11 inFlight=0 p.fired=0 p.hits=650 b.fired=6 b.hits=160 contacts=14 bumps=0 crashes=1 severed=1 culled=0 scrap=15.4t · 130.0 µs/step
    torpedoesShaped: "13dea3e7",
    // ships=2 inFlight=0 p.fired=3 p.hits=90 b.fired=0 b.hits=0 contacts=11 bumps=0 crashes=1 severed=0 culled=0 scrap=67.7t · 90.0 µs/step
    torpedoesGunPlatform: "c4360658",
    // ships=8 inFlight=0 p.fired=2 p.hits=382 b.fired=0 b.hits=0 contacts=6 bumps=0 crashes=0 severed=1 culled=0 scrap=49.8t · 120.8 µs/step
    torpedoesWarheadGunPlatform: "85005162",
    // ships=7 inFlight=0 p.fired=2 p.hits=156 b.fired=0 b.hits=0 contacts=6 bumps=0 crashes=0 severed=0 culled=0 scrap=41.8t · 112.5 µs/step
    torpedoesShapedGunPlatform: "c4216836",
    // ships=6 inFlight=0 p.fired=19 p.hits=176 b.fired=0 b.hits=0 contacts=2 bumps=0 crashes=0 severed=0 culled=0 scrap=20.9t · 171.8 µs/step
    torpedoBoatTorpedoes: "8ba7809b",
    // ships=5 inFlight=11 p.fired=112 p.hits=234 b.fired=0 b.hits=0 contacts=6 bumps=1 crashes=0 severed=1 culled=0 scrap=36.7t · 67.1 µs/step
    disarm: "62419a22",
    // ships=3 inFlight=0 p.fired=48 p.hits=61 b.fired=38 b.hits=2150 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=45.4t · 67.4 µs/step
    disarmBeams: "9e417dbe",
    // ships=3 inFlight=0 p.fired=97 p.hits=193 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=35.3t · 51.0 µs/step
    disarmRails: "9281c5ae",
    // ships=2 inFlight=0 p.fired=150 p.hits=346 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=17.4t · 102.5 µs/step
    ordering: "1de31bcf",
    // ships=10 inFlight=8 p.fired=100 p.hits=225 b.fired=22 b.hits=1502 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=81.0t · 235.5 µs/step
    standoff: "3bfd0d62",
    // ships=13 inFlight=0 p.fired=94 p.hits=248 b.fired=48 b.hits=2925 contacts=129 bumps=1 crashes=3 severed=5 culled=0 scrap=170.1t · 124.3 µs/step
    column: "b491e893",
    // ships=3 inFlight=1 p.fired=15 p.hits=65 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=35.7t · 62.8 µs/step
    split: "1e59ab56",
    // ships=20 inFlight=2 p.fired=0 p.hits=10 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74345.9t · 2049.1 µs/step
    crash: "63f34837",
    // ships=9 inFlight=0 p.fired=0 p.hits=0 b.fired=11 b.hits=2786 contacts=744 bumps=2 crashes=1 severed=4 culled=0 scrap=48.5t · 197.6 µs/step
    torchRun: "e9ffaaf6",
    // ships=4 inFlight=56 p.fired=159 p.hits=574 b.fired=0 b.hits=0 contacts=21 bumps=2 crashes=0 severed=1 culled=0 scrap=43.7t · 96.0 µs/step
    hooked: "ea3eeed9",
    // ships=2 inFlight=6 p.fired=50 p.hits=230 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=12.7t · 42.2 µs/step
    broadside: "0d05ab44",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=1 crashes=0 severed=0 culled=0 scrap=5.1t · 21.2 µs/step
    salvageRun: "391c62d6",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 severed=0 culled=0 scrap=6.0t · 20.2 µs/step
    mending: "f63e907e",
    // ships=1 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.4t · 7.9 µs/step
    refitting: "ad4647fd",
    // ships=2 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=144.1t · 29.6 µs/step
    catamaranRefits: "d012c79a",
    // ships=5 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=28 bumps=3 crashes=0 severed=3 culled=0 scrap=108.3t · 43.5 µs/step
    scavenge: "5feaf258",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.0t · 34.4 µs/step
    padRebuild: "ade4427a",
    // ships=5 inFlight=0 p.fired=75 p.hits=66 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 86.5 µs/step
    factory: "236dda11",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 12.8 µs/step
    shipyard: "b5d153a6",
    // ships=5 inFlight=4 p.fired=39 p.hits=36 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 109.4 µs/step
    rearm: "44983515",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=9 bumps=2 crashes=0 severed=2 culled=0 scrap=0.3t · 47.2 µs/step
    tanker: "258c3353",
    // ships=20 inFlight=0 p.fired=30 p.hits=111 b.fired=287 b.hits=7840 contacts=142 bumps=2 crashes=9 severed=3 culled=2 scrap=11.7t · 579.3 µs/step
    beamCarrier: "6f9d2a7f",
    // ships=2 inFlight=2 p.fired=56 p.hits=89 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.4t · 20.9 µs/step
    passes: "75d086a2",
    // ships=2 inFlight=4 p.fired=70 p.hits=95 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.4t · 20.8 µs/step
    circling: "0558c9e4",
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
