import { describe, expect, it } from "vitest";
import { DINKY, GUNSHIP } from "../scenarios/blueprints.js";
import { runCoevolution } from "../evolution/coevolution.js";
import { parseRunRecord, RecordedRun, winsIn } from "../evolution/recorded.js";
import { runEvolution, type MatchRecord, type RunConfig, type RunRecord } from "../evolution/run.js";

const SETTINGS: Partial<RunConfig> = {
    seed: 3,
    generations: 2,
    population: 4,
    winners: 2,
    group: 2,
    minMatches: 1,
    fleet: { maxShips: 1 },
    match: { duration: 8, goal: null },
};

/** As the file `pnpm evolve` writes, read back. */
const throughFile = (record: RunRecord): RunRecord => parseRunRecord(JSON.parse(JSON.stringify(record)));

describe("a run read back from its file", { timeout: 60_000 }, () => {
    it("shows a run of one as the run it was, finished", () => {
        const record = runEvolution([DINKY], SETTINGS);
        const opened = new RecordedRun(throughFile(record));
        expect(opened.done).toBe(true);
        expect(opened.progress).toBe(1);
        expect(opened.coevolution).toBeNull();
        expect(opened.record()).toEqual(JSON.parse(JSON.stringify(record)));
    });

    it("says a run stopped early is part of what it was set to fight", () => {
        const record = runEvolution([DINKY], SETTINGS);
        const stopped = { ...record, config: { ...record.config, generations: 8 } };
        expect(new RecordedRun(stopped).progress).toBe(0.25);
    });

    it("keeps both sides of a co-evolution run, and each side's founders as its hall", () => {
        const record = runCoevolution([DINKY], [GUNSHIP], { ...SETTINGS, generations: 3, group: 1 }, { hall: 2, phaseCap: 1 });
        const opened = new RecordedRun(throughFile(record));
        expect(opened.coevolution).not.toBeNull();
        expect(opened.alternates).toBe(true);
        expect(opened.record()).toEqual(JSON.parse(JSON.stringify(record)));
        expect(opened.hall(1).map((champion) => champion.entrant.name)).toEqual(["Gunship"]);
        // Three generations, A, B and A again.
        expect(opened.turn).toBe(0);
        expect(opened.round).toBe(2);
    });

    it("refuses a file that is not a run", () => {
        expect(() => parseRunRecord({ founders: [], seed: 1 })).toThrow(/not a run file/);
        expect(() => parseRunRecord({ config: {}, generations: [{ index: 0, individuals: [{ id: 0 }], matches: [] }] })).toThrow(
            /records no design/,
        );
    });
});

describe("counting wins", () => {
    const match = (competitors: number[], winners: number[], extra: Partial<MatchRecord> = {}): MatchRecord => ({
        seed: 1,
        competitors,
        ending: winners.length > 0 ? "decided" : "timeout",
        winners,
        elapsed: 1,
        scores: [],
        ...extra,
    });

    it("credits whoever was left fighting, and everyone with what they fought", () => {
        const wins = winsIn([match([0, 1], [1]), match([1, 2], []), match([0, 2], [0])]);
        expect(wins.get(0)).toEqual({ won: 1, fought: 2 });
        expect(wins.get(1)).toEqual({ won: 1, fought: 2 });
        expect(wins.get(2)).toEqual({ won: 0, fought: 2 });
    });

    it("credits a whole side with its win, and leaves drills and bare cores out", () => {
        const wins = winsIn([match([0, 1, 5], [2], { teams: [0, 0, 1] }), match([0, 1, -1], [0], { teams: [0, 0, 1], drill: "bareCore" })]);
        expect(wins.get(0)).toEqual({ won: 0, fought: 1 });
        expect(wins.get(5)).toEqual({ won: 1, fought: 1 });
        expect(wins.has(-1)).toBe(false);
    });
});
