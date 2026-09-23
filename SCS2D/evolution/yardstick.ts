import { parseBlueprint, Rng, type Blueprint } from '../sim/index.js';
import { max } from '../sim/math.js';
import { Match, type MatchConfig } from './match.js';
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
 * A measurement in progress: the matches still to fight, and the points so
 * far.
 *
 * Stepped rather than run, for the reason `Match` and `Run` are: a
 * measurement is one match per design per generation, which is minutes of
 * simulation on a long run, and a page cannot go away for that long.
 */
export class Yardstick {
  readonly points: YardstickPoint[] = [];
  private readonly settings: YardstickConfig;
  private readonly match: Partial<MatchConfig>;
  private readonly seeds: number[] = [];
  /** Kept, so a slot beyond what the run had when this started can be given one. */
  private readonly draw: Rng;
  private generation = 0;
  private slot = 0;
  private fighting: Match | null = null;
  private total = 0;
  private best = -Infinity;
  private against = 0;
  private wins = 0;
  matches = 0;

  constructor(
    private readonly run: RunRecord,
    private readonly benchmark: Blueprint,
    config?: Partial<YardstickConfig>,
  ) {
    this.settings = { ...DEFAULT_YARDSTICK, ...config };
    this.match = { ...run.config.match, ...this.settings.match };
    this.draw = new Rng(this.settings.seed);
    this.seedFor(longest(run) - 1);
  }

  /**
   * The seed for one slot, drawn once and then reused by every generation.
   *
   * Drawn on demand rather than counted up front because a measurement can be
   * started while a run is still going, and a later generation may be wider
   * than anything it had closed at the time. The order is the same either way,
   * so a measurement taken during a run and one taken after it agree.
   */
  private seedFor(slot: number): number {
    while (this.seeds.length <= slot) this.seeds.push(this.draw.nextUint32());
    return this.seeds[slot]!;
  }

  get done(): boolean {
    return this.generation >= this.run.generations.length;
  }

  /** How far through, from nothing to one. */
  get progress(): number {
    const total = this.run.generations.length;
    if (total === 0) return 1;
    if (this.done) return 1;
    const here = this.run.generations[this.generation]?.individuals.length ?? 1;
    const within = here > 0 ? this.slot / here : 1;
    return (this.generation + within) / total;
  }

  /** Fight up to `budget` simulation steps of it. */
  advance(budget: number): boolean {
    let left = max(1, budget);
    while (left > 0 && !this.done) {
      if (this.fighting === null) {
        this.open();
        continue;
      }
      while (left > 0 && !this.fighting.done) {
        this.fighting.advance();
        left--;
      }
      if (this.fighting.done) this.close();
    }
    return !this.done;
  }

  finish(): YardstickReport {
    while (!this.done) this.advance(1 << 20);
    return this.report();
  }

  report(): YardstickReport {
    return { points: this.points, matches: this.matches };
  }

  /** Draw the next match, or close the generation when it has had them all. */
  private open(): void {
    const generation = this.run.generations[this.generation];
    if (generation === undefined) return;
    if (this.slot >= generation.individuals.length) {
      this.roll(generation);
      return;
    }
    const individual = generation.individuals[this.slot]!;
    this.fighting = new Match([parseBlueprint(individual.blueprint), this.benchmark], {
      ...this.match,
      seed: this.seedFor(this.slot),
    });
  }

  private close(): void {
    const result = this.fighting!.result();
    this.fighting = null;
    this.matches++;
    this.slot++;
    const mine = result.scores[0]!.total;
    const theirs = result.scores[1]!.total;
    this.total += mine;
    this.best = max(this.best, mine);
    this.against += theirs;
    if (mine > theirs) this.wins++;
  }

  private roll(generation: GenerationRecord): void {
    const count = generation.individuals.length;
    this.points.push({
      generation: generation.index,
      mean: count > 0 ? this.total / count : 0,
      best: count > 0 ? this.best : 0,
      against: count > 0 ? this.against / count : 0,
      wins: this.wins,
      individuals: count,
    });
    this.total = 0;
    this.best = -Infinity;
    this.against = 0;
    this.wins = 0;
    this.slot = 0;
    this.generation++;
  }
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
  return new Yardstick(run, benchmark, config).finish();
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
