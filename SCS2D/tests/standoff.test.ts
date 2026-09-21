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

describe('a standoff nobody gives an order in', () => {
  it("has both fleets well inside each other's reach", () => {
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

  it('becomes a battle anyway, because the craft decide it should be', () => {
    const run = standoff();
    for (let i = 0; i < 3000; i++) run.step();

    expect(run.totalProjectilesFired).toBeGreaterThan(100);
    expect(run.totalProjectileHits).toBeGreaterThan(100);
    expect(run.totalBeamHits).toBeGreaterThan(0);
  });

  it('does it without one order being given, at any point', () => {
    // The whole claim of the scenario. If anything ever pushed an order onto
    // a queue, what the doctrine is worth would be unmeasurable here.
    const run = standoff();
    for (let step = 0; step < 3000; step++) {
      run.step();
      if (step % 250 !== 0) continue;
      for (let i = 0; i < run.ships.highWater; i++) {
        if (!run.ships.isAlive(i)) continue;
        expect(run.ships.orderCount(i)).toBe(0);
      }
    }
  });

  it('closes the range, rather than trading shots where it started', () => {
    // Doctrine holds at a fraction of a ship's own reach, so the two lines
    // have to come to each other: a fleet that never moved would be a fleet
    // whose manoeuvre half was not wired to anything.
    const run = standoff();
    const bodies = run.world.bodies;
    const gap = (): number => {
      const a = bodies.indexOf(run.ships.body(0));
      const b = bodies.indexOf(run.ships.body(1));
      return Math.hypot(bodies.x[a]! - bodies.x[b]!, bodies.y[a]! - bodies.y[b]!);
    };
    const before = gap();
    for (let i = 0; i < 600; i++) run.step();
    expect(gap()).not.toBeCloseTo(before, 0);
  });

  it('hurts somebody', () => {
    const run = standoff();
    for (let i = 0; i < 3000; i++) run.step();
    const bodies = run.world.bodies;
    let wrecked = 0;
    for (let i = 0; i < run.ships.highWater; i++) {
      if (!run.ships.isAlive(i)) continue;
      const b = bodies.indexOf(run.ships.body(i));
      const design = run.ships.design(i);
      for (let m = 0; m < design.modules.length; m++) {
        if (run.ships.damage.spent(b, m)) wrecked++;
      }
    }
    expect(wrecked).toBeGreaterThan(0);
  });
});
