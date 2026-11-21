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
    // ships=7 inFlight=19 p.fired=119 p.hits=400 b.fired=0 b.hits=0 contacts=64 bumps=0 crashes=2 severed=4 culled=0 scrap=93.9t · 969.8 µs/step
    duel: "f6144190",
    // ships=5 inFlight=2 p.fired=45 p.hits=173 b.fired=0 b.hits=0 contacts=166 bumps=0 crashes=0 severed=2 culled=0 scrap=78.5t · 372.2 µs/step
    railDuel: "b46e285d",
    // ships=4 inFlight=8 p.fired=144 p.hits=423 b.fired=2 b.hits=242 contacts=255 bumps=0 crashes=0 severed=3 culled=0 scrap=132.3t · 164.4 µs/step
    lanceDuel: "c39249ba",
    // ships=7 inFlight=0 p.fired=0 p.hits=54 b.fired=41 b.hits=3957 contacts=2 bumps=1 crashes=1 severed=4 culled=0 scrap=59.3t · 148.8 µs/step
    beamDuel: "a2eedc4a",
    // ships=2 inFlight=22 p.fired=42 p.hits=142 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=10.7t · 47.1 µs/step
    binary: "003bc56d",
    // ships=5 inFlight=0 p.fired=133 p.hits=617 b.fired=0 b.hits=0 contacts=232 bumps=3 crashes=0 severed=2 culled=0 scrap=27.3t · 61.7 µs/step
    kernels: "47277749",
    // ships=13 inFlight=9 p.fired=189 p.hits=762 b.fired=0 b.hits=0 contacts=120 bumps=0 crashes=0 severed=2 culled=0 scrap=38.0t · 79.7 µs/step
    asteroidField: "627aab1d",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 38.6 µs/step
    mining: "0095f392",
    // ships=17 inFlight=1 p.fired=509 p.hits=1402 b.fired=0 b.hits=0 contacts=60 bumps=7 crashes=6 severed=2 culled=1 scrap=132.6t · 1149.4 µs/step
    rivalMines: "31ef7b57",
    // ships=22 inFlight=29 p.fired=64 p.hits=55 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.0t · 533.0 µs/step
    swarm: "3514551f",
    // ships=302 inFlight=96 p.fired=424 p.hits=557 b.fired=0 b.hits=0 contacts=41 bumps=0 crashes=9 severed=4 culled=4 scrap=23.2t · 20009.1 µs/step
    superSwarm: "aee2ff01",
    // ships=9 inFlight=0 p.fired=0 p.hits=62 b.fired=5 b.hits=908 contacts=153 bumps=1 crashes=2 severed=2 culled=0 scrap=64.4t · 80.5 µs/step
    torpedoes: "1d009dd6",
    // ships=7 inFlight=0 p.fired=3 p.hits=86 b.fired=0 b.hits=0 contacts=27 bumps=0 crashes=6 severed=1 culled=0 scrap=51.4t · 86.2 µs/step
    torpedoesGunPlatform: "daf44381",
    // ships=5 inFlight=11 p.fired=124 p.hits=403 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=48.8t · 111.8 µs/step
    disarm: "ada161f4",
    // ships=3 inFlight=0 p.fired=45 p.hits=138 b.fired=39 b.hits=1831 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=60.4t · 104.0 µs/step
    disarmBeams: "ea93814c",
    // ships=3 inFlight=0 p.fired=79 p.hits=329 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=23.7t · 66.9 µs/step
    disarmRails: "52b5aa72",
    // ships=2 inFlight=10 p.fired=51 p.hits=182 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=2.7t · 60.4 µs/step
    ordering: "21985a2e",
    // ships=10 inFlight=25 p.fired=296 p.hits=1087 b.fired=25 b.hits=1911 contacts=10 bumps=2 crashes=1 severed=2 culled=2 scrap=125.2t · 381.8 µs/step
    standoff: "30888cbe",
    // ships=19 inFlight=0 p.fired=173 p.hits=729 b.fired=21 b.hits=1785 contacts=1647 bumps=21 crashes=10 severed=22 culled=0 scrap=327.8t · 213.5 µs/step
    column: "f841fe23",
    // ships=4 inFlight=1 p.fired=15 p.hits=93 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=2 culled=0 scrap=38.5t · 76.5 µs/step
    split: "baa07129",
    // ships=20 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74679.6t · 1660.5 µs/step
    crash: "0be427e9",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=2163 contacts=74 bumps=2 crashes=1 severed=2 culled=0 scrap=36.1t · 189.8 µs/step
    torchRun: "8e228649",
    // ships=4 inFlight=49 p.fired=132 p.hits=423 b.fired=0 b.hits=0 contacts=1 bumps=1 crashes=0 severed=0 culled=0 scrap=25.6t · 136.6 µs/step
    hooked: "6a3de80b",
    // ships=2 inFlight=0 p.fired=43 p.hits=288 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.8t · 50.3 µs/step
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
    // ships=5 inFlight=0 p.fired=15 p.hits=60 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.4t · 71.3 µs/step
    rearm: "acc32eb0",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=2 culled=0 scrap=0.1t · 85.5 µs/step
    tanker: "cbe039d9",
    // ships=20 inFlight=0 p.fired=6 p.hits=74 b.fired=157 b.hits=6316 contacts=81 bumps=2 crashes=8 severed=2 culled=1 scrap=11.7t · 759.9 µs/step
    beamCarrier: "007b7ee4",
    // ships=2 inFlight=0 p.fired=57 p.hits=211 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 29.3 µs/step
    passes: "5cf2fe2a",
    // ships=2 inFlight=0 p.fired=2 p.hits=17 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 39.9 µs/step
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
