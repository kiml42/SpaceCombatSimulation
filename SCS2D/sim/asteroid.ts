import type { Blueprint } from "./blueprint.js";
import { cos, max, min, sin, sqrt, TAU } from "./math.js";
import type { ModuleKind, ModuleSpec } from "./modules.js";
import type { Rng } from "./rng.js";
import { isConvexAnticlockwise, KERNEL_MAX_CORNERS, KERNEL_MIN_CORNERS, polygonCentroid, triangleBounds } from "./shape.js";

/**
 * Asteroids: hulls built round a kernel rather than flown from a core.
 *
 * A major asteroid's kernel is a solid convex polygon that takes no damage,
 * belongs to no side and carries a well, riding its rail (`ShipSpec.rides`).
 * Round it are rings of rock wedges, each a share ore and a share ice; a minor
 * asteroid is the rings alone, round a fan of wedges where the kernel would be.
 */

/** A shaped module of this kind with these corners, anywhere round its middle, placed where the middle is. */
function shaped(kind: ModuleKind, vertices: readonly number[], at: { x: number; y: number }): ModuleSpec {
    const middle = { x: 0, y: 0 };
    polygonCentroid(vertices, middle);
    const centred: number[] = [];
    for (let i = 0; i < vertices.length; i += 2) centred.push(vertices[i]! - middle.x, vertices[i + 1]! - middle.y);
    const bounds = triangleBounds(centred);
    return { kind, x: at.x + middle.x, y: at.y + middle.y, length: bounds.length, width: bounds.width, vertices: centred };
}

/** A kernel with these corners, anywhere round its middle, placed at `x`, `y`. */
export function kernelModule(vertices: readonly number[], x = 0, y = 0): ModuleSpec {
    const middle = { x: 0, y: 0 };
    polygonCentroid(vertices, middle);
    return shaped("kernel", vertices, { x: x - middle.x, y: y - middle.y });
}

/**
 * A wedge of rock with these corners, in the asteroid's frame, and its shares
 * of ore and ice: thick, standing in both layers, unless it is edge rubble.
 */
export function rockModule(vertices: readonly number[], ore: number, ice: number, thick = true): ModuleSpec {
    return { ...shaped("rock", vertices, { x: 0, y: 0 }), ore, ice, ...(thick ? { thick: true } : {}) };
}

/**
 * The corners of a kernel `radius` across its middle, one at each of `reach`'s
 * bearings evenly round and that share of `radius` out: a regular polygon when
 * every reach is 1. Whether it comes out convex is the caller's to choose.
 */
export function kernelOutline(radius: number, reach: readonly number[]): number[] {
    if (reach.length < KERNEL_MIN_CORNERS || reach.length > KERNEL_MAX_CORNERS) {
        throw new Error(`a kernel has ${KERNEL_MIN_CORNERS} to ${KERNEL_MAX_CORNERS} corners, got ${reach.length}`);
    }
    const out: number[] = [];
    for (let k = 0; k < reach.length; k++) {
        const bearing = (k * TAU) / reach.length;
        out.push(radius * reach[k]! * cos(bearing), radius * reach[k]! * sin(bearing));
    }
    return out;
}

/** An asteroid that is a kernel and nothing else. */
export function bareKernel(name: string, vertices: readonly number[]): Blueprint {
    return { name, modules: [kernelModule(vertices)] };
}

/** What an asteroid is made of, and how it lies. */
export interface AsteroidShape {
    /** How far its rock reaches, metres. */
    readonly radius: number;
    /** Whether it has a kernel: a major asteroid, rather than a minor one. */
    readonly kernel: boolean;
    /** The mean share of its rock that is ore, and that is ice. */
    readonly ore: number;
    readonly ice: number;
    /** How many corners round it and rings of rock deep, drawn from `ASTEROID_CORNERS` and its kind's rings when absent. */
    readonly corners?: number;
    readonly rings?: number;
}

/** How many corners round an asteroid, and how many rings of rock deep. */
const ASTEROID_CORNERS = [6, 12] as const;
const MAJOR_RINGS = [2, 3] as const;
const MINOR_RINGS = [1, 2] as const;
/** How much of a major asteroid's radius is its kernel. */
const KERNEL_SHARE = 0.45;
/** How far a corner may sit off its ring's mean radius, as a share of a ring's depth. */
const LUMP = 0.35;
/** How far a kernel's corner may sit off its mean radius, as a share of it: little enough to stay convex, mostly. */
const KERNEL_LUMP = 0.06;
/** Draws of a kernel's outline before settling for a regular one. */
const KERNEL_TRIES = 20;
/** Chance an outer wedge is missing, so that the edge of an asteroid is ragged. */
const RAGGED = 0.3;

/**
 * An asteroid of rock wedges, drawn from `rng`. Its corners lie on rays out
 * from its middle, each ring a little further out along every ray, so every
 * wedge is the convex quadrilateral between two rings, or a triangle at a
 * minor's heart; all are thick, but for the outermost ring, which is thin
 * rubble. Ore and ice each run in a vein: richest on one side,
 * thinning away from it, about the shape's mean.
 */
export function asteroidBlueprint(name: string, shape: AsteroidShape, rng: Rng): Blueprint {
    const corners = shape.corners ?? ASTEROID_CORNERS[0] + rng.nextInt(ASTEROID_CORNERS[1] - ASTEROID_CORNERS[0] + 1);
    const [fewest, most] = shape.kernel ? MAJOR_RINGS : MINOR_RINGS;
    const rings = shape.rings ?? fewest + rng.nextInt(most - fewest + 1);
    const inner = shape.kernel ? shape.radius * KERNEL_SHARE : shape.radius / (rings + 1);
    const depth = (shape.radius - inner) / rings;

    // Each ray's radius at each ring, from 0 (the kernel's edge) to `rings`.
    const reach: number[][] = [];
    for (let r = 0; r <= rings; r++) {
        const row: number[] = [];
        for (let k = 0; k < corners; k++) {
            const base = inner + r * depth;
            row.push(r === 0 ? base : base + (rng.nextFloat() * 2 - 1) * LUMP * depth);
        }
        reach.push(row);
    }
    // A kernel is lumpy too, but only as far as it stays convex.
    if (shape.kernel) {
        for (let t = 0; t < KERNEL_TRIES; t++) {
            const row = reach[0]!.map(() => inner * (1 + (rng.nextFloat() * 2 - 1) * KERNEL_LUMP));
            if (isConvexAnticlockwise(rays(row, corners))) {
                reach[0] = row;
                break;
            }
        }
    }
    const point = (r: number, k: number): [number, number] => {
        const bearing = ((k % corners) * TAU) / corners;
        const d = reach[r]![k % corners]!;
        return [d * cos(bearing), d * sin(bearing)];
    };

    const oreBearing = rng.nextFloat() * TAU;
    const iceBearing = rng.nextFloat() * TAU;
    const share = (mean: number, vein: number, bearing: number): number => {
        // Twice the mean on the vein, nothing opposite it.
        const along = cos(bearing - vein);
        return max(0, min(1, mean * (1 + along)));
    };
    const wedge = (vertices: number[], bearing: number, thick: boolean): ModuleSpec => {
        let ore = share(shape.ore, oreBearing, bearing);
        let ice = share(shape.ice, iceBearing, bearing);
        if (ore + ice > 1) {
            ore /= ore + ice;
            ice = 1 - ore;
        }
        return rockModule(anticlockwise(vertices), ore, ice, thick);
    };
    // A quadrilateral that does not come out convex is two triangles instead.
    const wedges = (vertices: number[], bearing: number, thick: boolean): ModuleSpec[] => {
        if (isConvexAnticlockwise(anticlockwise(vertices))) return [wedge(vertices, bearing, thick)];
        return [wedge(vertices.slice(0, 6), bearing, thick), wedge([...vertices.slice(4, 8), vertices[0]!, vertices[1]!], bearing, thick)];
    };

    const modules: ModuleSpec[] = [];
    if (shape.kernel) {
        const outline: number[] = [];
        for (let k = 0; k < corners; k++) outline.push(...point(0, k));
        modules.push(shaped("kernel", outline, { x: 0, y: 0 }));
    } else {
        for (let k = 0; k < corners; k++)
            modules.push(wedge([0, 0, ...point(0, k), ...point(0, k + 1)], ((k + 0.5) * TAU) / corners, true));
    }
    for (let r = 0; r < rings; r++) {
        for (let k = 0; k < corners; k++) {
            if (r === rings - 1 && rings > 1 && rng.chance(RAGGED)) continue;
            const vertices = [...point(r, k), ...point(r + 1, k), ...point(r + 1, k + 1), ...point(r, k + 1)];
            // The outermost ring is thin rubble, low enough to fly over.
            modules.push(...wedges(vertices, ((k + 0.5) * TAU) / corners, r < rings - 1));
        }
    }
    return { name, modules };
}

/** Corners at `reach` along each of `corners` rays evenly round. */
function rays(reach: readonly number[], corners: number): number[] {
    const out: number[] = [];
    for (let k = 0; k < corners; k++) {
        const bearing = (k * TAU) / corners;
        out.push(reach[k]! * cos(bearing), reach[k]! * sin(bearing));
    }
    return out;
}

/** The same corners wound anticlockwise, as every outline is. */
function anticlockwise(vertices: number[]): number[] {
    if (isConvexAnticlockwise(vertices)) return vertices;
    const out: number[] = [];
    for (let i = vertices.length - 2; i >= 0; i -= 2) out.push(vertices[i]!, vertices[i + 1]!);
    return out;
}

/** Speed for a circular orbit `r` from a well of `gm`. */
export function circularSpeed(gm: number, r: number): number {
    return sqrt(gm / r);
}
