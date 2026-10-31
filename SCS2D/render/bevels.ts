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

/** Each bevelled edge of a module, six numbers apiece in its own frame: its ends, and the way it faces out. */
export type Bevels = readonly number[];

/** How far apart along an edge it is asked whether something stands beside it, metres. */
const SAMPLE_M = 0.5;
/** How far out from an edge it is asked, metres: past the edge, short of anything not touching it. */
const OUTSIDE_M = 0.05;

const built = new WeakMap<ShipDesign, Bevels[]>();

/** The bevelled edges of module `m` of `design` as built: pass a module's compiled design (`originOf`). */
export function bevelsOf(design: ShipDesign, m: number): Bevels {
    let all = built.get(design);
    if (all === undefined) {
        all = design.modules.map((_, i) => bevelled(design, i));
        built.set(design, all);
    }
    return all[m] ?? [];
}

/** Whether a module's edges are bevelled at all: not an asteroid's, nor anything round. */
export function isBevelled(spec: ModuleSpec): boolean {
    return spec.kind !== "rock" && spec.kind !== "kernel";
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
        // The edge in equal stretches, each open or not by what is beside its middle.
        const stretches = Math.max(2, Math.ceil(span / SAMPLE_M));
        let from = -1;
        for (let k = 0; k <= stretches; k++) {
            const t = (k + 0.5) / stretches;
            const open = k < stretches && !covered(ax + ex * t + nx * OUTSIDE_M, ay + ey * t + ny * OUTSIDE_M);
            if (open && from < 0) from = k;
            if (!open && from >= 0) {
                const t0 = from / stretches;
                const t1 = k / stretches;
                out.push(ax + ex * t0, ay + ey * t0, ax + ex * t1, ay + ey * t1, nx, ny);
                from = -1;
            }
        }
    }
    return out;
}
