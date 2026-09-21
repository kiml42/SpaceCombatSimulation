import { describe, expect, it } from 'vitest';
import { standoff } from '../scenarios/standoff.js';

/**
 * Two fleets in reach of each other with nobody flying them.
 *
 * What this pins is a *lack* of behaviour, and it is worth pinning because it
 * is the thing the doctrine step exists to change: a ship told nothing does
 * nothing, and the reason these fleets are not fighting is that nobody has
 * told them to rather than that they cannot reach each other.
 */

describe('a standoff with no orders in it', () => {
  it('has both fleets well inside each other\'s reach', () => {
    // Stated in terms of the guns themselves, so the scenario cannot drift
    // out of range without this failing: two seconds of flight, at a muzzle
    // speed the ships actually have.
    const run = standoff();
    const bodies = run.world.bodies;
    const first = bodies.indexOf(run.ships.body(0));
    const second = bodies.indexOf(run.ships.body(1));
    const apart = Math.hypot(
      bodies.x[first]! - bodies.x[second]!,
      bodies.y[first]! - bodies.y[second]!,
    );
    const gun = run.ships.design(0).turrets[0]!.gun;
    expect(apart).toBeLessThan(gun.muzzleSpeed * 2);
    expect(apart).toBeGreaterThan(0);
  });

  it('fires nothing, hits nothing and touches nothing, for as long as you run it', () => {
    const run = standoff();
    for (let i = 0; i < 3000; i++) run.step();

    expect(run.totalProjectilesFired).toBe(0);
    expect(run.totalBeamsFired).toBe(0);
    expect(run.totalContacts).toBe(0);
    expect(run.totalSevered).toBe(0);
  });

  it('leaves every ship whole, and where it started', () => {
    const run = standoff();
    const bodies = run.world.bodies;
    const before = [];
    for (let i = 0; i < run.ships.highWater; i++) {
      const b = bodies.indexOf(run.ships.body(i));
      before.push({ x: bodies.x[b]!, y: bodies.y[b]! });
    }

    for (let i = 0; i < 3000; i++) run.step();

    expect(run.ships.count).toBe(before.length);
    for (let i = 0; i < run.ships.highWater; i++) {
      expect(run.ships.isAlive(i)).toBe(true);
      const b = bodies.indexOf(run.ships.body(i));
      // Holding station is an active thing — the pilot is killing any drift —
      // so this is the pilot working, not an absence of physics.
      expect(bodies.x[b]!).toBeCloseTo(before[i]!.x, 6);
      expect(bodies.y[b]!).toBeCloseTo(before[i]!.y, 6);
      const design = run.ships.design(i);
      for (let m = 0; m < design.modules.length; m++) {
        expect(run.ships.damage.integrity(b, m)).toBe(1);
      }
    }
  });
});
