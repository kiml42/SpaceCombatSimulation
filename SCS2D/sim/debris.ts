import type { Bodies } from "./bodies.js";
import { wellPull, type WellSpec } from "./gravity.js";
import type { Hulls } from "./hull.js";
import { abs, cos, imul, length, max, min, PI, sin, sqrt, TAU } from "./math.js";
import { RayHit, type SpatialGrid } from "./spatialGrid.js";

/**
 * Lingering debris: the twisted metal a piece too small to keep becomes,
 * flying on, bouncing off hulls and rock and curving in the wells, until it
 * fades. Kept by the sim so that pause, scrub, rewind and replay all show the
 * same bits, but changing nothing: nothing feels a bit that bounces off it, a
 * bit does no damage, and the golden checksums do not read it. So it is held
 * only while a viewer is watching (`watched`), and a headless run pays nothing.
 *
 * Never larger than `DEBRIS_LONGEST`, and never kept for good.
 */

/** The most bits kept at once; past it, a new one takes the oldest's place. */
export const MOST_DEBRIS = 4096;
/** How many steps ahead a bit looks for anything in its way, and goes without looking again if there is nothing. */
const LOOK_AHEAD = 8;
/** How many bits the store has room for before it grows, doubling, to `MOST_DEBRIS`. */
const FIRST_ROOM = 512;
/** The most bits one piece breaks into. */
const MOST_BITS = 400;
/** How much of a piece's footprint its bits cover between them, so a big module leaves a field of wreckage. */
const COVER = 0.4;
/** How much of the square on its length a bit covers, on average: half as wide as long, and ragged. */
const BIT_FILL = 0.3;
/** The longest a bit is, metres, and the shortest. */
export const DEBRIS_LONGEST = 6;
const DEBRIS_SHORTEST = 0.1;
/** The longest bit a piece breaks into, as a share of the side of a square of its footprint. */
const LONGEST_SHARE = 0.5;
/** How fast a bit leaves the piece it came from, at most, m/s, on top of the piece's own velocity. */
const DEBRIS_KICK = 3;
/**
 * A module blown apart throws its bits: the blow's energy, as a share of it
 * turned into their motion, gives the speed, up to `MOST_THROW` m/s.
 */
export const THROW_SHARE = 0.05;
const MOST_THROW = 60;
/** How much more a thrown bit goes along the blow's line than across it. */
const THROW_STRETCH = 2;
/**
 * How hard, as a share of the throw, a bit near the impact is pushed away from
 * it and one at the far side of the module is thrown towards it: what was at
 * the impact rebounds off what struck it, and what was furthest from it has
 * not yet been stopped when the module comes apart.
 */
const THROW_BIAS = 0.75;

/** How fast a bit tumbles at most, radians a second. */
const DEBRIS_SPIN = 3;
/** How long a bit lasts, seconds, at least and at most. */
export const DEBRIS_LEAST_LIFE = 30;
export const DEBRIS_MOST_LIFE = 60;
/** How long a bit born in a blast glows as it cools, seconds. */
export const DEBRIS_HOT = 0.4;
/** A bit with no paint on it: rock, or metal never painted. */
export const UNPAINTED = -128;
/** How long a bit takes to fade out at the end of its life, seconds. */
export const DEBRIS_FADE = 10;
/** How much of its speed into a surface a bit keeps, bounced back off it. */
const BOUNCE = 0.4;
/** How much of its speed along a surface a bit keeps as it bounces. */
const SLIDE = 0.7;
/** How far off a surface a bounced bit is set, metres, so its next cast does not start inside it. */
const STANDOFF = 0.05;

export class Debris {
    /** Whether bits are being made: only while a viewer is watching the battle. */
    watched = false;
    count = 0;
    x = new Float64Array(FIRST_ROOM);
    y = new Float64Array(FIRST_ROOM);
    vx = new Float64Array(FIRST_ROOM);
    vy = new Float64Array(FIRST_ROOM);
    angle = new Float64Array(FIRST_ROOM);
    spin = new Float64Array(FIRST_ROOM);
    /** How long, metres. */
    size = new Float64Array(FIRST_ROOM);
    /** How old, and how long it lasts, seconds. */
    age = new Float64Array(FIRST_ROOM);
    life = new Float64Array(FIRST_ROOM);
    /** What its shape and glint are drawn from. */
    seed = new Uint32Array(FIRST_ROOM);
    /** Steps it can go before it looks for anything in its way again. */
    quiet = new Uint8Array(FIRST_ROOM);
    /** The side whose paint is on it, or `UNPAINTED`. */
    paint = new Int8Array(FIRST_ROOM);
    /** Whether it was born in a blast, and so glows as it cools. */
    hot = new Uint8Array(FIRST_ROOM);
    /** Bits made so far, for each one's seed. */
    private made = 0;
    private readonly hit = new RayHit();
    /** Running totals of the areas of the triangles an outline is cut into, twice over. */
    private readonly fan = new Float64Array(16);

    /**
     * Break a module into bits: its outline `outline`, `corners` corners in the
     * world, convex and wound either way, on a body at `(px, py)` moving at
     * `(vx, vy)` and spinning at `spin`. Each bit comes from somewhere inside
     * the outline, with the velocity that point had and a little kick, and
     * between them they cover a share of it: a few large, many small. Each
     * carries `paint`, the side it was painted for, and glows if `hot`.
     *
     * Blown apart by `throwJoules`, they are thrown as well, the module's
     * `mass` taking a share of it: further along the blow's line `(nx, ny)`
     * than across it, and from where it struck, `(ix, iy)`, those near it
     * pushed away and those far from it thrown towards it. A blow that came
     * from nowhere in particular, as a beam's, has no line and throws evenly.
     */
    emit(
        outline: readonly number[],
        corners: number,
        vx: number,
        vy: number,
        spin: number,
        px: number,
        py: number,
        paint = UNPAINTED,
        hot = false,
        throwJoules = 0,
        mass = 0,
        ix = 0,
        iy = 0,
        nx = 0,
        ny = 0,
    ): void {
        if (!this.watched || corners < 3) return;
        const thrown = mass > 0 && throwJoules > 0 ? min(MOST_THROW, sqrt((2 * THROW_SHARE * throwJoules) / mass)) : 0;
        const lined = nx !== 0 || ny !== 0;
        // How far the furthest of it is from where it was struck.
        let reach = 0;
        if (lined) for (let k = 0; k < corners; k++) reach = max(reach, length(outline[2 * k]! - ix, outline[2 * k + 1]! - iy));
        // A fan from the first corner: its triangles' areas, as running totals.
        const fan = this.fan;
        let area = 0;
        for (let t = 1; t < corners - 1; t++) {
            area += abs(cross(outline, 0, t, t + 1));
            fan[t] = area;
        }
        if (!(area > 0)) return;
        const longest = min(DEBRIS_LONGEST, max(DEBRIS_SHORTEST, LONGEST_SHARE * sqrt(0.5 * area)));
        let covered = 0;
        for (let j = 0; j < MOST_BITS && covered < COVER * 0.5 * area; j++) {
            const seed = hash(this.made++);
            const k = this.slot();
            // A triangle of the fan by its area, and a point evenly inside it.
            const pick = unit(seed, 1) * area;
            let t = 1;
            while (t < corners - 2 && fan[t]! < pick) t++;
            let a = unit(seed, 2);
            let b = unit(seed, 9);
            if (a + b > 1) {
                a = 1 - a;
                b = 1 - b;
            }
            const x0 = outline[0]!;
            const y0 = outline[1]!;
            const x = x0 + a * (outline[2 * t]! - x0) + b * (outline[2 * t + 2]! - x0);
            const y = y0 + a * (outline[2 * t + 1]! - y0) + b * (outline[2 * t + 3]! - y0);
            const kick = DEBRIS_KICK * unit(seed, 3) + thrown * unit(seed, 10);
            const way = TAU * unit(seed, 4);
            let kx = cos(way);
            let ky = sin(way);
            if (lined) {
                const along = kx * nx + ky * ny;
                const across = (ky * nx - kx * ny) / THROW_STRETCH;
                kx = along * nx - across * ny;
                ky = along * ny + across * nx;
            }
            kx *= kick;
            ky *= kick;
            if (lined && reach > 0) {
                const rx = x - ix;
                const ry = y - iy;
                const d = length(rx, ry);
                if (d > 0) {
                    const push = (THROW_BIAS * thrown * (1 - (2 * d) / reach)) / d;
                    kx += rx * push;
                    ky += ry * push;
                }
            }
            const u = unit(seed, 7);
            const size = max(DEBRIS_SHORTEST, longest * (0.2 + 0.8 * u * u));
            covered += BIT_FILL * size * size;
            this.x[k] = x;
            this.y[k] = y;
            this.vx[k] = vx - spin * (y - py) + kx;
            this.vy[k] = vy + spin * (x - px) + ky;
            this.angle[k] = PI * unit(seed, 5);
            this.spin[k] = (unit(seed, 6) * 2 - 1) * DEBRIS_SPIN;
            this.size[k] = size;
            this.age[k] = 0;
            this.life[k] = DEBRIS_LEAST_LIFE + (DEBRIS_MOST_LIFE - DEBRIS_LEAST_LIFE) * unit(seed, 8);
            this.seed[k] = seed;
            this.quiet[k] = 0;
            this.paint[k] = paint;
            this.hot[k] = hot ? 1 : 0;
        }
    }

    /**
     * Move every bit on by `dt`: pulled by the wells, and cast along its way
     * through the grid, bouncing off the first hull or rock it meets. Bits past
     * their life are dropped.
     */
    step(dt: number, bodies: Bodies, grid: SpatialGrid, hulls: Hulls, wells: readonly WellSpec[]): void {
        let kept = 0;
        for (let i = 0; i < this.count; i++) {
            const age = this.age[i]! + dt;
            if (age >= this.life[i]!) continue;
            if (kept !== i) this.move(i, kept);
            const k = kept++;
            this.age[k] = age;
            let vx = this.vx[k]!;
            let vy = this.vy[k]!;
            const x = this.x[k]!;
            const y = this.y[k]!;
            for (let w = 0; w < wells.length; w++) {
                const well = wells[w]!;
                const pull = wellPull(well, x, y) * dt;
                vx += (well.x - x) * pull;
                vy += (well.y - y) * pull;
            }
            const dx = vx * dt;
            const dy = vy * dt;
            const hit = this.hit;
            this.angle[k] = this.angle[k]! + this.spin[k]! * dt;
            // Looking ahead only when it last saw nothing in its way for so long: a
            // cast through a capital ship's hull is a test of every module in it.
            const quiet = this.quiet[k]!;
            if (quiet > 0) this.quiet[k] = quiet - 1;
            else if (grid.raycast(bodies, x, y, x + dx * LOOK_AHEAD, y + dy * LOOK_AHEAD, hit, -1, hulls)) {
                const steps = hit.t * LOOK_AHEAD;
                if (steps > 1) this.quiet[k] = min(LOOK_AHEAD, steps) - 1;
                else if (hulls.describe(bodies, hit.bodyIndex, x, y, dx, dy)) {
                    const nx = hulls.nx;
                    const ny = hulls.ny;
                    hulls.reset();
                    // Begun inside a hull, with no face to bounce off: let it fly out.
                    if (nx !== 0 || ny !== 0) {
                        const b = hit.bodyIndex;
                        // The velocity of the hull at the point met, which it bounces off.
                        const spin = bodies.angularVel[b]!;
                        const hvx = bodies.vx[b]! - spin * (hit.y - bodies.y[b]!);
                        const hvy = bodies.vy[b]! + spin * (hit.x - bodies.x[b]!);
                        const rvx = vx - hvx;
                        const rvy = vy - hvy;
                        const into = rvx * nx + rvy * ny;
                        if (into < 0) {
                            const tx = rvx - into * nx;
                            const ty = rvy - into * ny;
                            vx = hvx + tx * SLIDE - into * BOUNCE * nx;
                            vy = hvy + ty * SLIDE - into * BOUNCE * ny;
                        }
                        this.x[k] = hit.x + nx * STANDOFF;
                        this.y[k] = hit.y + ny * STANDOFF;
                        this.vx[k] = vx;
                        this.vy[k] = vy;
                        continue;
                    }
                }
            } else this.quiet[k] = LOOK_AHEAD - 1;
            hulls.reset();
            this.x[k] = x + dx;
            this.y[k] = y + dy;
            this.vx[k] = vx;
            this.vy[k] = vy;
        }
        this.count = kept;
    }

    clear(): void {
        this.count = 0;
    }

    /** How hot bit `i` still glows, from 1 as it is born in a blast to 0 once cooled. */
    heat(i: number): number {
        return this.hot[i] === 1 ? max(0, 1 - this.age[i]! / DEBRIS_HOT) : 0;
    }

    /** How faded bit `i` is, from 1 to 0 over its last `DEBRIS_FADE` seconds. */
    fade(i: number): number {
        return min(1, max(0, (this.life[i]! - this.age[i]!) / DEBRIS_FADE));
    }

    /** Where the next bit goes: the end, or the oldest's place once there is no more room. */
    private slot(): number {
        if (this.count === this.x.length && this.count < MOST_DEBRIS) this.grow();
        if (this.count < this.x.length) return this.count++;
        let oldest = 0;
        for (let i = 1; i < this.count; i++) if (this.age[i]! > this.age[oldest]!) oldest = i;
        return oldest;
    }

    /** Twice the room, up to `MOST_DEBRIS`. */
    private grow(): void {
        const room = min(MOST_DEBRIS, this.x.length * 2);
        const more = <T extends Float64Array | Uint32Array>(old: T): T => {
            const made = (old instanceof Float64Array ? new Float64Array(room) : new Uint32Array(room)) as T;
            made.set(old);
            return made;
        };
        this.x = more(this.x);
        this.y = more(this.y);
        this.vx = more(this.vx);
        this.vy = more(this.vy);
        this.angle = more(this.angle);
        this.spin = more(this.spin);
        this.size = more(this.size);
        this.age = more(this.age);
        this.life = more(this.life);
        this.seed = more(this.seed);
        const quiet = new Uint8Array(room);
        quiet.set(this.quiet);
        this.quiet = quiet;
        const paint = new Int8Array(room);
        paint.set(this.paint);
        this.paint = paint;
        const hot = new Uint8Array(room);
        hot.set(this.hot);
        this.hot = hot;
    }

    private move(from: number, to: number): void {
        this.x[to] = this.x[from]!;
        this.y[to] = this.y[from]!;
        this.vx[to] = this.vx[from]!;
        this.vy[to] = this.vy[from]!;
        this.angle[to] = this.angle[from]!;
        this.spin[to] = this.spin[from]!;
        this.size[to] = this.size[from]!;
        this.age[to] = this.age[from]!;
        this.life[to] = this.life[from]!;
        this.seed[to] = this.seed[from]!;
        this.quiet[to] = this.quiet[from]!;
        this.paint[to] = this.paint[from]!;
        this.hot[to] = this.hot[from]!;
    }
}

/** Twice the signed area of the triangle on corners `a`, `b` and `c` of `outline`. */
function cross(outline: readonly number[], a: number, b: number, c: number): number {
    const ax = outline[2 * a]!;
    const ay = outline[2 * a + 1]!;
    return (outline[2 * b]! - ax) * (outline[2 * c + 1]! - ay) - (outline[2 * b + 1]! - ay) * (outline[2 * c]! - ax);
}

/** A well-mixed 32-bit hash of `n`. */
function hash(n: number): number {
    let h = imul(n ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 13;
    h = imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}

/** A number in [0, 1) from a seed and a salt, the same every time. */
function unit(seed: number, salt: number): number {
    return hash(seed ^ imul(salt, 0x27d4eb2d)) / 4294967296;
}
