import { describe, expect, it } from 'vitest';
import { driftName, mutate } from '../evolution/mutate.js';
import { Rng } from '../sim/rng.js';
import { DINKY } from '../scenarios/blueprints.js';
import type { Blueprint } from '../sim/index.js';

describe('a lineage naming itself', () => {
  it('drifts a letter at a time, keeping the case of what it replaces', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 500; i++) {
      const now = driftName('Dinky', rng);
      expect(Math.abs(now.length - 5)).toBeLessThanOrEqual(1);
      if (now.length === 5 && now[0] !== 'D') expect(now[0]).toMatch(/[A-Z]/);
    }
    // Never down to nothing, however long it drifts.
    let name = 'Ab';
    for (let i = 0; i < 2000; i++) name = driftName(name, rng);
    expect(name.length).toBeGreaterThanOrEqual(2);
    expect(name.length).toBeLessThanOrEqual(24);
  });

  it('drifts now and then down a line, and never changes what the line breeds', () => {
    const line = (rename: number): Blueprint[] => {
      const rng = new Rng(17);
      const out: Blueprint[] = [];
      let held: Blueprint = DINKY;
      for (let i = 0; i < 120; i++) {
        held = mutate(held, rng, { rename }).blueprint;
        out.push(held);
      }
      return out;
    };
    const named = line(0.1);
    const plain = line(0);
    expect(plain.every((b) => b.name === 'Dinky')).toBe(true);
    const renames = named.filter((b, i) => b.name !== (named[i - 1]?.name ?? 'Dinky')).length;
    expect(renames).toBeGreaterThan(3);
    expect(renames).toBeLessThan(30);
    // Bit for bit the same ships, whatever they are called.
    expect(named.map((b) => ({ ...b, name: '' }))).toEqual(plain.map((b) => ({ ...b, name: '' })));
  });
});
