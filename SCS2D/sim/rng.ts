import { imul } from './math.js';

/**
 * Deterministic pseudo-random number generator.
 *
 * `Math.random()` is forbidden in the simulation: it is unseeded, so nothing
 * using it can be replayed. Every source of randomness must be an explicit
 * `Rng` instance passed to the code that needs it — never a module-level
 * singleton, because a shared generator makes the result depend on call order
 * across unrelated subsystems (DESIGN.md non-negotiable 2).
 *
 * The algorithm is sfc32: 128 bits of state, 32-bit integer operations only,
 * so it is exactly reproducible on any JavaScript engine. Seeded via
 * splitmix32 so that adjacent seeds produce unrelated streams.
 */

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

const TWO_32 = 4294967296;

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    // splitmix32, used only to expand the seed into 128 bits of state.
    let s = seed | 0;
    const mix = (): number => {
      s = (s + 0x9e3779b9) | 0;
      let z = s;
      z = imul(z ^ (z >>> 16), 0x21f0aaad);
      z = imul(z ^ (z >>> 15), 0x735a2d97);
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.a = mix();
    this.b = mix();
    this.c = mix();
    this.d = mix();
  }

  /** A uniform integer in [0, 2^32). */
  nextUint32(): number {
    const t0 = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    const t = (t0 + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** A uniform float in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / TWO_32;
  }

  /** A uniform float in [lo, hi). */
  nextRange(lo: number, hi: number): number {
    return lo + (hi - lo) * this.nextFloat();
  }

  /** A uniform integer in [0, n). `n` must be a positive integer. */
  nextInt(n: number): number {
    // Modulo bias is negligible for the small n this is used with, and
    // rejection sampling would make the consumed-stream length data-dependent,
    // which complicates reasoning about replays.
    return this.nextUint32() % n;
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.nextFloat() < p;
  }

  getState(): RngState {
    return { a: this.a, b: this.b, c: this.c, d: this.d };
  }

  setState(s: RngState): void {
    this.a = s.a | 0;
    this.b = s.b | 0;
    this.c = s.c | 0;
    this.d = s.d | 0;
  }

  /** An independent generator positioned at this one's current state. */
  clone(): Rng {
    const r = new Rng(0);
    r.setState(this.getState());
    return r;
  }
}
