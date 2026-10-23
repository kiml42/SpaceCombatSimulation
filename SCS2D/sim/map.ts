import { asteroidBlueprint, circularSpeed } from './asteroid.js';
import type { Blueprint } from './blueprint.js';
import type { WellSpec } from './gravity.js';
import { cos, max, min, round, sin, sqrt, TAU } from './math.js';
import { Railway, type Orbit, type Rails, type System } from './rails.js';
import { Rng } from './rng.js';

/**
 * A battlefield of asteroids, drawn from a seed: majors with kernels, each
 * carrying a well and riding a rail, and minors of loose rock in orbit about
 * them, or adrift where there are no majors.
 */

/**
 * What a map is drawn from. Flat, so every page and file can show and keep it
 * as a row of numbers (`MAP_KEYS`); every figure but the counts falls back to
 * `DEFAULT_MAP`, and no count is none.
 */
export interface MapSettings {
  /** How many major asteroids: each a kernel carrying a well, riding a rail. */
  readonly majors?: number;
  /** Their radius, metres, give or take `majorSpread`, drawn for each. */
  readonly majorSize?: number;
  readonly majorSpread?: number;
  /** How many minor asteroids: loose rock, in orbit or adrift. */
  readonly minors?: number;
  readonly minorSize?: number;
  readonly minorSpread?: number;
  /** The most eccentric a pair of majors' orbit may be, each drawn up to it. */
  readonly eccentricity?: number;
  /** A major's pull at its surface, m/s². */
  readonly surfaceGravity?: number;
  /** The mean share of rock that is ore, and that is ice. */
  readonly metal?: number;
  readonly fuel?: number;
}

export type MapKey = keyof MapSettings;

/** Every setting, in the order a page shows them and a draw takes them. */
export const MAP_KEYS: readonly MapKey[] = [
  'majors',
  'majorSize',
  'majorSpread',
  'minors',
  'minorSize',
  'minorSpread',
  'eccentricity',
  'surfaceGravity',
  'metal',
  'fuel',
];

/** The counts, which are whole numbers. */
const COUNTS: readonly MapKey[] = ['majors', 'minors'];
/** The shares, which are 0 to 1. */
const SHARES: readonly MapKey[] = ['eccentricity', 'metal', 'fuel'];

export const DEFAULT_MAP: Required<MapSettings> = {
  majors: 0,
  majorSize: 300,
  majorSpread: 80,
  minors: 0,
  minorSize: 60,
  minorSpread: 30,
  eccentricity: 0.5,
  surfaceGravity: 0.5,
  metal: 0.2,
  fuel: 0.1,
};

/** What is wrong with a map's settings as read from a file, or null. */
export function mapProblem(value: unknown, where = 'map'): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${where} must be an object`;
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !(MAP_KEYS as readonly string[]).includes(key));
  if (unknown.length > 0) return `${where}: unknown ${unknown.length > 1 ? 'keys' : 'key'} ${unknown.join(', ')}`;
  for (const key of MAP_KEYS) {
    const v = record[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return `${where}.${key} must be a number, not negative`;
    if (COUNTS.includes(key) && !Number.isInteger(v)) return `${where}.${key} must be a whole number`;
    if (SHARES.includes(key) && v > 1) return `${where}.${key} must be no more than 1`;
  }
  if (((record['metal'] as number | undefined) ?? 0) + ((record['fuel'] as number | undefined) ?? 0) > 1) {
    return `${where}: metal and fuel together must be no more than 1`;
  }
  return null;
}

/** Only what differs from none, so a map left empty writes nothing and an old file reads back the same. */
export function writeMap(settings: MapSettings): MapSettings | undefined {
  const out: Partial<Record<MapKey, number>> = {};
  for (const key of MAP_KEYS) if (settings[key] !== undefined && settings[key] !== DEFAULT_MAP[key]) out[key] = settings[key];
  return hasAsteroids(settings) ? out : undefined;
}

/**
 * A map drawn from settings and how far each may be drawn either side, evenly,
 * as the skirmish draws a round's: counts rounded, shares kept to 0..1 and
 * metal and fuel together to 1. Every key is drawn, in `MAP_KEYS` order, so
 * one spread widening leaves the rest.
 */
export function drawnMap(settings: MapSettings, spread: MapSettings, rng: Rng): MapSettings {
  const out: Partial<Record<MapKey, number>> = {};
  for (const key of MAP_KEYS) {
    const at = settings[key] ?? DEFAULT_MAP[key];
    let v = max(0, at + (spread[key] ?? 0) * rng.nextRange(-1, 1));
    if (COUNTS.includes(key)) v = round(v);
    if (SHARES.includes(key)) v = min(1, v);
    out[key] = v;
  }
  const metal = out.metal!;
  const fuel = out.fuel!;
  if (metal + fuel > 1) {
    out.metal = metal / (metal + fuel);
    out.fuel = fuel / (metal + fuel);
  }
  return out;
}

/** Somewhere an asteroid must keep out of, for the seconds `generateMap` looks ahead. */
export interface Clearing {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** One asteroid, where it starts and how it moves; `rides` is the index of the well it rides, for a major. */
export interface PlacedAsteroid {
  readonly blueprint: Blueprint;
  readonly rides?: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly angle: number;
  readonly angularVel: number;
}

export interface AsteroidMap {
  readonly wells: WellSpec[];
  readonly rails?: Rails;
  readonly asteroids: PlacedAsteroid[];
}

/** Seconds ahead an asteroid is kept clear of where the ships start. */
const LOOK_AHEAD = 10;
/** Gap kept between asteroids, and between an asteroid and a clearing, metres. */
const MARGIN = 100;
/** How far apart a pair's closest approach keeps them, in their reaches added. */
const PAIR_CLEARANCE = 1.6;
/** Tries at a place before an asteroid is left out. */
const TRIES = 200;
/**
 * Fastest a major turns, rad/s, and a minor: slow, as rubble piles do, so the
 * edge of a big one moves no faster than a claw can close on it.
 */
const MAJOR_SPIN = 0.002;
const MINOR_SPIN = 0.01;

/**
 * The well of a major `radius` across that pulls `g` at its surface:
 * softened by its kernel, so the pull stays finite through it.
 */
export function majorWell(radius: number, g: number): WellSpec {
  const soft = radius * 0.45;
  const r2 = radius * radius + soft * soft;
  return { x: 0, y: 0, gm: (g * r2 * sqrt(r2)) / radius, softening: soft };
}

/** Whether a map would put anything in a battle. */
export function hasAsteroids(settings: MapSettings | undefined): boolean {
  return (settings?.majors ?? 0) > 0 || (settings?.minors ?? 0) > 0;
}

/**
 * Draw a map. Its stream is the seed's own, mixed, so a battle's world draws
 * the same whether or not it has a map. Majors' wells come first in `wells`.
 */
export function generateMap(settings: MapSettings, seed: number, clear: readonly Clearing[]): AsteroidMap {
  const rng = new Rng((seed ^ 0x6d617073) >>> 0);
  const g = settings.surfaceGravity ?? DEFAULT_MAP.surfaceGravity;
  const ore = settings.metal ?? DEFAULT_MAP.metal;
  const ice = settings.fuel ?? DEFAULT_MAP.fuel;
  const asteroids: PlacedAsteroid[] = [];
  const placed: Clearing[] = [];

  // Majors, as a system of rails: each joins the system so far as the second of a pair.
  const majors = settings.majors ?? 0;
  const wells: WellSpec[] = [];
  const reach: number[] = [];
  const blueprints: Blueprint[] = [];
  for (let k = 0; k < majors; k++) {
    const radius = drawSize(settings.majorSize ?? DEFAULT_MAP.majorSize, settings.majorSpread ?? DEFAULT_MAP.majorSpread, rng);
    const blueprint = asteroidBlueprint(`Asteroid ${k + 1}`, { radius, kernel: true, ore, ice }, rng);
    blueprints.push(blueprint);
    reach.push(radius);
    wells.push(majorWell(radius, g));
  }
  let rails: Rails | undefined;
  if (majors > 0) {
    let root: System = { well: 0 };
    let extent = reach[0]!;
    for (let k = 1; k < majors; k++) {
      const e = rng.nextFloat() * min(settings.eccentricity ?? DEFAULT_MAP.eccentricity, 0.9);
      const closest = (extent + reach[k]!) * PAIR_CLEARANCE + MARGIN;
      const a = (closest / (1 - e)) * (1 + rng.nextFloat() * 0.5);
      const orbit: Orbit = { a, e, periapsis: rng.nextFloat() * TAU, phase: rng.nextFloat() * TAU };
      root = { pair: [root, { well: k }], orbit };
      extent = a * (1 + e) + max(extent, reach[k]!);
    }
    // Somewhere the system's opening seconds keep clear of every clearing.
    let found: Rails | undefined;
    for (let t = 0; t < TRIES && found === undefined; t++) {
      const out = t === 0 ? 0 : MARGIN * 4 * t;
      const bearing = rng.nextFloat() * TAU;
      const candidate: Rails = { x: out * cos(bearing), y: out * sin(bearing), root };
      const test = new Railway(candidate, wells);
      let clearOf = true;
      for (let s = 0; s <= LOOK_AHEAD && clearOf; s += 2) {
        test.at(s);
        for (let k = 0; k < majors && clearOf; k++) {
          for (const c of clear) if (apart(wells[k]!, c) < reach[k]! + c.radius + MARGIN) clearOf = false;
        }
      }
      if (clearOf) found = candidate;
    }
    rails = found ?? { x: 0, y: 0, root };
    new Railway(rails, wells).at(0);
    for (let k = 0; k < majors; k++) {
      asteroids.push({
        blueprint: blueprints[k]!,
        rides: k,
        x: wells[k]!.x,
        y: wells[k]!.y,
        vx: wells[k]!.vx ?? 0,
        vy: wells[k]!.vy ?? 0,
        angle: rng.nextFloat() * TAU,
        angularVel: (rng.nextFloat() * 2 - 1) * MAJOR_SPIN,
      });
      placed.push({ x: wells[k]!.x, y: wells[k]!.y, radius: reach[k]! });
    }
  }

  // Minors: in orbit about a major, or adrift among the clearings.
  const minors = settings.minors ?? 0;
  let spanX = 0;
  let spanY = 0;
  let span = 1000;
  for (const c of clear) {
    spanX += c.x / max(1, clear.length);
    spanY += c.y / max(1, clear.length);
  }
  for (const c of clear) span = max(span, apart(c, { x: spanX, y: spanY }) + c.radius + 500);
  for (let k = 0; k < minors; k++) {
    const radius = drawSize(settings.minorSize ?? DEFAULT_MAP.minorSize, settings.minorSpread ?? DEFAULT_MAP.minorSpread, rng);
    const blueprint = asteroidBlueprint(`Rock ${k + 1}`, { radius, kernel: false, ore, ice }, rng);
    for (let t = 0; t < TRIES; t++) {
      let x: number;
      let y: number;
      let vx: number;
      let vy: number;
      const bearing = rng.nextFloat() * TAU;
      if (majors > 0) {
        const j = rng.nextInt(majors);
        const well = wells[j]!;
        const d = (reach[j]! + radius) * (1.5 + rng.nextFloat() * 2) + MARGIN;
        const speed = circularSpeed(well.gm, d);
        x = well.x + d * cos(bearing);
        y = well.y + d * sin(bearing);
        vx = (well.vx ?? 0) - speed * sin(bearing);
        vy = (well.vy ?? 0) + speed * cos(bearing);
      } else {
        const d = sqrt(rng.nextFloat()) * span;
        x = spanX + d * cos(bearing);
        y = spanY + d * sin(bearing);
        const drift = rng.nextFloat() * 5;
        const heading = rng.nextFloat() * TAU;
        vx = drift * cos(heading);
        vy = drift * sin(heading);
      }
      let clearOf = true;
      for (const p of placed) if (apart({ x, y }, p) < radius + p.radius + MARGIN) clearOf = false;
      for (let s = 0; s <= LOOK_AHEAD && clearOf; s += 2) {
        for (const c of clear) if (apart({ x: x + vx * s, y: y + vy * s }, c) < radius + c.radius + MARGIN) clearOf = false;
      }
      if (!clearOf) continue;
      asteroids.push({
        blueprint,
        x,
        y,
        vx,
        vy,
        angle: rng.nextFloat() * TAU,
        angularVel: (rng.nextFloat() * 2 - 1) * MINOR_SPIN,
      });
      placed.push({ x, y, radius });
      break;
    }
  }
  return { wells, ...(rails === undefined ? {} : { rails }), asteroids };
}

function drawSize(size: number, spread: number, rng: Rng): number {
  return max(20, size + (rng.nextFloat() * 2 - 1) * spread);
}

function apart(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return sqrt(dx * dx + dy * dy);
}
