import { describe, expect, it } from 'vitest';
import { checksumWorld } from '../sim/checksum.js';
import type { Battle } from '../scenarios/types.js';
import { cloneBattle } from '../scenarios/clone.js';
import { isFixed } from '../sim/fixed.js';
import { duel } from '../scenarios/duel.js';
import { binary } from '../scenarios/binary.js';
import { beamDuel } from '../scenarios/beamDuel.js';
import { starWars } from '../scenarios/starWars.js';
import { swarm } from '../scenarios/swarm.js';
import { torpedoes } from '../scenarios/torpedoes.js';
import { standoff } from '../scenarios/standoff.js';
import { column } from '../scenarios/column.js';
import { split } from '../scenarios/split.js';
import { torchRun } from '../scenarios/torchRun.js';
import { broadside } from '../scenarios/broadside.js';
import { hooked } from '../scenarios/hooked.js';
import { salvageRun } from '../scenarios/salvage.js';
import { mending, refitting } from '../scenarios/mending.js';
import { scavenge } from '../scenarios/scavenge.js';
import { factory, padRebuild } from '../scenarios/carrier.js';
import { shipyard } from '../scenarios/shipyard.js';
import { beamCarrier } from '../scenarios/beamCarrier.js';
import { circling, passes } from '../scenarios/passes.js';
import { rearm } from '../scenarios/rearm.js';
import { tanker } from '../scenarios/tanker.js';

const SEED = 20260905;
/** The viewer's scenes, which are what a rewind copies. */
const SCENES: Record<string, () => Battle> = {
  duel: () => duel(SEED),
  binary: () => binary(SEED),
  beamDuel: () => beamDuel(SEED),
  starWars: () => starWars(SEED),
  swarm: () => swarm(SEED),
  torpedoes: () => torpedoes(SEED),
  standoff: () => standoff(SEED),
  column: () => column(SEED),
  split: () => split(SEED),
  torchRun: () => torchRun(SEED),
  hooked: () => hooked(SEED),
  broadside: () => broadside(SEED),
  salvageRun: () => salvageRun(SEED),
  mending: () => mending(SEED),
  refitting: () => refitting(SEED),
  scavenge: () => scavenge(SEED),
  padRebuild: () => padRebuild(SEED),
  factory: () => factory(SEED),
  shipyard: () => shipyard(SEED),
  rearm: () => rearm(SEED),
  tanker: () => tanker(SEED),
  beamCarrier: () => beamCarrier(SEED),
  passes: () => passes(SEED),
  circling: () => circling(SEED),
};

const BEFORE = 240;
const AFTER = 240;

/** A copy of every array marked `fixed` that a battle reaches, by the array. */
const fixedIn = (battle: Battle): Map<object, unknown[]> => {
  const found = new Map<object, unknown[]>();
  const seen = new Set<object>();
  const walk = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    if (isFixed(value)) {
      found.set(value, ArrayBuffer.isView(value) ? Array.from(value as Float64Array) : [...(value as unknown[])]);
    }
    if (ArrayBuffer.isView(value) || value instanceof WeakMap || value instanceof WeakSet) return;
    if (value instanceof Map) {
      for (const [k, v] of value) {
        walk(k);
        walk(v);
      }
    } else if (value instanceof Set) {
      for (const v of value) walk(v);
    } else {
      for (const key of Object.keys(value)) walk((value as Record<string, unknown>)[key]);
    }
  };
  walk(battle);
  return found;
};

const run = (battle: Battle, steps: number): Battle => {
  for (let i = 0; i < steps; i++) battle.step();
  return battle;
};

describe('a copied battle', () => {
  for (const [name, create] of Object.entries(SCENES)) {
    it(`${name} steps on exactly as its original, and leaves it alone`, () => {
      const expected = checksumWorld(run(create(), BEFORE + AFTER).world);
      const original = run(create(), BEFORE);
      const fixed = fixedIn(original);
      expect(fixed.size).toBeGreaterThan(0);
      const copy = run(cloneBattle(original), AFTER);
      expect(checksumWorld(copy.world)).toBe(expected);
      // The copy having gone on, the original still goes on from where it was.
      expect(checksumWorld(run(original, AFTER).world)).toBe(expected);
      // Shared between the two, so neither may have written into them.
      for (const [array, was] of fixed) {
        expect(ArrayBuffer.isView(array) ? Array.from(array as Float64Array) : [...(array as unknown[])]).toEqual(was);
      }
    }, 120_000);
  }
});

describe('what a copy keeps', () => {
  it('keeps views onto one buffer onto one buffer, and an object met twice one object', () => {
    const battle = duel(SEED);
    const whole = new Float64Array(4);
    const part = whole.subarray(1, 3);
    const thing = { n: 1 };
    const held = { whole, part, list: [thing, thing, 2], also: thing };
    const copy = cloneBattle(Object.assign(battle, { held }));
    const kept = (copy as typeof battle & { held: typeof held }).held;
    kept.whole[1] = 7;
    expect(kept.part[0]).toBe(7);
    expect(whole[1]).toBe(0);
    expect(kept.list[0]).toBe(kept.also);
    expect(kept.list[0]).not.toBe(thing);
    expect(kept.list[2]).toBe(2);
  });
});
