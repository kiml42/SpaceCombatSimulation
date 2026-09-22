import { Rng, serialiseBlueprint, type Blueprint } from '../sim/index.js';
import { compileBlueprint } from '../sim/index.js';
import { max, min } from '../sim/math.js';
import { runMatch, type MatchConfig, type MatchResult } from './match.js';
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
  const settings: RunConfig = { ...DEFAULT_RUN, ...config };
  const rng = new Rng(settings.seed);
  let generation = seedPopulation(founders, rng, settings);
  let nextId = generation.individuals.length;

  const generations: GenerationRecord[] = [];
  for (let g = 0; g < settings.generations; g++) {
    const matches: MatchRecord[] = [];
    // A cap on a loop that is otherwise governed by a draw: a population
    // smaller than a group, or a group of one, would never settle.
    const limit = settings.population * settings.minMatches * 4 + 16;
    while (!generation.settled(settings.minMatches) && matches.length < limit) {
      const competitors = generation.pickCompetitors(rng, settings.group);
      if (competitors.length < 2) break;
      const seed = rng.nextUint32();
      const result = runMatch(
        competitors.map((c) => generation.individuals[c]!.blueprint),
        { ...settings.match, seed },
      );
      generation.record(competitors, result);
      matches.push({
        seed,
        competitors: competitors.map((c) => generation.individuals[c]!.id),
        ending: result.ending,
        elapsed: result.elapsed,
        scores: result.scores,
      });
    }

    const record = describe(generation, matches);
    generations.push(record);
    onGeneration?.(record);

    if (g + 1 < settings.generations) {
      generation = breed(
        generation,
        rng,
        {
          population: settings.population,
          winners: settings.winners,
          limits: mutationLimits(settings),
        },
        () => nextId++,
      );
    }
  }

  return { config: settings, generations };
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
  for (const individual of individuals) {
    total += individual.fitness;
    best = max(best, individual.fitness);
  }
  return {
    index: generation.index,
    individuals,
    matches,
    meanFitness: individuals.length > 0 ? total / individuals.length : 0,
    bestFitness: individuals.length > 0 ? best : 0,
  };
}

/** The best design a run produced, and which generation it came from. */
export function champion(run: RunRecord): { generation: number; individual: IndividualRecord } | null {
  let best: { generation: number; individual: IndividualRecord } | null = null;
  for (const generation of run.generations) {
    for (const individual of generation.individuals) {
      if (individual.matches === 0) continue;
      if (best === null || individual.fitness > best.individual.fitness) {
        best = { generation: generation.index, individual };
      }
    }
  }
  return best;
}

/** How many matches a run fought, for reporting what it cost. */
export function matchCount(run: RunRecord): number {
  let total = 0;
  for (const generation of run.generations) total += generation.matches.length;
  return min(total, Number.MAX_SAFE_INTEGER);
}
