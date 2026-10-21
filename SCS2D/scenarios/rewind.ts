import { abs, ceil, floor, max } from '../sim/math.js';
import { sizedClone } from './clone.js';
import { give, type Command, type Logged } from './commands.js';
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
 * Orders are commands logged at the step they were given, and given again
 * there whenever it is stepped through, so a rewind replays them; a new one
 * after a rewind throws away everything logged after it, and the battle's
 * future with it. A checkpoint holds what was given at its own step.
 *
 * Given a clock, checkpoints are spaced so copying costs a small share of
 * stepping, since a big battle is slow to copy. Older ones are thinned out,
 * so they grow sparser with age, and more so when they hold too much. Where
 * they fall changes nothing but where a scrub bar can land and how long a
 * step back takes.
 *
 * A viewer can keep something of its own with each checkpoint, such as the
 * flashes on screen there, which no amount of stepping on from it rebuilds.
 */
export class Rewind<Kept = undefined> {
  battle: Battle;
  /** Steps taken since the start. */
  at = 0;
  /** The furthest step reached, which a scrub bar runs to. */
  reached = 0;
  private every = EVERY;
  /** Copies never stepped, by the step each was taken at, in order. */
  private readonly checkpoints = new Map<number, { battle: Battle; bytes: number; kept: Kept | undefined }>();
  private bytes = 0;
  private last = 0;
  private spread = SPREAD;
  /** Milliseconds a step takes, smoothed; NaN until timed. */
  private stepCost = Number.NaN;
  /** Commands by the step they were given at, in the order given. */
  private readonly log = new Map<number, Command[]>();

  /**
   * `battle` at its first step; `now` a clock in milliseconds, if checkpoints
   * are to be paced by cost; `log` the orders it was given, from a link;
   * `keepAlso` what the viewer holds with each checkpoint, as it is taken.
   */
  constructor(
    battle: Battle,
    private readonly now?: () => number,
    log: readonly Logged[] = [],
    private readonly keepAlso?: (battle: Battle) => Kept,
  ) {
    this.battle = battle;
    for (const { step, command } of log) this.record(step, command);
    this.giveAt(0);
    this.keep();
  }

  /** Give a command now. Everything logged after now, and the future reached, is thrown away. */
  issue(command: Command): void {
    for (const step of [...this.log.keys()]) if (step > this.at) this.log.delete(step);
    for (const [step, checkpoint] of [...this.checkpoints]) {
      if (step <= this.at) continue;
      this.checkpoints.delete(step);
      this.bytes -= checkpoint.bytes;
    }
    this.reached = this.at;
    this.record(this.at, command);
    give(this.battle, command);
    // A checkpoint here holds what was given here.
    const here = this.checkpoints.get(this.at);
    if (here !== undefined) {
      const { copy, bytes } = sizedClone(this.battle);
      this.bytes += bytes - here.bytes;
      this.checkpoints.set(this.at, { battle: copy, bytes, kept: here.kept });
    }
    this.last = this.lastKept();
  }

  /** Every command given, in the order given. */
  get orders(): Logged[] {
    const out: Logged[] = [];
    for (const step of [...this.log.keys()].sort((a, b) => a - b)) {
      for (const command of this.log.get(step)!) out.push({ step, command });
    }
    return out;
  }

  private record(step: number, command: Command): void {
    const at = this.log.get(step);
    if (at === undefined) this.log.set(step, [command]);
    else at.push(command);
  }

  private giveAt(step: number): void {
    const commands = this.log.get(step);
    if (commands !== undefined) for (const command of commands) give(this.battle, command);
  }

  step(): void {
    const start = this.now?.();
    this.battle.step();
    if (start !== undefined) {
      const took = this.now!() - start;
      this.stepCost = this.stepCost !== this.stepCost ? took : this.stepCost + (took - this.stepCost) * 0.05;
    }
    this.at++;
    this.giveAt(this.at);
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

  /**
   * Go to step `target`; true if it left the battle it had for a copy.
   * `restored` is told when it does, before stepping on, with what the viewer
   * kept there; `stepped` after each step on, for what it would have drawn of it.
   */
  seek(target: number, restored?: (kept: Kept | undefined) => void, stepped?: (battle: Battle) => void): boolean {
    const to = max(0, floor(target));
    let from = 0;
    for (const step of this.checkpoints.keys()) if (step <= to) from = step;
    // Stepping on from where it is beats copying a checkpoint no nearer.
    const copied = to < this.at || from > this.at;
    if (copied) {
      const checkpoint = this.checkpoints.get(from)!;
      this.battle = sizedClone(checkpoint.battle).copy;
      // What the original had not yet drawn when the copy was taken is long gone.
      this.battle.impacts.log.clear();
      this.at = from;
      this.last = from;
      restored?.(checkpoint.kept);
    }
    while (this.at < to) {
      this.step();
      stepped?.(this.battle);
    }
    return copied;
  }

  private lastKept(): number {
    let latest = -1;
    for (const step of this.checkpoints.keys()) latest = step;
    return latest;
  }

  private keep(): void {
    const start = this.now?.();
    const { copy, bytes } = sizedClone(this.battle);
    const kept = { battle: copy, bytes, kept: this.keepAlso?.(this.battle) };
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
