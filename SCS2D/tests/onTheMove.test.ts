import { describe, expect, it } from 'vitest';
import { DEFAULT_DOCTRINE, doctrineProblem, Rng, type Blueprint } from '../sim/index.js';
import { mutate } from '../evolution/mutate.js';
import { onTheMove } from '../scenarios/onTheMove.js';
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

type Run = ReturnType<typeof onTheMove>;

/** Watches fighter `i` close on ship `target` in its band, step by step. */
function watcher(run: Run, i: number, target: number): { step(): void; flown(): Flown } {
  const ships = run.ships;
  const bodies = run.world.bodies;
  let inBand = 0;
  let entries = 0;
  let was = false;
  let steps = 0;
  let sideways = 0;
  let closest = Infinity;
  return {
    step() {
      const f = bodies.indexOf(ships.body(i));
      const t = bodies.indexOf(ships.body(target));
      const dx = bodies.x[t]! - bodies.x[f]!;
      const dy = bodies.y[t]! - bodies.y[f]!;
      const range = Math.sqrt(dx * dx + dy * dy);
      const order = (ships as unknown as { effectiveOrder(i: number): { minRange: number; maxRange: number } | undefined }).effectiveOrder(i);
      if (order === undefined) return;
      steps++;
      closest = Math.min(closest, range);
      const inside = range >= order.minRange && range <= order.maxRange;
      if (inside) inBand++;
      if (inside && !was) entries++;
      was = inside;
      sideways += Math.abs((dx * (bodies.vy[f]! - bodies.vy[t]!) - dy * (bodies.vx[f]! - bodies.vx[t]!)) / range);
    },
    flown: () => ({ inBand: inBand / steps, entries, closest, sideways: sideways / steps }),
  };
}

/** How each fighter flies from 40 s on. */
function fly(seconds: number): { passer: Flown; circler: Flown } {
  const run = onTheMove();
  const passer = watcher(run, run.passer, run.targets[0]);
  const circler = watcher(run, run.circler, run.targets[1]);
  for (let s = 1; s <= seconds * 60; s++) {
    run.step();
    if (s < 40 * 60) continue;
    passer.step();
    circler.step();
  }
  return { passer: passer.flown(), circler: circler.flown() };
}

describe('attacking on the move', () => {
  const flown = fly(120);

  it('makes passes when its thrust cannot hold a turn at its speed: in to the band aiming to miss, out and back again', () => {
    expect(flown.passer.entries).toBeGreaterThanOrEqual(3);
    expect(flown.passer.sideways).toBeGreaterThan(25);
    // Aimed to miss: never near enough to touch.
    expect(flown.passer.closest).toBeGreaterThan(100);
  });

  it('circles when it can hold the turn, staying in its band', () => {
    expect(flown.circler.inBand).toBeGreaterThan(0.8);
    expect(flown.circler.sideways).toBeGreaterThan(20);
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
      held = mutate(held, rng, { thrusters: 0 }).blueprint;
      expect(doctrineProblem(held.doctrine)).toBeNull();
    }
  });
});
