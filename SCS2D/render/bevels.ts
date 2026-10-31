import {
    engineGeometry,
    hullMountGeometry,
    insideOutline,
    isDomed,
    isHullMount,
    shapeOf,
    type ModuleSpec,
    type ShipDesign,
} from "../sim/index.js";

/**
 * Which edges of a design's modules are bevelled: those on its outline, where
 * nothing beside them stands as high, as a thick module's edge over thin hull
 * does; not those it shares with a neighbour, so the seams inside a hull stay
 * unseen. Settled once for the design as built and kept, so a piece cut off
 * it keeps the edges it was built with rather than gaining new ones where it
 * broke.
 */

/**
 * Each bevelled edge of a module, `BEVEL_STRIDE` numbers apiece in its own
 * frame: its ends, the way it faces out, how deep a bevel there can go, and
 * at each end the way the bevelled edge it meets there faces and how deep its
 * bevel can go (0 where it meets none), so the two are mitred.
 */
export type Bevels = readonly number[];

/** Numbers to each edge in `Bevels`. */
export const BEVEL_STRIDE = 13;

/**
 * How wide a ship's bevels are, as a share of its radius as built: the same on
 * every module of it, so a big ship's show and a small one's still fit. A
 * Corvette's come to 0.3 m. Never deeper than a share of how far a module
 * reaches in from the edge, so a small module keeps a face, nor than the edge
 * is long. A gap narrower than this between two modules is a seam, unbevelled.
 */
export const BEVEL_OF_RADIUS = 0.0175;
/** Too thin to see under this many pixels, so not drawn. */
export const MIN_BEVEL_PX = 0.75;
/** How bright a bevel facing the light goes, and how dark one facing away. */
export const BEVEL_LIGHT = 0.45;
export const BEVEL_DARK = 0.4;
/** Square on to the light, a bevel is as the face beside it: not drawn. */
export const MIN_BEVEL_LIT = 0.05;
/** No deeper than this share of how far a module reaches in from an edge, so a small module keeps a face. */
const BEVEL_MOST = 0.25;
/** A mitre reaching further in than this many bevels' depth is cut square instead: a hairpin's. */
const MITRE_MOST = 3;

/** How far apart along an edge it is asked whether something stands beside it, metres. */
const SAMPLE_M = 0.5;
/** How far out from an edge it is asked, metres: past the edge, short of anything not touching it. */
const OUTSIDE_M = 0.05;

const built = new WeakMap<ShipDesign, Bevels[]>();

/** The bevelled edges of module `m` of `design` as built: pass a module's compiled design (`originOf`). */
export function bevelsOf(design: ShipDesign, m: number): Bevels {
    let all = built.get(design);
    if (all === undefined) {
        const edges = design.modules.map((_, i) => bevelled(design, i));
        mitre(design, edges);
        all = edges;
        built.set(design, all);
    }
    return all[m] ?? [];
}

/** Whether a module's edges are bevelled at all: not an asteroid's, nor anything round. */
export function isBevelled(spec: ModuleSpec): boolean {
    return spec.kind !== "rock" && spec.kind !== "kernel" && spec.kind !== "port";
}

/**
 * The outline that is bevelled, anticlockwise in the module's frame: its box
 * or its corners, or only the block of an engine or a hull mount, whose bells
 * and outlets are their own shapes.
 */
export function bevelOutline(spec: ModuleSpec): number[] {
    const l = spec.length / 2;
    const w = spec.width / 2;
    if (spec.kind === "engine") {
        const mouth = l - engineGeometry(spec).machineryLength;
        return [mouth, -w, l, -w, l, w, mouth, w];
    }
    if (isHullMount(spec.kind)) {
        const block = -l + hullMountGeometry(spec).blockLength;
        return [-l, -w, block, -w, block, w, -l, w];
    }
    const corners = shapeOf(spec);
    return corners === null ? [-l, -w, l, -w, l, w, -l, w] : [...corners];
}

/** How high a module stands: the hull, or above it. A turret's block is hull. */
function height(design: ShipDesign, m: number): number {
    const module = design.modules[m]!;
    return module.weaponsLayer && !isDomed(module.spec.kind) ? 1 : 0;
}

function bevelled(design: ShipDesign, m: number): number[] {
    const module = design.modules[m]!;
    if (!isBevelled(module.spec)) return [];
    const outline = bevelOutline(module.spec);
    const others = design.modules.map((other) => bevelOutline(other.spec));
    const mine = height(design, m);
    const c = Math.cos(module.angle);
    const s = Math.sin(module.angle);
    const out: number[] = [];
    const gap = Math.max(OUTSIDE_M, BEVEL_OF_RADIUS * design.radius);
    /** Whether something as high stands just outside this module at `x`, `y` in its frame. */
    const covered = (x: number, y: number): boolean => {
        const dx = module.x + x * c - y * s;
        const dy = module.y + x * s + y * c;
        for (let k = 0; k < design.modules.length; k++) {
            if (k === m || height(design, k) < mine) continue;
            const other = design.modules[k]!;
            const oc = Math.cos(other.angle);
            const os = Math.sin(other.angle);
            const rx = dx - other.x;
            const ry = dy - other.y;
            const corners = others[k]!;
            if (insideOutline(corners, corners.length / 2, rx * oc + ry * os, -rx * os + ry * oc)) return true;
        }
        return false;
    };
    for (let i = 0; i < outline.length; i += 2) {
        const j = (i + 2) % outline.length;
        const ax = outline[i]!;
        const ay = outline[i + 1]!;
        const ex = outline[j]! - ax;
        const ey = outline[j + 1]! - ay;
        const span = Math.sqrt(ex * ex + ey * ey);
        if (!(span > 0)) continue;
        // Anticlockwise, so out is to the right of the edge.
        const nx = ey / span;
        const ny = -ex / span;
        // How far in the module reaches from this edge: to its furthest corner.
        let reach = 0;
        for (let v = 0; v < outline.length; v += 2) reach = Math.max(reach, (ax - outline[v]!) * nx + (ay - outline[v + 1]!) * ny);
        // The edge in equal stretches, each open or not by what is beside its middle.
        const stretches = Math.max(2, Math.ceil(span / SAMPLE_M));
        // Shut where something stands within a bevel's width, so a crack between plates is a seam.
        const openAt = (t: number): boolean =>
            !covered(ax + ex * t + nx * OUTSIDE_M, ay + ey * t + ny * OUTSIDE_M) &&
            !covered(ax + ex * t + nx * gap, ay + ey * t + ny * gap);
        /** Where between `t0` and `t1`, one open and one not, it turns. */
        const turn = (t0: number, t1: number): number => {
            const was = openAt(t0);
            for (let n = 0; n < 16; n++) {
                const mid = (t0 + t1) / 2;
                if (openAt(mid) === was) t0 = mid;
                else t1 = mid;
            }
            return (t0 + t1) / 2;
        };
        let from = -1;
        for (let k = 0; k <= stretches; k++) {
            const t = (k + 0.5) / stretches;
            const open = k < stretches && openAt(t);
            if (open && from < 0) from = k === 0 ? 0 : turn(t - 1 / stretches, t);
            if (!open && from >= 0) {
                const to = k === stretches ? 1 : turn(t - 1 / stretches, t);
                // No deeper than a share of how far the module reaches in, nor than the face is long.
                const most = Math.min(BEVEL_MOST * reach, (to - from) * span);
                out.push(ax + ex * from, ay + ey * from, ax + ex * to, ay + ey * to, nx, ny, most, 0, 0, 0, 0, 0, 0);
                from = -1;
            }
        }
    }
    return out;
}

/**
 * Joins each bevelled edge to the one carrying on from either end of it, on
 * its own module or another as high, so where they turn a corner the two are
 * cut along the angle between them rather than overlapping.
 */
function mitre(design: ShipDesign, all: number[][]): void {
    // Every edge's ends and normal in the design's frame.
    const ends: { m: number; k: number; ax: number; ay: number; bx: number; by: number; nx: number; ny: number; h: number }[] = [];
    for (let m = 0; m < all.length; m++) {
        const module = design.modules[m]!;
        const c = Math.cos(module.angle);
        const s = Math.sin(module.angle);
        const edges = all[m]!;
        for (let k = 0; k < edges.length; k += BEVEL_STRIDE) {
            ends.push({
                m,
                k,
                ax: module.x + edges[k]! * c - edges[k + 1]! * s,
                ay: module.y + edges[k]! * s + edges[k + 1]! * c,
                bx: module.x + edges[k + 2]! * c - edges[k + 3]! * s,
                by: module.y + edges[k + 2]! * s + edges[k + 3]! * c,
                nx: edges[k + 4]! * c - edges[k + 5]! * s,
                ny: edges[k + 4]! * s + edges[k + 5]! * c,
                h: height(design, m),
            });
        }
    }
    // Ends meet within a bevel's width of each other: where one stops is where the next starts, to within how it was found.
    const reach = Math.max(OUTSIDE_M, BEVEL_OF_RADIUS * design.radius);
    const meet = reach * reach;
    /** The one of `ends` other than `e` whose start, or with `back` end, is nearest `x`, `y`. */
    const nearest = (e: (typeof ends)[number], x: number, y: number, back: boolean): (typeof ends)[number] | null => {
        let best = meet;
        let found: (typeof ends)[number] | null = null;
        for (const f of ends) {
            if (f === e || f.h !== e.h) continue;
            const d = ((back ? f.bx : f.ax) - x) ** 2 + ((back ? f.by : f.ay) - y) ** 2;
            if (d < best) {
                best = d;
                found = f;
            }
        }
        return found;
    };
    // Anticlockwise all round, so an edge's end is where the next one starts. Each
    // end and start takes the nearest, told of it in its own module's frame.
    for (const e of ends) {
        const next = nearest(e, e.bx, e.by, false);
        if (next !== null) link(design, all, e.m, e.k + 10, next.nx, next.ny, all[next.m]![next.k + 6]!);
        const last = nearest(e, e.ax, e.ay, true);
        if (last !== null) link(design, all, e.m, e.k + 7, last.nx, last.ny, all[last.m]![last.k + 6]!);
    }
}

function link(design: ShipDesign, all: number[][], m: number, at: number, nx: number, ny: number, most: number): void {
    const angle = design.modules[m]!.angle;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const edges = all[m]!;
    edges[at] = nx * c + ny * s;
    edges[at + 1] = -nx * s + ny * c;
    edges[at + 2] = most;
}

/**
 * The bevel on edge `k` of `edges` `width` deep, as four corners into `out`
 * in the module's frame: along the edge, then back along its inside, each
 * end mitred against the bevel it meets there.
 */
export function bevelQuad(edges: Bevels, k: number, width: number, out: number[]): void {
    const nx = edges[k + 4]!;
    const ny = edges[k + 5]!;
    const deep = Math.min(width, edges[k + 6]!);
    out[0] = edges[k]!;
    out[1] = edges[k + 1]!;
    out[2] = edges[k + 2]!;
    out[3] = edges[k + 3]!;
    inner(out, 4, out[2]!, out[3]!, nx, ny, deep, edges[k + 10]!, edges[k + 11]!, Math.min(width, edges[k + 12]!));
    inner(out, 6, out[0]!, out[1]!, nx, ny, deep, edges[k + 7]!, edges[k + 8]!, Math.min(width, edges[k + 9]!));
}

/**
 * Where a bevel `deep` inside an edge facing `nx`, `ny` meets one `other`
 * deep inside the edge facing `mx`, `my` from the same corner `x`, `y`.
 */
function inner(
    out: number[],
    at: number,
    x: number,
    y: number,
    nx: number,
    ny: number,
    deep: number,
    mx: number,
    my: number,
    other: number,
): void {
    // How far back from the corner, u, so that u·n is deep and u·m other.
    const det = nx * my - ny * mx;
    let ux = nx * deep;
    let uy = ny * deep;
    if (other > 0 && Math.abs(det) > 1e-3) {
        const mux = (deep * my - other * ny) / det;
        const muy = (nx * other - mx * deep) / det;
        const most = MITRE_MOST * Math.max(deep, other);
        if (mux * mux + muy * muy <= most * most) {
            ux = mux;
            uy = muy;
        }
    }
    out[at] = x - ux;
    out[at + 1] = y - uy;
}
