import type { Bodies } from './bodies.js';
import type { Targeting } from './doctrine.js';
import { abs, length, log } from './math.js';

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
  /** Whether any of its guns still work. */
  readonly armed: boolean;
  /** Whether it can still push itself about. */
  readonly mobile: boolean;
}

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
 *
 * `focusOn` is what the chooser's ship as a whole is fighting, which a mount
 * is drawn towards rather than bound to — so a broadside concentrates without
 * a gun on the wrong side being left with nothing to do.
 *
 * **A hulk needs no rule of its own.** It has no guns to earn `armedWeight`
 * and no engines to earn `mobileWeight`, so it falls behind every live ship
 * on the list by exactly the amount a doctrine says those are worth. §3's
 * mission kill is then a consequence of what a ship *is* rather than a
 * special case about what it has become.
 */
export function score(
  doctrine: Targeting,
  candidate: Candidate,
  reach: number,
  own: number,
  loyalTo: number,
  focusOn = -1,
): number {
  let total = 0;
  if (reach > 0) total += doctrine.proximityWeight * (1 - candidate.range / reach);
  total += doctrine.massWeight * (1 - sizeMiss(doctrine, candidate.mass, own));
  total += doctrine.closingWeight * (candidate.closing / CLOSING_SCALE);
  if (candidate.ship === loyalTo) total += doctrine.loyaltyWeight;
  if (candidate.ship === focusOn) total += doctrine.focusWeight;
  if (candidate.armed) total += doctrine.armedWeight;
  if (candidate.mobile) total += doctrine.mobileWeight;
  return total;
}

/**
 * How far off the wanted size a target is, as a natural logarithm.
 *
 * **Measured as a ratio rather than a difference**, because that is what
 * "similar size" means across a fleet spanning a fighter to a capital: half
 * my mass and twice my mass are equally wrong, and ten tonnes is a rounding
 * error to one ship and the whole of another. Zero is exactly the size
 * wanted, and one is a factor of `e` out in either direction.
 *
 * The score built from it reads like proximity's: full weight at the ideal,
 * nothing one unit away, and against beyond that — so a ship that can only
 * see targets far from its weight class goes after the nearest of them
 * rather than refusing to fight.
 */
function sizeMiss(doctrine: Targeting, mass: number, own: number): number {
  if (!(mass > 0) || !(own > 0) || !(doctrine.preferredMass > 0)) return 0;
  return abs(log(mass / (own * doctrine.preferredMass)));
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
    // Ranking rather than a threshold: a score is only ever worth comparing
    // with another score. A fleet with nothing appealing left to shoot at
    // still finishes the job, and a craft that would rather fight its own
    // weight class still takes on a capital when that is all there is.
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
  armed: boolean,
  mobile: boolean,
): Candidate {
  return lookFrom(
    bodies,
    bodies.x[from]!,
    bodies.y[from]!,
    bodies.vx[from]!,
    bodies.vy[from]!,
    to,
    ship,
    mass,
    armed,
    mobile,
  );
}

/**
 * The same, seen from a point rather than from a body.
 *
 * **A mount asks from where it sits, not from its ship's centre.** Two guns
 * on opposite beams are metres apart and that is almost nothing beside
 * gunnery range — but it is enough to order two targets differently, which is
 * what stops a pair of them piling onto the same one. It is also the truth:
 * the range a gun has to shoot is the range from the gun.
 */
export function lookFrom(
  bodies: Bodies,
  fromX: number,
  fromY: number,
  fromVx: number,
  fromVy: number,
  to: number,
  ship: number,
  mass: number,
  armed: boolean,
  mobile: boolean,
): Candidate {
  const dx = bodies.x[to]! - fromX;
  const dy = bodies.y[to]! - fromY;
  const range = length(dx, dy);
  let closing = 0;
  if (range > 0) {
    // Along the line between them: how fast the gap is shutting, which is
    // what "coming at you" means and is not the same as how fast it is going.
    const dvx = bodies.vx[to]! - fromVx;
    const dvy = bodies.vy[to]! - fromVy;
    closing = -(dvx * dx + dvy * dy) / range;
  }
  return { ship, range, closing, mass, armed, mobile };
}
