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

/**
 * What the bottom of a generation is worth against the top, as a share.
 *
 * What it buys is the occasional wrong answer surviving to be measured again;
 * what it costs is pressure. A fifth makes the best of a generation six times
 * likelier than the worst and nobody impossible — in a field of twelve taking
 * four, about half for the leader against a seventh for the tail.
 */
const SELECTION_FLOOR = 0.2;

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
   * Each design draws a uniform number and multiplies it by what its standing
   * in the generation is worth; the highest few win. A draw rather than a cut
   * because a match is a noisy sample, and a strictly elitist top-four throws
   * away a design that drew a hard group on the strength of one battle — the
   * point of a generation is to be wrong about a design occasionally and find
   * out later, so the worst is never impossible.
   *
   * **Standing is where a design came, not what it scored.** That is the whole
   * of the difference, and it is what makes the pressure the same in every
   * generation. Weighting by the score itself sounds more informative and is
   * worse, because the scale it is measured against is set by whoever happens
   * to be at the ends of the field: one design far ahead stretches it until
   * everybody else is squashed together at the bottom — eleven designs
   * spanning 0.50 to 0.55 all came out within a few points of one another,
   * which is a generation the draw cannot tell apart — and one straggler far
   * behind does the same from the other end. Ranked, a fifth of a field is
   * worth the same wherever the scores happen to sit, and anything above the
   * bottom is visibly better off than the bottom, which is the property that
   * was wanted.
   *
   * Ties share their standing rather than being ordered arbitrarily by them,
   * so designs that did equally well are equally likely — which sounds obvious
   * and is exactly what a naive ranking gets wrong, handing four designs that
   * scored identically chances of 0, 1, 4 and 12 per cent.
   */
  winners(rng: Rng, count: number): Individual[] {
    const n = this.individuals.length;
    const scores = this.individuals.map(fitness);
    return this.individuals
      .map((individual, i) => {
        // How many it beat, and half of how many it drew with.
        let below = 0;
        let level = 0;
        for (let j = 0; j < n; j++) {
          if (scores[j]! < scores[i]!) below++;
          else if (j !== i) level++;
        }
        const standing = n > 1 ? (below + level / 2) / (n - 1) : 1;
        return { individual, weight: (SELECTION_FLOOR + standing) * rng.nextFloat() };
      })
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
