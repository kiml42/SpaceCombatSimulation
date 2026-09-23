import { parseBlueprint, Rng, type Blueprint } from '../sim/index.js';
import { max } from '../sim/math.js';
import { runMatch, type MatchConfig } from './match.js';
import type { GenerationRecord, RunRecord } from './run.js';

/**
 * Measuring a run against something that does not evolve.
 *
 * **A run cannot tell improvement from a red queen on its own.** Fitness is
 * scored against the rest of the generation, so a rising mean says the
 * population beat itself and a flat one says nothing at all — a fleet getting
 * uniformly worse looks exactly like one getting uniformly better. The fix is
 * a fixed opponent: fight every design against the same ship under the same
 * conditions, and the number means the same thing in generation one and
 * generation four hundred.
 *
 * **Measured afterwards, never during.** Two reasons, and the second is the
 * better one. It must not reach selection — a run that bred against its
 * yardstick would learn to beat that one ship, which is DESIGN.md §7's
 * "evolve against a distribution, not a point" and produces a design that is
 * excellent against the yardstick and poor against everything else. And a run
 * record already holds every design it ever bred, so the measurement can be
 * taken again with a different opponent whenever the question changes: a run
 * measured against the ship it started from says how far it has come, and the
 * same run measured against *its own final champion* says how bad things used
 * to be — which is a question worth asking of a run that started from
 * nothing, where the founder is no yardstick at all.
 */

export interface YardstickConfig {
  /** Fought one against one, so what happened is the design and not the crowd. */
  readonly match: Partial<MatchConfig>;
  /**
   * Where the paired seeds start.
   *
   * Every generation is measured under *identical* starting conditions —
   * individual three of every generation fights the same battle as individual
   * three of every other — so the difference between two generations is the
   * designs and nothing else. Sampling fresh seeds each time would measure the
   * designs and the draw together, and the draw is the louder of the two.
   */
  readonly seed: number;
}

export const DEFAULT_YARDSTICK: YardstickConfig = {
  match: {},
  seed: 0x5EED,
};

/** How one generation did against the fixed opponent. */
export interface YardstickPoint {
  readonly generation: number;
  /** Mean score of the generation's designs against it. */
  readonly mean: number;
  /** The best of them. */
  readonly best: number;
  /** What the opponent scored against them, averaged — the other side of it. */
  readonly against: number;
  /** How many of the generation beat it outright. */
  readonly wins: number;
  readonly individuals: number;
}

export interface YardstickReport {
  readonly points: readonly YardstickPoint[];
  readonly matches: number;
}

/**
 * Fight every design of every generation against one fixed opponent.
 *
 * The opponent takes the second slot in every match, so the geometry it is
 * given is the same for all of them; with the seeds paired as well, two
 * generations differ by their designs alone.
 */
export function measure(
  run: RunRecord,
  benchmark: Blueprint,
  config?: Partial<YardstickConfig>,
): YardstickReport {
  const settings: YardstickConfig = { ...DEFAULT_YARDSTICK, ...config };
  const match = { ...run.config.match, ...settings.match };
  const seeds = pairedSeeds(settings.seed, longest(run));

  const points: YardstickPoint[] = [];
  let matches = 0;
  for (const generation of run.generations) {
    let total = 0;
    let best = -Infinity;
    let against = 0;
    let wins = 0;
    for (const [slot, individual] of generation.individuals.entries()) {
      const result = runMatch([parseBlueprint(individual.blueprint), benchmark], {
        ...match,
        seed: seeds[slot]!,
      });
      matches++;
      const mine = result.scores[0]!.total;
      const theirs = result.scores[1]!.total;
      total += mine;
      best = max(best, mine);
      against += theirs;
      if (mine > theirs) wins++;
    }
    const count = generation.individuals.length;
    points.push({
      generation: generation.index,
      mean: count > 0 ? total / count : 0,
      best: count > 0 ? best : 0,
      against: count > 0 ? against / count : 0,
      wins,
      individuals: count,
    });
  }
  return { points, matches };
}

/**
 * The design a run ended up with, for measuring its own past against.
 *
 * The *last* generation's best rather than the best ever scored: what a run
 * arrived at is the thing worth asking earlier generations to beat, and the
 * highest fitness it ever recorded may belong to a design three hundred
 * generations ago that got lucky in one group.
 */
export function latest(run: RunRecord): Blueprint | null {
  const generation = run.generations[run.generations.length - 1];
  if (generation === undefined || generation.individuals.length === 0) return null;
  let best = generation.individuals[0]!;
  for (const individual of generation.individuals) {
    if (individual.fitness > best.fitness) best = individual;
  }
  return parseBlueprint(best.blueprint);
}

function longest(run: RunRecord): number {
  let most = 0;
  for (const generation of run.generations) most = max(most, generation.individuals.length);
  return most;
}

/** One seed per slot, drawn once and reused by every generation. */
function pairedSeeds(seed: number, count: number): number[] {
  const rng = new Rng(seed);
  const seeds: number[] = [];
  for (let i = 0; i < count; i++) seeds.push(rng.nextUint32());
  return seeds;
}

/** Whether a run got better at beating the thing it was measured against. */
export function trend(report: YardstickReport): { first: number; last: number; gain: number } {
  const points = report.points;
  const first = points[0]?.mean ?? 0;
  const last = points[points.length - 1]?.mean ?? 0;
  return { first, last, gain: last - first };
}

/** A generation record's individuals, for a caller that wants the designs. */
export function designsOf(generation: GenerationRecord): Blueprint[] {
  return generation.individuals.map((individual) => parseBlueprint(individual.blueprint));
}
