import { LIVERY_PATTERNS, type Livery } from "./livery.js";
import { PI } from "./math.js";
import { Rng } from "./rng.js";

/**
 * How an evolved side is painted: a livery of its own from the start, drifting
 * a little with every child, and leaning away from the colours of whoever it
 * is bred against so the two stay told apart (ROADMAP.md §8 step 17).
 *
 * Only drawn, so it is drawn from a generator of its own, split from the one
 * breeding, which it never moves: a run bred with liveries fights exactly as
 * one without.
 */

/** The stock side colours' hulls, as a side with no livery is drawn: blue first, as the player is. */
export const STOCK_BASES = ["#5b8dd6", "#d65b5b", "#5bd66f", "#d65bd6"] as const;

/** A generator for a livery, from where `rng` stands, without moving it. */
export function liveryRng(rng: Rng, salt: number): Rng {
    return new Rng(rng.clone().nextUint32() ^ salt ^ 0x4c495652);
}

/** How far a colour's hue, saturation and lightness move in one child, at most. */
const HUE_STEP = 0.03;
const TONE_STEP = 0.04;
/** How far a pattern's size and spacing move in one child, as a share of what they were. */
const SCALE_STEP = 0.1;
const OFFSET_STEP = 0.05;
const ANGLE_STEP = (5 * PI) / 180;
/** How often a child switches pattern. */
const PATTERN_SWITCH = 0.05;
/** Drawn when leaning away: the child takes whichever is further from what it leans from. */
const LEAN_DRAWS = 2;
/** Drawn for a first livery, the furthest from what it leans from kept. */
const FIRST_DRAWS = 8;

/** A child's livery: its parent's, drifted, leaning away from `away`'s colours. */
export function driftLivery(parent: Livery, rng: Rng, away: readonly string[]): Livery {
    let best = drifted(parent, rng);
    for (let k = 1; k < LEAN_DRAWS && away.length > 0; k++) {
        const other = drifted(parent, rng);
        if (nearest(other.base, away) > nearest(best.base, away)) best = other;
    }
    return best;
}

/** A livery to start with, far from `away`'s colours: a base and a highlight that stands out on it. */
export function firstLivery(rng: Rng, away: readonly string[]): Livery {
    let best = drawn(rng);
    for (let k = 1; k < FIRST_DRAWS && away.length > 0; k++) {
        const other = drawn(rng);
        if (nearest(other.base, away) > nearest(best.base, away)) best = other;
    }
    return best;
}

function drawn(rng: Rng): Livery {
    const hue = rng.nextFloat();
    const spacing = rng.nextRange(0.15, 0.6);
    return {
        base: fromHsl(hue, rng.nextRange(0.35, 0.75), rng.nextRange(0.35, 0.55)),
        // Across the wheel from the base, and lighter, so the pattern reads on it.
        highlight: fromHsl(wrap(hue + rng.nextRange(0.35, 0.65)), rng.nextRange(0.5, 0.9), rng.nextRange(0.6, 0.8)),
        pattern: LIVERY_PATTERNS[rng.nextInt(LIVERY_PATTERNS.length)]!,
        size: spacing * rng.nextRange(0.2, 0.5),
        spacing,
        offset: rng.nextFloat(),
        angle: rng.nextRange(-PI / 2, PI / 2),
    };
}

function drifted(parent: Livery, rng: Rng): Livery {
    const step = (size: number): number => rng.nextRange(-size, size);
    const spacing = clamp(parent.spacing * (1 + step(SCALE_STEP)), 0.05, 1);
    const pattern = rng.chance(PATTERN_SWITCH) ? LIVERY_PATTERNS[rng.nextInt(LIVERY_PATTERNS.length)]! : parent.pattern;
    const child: Livery = {
        base: driftColour(parent.base, rng),
        highlight: driftColour(parent.highlight, rng),
        pattern,
        size: clamp(parent.size * (1 + step(SCALE_STEP)), 0.02, spacing * 0.9),
        spacing,
        offset: wrap(parent.offset + step(OFFSET_STEP)),
        angle: foldAngle(parent.angle + step(ANGLE_STEP)),
    };
    if (parent.unread !== undefined) child.unread = parent.unread;
    return child;
}

function driftColour(hex: string, rng: Rng): string {
    const [h, s, l] = toHsl(hex);
    return fromHsl(
        wrap(h + rng.nextRange(-HUE_STEP, HUE_STEP)),
        clamp(s + rng.nextRange(-TONE_STEP, TONE_STEP), 0.2, 0.9),
        clamp(l + rng.nextRange(-TONE_STEP, TONE_STEP), 0.25, 0.75),
    );
}

/**
 * How far apart two colours look, near enough to lean by: the "redmean"
 * weighting of RGB, arithmetic and a square root only, so it is the same on
 * every engine.
 */
export function colourGap(a: string, b: string): number {
    const [r1, g1, b1] = rgb(a);
    const [r2, g2, b2] = rgb(b);
    const mean = (r1 + r2) / 2;
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return Math.sqrt((2 + mean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mean) / 256) * db * db);
}

function nearest(colour: string, away: readonly string[]): number {
    let least = Infinity;
    for (const other of away) least = Math.min(least, colourGap(colour, other));
    return least;
}

function rgb(hex: string): [number, number, number] {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function toHsl(hex: string): [number, number, number] {
    const [r, g, b] = rgb(hex).map((c) => c / 255) as [number, number, number];
    const most = Math.max(r, g, b);
    const least = Math.min(r, g, b);
    const l = (most + least) / 2;
    const d = most - least;
    if (d === 0) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = most === r ? ((g - b) / d + 6) % 6 : most === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
    const m = l - c / 2;
    const sector = Math.floor(h * 6) % 6;
    const [r, g, b] = [
        [c, x, 0],
        [x, c, 0],
        [0, c, x],
        [0, x, c],
        [x, 0, c],
        [c, 0, x],
    ][sector]!;
    const hex = (v: number): string =>
        Math.round((v + m) * 255)
            .toString(16)
            .padStart(2, "0");
    return `#${hex(r!)}${hex(g!)}${hex(b!)}`;
}

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

/** Into [0, 1). */
function wrap(v: number): number {
    return v - Math.floor(v);
}

/** Into [-90°, 90°): stripes turned half round are the same stripes. */
function foldAngle(a: number): number {
    return a - PI * Math.floor((a + PI / 2) / PI);
}
