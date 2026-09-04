import { describe, expect, it } from 'vitest';
import { Rng } from '../sim/rng.js';

describe('Rng', () => {
  it('produces the same stream for the same seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) {
      expect(a.nextUint32()).toBe(b.nextUint32());
    }
  });

  it('produces different streams for adjacent seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let same = 0;
    for (let i = 0; i < 1000; i++) {
      if (a.nextUint32() === b.nextUint32()) same++;
    }
    // Coincidental collisions are possible; wholesale agreement is not.
    expect(same).toBeLessThan(5);
  });

  it('save and restore resumes the identical stream', () => {
    const r = new Rng(7);
    r.nextUint32();
    r.nextUint32();
    const state = r.getState();
    const expected = [r.nextUint32(), r.nextUint32(), r.nextUint32()];

    r.setState(state);
    expect([r.nextUint32(), r.nextUint32(), r.nextUint32()]).toEqual(expected);
  });

  it('clone is independent but identically positioned', () => {
    const r = new Rng(99);
    r.nextUint32();
    const c = r.clone();
    expect(c.nextUint32()).toBe(r.nextUint32());
    // Advancing the clone must not disturb the original.
    c.nextUint32();
    const r2 = r.clone();
    expect(r.nextUint32()).toBe(r2.nextUint32());
  });

  it('nextFloat stays in [0, 1)', () => {
    const r = new Rng(3);
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < 100_000; i++) {
      const v = r.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    // Should cover most of the interval over 100k draws.
    expect(lo).toBeLessThan(0.001);
    expect(hi).toBeGreaterThan(0.999);
  });

  it('nextFloat has roughly the right mean', () => {
    const r = new Rng(11);
    let sum = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) sum += r.nextFloat();
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.005);
  });

  it('nextRange respects its bounds', () => {
    const r = new Rng(5);
    for (let i = 0; i < 10_000; i++) {
      const v = r.nextRange(-3, 7);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(7);
    }
  });

  it('nextInt covers its range', () => {
    const r = new Rng(13);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(r.nextInt(6));
    expect(seen.size).toBe(6);
    for (const v of seen) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });

  it('does not repeat within a long run', () => {
    // sfc32 has a very long period; a 32-bit output space means birthday
    // collisions are expected, but a short cycle would show as heavy repetition.
    const r = new Rng(17);
    const seen = new Set<number>();
    const n = 200_000;
    for (let i = 0; i < n; i++) seen.add(r.nextUint32());
    expect(seen.size).toBeGreaterThan(n * 0.99);
  });
});
