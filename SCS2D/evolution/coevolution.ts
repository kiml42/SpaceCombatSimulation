import { Rng } from '../sim/index.js';
import { max, min, round } from '../sim/math.js';
import { Match, type Entrant } from './match.js';
import { blank, breed, fitness, Generation } from './generation.js';
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
 * some of A against some of B — each side's `group` of them, allies of each
 * other — so each lineage is selected for beating the other as the other is
 * now. A side B that does not evolve is a fixed opponent, and one of it
 * against several of side A is what a boss battle was.
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
export type SideSettings = Pick<RunConfig, 'population' | 'winners' | 'group' | 'massBudget' | 'mutation' | 'fleet'>;

export interface CoevolutionConfig {
  /** Side B's settings where they differ from side A's, which are the run's. */
  readonly rival: Partial<SideSettings>;
  /** Champions each side keeps, one per generation, the latest. None turns the hall off. */
  readonly hall: number;
  /** The share of each individual's matches fought against the other side's hall, once it has one. */
  readonly hallShare: number;
  /**
   * Whether side B evolves. Not, and it is its founders and nothing else, every
   * generation: a fixed opponent side A is bred against.
   */
  readonly rivalEvolves: boolean;
}

export const DEFAULT_COEVOLUTION: CoevolutionConfig = {
  rival: {},
  hall: 5,
  hallShare: 0.25,
  rivalEvolves: true,
};

/**
 * Side B's settings: side A's, with whatever side B sets in their place. The
 * weight tables merge entry by entry, so a side B that sets one kind's odds
 * keeps side A's for the rest.
 */
export function rivalSettings(a: RunConfig, rival: Partial<SideSettings>): RunConfig {
  const mine = rival.mutation ?? {};
  const theirs = a.mutation;
  const table = <T extends object>(base: T | undefined, own: T | undefined): { table?: T } =>
    base === undefined && own === undefined ? {} : { table: { ...base, ...own } as T };
  const kinds = table(theirs.kinds, mine.kinds).table;
  const build = table(theirs.build, mine.build).table;
  const doctrine = table(theirs.doctrine, mine.doctrine).table;
  const operators = table(a.fleet.operators, rival.fleet?.operators).table;
  return {
    ...a,
    ...rival,
    mutation: {
      ...theirs,
      ...mine,
      ...(kinds === undefined ? {} : { kinds }),
      ...(build === undefined ? {} : { build }),
      ...(doctrine === undefined ? {} : { doctrine }),
    },
    fleet: { ...a.fleet, ...rival.fleet, ...(operators === undefined ? {} : { operators }) },
  };
}

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
  /** Whether it breeds; one that does not is its founders every generation. */
  readonly evolves: boolean;
  /** Matches each individual has fought against the other side's hall, by index. */
  hallPlayed: number[];
}

/**
 * What is in the match being fought: indices into each side's generation, or
 * past champions standing in for one side, which are not scored.
 */
interface Pairing {
  readonly picked: readonly [readonly number[], readonly number[]];
  readonly champions: { readonly side: 0 | 1; readonly list: readonly Champion[] } | null;
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
  private fought = 0;
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
    const rival = rivalSettings(settings, this.coevolution.rival);
    const a = seedPopulation(founders, this.rng, settings);
    const evolves = this.coevolution.rivalEvolves;
    // A side that does not evolve is its founders, with no mutants of them.
    const b = seedPopulation(rivals, this.rng, evolves ? rival : { ...rival, population: rivals.length }, a.individuals.length);
    this.nextId = a.individuals.length + b.individuals.length;
    this.sides = [side(settings, a, true), side(rival, b, evolves)];
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

  /** Side A's closed generations, as `Run.generations`. */
  get generations(): readonly GenerationRecord[] {
    return this.sides[0].generations;
  }

  /** Side B's closed generations. */
  get rivalGenerations(): readonly GenerationRecord[] {
    return this.sides[1].generations;
  }

  /** Side A's generation under test, as `Run.living`. */
  get living(): Generation {
    return this.sides[0].generation;
  }

  /** Side B's generation under test. */
  get rivalLiving(): Generation {
    return this.sides[1].generation;
  }

  /** Matches side A has been scored for in the generation under test, as `Run.played`. */
  get played(): readonly MatchRecord[] {
    return this.sides[0].matches;
  }

  /** Matches side B has been scored for in the generation under test. */
  get rivalPlayed(): readonly MatchRecord[] {
    return this.sides[1].matches;
  }

  /**
   * The run's first match, fought by the founders themselves: the first
   * pairing's seed, with each side's individual swapped for the founder it
   * was bred from. Draws the match, so it is for a run that will not be fought.
   */
  unmutatedOpening(): Match | null {
    if (this.match === null && !this.over) this.open();
    const pairing = this.pairing;
    if (this.match === null || pairing === null) return null;
    const founderOf = (s: Side, index: number): Entrant => {
      const individuals = s.generation.individuals;
      const individual = individuals[index]!;
      if (individual.parent < 0) return individual.entrant;
      return individuals.find((each) => each.id === individual.parent)?.entrant ?? individual.entrant;
    };
    const { entrants, teams } = this.lineUp(pairing, founderOf);
    return new Match(entrants, { ...this.config.match, goal: null, seed: this.seed }, teams);
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
    if (settled || this.fought >= this.limit) {
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
    const { entrants, teams } = this.lineUp(pairing, (s, index) => s.generation.individuals[index]!.entrant);
    this.match = new Match(entrants, { ...this.config.match, goal: null, seed: this.seed }, teams);
  }

  /**
   * A match for side `s` against the other side's hall, if any of `s` is still
   * owed one: the one owed most and those owed next most, against the
   * champions they have met least.
   */
  private hallPairing(s: 0 | 1): Pairing | null {
    const own = this.sides[s];
    const other = this.sides[s === 0 ? 1 : 0];
    // A side that does not evolve has nothing to learn from the other's past.
    if (other.hall.length === 0 || !own.evolves) return null;
    const owed = this.hallQuota();
    if (own.hallPlayed.every((played) => played >= owed)) return null;
    const individuals = own.generation.individuals;
    const picked = this.pick(own, groupOf(own), (i) => [own.hallPlayed[i]!, individuals[i]!.matches]);
    const met = (champion: Champion): number => {
      let sum = 0;
      for (const i of picked) sum += individuals[i]!.met.get(champion.id) ?? 0;
      return sum;
    };
    // Stable, so the oldest of those met equally goes first; round again if the hall is short.
    const order = [...other.hall].sort((x, y) => met(x) - met(y));
    const list = Array.from({ length: groupOf(other) }, (_, k) => order[k % order.length]!);
    const champions = { side: (s === 0 ? 1 : 0) as 0 | 1, list };
    return { picked: s === 0 ? [picked, []] : [[], picked], champions };
  }

  /** Matches each individual owes the other side's hall. */
  private hallQuota(): number {
    const { hall, hallShare } = this.coevolution;
    if (hall <= 0 || !(hallShare > 0)) return 0;
    return min(this.config.minMatches, max(1, round(this.config.minMatches * hallShare)));
  }

  /**
   * Some of A against some of B: whoever of either side has played least,
   * those of its own side who have played least beside it, then those of the
   * other side they have met least, then have played least.
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
    const mine = this.sides[chosen.side];
    const theirs = this.sides[chosen.side === 0 ? 1 : 0];
    const ours = mine.generation.individuals;
    const allies = this.pick(mine, groupOf(mine) - 1, (i) => [ours[i]!.matches], [chosen.index]);
    const group = [chosen.index, ...allies];
    const others = theirs.generation.individuals;
    const opponents = this.pick(theirs, groupOf(theirs), (i) => {
      let met = 0;
      for (const j of group) met += ours[j]!.met.get(others[i]!.id) ?? 0;
      return [met, others[i]!.matches];
    });
    if (opponents.length === 0) return null;
    return { picked: chosen.side === 0 ? [group, opponents] : [opponents, group], champions: null };
  }

  /**
   * `count` of a side's individuals, one at a time, each the least by `key`
   * compared entry by entry, ties broken by a draw. `taken` are left out.
   */
  private pick(s: Side, count: number, key: (index: number) => number[], taken: readonly number[] = []): number[] {
    const picked: number[] = [];
    const n = s.generation.individuals.length;
    while (picked.length < count) {
      let best = -1;
      let bestKey: number[] = [];
      let bestDraw = 0;
      for (let i = 0; i < n; i++) {
        if (picked.includes(i) || taken.includes(i)) continue;
        const draw = this.rng.nextFloat();
        const k = key(i);
        if (best >= 0) {
          let order = 0;
          for (let e = 0; e < k.length && order === 0; e++) order = k[e]! - bestKey[e]!;
          if (order > 0 || (order === 0 && draw <= bestDraw)) continue;
        }
        best = i;
        bestKey = k;
        bestDraw = draw;
      }
      if (best < 0) break;
      picked.push(best);
    }
    return picked;
  }

  /** The match's entrants, side A's then side B's, with each one's side and id. */
  private lineUp(
    pairing: Pairing,
    entrantOf: (s: Side, index: number) => Entrant,
  ): { entrants: Entrant[]; teams: number[]; ids: number[] } {
    const entrants: Entrant[] = [];
    const teams: number[] = [];
    const ids: number[] = [];
    for (const k of [0, 1] as const) {
      const s = this.sides[k];
      if (pairing.champions?.side === k) {
        for (const champion of pairing.champions.list) {
          entrants.push(champion.entrant);
          ids.push(champion.id);
          teams.push(k);
        }
        continue;
      }
      for (const index of pairing.picked[k]) {
        entrants.push(entrantOf(s, index));
        ids.push(s.generation.individuals[index]!.id);
        teams.push(k);
      }
    }
    return { entrants, teams, ids };
  }

  private close(): void {
    const result = this.match!.result();
    const pairing = this.pairing!;
    const { teams, ids } = this.lineUp(pairing, (s, index) => s.generation.individuals[index]!.entrant);
    const record: MatchRecord = {
      seed: this.seed,
      competitors: ids,
      teams,
      ending: result.ending,
      elapsed: result.elapsed,
      scores: result.scores,
    };
    const againstHall = pairing.champions !== null;
    let at = 0;
    for (const k of [0, 1] as const) {
      const s = this.sides[k];
      const opponents = ids.filter((_, e) => teams[e] !== k);
      const fielded = teams.filter((team) => team === k).length;
      // Champions are not scored: only the living are credited.
      if (pairing.champions?.side !== k) {
        pairing.picked[k].forEach((index, e) => {
          s.generation.credit(index, result.scores[at + e]!, opponents);
          if (againstHall) s.hallPlayed[index] = s.hallPlayed[index]! + 1;
        });
        s.matches.push(record);
      }
      at += fielded;
    }
    this.fought++;
    this.match = null;
    this.pairing = null;
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
    this.fought = 0;
    if (a.generations.length >= this.config.generations) {
      this.over = true;
      return;
    }
    for (const s of [a, b]) {
      if (!s.evolves) {
        // The same designs again, under the same ids, with nothing recorded against them.
        s.generation = new Generation(
          s.generation.index + 1,
          s.generation.individuals.map((each) => blank(each.id, each.entrant, each.parent, each.edits)),
        );
        s.hallPlayed = s.generation.individuals.map(() => 0);
        continue;
      }
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
    if (size <= 0 || !s.evolves) return;
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

/** How many of a side each match fields: its `group`, or all of it if it is smaller. */
function groupOf(s: Side): number {
  return max(1, min(s.config.group, s.generation.individuals.length));
}

function side(config: RunConfig, generation: Generation, evolves: boolean): Side {
  return {
    config,
    evolves,
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
