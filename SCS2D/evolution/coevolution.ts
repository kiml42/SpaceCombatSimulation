import { Rng } from '../sim/index.js';
import { max, min, round } from '../sim/math.js';
import { Match, type Entrant, type Score } from './match.js';
import { breed, fitness, Generation } from './generation.js';
import {
  DEFAULT_RUN,
  describe,
  fleetLimits,
  mutationLimits,
  seedPopulation,
  type GenerationRecord,
  type MatchRecord,
  type RunConfig,
  type RunRecord,
} from './run.js';

/**
 * Co-evolution: two lineages bred against each other.
 *
 * A run is given two sets of founders, side A and side B, and every match is
 * one of A against one of B, so each lineage is selected for beating the other
 * as the other is now. A boss battle is the case of it where one side is a
 * single design that never breeds.
 *
 * **Each side is bred only from its own winners**, and both close and breed
 * together, once every individual on both sides has had its matches. There is
 * no goal: a race would let a lineage score without fighting.
 *
 * **A hall of fame keeps the two from going round in circles.** Each side
 * keeps the champions of its last few generations, and a share of every
 * individual's matches is against the *other* side's hall rather than its
 * current population. Without it A beats B, B adapts, A adapts back, and
 * neither gets better at anything but the opponent of the moment; with it, a
 * design has to go on beating what came before. It also gives a side that is
 * losing everything weaker opponents to score against, so its selection still
 * has something to go on.
 *
 * Everything comes off one generator seeded from the run's seed, as a run of
 * one does, so a co-evolution run is a config and a number too.
 */

/** What may differ between the sides; side B takes side A's where it says nothing. */
export type SideSettings = Pick<RunConfig, 'population' | 'winners' | 'massBudget' | 'mutation' | 'fleet'>;

export interface CoevolutionConfig {
  /** Side B's settings where they differ from side A's, which are the run's. */
  readonly rival: Partial<SideSettings>;
  /** Champions each side keeps, one per generation, the latest. None turns the hall off. */
  readonly hall: number;
  /** The share of each individual's matches fought against the other side's hall, once it has one. */
  readonly hallShare: number;
}

export const DEFAULT_COEVOLUTION: CoevolutionConfig = {
  rival: {},
  hall: 5,
  hallShare: 0.25,
};

/** Told as each pair of generations closes. */
export type OnCoGeneration = (a: GenerationRecord, b: GenerationRecord) => void;

/** A past champion: who it was, and what it fought as. */
interface Champion {
  readonly id: number;
  readonly entrant: Entrant;
}

/** One side's lineage in progress. */
interface Side {
  readonly config: RunConfig;
  generation: Generation;
  readonly generations: GenerationRecord[];
  matches: MatchRecord[];
  /** The latest champions, oldest first. */
  readonly hall: Champion[];
  /** Matches each individual has fought against the other side's hall, by index. */
  hallPlayed: number[];
}

/** What is in the match being fought: an index into each side's generation, or a champion. */
interface Pairing {
  readonly a: number;
  readonly b: number;
  /** A past champion standing in for one side, which is not scored. */
  readonly champion: { readonly side: 0 | 1; readonly id: number; readonly entrant: Entrant } | null;
}

/**
 * A co-evolution run in progress: stepped as `Run` is, so a page can drive the
 * same object the headless runner drives.
 */
export class Coevolution {
  readonly config: RunConfig;
  readonly coevolution: CoevolutionConfig;
  private readonly sides: readonly [Side, Side];
  private readonly onGeneration: OnCoGeneration | undefined;
  private readonly rng: Rng;
  /** A cap on a generation's matches, so one that could never settle still ends. */
  private readonly limit: number;
  private nextId: number;
  private match: Match | null = null;
  private pairing: Pairing | null = null;
  private seed = 0;
  private played = 0;
  private over = false;

  constructor(
    founders: readonly Entrant[],
    rivals: readonly Entrant[],
    config?: Partial<RunConfig>,
    coevolution?: Partial<CoevolutionConfig>,
    onGeneration?: OnCoGeneration,
  ) {
    const settings: RunConfig = { ...DEFAULT_RUN, ...config };
    this.config = settings;
    this.coevolution = { ...DEFAULT_COEVOLUTION, ...coevolution };
    this.onGeneration = onGeneration;
    this.rng = new Rng(settings.seed);
    const rival: RunConfig = { ...settings, ...this.coevolution.rival };
    const a = seedPopulation(founders, this.rng, settings);
    const b = seedPopulation(rivals, this.rng, rival, a.individuals.length);
    this.nextId = a.individuals.length + b.individuals.length;
    this.sides = [side(settings, a), side(rival, b)];
    this.limit = (settings.population + rival.population) * settings.minMatches * 4 + 16;
    if (settings.generations <= 0 || founders.length === 0 || rivals.length === 0) this.over = true;
  }

  get done(): boolean {
    return this.over;
  }

  /** The match being fought, for watching one as it happens. */
  get current(): Match | null {
    return this.match;
  }

  /** Each side's generation under test, A then B. */
  get living(): readonly [Generation, Generation] {
    return [this.sides[0].generation, this.sides[1].generation];
  }

  /** How far through the whole run, from nothing to one. */
  get progress(): number {
    if (this.over) return 1;
    const wanted = this.config.minMatches;
    let heard = 0;
    let total = 0;
    for (const s of this.sides) {
      for (const individual of s.generation.individuals) heard += min(individual.matches, wanted);
      total += s.generation.individuals.length * wanted;
    }
    const within = total > 0 ? heard / total : 1;
    return (this.sides[0].generations.length + within) / this.config.generations;
  }

  /** Fight up to `budget` simulation steps of it, as `Run.advance` does. */
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

  /** Side A as a run of one records it, and side B beside it. */
  record(): RunRecord {
    return {
      config: this.config,
      generations: this.sides[0].generations,
      rival: { config: this.coevolution, generations: this.sides[1].generations },
    };
  }

  /** Draw the next match, or close the generations if both have had enough. */
  private open(): void {
    const wanted = this.config.minMatches;
    const settled = this.sides.every((s) => s.generation.settled(wanted));
    if (settled || this.played >= this.limit) {
      this.roll();
      return;
    }
    const pairing = this.hallPairing(0) ?? this.hallPairing(1) ?? this.livePairing();
    if (pairing === null) {
      this.roll();
      return;
    }
    this.pairing = pairing;
    this.seed = this.rng.nextUint32();
    const [a, b] = this.entrants(pairing);
    this.match = new Match([a, b], { ...this.config.match, goal: null, boss: null, seed: this.seed });
  }

  /**
   * A match for side `s` against the other side's hall, if any of `s` is still
   * owed one: the one owed most, against the champion it has met least.
   */
  private hallPairing(s: 0 | 1): Pairing | null {
    const own = this.sides[s];
    const other = this.sides[s === 0 ? 1 : 0];
    if (other.hall.length === 0) return null;
    const owed = this.hallQuota();
    let pick = -1;
    let pickDraw = 0;
    for (let i = 0; i < own.hallPlayed.length; i++) {
      const draw = this.rng.nextFloat();
      const played = own.hallPlayed[i]!;
      if (played >= owed) continue;
      if (pick >= 0 && (played > own.hallPlayed[pick]! || (played === own.hallPlayed[pick] && draw <= pickDraw))) continue;
      pick = i;
      pickDraw = draw;
    }
    if (pick < 0) return null;
    const met = own.generation.individuals[pick]!.met;
    let champion = other.hall[0]!;
    for (const each of other.hall) if ((met.get(each.id) ?? 0) < (met.get(champion.id) ?? 0)) champion = each;
    const stand = { side: (s === 0 ? 1 : 0) as 0 | 1, id: champion.id, entrant: champion.entrant };
    return s === 0 ? { a: pick, b: -1, champion: stand } : { a: -1, b: pick, champion: stand };
  }

  /** Matches each individual owes the other side's hall. */
  private hallQuota(): number {
    const { hall, hallShare } = this.coevolution;
    if (hall <= 0 || !(hallShare > 0)) return 0;
    return min(this.config.minMatches, max(1, round(this.config.minMatches * hallShare)));
  }

  /**
   * One of A against one of B: whoever of either side has played least, then
   * whoever of the other side it has met least, then has played least.
   */
  private livePairing(): Pairing | null {
    let first: { side: 0 | 1; index: number } | null = null;
    let firstMatches = 0;
    let firstDraw = 0;
    for (const s of [0, 1] as const) {
      this.sides[s].generation.individuals.forEach((individual, i) => {
        const draw = this.rng.nextFloat();
        if (first !== null && (individual.matches > firstMatches || (individual.matches === firstMatches && draw <= firstDraw))) {
          return;
        }
        first = { side: s, index: i };
        firstMatches = individual.matches;
        firstDraw = draw;
      });
    }
    if (first === null) return null;
    const chosen: { side: 0 | 1; index: number } = first;
    const me = this.sides[chosen.side].generation.individuals[chosen.index]!;
    const other = this.sides[chosen.side === 0 ? 1 : 0].generation.individuals;
    let partner = -1;
    let partnerMet = 0;
    let partnerMatches = 0;
    let partnerDraw = 0;
    other.forEach((individual, i) => {
      const draw = this.rng.nextFloat();
      const met = me.met.get(individual.id) ?? 0;
      if (
        partner >= 0 &&
        (met > partnerMet ||
          (met === partnerMet &&
            (individual.matches > partnerMatches || (individual.matches === partnerMatches && draw <= partnerDraw))))
      ) {
        return;
      }
      partner = i;
      partnerMet = met;
      partnerMatches = individual.matches;
      partnerDraw = draw;
    });
    if (partner < 0) return null;
    return chosen.side === 0
      ? { a: chosen.index, b: partner, champion: null }
      : { a: partner, b: chosen.index, champion: null };
  }

  private entrants(pairing: Pairing): [Entrant, Entrant] {
    const [a, b] = this.sides;
    const champion = pairing.champion;
    return [
      champion?.side === 0 ? champion.entrant : a.generation.individuals[pairing.a]!.entrant,
      champion?.side === 1 ? champion.entrant : b.generation.individuals[pairing.b]!.entrant,
    ];
  }

  private close(): void {
    const result = this.match!.result();
    const pairing = this.pairing!;
    const [a, b] = this.sides;
    const champion = pairing.champion;
    const idA = champion?.side === 0 ? champion.id : a.generation.individuals[pairing.a]!.id;
    const idB = champion?.side === 1 ? champion.id : b.generation.individuals[pairing.b]!.id;
    const record: MatchRecord = {
      seed: this.seed,
      competitors: [idA, idB],
      ending: result.ending,
      elapsed: result.elapsed,
      scores: result.scores,
    };
    this.score(a, pairing.a, result.scores[0]!, idB, champion !== null);
    this.score(b, pairing.b, result.scores[1]!, idA, champion !== null);
    if (pairing.a >= 0) a.matches.push(record);
    if (pairing.b >= 0) b.matches.push(record);
    this.played++;
    this.match = null;
    this.pairing = null;
  }

  /** Credit one side's individual, if it was one of the living rather than a champion. */
  private score(s: Side, index: number, score: Score, opponent: number, againstHall: boolean): void {
    if (index < 0) return;
    s.generation.credit(index, score, [opponent]);
    if (againstHall) s.hallPlayed[index] = s.hallPlayed[index]! + 1;
  }

  /** Close both generations, keep their champions, and breed both. */
  private roll(): void {
    const [a, b] = this.sides;
    const records = this.sides.map((s) => describe(s.generation, s.matches)) as [GenerationRecord, GenerationRecord];
    this.sides.forEach((s, k) => {
      s.generations.push(records[k]!);
      s.matches = [];
      this.enshrine(s);
    });
    this.onGeneration?.(records[0], records[1]);
    this.played = 0;
    if (a.generations.length >= this.config.generations) {
      this.over = true;
      return;
    }
    for (const s of [a, b]) {
      s.generation = breed(
        s.generation,
        this.rng,
        {
          population: s.config.population,
          winners: s.config.winners,
          limits: mutationLimits(s.config),
          fleetLimits: fleetLimits(s.config),
        },
        () => this.nextId++,
      );
      s.hallPlayed = s.generation.individuals.map(() => 0);
    }
  }

  /** Put a side's best of the generation in its hall, keeping only the latest. */
  private enshrine(s: Side): void {
    const size = this.coevolution.hall;
    if (size <= 0) return;
    let best = null as (typeof s.generation.individuals)[number] | null;
    for (const individual of s.generation.individuals) {
      if (individual.matches === 0) continue;
      if (best === null || fitness(individual) > fitness(best)) best = individual;
    }
    if (best === null) return;
    s.hall.push({ id: best.id, entrant: best.entrant });
    while (s.hall.length > size) s.hall.shift();
  }
}

function side(config: RunConfig, generation: Generation): Side {
  return {
    config,
    generation,
    generations: [],
    matches: [],
    hall: [],
    hallPlayed: generation.individuals.map(() => 0),
  };
}

/** Fight a whole co-evolution run and record it. */
export function runCoevolution(
  founders: readonly Entrant[],
  rivals: readonly Entrant[],
  config?: Partial<RunConfig>,
  coevolution?: Partial<CoevolutionConfig>,
  onGeneration?: OnCoGeneration,
): RunRecord {
  return new Coevolution(founders, rivals, config, coevolution, onGeneration).finish();
}
