import type { Bodies } from "./bodies.js";
import { wellPull, type WellSpec } from "./gravity.js";
import type { Hulls } from "./hull.js";
import { cos, imul, max, min, PI, pow, round, sin, sqrt, TAU } from "./math.js";
import { RayHit, type SpatialGrid } from "./spatialGrid.js";

/**
 * Lingering debris: the twisted metal a piece too small to keep becomes,
 * flying on, bouncing off hulls and rock and curving in the wells, until it
 * fades. Kept by the sim so that pause, scrub, rewind and replay all show the
 * same bits, but changing nothing: nothing feels a bit that bounces off it, a
 * bit does no damage, and the golden checksums do not read it. So it is held
 * only while a viewer is watching (`watched`), and a headless run pays nothing.
 *
 * Never larger than `DEBRIS_LONGEST`, so it is never taken for a module, and
 * never kept for good.
 */

/** The most bits kept at once; past it, a new one takes the oldest's place. */
export const MOST_DEBRIS = 2048;
/** How many bits a piece breaks into, by its mass: one for so many kilograms, between one and `MOST_BITS`. */
const KG_PER_BIT = 25;
const MOST_BITS = 24;
/** How dense a bit of twisted metal is taken to be, kg/m³, for its size from its share of the mass: mostly air. */
const DEBRIS_DENSITY = 300;
/** The longest a bit is, metres, and the shortest. */
export const DEBRIS_LONGEST = 1.5;
const DEBRIS_SHORTEST = 0.1;
/** How fast a bit leaves the piece it came from, at most, m/s, on top of the piece's own velocity. */
const DEBRIS_KICK = 3;
/** How fast a bit tumbles at most, radians a second. */
const DEBRIS_SPIN = 3;
/** How long a bit lasts, seconds, at least and at most. */
export const DEBRIS_LEAST_LIFE = 30;
export const DEBRIS_MOST_LIFE = 60;
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
    x = new Float64Array(MOST_DEBRIS);
    y = new Float64Array(MOST_DEBRIS);
    vx = new Float64Array(MOST_DEBRIS);
    vy = new Float64Array(MOST_DEBRIS);
    angle = new Float64Array(MOST_DEBRIS);
    spin = new Float64Array(MOST_DEBRIS);
    /** How long, metres. */
    size = new Float64Array(MOST_DEBRIS);
    /** How old, and how long it lasts, seconds. */
    age = new Float64Array(MOST_DEBRIS);
    life = new Float64Array(MOST_DEBRIS);
    /** What its shape and glint are drawn from. */
    seed = new Uint32Array(MOST_DEBRIS);
    /** Bits made so far, for each one's seed. */
    private made = 0;
    private readonly hit = new RayHit();

    /**
     * Break `mass` kg of metal into bits, from a piece `radius` across centred
     * on `(x, y)`, moving at `(vx, vy)` and spinning at `spin`: each from
     * somewhere in it, with the velocity that point had and a little kick.
     */
    emit(x: number, y: number, vx: number, vy: number, spin: number, mass: number, radius: number): void {
        if (!this.watched || !(mass > 0)) return;
        const n = max(1, min(MOST_BITS, round(mass / KG_PER_BIT)));
        const share = mass / n;
        const size = min(DEBRIS_LONGEST, max(DEBRIS_SHORTEST, pow(share / DEBRIS_DENSITY, 1 / 3)));
        for (let j = 0; j < n; j++) {
            const seed = hash(this.made++);
            const k = this.slot();
            const where = TAU * unit(seed, 1);
            const out = radius * 0.7 * sqrt(unit(seed, 2));
            const ox = out * cos(where);
            const oy = out * sin(where);
            const kick = DEBRIS_KICK * unit(seed, 3);
            const way = TAU * unit(seed, 4);
            this.x[k] = x + ox;
            this.y[k] = y + oy;
            this.vx[k] = vx - spin * oy + kick * cos(way);
            this.vy[k] = vy + spin * ox + kick * sin(way);
            this.angle[k] = PI * unit(seed, 5);
            this.spin[k] = (unit(seed, 6) * 2 - 1) * DEBRIS_SPIN;
            this.size[k] = size * (0.6 + 0.8 * unit(seed, 7));
            this.age[k] = 0;
            this.life[k] = DEBRIS_LEAST_LIFE + (DEBRIS_MOST_LIFE - DEBRIS_LEAST_LIFE) * unit(seed, 8);
            this.seed[k] = seed;
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
            if (grid.raycast(bodies, x, y, x + dx, y + dy, hit, -1, hulls) && hulls.describe(bodies, hit.bodyIndex, x, y, dx, dy)) {
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

    /** How faded bit `i` is, from 1 to 0 over its last `DEBRIS_FADE` seconds. */
    fade(i: number): number {
        return min(1, max(0, (this.life[i]! - this.age[i]!) / DEBRIS_FADE));
    }

    /** Where the next bit goes: the end, or the oldest's place once there is no more room. */
    private slot(): number {
        if (this.count < MOST_DEBRIS) return this.count++;
        let oldest = 0;
        for (let i = 1; i < this.count; i++) if (this.age[i]! > this.age[oldest]!) oldest = i;
        return oldest;
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
    }
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
