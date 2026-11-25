import { describe, expect, it } from "vitest";
import { CORVETTE, DINKY } from "../scenarios/blueprints.js";
import { Run, runEvolution, type RunRecord } from "../evolution/run.js";

const settings = { seed: 5, population: 4, winners: 2, group: 2, minMatches: 1, generations: 3, match: { duration: 15 } };

/** A record as a file gives it back. */
const throughFile = (record: RunRecord): RunRecord => JSON.parse(JSON.stringify(record)) as RunRecord;

/** The generations of a record, as written. */
const written = (record: RunRecord): string => JSON.stringify(record.generations);

describe("a resumed run", { timeout: 120_000 }, () => {
    it("carries on to the same run as one that never stopped", () => {
        const whole = runEvolution([CORVETTE, DINKY], settings);
        // Stopped part way through its second generation.
        const first = new Run([CORVETTE, DINKY], settings);
        while (first.record().generations.length < 1) first.advance(500);
        first.advance(500);
        const resumed = Run.resume(throughFile(first.record())).finish();
        expect(written(resumed)).toEqual(written(whole));
    });

    it("runs on past where it was set to stop, if asked, as one set to go on longer would", () => {
        const whole = runEvolution([CORVETTE], { ...settings, generations: 2 });
        const short = runEvolution([CORVETTE], { ...settings, generations: 1 });
        const longer = Run.resume(throughFile(short), 2).finish();
        expect(longer.config.generations).toBe(2);
        expect(written(longer)).toEqual(written(whole));
        // Nothing more to fight, finished as it was.
        expect(written(Run.resume(throughFile(short)).finish())).toEqual(written(short));
    });

    it("refuses a run written before runs could be resumed", () => {
        const { resume: _resume, ...old } = runEvolution([CORVETTE], { ...settings, generations: 1 });
        expect(() => Run.resume(old)).toThrow(/before/);
    });
});
