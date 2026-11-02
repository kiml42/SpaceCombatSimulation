import { SCAR_BURN, SCAR_GOUGE, SCAR_PEPPER, SCAR_ROUND, SCAR_VIEW_STRIDE, type ModuleSpec } from "../sim/index.js";

/**
 * How a scar is drawn (ROADMAP.md §8 step 17, marks for damage): polygons in
 * its module's frame, from what the sim recorded of it (`sim/scars.ts`).
 *
 * Every hit arrives edge-on to the view, so each kind is drawn out along the
 * way it travelled. Its shape is drawn from its module and slot, so scars
 * vary but every replay draws them alike.
 */

/** A scar's width, metres, a joule's cube root apiece: a heavy round's is visibly larger than a light one's. */
const WIDTH_PER_CBRT_JOULE = 0.004;
/** The narrowest a scar is drawn, and the widest as a share of its module's narrower side. */
const MIN_WIDTH = 0.05;
const MOST_OF_MODULE = 0.45;
/** A scar this many pixels wide or less is left out. */
export const MIN_SCAR_PX = 1.5;

export interface ScarShape {
    readonly points: number[];
    readonly colour: number;
    readonly alpha: number;
}

const PIT = 0x15110f;
const HOLE = 0x050404;
const RIM = 0xc9c3b8;
const SCORCH = 0x1c1612;
const GLAZE = 0x0b0a10;
const SHEEN = 0x8d8fa3;
const SCRAPE = 0xd6d2ca;
const BUCKLE = 0x221c18;

/** A small fixed hash to [0, 1). */
function hash(a: number, b: number, c: number): number {
    let h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 7, 668265263) ^ Math.imul(c + 13, 1274126177);
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

/** How wide scar `k` of `scars` is drawn on a module of this size, metres. */
export function scarWidth(scars: readonly number[], k: number, spec: ModuleSpec): number {
    const energy = scars[k + 9]!;
    const most = MOST_OF_MODULE * Math.min(spec.length, spec.width);
    return Math.max(Math.min(MIN_WIDTH, most), Math.min(most, WIDTH_PER_CBRT_JOULE * Math.cbrt(energy)));
}

/**
 * A ragged outline round the segment from `(ax, ay)` to `(bx, by)`, `r` out
 * from it, along `(ux, uy)`; `seed` sets its raggedness, `rough` how much.
 */
function ragged(ax: number, ay: number, bx: number, by: number, ux: number, uy: number, r: number, seed: number, rough: number): number[] {
    const out: number[] = [];
    const corners = 14;
    for (let k = 0; k < corners; k++) {
        const t = (k / corners) * 2 * Math.PI;
        const c = Math.cos(t);
        const s = Math.sin(t);
        // The far half round the far end, the near half round the near.
        const [ex, ey] = c >= 0 ? [bx, by] : [ax, ay];
        const reach = r * (1 - rough + 2 * rough * hash(seed, k, 1));
        out.push(ex + (ux * c - uy * s) * reach, ey + (uy * c + ux * s) * reach);
    }
    return out;
}

/** The box a module's drawn fills lie in, its own frame: what its scars are kept inside. */
export interface Bounds {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
}

/** Keep a polygon inside `bounds`. */
function within(points: number[], bounds: Bounds): number[] {
    for (let k = 0; k < points.length; k += 2) {
        points[k] = Math.max(bounds.x0, Math.min(bounds.x1, points[k]!));
        points[k + 1] = Math.max(bounds.y0, Math.min(bounds.y1, points[k + 1]!));
    }
    return points;
}

/** Scar `k` of `scars` (`SCAR_VIEW_STRIDE` apiece), as polygons in its module's frame, into `out`. */
export function scarShapes(scars: readonly number[], k: number, spec: ModuleSpec, bounds: Bounds, out: ScarShape[]): void {
    const module = scars[k]!;
    const slot = scars[k + 1]!;
    const kind = scars[k + 2]!;
    const ax = scars[k + 3]!;
    const ay = scars[k + 4]!;
    let bx = scars[k + 5]!;
    let by = scars[k + 6]!;
    let ux = scars[k + 7]!;
    let uy = scars[k + 8]!;
    const through = scars[k + 10]! > 0;
    const span = Math.hypot(ux, uy);
    if (span > 0) {
        ux /= span;
        uy /= span;
    } else {
        const turn = hash(module, slot, 2) * 2 * Math.PI;
        ux = Math.cos(turn);
        uy = Math.sin(turn);
    }
    const width = scarWidth(scars, k, spec);
    const seed = module * 16 + slot;
    const add = (points: number[], colour: number, alpha: number): void => {
        out.push({ points: within(points, bounds), colour, alpha });
    };
    const length = Math.hypot(bx - ax, by - ay);

    if (kind === SCAR_ROUND) {
        // A channel as long as it got in, or a short gouge where it stopped at the face.
        if (length < width) {
            bx = ax + ux * width * 1.5;
            by = ay + uy * width * 1.5;
        }
        add(ragged(ax, ay, bx, by, ux, uy, width * 0.4, seed, 0.25), PIT, 0.6);
        if (through) add(ragged(bx, by, bx, by, ux, uy, width * 0.45, seed + 1, 0.2), HOLE, 0.95);
        else {
            // The lip of torn metal pushed up at its far end.
            const lx = bx + ux * width * 0.45;
            const ly = by + uy * width * 0.45;
            add(ragged(lx, ly, lx, ly, ux, uy, width * 0.35, seed + 2, 0.35), RIM, 0.5);
        }
        return;
    }
    if (kind === SCAR_PEPPER) {
        const streaks = 5 + Math.floor(Math.min(10, width / MIN_WIDTH));
        const spread = Math.max(width * 1.5, length / 2);
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const thin = Math.max(MIN_WIDTH * 0.4, width * 0.12);
        for (let n = 0; n < streaks; n++) {
            const t = hash(seed, n, 3) * 2 * Math.PI;
            const r = spread * Math.sqrt(hash(seed, n, 4));
            const sx = mx + Math.cos(t) * r;
            const sy = my + Math.sin(t) * r;
            const long = thin * (2 + 3 * hash(seed, n, 5));
            add(ragged(sx, sy, sx + ux * long, sy + uy * long, ux, uy, thin, seed + n, 0.2), PIT, 0.8);
        }
        return;
    }
    if (kind === SCAR_BURN) {
        add(ragged(ax, ay, bx, by, ux, uy, width * 0.8, seed, 0.35), SCORCH, 0.7);
        add(ragged(ax, ay, bx, by, ux, uy, width * 0.4, seed + 1, 0.25), GLAZE, 0.85);
        // A sheen across the glazed core, where melted metal set smooth.
        const cx = (ax + bx) / 2 + uy * width * 0.1;
        const cy = (ay + by) / 2 - ux * width * 0.1;
        add(
            ragged(
                cx - ux * width * 0.2,
                cy - uy * width * 0.2,
                cx + ux * width * 0.2,
                cy + uy * width * 0.2,
                ux,
                uy,
                width * 0.08,
                seed + 2,
                0.1,
            ),
            SHEEN,
            0.35,
        );
        return;
    }
    if (kind === SCAR_GOUGE) {
        const long = Math.max(length, width * 3);
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const ex = mx - (ux * long) / 2;
        const ey = my - (uy * long) / 2;
        const fx = mx + (ux * long) / 2;
        const fy = my + (uy * long) / 2;
        // Buckled edges either side, then the scraped metal between them.
        for (const side of [-1, 1]) {
            const ox = -uy * side * width * 0.4;
            const oy = ux * side * width * 0.4;
            add(ragged(ex + ox, ey + oy, fx + ox, fy + oy, ux, uy, width * 0.15, seed + side + 3, 0.4), BUCKLE, 0.6);
        }
        add(ragged(ex, ey, fx, fy, ux, uy, width * 0.3, seed, 0.2), SCRAPE, 0.55);
    }
}

/** How many scars a view's `scars` holds. */
export function scarCount(scars: readonly number[] | undefined): number {
    return scars === undefined ? 0 : scars.length / SCAR_VIEW_STRIDE;
}
