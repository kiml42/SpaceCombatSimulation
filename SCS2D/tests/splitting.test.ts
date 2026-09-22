import { describe, expect, it } from 'vitest';
import { compileBlueprint, joints } from '../sim/index.js';
import { CATAMARAN } from '../scenarios/blueprints.js';
import { split } from '../scenarios/split.js';

/**
 * A ship cut in half, and both halves flying on.
 *
 * What makes a piece a ship is a working core (DESIGN.md §4), so a hull built
 * with one in each half survives being cut between them as two ships. This is
 * that claim, end to end: the Catamaran, a corvette sent through its bridge,
 * and two craft afterwards where there was one.
 */

const catamaran = compileBlueprint(CATAMARAN);

describe('the Catamaran', () => {
  it('is two ships joined by the weakest welds on it', () => {
    expect(catamaran.cores.length).toBe(2);
    expect(catamaran.turrets.length).toBe(2);

    // The bridge is the line the ship is meant to come apart on, so nothing on
    // it may be as strong as what holds a hull together.
    const welds = joints(catamaran);
    const bridge = welds.filter((j) => {
      const a = catamaran.modules[j.a]!;
      const b = catamaran.modules[j.b]!;
      // Everything in a hull sits well off the centreline; the bridge is what
      // crosses it.
      return Math.abs(a.y) < 11 || Math.abs(b.y) < 11;
    });
    expect(bridge.length).toBeGreaterThan(3);

    const weakestHull = Math.min(
      ...welds.filter((j) => !bridge.includes(j)).map((j) => j.strength),
    );
    const strongestBridge = Math.max(...bridge.map((j) => j.strength));
    expect(strongestBridge).toBeLessThan(weakestHull);
  });
});

describe('a ship cut in half', () => {
  /** The scenario up to a given second, and what is flying at that point. */
  function at(seconds: number): { live: number[]; run: ReturnType<typeof split> } {
    const run = split();
    for (let i = 0; i < Math.round(seconds * 60); i++) run.step();
    const live: number[] = [];
    for (let s = 0; s < run.ships.highWater; s++) {
      if (run.ships.isAlive(s) && !run.ships.isDerelict(s)) live.push(s);
    }
    return { live, run };
  }

  const halves = (run: ReturnType<typeof split>, live: readonly number[]): number[] =>
    live.filter((s) => run.ships.design(s).name === catamaran.name);

  it('is one ship before the ram and two after it', () => {
    const before = at(3);
    expect(halves(before.run, before.live).length).toBe(1);
    expect(before.run.totalSevered).toBe(0);

    const after = at(8);
    const pieces = halves(after.run, after.live);
    expect(pieces.length).toBe(2);

    // Both are ships rather than wreckage, and each is a hull's worth of one:
    // a core to fly it, a gun to fight it, and engines to move it.
    for (const piece of pieces) {
      const design = after.run.ships.design(piece);
      expect(design.cores.length).toBe(1);
      expect(design.turrets.length).toBe(1);
      expect(design.thrusters.length).toBeGreaterThan(0);
      expect(after.run.ships.isDisarmed(piece)).toBe(false);
      expect(design.mass).toBeGreaterThan(catamaran.mass * 0.4);
    }
  });

  it('sends both halves after the enemy nobody told them about', () => {
    // The point of the scenario. A hulk drifts; a piece with somebody aboard
    // picks its own fight, and these two pick the same one without being
    // ordered to.
    const { run, live } = at(30);
    const pieces = halves(run, live);
    expect(pieces.length).toBe(2);

    for (const piece of pieces) {
      const target = run.ships.targetOfTurret(run.world.bodies, piece, 0);
      expect(target).toBeGreaterThanOrEqual(0);
      expect(run.ships.design(target).name).toBe('Corvette');
      expect(run.ships.orderCount(piece)).toBe(0);
    }
  });
});
