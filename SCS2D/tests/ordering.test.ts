import { describe, expect, it } from 'vitest';
import { NO_TARGET } from '../sim/index.js';
import { ORDERINGS, ordering, separation, soloOrdering, spread } from '../scenarios/ordering.js';

/**
 * What listing a ship's modules in a different order actually costs, pinned so
 * that a change to thruster allocation or firing has to be argued for.
 *
 * The bounds differ in kind on purpose. Grouping being free is exact and must
 * stay exact; ordering costing round-off is a measurement, bounded loosely
 * enough that a different summation order would not trip it and tightly enough
 * that an order-dependent allocator — a greedy one, say — could not hide.
 */

const STEPS = 3_000;

interface Outcome {
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  fired: number;
  hits: number;
}

/** Fly one ordering in a battle of its own, and report how it went. */
function flySolo(which: number): Outcome {
  const run = soloOrdering(which);
  for (let i = 0; i < STEPS; i++) run.step();
  const bodies = run.world.bodies;
  const body = bodies.indexOf(run.ships.body(run.contenders[0]!.ship));
  return {
    x: bodies.x[body]!,
    y: bodies.y[body]!,
    angle: bodies.angle[body]!,
    vx: bodies.vx[body]!,
    vy: bodies.vy[body]!,
    fired: run.totalProjectilesFired,
    hits: run.totalProjectileHits,
  };
}

describe('module ordering, one battle each', () => {
  const [control, kinds, assembled] = ORDERINGS.map((_, i) => flySolo(i));

  it('fights a real battle, so the comparison is of something', () => {
    // Without this the rest would pass on three runs where nothing happened.
    for (const outcome of [control!, kinds!, assembled!]) {
      expect(outcome.fired).toBeGreaterThan(100);
      expect(outcome.hits).toBeGreaterThan(100);
      // Started at x = -1800: a ship that never manoeuvred could not be here.
      expect(outcome.x).toBeGreaterThan(0);
    }
  });

  it('costs nothing at all to group parts into assemblies', () => {
    // Same list by construction, so every figure must match bit for bit: an
    // assembly is a way of writing a ship down, not a thing the sim can see.
    expect(assembled).toEqual(control);
  });

  it('costs only round-off to list the same parts in a different order', () => {
    // Allocation is least squares over every thruster at once, not a walk down
    // the list, and a salvo's recoil is summed before it is applied. So
    // reordering changes only the order the arithmetic happens in — not free,
    // since a reordered blueprint still moves a golden checksum, but round-off
    // rather than behaviour.
    const drift = Math.hypot(kinds!.x - control!.x, kinds!.y - control!.y);
    expect(drift).toBeGreaterThan(0);
    expect(drift).toBeLessThan(1e-6);

    // The figures a battle is judged on are untouched, which is the claim that
    // outlives this scenario: these stay comparable once ships collide and
    // damage each other, where a distance between two of them does not.
    expect(kinds!.fired).toBe(control!.fired);
    expect(kinds!.hits).toBe(control!.hits);
  });
});

describe('module ordering, all three stacked', () => {
  it('flies each ship exactly as it flies alone', () => {
    // What licenses the stacked scene as evidence rather than as a picture.
    // Ships do not yet interact, so sharing a world must change nothing; the
    // day that stops being true this fails, and the scene goes.
    const run = ordering();
    for (let i = 0; i < STEPS; i++) run.step();
    const bodies = run.world.bodies;

    for (const [i, contender] of run.contenders.entries()) {
      const body = bodies.indexOf(run.ships.body(contender.ship));
      const alone = flySolo(i);
      expect(bodies.x[body]).toBe(alone.x);
      expect(bodies.y[body]).toBe(alone.y);
      expect(bodies.angle[body]).toBe(alone.angle);
    }
  });

  it('keeps the grouped and flat ships together for the whole flight', () => {
    // Every step, not just the last: a pair that diverged and came back would
    // pass an end-state check.
    const run = ordering();
    const bodies = run.world.bodies;
    const flat = bodies.indexOf(run.ships.body(run.contenders[0]!.ship));
    const assembled = bodies.indexOf(run.ships.body(run.contenders[2]!.ship));

    for (let i = 0; i < STEPS; i++) {
      run.step();
      expect(bodies.x[assembled]).toBe(bodies.x[flat]);
      expect(bodies.y[assembled]).toBe(bodies.y[flat]);
      expect(bodies.angle[assembled]).toBe(bodies.angle[flat]);
    }
  });

  it('shows the drift as the range the viewer reports', () => {
    const run = ordering();
    for (let i = 0; i < STEPS; i++) run.step();
    const drift = separation(run, 0, 1);
    expect(drift).toBeGreaterThan(0);
    expect(drift).toBeLessThan(1e-6);
    expect(spread(run)).toBe(drift);
  });

  it('holds the mark\'s fire', () => {
    // If the mark ever acquired an order it would shoot back, and the three
    // would stop being given the same problem.
    const run = ordering();
    for (let i = 0; i < STEPS; i++) run.step();
    expect(run.ships.order(run.target).target).toBe(NO_TARGET);
  });
});
