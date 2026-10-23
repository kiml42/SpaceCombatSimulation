import { describe, expect, it } from 'vitest';
import { rivalMines } from '../scenarios/rivalMines.js';

describe('rival mines', () => {
  it('starts each outpost clear of every asteroid', () => {
    const run = rivalMines();
    const b = run.world.bodies;
    for (const i of run.miners) {
      const mb = b.indexOf(run.ships.body(i));
      for (const a of run.asteroids) {
        const ab = b.indexOf(run.ships.body(a));
        expect(Math.hypot(b.x[mb]! - b.x[ab]!, b.y[mb]! - b.y[ab]!)).toBeGreaterThan(b.radius[mb]! + b.radius[ab]!);
      }
    }
  });

  it('has each Replicator anchor to its own major and build a copy of itself there', () => {
    const run = rivalMines();
    const majors = [run.asteroids[0]!, run.asteroids[1]!];
    for (let t = 0; t < 240 * 60; t++) run.step();
    run.miners.forEach((i, k) => {
      expect(run.ships.isMoored(i)).toBe(true);
      expect(run.ships.parkedCarrier(i)).toBe(majors[k]);
      expect(run.ships.body(i)).not.toBe(run.ships.body(run.miners[1 - k]!));
    });
    // A copy on each side's slipway, on the rock with its builder.
    const copies = [];
    for (let i = 0; i < run.ships.count; i++) if (run.ships.isAlive(i) && run.ships.isPrinting(i)) copies.push(i);
    expect(new Set(copies.map((i) => run.ships.teamOf(i)))).toEqual(new Set([0, 1]));
    for (const i of copies) expect(run.ships.body(i)).toBe(run.ships.body(run.miners[run.ships.teamOf(i)]!));
    const b = run.world.bodies;
    for (let k = 0; k < b.highWater; k++) expect(Number.isFinite(b.vx[k]!)).toBe(true);
  });
});
