import { abs, ceil, floor, max } from '../sim/math.js';
import { sizedClone } from './clone.js';
import type { Battle } from './types.js';

/** Fewest steps between checkpoints. */
const EVERY = 30;
/** The share of stepping time copying may take, when there is a clock to tell. */
const COPY_SHARE = 0.02;
/**
 * How far apart checkpoints may be, as a share of how far back they are, so
 * the last few seconds stay precise and a minute back is good to a few.
 */
const SPREAD = 0.1;
/** Most checkpoints kept, and roughly the most memory they hold, before they are spread further. */
const KEPT = 128;
const BYTES = 50e6;

/**
 * A battle that can be wound back. It keeps a copy of itself every so often,
 * and goes to an earlier step by copying the checkpoint before it and
 * stepping on from there, which comes out identical because the battle is
 * deterministic. Re-simulating from the start alone was too slow: a big
 * battle steps barely faster than it plays.
 *
 * Given a clock, checkpoints are spaced so copying costs a small share of
 * stepping, since a big battle is slow to copy. Older ones are thinned out,
 * so they grow sparser with age, and more so when they hold too much. Where
 * they fall changes nothing but where a scrub bar can land and how long a
 * step back takes.
 */
export class Rewind {
  battle: Battle;
  /** Steps taken since the start. */
  at = 0;
  /** The furthest step reached, which a scrub bar runs to. */
  reached = 0;
  private every = EVERY;
  /** Copies never stepped, by the step each was taken at, in order. */
  private readonly checkpoints = new Map<number, { battle: Battle; bytes: number }>();
  private bytes = 0;
  private last = 0;
  private spread = SPREAD;
  /** Milliseconds a step takes, smoothed; NaN until timed. */
  private stepCost = Number.NaN;

  /** `battle` at its first step; `now` a clock in milliseconds, if checkpoints are to be paced by cost. */
  constructor(
    battle: Battle,
    private readonly now?: () => number,
  ) {
    this.battle = battle;
    this.keep();
  }

  step(): void {
    const start = this.now?.();
    this.battle.step();
    if (start !== undefined) {
      const took = this.now!() - start;
      this.stepCost = this.stepCost !== this.stepCost ? took : this.stepCost + (took - this.stepCost) * 0.05;
    }
    this.at++;
    if (this.at > this.reached) this.reached = this.at;
    if (this.at - this.last >= this.every && this.at > this.lastKept()) this.keep();
  }

  /**
   * The step a scrub bar lands on for `target`: the nearest checkpoint, or the
   * furthest step reached, so that dragging restores copies and does not
   * re-simulate (more than the way from the last checkpoint to the end).
   */
  snap(target: number): number {
    let best = this.reached;
    for (const step of this.checkpoints.keys()) if (abs(step - target) < abs(best - target)) best = step;
    return best;
  }

  /** Go to step `target`; true if it left the battle it had for a copy. */
  seek(target: number): boolean {
    const to = max(0, floor(target));
    let from = 0;
    for (const step of this.checkpoints.keys()) if (step <= to) from = step;
    // Stepping on from where it is beats copying a checkpoint no nearer.
    const restored = to < this.at || from > this.at;
    if (restored) {
      this.battle = sizedClone(this.checkpoints.get(from)!.battle).copy;
      this.at = from;
      this.last = from;
    }
    while (this.at < to) this.step();
    return restored;
  }

  private lastKept(): number {
    let latest = -1;
    for (const step of this.checkpoints.keys()) latest = step;
    return latest;
  }

  private keep(): void {
    const start = this.now?.();
    const { copy, bytes } = sizedClone(this.battle);
    const kept = { battle: copy, bytes };
    if (start !== undefined && this.stepCost > 0) {
      const spacing = ceil((this.now!() - start) / (COPY_SHARE * this.stepCost));
      if (spacing > this.every) this.every = spacing;
    }
    this.checkpoints.set(this.at, kept);
    this.bytes += kept.bytes;
    this.last = this.at;
    this.thin();
    while (this.checkpoints.size > KEPT || this.bytes > BYTES) {
      const size = this.checkpoints.size;
      this.spread *= 1.5;
      this.thin();
      if (this.checkpoints.size === size && size <= 2) break;
    }
  }

  /**
   * Drop each checkpoint whose going leaves a gap no wider than `spread` of
   * its age, keeping the first and the latest.
   */
  private thin(): void {
    const steps = [...this.checkpoints.keys()];
    const latest = steps[steps.length - 1]!;
    let newer = latest;
    for (let i = steps.length - 2; i > 0; i--) {
      const step = steps[i]!;
      if (newer - steps[i - 1]! <= this.spread * (latest - step)) {
        this.bytes -= this.checkpoints.get(step)!.bytes;
        this.checkpoints.delete(step);
      } else newer = step;
    }
  }

  /** The steps a checkpoint is held at, oldest first. */
  get kept(): readonly number[] {
    return [...this.checkpoints.keys()];
  }
}
