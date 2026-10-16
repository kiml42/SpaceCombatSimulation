import { fleetBill, fleetHulls, fleetReach, math, Rng, type Budget, type Fleet } from '../sim/index.js';
import { customBattle, tally, winner, type CustomBattle } from '../scenarios/customBattle.js';
import { Activity, type Decision } from '../scenarios/decision.js';
import { DEFAULT_SKIRMISH_SETTINGS, nextMultiplier, roundBattle, startingMultiplier, type SkirmishSettings } from '../scenarios/skirmish.js';
import { breeding, type Breeding } from './mutationFields.js';
import { mutateFleet } from './fleetMutate.js';

/**
 * The skirmish enemy's answer to a fleet that beat it (ROADMAP.md §8 step 5):
 * mutants of the enemy fought against the player's fleet, held fixed, until
 * one beats it.
 *
 * A generation is the best enemy so far and a handful of its mutants, each
 * fought on the seed the player won on and on a few random ones. A match is
 * fought under evolution's rules — over once one side alone is armed, or at a
 * time limit, an enemy ahead then being taken to win in the end — and the
 * best of the generation, by all its matches, breeds the next. An enemy that
 * wins on the player's seed is checked by fighting the round itself to the
 * skirmish's decision: the first that wins that is the answer, and one that
 * does not is not counted as having won on it.
 *
 * An answer may cost the player's budget times a multiplier, and no less than
 * the enemy it answers already does; a search that goes long without one
 * steps the multiplier up, again and again, and the skirmish keeps it.
 *
 * Worked a step at a time, so a page or a worker can do it in slices and look
 * in between. Everything is decided by the seed it is given.
 */

/** What the search is run under: the skirmish's settings, the round's rules and how the enemy is bred among them. */
export type AnswerSettings = SkirmishSettings;

export const DEFAULT_ANSWER: AnswerSettings = DEFAULT_SKIRMISH_SETTINGS;

/** How often a match looks to see whether it is over, steps. */
const CHECK_EVERY = 30;

/** How one enemy did in a generation. */
export interface Standing {
  readonly enemy: Fleet;
  /** Matches won. */
  wins: number;
  /** Whether it won on the seed the round was won on: the match a timeline shows of it. */
  onRound: boolean;
  /** Summed, of how far ahead it finished each in what is left of either side, and one more for a win outright or one less for a loss. */
  margin: number;
}

export interface Progress {
  /** Generations finished. */
  readonly generation: number;
  /** The best enemy so far, and how it did in the last generation it fought. */
  readonly best: Standing;
  readonly seeds: number;
  /** The answer, once there is one. */
  readonly found: Fleet | null;
  /** The enemy's budget as a multiple of the player's: where it began, up a `budgetStep` each time the search stalled. */
  readonly multiplier: number;
}

export class EnemySearch {
  private readonly rng: Rng;
  private readonly settings: AnswerSettings;
  /** How the enemy is bred, from the settings' mutation odds. */
  private readonly bred: Breeding;
  private readonly radius: number;
  /** What the enemy cost and how many ships it had: an answer may always have as much. */
  private readonly startBill: Budget;
  private readonly startShips: number;
  private multiplier: number;
  private generationCount = 0;
  private best: Standing;
  private found: Fleet | null = null;

  // The generation being fought.
  private standings: Standing[] = [];
  private seeds: number[] = [];
  private next = 0;
  private battle: CustomBattle | null = null;
  // The round being fought to its decision, by the enemy that won every match.
  private checking: { standing: Standing; battle: CustomBattle; activity: Activity } | null = null;
  private readonly unchecked: Standing[] = [];
  // Every match of the generation fought, its winners on the round being checked before it counts as done.
  private finishing = false;

  constructor(
    private readonly player: Fleet,
    enemy: Fleet,
    /** The seed the player won the round on. */
    private readonly wonSeed: number,
    seed: number,
    settings: Partial<AnswerSettings> = {},
    /** The player's budget, which the enemy's is a multiple of; what the enemy cost where not given. */
    private readonly playerBudget?: Budget,
    multiplier = 1,
  ) {
    this.multiplier = multiplier;
    this.rng = new Rng(seed);
    this.settings = { ...DEFAULT_ANSWER, ...settings };
    const odds = this.settings.breeding;
    this.bred = breeding((name) => odds[name]);
    const hulls = fleetHulls(enemy);
    // The skirmish's limit, unless the enemy already reaches past it.
    this.radius = math.max(this.settings.radius, fleetReach(hulls));
    this.startBill = fleetBill(hulls);
    this.multiplier = startingMultiplier(this.multiplier, playerBudget ?? this.startBill, this.startBill);
    this.startShips = hulls.length;
    this.best = { enemy, wins: 0, onRound: false, margin: -Infinity };
    this.begin();
  }

  get progress(): Progress {
    return {
      generation: this.generationCount,
      best: this.best,
      seeds: this.settings.seeds,
      found: this.found,
      multiplier: this.multiplier,
    };
  }

  /**
   * What an answer may cost and field: the player's budget times the
   * multiplier, and the skirmish's ship limit, each never less than the enemy
   * it answers already has.
   */
  get limits(): { budget: Budget; maxShips: number } {
    const base = this.playerBudget ?? this.startBill;
    const m = this.multiplier;
    return {
      budget: {
        metal: math.max(this.startBill.metal, base.metal * m),
        fuel: math.max(this.startBill.fuel, base.fuel * m),
        build: math.max(this.startBill.build, base.build * m),
      },
      maxShips: math.max(this.startShips, this.settings.maxShips),
    };
  }

  /** Do up to `steps` battle steps of work. Whether there is an answer. */
  advance(steps: number): boolean {
    let left = steps;
    while (left > 0 && this.found === null) {
      if (this.checking !== null) left -= this.check(left);
      else if (this.unchecked.length > 0) this.startCheck(this.unchecked.shift()!);
      else if (this.finishing) this.nextGeneration();
      else if (this.next < this.standings.length * this.seeds.length) left -= this.fight(left);
      else this.finishGeneration();
    }
    return this.found !== null;
  }

  private begin(): void {
    const parent = this.best.enemy;
    this.standings = [{ enemy: parent, wins: 0, onRound: false, margin: 0 }];
    const limits = { ...this.limits, radius: this.radius, ship: this.bred.ship, operators: this.bred.operators };
    for (let i = 0; i < this.settings.mutants; i++) {
      const child = mutateFleet(parent, this.rng, limits).fleet;
      this.standings.push({ enemy: child, wins: 0, onRound: false, margin: 0 });
    }
    this.seeds = [this.wonSeed];
    while (this.seeds.length < this.settings.seeds) this.seeds.push(this.rng.nextUint32());
    this.next = 0;
    this.battle = null;
  }

  /** Fight the current match for up to `steps`; how many it took. */
  private fight(steps: number): number {
    const seedCount = this.seeds.length;
    const standing = this.standings[math.floor(this.next / seedCount)]!;
    const battle = (this.battle ??= customBattle(roundBattle(this.player, standing.enemy, this.seeds[this.next % seedCount]!, this.settings)));
    let taken = 0;
    const limit = math.round(this.settings.duration / battle.dt);
    while (taken < steps) {
      battle.step();
      taken++;
      const tick = battle.world.tick;
      if (tick % CHECK_EVERY !== 0 && tick < limit) continue;
      const now = tally(battle, 2);
      const decided = winner(now);
      if (decided === null && tick < limit) continue;
      // How much more of itself the enemy has left than the player, as a share
      // of each: a loss that hurt the player more is a better loss.
      const ahead = share(now[1]!.mass, battle.start[1]!.mass) - share(now[0]!.mass, battle.start[0]!.mass);
      // A loss is worth more the longer it was held off, which is what lets a
      // search that loses every match still tell its enemies apart.
      const held = math.min(1, tick / limit);
      standing.margin += ahead + (decided === 1 ? 1 : decided !== null ? held - 1 : 0);
      // Ahead when time runs out is taken as a win to come.
      const win = decided === 1 || (decided === null && ahead > 0);
      if (win) standing.wins++;
      // The round's own seed is always the first an enemy fights.
      if (this.next % seedCount === 0) standing.onRound = win;
      this.next++;
      this.battle = null;
      break;
    }
    return taken;
  }

  /** Every match fought: pick the best, and check each that won on the round, the better first. */
  private finishGeneration(): void {
    const better = (a: Standing, b: Standing): boolean => a.wins > b.wins || (a.wins === b.wins && a.margin > b.margin);
    let best = this.standings[0]!;
    for (const standing of this.standings) if (better(standing, best)) best = standing;
    this.best = best;
    const onRound = this.standings.filter((standing) => standing.onRound);
    onRound.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
    this.unchecked.push(...onRound);
    this.finishing = true;
  }

  /** The generation done and its winners checked: count it, and breed the next. */
  private nextGeneration(): void {
    this.finishing = false;
    this.generationCount++;
    // Long without an answer: a bigger budget, for good.
    if (this.generationCount % this.settings.stretchAfter === 0) {
      this.multiplier = nextMultiplier(this.multiplier, this.settings.budgetStep);
    }
    this.begin();
  }

  private startCheck(standing: Standing): void {
    this.checking = {
      standing,
      battle: customBattle(roundBattle(this.player, standing.enemy, this.wonSeed, this.settings)),
      activity: new Activity(2, this.settings.timeCap, this.settings.quietTime),
    };
  }

  /** Fight the round to its decision for up to `steps`; how many it took. */
  private check(steps: number): number {
    const checking = this.checking!;
    let taken = 0;
    let decision: Decision | null = null;
    while (taken < steps && decision === null) {
      checking.battle.step();
      taken++;
      decision = checking.activity.observe(checking.battle);
    }
    if (decision !== null) {
      this.checking = null;
      // Its win on the round is the decision's, not the time limit's.
      checking.standing.onRound = decision.winner === 1;
      if (decision.winner === 1) {
        this.found = checking.standing.enemy;
        this.best = checking.standing;
        this.unchecked.length = 0;
        this.generationCount++;
      }
    }
    return taken;
  }
}

function share(now: number, start: number): number {
  return start > 0 ? now / start : 0;
}
