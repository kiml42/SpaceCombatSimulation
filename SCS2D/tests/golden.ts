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
    // ships=7 inFlight=13 p.fired=143 p.hits=265 b.fired=0 b.hits=0 contacts=661 bumps=1 crashes=0 severed=4 culled=0 scrap=67.2t · 255.2 µs/step
    duel: "872ad42b",
    // ships=3 inFlight=2 p.fired=45 p.hits=87 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=69.5t · 108.7 µs/step
    railDuel: "7717e9cf",
    // ships=3 inFlight=11 p.fired=145 p.hits=211 b.fired=2 b.hits=241 contacts=235 bumps=0 crashes=0 severed=2 culled=0 scrap=126.4t · 104.8 µs/step
    lanceDuel: "c083240b",
    // ships=7 inFlight=0 p.fired=0 p.hits=5 b.fired=41 b.hits=3809 contacts=90 bumps=0 crashes=2 severed=4 culled=0 scrap=60.8t · 126.4 µs/step
    beamDuel: "af9159f3",
    // ships=2 inFlight=34 p.fired=52 p.hits=86 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=11.6t · 52.4 µs/step
    binary: "095912a1",
    // ships=4 inFlight=0 p.fired=234 p.hits=647 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=45.5t · 56.8 µs/step
    kernels: "3968a4b1",
    // ships=12 inFlight=0 p.fired=107 p.hits=179 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=29.0t · 56.2 µs/step
    asteroidField: "cdf2ebc5",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 38.6 µs/step
    mining: "0095f392",
    // ships=13 inFlight=0 p.fired=450 p.hits=932 b.fired=0 b.hits=0 contacts=1397 bumps=4 crashes=6 severed=2 culled=2 scrap=118.1t · 634.1 µs/step
    rivalMines: "56cd9823",
    // ships=22 inFlight=17 p.fired=57 p.hits=38 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.5t · 499.9 µs/step
    swarm: "ca5622d8",
    // ships=302 inFlight=81 p.fired=383 p.hits=521 b.fired=0 b.hits=0 contacts=63 bumps=1 crashes=9 severed=3 culled=3 scrap=20.8t · 15099.4 µs/step
    superSwarm: "1e64d1ee",
    // ships=9 inFlight=0 p.fired=0 p.hits=756 b.fired=4 b.hits=784 contacts=334 bumps=1 crashes=4 severed=4 culled=0 scrap=62.2t · 137.7 µs/step
    torpedoes: "26145575",
    // ships=8 inFlight=0 p.fired=0 p.hits=221 b.fired=5 b.hits=43 contacts=4 bumps=0 crashes=0 severed=1 culled=0 scrap=25.7t · 145.4 µs/step
    torpedoesWarhead: "cb7b97a8",
    // ships=8 inFlight=0 p.fired=0 p.hits=308 b.fired=7 b.hits=115 contacts=5 bumps=0 crashes=1 severed=0 culled=0 scrap=18.4t · 121.3 µs/step
    torpedoesShaped: "bcd69725",
    // ships=4 inFlight=0 p.fired=3 p.hits=89 b.fired=0 b.hits=0 contacts=19 bumps=0 crashes=3 severed=1 culled=0 scrap=60.8t · 104.4 µs/step
    torpedoesGunPlatform: "21c429f8",
    // ships=6 inFlight=0 p.fired=1 p.hits=292 b.fired=0 b.hits=0 contacts=5 bumps=0 crashes=2 severed=1 culled=0 scrap=49.6t · 139.2 µs/step
    torpedoesWarheadGunPlatform: "c1b295fc",
    // ships=7 inFlight=0 p.fired=2 p.hits=220 b.fired=0 b.hits=0 contacts=10 bumps=0 crashes=3 severed=0 culled=0 scrap=36.5t · 155.8 µs/step
    torpedoesShapedGunPlatform: "3034dcbd",
    // ships=6 inFlight=0 p.fired=20 p.hits=189 b.fired=0 b.hits=0 contacts=37 bumps=0 crashes=1 severed=0 culled=0 scrap=20.9t · 193.8 µs/step
    torpedoBoatTorpedoes: "61013c29",
    // ships=5 inFlight=21 p.fired=144 p.hits=260 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=57.4t · 95.6 µs/step
    disarm: "376182d9",
    // ships=3 inFlight=0 p.fired=56 p.hits=60 b.fired=33 b.hits=1756 contacts=4 bumps=1 crashes=0 severed=1 culled=1 scrap=67.6t · 88.7 µs/step
    disarmBeams: "ac747ec1",
    // ships=3 inFlight=0 p.fired=96 p.hits=158 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=27.7t · 64.9 µs/step
    disarmRails: "e332fd63",
    // ships=2 inFlight=32 p.fired=57 p.hits=104 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.0t · 62.8 µs/step
    ordering: "78aab90b",
    // ships=10 inFlight=0 p.fired=97 p.hits=208 b.fired=27 b.hits=1636 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=82.9t · 227.2 µs/step
    standoff: "07b03394",
    // ships=18 inFlight=8 p.fired=282 p.hits=585 b.fired=18 b.hits=1601 contacts=1926 bumps=21 crashes=23 severed=27 culled=0 scrap=296.6t · 217.0 µs/step
    column: "a1c130b7",
    // ships=3 inFlight=1 p.fired=11 p.hits=30 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=31.9t · 83.8 µs/step
    split: "24a18d29",
    // ships=20 inFlight=2 p.fired=0 p.hits=10 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74346.4t · 1935.7 µs/step
    crash: "cc2f0a18",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=2163 contacts=74 bumps=2 crashes=1 severed=2 culled=0 scrap=36.1t · 189.8 µs/step
    torchRun: "8e228649",
    // ships=4 inFlight=69 p.fired=130 p.hits=425 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=1 culled=0 scrap=26.4t · 139.8 µs/step
    hooked: "d1e20d44",
    // ships=2 inFlight=0 p.fired=45 p.hits=200 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=6.8t · 54.1 µs/step
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
    // ships=5 inFlight=0 p.fired=85 p.hits=82 b.fired=0 b.hits=0 contacts=38 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 68.3 µs/step
    factory: "12484540",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 134.4 µs/step
    shipyard: "3a5a0509",
    // ships=5 inFlight=4 p.fired=36 p.hits=40 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 77.0 µs/step
    rearm: "564c2668",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=2 culled=0 scrap=0.1t · 85.5 µs/step
    tanker: "cbe039d9",
    // ships=20 inFlight=0 p.fired=45 p.hits=142 b.fired=150 b.hits=6476 contacts=157 bumps=3 crashes=8 severed=2 culled=1 scrap=9.6t · 601.8 µs/step
    beamCarrier: "a5cc120c",
    // ships=2 inFlight=0 p.fired=58 p.hits=129 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 28.4 µs/step
    passes: "e0523328",
    // ships=2 inFlight=0 p.fired=2 p.hits=2 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 40.1 µs/step
    circling: "996fb9a7",
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
