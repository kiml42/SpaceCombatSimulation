import { IMPACT_BEAM, IMPACT_COLLISION, IMPACT_EXIT, IMPACT_ROUND } from "../sim/index.js";
import type { Flashes } from "./flashes.js";

/**
 * What a hit throws off, worked out afresh each frame from the event and its
 * age: nothing is stepped or stored, so pausing, stepping, scrubbing and
 * replaying need nothing of their own, and the same moment is the same
 * picture. Each particle flies straight from where the event happened at the
 * velocity of the hull it happened on plus its own, so the event's seed, its
 * age and that hull's velocity now are all it takes. Drawn only: nothing here
 * changes what happens.
 */

/** The longest a spark flies, seconds. */
export const SPARK_LIFE = 0.6;

/** The longest a bit of metal broken off in a collision flies, seconds. */
export const METAL_LIFE = 1.6;

/** How long an event of this kind is kept for what it throws off, seconds: 0 for nothing thrown. */
export function thrownFor(kind: number): number {
    if (kind === IMPACT_COLLISION) return METAL_LIFE;
    return kind === IMPACT_ROUND || kind === IMPACT_EXIT || kind === IMPACT_BEAM ? SPARK_LIFE : 0;
}

/** Most sparks one event throws, however much it was worth. */
export const MOST_SPARKS = 24;
/** Sparks thrown for each joule's cube root: one for about 10 kJ, all of them by about 10 MJ. */
const SPARKS_PER_CBRT_JOULE = 1 / 20;
/** A beam's flashes come a step apart, so each throws at most one, and only this share of them do. */
const BEAM_SPARK_CHANCE = 0.3;
/** Slowest and fastest a spark leaves, m/s, before the hull's own velocity. */
const SPARK_SLOWEST = 40;
const SPARK_FASTEST = 320;
/** How far either side of the way it is thrown a spark may go, radians. */
const SPRAY_IN = 1.1;
const SPRAY_OUT = 0.6;
/** How far a spark thrown back off a face leans towards the way the round glanced off it, rather than straight out. */
const GLANCE = 0.6;
/** How wide a spark is, metres, for a hit of `FLASH_REFERENCE_ENERGY`, and as the sixth root of its energy otherwise. */
const SPARK_WIDTH = 0.06;

/** One spark as it is now. */
export interface Spark {
    x: number;
    y: number;
    /** Its velocity, m/s, its own and the hull's. */
    vx: number;
    vy: number;
    width: number;
    /** How far through its life, 0 to 1. */
    t: number;
}

/** How many sparks this event throws. */
export function sparkCount(kind: number, energy: number, seed: number): number {
    if (thrownFor(kind) !== SPARK_LIFE || !(energy > 0)) return 0;
    if (kind === IMPACT_BEAM) return unit(seed, 99) < BEAM_SPARK_CHANCE ? 1 : 0;
    return Math.min(MOST_SPARKS, Math.max(1, Math.round(Math.cbrt(energy) * SPARKS_PER_CBRT_JOULE)));
}

/** A seed for an event, from what it is, so it throws the same sparks every time it is drawn. */
export function seedOf(x: number, y: number, energy: number, kind: number): number {
    let h = 2166136261 ^ kind;
    for (const v of [x, y, energy]) {
        h = Math.imul(h ^ Math.round(v * 1024), 16777619);
        h = Math.imul(h ^ (h >>> 15), 2246822507);
    }
    return h >>> 0;
}

/** A number in [0, 1) from a seed and a salt, the same every time. */
function unit(seed: number, salt: number): number {
    let h = Math.imul(seed ^ Math.imul(salt + 1, 0x9e3779b1), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/**
 * Spark `j` of flash `i`, at `age`, into `out`; false if it has landed or was
 * never thrown. `angle` turns the event's directions out of its hull's frame,
 * and `(hullVx, hullVy)` is that hull's velocity, or nought for none.
 */
export function spark(
    flashes: Flashes,
    i: number,
    j: number,
    seed: number,
    age: number,
    angle: number,
    hullVx: number,
    hullVy: number,
    out: Spark,
): boolean {
    const life = SPARK_LIFE * (0.3 + 0.7 * unit(seed, 4 * j));
    if (!(age >= 0) || age >= life) return false;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const kind = flashes.kind[i]!;
    // Into the world: the way the round went and the face's outward normal.
    const ux = flashes.dirX[i]! * c - flashes.dirY[i]! * s;
    const uy = flashes.dirX[i]! * s + flashes.dirY[i]! * c;
    const nx = flashes.normalX[i]! * c - flashes.normalY[i]! * s;
    const ny = flashes.normalX[i]! * s + flashes.normalY[i]! * c;
    // Which way it is thrown: back off the face it went in by, leaning the way
    // the round glanced; on out the way the round went where it came out; and
    // any way at all where nothing says.
    let bx: number;
    let by: number;
    let spray: number;
    if (kind === IMPACT_EXIT && (ux !== 0 || uy !== 0)) {
        bx = ux;
        by = uy;
        spray = SPRAY_OUT;
    } else if (nx !== 0 || ny !== 0) {
        const along = ux * nx + uy * ny;
        // The way the round would glance off, kept on the face's outside.
        const gx = ux - 2 * along * nx;
        const gy = uy - 2 * along * ny;
        bx = nx * (1 - GLANCE) + gx * GLANCE;
        by = ny * (1 - GLANCE) + gy * GLANCE;
        spray = SPRAY_IN;
    } else {
        bx = 1;
        by = 0;
        spray = Math.PI;
    }
    const turn = (unit(seed, 4 * j + 1) * 2 - 1) * spray;
    const tc = Math.cos(turn);
    const ts = Math.sin(turn);
    let dx = bx * tc - by * ts;
    let dy = bx * ts + by * tc;
    // Never back into the face it came off.
    if ((nx !== 0 || ny !== 0) && kind !== IMPACT_EXIT && dx * nx + dy * ny < 0) {
        const off = dx * nx + dy * ny;
        dx -= 2 * off * nx;
        dy -= 2 * off * ny;
    }
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = SPARK_SLOWEST + (SPARK_FASTEST - SPARK_SLOWEST) * unit(seed, 4 * j + 2) ** 2;
    out.vx = hullVx + (dx / length) * speed;
    out.vy = hullVy + (dy / length) * speed;
    out.x = flashes.x[i]! + out.vx * age;
    out.y = flashes.y[i]! + out.vy * age;
    out.width = SPARK_WIDTH * Math.pow(flashes.energy[i]! / 1e6, 1 / 6) * (0.5 + unit(seed, 4 * j + 3));
    out.t = age / life;
    return true;
}

/** A spark's colour as it cools: white, then orange, then a dull red, as `0xrrggbb`. */
export function sparkColour(t: number): number {
    const mix = (a: number, b: number, u: number): number => Math.round(a + (b - a) * u);
    const [r, g, b] =
        t < 0.4
            ? [255, mix(246, 178, t / 0.4), mix(226, 87, t / 0.4)]
            : [mix(255, 220, (t - 0.4) / 0.6), mix(178, 60, (t - 0.4) / 0.6), mix(87, 30, (t - 0.4) / 0.6)];
    return (r << 16) | (g << 8) | b;
}

/** How bright a spark is as it cools, 1 when thrown and 0 when it lands. */
export function sparkFade(t: number): number {
    return (1 - t) ** 1.5;
}

/** Most bits of metal one collision breaks off. */
export const MOST_BITS = 20;
/** Bits for each joule's cube root: one for about 30 kJ, all of them by about 200 MJ. */
const BITS_PER_CBRT_JOULE = 1 / 30;
/** How fast bits leave, as a share of how fast the hulls closed, at least and at most. */
const BIT_SLOWEST = 0.1;
const BIT_FASTEST = 0.6;
/** The slowest a bit leaves, m/s, however gently the hulls met. */
const BIT_LEAST_SPEED = 2;
/** How far either side of the contact line a bit may go, radians. */
const BIT_SPRAY = 0.7;
/** How far towards the slide a bit leans, as a share of the slide's speed. */
const BIT_SLIDE = 0.5;
/** How long a bit is, metres, for a collision of `FLASH_REFERENCE_ENERGY`, and as the sixth root of its energy otherwise. */
const BIT_SIZE = 0.25;
/** The fastest a bit spins, radians a second. */
const BIT_SPIN = 14;

/** One bit of metal as it is now. */
export interface Bit {
    x: number;
    y: number;
    /** Which way its long side lies, radians. */
    angle: number;
    length: number;
    width: number;
    /** How much of its face is turned to the light as it tumbles, 0 to 1. */
    glint: number;
    /** How far through its life, 0 to 1. */
    t: number;
}

/** How many bits of metal this event breaks off. */
export function bitCount(kind: number, energy: number): number {
    if (kind !== IMPACT_COLLISION || !(energy > 0)) return 0;
    return Math.min(MOST_BITS, Math.max(1, Math.round(Math.cbrt(energy) * BITS_PER_CBRT_JOULE)));
}

/**
 * Bit `j` of collision `i`, at `age`, into `out`; false if it is gone. Thrown
 * out of the contact either way along it, leaning the way the hulls slid and
 * a little outward, as fast as a share of how fast the hulls met, from the
 * velocity of the hull the event rides.
 */
export function bit(
    flashes: Flashes,
    i: number,
    j: number,
    seed: number,
    age: number,
    angle: number,
    hullVx: number,
    hullVy: number,
    out: Bit,
): boolean {
    const life = METAL_LIFE * (0.4 + 0.6 * unit(seed, 8 * j));
    if (!(age >= 0) || age >= life) return false;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    let nx = flashes.normalX[i]! * c - flashes.normalY[i]! * s;
    let ny = flashes.normalX[i]! * s + flashes.normalY[i]! * c;
    const slideX = flashes.dirX[i]! * c - flashes.dirY[i]! * s;
    const slideY = flashes.dirX[i]! * s + flashes.dirY[i]! * c;
    if (nx === 0 && ny === 0) nx = 1;
    const n = Math.sqrt(nx * nx + ny * ny);
    nx /= n;
    ny /= n;
    // Along the contact line, one way or the other, and a little out of the
    // side of one hull or the other.
    const side = unit(seed, 8 * j + 1) < 0.5 ? 1 : -1;
    const outward = unit(seed, 8 * j + 2) < 0.5 ? 1 : -1;
    const turn = unit(seed, 8 * j + 3) * BIT_SPRAY;
    const dx = -ny * side * Math.cos(turn) + nx * outward * Math.sin(turn);
    const dy = nx * side * Math.cos(turn) + ny * outward * Math.sin(turn);
    const closing = Math.abs(flashes.speed[i]!);
    const speed = Math.max(BIT_LEAST_SPEED, closing * (BIT_SLOWEST + (BIT_FASTEST - BIT_SLOWEST) * unit(seed, 8 * j + 4)));
    const vx = hullVx + dx * speed + slideX * BIT_SLIDE;
    const vy = hullVy + dy * speed + slideY * BIT_SLIDE;
    out.x = flashes.x[i]! + vx * age;
    out.y = flashes.y[i]! + vy * age;
    const size = BIT_SIZE * Math.pow(flashes.energy[i]! / 1e6, 1 / 6) * (0.4 + unit(seed, 8 * j + 5));
    out.length = size;
    out.width = size * (0.3 + 0.4 * unit(seed, 8 * j + 6));
    const spin = (unit(seed, 8 * j + 7) * 2 - 1) * BIT_SPIN;
    out.angle = unit(seed, 8 * j + 6) * Math.PI + spin * age;
    out.glint = Math.abs(Math.cos(spin * age * 1.7 + j));
    out.t = age / life;
    return true;
}
