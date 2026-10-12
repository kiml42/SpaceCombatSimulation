import { describe, expect, it } from 'vitest';
import { compileBlueprint, DAMAGE_ENERGY_PER_KG, SHED_AT_BREAK, SHED_FLOOR, shedShare } from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import { CORVETTE } from '../scenarios/blueprints.js';

/** Damage boiling or shredding a module's mass away (DESIGN.md §4). */

const corvette = compileBlueprint(CORVETTE);

describe('the share of a module damage sheds', () => {
  it('is a little by the time it breaks, and never more than half', () => {
    expect(shedShare(0, 100)).toBe(0);
    expect(shedShare(100, 100)).toBeCloseTo(SHED_AT_BREAK, 12);
    expect(shedShare(100 * (SHED_FLOOR / SHED_AT_BREAK), 100)).toBeCloseTo(SHED_FLOOR, 12);
    expect(shedShare(1e9, 100)).toBe(SHED_FLOOR);
    expect(shedShare(50, 0)).toBe(0);
  });
});

describe('a hull taking damage', () => {
  /** A corvette at rest with one module hit, settled by a step. */
  function hit(module: number, breaks: number): ReturnType<typeof makeBattle<{ a: number }>> {
    const run = makeBattle({ seed: 1, pilots: false }, (ships, world) => {
      const a = ships.spawn(world, { design: corvette, x: 0, y: 0, angle: 0, vx: 3 });
      const body = world.bodies.indexOf(ships.body(a));
      const capacity = corvette.modules[module]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG;
      ships.damage.absorb(body, module, capacity * breaks);
      return { a };
    });
    run.step();
    return run;
  }
  const largest = corvette.modules.reduce((best, m, k) => (m.stats.structureMass > corvette.modules[best]!.stats.structureMass ? k : best), 0);
  const dry = corvette.modules[largest]!.stats.structureMass + corvette.modules[largest]!.stats.fittingMass;

  it('loses the share of the module it shed, counted as discarded', () => {
    const run = hit(largest, 1);
    const body = run.world.bodies.indexOf(run.ships.body(run.a));
    const shed = run.ships.damage.shedAt(body, largest);
    expect(shed).toBeCloseTo(SHED_AT_BREAK * dry, 6);
    expect(run.world.bodies.mass[body]).toBeCloseTo(corvette.mass - shed, 6);
    expect(run.ships.discarded).toBeCloseTo(shed, 6);
    expect(run.ships.discardedPx).toBeCloseTo(shed * 3, 6);
  });

  it('stops at half, however hard it is hit', () => {
    const run = hit(largest, 100);
    const body = run.world.bodies.indexOf(run.ships.body(run.a));
    expect(run.ships.damage.shedAt(body, largest)).toBeCloseTo(SHED_FLOOR * dry, 6);
    expect(run.world.bodies.mass[body]).toBeCloseTo(corvette.mass - SHED_FLOOR * dry, 6);
  });

  it('is lighter to turn as well as to push', () => {
    const run = hit(largest, 3);
    const body = run.world.bodies.indexOf(run.ships.body(run.a));
    expect(run.world.bodies.inertia[body]).toBeLessThan(corvette.inertia);
  });
});
