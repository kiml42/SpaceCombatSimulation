import {
    hullMountGeometry,
    insideOutline,
    isDomed,
    isHullMount,
    originOf,
    shapeOf,
    type ModuleSpec,
    type ShipDesign,
} from "../sim/index.js";
import { engineLayout } from "./engineLayout.js";

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
        const shapes = design.modules.map((other, k) => [bevelOutline(other.spec), ...mountsOf(design, k).polygons]);
        const edges = design.modules.map((_, i) => bevelled(design, i, shapes));
        mitre(design, edges);
        all = edges;
        built.set(design, all);
    }
    return all[m] ?? [];
}

/**
 * The bevelled edges module `m` of `design` is drawn with: those it was built
 * with, or a shell's own, since a shell is only the part of it that is up and
 * the edges of the whole would stand out past it.
 */
export function drawnBevels(design: ShipDesign, m: number): Bevels {
    if (design.modules[m]?.shell !== undefined) return bevelsOf(design, m);
    const origin = originOf(design, m);
    return bevelsOf(origin.design, origin.module);
}

/** Whether a module's edges are bevelled at all: not an asteroid's, nor anything round. */
export function isBevelled(spec: ModuleSpec): boolean {
    return spec.kind !== "rock" && spec.kind !== "kernel" && spec.kind !== "port";
}

/**
 * The outline that is bevelled, anticlockwise in the module's frame: its box
 * or its corners, or only the pump of an engine or the block of a hull mount,
 * whose chambers, bells and outlets are their own shapes.
 */
export function bevelOutline(spec: ModuleSpec): number[] {
    const l = spec.length / 2;
    const w = spec.width / 2;
    if (spec.kind === "engine") {
        // Its pump; its chambers and bells are round.
        const aft = engineLayout(spec).pumpAft;
        return aft < l ? [aft, -w, l, -w, l, w, aft, w] : [];
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

/**
 * Whether something stands at a point in module `m` of `design`'s frame, among
 * each module's `shapes`: something as high as it, unless `any`.
 */
function coverTest(
    design: ShipDesign,
    m: number,
    shapes: readonly (readonly (readonly number[])[])[],
    any = false,
): (x: number, y: number) => boolean {
    const module = design.modules[m]!;
    const mine = any ? 0 : height(design, m);
    const c = Math.cos(module.angle);
    const s = Math.sin(module.angle);
    return (x, y) => {
        const dx = module.x + x * c - y * s;
        const dy = module.y + x * s + y * c;
        for (let k = 0; k < design.modules.length; k++) {
            if (k === m || height(design, k) < mine) continue;
            const other = design.modules[k]!;
            const oc = Math.cos(other.angle);
            const os = Math.sin(other.angle);
            const rx = dx - other.x;
            const ry = dy - other.y;
            const ox = rx * oc + ry * os;
            const oy = -rx * os + ry * oc;
            for (const corners of shapes[k]!) if (corners.length > 0 && insideOutline(corners, corners.length / 2, ox, oy)) return true;
        }
        return false;
    };
}

/**
 * Where along an edge `span` long `at(t)` holds, t from 0 to 1, as `from, to`
 * pairs: asked in equal stretches, each by its middle, and where it turns
 * found between them.
 */
function runs(span: number, at: (t: number) => boolean): number[] {
    const out: number[] = [];
    const stretches = Math.max(2, Math.ceil(span / SAMPLE_M));
    const turn = (t0: number, t1: number): number => {
        const was = at(t0);
        for (let n = 0; n < 16; n++) {
            const mid = (t0 + t1) / 2;
            if (at(mid) === was) t0 = mid;
            else t1 = mid;
        }
        return (t0 + t1) / 2;
    };
    let from = -1;
    for (let k = 0; k <= stretches; k++) {
        const t = (k + 0.5) / stretches;
        const holds = k < stretches && at(t);
        if (holds && from < 0) from = k === 0 ? 0 : turn(t - 1 / stretches, t);
        if (!holds && from >= 0) {
            out.push(from, k === stretches ? 1 : turn(t - 1 / stretches, t));
            from = -1;
        }
    }
    return out;
}

function bevelled(design: ShipDesign, m: number, shapes: readonly (readonly (readonly number[])[])[]): number[] {
    const module = design.modules[m]!;
    if (!isBevelled(module.spec)) return [];
    const outline = bevelOutline(module.spec);
    const out: number[] = [];
    const gap = Math.max(OUTSIDE_M, BEVEL_OF_RADIUS * design.radius);
    const covered = coverTest(design, m, shapes);
    for (let i = 0; i < outline.length; i += 2) {
        const j = (i + 2) % outline.length;
        const ax = outline[i]!;
        const ay = outline[i + 1]!;
        const ex = outline[j]! - ax;
        const ey = outline[j + 1]! - ay;
        const span = Math.sqrt(ex * ex + ey * ey);
        if (!(span > 0)) continue;
        // A round pump has edges only at its ends.
        if (module.spec.kind === "engine" && engineLayout(module.spec).roundPump && Math.abs(ex) > Math.abs(ey)) continue;
        // Anticlockwise, so out is to the right of the edge.
        const nx = ey / span;
        const ny = -ex / span;
        // How far in the module reaches from this edge: to its furthest corner.
        let reach = 0;
        for (let v = 0; v < outline.length; v += 2) reach = Math.max(reach, (ax - outline[v]!) * nx + (ay - outline[v + 1]!) * ny);
        // Shut where something stands within a bevel's width, so a crack between plates is a seam.
        const open = runs(
            span,
            (t) =>
                !covered(ax + ex * t + nx * OUTSIDE_M, ay + ey * t + ny * OUTSIDE_M) &&
                !covered(ax + ex * t + nx * gap, ay + ey * t + ny * gap),
        );
        for (let r = 0; r < open.length; r += 2) {
            const from = open[r]!;
            const to = open[r + 1]!;
            // No deeper than a share of how far the module reaches in, nor than the face is long.
            const most = Math.min(BEVEL_MOST * reach, (to - from) * span);
            out.push(ax + ex * from, ay + ey * from, ax + ex * to, ay + ey * to, nx, ny, most, 0, 0, 0, 0, 0, 0);
        }
    }
    return out;
}

/**
 * What holds an engine's chambers to whatever it is built against: a plate
 * along each stretch of its block's faces with something beside it, and a web
 * from that plate to the nearest chamber. Where nothing touches it the chambers
 * stand clear, so the module is drawn as the pieces it is made of.
 */
export interface Mounts {
    /** Polygons in the module's frame, filled in its colour. */
    readonly polygons: readonly (readonly number[])[];
    /** The polygons as a string, for a cache key: empty where there are none. */
    readonly key: string;
}

const NO_MOUNTS: Mounts = { polygons: [], key: "" };

/** A plate's depth, and a web's half-width, in chamber radii. */
const PLATE_OF_RADIUS = 0.3;
const WEB_OF_RADIUS = 0.45;

const mounted = new WeakMap<ShipDesign, Mounts[]>();

/** Module `m` of `design`'s mounts, as built: pass a module's compiled design (`originOf`). */
export function mountsOf(design: ShipDesign, m: number): Mounts {
    let all = mounted.get(design);
    if (all === undefined) {
        // Another engine by its whole block, so two built onto each other each mount to the other.
        const shapes = design.modules.map((other) => [other.spec.kind === "engine" ? engineBlock(other.spec) : bevelOutline(other.spec)]);
        all = design.modules.map((module, i) => (module.spec.kind === "engine" ? engineMounts(design, i, shapes) : NO_MOUNTS));
        mounted.set(design, all);
    }
    return all[m] ?? NO_MOUNTS;
}

/** The mounts module `m` of `design` is drawn with, as `drawnBevels` picks its bevels. */
export function drawnMounts(design: ShipDesign, m: number): Mounts {
    if (design.modules[m]?.shell !== undefined) return mountsOf(design, m);
    const origin = originOf(design, m);
    return mountsOf(origin.design, origin.module);
}

function engineBlock(spec: ModuleSpec): number[] {
    const { mouth, front, halfWidth: w } = engineLayout(spec);
    return [mouth, -w, front, -w, front, w, mouth, w];
}

function engineMounts(design: ShipDesign, m: number, shapes: readonly (readonly (readonly number[])[])[]): Mounts {
    const layout = engineLayout(design.modules[m]!.spec);
    const { radius, halfWidth: w, front: l, centres } = layout;
    if (!(radius > 0) || centres.length === 0) return NO_MOUNTS;
    // Whatever it stands beside holds it, however high.
    const covered = coverTest(design, m, shapes, true);
    const gap = Math.max(OUTSIDE_M, BEVEL_OF_RADIUS * design.radius);
    const touching = (x: number, y: number, nx: number, ny: number): boolean =>
        covered(x + nx * OUTSIDE_M, y + ny * OUTSIDE_M) || covered(x + nx * gap, y + ny * gap);
    const plate = radius * PLATE_OF_RADIUS;
    const web = radius * WEB_OF_RADIUS;
    const polygons: number[][] = [];
    const rect = (x0: number, y0: number, x1: number, y1: number): void => {
        const [a, b] = x0 < x1 ? [x0, x1] : [x1, x0];
        const [c, d] = y0 < y1 ? [y0, y1] : [y1, y0];
        polygons.push([a, c, b, c, b, d, a, d]);
    };
    // The forward face, where there is no pump flush with it.
    if (layout.pumpAft >= l) {
        const along = runs(2 * w, (t) => touching(l, -w + 2 * w * t, 1, 0));
        for (let r = 0; r < along.length; r += 2) {
            const a = -w + 2 * w * along[r]!;
            const b = -w + 2 * w * along[r + 1]!;
            rect(l - plate, a, l, b);
            for (const y of centres) if (y >= a && y <= b) rect(layout.nose, y - web, l, y + web);
        }
    }
    // Each side, beside the chambers.
    const x0 = layout.mouth;
    const span = layout.pumpAft - x0;
    if (span > 0) {
        for (const side of [-1, 1]) {
            const edge = side * w;
            const chamber = side < 0 ? centres[0]! : centres[centres.length - 1]!;
            const along = runs(span, (t) => touching(x0 + span * t, edge, 0, side));
            for (let r = 0; r < along.length; r += 2) {
                const a = x0 + span * along[r]!;
                const b = x0 + span * along[r + 1]!;
                rect(a, edge - side * plate, b, edge);
                // Across to the chamber, along its widest.
                const from = Math.max(a, layout.centre - web);
                const to = Math.min(b, layout.nose + web);
                if (to > from) rect(from, chamber, to, edge);
            }
        }
    }
    if (polygons.length === 0) return NO_MOUNTS;
    return { polygons, key: polygons.map((p) => p.map((v) => v.toFixed(4)).join(",")).join(";") };
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
    const round = (m: number): boolean => {
        const spec = design.modules[m]!.spec;
        return spec.kind === "engine" && engineLayout(spec).roundPump;
    };
    const nearest = (e: (typeof ends)[number], x: number, y: number, back: boolean): (typeof ends)[number] | null => {
        let best = meet;
        let found: (typeof ends)[number] | null = null;
        for (const f of ends) {
            if (f === e || f.h !== e.h || round(f.m)) continue;
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
        // A round pump's ends are cut square across it, meeting nothing.
        if (round(e.m)) continue;
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
