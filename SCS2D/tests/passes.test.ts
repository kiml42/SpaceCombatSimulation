import { describe, expect, it } from 'vitest';
import { DEFAULT_DOCTRINE, doctrineProblem, Rng, type Blueprint } from '../sim/index.js';
import { mutate } from '../evolution/mutate.js';
import { circling, passes } from '../scenarios/passes.js';
import { DINKY } from '../scenarios/blueprints.js';

/** Attacking on the move: a band of sideways speed relative to the target (`tangentialMin`, `tangentialMax`). */

interface Flown {
  /** Share of its time in its band, once it has arrived. */
  inBand: number;
  /** How many times it came into its band. */
  entries: number;
  closest: number;
  /** Mean sideways speed relative to the target, m/s. */
  sideways: number;
}

/** How the fighter in an on-the-move scenario flies from 40 s on. */
function fly(run: ReturnType<typeof passes>, seconds: number): Flown {
  const ships = run.ships;
  const bodies = run.world.bodies;
  let inBand = 0;
  let entries = 0;
  let was = false;
  let steps = 0;
  let sideways = 0;
  let closest = Infinity;
  for (let s = 1; s <= seconds * 60; s++) {
    run.step();
    if (s < 40 * 60) continue;
    const f = bodies.indexOf(ships.body(1));
    const t = bodies.indexOf(ships.body(0));
    const dx = bodies.x[t]! - bodies.x[f]!;
    const dy = bodies.y[t]! - bodies.y[f]!;
    const range = Math.sqrt(dx * dx + dy * dy);
    const order = (ships as unknown as { effectiveOrder(i: number): { minRange: number; maxRange: number } | undefined }).effectiveOrder(1);
    if (order === undefined) continue;
    const band = { min: order.minRange, max: order.maxRange };
    steps++;
    closest = Math.min(closest, range);
    const inside = range >= band.min && range <= band.max;
    if (inside) inBand++;
    if (inside && !was) entries++;
    was = inside;
    sideways += Math.abs((dx * (bodies.vy[f]! - bodies.vy[t]!) - dy * (bodies.vx[f]! - bodies.vx[t]!)) / range);
  }
  return { inBand: inBand / steps, entries, closest, sideways: sideways / steps };
}

describe('attacking on the move', () => {
  it('makes passes when its thrust cannot hold a turn at its speed: in to the band aiming to miss, out and back again', () => {
    const flown = fly(passes(), 120);
    expect(flown.entries).toBeGreaterThanOrEqual(3);
    expect(flown.sideways).toBeGreaterThan(25);
    // Aimed to miss: never near enough to touch.
    expect(flown.closest).toBeGreaterThan(100);
  });

  it('circles when it can hold the turn, staying in its band', () => {
    const flown = fly(circling(), 100);
    expect(flown.inBand).toBeGreaterThan(0.8);
    expect(flown.sideways).toBeGreaterThan(20);
  });
});

describe('the doctrine for it', () => {
  it('is off by default, so a ship comes to rest at its band', () => {
    expect(DEFAULT_DOCTRINE.approach.tangentialMin).toBe(0);
    expect(DEFAULT_DOCTRINE.approach.tangentialMax).toBe(0);
  });

  it('refuses a speed below zero, or a least above a most', () => {
    expect(doctrineProblem({ approach: { tangentialMin: -1, tangentialMax: 10 } })).toMatch(/below zero/);
    expect(doctrineProblem({ approach: { tangentialMin: 30, tangentialMax: 10 } })).toMatch(/no more than/);
    expect(doctrineProblem({ approach: { tangentialMin: 10, tangentialMax: 30 } })).toBeNull();
  });

  it('is never bred out of order', () => {
    // Both ends at one speed, so a draw on either that is not refused crosses the other.
    const rng = new Rng(17);
    let held: Blueprint = { ...DINKY, doctrine: { ...DINKY.doctrine!, approach: { ...DINKY.doctrine!.approach, tangentialMin: 30, tangentialMax: 30 } } };
    for (let i = 0; i < 400; i++) {
      held = mutate(held, rng).blueprint;
      expect(doctrineProblem(held.doctrine)).toBeNull();
    }
  });
});
