import { Rng, serialiseBlueprint, type Blueprint } from '../sim/index.js';
import { compileBlueprint } from '../sim/index.js';
import { max, min } from '../sim/math.js';
import { Match, type MatchConfig, type MatchResult } from './match.js';
import { mutate, type MutationLimits } from './mutate.js';
import { blank, breed, fitness, Generation, type Individual } from './generation.js';

/**
 * A run: generations of designs, each fought in groups and bred from what
 * survived.
 *
 * **Everything in here is decided by the seed.** A run is a long chain of
 * chances — who fights whom, what a mutation does, where a round lands — and
 * every one of them comes off a single generator threaded through this file,
 * so a run is worth recording as a config and a number rather than as a
 * transcript, and a match out of it can be watched afterwards by fighting it
 * again.
 */

export interface RunConfig {
  readonly seed: number;
  /** Designs under test at once. */
  readonly population: number;
  /** How many are bred from at the end of a generation. */
  readonly winners: number;
  /** Designs in one match. */
  readonly group: number;
  /** Matches every design plays before the generation is called. */
  readonly minMatches: number;
  readonly generations: number;
  /**
   * Dry mass a design may not exceed, kg, or Infinity for none.
   *
   * A budget is what stops a run answering "how do I win a fight" with "be
   * bigger than the other one" — which is true, uninteresting, and the first
   * thing an unbounded search finds. Denominated in mass because that is what
   * a ship costs (DESIGN.md §2).
   */
  readonly massBudget: number;
  readonly mutation: Partial<MutationLimits>;
  readonly match: Partial<MatchConfig>;
}

export const DEFAULT_RUN: RunConfig = {
  seed: 1,
  population: 12,
  winners: 4,
  group: 4,
  minMatches: 3,
  generations: 10,
  massBudget: Infinity,
  mutation: {},
  match: {},
};

/** What one design was worth, as a run records it. */
export interface IndividualRecord {
  readonly id: number;
  readonly parent: number;
  readonly edits: readonly string[];
  readonly matches: number;
  readonly fitness: number;
  readonly survival: number;
  readonly damage: number;
  readonly race: number;
  /** Dry mass, kg — what the design cost. */
  readonly mass: number;
  /** The design itself, so a run can be read without the ships it started from. */
  readonly blueprint: Record<string, unknown>;
}

/** One match, and enough to fight it again. */
export interface MatchRecord {
  readonly seed: number;
  readonly competitors: readonly number[];
  readonly ending: MatchResult['ending'];
  readonly elapsed: number;
  readonly scores: MatchResult['scores'];
}

export interface GenerationRecord {
  readonly index: number;
  readonly individuals: readonly IndividualRecord[];
  readonly matches: readonly MatchRecord[];
  /** Mean and best fitness, which is what a run is read by. */
  readonly meanFitness: number;
  readonly bestFitness: number;
  /**
   * Each part of the score on its own, across the generation.
   *
   * Kept apart rather than only as the total they add up to, because they
   * answer different questions and move at different times. A population
   * learning to fly reaches the goal long before it learns to shoot, and a
   * total hides that behind one rising line — where three lines say which of
   * the three things a run is actually getting better at, and which weight is
   * doing the work.
   */
  readonly mean: ScoreParts;
  readonly best: ScoreParts;
}

/** The three sources of score, apart. */
export interface ScoreParts {
  readonly survival: number;
  readonly damage: number;
  readonly race: number;
}

export interface RunRecord {
  readonly config: RunConfig;
  readonly generations: readonly GenerationRecord[];
}

/** Told as each generation finishes, so a caller can show progress. */
export type OnGeneration = (record: GenerationRecord) => void;

/**
 * Fill a population from the designs a run was started with.
 *
 * The founders go in as they are and the rest of the population is mutants of
 * them, taken in turn — so a run started from one ship is that ship and a
 * spread around it, and one started from several begins with the comparison
 * already in it.
 */
export function seedPopulation(
  founders: readonly Blueprint[],
  rng: Rng,
  config: RunConfig,
): Generation {
  const individuals: Individual[] = [];
  let id = 0;
  for (const founder of founders) {
    if (individuals.length >= config.population) break;
    individuals.push(blank(id++, founder, -1, []));
  }
  let parent = 0;
  while (individuals.length < config.population && founders.length > 0) {
    const source = individuals[parent % founders.length]!;
    parent++;
    const child = mutate(source.blueprint, rng, mutationLimits(config));
    individuals.push(blank(id++, child.blueprint, source.id, child.edits));
  }
  return new Generation(0, individuals);
}

function mutationLimits(config: RunConfig): Partial<MutationLimits> {
  return { massBudget: config.massBudget, ...config.mutation };
}

/**
 * A run in progress: the generation being fought, and the record so far.
 *
 * **Stepped rather than run, for the same reason a match is.** A run is
 * minutes of simulation and a page cannot go away for that long, so the work
 * is handed out in slices small enough to draw between — and because the
 * slices drive the same objects the headless runner drives, what a page shows
 * is the run that is being recorded rather than a second one alongside it.
 */
export class Run {
  readonly config: RunConfig;
  readonly generations: GenerationRecord[] = [];
  private readonly onGeneration: OnGeneration | undefined;
  private readonly rng: Rng;
  /**
   * A cap on a loop that is otherwise governed by a draw: a population smaller
   * than a group, or a group of one, would never settle.
   */
  private readonly limit: number;
  private generation: Generation;
  private nextId: number;
  private matches: MatchRecord[] = [];
  private match: Match | null = null;
  private competitors: number[] = [];
  private seed = 0;
  private over = false;

  constructor(
    founders: readonly Blueprint[],
    config?: Partial<RunConfig>,
    onGeneration?: OnGeneration,
  ) {
    const settings: RunConfig = { ...DEFAULT_RUN, ...config };
    this.config = settings;
    this.onGeneration = onGeneration;
    this.rng = new Rng(settings.seed);
    this.generation = seedPopulation(founders, this.rng, settings);
    this.nextId = this.generation.individuals.length;
    this.limit = settings.population * settings.minMatches * 4 + 16;
    if (settings.generations <= 0) this.over = true;
  }

  get done(): boolean {
    return this.over;
  }

  /** The match being fought, for watching one as it happens. */
  get current(): Match | null {
    return this.match;
  }

  /** Which individuals, by index into the generation, are in that match. */
  get fighting(): readonly number[] {
    return this.match === null ? [] : this.competitors;
  }

  /** The generation under test, finished or not. */
  get living(): Generation {
    return this.generation;
  }

  /** Matches fought in it so far, which its record will hold once it closes. */
  get played(): readonly MatchRecord[] {
    return this.matches;
  }

  /** How far through the whole run, from nothing to one. */
  get progress(): number {
    const settings = this.config;
    if (this.over) return 1;
    const individuals = this.generation.individuals;
    let heard = 0;
    for (const individual of individuals) heard += min(individual.matches, settings.minMatches);
    const wanted = individuals.length * settings.minMatches;
    const within = wanted > 0 ? heard / wanted : 1;
    return (this.generations.length + within) / settings.generations;
  }

  /**
   * Fight up to `budget` simulation steps of it.
   *
   * Counted in steps rather than matches so that a slice costs about the same
   * whatever is in it: a match between capitals is many times the work of one
   * between fighters, and a caller trying to hold a frame rate needs the unit
   * it is budgeting to mean something.
   */
  advance(budget: number): boolean {
    let left = max(1, budget);
    while (left > 0 && !this.over) {
      if (this.match === null) {
        this.open();
        continue;
      }
      while (left > 0 && !this.match.done) {
        this.match.advance();
        left--;
      }
      if (this.match.done) this.close();
    }
    return !this.over;
  }

  /** Fight the rest of it, and hand back the record. */
  finish(): RunRecord {
    while (!this.over) this.advance(1 << 20);
    return this.record();
  }

  record(): RunRecord {
    return { config: this.config, generations: this.generations };
  }

  /** Draw the next match, or close the generation if it has had enough. */
  private open(): void {
    const settings = this.config;
    if (this.generation.settled(settings.minMatches) || this.matches.length >= this.limit) {
      this.roll();
      return;
    }
    const competitors = this.generation.pickCompetitors(this.rng, settings.group);
    if (competitors.length < 2) {
      this.roll();
      return;
    }
    this.competitors = competitors;
    this.seed = this.rng.nextUint32();
    this.match = new Match(
      competitors.map((c) => this.generation.individuals[c]!.blueprint),
      { ...settings.match, seed: this.seed },
    );
  }

  private close(): void {
    const result = this.match!.result();
    this.generation.record(this.competitors, result);
    this.matches.push({
      seed: this.seed,
      competitors: this.competitors.map((c) => this.generation.individuals[c]!.id),
      ending: result.ending,
      elapsed: result.elapsed,
      scores: result.scores,
    });
    this.match = null;
  }

  private roll(): void {
    const settings = this.config;
    const record = describe(this.generation, this.matches);
    this.generations.push(record);
    this.onGeneration?.(record);
    this.matches = [];
    if (this.generations.length >= settings.generations) {
      this.over = true;
      return;
    }
    this.generation = breed(
      this.generation,
      this.rng,
      {
        population: settings.population,
        winners: settings.winners,
        limits: mutationLimits(settings),
      },
      () => this.nextId++,
    );
  }
}

/**
 * Fight a whole run and record it.
 *
 * Matches are drawn until every design has had its hearing, so a generation is
 * as many matches as it takes rather than a fixed number — which is what makes
 * `minMatches` mean what it says on a population that does not divide by the
 * group size.
 */
export function runEvolution(
  founders: readonly Blueprint[],
  config?: Partial<RunConfig>,
  onGeneration?: OnGeneration,
): RunRecord {
  return new Run(founders, config, onGeneration).finish();
}

function describe(generation: Generation, matches: readonly MatchRecord[]): GenerationRecord {
  const individuals = generation.individuals.map((individual) => ({
    id: individual.id,
    parent: individual.parent,
    edits: individual.edits,
    matches: individual.matches,
    fitness: fitness(individual),
    survival: individual.matches > 0 ? individual.survival / individual.matches : 0,
    damage: individual.matches > 0 ? individual.damage / individual.matches : 0,
    race: individual.matches > 0 ? individual.race / individual.matches : 0,
    mass: compileBlueprint(individual.blueprint).mass,
    blueprint: serialiseBlueprint(individual.blueprint),
  }));

  let total = 0;
  let best = -Infinity;
  const sum = { survival: 0, damage: 0, race: 0 };
  const most = { survival: -Infinity, damage: -Infinity, race: -Infinity };
  for (const individual of individuals) {
    total += individual.fitness;
    best = max(best, individual.fitness);
    for (const part of ['survival', 'damage', 'race'] as const) {
      sum[part] += individual[part];
      most[part] = max(most[part], individual[part]);
    }
  }
  const count = individuals.length;
  const mean = (part: keyof ScoreParts): number => (count > 0 ? sum[part] / count : 0);
  const peak = (part: keyof ScoreParts): number => (count > 0 ? most[part] : 0);
  return {
    index: generation.index,
    individuals,
    matches,
    meanFitness: count > 0 ? total / count : 0,
    bestFitness: count > 0 ? best : 0,
    mean: { survival: mean('survival'), damage: mean('damage'), race: mean('race') },
    best: { survival: peak('survival'), damage: peak('damage'), race: peak('race') },
  };
}

/**
 * What a run arrived at: the best of its last generation.
 *
 * **Deliberately not the highest fitness it ever recorded**, which is a number
 * with no meaning across generations and is actively misleading. Fitness is
 * scored against the rest of the generation, so what it says is "better than
 * these opponents on that day" — and the opponents change every generation. A
 * population that learns to fly before it learns to shoot scores superbly
 * while nothing can shoot back, and the moment guns appear the same designs
 * are destroyed early and score far less; the *highest ever* then belongs to a
 * design that would lose to everything bred since, and a run that is getting
 * better looks like one that peaked and declined.
 *
 * What is comparable across generations is a fixed opponent, which is what
 * `yardstick.ts` is for and why it exists. Short of that, the last
 * generation's best is the run's own current answer, which is at least an
 * answer to a question somebody asked.
 */
export function finalist(run: RunRecord): { generation: number; individual: IndividualRecord } | null {
  for (let g = run.generations.length - 1; g >= 0; g--) {
    const generation = run.generations[g]!;
    let best: IndividualRecord | null = null;
    for (const individual of generation.individuals) {
      if (individual.matches === 0) continue;
      if (best === null || individual.fitness > best.fitness) best = individual;
    }
    if (best !== null) return { generation: generation.index, individual: best };
  }
  return null;
}

/** How many matches a run fought, for reporting what it cost. */
export function matchCount(run: RunRecord): number {
  let total = 0;
  for (const generation of run.generations) total += generation.matches.length;
  return min(total, Number.MAX_SAFE_INTEGER);
}
