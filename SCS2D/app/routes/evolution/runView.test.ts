import { expect, test } from "vitest";
import type { YardstickPoint } from "~/evolution/yardstick";
import { scoreSeries, type AnyRun } from "./runView";

/** A run of one generation scored as though nothing happened in any match: nobody hurt, nobody moved. */
function untouched(weights: Record<string, number> = {}): AnyRun {
    const mean = { survival: 1, functional: 1, damage: 0, disabling: 0, race: 0 };
    const total = (weights["survival"] ?? 1) + (weights["functional"] ?? 1);
    return {
        config: { match: { weights } },
        generations: [{ bestFitness: total, meanFitness: total, mean }],
    } as unknown as AnyRun;
}

const point = (mean: number): YardstickPoint =>
    ({ generation: 0, mean, best: mean, against: 0, wins: 0, individuals: 1 }) as YardstickPoint;

test("every score line is 0 where nothing happened", () => {
    for (const series of scoreSeries(untouched(), [point(2)])) expect(series.values[0], series.name).toBe(0);
});

test("the totals are offset by the run's own weights", () => {
    const run = untouched({ survival: 2, functional: 0.5 });
    for (const series of scoreSeries(run, [point(2.5)])) expect(series.values[0], series.name).toBe(0);
});

test("what was lost is drawn below 0", () => {
    const run = untouched();
    (run.generations[0] as unknown as { mean: { survival: number } }).mean.survival = 0.25;
    const hull = scoreSeries(run, undefined).find((series) => series.name === "hull lost")!;
    expect(hull.values[0]).toBe(-0.75);
});
