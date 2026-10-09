import {
  degreesToRadians,
  math,
  NEUTRAL_TEAM,
  parseFleet,
  radiansToDegrees,
  Rng,
  serialiseFleet,
  type Fleet,
} from '../sim/index.js';
import { fleetBattle } from './fleetBattle.js';
import type { Battle } from './types.js';

/**
 * A battle somebody sets up rather than one written as code: fleets, how far
 * apart they start, how fast they arrive, and a seed. The setup is a file, so
 * a battle can be sent to someone and fought again exactly.
 */

export const BATTLE_FORMAT_VERSION = 1;

export interface BattleSetup {
  /** Each its own side. One alone is a battle with nobody to fight, which is how an escort is watched. */
  fleets: Fleet[];
  /** Across the ring the fleets start on, metres. */
  range: number;
  /** Each fleet's own speed towards the centre, m/s. */
  closingSpeed: number;
  /** Each fleet's own speed to its left, m/s. */
  crossingSpeed: number;
  /** How far each fleet is turned from facing the centre, radians anticlockwise. Degrees in the file. */
  rotation: number;
  seed: number;
  /**
   * How far either side of `range`, the speeds and `rotation` the battle may
   * be drawn, evenly, from its seed; absent or zero holds them. Rotation's in
   * radians, degrees in the file. So a battle file can stand for a family of
   * battles, and the seed picks one.
   */
  spread?: BattleSpread;
}

export interface BattleSpread {
  range?: number;
  closingSpeed?: number;
  crossingSpeed?: number;
  rotation?: number;
}

const SPREAD_KEYS: readonly (keyof BattleSpread)[] = ['range', 'closingSpeed', 'crossingSpeed', 'rotation'];

export const DEFAULT_SETUP: Omit<BattleSetup, 'fleets'> = {
  range: 2000,
  closingSpeed: 0,
  crossingSpeed: 0,
  rotation: 0,
  seed: 1,
};

const FILE_KEYS: readonly string[] = ['formatVersion', 'fleets', 'range', 'closingSpeed', 'crossingSpeed', 'rotation', 'seed', 'spread'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown, what: string): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? null : `${what} must be a finite number, got ${JSON.stringify(value)}`;
}

/** What makes a battle file unreadable, or null. Fleets are checked as fleet files. */
export function battleSetupProblem(value: unknown): string | null {
  if (!isObject(value)) return `a battle file must be an object, got ${JSON.stringify(value)}`;
  const extra = Object.keys(value).filter((key) => !FILE_KEYS.includes(key));
  if (extra.length > 0) return `unknown ${extra.length > 1 ? 'keys' : 'key'} ${extra.join(', ')}`;
  if (value['formatVersion'] !== BATTLE_FORMAT_VERSION) {
    return `formatVersion must be ${BATTLE_FORMAT_VERSION}, got ${JSON.stringify(value['formatVersion'])}`;
  }
  const fleets = value['fleets'];
  if (!Array.isArray(fleets) || fleets.length < 1) return 'fleets must be a list of at least one fleet';
  for (let i = 0; i < fleets.length; i++) {
    try {
      parseFleet(fleets[i]);
    } catch (error) {
      return `fleets[${i}]: ${(error as Error).message}`;
    }
  }
  const problem =
    finite(value['range'], 'range') ??
    finite(value['closingSpeed'], 'closingSpeed') ??
    finite(value['crossingSpeed'], 'crossingSpeed') ??
    (value['rotation'] === undefined ? null : finite(value['rotation'], 'rotation')) ??
    finite(value['seed'], 'seed');
  if (problem !== null) return problem;
  if (!((value['range'] as number) > 0)) return 'range must be greater than zero';
  const spread = value['spread'];
  if (spread !== undefined) {
    if (!isObject(spread)) return 'spread must be an object';
    const unknown = Object.keys(spread).filter((key) => !(SPREAD_KEYS as readonly string[]).includes(key));
    if (unknown.length > 0) return `spread: unknown ${unknown.length > 1 ? 'keys' : 'key'} ${unknown.join(', ')}`;
    for (const key of SPREAD_KEYS) {
      if (spread[key] === undefined) continue;
      const bad = finite(spread[key], `spread.${key}`);
      if (bad !== null) return bad;
      if ((spread[key] as number) < 0) return `spread.${key} must not be negative`;
    }
  }
  if (!Number.isInteger(value['seed'])) return 'seed must be a whole number';
  return null;
}

export function parseBattleSetup(value: unknown): BattleSetup {
  const problem = battleSetupProblem(value);
  if (problem !== null) throw new Error(`Invalid battle file — ${problem}`);
  const file = value as Record<string, unknown>;
  return {
    fleets: (file['fleets'] as unknown[]).map((fleet) => parseFleet(fleet)),
    range: file['range'] as number,
    closingSpeed: file['closingSpeed'] as number,
    crossingSpeed: file['crossingSpeed'] as number,
    rotation: file['rotation'] === undefined ? 0 : degreesToRadians(file['rotation'] as number),
    seed: file['seed'] as number,
    ...(file['spread'] === undefined ? {} : { spread: readSpread(file['spread'] as Record<string, number>) }),
  };
}

function readSpread(raw: Record<string, number>): BattleSpread {
  const out: BattleSpread = {};
  for (const key of SPREAD_KEYS) {
    if (raw[key] !== undefined) out[key] = key === 'rotation' ? degreesToRadians(raw[key]) : raw[key];
  }
  return out;
}

/** Whether a setup varies at all from one seed to the next. */
function spreads(spread: BattleSpread | undefined): spread is BattleSpread {
  return spread !== undefined && SPREAD_KEYS.some((key) => (spread[key] ?? 0) > 0);
}

/**
 * The battle a setup's seed picks out of its spread: each figure drawn evenly
 * within its spread either side, from a generator of its own so the battle's
 * other draws are the ones an unspread setup would make. Unchanged where
 * nothing spreads.
 */
export function drawnSetup(setup: BattleSetup): BattleSetup {
  if (!spreads(setup.spread)) return setup;
  const draw = new Rng(setup.seed ^ 0x5b4ead);
  // All four, always in this order, so one spread widening leaves the rest.
  const off = (key: keyof BattleSpread): number => (setup.spread![key] ?? 0) * draw.nextRange(-1, 1);
  const range = setup.range + off('range');
  const closingSpeed = setup.closingSpeed + off('closingSpeed');
  const crossingSpeed = setup.crossingSpeed + off('crossingSpeed');
  const rotation = setup.rotation + off('rotation');
  return { ...setup, range: math.max(1, range), closingSpeed, crossingSpeed, rotation };
}

/** Rotation is written only when there is one, so a file from before it existed reads back the same. */
export function serialiseBattleSetup(setup: BattleSetup): Record<string, unknown> {
  return {
    formatVersion: BATTLE_FORMAT_VERSION,
    seed: setup.seed,
    range: setup.range,
    closingSpeed: setup.closingSpeed,
    crossingSpeed: setup.crossingSpeed,
    ...(setup.rotation !== 0 ? { rotation: radiansToDegrees(setup.rotation) } : {}),
    ...(spreads(setup.spread) ? { spread: writeSpread(setup.spread) } : {}),
    fleets: setup.fleets.map(serialiseFleet),
  };
}

function writeSpread(spread: BattleSpread): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of SPREAD_KEYS) {
    const value = spread[key] ?? 0;
    if (value > 0) out[key] = key === 'rotation' ? radiansToDegrees(value) : value;
  }
  return out;
}

/** How one side stands. */
export interface SideTally {
  team: number;
  /** Ships still under control: a core that works. Pieces that come off are not counted. */
  ships: number;
  /** Their mass, kg. */
  mass: number;
  /** Of those, the ones with a gun or a weapon engine still working. */
  armed: number;
  /** And the ones with an engine still working. */
  mobile: number;
}

export interface CustomBattle extends Battle {
  readonly setup: BattleSetup;
  /** Each side as it started. */
  readonly start: readonly SideTally[];
}

export function customBattle(setup: BattleSetup): CustomBattle {
  const drawn = drawnSetup(setup);
  const battle = fleetBattle(setup.fleets, {
    seed: drawn.seed,
    range: drawn.range,
    closingSpeed: drawn.closingSpeed,
    crossingSpeed: drawn.crossingSpeed,
    rotation: drawn.rotation,
    projectiles: 1024,
    beams: 256,
  });
  return Object.assign(battle, { setup, start: tally(battle, setup.fleets.length) });
}

/**
 * Each side as it stands now: the ships still under command and their mass,
 * counted with full tanks.
 * A hulk is a hull with its cores out, as doctrine has it, so a ship that has
 * lost only its guns still counts.
 */
export function tally(battle: Battle, sides: number): SideTally[] {
  const out: SideTally[] = [];
  for (let team = 0; team < sides; team++) out.push({ team, ships: 0, mass: 0, armed: 0, mobile: 0 });
  const { ships, world } = battle;
  for (let i = 0; i < ships.highWater; i++) {
    if (!ships.isAlive(i) || !ships.hasControl(i)) continue;
    const team = ships.teamOf(i);
    if (team === NEUTRAL_TEAM || out[team] === undefined) continue;
    const body = world.bodies.indexOf(ships.body(i));
    out[team]!.ships++;
    if (!ships.isDisarmed(i)) out[team]!.armed++;
    if (!ships.hasNoEngines(i)) out[team]!.mobile++;
    // Fuel burnt and rounds fired are not mass lost to the enemy.
    out[team]!.mass += body >= 0 ? world.bodies.mass[body]! + ships.fuel.spentMass(body) + ships.metal.spentMass(body) : 0;
  }
  return out;
}

/**
 * The side left able to fight once no other is, -1 when none is, or null while
 * two or more still are. Armed, not merely under control: two sides with nothing left
 * to shoot with would otherwise drift for ever without deciding anything.
 */
export function winner(sides: readonly SideTally[]): number | null {
  const standing = sides.filter((side) => side.armed > 0);
  if (standing.length > 1) return null;
  return standing[0]?.team ?? -1;
}
