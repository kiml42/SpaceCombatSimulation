import type { ShipDesign } from "./blueprint.js";
import { fixed } from "./fixed.js";
import { cos, max, min, round, sin, sqrt } from "./math.js";

/**
 * Scars: where the hits that mattered landed on each module, and what made
 * them, for drawing (ROADMAP.md §8 step 17, marks for damage).
 *
 * Kept by the sim so a rewind's checkpoint carries them, but nothing in the
 * battle reads them and the checksums leave them out. Each is in its module's
 * own frame, so it stays put however the hull around it is remade.
 *
 * A round is judged alone: it scars if it delivered at least `SCAR_SHARE` of
 * what breaks its module. Fragments, beams and collisions arrive in small
 * pieces, so each joins a scar of its kind near where it lands, which shows
 * once what has joined it passes the same share.
 */

export const SCAR_ROUND = 1;
/** Fragments of a burst, a spray along their travel. */
export const SCAR_PEPPER = 2;
/** A beam or a plume. */
export const SCAR_BURN = 3;
/** Hulls meeting, along the way they slid. */
export const SCAR_GOUGE = 4;

/** The share of what breaks a module a hit must deliver to scar it. A first guess. */
export const SCAR_SHARE = 0.1;
/** Square metres of module for each scar it may hold. */
export const SCAR_AREA = 4;
export const MOST_SCARS = 8;
/** How near a piece must land to a scar to join it, as a share of the module's narrower side. */
const JOIN_SHARE = 0.25;
/** The longest a joined scar may be drawn out, as a share of the module's longer side. */
const STREAK_SHARE = 0.25;

/** A scar's numbers, in a slot. Points and direction are in the module's frame. */
const KIND = 0;
const AX = 1;
const AY = 2;
const BX = 3;
const BY = 4;
const DX = 5;
const DY = 6;
const ENERGY = 7;
/** What the module had absorbed before the hit that made it show: mending back to it takes it off. */
const AT = 8;
const THROUGH = 9;
const SHOWN = 10;
const STRIDE = 11;

/**
 * A shown scar in a snapshot: module, slot, kind, the two ends (module
 * frame), direction, energy, and 1 if a round went through.
 */
export const SCAR_VIEW_STRIDE = 11;

/** How many scars a module of this size may hold. */
export function scarSlots(length: number, width: number): number {
    return max(1, min(MOST_SCARS, round((length * width) / SCAR_AREA)));
}

export class Scars {
    private readonly slots: (Float64Array | null)[] = [];
    /** Where each module's slots start, and one past the last. */
    private readonly starts: (Int32Array | null)[] = [];
    private readonly designs: (ShipDesign | null)[] = [];
    private readonly versions: number[] = [];

    /** Give a body room for its modules' scars, with `carried` (`carriedAt`) for each module that brings some. */
    register(bodyIndex: number, design: ShipDesign, carried?: readonly (Float64Array | null)[]): void {
        const n = design.modules.length;
        const starts = new Int32Array(n + 1);
        for (let m = 0; m < n; m++) {
            const { length, width } = design.modules[m]!.spec;
            starts[m + 1] = starts[m]! + scarSlots(length, width);
        }
        const slots = new Float64Array(starts[n]! * STRIDE);
        if (carried !== undefined) {
            for (let m = 0; m < n; m++) {
                const from = carried[m];
                if (!from) continue;
                const room = (starts[m + 1]! - starts[m]!) * STRIDE;
                slots.set(from.length > room ? from.subarray(0, room) : from, starts[m]! * STRIDE);
            }
        }
        this.slots[bodyIndex] = slots;
        this.starts[bodyIndex] = fixed(starts);
        this.designs[bodyIndex] = design;
        this.versions[bodyIndex] = (this.versions[bodyIndex] ?? 0) + 1;
    }

    forget(bodyIndex: number): void {
        this.slots[bodyIndex] = null;
        this.starts[bodyIndex] = null;
        this.designs[bodyIndex] = null;
    }

    /** Counts changes to a body's scars, so a view can tell when to redraw them. */
    version(bodyIndex: number): number {
        return this.versions[bodyIndex] ?? 0;
    }

    /** A copy of a module's scars, to carry into a body remade around it. */
    carriedAt(bodyIndex: number, module: number): Float64Array | null {
        const slots = this.slots[bodyIndex];
        const starts = this.starts[bodyIndex];
        if (!slots || !starts || module < 0 || module + 1 >= starts.length) return null;
        return slots.slice(starts[module]! * STRIDE, starts[module + 1]! * STRIDE);
    }

    /**
     * A hit of `energy` on a module, from `(ax, ay)` to `(bx, by)` along
     * `(dx, dy)`, all in the hull's frame. `before` is what the module had
     * absorbed before it, and `threshold` what scars it.
     */
    add(
        bodyIndex: number,
        module: number,
        kind: number,
        ax: number,
        ay: number,
        bx: number,
        by: number,
        dx: number,
        dy: number,
        energy: number,
        before: number,
        threshold: number,
        through: boolean,
    ): void {
        const slots = this.slots[bodyIndex];
        const starts = this.starts[bodyIndex];
        const design = this.designs[bodyIndex];
        if (!slots || !starts || !design || !(energy > 0)) return;
        if (kind === SCAR_ROUND && energy < threshold) return;
        const placed = design.modules[module];
        if (placed === undefined) return;

        // Into the module's frame.
        const c = cos(placed.angle);
        const s = sin(placed.angle);
        const ox = ax - placed.x;
        const oy = ay - placed.y;
        const ex = bx - placed.x;
        const ey = by - placed.y;
        const au = ox * c + oy * s;
        const av = -ox * s + oy * c;
        const bu = ex * c + ey * s;
        const bv = -ex * s + ey * c;
        const du = dx * c + dy * s;
        const dv = -dx * s + dy * c;

        const first = starts[module]!;
        const last = starts[module + 1]!;
        if (kind !== SCAR_ROUND) {
            const { length, width } = placed.spec;
            const join = JOIN_SHARE * min(length, width);
            const streak = STREAK_SHARE * max(length, width);
            for (let k = first; k < last; k++) {
                const o = k * STRIDE;
                if (slots[o + KIND] !== kind) continue;
                if (segmentDistance(au, av, slots[o + AX]!, slots[o + AY]!, slots[o + BX]!, slots[o + BY]!) > join) continue;
                slots[o + ENERGY] = slots[o + ENERGY]! + energy;
                stretch(slots, o, au, av, streak);
                if (slots[o + SHOWN] === 0 && slots[o + ENERGY]! >= threshold) {
                    slots[o + SHOWN] = 1;
                    slots[o + AT] = before;
                }
                this.versions[bodyIndex] = this.versions[bodyIndex]! + 1;
                return;
            }
        }

        // A free slot, or the least scar if this one is greater.
        let into = -1;
        let least = Infinity;
        for (let k = first; k < last; k++) {
            const o = k * STRIDE;
            if (slots[o + KIND] === 0) {
                into = k;
                break;
            }
            if (slots[o + ENERGY]! < least) {
                least = slots[o + ENERGY]!;
                into = k;
            }
        }
        if (into < 0 || (slots[into * STRIDE + KIND] !== 0 && !(energy > least))) return;
        const o = into * STRIDE;
        slots[o + KIND] = kind;
        slots[o + AX] = au;
        slots[o + AY] = av;
        slots[o + BX] = bu;
        slots[o + BY] = bv;
        slots[o + DX] = du;
        slots[o + DY] = dv;
        slots[o + ENERGY] = energy;
        slots[o + AT] = before;
        slots[o + THROUGH] = through ? 1 : 0;
        slots[o + SHOWN] = energy >= threshold ? 1 : 0;
        this.versions[bodyIndex] = this.versions[bodyIndex]! + 1;
    }

    /** Take off every scar made at or above what a module has been mended back to. */
    mend(bodyIndex: number, module: number, absorbed: number): void {
        const slots = this.slots[bodyIndex];
        const starts = this.starts[bodyIndex];
        if (!slots || !starts || module < 0 || module + 1 >= starts.length) return;
        for (let k = starts[module]!; k < starts[module + 1]!; k++) {
            const o = k * STRIDE;
            if (slots[o + KIND] === 0 || absorbed > slots[o + AT]!) continue;
            slots.fill(0, o, o + STRIDE);
            this.versions[bodyIndex] = this.versions[bodyIndex]! + 1;
        }
    }

    /** Every shown scar on a body, `SCAR_VIEW_STRIDE` numbers apiece, into `out`. */
    view(bodyIndex: number, out: number[]): void {
        out.length = 0;
        const slots = this.slots[bodyIndex];
        const starts = this.starts[bodyIndex];
        if (!slots || !starts) return;
        for (let m = 0; m + 1 < starts.length; m++) {
            for (let k = starts[m]!; k < starts[m + 1]!; k++) {
                const o = k * STRIDE;
                if (slots[o + SHOWN] === 0) continue;
                out.push(
                    m,
                    k - starts[m]!,
                    slots[o + KIND]!,
                    slots[o + AX]!,
                    slots[o + AY]!,
                    slots[o + BX]!,
                    slots[o + BY]!,
                    slots[o + DX]!,
                    slots[o + DY]!,
                    slots[o + ENERGY]!,
                    slots[o + THROUGH]!,
                );
            }
        }
    }
}

/** How far `(px, py)` is from the segment `a`–`b`. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const sx = bx - ax;
    const sy = by - ay;
    const span = sx * sx + sy * sy;
    const t = span > 0 ? max(0, min(1, ((px - ax) * sx + (py - ay) * sy) / span)) : 0;
    const x = ax + sx * t - px;
    const y = ay + sy * t - py;
    return sqrt(x * x + y * y);
}

/** Draw a scar out to take in `(u, v)`, by whichever end makes it longer, no longer than `most`. */
function stretch(slots: Float64Array, o: number, u: number, v: number, most: number): void {
    const ax = slots[o + AX]!;
    const ay = slots[o + AY]!;
    const bx = slots[o + BX]!;
    const by = slots[o + BY]!;
    const now = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
    const fromA = (u - ax) * (u - ax) + (v - ay) * (v - ay);
    const fromB = (u - bx) * (u - bx) + (v - by) * (v - by);
    const longest = most * most;
    if (fromA >= fromB && fromA > now && fromA <= longest) {
        slots[o + BX] = u;
        slots[o + BY] = v;
    } else if (fromB > fromA && fromB > now && fromB <= longest) {
        slots[o + AX] = u;
        slots[o + AY] = v;
    }
}
