import { EngineLayout } from "./engines.js";
import { abs, angleDelta, atan2, clamp, cos, max, min, PI, sin, sqrt } from "./math.js";

/**
 * The helm: how a ship delivers the velocity and heading its pilot asks for
 * with whatever engines it has left. Nothing here knows what the ship is doing
 * — landing, ramming, fleeing — only what its layout can and cannot do.
 *
 * A pilot that cares which way it faces asks for a heading and gets it. One
 * that only cares where it goes leaves the heading to the helm (`steerHeading`),
 * which turns its strongest push onto the change it needs. A layout that cannot
 * hold a heading — one that turns only one way, or far more readily one way,
 * or whose push turns it — spins instead (`spinWay`), firing as its push comes
 * round; unless it is in a hurry, when a third of its push on average is too
 * little, and it turns its push round however it can and burns.
 */

/**
 * The most change of velocity, m/s, a ship steering by its push makes without
 * turning for it, unless its pilot asks for less (`steerHeading`'s `slack`);
 * how far off that change its push may point while it does, with no heading of
 * its own to rest on, so that at least half of it goes its way; and the least
 * change it turns for at all.
 */
export const STEER_HOLD_SPEED = 5;
export const STEER_HOLD_ANGLE = PI / 3;
export const STEER_MIN_SPEED = 0.5;

/** The spin a ship that cannot hold a heading keeps, rad/s: a turn every eight seconds. */
export const STEER_SPIN = (2 * PI) / 8;

/**
 * How much weaker one way a turn may be than the other, as a share, for a
 * ship to steer by turning: weaker, it overshoots each turn that way and
 * weaves, so it spins instead.
 */
export const WEAK_TURN = 0.5;

/**
 * The share of what a layout pushes along a bearing that it must be able to
 * push without turning to steer by turning: less, and every push turns it
 * further than it can hold its heading against, so it spins instead.
 */
export const STEADY_PUSH = 0.5;

/**
 * The way a layout pushes hardest, body frame: its mains' `bearing` while
 * nothing else pushes harder, or the way of whichever engine left does.
 */
export function pushBearing(layout: EngineLayout, bearing: number): number {
    let best = bearing;
    let most = layout.maxThrustAlong(cos(bearing), sin(bearing));
    for (let t = 0; t < layout.count; t++) {
        const along = layout.maxThrustAlong(layout.dirX[t]!, layout.dirY[t]!);
        if (along > most) {
            most = along;
            best = atan2(layout.dirY[t]!, layout.dirX[t]!);
        }
    }
    return best;
}

/** The way a layout turns far more readily, 1 or -1, or 0 if both ways near enough alike, or neither. */
export function oneWayTurn(layout: EngineLayout): number {
    const up = layout.maxTorque(1);
    const down = layout.maxTorque(-1);
    if (up > 0 && !(down > WEAK_TURN * up)) return 1;
    if (down > 0 && !(up > WEAK_TURN * down)) return -1;
    return 0;
}

/** Scratch for `spinWay`: which engines it has already counted, grown to the most engines seen. */
let spent = new Uint8Array(16);

/**
 * The way a layout steering by its push along `bearing` spins, 1 or -1, or 0
 * if it can hold a heading: the way it turns far more readily (`oneWayTurn`),
 * or, when what it pushes that way with its turns cancelled is less than
 * `STEADY_PUSH` of what it pushes that way at all, the way that push turns it.
 */
export function spinWay(layout: EngineLayout, bearing: number): number {
    const way = oneWayTurn(layout);
    if (way !== 0) return way;
    const dx = cos(bearing);
    const dy = sin(bearing);
    let level = 0;
    let all = 0;
    let up = 0;
    let down = 0;
    for (let t = 0; t < layout.count; t++) {
        const push = layout.wfx[t]! * dx + layout.wfy[t]! * dy;
        if (!(push > 0)) continue;
        all += push;
        const turn = layout.wt[t]!;
        if (turn > 0) up += turn;
        else if (turn < 0) down -= turn;
        else level += push;
    }
    if (!(all > 0)) return 0;
    if (spent.length < layout.count) spent = new Uint8Array(layout.count);
    // Of the side that turns it less, all; of the other, as much as cancels it,
    // the engines that push hardest for the turn they bring first.
    const sense = up > down ? 1 : -1;
    let budget = sense > 0 ? down : up;
    let steady = level;
    for (let t = 0; t < layout.count; t++) {
        const push = layout.wfx[t]! * dx + layout.wfy[t]! * dy;
        if (push > 0 && layout.wt[t]! * sense < 0) steady += push;
    }
    while (budget > 0) {
        let best = -1;
        let bestRatio = 0;
        for (let t = 0; t < layout.count; t++) {
            const push = layout.wfx[t]! * dx + layout.wfy[t]! * dy;
            const turn = layout.wt[t]! * sense;
            if (!(push > 0) || !(turn > 0) || spent[t] === 1) continue;
            if (push / turn > bestRatio) {
                bestRatio = push / turn;
                best = t;
            }
        }
        if (best < 0) break;
        spent[best] = 1;
        const turn = layout.wt[best]! * sense;
        const share = turn <= budget ? 1 : budget / turn;
        steady += share * (layout.wfx[best]! * dx + layout.wfy[best]! * dy);
        budget -= share * turn;
    }
    spent.fill(0, 0, layout.count);
    return steady < STEADY_PUSH * all ? sense : 0;
}

/**
 * The heading that turns push `bearing` onto the change of velocity
 * (`dvx`, `dvy`) a ship at `heading` still needs, or `rest` when that change
 * is too small to turn for: under `STEER_MIN_SPEED`, or under `slack`. A pilot
 * that has to arrive gently asks for less slack, since a push that far off
 * brakes it short of what it planned on.
 *
 * A pilot with no heading of its own to rest on (`free`, `rest` being where it
 * faces now) also turns for any change its push points more than
 * `STEER_HOLD_ANGLE` from, or it would be pushed the wrong way for want of a
 * reason to turn; under `slack` otherwise, so it does not weave, turning after
 * each small correction and overshooting it while it turns. One with a heading
 * to rest on, a target's or a port's, holds it and lets its other engines
 * make the small corrections.
 */
export function steerHeading(
    dvx: number,
    dvy: number,
    heading: number,
    rest: number,
    bearing: number,
    slack: number,
    free: boolean,
): number {
    const need = dvx * dvx + dvy * dvy;
    if (!(need > STEER_MIN_SPEED * STEER_MIN_SPEED)) return rest;
    const toward = atan2(dvy, dvx) - bearing;
    if (need > slack * slack || (free && abs(angleDelta(heading, toward)) > STEER_HOLD_ANGLE)) return toward;
    return rest;
}

/** The torque of pushing along (`fx`, `fy`), body frame, on each engine as far as it points that way, turn or no turn. */
export function pushTorque(layout: EngineLayout, fx: number, fy: number): number {
    let torque = 0;
    for (let t = 0; t < layout.count; t++) {
        const wfx = layout.wfx[t]!;
        const wfy = layout.wfy[t]!;
        const full = wfx * wfx + wfy * wfy;
        if (!(full > 0)) continue;
        torque += clamp((wfx * fx + wfy * fy) / full, 0, 1) * layout.wt[t]!;
    }
    return torque;
}

/** Seconds for a layout to turn a body of `inertia` through `by` radians from rest and stop, flat out. */
export function turnTime(layout: EngineLayout, inertia: number, by: number): number {
    const alpha = layout.maxTorque(by >= 0 ? 1 : -1) / inertia;
    return alpha > 0 ? 2 * sqrt(abs(by) / alpha) : Infinity;
}

/**
 * The share of a change of velocity (`dvx`, `dvy`), wanted over `response`
 * seconds, that turning push `bearing` onto it makes sooner than holding
 * `heading` would, turn included: by the time the turned push has made it, or
 * by `by` if that is sooner; -1 when there is nothing to turn for: no change
 * wanted, no push that way, or no turn to make it with. What a pilot weighs
 * that against — its guns, its band — is its own business.
 */
export function burnGain(
    layout: EngineLayout,
    mass: number,
    inertia: number,
    heading: number,
    dvx: number,
    dvy: number,
    response: number,
    bearing: number,
    by = Infinity,
): number {
    const dv = sqrt(dvx * dvx + dvy * dvy);
    const push = layout.maxThrustAlong(cos(bearing), sin(bearing)) / mass;
    if (!(dv > 0) || !(push > 0)) return -1;
    const ux = dvx / dv;
    const uy = dvy / dv;
    // What the layout gives along the want, held at `heading`.
    const c = cos(heading);
    const s = sin(heading);
    const held = layout.maxThrustAlong(ux * c + uy * s, -ux * s + uy * c) / mass;
    const turn = turnTime(layout, inertia, angleDelta(heading, atan2(uy, ux) - bearing));
    if (!(turn < Infinity)) return -1;
    // The pilot asks for no more than the change over its response time, so
    // thrust past that is no use either way.
    const want = dv / response;
    const turnedRate = min(push, want);
    const heldRate = min(held, want);
    const turned = turn + dv / turnedRate;
    const until = min(turned, by);
    return max(0, min(dv, turnedRate * max(0, until - turn)) - min(dv, heldRate * until)) / dv;
}
