import {
  budgetMass,
  compileBlueprint,
  expandFleet,
  fleetHulls,
  fleetMass,
  parseBlueprint,
  parseFleet,
  Rng,
  serialiseBlueprint,
  serialiseFleet,
  shipFleet,
} from '../sim/index.js';
import { max, min } from '../sim/math.js';
import { isFleet, Match, SCORE_PARTS, type Entrant, type MatchConfig, type MatchResult } from './match.js';
import { type MutationLimits } from './mutate.js';
import { DEFAULT_FLEET_LIMITS, type FleetMutationLimits } from './fleetMutate.js';
import { blank, breed, fitness, Generation, offspring, type Individual } from './generation.js';
import type { CoevolutionConfig } from './coevolution.js';

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
  /** How fleets are bred, in a run started from one. The mass budget above is the whole fleet's. */
  readonly fleet: Partial<FleetMutationLimits>;
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
  fleet: {},
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
  /** Absent from runs recorded before it was scored. */
  readonly functional?: number;
  readonly damage: number;
  readonly disabling?: number;
  readonly race: number;
  /** Dry mass, kg — what the design cost. */
  readonly mass: number;
  /**
   * The design itself, so a run can be read without the ships it started
   * from: a blueprint file in a run of ships, a fleet file in a run of fleets.
   */
  readonly blueprint?: Record<string, unknown>;
  readonly fleet?: Record<string, unknown>;
}

/** What a recorded individual was: the ship or fleet it fought as. */
export function entrantOf(record: IndividualRecord): Entrant {
  if (record.fleet !== undefined) return parseFleet(record.fleet);
  if (record.blueprint !== undefined) return parseBlueprint(record.blueprint);
  throw new Error(`individual ${record.id} records no design`);
}

/** How many ships an individual fields: one for a ship, every hull for a fleet. */
export function shipCount(record: IndividualRecord): number {
  return record.fleet === undefined ? 1 : expandFleet(parseFleet(record.fleet)).length;
}

/**
 * What one individual of a generation weighs and fields: averaged over the
 * individuals, and for the fittest. Per fleet rather than summed over the
 * generation, so it reads the same whatever the population.
 */
export interface GenerationSize {
  /** Dry mass of one individual, kg. */
  readonly meanMass: number;
  readonly bestMass: number;
  readonly meanShips: number;
  readonly bestShips: number;
}

/**
 * The generation's size, for reading whether a run is growing its designs or
 * paring them down. The fittest is the first with the best fitness, which is
 * the one `bestFitness` was read from.
 */
export function generationSize(record: GenerationRecord): GenerationSize {
  const individuals = record.individuals;
  if (individuals.length === 0) return { meanMass: 0, bestMass: 0, meanShips: 0, bestShips: 0 };
  let mass = 0;
  let ships = 0;
  let best = individuals[0]!;
  let bestShips = 0;
  for (const individual of individuals) {
    const count = shipCount(individual);
    mass += individual.mass;
    ships += count;
    if (individual.fitness > best.fitness || individual === best) {
      best = individual;
      bestShips = count;
    }
  }
  return {
    meanMass: mass / individuals.length,
    bestMass: best.mass,
    meanShips: ships / individuals.length,
    bestShips,
  };
}

/** One match, and enough to fight it again. */
export interface MatchRecord {
  readonly seed: number;
  readonly competitors: readonly number[];
  /** Each competitor's side, when the match had sides rather than being a free-for-all. */
  readonly teams?: readonly number[];
  readonly ending: MatchResult['ending'];
  /** Which competitors, by index, won a decided match. */
  readonly winners?: readonly number[];
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

/** The sources of score, apart. */
export type ScoreParts = Readonly<Record<(typeof SCORE_PARTS)[number], number>>;

export interface RunRecord {
  readonly config: RunConfig;
  readonly generations: readonly GenerationRecord[];
  /**
   * The other lineage of a co-evolution run, side B, bred against this one;
   * absent from a run of one. Side A is `generations`, so whatever reads a
   * run of one reads side A of a co-evolution run the same way.
   */
  readonly rival?: RivalRecord;
}

/** Side B of a co-evolution run: what was set for it, and its generations. */
export interface RivalRecord {
  readonly config: CoevolutionConfig;
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
  founders: readonly Entrant[],
  rng: Rng,
  config: RunConfig,
  firstId = 0,
): Generation {
  const fleets = isFleetRun(founders, config);
  const entrants = fleets ? founders.map((founder) => (isFleet(founder) ? founder : shipFleet(founder))) : founders;
  const individuals: Individual[] = [];
  let id = firstId;
  for (const founder of entrants) {
    if (individuals.length >= config.population) break;
    individuals.push(blank(id++, founder, -1, []));
  }
  let parent = 0;
  while (individuals.length < config.population && entrants.length > 0) {
    const source = individuals[parent % entrants.length]!;
    parent++;
    const child = offspring(source.entrant, rng, mutationLimits(config), fleetLimits(config));
    individuals.push(blank(id++, child.entrant, source.id, child.edits));
  }
  return new Generation(0, individuals);
}

/**
 * Whether a run breeds fleets: whenever a fleet founds it, or a ship may grow
 * into one. A ship joins as a fleet of one; allowing one ship at most keeps a
 * run of ships breeding ships.
 */
export function isFleetRun(founders: readonly Entrant[], config: Pick<RunConfig, 'fleet'>): boolean {
  return founders.some(isFleet) || (config.fleet.maxShips ?? DEFAULT_FLEET_LIMITS.maxShips) > 1;
}

/** How a ship is bred. In a run of fleets the budget is the fleet's, so it is not applied to one ship. */
export function mutationLimits(config: RunConfig): Partial<MutationLimits> {
  return { massBudget: config.massBudget, ...config.mutation };
}

export function fleetLimits(config: RunConfig): Partial<FleetMutationLimits> {
  return { massBudget: config.massBudget, ...config.fleet };
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
   * A cap on a loop that is otherwise governed by a draw, so a population
   * that could never settle still ends its generation.
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
    founders: readonly Entrant[],
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

  /**
   * The run's first match, unfought and unmutated: its seed and its number of
   * entrants, fought by the founders themselves. Each founder once — the ones
   * the first match drew first — and round again only when a match holds more
   * entrants than there are founders. Draws the match, so it is for a run that
   * will not be fought.
   */
  unmutatedOpening(): Match | null {
    if (this.match === null && !this.over) this.open();
    if (this.match === null) return null;
    const individuals = this.generation.individuals;
    const founders = individuals.filter((individual) => individual.parent < 0);
    const drawn: Individual[] = [];
    for (const index of this.competitors) {
      const individual = individuals[index]!;
      const founder = individual.parent < 0 ? individual : founders.find((f) => f.id === individual.parent);
      if (founder !== undefined && !drawn.includes(founder)) drawn.push(founder);
    }
    for (const founder of founders) if (!drawn.includes(founder)) drawn.push(founder);
    const entrants = this.competitors.map((_, k) => drawn[k % drawn.length]!.entrant);
    return new Match(entrants, { ...this.config.match, seed: this.seed });
  }

  /** Draw the next match, or close the generation if it has had enough. */
  private open(): void {
    const settings = this.config;
    if (this.generation.settled(settings.minMatches) || this.matches.length >= this.limit) {
      this.roll();
      return;
    }
    // One is a match too: with the goal to fly for, a ship alone is a test of
    // its piloting.
    const competitors = this.generation.pickCompetitors(this.rng, settings.group);
    if (competitors.length === 0) {
      this.roll();
      return;
    }
    this.competitors = competitors;
    this.seed = this.rng.nextUint32();
    this.match = new Match(
      competitors.map((c) => this.generation.individuals[c]!.entrant),
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
      winners: result.winners,
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
        fleetLimits: fleetLimits(settings),
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
  founders: readonly Entrant[],
  config?: Partial<RunConfig>,
  onGeneration?: OnGeneration,
): RunRecord {
  return new Run(founders, config, onGeneration).finish();
}

/** A generation as a run records it, with the matches it was scored by. */
export function describe(generation: Generation, matches: readonly MatchRecord[]): GenerationRecord {
  const individuals = generation.individuals.map((individual) => ({
    id: individual.id,
    parent: individual.parent,
    edits: individual.edits,
    matches: individual.matches,
    fitness: fitness(individual),
    ...perMatch(individual),
    ...(isFleet(individual.entrant)
      ? { mass: fleetMass(fleetHulls(individual.entrant)), fleet: serialiseFleet(individual.entrant) }
      : { mass: budgetMass(compileBlueprint(individual.entrant)), blueprint: serialiseBlueprint(individual.entrant) }),
  }));

  let total = 0;
  let best = -Infinity;
  const sum = parts(0);
  const most = parts(-Infinity);
  for (const individual of individuals) {
    total += individual.fitness;
    best = max(best, individual.fitness);
    for (const part of SCORE_PARTS) {
      sum[part] += individual[part];
      most[part] = max(most[part], individual[part]);
    }
  }
  const count = individuals.length;
  const mean = parts(0);
  const peak = parts(0);
  if (count > 0) {
    for (const part of SCORE_PARTS) {
      mean[part] = sum[part] / count;
      peak[part] = most[part];
    }
  }
  return {
    index: generation.index,
    individuals,
    matches,
    meanFitness: count > 0 ? total / count : 0,
    bestFitness: count > 0 ? best : 0,
    mean,
    best: peak,
  };
}

function parts(value: number): Record<(typeof SCORE_PARTS)[number], number> {
  return { survival: value, functional: value, damage: value, disabling: value, race: value };
}

/** Each part of an individual's score, per match played. */
function perMatch(individual: Individual): ScoreParts {
  const out = parts(0);
  if (individual.matches > 0) for (const part of SCORE_PARTS) out[part] = individual[part] / individual.matches;
  return out;
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
