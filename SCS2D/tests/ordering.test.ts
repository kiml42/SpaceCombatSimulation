import { describe, expect, it } from 'vitest';
import { NO_TARGET } from '../sim/index.js';
import { ordering, separation, spread } from '../scenarios/ordering.js';

/**
 * What listing a ship's modules in a different order actually costs, pinned so
 * that a change to thruster allocation or firing has to be argued for.
 *
 * The two bounds differ in kind on purpose. Grouping being free is exact and
 * must stay exact; ordering costing round-off is a measurement, bounded loosely
 * enough that a different summation order would not trip it and tightly enough
 * that an order-dependent allocator — a greedy one, say — could not hide.
 */

const STEPS = 3_000;

describe('module ordering', () => {
  it('costs nothing at all to group parts into assemblies', () => {
    // Same list by construction, so they must stay bit-identical: an assembly
    // is a way of writing a ship down, not a thing the simulation can see.
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

  it('costs only round-off to list the same parts in a different order', () => {
    // Allocation is least squares over every thruster at once, not a walk down
    // the list, and a salvo's recoil is summed before it is applied. So
    // reordering changes only the order the arithmetic happens in — not free,
    // since a reordered blueprint still moves a golden checksum, but round-off
    // rather than behaviour.
    const run = ordering();
    for (let i = 0; i < STEPS; i++) run.step();

    const drift = separation(run, 0, 1);
    expect(drift).toBeGreaterThan(0);
    expect(drift).toBeLessThan(1e-6);
    expect(spread(run)).toBe(drift);
  });

  it('flies a real manoeuvring gunfight rather than three ships coasting', () => {
    // Without this the two above would pass on a scenario where nothing
    // happened, which is how a measurement like this goes quietly wrong.
    const run = ordering();
    for (let i = 0; i < STEPS; i++) run.step();

    expect(run.totalProjectilesFired).toBeGreaterThan(100);

    const bodies = run.world.bodies;
    for (const contender of run.contenders) {
      const body = bodies.indexOf(run.ships.body(contender.ship));
      // Started at x = -1800: a ship that never manoeuvred could not be here.
      expect(bodies.x[body]).toBeGreaterThan(0);
    }
  });

  it('holds the mark\'s fire', () => {
    // If the mark ever acquired an order it would shoot back, and the three
    // would stop being given the same problem.
    const run = ordering();
    for (let i = 0; i < STEPS; i++) run.step();
    expect(run.ships.order(run.target).target).toBe(NO_TARGET);
  });
});
