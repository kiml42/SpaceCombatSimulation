import { describe, expect, it } from 'vitest';
import { NO_TARGET } from '../sim/index.js';
import { ordering, separation, spread } from '../scenarios/ordering.js';

/**
 * What listing a ship's modules in a different order actually costs.
 *
 * The order is not inert — thrusters are allocated in it and guns fire in it —
 * so the question is not whether it reaches the simulation but how far it
 * moves the ship. `scenarios/ordering.ts` answers that by flying three
 * gunships that are the same shape from the same spot, and these pin the
 * answer so that a change to either mechanism has to be noticed and argued
 * for rather than absorbed.
 *
 * The two numbers below are different in kind, deliberately. Grouping being
 * free is exact and must stay exact. Ordering costing round-off is a
 * measurement, and the bound is loose enough that a different summation order
 * would not trip it and tight enough that a genuinely order-dependent
 * allocator — a greedy one, say, which would burn whichever engine came first
 * — could not hide under it.
 */

const STEPS = 3_000;

describe('module ordering', () => {
  it('costs nothing at all to group parts into assemblies', () => {
    // The flat ship listed in expansion order and the assembled one are the
    // same list by construction, so they must stay bit-identical for as long
    // as they fly: an assembly is a way of writing a ship down, not a thing
    // the simulation can see. Anything else means expansion is not the
    // identity it claims to be.
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
    // Allocation is least squares over every thruster at once rather than a
    // walk down the list, and a salvo's recoil is summed before it is applied,
    // so reordering changes the order the arithmetic happens in and nothing
    // else. That is not free — the two ships are not bit-identical, which is
    // why a reordered blueprint moves a golden checksum — but it is round-off
    // rather than behaviour.
    const run = ordering();
    for (let i = 0; i < STEPS; i++) run.step();

    const drift = separation(run, 0, 1);
    expect(drift).toBeGreaterThan(0);
    expect(drift).toBeLessThan(1e-6);
    expect(spread(run)).toBe(drift);
  });

  it('flies a real manoeuvring gunfight rather than three ships coasting', () => {
    // Without this the two above would pass on a scenario where nothing ever
    // happened, which is the way a measurement like this goes quietly wrong.
    const run = ordering();
    for (let i = 0; i < STEPS; i++) run.step();

    expect(run.totalProjectilesFired).toBeGreaterThan(100);

    const bodies = run.world.bodies;
    for (const contender of run.contenders) {
      const body = bodies.indexOf(run.ships.body(contender.ship));
      // Started at (-1800, -240) heading across the engagement: a ship that
      // never manoeuvred could not be anywhere near the target's side.
      expect(bodies.x[body]).toBeGreaterThan(0);
    }
  });

  it('holds the mark\'s fire', () => {
    // The mark is a mark. If it ever acquired an order it would shoot back,
    // and three identical ships would stop being given the same problem.
    const run = ordering();
    for (let i = 0; i < STEPS; i++) run.step();
    expect(run.ships.order(run.target).target).toBe(NO_TARGET);
  });
});
