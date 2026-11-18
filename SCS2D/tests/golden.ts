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
    // ships=7 inFlight=22 p.fired=117 p.hits=413 b.fired=0 b.hits=0 contacts=64 bumps=1 crashes=3 severed=4 culled=0 scrap=73.9t · 278.3 µs/step
    duel: "a1511b90",
    // ships=4 inFlight=1 p.fired=48 p.hits=223 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=44.3t · 99.4 µs/step
    railDuel: "39bc6555",
    // ships=4 inFlight=8 p.fired=144 p.hits=423 b.fired=2 b.hits=242 contacts=255 bumps=0 crashes=0 severed=3 culled=0 scrap=132.3t · 146.4 µs/step
    lanceDuel: "c39249ba",
    // ships=7 inFlight=0 p.fired=0 p.hits=32 b.fired=41 b.hits=4252 contacts=41 bumps=1 crashes=2 severed=4 culled=0 scrap=53.2t · 155.3 µs/step
    beamDuel: "55101ab3",
    // ships=2 inFlight=22 p.fired=42 p.hits=142 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=10.7t · 47.1 µs/step
    binary: "003bc56d",
    // ships=5 inFlight=0 p.fired=133 p.hits=617 b.fired=0 b.hits=0 contacts=238 bumps=3 crashes=0 severed=2 culled=0 scrap=27.9t · 70.6 µs/step
    kernels: "4f390944",
    // ships=13 inFlight=13 p.fired=193 p.hits=778 b.fired=0 b.hits=0 contacts=809 bumps=0 crashes=0 severed=2 culled=0 scrap=39.0t · 79.8 µs/step
    asteroidField: "0a6d95b0",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 38.6 µs/step
    mining: "0095f392",
    // ships=13 inFlight=0 p.fired=877 p.hits=2413 b.fired=0 b.hits=0 contacts=621 bumps=2 crashes=2 severed=0 culled=0 scrap=125.8t · 598.6 µs/step
    rivalMines: "23910461",
    // ships=22 inFlight=81 p.fired=100 p.hits=63 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=3.3t · 635.0 µs/step
    swarm: "9953956e",
    // ships=303 inFlight=180 p.fired=518 p.hits=699 b.fired=0 b.hits=0 contacts=47 bumps=0 crashes=13 severed=9 culled=8 scrap=37.7t · 19819.5 µs/step
    superSwarm: "17a2198b",
    // ships=6 inFlight=0 p.fired=0 p.hits=74 b.fired=6 b.hits=809 contacts=196 bumps=2 crashes=5 severed=3 culled=1 scrap=49.8t · 85.5 µs/step
    torpedoes: "5ec569d9",
    // ships=6 inFlight=0 p.fired=2 p.hits=99 b.fired=0 b.hits=0 contacts=124 bumps=1 crashes=7 severed=3 culled=0 scrap=42.4t · 282.1 µs/step
    torpedoesGunPlatform: "52a77a13",
    // ships=3 inFlight=11 p.fired=108 p.hits=311 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=25.9t · 73.6 µs/step
    disarm: "8defd32f",
    // ships=3 inFlight=0 p.fired=45 p.hits=138 b.fired=39 b.hits=1831 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=60.4t · 94.6 µs/step
    disarmBeams: "ea93814c",
    // ships=4 inFlight=0 p.fired=56 p.hits=249 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=52.1t · 76.1 µs/step
    disarmRails: "a5c82061",
    // ships=2 inFlight=10 p.fired=51 p.hits=182 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=2.7t · 60.4 µs/step
    ordering: "21985a2e",
    // ships=16 inFlight=0 p.fired=154 p.hits=614 b.fired=23 b.hits=1409 contacts=318 bumps=3 crashes=8 severed=8 culled=0 scrap=180.3t · 211.5 µs/step
    standoff: "791dcbd9",
    // ships=12 inFlight=0 p.fired=136 p.hits=557 b.fired=33 b.hits=2304 contacts=210 bumps=3 crashes=1 severed=5 culled=0 scrap=144.8t · 177.3 µs/step
    column: "c1447f4c",
    // ships=3 inFlight=1 p.fired=12 p.hits=59 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=33.0t · 82.3 µs/step
    split: "817ec5fb",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74679.6t · 1660.5 µs/step
    crash: "0be427e9",
    // ships=11 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=2317 contacts=236 bumps=2 crashes=4 severed=6 culled=0 scrap=46.7t · 185.9 µs/step
    torchRun: "6086d8a2",
    // ships=4 inFlight=47 p.fired=128 p.hits=418 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=1 culled=0 scrap=22.6t · 125.4 µs/step
    hooked: "0ea4ffa0",
    // ships=2 inFlight=0 p.fired=43 p.hits=288 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.8t · 55.4 µs/step
    broadside: "770e03af",
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
    // ships=20 inFlight=0 p.fired=5 p.hits=31 b.fired=283 b.hits=7808 contacts=119 bumps=2 crashes=5 severed=2 culled=1 scrap=12.3t · 447.7 µs/step
    beamCarrier: "e5eb68f7",
    // ships=2 inFlight=0 p.fired=57 p.hits=211 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 34.6 µs/step
    passes: "5cf2fe2a",
    // ships=2 inFlight=0 p.fired=2 p.hits=17 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 48.5 µs/step
    circling: "84bf3445",
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
