import { fleetBill, fleetHulls, fleetReach, math, Rng, type Budget, type Fleet } from '../sim/index.js';
import { customBattle, tally, winner, type CustomBattle } from '../scenarios/customBattle.js';
import { Activity, type Decision } from '../scenarios/decision.js';
import { roundBattle } from '../scenarios/skirmish.js';
import { mutateFleet, DEFAULT_FLEET_LIMITS } from './fleetMutate.js';

/**
 * The skirmish enemy's answer to a fleet that beat it (ROADMAP.md §8 step 5):
 * mutants of the enemy fought against the player's fleet, held fixed, until
 * one beats it.
 *
 * A generation is the best enemy so far and a handful of its mutants, each
 * fought on the seed the player won on and on a few random ones, so it cannot
 * win by a fluke of one seed. A match is fought under evolution's rules — over
 * once one side alone is armed, or at a time limit, an enemy ahead then being
 * taken to win in the end — and the best of the generation breeds the next.
 * An enemy that wins all its matches is checked by fighting the round itself
 * to the skirmish's decision, and is the answer only if it wins that too.
 *
 * An answer may cost half as much again as the enemy it answers, so a round
 * cannot double it; a search that goes long without one may grow by as much
 * again, and again.
 *
 * Worked a step at a time, so a page or a worker can do it in slices and look
 * in between. Everything is decided by the seed it is given.
 */

export interface AnswerSettings {
  /** Mutants a generation, beside the best so far. */
  readonly mutants: number;
  /** Matches each enemy fights a generation, the seed the round was won on among them. */
  readonly seeds: number;
  /** How long a match may last before the side ahead is taken to win, s. */
  readonly duration: number;
  /**
   * How much bigger an answer may be than the enemy it answers: its metal, fuel
   * and build time, and its ships, though always one more ship than it had.
   */
  readonly growth: number;
  /** Generations without an answer before the enemy may grow by `growth` again. */
  readonly stretchAfter: number;
}

export const DEFAULT_ANSWER: AnswerSettings = { mutants: 5, seeds: 3, duration: 180, growth: 1.5, stretchAfter: 20 };

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
  /** How many times the enemy has been let grow by `growth`: once to begin with, and once more each stretch. */
  readonly stretch: number;
}

export class EnemySearch {
  private readonly rng: Rng;
  private readonly settings: AnswerSettings;
  private readonly radius: number;
  /** What the enemy cost and how many ships it had, which the answer may grow from. */
  private readonly startBill: Budget;
  private readonly startShips: number;
  private stretch = 1;
  private generationCount = 0;
  private best: Standing;
  private found: Fleet | null = null;

  // The generation being fought.
  private standings: Standing[] = [];
  private seeds: number[] = [];
  private next = 0;
  private battle: CustomBattle | null = null;
  // The round being fought to its decision, by the enemy that won every match.
  private checking: { enemy: Fleet; battle: CustomBattle; activity: Activity } | null = null;
  private readonly unchecked: Fleet[] = [];

  constructor(
    private readonly player: Fleet,
    enemy: Fleet,
    /** The seed the player won the round on. */
    private readonly wonSeed: number,
    seed: number,
    settings: Partial<AnswerSettings> = {},
  ) {
    this.rng = new Rng(seed);
    this.settings = { ...DEFAULT_ANSWER, ...settings };
    // Room to grow beyond where it stands, which a stock fleet may already be past the default of.
    this.radius = math.max(DEFAULT_FLEET_LIMITS.radius, 1.5 * fleetReach(fleetHulls(enemy)));
    const hulls = fleetHulls(enemy);
    this.startBill = fleetBill(hulls);
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
      stretch: this.stretch,
    };
  }

  /** What an answer may cost and field, at the growth allowed so far. */
  get limits(): { budget: Budget; maxShips: number } {
    let factor = 1;
    for (let i = 0; i < this.stretch; i++) factor *= this.settings.growth;
    const { metal, fuel, build } = this.startBill;
    return {
      budget: { metal: metal * factor, fuel: fuel * factor, build: build * factor },
      maxShips: math.max(math.ceil(this.startShips * factor), this.startShips + this.stretch),
    };
  }

  /** Do up to `steps` battle steps of work. Whether there is an answer. */
  advance(steps: number): boolean {
    let left = steps;
    while (left > 0 && this.found === null) {
      if (this.checking !== null) left -= this.check(left);
      else if (this.unchecked.length > 0) this.startCheck(this.unchecked.shift()!);
      else if (this.next < this.standings.length * this.seeds.length) left -= this.fight(left);
      else this.finishGeneration();
    }
    return this.found !== null;
  }

  private begin(): void {
    const parent = this.best.enemy;
    this.standings = [{ enemy: parent, wins: 0, onRound: false, margin: 0 }];
    const limits = { ...this.limits, radius: this.radius };
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
    const battle = (this.battle ??= customBattle(roundBattle(this.player, standing.enemy, this.seeds[this.next % seedCount]!)));
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

  private finishGeneration(): void {
    this.generationCount++;
    let best = this.standings[0]!;
    for (const standing of this.standings) {
      if (standing.wins > best.wins || (standing.wins === best.wins && standing.margin > best.margin)) best = standing;
    }
    this.best = best;
    for (const standing of this.standings) if (standing.wins === this.seeds.length) this.unchecked.push(standing.enemy);
    // Long without an answer: let it grow by as much again.
    if (this.generationCount % this.settings.stretchAfter === 0) this.stretch++;
    this.begin();
  }

  private startCheck(enemy: Fleet): void {
    this.checking = { enemy, battle: customBattle(roundBattle(this.player, enemy, this.wonSeed)), activity: new Activity(2) };
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
      if (decision.winner === 1) this.found = checking.enemy;
    }
    return taken;
  }
}

function share(now: number, start: number): number {
  return start > 0 ? now / start : 0;
}
