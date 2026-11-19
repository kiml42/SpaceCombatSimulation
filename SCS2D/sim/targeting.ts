import type { Bodies } from "./bodies.js";
import type { Targeting } from "./doctrine.js";
import { abs, cos, length, log, max, min, sin, sqrt } from "./math.js";

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
    /**
     * The cosine of how far off the chooser's facing it lies: one dead ahead,
     * zero abeam, minus one astern. A hull faces along its nose, a mount along
     * its barrel.
     */
    readonly facing: number;
    /**
     * How much of it can be seen, from nothing behind a rock to one with
     * nothing in the way (`visibility`). Only looked for when a doctrine
     * weighs it, and one otherwise.
     */
    readonly sight: number;
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
 * **A hulk that can still be reached scores like any other candidate** — no
 * guns to earn `armedWeight`, no engines to earn `mobileWeight` — so a ship
 * only a little worse off than a hulk falls behind every live one on the
 * list by exactly what a doctrine says those are worth, with no special case
 * about what it has become. A ship with *nothing* left, though, is filtered
 * out before it ever reaches `score`: the caller checks `Ships.hasControl`,
 * because a hull with no working core can never be finished off, so ranking it
 * low is not enough to stop a chooser sitting next to one forever when a live
 * threat is further off.
 *
 * **A hull is out of the fight only when its cores are gone**, and not merely
 * when it has lost its guns and its engines. One of those is harmless and
 * still finishable — a round through the core ends it — so it stays a
 * candidate and stays worth a shot when there is nothing better about. Filter
 * it out instead and being harmless becomes the safest thing a ship can be:
 * untouchable by everyone, for as long as it likes.
 */
export function score(
    doctrine: Targeting,
    candidate: Candidate,
    reach: number,
    own: number,
    loyalTo: number,
    focusOn = -1,
    /** The size wanted, as a multiple of `own`; `preferredMass` unless the chooser would ram. */
    wanted = doctrine.preferredMass,
): number {
    let total = 0;
    if (reach > 0) total += doctrine.proximityWeight * (1 - candidate.range / reach);
    total += doctrine.massWeight * (1 - sizeMiss(wanted, candidate.mass, own));
    total += doctrine.closingWeight * (candidate.closing / CLOSING_SCALE);
    if (candidate.ship === loyalTo) total += doctrine.loyaltyWeight;
    if (candidate.ship === focusOn) total += doctrine.focusWeight;
    if (candidate.armed) total += doctrine.armedWeight;
    if (candidate.mobile) total += doctrine.mobileWeight;
    total += doctrine.facingWeight * candidate.facing;
    total += doctrine.sightWeight * candidate.sight;
    return total;
}

/**
 * How much a craft wants to be with its consort rather than where it is.
 *
 * **A pull among several, not a decision between two.** The obvious design is
 * to weigh covering a consort against going to the fight and fly at whichever
 * wins. It cannot work, and the reason is worth keeping: a target's score is a
 * *ranking* rather than a measure of desire. A craft flies at the nearest
 * enemy whether or not its score says it is worth anything, and at four
 * kilometres that score is far below zero — so any positive pull at all beat
 * it and the fleet locked in place, whatever the weight. Measured on a fleet
 * of four: every setting from 2 to 200 produced the identical battle, sitting
 * four kilometres from an enemy it never went to.
 *
 * What a steering urge is weighed against is other steering urges, in metres
 * per second, where both sides mean the same thing. The craft then does both
 * at once — closing on the enemy while drifting back towards its consort —
 * rather than being switched between them.
 *
 * It fades to nothing as the gap closes, so a craft that has caught up is
 * pulled by the fight alone until the fight has drawn it off again: from
 * nothing at the inner side of the station's fade (`bandFade` of it short of
 * it) to full strength a station's distance further out.
 */
export function cohesionUrge(doctrine: Targeting, gap: number, station: number, fade: number, inner = 0): number {
    return max(slack(gap, station, fade), crowding(gap, inner, fade)) * doctrine.escortWeight;
}

/** The inside edge's mirror of `slack`: nothing outside its fade, one at touching distance or closer. */
function crowding(range: number, inner: number, fade: number): number {
    if (!(inner > 0)) return 0;
    const under = (inner * (1 + fade) - range) / inner;
    return under <= 0 ? 0 : under >= 1 ? 1 : under;
}

/** One a station's distance past the inner side of its fade or further, nothing inside it. */
function slack(range: number, station: number, fade: number): number {
    if (!(station > 0)) return 1;
    const over = (range - station * (1 - fade)) / station;
    return over <= 0 ? 0 : over >= 1 ? 1 : over;
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
function sizeMiss(wanted: number, mass: number, own: number): number {
    if (!(mass > 0) || !(own > 0) || !(wanted > 0)) return 0;
    return abs(log(mass / (own * wanted)));
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

/**
 * How much of body `to` can be seen from a point, from 0 to 1: the share of
 * its width, as seen from there, that no solid body but `from` and `to`
 * covers. Each body between is projected onto the target by similar
 * triangles, so a hull partly in the way covers part of it and a rock
 * bigger than it, nearer, covers all of it. Several are taken as covering
 * independently, which can overcount where they overlap.
 *
 * Bounding circles, so a long thin hull covers more than it should, and a
 * rock that is not round a little more than it does. Only what lies between
 * the two counts: a body behind the chooser or beyond the target is not in
 * the way of anything.
 */
export function visibility(bodies: Bodies, fromX: number, fromY: number, from: number, to: number): number {
    const dx = bodies.x[to]! - fromX;
    const dy = bodies.y[to]! - fromY;
    const lengthSq = dx * dx + dy * dy;
    if (!(lengthSq > 0)) return 1;
    const span = sqrt(lengthSq);
    const half = bodies.radius[to]!;
    let seen = 1;
    for (let k = 0; k < bodies.count && seen > 0; k++) {
        if (k === from || k === to || bodies.ghost[k] === 1) continue;
        const ox = bodies.x[k]! - fromX;
        const oy = bodies.y[k]! - fromY;
        const along = (ox * dx + oy * dy) / lengthSq;
        if (along <= 0 || along >= 1) continue;
        // Its centre and radius as they fall across the target, from the chooser's eye.
        const centre = (dx * oy - dy * ox) / span / along;
        const reach = bodies.radius[k]! / along;
        if (!(half > 0)) {
            if (abs(centre) < reach) return 0;
            continue;
        }
        const covered = min(half, centre + reach) - max(-half, centre - reach);
        if (covered > 0) seen *= 1 - min(1, covered / (2 * half));
    }
    return seen;
}

/** Fill in what the pickers need to know about a target, from the bodies. */
export function look(bodies: Bodies, from: number, to: number, ship: number, mass: number, armed: boolean, mobile: boolean): Candidate {
    const angle = bodies.angle[from]!;
    return lookFrom(
        bodies,
        bodies.x[from]!,
        bodies.y[from]!,
        bodies.vx[from]!,
        bodies.vy[from]!,
        cos(angle),
        sin(angle),
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
    faceX: number,
    faceY: number,
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
    let facing = 1;
    if (range > 0) {
        facing = (faceX * dx + faceY * dy) / range;
        // Along the line between them: how fast the gap is shutting, which is
        // what "coming at you" means and is not the same as how fast it is going.
        const dvx = bodies.vx[to]! - fromVx;
        const dvy = bodies.vy[to]! - fromVy;
        closing = -(dvx * dx + dvy * dy) / range;
    }
    return { ship, range, closing, mass, armed, mobile, facing, sight: 1 };
}
