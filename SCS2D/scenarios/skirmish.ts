import {
  affords,
  fleetBill,
  fleetHulls,
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
}

/** Clear water between the two fleets' furthest hulls at the start, metres. */
const GAP = 1500;
/** The closest the fleets' origins start, metres: the custom battle's default range. */
const MIN_RANGE = 2000;

export function billOfFleet(fleet: Fleet): Bill {
  return fleetBill(fleetHulls(fleet));
}

/** A skirmish against `enemy`, its cost the player's budget. */
export function newSkirmish(enemy: Fleet, player: Fleet, seed: number): Skirmish {
  return { enemy, player, budget: billOfFleet(enemy), round: 1, tries: 0, seed: seed >>> 0 };
}

/** Whether the player's fleet is within budget and has a ship to fight with. */
export function canFight(skirmish: Skirmish): boolean {
  return skirmish.player.ships.length > 0 && affords(skirmish.budget, billOfFleet(skirmish.player));
}

/** The battle a round is: the player's fleet first, so it is blue. */
export function roundSetup(skirmish: Skirmish): BattleSetup {
  const reach = fleetReach(fleetHulls(skirmish.player)) + fleetReach(fleetHulls(skirmish.enemy));
  return {
    fleets: [skirmish.player, skirmish.enemy],
    range: math.max(MIN_RANGE, reach + GAP),
    closingSpeed: 0,
    crossingSpeed: 0,
    rotation: 0,
    seed: skirmish.seed,
  };
}

/** The same round, to be fought again. */
export function lost(skirmish: Skirmish): Skirmish {
  return { ...skirmish, tries: skirmish.tries + 1 };
}

/** The next round, against `enemy`, on a new seed. */
export function nextRound(skirmish: Skirmish, enemy: Fleet): Skirmish {
  return {
    ...skirmish,
    enemy,
    budget: billOfFleet(enemy),
    round: skirmish.round + 1,
    tries: 0,
    seed: new Rng(skirmish.seed).nextUint32(),
  };
}

export function serialiseSkirmish(skirmish: Skirmish): Record<string, unknown> {
  return {
    formatVersion: SKIRMISH_FORMAT_VERSION,
    round: skirmish.round,
    tries: skirmish.tries,
    seed: skirmish.seed,
    budget: { ...skirmish.budget },
    enemy: serialiseFleet(skirmish.enemy),
    player: serialiseFleet(skirmish.player),
  };
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
  return {
    round: whole('round', 1),
    tries: whole('tries', 0),
    seed: whole('seed', 0),
    budget: { metal: amount('metal'), fuel: amount('fuel'), build: amount('build') },
    enemy: fleet('enemy'),
    player: fleet('player'),
  };
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
