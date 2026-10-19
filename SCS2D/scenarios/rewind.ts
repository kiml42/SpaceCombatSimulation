import { floor, max } from '../sim/math.js';
import { cloneBattle } from './clone.js';
import type { Battle } from './types.js';

/** Steps between checkpoints, to begin with. */
const EVERY = 30;
/** Checkpoints kept before every other one is dropped and the spacing doubled. */
const KEPT = 128;

/**
 * A battle that can be wound back. It keeps a copy of itself every so often,
 * and goes to an earlier step by copying the checkpoint before it and
 * stepping on from there, which comes out identical because the battle is
 * deterministic. Re-simulating from the start alone was too slow: a big
 * battle steps barely faster than it plays.
 *
 * The spacing doubles as checkpoints pile up, so memory stays bounded and a
 * long battle costs more to wind back than a short one.
 */
export class Rewind {
  battle: Battle;
  /** Steps taken since the start. */
  at = 0;
  /** The furthest step reached, which a scrub bar runs to. */
  reached = 0;
  private every = EVERY;
  /** Copies never stepped, by the step each was taken at. */
  private readonly checkpoints = new Map<number, Battle>();

  /** `battle` at its first step. */
  constructor(battle: Battle) {
    this.battle = battle;
    this.checkpoints.set(0, cloneBattle(battle));
  }

  step(): void {
    this.battle.step();
    this.at++;
    if (this.at > this.reached) this.reached = this.at;
    if (this.at % this.every === 0 && !this.checkpoints.has(this.at)) this.keep();
  }

  /** Go to step `target`; true if it left the battle it had for a copy. */
  seek(target: number): boolean {
    const to = max(0, floor(target));
    const from = to - (to % this.every);
    // Stepping on from where it is beats copying a checkpoint no nearer.
    const restored = to < this.at || (from > this.at && from <= this.reached);
    if (restored) {
      this.battle = cloneBattle(this.checkpoints.get(from)!);
      this.at = from;
    }
    while (this.at < to) this.step();
    return restored;
  }

  private keep(): void {
    this.checkpoints.set(this.at, cloneBattle(this.battle));
    if (this.checkpoints.size <= KEPT) return;
    this.every *= 2;
    for (const step of this.checkpoints.keys()) if (step % this.every !== 0) this.checkpoints.delete(step);
  }
}
