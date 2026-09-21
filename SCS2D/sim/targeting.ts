import type { Bodies } from './bodies.js';
import type { Doctrine } from './doctrine.js';
import { length } from './math.js';

/**
 * Choosing what to shoot at.
 *
 * A **stack of pickers**, each either discarding a candidate outright or
 * adjusting its score, and the best score wins. The shape is the one the old
 * project arrived at (DESIGN.md §10) and it is worth keeping for two reasons:
 * a discard is absolute, so "never shoot at that" is expressible rather than
 * merely very unlikely; and everything else composes, so a doctrine is a set
 * of preferences that argue with each other rather than a decision tree
 * somebody has to maintain.
 *
 * The same question is asked by a hull choosing what to fly at and by a mount
 * choosing what to fire at, so it is answered in one place and neither can
 * disagree with the other about what a good target is.
 */

/** What is known about a candidate, so a picker need not go and look. */
export interface Candidate {
  /** Which ship it is, as the ships store indexes them. */
  readonly ship: number;
  /** Metres from the chooser. */
  readonly range: number;
  /** Metres per second it is closing at. Negative while it is opening. */
  readonly closing: number;
  /** Kilograms, which stands in for how much killing it is worth. */
  readonly mass: number;
  /** Whether it can no longer either move or shoot (§4's hulk). */
  readonly disabled: boolean;
}

/** A hundred tonnes, so `valueWeight` is "score per capital ship". */
const VALUE_SCALE = 100_000;
/** A hundred metres a second, so `closingWeight` is per ramming speed. */
const CLOSING_SCALE = 100;

/**
 * What a doctrine thinks of one candidate.
 *
 * Every term is a preference rather than a rule, so they add. Proximity is
 * measured against the chooser's own `reach` rather than in metres — a target
 * at arm's length scores the full weight, one at the edge of what the guns
 * are good for scores nothing, and one beyond that scores against, which is
 * what makes a ship close rather than plink.
 */
export function score(
  doctrine: Doctrine,
  candidate: Candidate,
  reach: number,
  loyalTo: number,
): number {
  let total = 0;
  if (reach > 0) total += doctrine.proximityWeight * (1 - candidate.range / reach);
  total += doctrine.valueWeight * (candidate.mass / VALUE_SCALE);
  total += doctrine.closingWeight * (candidate.closing / CLOSING_SCALE);
  if (candidate.ship === loyalTo) total += doctrine.loyaltyWeight;
  // Last, and a multiplier rather than a term: a doctrine that does not
  // finish off hulks should not be talked into one by how close it is.
  if (candidate.disabled) total *= doctrine.hulkValue;
  return total;
}

/**
 * The best of what a chooser can see, or -1 if nothing is worth it.
 *
 * Walked in ship order and kept only on a strictly better score, so a tie
 * goes to the lower index and the same fleet in the same state always picks
 * the same fight.
 */
export class Choice {
  ship = -1;
  best = 0;
  private started = false;

  begin(): void {
    this.ship = -1;
    this.best = 0;
    this.started = false;
  }

  offer(candidate: Candidate, value: number): void {
    // A target worth nothing is worth not turning the ship round for.
    if (value <= 0) return;
    if (this.started && value <= this.best) return;
    this.started = true;
    this.best = value;
    this.ship = candidate.ship;
  }
}

/** Fill in what the pickers need to know about a target, from the bodies. */
export function look(
  bodies: Bodies,
  from: number,
  to: number,
  ship: number,
  mass: number,
  disabled: boolean,
): Candidate {
  const dx = bodies.x[to]! - bodies.x[from]!;
  const dy = bodies.y[to]! - bodies.y[from]!;
  const range = length(dx, dy);
  let closing = 0;
  if (range > 0) {
    // Along the line between them: how fast the gap is shutting, which is
    // what "coming at you" means and is not the same as how fast it is going.
    const dvx = bodies.vx[to]! - bodies.vx[from]!;
    const dvy = bodies.vy[to]! - bodies.vy[from]!;
    closing = -(dvx * dx + dvy * dy) / range;
  }
  return { ship, range, closing, mass, disabled };
}
