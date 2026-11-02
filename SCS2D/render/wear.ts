import { originOf, type ShipDesign } from "../sim/index.js";
import type { Affine } from "./livery.js";

/**
 * Wear: the grime, dents and scuffs a module gathers as it is hurt
 * (ROADMAP.md §8 step 17, marks for damage).
 *
 * One tile in which every texel has a threshold of its own, made into
 * `WEAR_LEVELS` textures, each showing the texels whose threshold its level
 * has passed. So wear spreads as damage rises and goes back in exact reverse
 * as it is mended, a sixteenth at a time, and every module still batches: a
 * shader taking each module's damage would have drawn each alone.
 */

export const WEAR_LEVELS = 16;
export const WEAR_TILE = 128;
/** How much of its ship's radius a tile covers. */
const WEAR_OF_RADIUS = 0.6;
/** The fewest pixels a texel may cover on screen for wear to be drawn. */
const MIN_WEAR_TEXEL_PX = 0.35;
/** A destroyed module's soot, over its own colours. */
export const SOOT = "#120f0d";
export const SOOT_ALPHA = 0.78;

/** Which of the `WEAR_LEVELS` a module this hurt shows, 0 for none. */
export function wearLevel(integrity: number): number {
    if (!(integrity < 1)) return 0;
    if (!(integrity > 0)) return WEAR_LEVELS;
    return Math.min(WEAR_LEVELS, Math.ceil((1 - integrity) * WEAR_LEVELS));
}

/** Whether wear on a ship of this radius would show, at `scale` pixels a metre. */
export function wearShows(radius: number, scale: number): boolean {
    return ((WEAR_OF_RADIUS * radius) / WEAR_TILE) * scale >= MIN_WEAR_TEXEL_PX;
}

/** A small, fixed hash of two integers to [0, 1). */
function hash(x: number, y: number, seed: number): number {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/** Smooth value noise on a grid `cell` texels across, wrapping at the tile's edge. */
function noise(x: number, y: number, cell: number, seed: number): number {
    const n = WEAR_TILE / cell;
    const gx = x / cell;
    const gy = y / cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number): number => hash(((i % n) + n) % n, ((j % n) + n) % n, seed);
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return top + (bottom - top) * sy;
}

interface Texel {
    /** Damage, 0 to 1, past which it shows. */
    readonly threshold: number;
    readonly rgba: readonly [number, number, number, number];
}

let field: Texel[] | null = null;

/**
 * Every texel's threshold and colour. Grime in broad patches, coming first and
 * thickest where the broad noise is low; dents and scuffs scattered through
 * it, later. Exported for its test.
 */
export function wearField(): readonly Texel[] {
    if (field !== null) return field;
    const out: Texel[] = [];
    for (let y = 0; y < WEAR_TILE; y++) {
        for (let x = 0; x < WEAR_TILE; x++) {
            const broad = 0.55 * noise(x, y, 32, 1) + 0.3 * noise(x, y, 16, 2) + 0.15 * noise(x, y, 4, 3);
            const threshold = Math.min(1, Math.max(0, (broad - 0.25) * 1.9));
            // Dents and scuffs in small clusters, where the fine noise peaks.
            const spot = noise(x, y, 4, 4) * 0.7 + hash(x, y, 9) * 0.3;
            const shade = noise(x, y, 8, 5);
            let rgba: [number, number, number, number];
            if (spot > 0.88)
                rgba = [190, 186, 178, 80]; // a scuff, bright metal
            else if (spot < 0.16)
                rgba = [18, 14, 12, 160]; // a dent's shadow
            else rgba = [44 + shade * 18, 37 + shade * 14, 30 + shade * 10, 70 + shade * 60]; // grime
            out.push({ threshold, rgba });
        }
    }
    field = out;
    return out;
}

const tiles = new Map<number, HTMLCanvasElement | OffscreenCanvas | null>();

/** The tile for wear `level`, 1 to `WEAR_LEVELS`, or null with no canvas to draw it on. */
export function wearTile(level: number): HTMLCanvasElement | OffscreenCanvas | null {
    let tile = tiles.get(level);
    if (tile !== undefined) return tile;
    const canvas =
        typeof OffscreenCanvas !== "undefined"
            ? new OffscreenCanvas(WEAR_TILE, WEAR_TILE)
            : typeof document !== "undefined"
              ? Object.assign(document.createElement("canvas"), { width: WEAR_TILE, height: WEAR_TILE })
              : null;
    const ctx = canvas?.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
    tile = null;
    if (canvas != null && ctx != null) {
        const image = ctx.createImageData(WEAR_TILE, WEAR_TILE);
        const shown = level / WEAR_LEVELS;
        wearField().forEach((texel, k) => {
            if (texel.threshold >= shown) return;
            image.data.set(texel.rgba, k * 4);
        });
        ctx.putImageData(image, 0, 0);
        tile = canvas;
    }
    tiles.set(level, tile);
    return tile;
}

/**
 * From a wear tile's texels to module `m`'s own frame: laid in the frame of
 * the design it was built in, `WEAR_OF_RADIUS` of that design's radius across,
 * and moved and turned by which module it is there, so two modules hurt alike
 * look different and a piece cut away keeps its wear.
 */
export function wearTransform(design: ShipDesign, m: number): Affine {
    const origin = originOf(design, m);
    const built = origin.design;
    const module = built.modules[origin.module]!;
    const s = (WEAR_OF_RADIUS * built.radius) / WEAR_TILE;
    const turn = hash(origin.module, 0, 6) * 2 * Math.PI;
    const shiftX = hash(origin.module, 1, 7) * WEAR_TILE * s;
    const shiftY = hash(origin.module, 2, 8) * WEAR_TILE * s;
    const ct = Math.cos(turn);
    const st = Math.sin(turn);
    // Texels to the design's frame, then back from the module's place and turned by its angle.
    const cm = Math.cos(-module.angle);
    const sm = Math.sin(-module.angle);
    const a = s * ct;
    const b = s * st;
    const c = -s * st;
    const d = s * ct;
    const e = shiftX - module.x;
    const f = shiftY - module.y;
    return { a: cm * a - sm * b, b: sm * a + cm * b, c: cm * c - sm * d, d: sm * c + cm * d, e: cm * e - sm * f, f: sm * e + cm * f };
}
