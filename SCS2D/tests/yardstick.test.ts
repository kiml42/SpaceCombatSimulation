import { describe, expect, it } from 'vitest';
import { parseBlueprint, serialiseBlueprint } from '../sim/index.js';
import { runEvolution } from '../evolution/run.js';
import { latest, measure, trend, Yardstick } from '../evolution/yardstick.js';
import { CORVETTE, DINKY, GUNSHIP } from '../scenarios/blueprints.js';

/**
 * Measuring a run against something that does not evolve.
 *
 * The property that matters is comparability: the same design measured in two
 * different generations must get the same answer, or the line means nothing.
 * Everything else here follows from that.
 */

const settings = {
  seed: 3,
  population: 5,
  winners: 2,
  group: 3,
  minMatches: 2,
  generations: 3,
  match: { duration: 30 },
};

/**
 * Per-test budget, milliseconds.
 *
 * Every test here breeds a run and then fights every design in it, which is
 * seconds of simulation rather than the milliseconds vitest's default is set
 * for — and the cost moves whenever gunnery or the pilot does, since what it
 * measures is battles. Wide rather than tuned: it is a backstop against a
 * hang, not an assertion about speed, and a budget set just above today's
 * cost is one that goes red on a slow runner for no reason anybody can act
 * on.
 */
const BUDGET = 60_000;

describe('the yardstick', { timeout: BUDGET }, () => {
  it('measures every generation against the same opponent', () => {
    const run = runEvolution([CORVETTE], settings);
    const report = measure(run, GUNSHIP, { match: { duration: 30 } });
    expect(report.points.length).toEqual(run.generations.length);
    expect(report.matches).toEqual(run.generations.length * settings.population);
    for (const [i, point] of report.points.entries()) {
      expect(point.generation).toEqual(run.generations[i]!.index);
      expect(point.individuals).toEqual(settings.population);
      expect(point.wins).toBeLessThanOrEqual(point.individuals);
      expect(point.best).toBeGreaterThanOrEqual(point.mean);
    }
  });

  it('measures the same run twice the same way', () => {
    const run = runEvolution([CORVETTE], settings);
    const one = measure(run, GUNSHIP, { match: { duration: 30 } });
    const two = measure(run, GUNSHIP, { match: { duration: 30 } });
    expect(JSON.stringify(one)).toEqual(JSON.stringify(two));
  });

  it('gives one design the same battle whichever generation it is in', () => {
    // The seeds are paired by slot rather than drawn fresh, so two
    // generations differ by their designs and by nothing else. Without this a
    // yardstick measures the designs and the draw together, and the draw is
    // the louder of the two.
    const run = runEvolution([CORVETTE], settings);
    const twin = {
      config: run.config,
      generations: run.generations.map((generation) => ({
        ...generation,
        // Every generation made of the same design: any difference between
        // the points that come back can then only be the seeds.
        individuals: generation.individuals.map((individual) => ({
          ...individual,
          blueprint: serialiseBlueprint(CORVETTE),
        })),
      })),
    };
    const report = measure(twin, GUNSHIP, { match: { duration: 30 } });
    const first = report.points[0]!;
    for (const point of report.points) {
      expect(point.mean).toBeCloseTo(first.mean, 10);
      expect(point.wins).toEqual(first.wins);
    }
  });

  it('says a population beats a fighter more often than a capital', () => {
    // The plainest check that the number tracks something real: the same
    // designs, measured against a harder opponent, do worse.
    const run = runEvolution([CORVETTE], settings);
    const easy = measure(run, DINKY, { match: { duration: 30 } });
    const hard = measure(run, GUNSHIP, { match: { duration: 30 } });
    const wins = (report: typeof easy): number =>
      report.points.reduce((total, point) => total + point.wins, 0);
    expect(wins(easy)).toBeGreaterThan(wins(hard));
  });

  it('takes the last generation’s best as what a run arrived at', () => {
    // Pinning a run against its own final design is how a run started from
    // nothing gets a yardstick at all: the founder is no measure of anything
    // when the founder cannot fly.
    const run = runEvolution([CORVETTE], settings);
    const arrived = latest(run)!;
    const last = run.generations[run.generations.length - 1]!;
    let best = last.individuals[0]!;
    for (const individual of last.individuals) {
      if (individual.fitness > best.fitness) best = individual;
    }
    expect(serialiseBlueprint(arrived)).toEqual(serialiseBlueprint(parseBlueprint(best.blueprint)));
  });

  it('reports which way a run went', () => {
    const run = runEvolution([CORVETTE], settings);
    const report = measure(run, GUNSHIP, { match: { duration: 30 } });
    const moved = trend(report);
    expect(moved.first).toEqual(report.points[0]!.mean);
    expect(moved.last).toEqual(report.points[report.points.length - 1]!.mean);
    expect(moved.gain).toBeCloseTo(moved.last - moved.first, 10);
  });

  it('measures the same in slices as it does in one go', () => {
    // The page steps a measurement a few thousand simulation steps at a time
    // so it can draw between them; if that diverged from the headless run,
    // the line on the chart would not be the measurement the report holds.
    const run = runEvolution([CORVETTE], { generations: 2, population: 4, group: 2, minMatches: 1, match: { duration: 20 } });
    const whole = measure(run, DINKY);
    const stepped = new Yardstick(run, DINKY);
    let slices = 0;
    while (stepped.advance(101)) slices++;
    expect(slices).toBeGreaterThan(5);
    expect(JSON.stringify(stepped.report())).toEqual(JSON.stringify(whole));
  });

});
