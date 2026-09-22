import type { Blueprint, Rng } from '../sim/index.js';
import { min } from '../sim/math.js';
import { mutate, type MutationLimits } from './mutate.js';
import type { MatchResult } from './match.js';

/**
 * A generation: the individuals in it, who has fought whom, and what is bred
 * from them.
 *
 * **Everything here is about giving a design a fair hearing.** A match is a
 * sample, and a noisy one — who a craft was drawn against and where it started
 * matter as much as how it was built — so the whole job of a generation is to
 * spread the samples evenly and then not over-read them.
 */

/** One design under test, and what has happened to it so far. */
export interface Individual {
  readonly id: number;
  readonly blueprint: Blueprint;
  /** The individual it was bred from, or -1 for one that started the run. */
  readonly parent: number;
  /** What was done to the parent to get it. Empty for a founder. */
  readonly edits: readonly string[];
  matches: number;
  /** Totals across every match played, divided by `matches` to rank. */
  score: number;
  survival: number;
  damage: number;
  race: number;
  /** How often this individual has met each other one, by id. */
  readonly met: Map<number, number>;
}

/** Mean score per match, which is what ranks an individual. */
export function fitness(individual: Individual): number {
  return individual.matches > 0 ? individual.score / individual.matches : 0;
}

export class Generation {
  readonly individuals: Individual[];

  constructor(
    readonly index: number,
    individuals: readonly Individual[],
  ) {
    this.individuals = [...individuals];
  }

  /**
   * Draw the competitors for one match.
   *
   * Fewest previous meetings with whoever is already in the match, then fewest
   * matches played, then the draw. In that order for a reason: playing
   * everybody once beats playing somebody twice, because a design that has
   * only ever met one opponent has been measured against that opponent rather
   * than against the generation, and no number of rematches fixes it.
   */
  pickCompetitors(rng: Rng, count: number): number[] {
    const picked: number[] = [];
    const wanted = min(count, this.individuals.length);
    while (picked.length < wanted) {
      let best = -1;
      let bestMet = 0;
      let bestMatches = 0;
      let bestDraw = 0;
      for (let i = 0; i < this.individuals.length; i++) {
        if (picked.includes(i)) continue;
        const individual = this.individuals[i]!;
        let met = 0;
        for (const other of picked) met += individual.met.get(this.individuals[other]!.id) ?? 0;
        const draw = rng.nextFloat();
        if (
          best >= 0 &&
          (met > bestMet ||
            (met === bestMet &&
              (individual.matches > bestMatches ||
                (individual.matches === bestMatches && draw <= bestDraw))))
        ) {
          continue;
        }
        best = i;
        bestMet = met;
        bestMatches = individual.matches;
        bestDraw = draw;
      }
      if (best < 0) break;
      picked.push(best);
    }
    return picked;
  }

  /** Take the result of a match those competitors fought. */
  record(competitors: readonly number[], result: MatchResult): void {
    for (let c = 0; c < competitors.length; c++) {
      const individual = this.individuals[competitors[c]!]!;
      const score = result.scores[c]!;
      individual.matches += 1;
      individual.score += score.total;
      individual.survival += score.survival;
      individual.damage += score.damage;
      individual.race += score.race;
      for (const other of competitors) {
        if (other === competitors[c]) continue;
        const id = this.individuals[other]!.id;
        individual.met.set(id, (individual.met.get(id) ?? 0) + 1);
      }
    }
  }

  /** Whether everyone has had the hearing the run promised them. */
  settled(minMatches: number): boolean {
    return this.individuals.every((individual) => individual.matches >= minMatches);
  }

  /** Best first, for reporting. Ties keep the order they were bred in. */
  ranked(): Individual[] {
    return [...this.individuals].sort((a, b) => fitness(b) - fitness(a));
  }

  /**
   * Who gets to breed.
   *
   * Weighted by score against a uniform draw, rather than simply taken from
   * the top: a match is a noisy sample, and a strictly elitist cut throws away
   * a design that drew a hard group on the strength of one battle. The shift
   * by the worst score keeps every individual possible — the point of a
   * generation is to be wrong about a design occasionally and find out later.
   */
  winners(rng: Rng, count: number): Individual[] {
    let worst = Infinity;
    for (const individual of this.individuals) worst = min(worst, fitness(individual));
    return [...this.individuals]
      .map((individual) => ({
        individual,
        weight: (1 + fitness(individual) - worst) * rng.nextFloat(),
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, count)
      .map((entry) => entry.individual);
  }
}

export interface BreedingConfig {
  /** How many individuals the next generation holds. */
  readonly population: number;
  /** How many of them are bred from, the rest being their children. */
  readonly winners: number;
  readonly limits: Partial<MutationLimits>;
}

/**
 * Breed the next generation: the winners, unchanged, and children of them.
 *
 * **The winners carry over as they are.** A generation whose every member is a
 * mutant can be worse than the one before it and have nothing left to compare
 * against, so the best designs stay in the population and go on being measured
 * — which also means a design that won on a lucky draw has to win again.
 */
export function breed(
  generation: Generation,
  rng: Rng,
  config: BreedingConfig,
  nextId: () => number,
): Generation {
  const winners = generation.winners(rng, min(config.winners, config.population));
  const individuals: Individual[] = winners.map((winner) => blank(winner.id, winner.blueprint, winner.parent, winner.edits));

  let parent = 0;
  while (individuals.length < config.population && winners.length > 0) {
    const source = winners[parent % winners.length]!;
    parent++;
    const child = mutate(source.blueprint, rng, config.limits);
    individuals.push(blank(nextId(), child.blueprint, source.id, child.edits));
  }

  return new Generation(generation.index + 1, individuals);
}

/** An individual with nothing recorded against it yet. */
export function blank(
  id: number,
  blueprint: Blueprint,
  parent: number,
  edits: readonly string[],
): Individual {
  return {
    id,
    blueprint,
    parent,
    edits,
    matches: 0,
    score: 0,
    survival: 0,
    damage: 0,
    race: 0,
    met: new Map(),
  };
}
