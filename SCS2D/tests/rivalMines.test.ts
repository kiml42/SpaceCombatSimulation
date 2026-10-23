import { describe, expect, it } from 'vitest';
import { rivalMines } from '../scenarios/rivalMines.js';

describe('rival mines', () => {
  it('has each outpost mine its own side’s rock, never what the other side holds, and build a Dinky', () => {
    const run = rivalMines();
    const majors = [run.asteroids[0]!, run.asteroids[4]!];
    for (let t = 0; t < 240 * 60; t++) run.step();
    run.miners.forEach((i, k) => {
      expect(run.ships.currentStructure(i).modules.some((m) => m.spec.kind === 'rock')).toBe(true);
      expect(run.ships.body(i)).not.toBe(run.ships.body(majors[1 - k]!));
      expect(run.ships.body(i)).not.toBe(run.ships.body(run.miners[1 - k]!));
    });
    const fighters = [];
    for (let i = 0; i < run.ships.count; i++) if (run.ships.isAlive(i) && run.ships.currentStructure(i).fighter) fighters.push(i);
    expect(new Set(fighters.map((i) => run.ships.teamOf(i)))).toEqual(new Set([0, 1]));
    // A fighter parked on a pinned carrier, and let go of one, moves nothing it should not.
    const b = run.world.bodies;
    for (let k = 0; k < b.highWater; k++) expect(Number.isFinite(b.vx[k]!)).toBe(true);
  });
});
