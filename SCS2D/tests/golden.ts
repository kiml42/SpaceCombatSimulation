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
    // ships=3 inFlight=1 p.fired=102 p.hits=193 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=41.1t · 198.4 µs/step
    duel: "9caa6fb5",
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
    // ships=7 inFlight=0 p.fired=0 p.hits=5 b.fired=41 b.hits=3809 contacts=90 bumps=0 crashes=2 severed=4 culled=0 scrap=60.8t · 126.4 µs/step
    beamDuel: "af9159f3",
    // ships=2 inFlight=22 p.fired=54 p.hits=94 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=11.9t · 84.1 µs/step
    binary: "ccf933d7",
    // ships=5 inFlight=0 p.fired=152 p.hits=420 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=41.2t · 75.3 µs/step
    kernels: "b7defdd3",
    // ships=12 inFlight=0 p.fired=86 p.hits=130 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=31.1t · 61.9 µs/step
    asteroidField: "5a38c52f",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 38.6 µs/step
    mining: "0095f392",
    // ships=17 inFlight=22 p.fired=380 p.hits=979 b.fired=0 b.hits=0 contacts=1504 bumps=6 crashes=2 severed=2 culled=1 scrap=72.9t · 592.0 µs/step
    rivalMines: "e3c5dbf5",
    // ships=22 inFlight=24 p.fired=92 p.hits=79 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.9t · 614.2 µs/step
    swarm: "d260e04c",
    // ships=302 inFlight=140 p.fired=703 p.hits=1053 b.fired=0 b.hits=0 contacts=63 bumps=1 crashes=9 severed=3 culled=3 scrap=24.9t · 20399.0 µs/step
    superSwarm: "24b71424",
    // ships=9 inFlight=0 p.fired=0 p.hits=756 b.fired=4 b.hits=784 contacts=334 bumps=1 crashes=4 severed=4 culled=0 scrap=62.2t · 134.1 µs/step
    torpedoes: "dabe71a0",
    // ships=11 inFlight=0 p.fired=0 p.hits=273 b.fired=7 b.hits=88 contacts=5 bumps=0 crashes=2 severed=0 culled=0 scrap=24.9t · 144.4 µs/step
    torpedoesWarhead: "989d0ccc",
    // ships=12 inFlight=0 p.fired=0 p.hits=381 b.fired=10 b.hits=90 contacts=2 bumps=0 crashes=1 severed=0 culled=0 scrap=11.7t · 145.9 µs/step
    torpedoesShaped: "1ed804cc",
    // ships=4 inFlight=0 p.fired=3 p.hits=144 b.fired=0 b.hits=0 contacts=27 bumps=0 crashes=6 severed=1 culled=0 scrap=47.2t · 82.9 µs/step
    torpedoesGunPlatform: "813deabd",
    // ships=8 inFlight=0 p.fired=1 p.hits=403 b.fired=0 b.hits=0 contacts=24 bumps=1 crashes=3 severed=2 culled=0 scrap=55.7t · 117.7 µs/step
    torpedoesWarheadGunPlatform: "0d33e54e",
    // ships=7 inFlight=0 p.fired=2 p.hits=177 b.fired=0 b.hits=0 contacts=7 bumps=0 crashes=1 severed=0 culled=0 scrap=43.9t · 159.4 µs/step
    torpedoesShapedGunPlatform: "c9a171a1",
    // ships=5 inFlight=0 p.fired=19 p.hits=229 b.fired=0 b.hits=0 contacts=38 bumps=0 crashes=1 severed=0 culled=0 scrap=25.9t · 205.2 µs/step
    torpedoBoatTorpedoes: "224d4bd8",
    // ships=5 inFlight=12 p.fired=139 p.hits=263 b.fired=0 b.hits=0 contacts=7 bumps=1 crashes=0 severed=1 culled=0 scrap=53.1t · 113.9 µs/step
    disarm: "ae6bbaab",
    // ships=3 inFlight=0 p.fired=47 p.hits=61 b.fired=37 b.hits=1981 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=53.1t · 93.2 µs/step
    disarmBeams: "ec511754",
    // ships=3 inFlight=0 p.fired=76 p.hits=144 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=31.9t · 63.2 µs/step
    disarmRails: "7ed4cdbd",
    // ships=2 inFlight=12 p.fired=53 p.hits=110 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.0t · 57.3 µs/step
    ordering: "eca528f4",
    // ships=10 inFlight=1 p.fired=88 p.hits=183 b.fired=22 b.hits=1713 contacts=0 bumps=0 crashes=0 severed=1 culled=1 scrap=77.7t · 229.3 µs/step
    standoff: "ebe0f32e",
    // ships=24 inFlight=0 p.fired=117 p.hits=291 b.fired=16 b.hits=1126 contacts=1789 bumps=17 crashes=10 severed=29 culled=0 scrap=230.1t · 183.1 µs/step
    column: "fe06cf33",
    // ships=3 inFlight=0 p.fired=10 p.hits=33 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=40.9t · 72.3 µs/step
    split: "7900400b",
    // ships=20 inFlight=2 p.fired=0 p.hits=10 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74346.4t · 2329.4 µs/step
    crash: "cc2f0a18",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=2163 contacts=74 bumps=2 crashes=1 severed=2 culled=0 scrap=36.1t · 189.8 µs/step
    torchRun: "8e228649",
    // ships=4 inFlight=58 p.fired=130 p.hits=442 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=1 culled=0 scrap=26.7t · 119.0 µs/step
    hooked: "9b3a6dd1",
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
    // ships=5 inFlight=0 p.fired=76 p.hits=73 b.fired=0 b.hits=0 contacts=38 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 65.3 µs/step
    factory: "a5fe3d74",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 134.4 µs/step
    shipyard: "3a5a0509",
    // ships=5 inFlight=2 p.fired=36 p.hits=43 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.3t · 76.8 µs/step
    rearm: "e7c3e75d",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=2 culled=0 scrap=0.1t · 85.5 µs/step
    tanker: "cbe039d9",
    // ships=20 inFlight=1 p.fired=103 p.hits=300 b.fired=160 b.hits=6100 contacts=79 bumps=1 crashes=8 severed=1 culled=0 scrap=9.5t · 576.5 µs/step
    beamCarrier: "792c75d5",
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
