import { describe, expect, it } from 'vitest';
import {
  angleDelta,
  approach,
  atan,
  atan2,
  clamp,
  cos,
  exp,
  length,
  log,
  normalizeAngle,
  PI,
  pow,
  sin,
  tan,
  TAU,
} from '../sim/math.js';

/**
 * These compare our implementations against `Math.*`.
 *
 * That is legitimate here and forbidden in the simulation: `Math.sin` is
 * accurate enough to serve as a reference for *accuracy*, it just cannot be
 * relied on for *reproducibility*. Determinism is tested separately, by
 * checksum.
 */

const SAMPLES = 2000;

/** Deterministic sweep, so a failure is always reproducible. */
function sweep(lo: number, hi: number, n = SAMPLES): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(lo + ((hi - lo) * i) / n);
  return out;
}

describe('sin / cos', () => {
  it('matches Math.sin across several turns', () => {
    for (const x of sweep(-4 * TAU, 4 * TAU)) {
      expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(1e-14);
    }
  });

  it('matches Math.cos across several turns', () => {
    for (const x of sweep(-4 * TAU, 4 * TAU)) {
      expect(Math.abs(cos(x) - Math.cos(x))).toBeLessThan(1e-14);
    }
  });

  it('is exact at the quadrant boundaries', () => {
    expect(sin(0)).toBe(0);
    expect(cos(0)).toBe(1);
    expect(Math.abs(sin(PI))).toBeLessThan(1e-15);
    expect(Math.abs(cos(PI) + 1)).toBeLessThan(1e-15);
    expect(Math.abs(sin(PI / 2) - 1)).toBeLessThan(1e-15);
    expect(Math.abs(cos(PI / 2))).toBeLessThan(1e-15);
  });

  it('satisfies the Pythagorean identity', () => {
    for (const x of sweep(-10, 10)) {
      const s = sin(x);
      const c = cos(x);
      expect(Math.abs(s * s + c * c - 1)).toBeLessThan(1e-15);
    }
  });

  it('stays accurate for large arguments', () => {
    for (const x of sweep(1e6, 1e6 + TAU, 200)) {
      expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(1e-9);
    }
  });

  it('tan matches Math.tan away from the poles', () => {
    for (const x of sweep(-1.5, 1.5)) {
      expect(Math.abs(tan(x) - Math.tan(x))).toBeLessThan(1e-13);
    }
  });
});

describe('atan / atan2', () => {
  it('matches Math.atan over a wide range', () => {
    for (const x of sweep(-100, 100)) {
      expect(Math.abs(atan(x) - Math.atan(x))).toBeLessThan(1e-11);
    }
  });

  it('is accurate near the reduction threshold', () => {
    for (const x of sweep(0.3, 0.5)) {
      expect(Math.abs(atan(x) - Math.atan(x))).toBeLessThan(1e-12);
    }
  });

  it('handles all four quadrants', () => {
    const pts: [number, number][] = [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
      [3, 4],
      [-7, 2],
    ];
    for (const [y, x] of pts) {
      expect(Math.abs(atan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-11);
    }
  });

  it('returns zero for the degenerate origin', () => {
    expect(atan2(0, 0)).toBe(0);
  });

  it('round-trips through sin and cos', () => {
    for (const a of sweep(-PI + 1e-9, PI - 1e-9, 500)) {
      const recovered = atan2(sin(a), cos(a));
      expect(Math.abs(angleDelta(a, recovered))).toBeLessThan(1e-11);
    }
  });
});

describe('angles', () => {
  it('normalises into [-pi, pi]', () => {
    for (const a of sweep(-20, 20)) {
      const n = normalizeAngle(a);
      expect(n).toBeGreaterThanOrEqual(-PI - 1e-12);
      expect(n).toBeLessThanOrEqual(PI + 1e-12);
      // Same angle, modulo a whole number of turns.
      const turns = (a - n) / TAU;
      expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-9);
    }
  });

  it('gives the shortest signed rotation', () => {
    expect(angleDelta(0, 0.5)).toBeCloseTo(0.5, 12);
    expect(angleDelta(0.5, 0)).toBeCloseTo(-0.5, 12);
    // Just past pi one way is just short of -pi the other.
    expect(angleDelta(-3, 3)).toBeCloseTo(6 - TAU, 12);
    expect(angleDelta(3, -3)).toBeCloseTo(TAU - 6, 12);
  });
});

describe('helpers', () => {
  it('length avoids Math.hypot but agrees with it', () => {
    expect(length(3, 4)).toBe(5);
    expect(length(0, 0)).toBe(0);
    expect(Math.abs(length(1e-8, 1e-8) - Math.hypot(1e-8, 1e-8))).toBeLessThan(1e-20);
  });

  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('approaches a target without overshooting', () => {
    expect(approach(0, 10, 3)).toBe(3);
    expect(approach(0, 2, 3)).toBe(2);
    expect(approach(0, -10, 3)).toBe(-3);
    expect(approach(5, 5, 3)).toBe(5);
  });
});

describe('exp / log / pow', () => {
  it('matches Math.exp over the range a double can hold', () => {
    for (const x of sweep(-700, 700)) {
      expect(Math.abs(exp(x) - Math.exp(x))).toBeLessThan(Math.exp(x) * 1e-14);
    }
  });

  it('matches Math.log over twelve decades', () => {
    for (const x of sweep(1e-6, 1e6)) {
      if (x <= 0) continue;
      expect(Math.abs(log(x) - Math.log(x))).toBeLessThan(Math.abs(Math.log(x)) * 1e-14 + 1e-15);
    }
  });

  it('is exact where the answer is a whole number', () => {
    expect(log(1)).toBe(0);
    expect(exp(0)).toBe(1);
    expect(pow(3, 0)).toBe(1);
    expect(pow(3, 1)).toBe(3);
    expect(pow(3, 2)).toBe(9);
    // A square root, taken as one: sqrt is correctly rounded where exp(y·log x)
    // would only be close.
    expect(pow(2, 0.5)).toBe(Math.sqrt(2));
  });

  it('round-trips: log undoes exp', () => {
    for (const x of sweep(-20, 20, 500)) {
      expect(Math.abs(log(exp(x)) - x)).toBeLessThan(1e-13 * Math.max(1, Math.abs(x)));
    }
  });

  it('matches Math.pow at the exponents the ballistics law uses', () => {
    for (const x of sweep(1e-4, 5, 500)) {
      for (const y of [0.7, 0.75, 1.5, -0.5, 3]) {
        expect(Math.abs(pow(x, y) - Math.pow(x, y))).toBeLessThan(Math.pow(x, y) * 1e-13);
      }
    }
  });

  it('answers for the edges rather than leaving them to the reduction', () => {
    expect(exp(1000)).toBe(Infinity);
    expect(exp(-1000)).toBe(0);
    expect(log(0)).toBe(-Infinity);
    expect(Number.isNaN(log(-1))).toBe(true);
    expect(pow(0, 2)).toBe(0);
    // A negative base is a mistake in a law written in fractional powers, and
    // says so rather than serving the integer-exponent case.
    expect(Number.isNaN(pow(-2, 0.7))).toBe(true);
  });
});
