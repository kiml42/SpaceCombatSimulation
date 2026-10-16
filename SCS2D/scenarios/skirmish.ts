import {
  affords,
  blueprintProblem,
  expandFleet,
  fleetBill,
  fleetHulls,
  fleetProblem,
  fleetReach,
  math,
  parseFleet,
  Rng,
  serialiseFleet,
  type Bill,
  type Budget,
  type Fleet,
} from '../sim/index.js';
import type { BattleSetup } from './customBattle.js';
import { QUIET_TIME, TIME_CAP } from './decision.js';

/**
 * A skirmish: the player's fleet against an enemy, a round at a time
 * (ROADMAP.md §8 step 5). The player's fleet must fit a budget set by the
 * enemy it first faced; a round is one battle with a fixed seed, fought again
 * until the player wins it.
 */

export const SKIRMISH_FORMAT_VERSION = 1;

export interface Skirmish {
  enemy: Fleet;
  player: Fleet;
  /** What the player's fleet may cost. */
  budget: Budget;
  /** Counting from 1. */
  round: number;
  /** How many times this round has been fought. */
  tries: number;
  /** This round's seed. */
  seed: number;
  /**
   * Set once the player has won the round, on the seed it was won on, while
   * the enemy evolves an answer; cleared by the next round.
   */
  won?: number;
  /** What it is played under; the defaults where it says nothing. */
  settings?: SkirmishSettings;
  /**
   * The enemy's budget as a multiple of the player's, 1 where not said. It
   * steps up by `budgetStep` each time the enemy's search stalls, and never falls.
   */
  multiplier?: number;
}

/**
 * What a skirmish is played under: how a round is set out and decided, and
 * how the enemy evolves its answer. Chosen when it starts, and kept with it.
 */
export interface SkirmishSettings {
  /** A side that has not fired, hit or rammed for this long is out, s. */
  readonly quietTime: number;
  /** A battle not decided by then is a draw, which is a loss for the player, s. */
  readonly timeCap: number;
  /** Clear water between the two fleets' furthest hulls at the start, metres. */
  readonly gap: number;
  /** Each fleet's starting speed towards the other, m/s. */
  readonly closingSpeed: number;
  /** Each fleet's starting speed across the line between them, to its left, m/s. */
  readonly crossingSpeed: number;
  /** How far either side of those three each round's are drawn, evenly; zero holds them. */
  readonly gapSpread: number;
  readonly closingSpread: number;
  readonly crossingSpread: number;
  /** Mutants a generation of the enemy's search, beside the best so far. */
  readonly mutants: number;
  /** Matches each enemy fights a generation, the seed the round was won on among them. */
  readonly seeds: number;
  /** How long a match of the search may last before the side ahead is taken to win, s. */
  readonly duration: number;
  /** What is added to the enemy's budget multiplier each time its search stalls, from the step below. */
  readonly budgetStep: number;
  /** Generations without an answer before the multiplier steps up again. */
  readonly stretchAfter: number;
  /**
   * The most ships either side may field, unless the enemy already has more:
   * a limit on the work a battle is, more than on the fleets.
   */
  readonly maxShips: number;
  /** How far from its origin any of either side's hulls may reach, unless the enemy already reaches further, metres. */
  readonly radius: number;
  /**
   * How the enemy is bred: the mutation odds by the names the settings pages
   * give them (`evolution/mutationFields.ts`), each missing one its default.
   */
  readonly breeding: Readonly<Record<string, number>>;
}

export const DEFAULT_SKIRMISH_SETTINGS: SkirmishSettings = {
  quietTime: QUIET_TIME,
  timeCap: TIME_CAP,
  gap: 1500,
  closingSpeed: 0,
  crossingSpeed: 0,
  gapSpread: 0,
  closingSpread: 0,
  crossingSpread: 0,
  mutants: 5,
  seeds: 3,
  duration: 180,
  budgetStep: 0.1,
  stretchAfter: 4,
  maxShips: 20,
  radius: 500,
  breeding: {},
};

/** What a skirmish is played under. */
export function settingsOf(skirmish: Skirmish): SkirmishSettings {
  return skirmish.settings ?? DEFAULT_SKIRMISH_SETTINGS;
}

/** The closest the fleets' origins start, metres: the custom battle's default range. */
const MIN_RANGE = 2000;

export function billOfFleet(fleet: Fleet): Bill {
  return fleetBill(fleetHulls(fleet));
}

/** A skirmish against `enemy`, the player's budget what it cost unless given. */
export function newSkirmish(enemy: Fleet, player: Fleet, seed: number, settings?: SkirmishSettings, budget?: Budget): Skirmish {
  return {
    enemy,
    player,
    budget: budget === undefined ? billOfFleet(enemy) : { ...budget },
    round: 1,
    tries: 0,
    seed: seed >>> 0,
    ...(settings === undefined ? {} : { settings }),
  };
}

/**
 * What stops a fleet being priced or fought, short of its cost: an entry it
 * cannot place, or a design it flies that would not fly. Null if nothing.
 */
export function fleetFault(fleet: Fleet): string | null {
  const problem = fleetProblem(fleet);
  if (problem !== null) return problem;
  for (const name of new Set(expandFleet(fleet).map((ship) => ship.design))) {
    const design = blueprintProblem(fleet.designs[name]!);
    if (design !== null) return design;
  }
  return null;
}

/**
 * How the player's fleet breaks the skirmish's limit on ships or spread, or
 * null if it does not. Each limit is at least what the enemy fields.
 */
export function overLimit(skirmish: Skirmish): string | null {
  const settings = settingsOf(skirmish);
  const enemy = fleetHulls(skirmish.enemy);
  const maxShips = math.max(settings.maxShips, enemy.length);
  const radius = math.max(settings.radius, math.ceil(fleetReach(enemy)));
  const hulls = fleetHulls(skirmish.player);
  if (hulls.length > maxShips) return `${hulls.length} ships, more than the ${maxShips} allowed`;
  const reach = fleetReach(hulls);
  if (reach > radius) return `reaches ${math.round(reach)} m from its origin, beyond the ${radius} m allowed`;
  return null;
}

/** Whether the player's fleet has a ship to fight with, every design flies, and it is within budget and limits. */
export function canFight(skirmish: Skirmish): boolean {
  const player = skirmish.player;
  return (
    player.ships.length > 0 &&
    fleetFault(player) === null &&
    overLimit(skirmish) === null &&
    affords(skirmish.budget, billOfFleet(player))
  );
}

/** The battle a round is: the player's fleet first, so it is blue. */
export function roundSetup(skirmish: Skirmish): BattleSetup {
  return roundBattle(skirmish.player, skirmish.enemy, skirmish.seed, settingsOf(skirmish));
}

type Opening = Pick<
  SkirmishSettings,
  'gap' | 'closingSpeed' | 'crossingSpeed' | 'gapSpread' | 'closingSpread' | 'crossingSpread'
>;

/** Two fleets as a round sets them out, on this seed, which also draws the gap and speeds from their spreads. */
export function roundBattle(player: Fleet, enemy: Fleet, seed: number, settings: Opening = DEFAULT_SKIRMISH_SETTINGS): BattleSetup {
  // Always all three, in this order, so that widening one spread does not move the others.
  const draw = new Rng(seed ^ 0x5b4ead);
  const gap = settings.gap + settings.gapSpread * draw.nextRange(-1, 1);
  const closingSpeed = settings.closingSpeed + settings.closingSpread * draw.nextRange(-1, 1);
  const crossingSpeed = settings.crossingSpeed + settings.crossingSpread * draw.nextRange(-1, 1);
  const reach = fleetReach(fleetHulls(player)) + fleetReach(fleetHulls(enemy));
  return {
    fleets: [player, enemy],
    range: math.max(MIN_RANGE, reach + math.max(0, gap)),
    closingSpeed,
    crossingSpeed,
    rotation: 0,
    seed,
  };
}

/** The enemy's budget as a multiple of the player's, as kept. */
export function multiplierOf(skirmish: Skirmish): number {
  return skirmish.multiplier ?? 1;
}

/**
 * A multiplier no less than the enemy needs to afford itself: an enemy that
 * already costs 1.325 times the player's budget is a 1.325× enemy. A currency
 * the player has none of does not count.
 */
export function startingMultiplier(multiplier: number, budget: Budget, enemyBill: Bill): number {
  let m = multiplier;
  for (const key of ['metal', 'fuel', 'build'] as const) {
    if (budget[key] > 0) m = math.max(m, enemyBill[key] / budget[key]);
  }
  return m;
}

/** The next step up from `m`: onto the step's grid first, so 1.325 goes to 1.4, and up a step from there. */
export function nextMultiplier(m: number, step: number): number {
  if (!(step > 0)) return m;
  // Rounded, so 1.1 + 0.1 is not 1.2000000000000002, and a value on the grid is taken as on it.
  const steps = math.floor(math.round((m / step) * 1e6) / 1e6) + 1;
  return math.round(steps * step * 1e9) / 1e9;
}

/** The size of enemy the player is facing: its budget as a multiple of theirs. */
export function enemyMultiplier(skirmish: Skirmish): number {
  return startingMultiplier(multiplierOf(skirmish), skirmish.budget, billOfFleet(skirmish.enemy));
}

/** The round won: the enemy is to answer it, on the seed it was won on. */
export function won(skirmish: Skirmish): Skirmish {
  return { ...skirmish, won: skirmish.seed };
}

/** The same round, to be fought again. */
export function lost(skirmish: Skirmish): Skirmish {
  return { ...skirmish, tries: skirmish.tries + 1 };
}

/**
 * The next round, against the enemy's answer, on a new seed. The budget is
 * the player's and does not follow the enemy, whose is unlimited.
 */
export function nextRound(skirmish: Skirmish, enemy: Fleet): Skirmish {
  const { won: _, ...rest } = skirmish;
  return { ...rest, enemy, round: skirmish.round + 1, tries: 0, seed: new Rng(skirmish.seed).nextUint32() };
}

export function serialiseSkirmish(skirmish: Skirmish): Record<string, unknown> {
  return {
    formatVersion: SKIRMISH_FORMAT_VERSION,
    round: skirmish.round,
    tries: skirmish.tries,
    seed: skirmish.seed,
    ...(skirmish.won === undefined ? {} : { won: skirmish.won }),
    ...(skirmish.multiplier === undefined ? {} : { multiplier: skirmish.multiplier }),
    budget: { ...skirmish.budget },
    enemy: serialiseFleet(skirmish.enemy),
    player: serialiseFleet(skirmish.player),
    ...(skirmish.settings === undefined ? {} : { settings: { ...skirmish.settings, breeding: { ...skirmish.settings.breeding } } }),
  };
}

/** Settings as a file holds them, every number checked; what it leaves out is the default. */
export function parseSkirmishSettings(value: unknown): SkirmishSettings {
  const fail = (problem: string): never => {
    throw new Error(`Invalid skirmish settings — ${problem}`);
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('they must be an object');
  const file = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_SKIRMISH_SETTINGS) as (keyof SkirmishSettings)[]) {
    if (key === 'breeding') continue;
    const n = file[key];
    if (n === undefined) continue;
    // Speeds may be negative; nothing else may.
    const signed = key === 'closingSpeed' || key === 'crossingSpeed';
    if (typeof n !== 'number' || !Number.isFinite(n) || (!signed && n < 0)) fail(`${key} must be a number${signed ? '' : ' of at least zero'}`);
    out[key] = n;
  }
  const breeding: Record<string, number> = {};
  const raw = file['breeding'];
  if (raw !== undefined) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('breeding must be an object');
    for (const [name, n] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) fail(`breeding.${name} must be a number of at least zero`);
      breeding[name] = n as number;
    }
  }
  return { ...DEFAULT_SKIRMISH_SETTINGS, ...out, breeding };
}

export function parseSkirmish(value: unknown): Skirmish {
  const fail = (problem: string): never => {
    throw new Error(`Invalid skirmish — ${problem}`);
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('it must be an object');
  const file = value as Record<string, unknown>;
  if (file['formatVersion'] !== SKIRMISH_FORMAT_VERSION) {
    fail(`formatVersion must be ${SKIRMISH_FORMAT_VERSION}, got ${JSON.stringify(file['formatVersion'])}`);
  }
  const whole = (key: string, least: number): number => {
    const n = file[key];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < least) fail(`${key} must be a whole number of at least ${least}`);
    return n as number;
  };
  const budget = file['budget'];
  if (typeof budget !== 'object' || budget === null) fail('budget must be an object');
  const amount = (key: keyof Budget): number => {
    const n = (budget as Record<string, unknown>)[key];
    if (typeof n !== 'number' || !(n >= 0)) fail(`budget.${key} must be a number of at least zero`);
    return n as number;
  };
  // An empty fleet is how a player starts building one, which a fleet file does not allow.
  const fleet = (key: string): Fleet => {
    const raw = file[key] as Record<string, unknown> | undefined;
    if (raw !== undefined && Array.isArray(raw['ships']) && raw['ships'].length === 0) {
      return { name: typeof raw['name'] === 'string' ? raw['name'] : 'My fleet', designs: {}, ships: [] };
    }
    try {
      return parseFleet(raw);
    } catch (error) {
      return fail(`${key}: ${(error as Error).message}`);
    }
  };
  const wonSeed = file['won'] === undefined ? undefined : whole('won', 0);
  const multiplier = file['multiplier'];
  if (multiplier !== undefined && (typeof multiplier !== 'number' || !(multiplier > 0) || !Number.isFinite(multiplier))) {
    fail('multiplier must be a number above zero');
  }
  return {
    ...(wonSeed === undefined ? {} : { won: wonSeed }),
    ...(multiplier === undefined ? {} : { multiplier: multiplier as number }),
    round: whole('round', 1),
    tries: whole('tries', 0),
    seed: whole('seed', 0),
    budget: { metal: amount('metal'), fuel: amount('fuel'), build: amount('build') },
    enemy: fleet('enemy'),
    player: fleet('player'),
    ...(file['settings'] === undefined ? {} : { settings: settingsIn(file['settings']) }),
  };
  function settingsIn(raw: unknown): SkirmishSettings {
    try {
      return parseSkirmishSettings(raw);
    } catch (error) {
      return fail(`settings: ${(error as Error).message}`);
    }
  }
}

/** Where a page keeps the skirmish in progress, so it can be picked up again. */
export const SKIRMISH_STORAGE_KEY = 'scs2d.skirmish';

const FRAGMENT = '#skirmish=';

/**
 * The fragment that carries a skirmish between its page and the fleet editor.
 * In the link rather than only in storage, which some browsers do not share
 * between pages opened as files.
 */
export function skirmishFragment(skirmish: Skirmish): string {
  return FRAGMENT + encodeURIComponent(JSON.stringify(serialiseSkirmish(skirmish)));
}

/** The skirmish a fragment carries, or null. Throws on one it carries but cannot read. */
export function handedSkirmish(hash: string): Skirmish | null {
  if (!hash.startsWith(FRAGMENT)) return null;
  return parseSkirmish(JSON.parse(decodeURIComponent(hash.slice(FRAGMENT.length))));
}
