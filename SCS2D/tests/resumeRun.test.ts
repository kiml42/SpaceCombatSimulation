import { describe, expect, it } from "vitest";
import { CORVETTE, DINKY } from "../scenarios/blueprints.js";
import { Run, runEvolution, type RunRecord } from "../evolution/run.js";
import { decodeExact, encodeExact } from "../evolution/exactJson.js";

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

    it("carries on from the file as it is written at the end of each generation", () => {
        const whole = runEvolution([CORVETTE, DINKY], settings);
        // What `pnpm evolve` writes as the first generation closes, and nothing after: as if killed then.
        let onDisk: RunRecord | null = null;
        const first: Run = new Run([CORVETTE, DINKY], settings, () => {
            onDisk ??= throughFile(first.record());
        });
        while (onDisk === null) first.advance(500);
        const resumed = Run.resume(onDisk).finish();
        expect(resumed.generations.map((g) => g.index)).toEqual([0, 1, 2]);
        expect(written(resumed)).toEqual(written(whole));
    });

    it("refuses a run with nothing to carry on from", () => {
        const { resume: _resume, ...old } = runEvolution([CORVETTE], { ...settings, generations: 1 });
        expect(() => Run.resume(old)).toThrow(/pnpm evolve/);
    });
});

describe("exact JSON", () => {
    it("brings back infinities and minus zero", () => {
        const value = { a: Infinity, b: -Infinity, c: -0, d: [1.5, -0], e: "x" };
        const back = decodeExact(JSON.parse(JSON.stringify(encodeExact(value)))) as typeof value;
        expect(back.a).toBe(Infinity);
        expect(back.b).toBe(-Infinity);
        expect(Object.is(back.c, -0)).toBe(true);
        expect(Object.is(back.d[1], -0)).toBe(true);
        expect(back.e).toBe("x");
    });
});
