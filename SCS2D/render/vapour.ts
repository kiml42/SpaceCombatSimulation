import { leakRate, PATCH_SPEED } from "../sim/fuel.js";

/**
 * Fuel leaking from a hole, as puffs of vapour worked out afresh each frame
 * from the hole's own history: when each left, and how wide the hole was then.
 * Puffs leave on a fixed grid of times since the hole opened, so the same
 * moment is the same picture, and pausing, stepping and scrubbing need
 * nothing of their own. A hole narrowing or closed sends out less or nothing,
 * while what already left drifts on and thins.
 *
 * Placed in the hull's frame as it is now, so the stream turns with the ship.
 * Drawn only: nothing here changes what happens.
 */

/** Seconds between the puffs a hole sends out. */
export const PUFF_EVERY = 1 / 40;
/** How long a leak's vapour is drawn, metres per √(kg/s) going out of it, and at least, in the hole's widths. */
export const VAPOUR_LENGTH = 1.5;
const VAPOUR_LEAST_LENGTH = 8;
/** How far the vapour has spread to either side by the end of it, as a share of how far it has gone. */
const VAPOUR_SPREAD = 0.3;
/** How much faster or slower than the rest a puff may leave, as a share. */
const PUFF_SPEED_SPREAD = 0.15;
/** How opaque the vapour is, all its puffs over each other, where it leaves the hole. */
const VAPOUR_ALPHA = 0.6;
/** Most puffs one moment's leaving makes, for the widest hole. */
const MOST_PUFFS = 4;

/** What a hole has been, as the snapshot carries it, for working out how wide it was at any age. */
export interface Hole {
    /** How wide it opened, metres. */
    opened: number;
    /** How fast its lining closed it, m/s, and the narrowest it could. */
    closing: number;
    floor: number;
    /** How old it was when it was patched, or below nought if it has not been. */
    patched: number;
}

/** How wide a hole was at `age`: narrowing as its lining closes it, and closing all the way once patched. */
export function holeWidth(hole: Hole, age: number): number {
    const lined = (a: number): number => Math.max(hole.floor, hole.opened - hole.closing * a);
    if (!(hole.patched >= 0) || age < hole.patched) return lined(Math.max(0, age));
    return Math.max(0, lined(hole.patched) - Math.max(hole.closing, PATCH_SPEED) * (age - hole.patched));
}

/** How far the vapour from a hole this wide, leaking this fast, is seen to reach. */
export function vapourLength(width: number, rate: number): number {
    return Math.max((width * VAPOUR_LEAST_LENGTH) / 2, VAPOUR_LENGTH * Math.sqrt(rate));
}

/** One puff as it is now, in the hull's frame. */
export interface Puff {
    x: number;
    y: number;
    radius: number;
    /** The way it is going, and how long it is drawn along that way: at least as long as it is wide. */
    dirX: number;
    dirY: number;
    length: number;
    alpha: number;
}

/** How far along its way a puff is drawn, as a share of the gap to the next one out of the hole: enough to meet it. */
const PUFF_OVERLAP = 1.6;

/**
 * Every puff from a hole at `(x, y)` in the hull's frame, leaving along
 * `(dirX, dirY)` at `speed` from a tank `fill` full, `age` seconds after it
 * opened; `visit` sees each, in `out`.
 */
export function eachPuff(
    hole: Hole,
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    age: number,
    fill: number,
    speed: number,
    out: Puff,
    visit: (puff: Puff) => void,
): void {
    if (!(speed > 0) || !(age >= 0)) return;
    // Back as far as the longest-lived puff could have left, which is from the hole at its widest.
    const longest =
        vapourLength(hole.opened, leakRate((Math.PI * hole.opened * hole.opened) / 4, fill)) / (speed * (1 - PUFF_SPEED_SPREAD));
    const first = Math.max(0, Math.ceil((age - longest) / PUFF_EVERY));
    const last = Math.floor(age / PUFF_EVERY);
    const seed = Math.imul(Math.round(x * 1024) ^ Math.imul(Math.round(y * 1024), 0x9e3779b1), 0x85ebca6b);
    for (let n = first; n <= last; n++) {
        const born = n * PUFF_EVERY;
        const width = holeWidth(hole, born);
        if (!(width > 0)) continue;
        const rate = leakRate((Math.PI * width * width) / 4, fill);
        const reach = vapourLength(width, rate);
        const life = reach / speed;
        const since = age - born;
        if (since >= life * (1 + PUFF_SPEED_SPREAD)) continue;
        const puffs = Math.min(MOST_PUFFS, 1 + Math.round(Math.cbrt(rate) / 3));
        for (let m = 0; m < puffs; m++) {
            const fast = 1 + (unit(seed, n * MOST_PUFFS + m, 0) * 2 - 1) * PUFF_SPEED_SPREAD;
            const gone = speed * fast * since;
            // Gone past the end of the vapour: thinned to nothing.
            const through = gone / reach;
            if (through >= 1) continue;
            const across = (unit(seed, n * MOST_PUFFS + m, 1) * 2 - 1) * VAPOUR_SPREAD * gone;
            out.x = x + dirX * gone - dirY * across;
            out.y = y + dirY * gone + dirX * across;
            out.radius = width / 2 + VAPOUR_SPREAD * gone;
            // Drawn out along its way to meet the next, where it is narrower than
            // the gap between them: a small leak's puffs then run together into a
            // plume, as a big one's already do by being wide.
            const gap = speed * fast * PUFF_EVERY;
            out.dirX = dirX;
            out.dirY = dirY;
            out.length = Math.max(2 * out.radius, gap * PUFF_OVERLAP);
            // Its share of the vapour's opacity, thinning as it spreads out, and
            // shared with the next where drawn out over it.
            const spread = Math.min(1, Math.max(2 * out.radius, gap) / out.length);
            out.alpha = (VAPOUR_ALPHA / Math.sqrt(puffs)) * (1 - through) ** 2 * spread;
            visit(out);
        }
    }
}

/** A number in [0, 1) from a seed, an index and a salt, the same every time. */
function unit(seed: number, index: number, salt: number): number {
    let h = Math.imul(seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x27d4eb2f), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}
