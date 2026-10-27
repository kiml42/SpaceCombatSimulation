import { describe, expect, it } from "vitest";
import { DINKY, GUNSHIP } from "../scenarios/blueprints.js";
import { runCoevolution } from "../evolution/coevolution.js";
import { runEvolution, type RunConfig } from "../evolution/run.js";
import { designOf, LiveRun, runLoop, sliced, type RunStart, type RunWire } from "../host/evolutionRun.js";

/** Small and short: what is under test is what crosses from the run to the page, not the fighting. */
const SETTINGS: Partial<RunConfig> = {
    seed: 7,
    generations: 3,
    population: 4,
    winners: 2,
    group: 1,
    minMatches: 2,
    fleet: { maxShips: 1 },
    match: { duration: 8, goal: null },
};
const ROUNDS = { hall: 2, phaseCap: 2 };

/** Fight a run as the worker does, each send through a structured clone as `postMessage` makes one, into the page's copy. */
function fought(start: RunStart): { live: LiveRun; sends: RunWire[] } {
    const live = new LiveRun(start.config, start.coevolution);
    const sends: RunWire[] = [];
    const step = runLoop(start, (wire) => {
        const copy = structuredClone(wire);
        sends.push(copy);
        live.apply(copy);
    });
    while (step()) {
        // Fighting.
    }
    return { live, sends };
}

describe("a run fought off the page", { timeout: 60_000 }, () => {
    it("is copied whole: the same record as the run fought here", () => {
        const { live, sends } = fought({ founders: [designOf(DINKY)], rivals: [], config: SETTINGS, coevolution: null });
        expect(live.done).toBe(true);
        expect(live.progress).toBe(1);
        expect(JSON.stringify(live.record())).toBe(JSON.stringify(runEvolution([DINKY], SETTINGS)));
        // Sent as it goes, the first time before anything is fought.
        expect(sends[0]!.generations).toEqual([]);
        expect(sends[0]!.living).toHaveLength(4);
        expect(sends.some((wire) => wire.played.length > 0 && !wire.done)).toBe(true);
    });

    it("copies a co-evolution run, both sides and their halls", () => {
        const { live } = fought({ founders: [designOf(DINKY)], rivals: [designOf(GUNSHIP)], config: SETTINGS, coevolution: ROUNDS });
        expect(JSON.stringify(live.record())).toBe(JSON.stringify(runCoevolution([DINKY], [GUNSHIP], SETTINGS, ROUNDS)));
        expect(live.alternates).toBe(true);
        expect(live.hall(1).length).toBeGreaterThan(0);
    });

    it("pauses between slices, and carries on where it left off", () => {
        const pending: (() => void)[] = [];
        const later = (tick: () => void): void => {
            pending.push(tick);
        };
        let slices = 0;
        const control = sliced(() => {
            slices++;
            return true;
        }, later);
        pending.shift()!();
        pending.shift()!();
        control.setPaused(true);
        pending.shift()!();
        expect(slices).toBe(2);
        expect(pending).toHaveLength(0);
        control.setPaused(false);
        pending.shift()!();
        expect(slices).toBe(3);
        control.stop();
        pending.shift()!();
        expect(slices).toBe(3);
    });
});
