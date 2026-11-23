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
    // ships=8 inFlight=3 p.fired=103 p.hits=189 b.fired=0 b.hits=0 contacts=17 bumps=0 crashes=4 severed=5 culled=0 scrap=85.5t · 269.2 µs/step
    duel: "624049af",
    // ships=4 inFlight=1 p.fired=64 p.hits=106 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=70.4t · 112.5 µs/step
    railDuel: "efdb512b",
    // ships=3 inFlight=11 p.fired=145 p.hits=212 b.fired=2 b.hits=241 contacts=241 bumps=0 crashes=0 severed=2 culled=0 scrap=126.6t · 160.7 µs/step
    lanceDuel: "3c1924d3",
    // ships=7 inFlight=0 p.fired=0 p.hits=24 b.fired=36 b.hits=3589 contacts=4 bumps=1 crashes=1 severed=4 culled=0 scrap=68.6t · 120.5 µs/step
    beamDuel: "91484305",
    // ships=2 inFlight=21 p.fired=41 p.hits=78 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=8.8t · 65.2 µs/step
    binary: "b7a6ee77",
    // ships=4 inFlight=0 p.fired=167 p.hits=479 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=37.5t · 62.0 µs/step
    kernels: "43686aca",
    // ships=12 inFlight=0 p.fired=164 p.hits=277 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=80.5t · 53.4 µs/step
    asteroidField: "5731f17e",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=2 bumps=2 crashes=0 severed=0 culled=0 scrap=-25.1t · 38.6 µs/step
    mining: "0095f392",
    // ships=12 inFlight=0 p.fired=240 p.hits=677 b.fired=0 b.hits=0 contacts=228 bumps=2 crashes=2 severed=1 culled=1 scrap=58.8t · 535.4 µs/step
    rivalMines: "899eaeaa",
    // ships=22 inFlight=25 p.fired=82 p.hits=40 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.7t · 454.6 µs/step
    swarm: "a348d72f",
    // ships=303 inFlight=107 p.fired=503 p.hits=609 b.fired=0 b.hits=0 contacts=46 bumps=0 crashes=9 severed=5 culled=4 scrap=23.5t · 15044.8 µs/step
    superSwarm: "fd206577",
    // ships=9 inFlight=0 p.fired=0 p.hits=62 b.fired=5 b.hits=797 contacts=202 bumps=1 crashes=4 severed=2 culled=0 scrap=33.1t · 83.9 µs/step
    torpedoes: "7f76a9ef",
    // ships=3 inFlight=0 p.fired=2 p.hits=94 b.fired=0 b.hits=0 contacts=12 bumps=0 crashes=2 severed=0 culled=0 scrap=72.6t · 63.5 µs/step
    torpedoesGunPlatform: "8cd9d223",
    // ships=7 inFlight=0 p.fired=0 p.hits=203 b.fired=5 b.hits=41 contacts=316 bumps=2 crashes=1 severed=2 culled=0 scrap=22.7t · 120.0 µs/step
    torpedoesWarhead: "fc568969",
    // ships=8 inFlight=0 p.fired=0 p.hits=131 b.fired=6 b.hits=72 contacts=6 bumps=0 crashes=2 severed=0 culled=0 scrap=18.9t · 98.4 µs/step
    torpedoesShaped: "d42a8985",
    // ships=6 inFlight=0 p.fired=27 p.hits=133 b.fired=0 b.hits=0 contacts=38 bumps=0 crashes=1 severed=0 culled=0 scrap=18.4t · 139.3 µs/step
    torpedoBoatTorpedoes: "598fdde0",
    // ships=5 inFlight=12 p.fired=134 p.hits=221 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=1 culled=0 scrap=21.3t · 77.4 µs/step
    disarm: "54a930fd",
    // ships=3 inFlight=0 p.fired=46 p.hits=40 b.fired=37 b.hits=1945 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=50.0t · 75.0 µs/step
    disarmBeams: "71f83101",
    // ships=3 inFlight=0 p.fired=96 p.hits=171 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=26.8t · 57.4 µs/step
    disarmRails: "eae9035b",
    // ships=2 inFlight=32 p.fired=57 p.hits=119 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=1.1t · 80.1 µs/step
    ordering: "589a4848",
    // ships=10 inFlight=0 p.fired=111 p.hits=236 b.fired=22 b.hits=1728 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=78.0t · 208.1 µs/step
    standoff: "56785fc5",
    // ships=17 inFlight=9 p.fired=199 p.hits=434 b.fired=18 b.hits=1443 contacts=1053 bumps=13 crashes=1 severed=20 culled=1 scrap=353.8t · 179.2 µs/step
    column: "e87e5494",
    // ships=3 inFlight=0 p.fired=10 p.hits=34 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=34.1t · 104.6 µs/step
    split: "d619a057",
    // ships=20 inFlight=2 p.fired=0 p.hits=10 b.fired=0 b.hits=0 contacts=25 bumps=0 crashes=3 severed=0 culled=0 scrap=74353.0t · 1659.8 µs/step
    crash: "fc1077cd",
    // ships=7 inFlight=0 p.fired=0 p.hits=0 b.fired=8 b.hits=2163 contacts=74 bumps=2 crashes=1 severed=2 culled=0 scrap=36.1t · 189.8 µs/step
    torchRun: "8e228649",
    // ships=4 inFlight=62 p.fired=131 p.hits=454 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=1 culled=0 scrap=25.0t · 131.6 µs/step
    hooked: "0c6f5e28",
    // ships=2 inFlight=0 p.fired=45 p.hits=213 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=6.6t · 49.3 µs/step
    broadside: "f9af487b",
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
    // ships=5 inFlight=0 p.fired=83 p.hits=78 b.fired=0 b.hits=0 contacts=38 bumps=0 crashes=0 severed=0 culled=0 scrap=1.7t · 63.9 µs/step
    factory: "4dc6203d",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=1 bumps=0 crashes=0 severed=1 culled=0 scrap=33.5t · 134.4 µs/step
    shipyard: "3a5a0509",
    // ships=5 inFlight=4 p.fired=36 p.hits=40 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=0.2t · 81.1 µs/step
    rearm: "68d367c7",
    // ships=3 inFlight=0 p.fired=0 p.hits=0 b.fired=0 b.hits=0 contacts=4 bumps=2 crashes=0 severed=2 culled=0 scrap=0.1t · 85.5 µs/step
    tanker: "cbe039d9",
    // ships=20 inFlight=0 p.fired=103 p.hits=280 b.fired=169 b.hits=6705 contacts=121 bumps=2 crashes=8 severed=1 culled=0 scrap=9.8t · 475.9 µs/step
    beamCarrier: "b37f1e77",
    // ships=2 inFlight=0 p.fired=58 p.hits=129 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 26.8 µs/step
    passes: "6dff6c7d",
    // ships=2 inFlight=0 p.fired=2 p.hits=2 b.fired=0 b.hits=0 contacts=0 bumps=0 crashes=0 severed=0 culled=0 scrap=9.3t · 34.6 µs/step
    circling: "2d052a4f",
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
