import { originOf, type Livery, type ShipDesign } from "../sim/index.js";

/**
 * A livery's pattern, as a tile repeated across a ship's hull in its design's
 * frame, so it runs on across modules however each is drawn. One period of
 * the pattern is a tile `TILE` pixels square; a stripe or spot covers its
 * share of it, so a tile is made once for each pattern, share and colour.
 */
export const TILE = 64;

/** A tile's share of a period, in steps of a tile's pixel, so a slider dragged makes few. */
function share(livery: Livery): number {
    return Math.max(1, Math.min(TILE, Math.round((livery.size / livery.spacing) * TILE)));
}

/** What a tile is made from: the same for any two liveries tiled alike. */
export function tileKey(livery: Livery, colour: string): string {
    return `${livery.pattern} ${share(livery)} ${colour}`;
}

const tiles = new Map<string, HTMLCanvasElement | OffscreenCanvas | null>();

/** The tile for `livery` in `colour`, or null for no pattern, or with nothing to draw one on. */
export function patternTile(livery: Livery, colour: string): HTMLCanvasElement | OffscreenCanvas | null {
    if (livery.pattern === "none") return null;
    const key = tileKey(livery, colour);
    let tile = tiles.get(key);
    if (tile === undefined) {
        tile = makeTile(livery, colour);
        tiles.set(key, tile);
    }
    return tile;
}

function makeTile(livery: Livery, colour: string): HTMLCanvasElement | OffscreenCanvas | null {
    const canvas =
        typeof OffscreenCanvas !== "undefined"
            ? new OffscreenCanvas(TILE, TILE)
            : typeof document !== "undefined"
              ? Object.assign(document.createElement("canvas"), { width: TILE, height: TILE })
              : null;
    const ctx = canvas?.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
    if (canvas == null || ctx == null) return null;
    const width = share(livery);
    ctx.fillStyle = colour;
    if (livery.pattern === "stripes") ctx.fillRect(0, 0, width, TILE);
    else {
        ctx.beginPath();
        ctx.arc(TILE / 2, TILE / 2, width / 2, 0, 2 * Math.PI);
        ctx.fill();
    }
    return canvas;
}

/** A 2D affine transform, as a canvas holds one: x' = a x + c y + e, y' = b x + d y + f. */
export interface Affine {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
    readonly e: number;
    readonly f: number;
}

/**
 * From a tile's pixels to module `m`'s own frame: the tile laid in the frame
 * of the design `m` was built in, a period `spacing` of that design's radius
 * across, turned by the livery's angle and moved by its offset. A piece cut
 * from a ship keeps the pattern where it was.
 */
export function patternTransform(livery: Livery, design: ShipDesign, m: number): Affine {
    const origin = originOf(design, m);
    const built = origin.design;
    const module = built.modules[origin.module]!;
    const period = livery.spacing * built.radius;
    const s = period / TILE;
    // Tile pixels to the design's frame: scaled, moved along the stripes' normal, turned.
    const ca = Math.cos(livery.angle);
    const sa = Math.sin(livery.angle);
    const shift = livery.offset * period;
    // Then the design's frame to the module's: back from its place, and turned back by its angle.
    const cm = Math.cos(-module.angle);
    const sm = Math.sin(-module.angle);
    const a = s * ca;
    const b = s * sa;
    const c = -s * sa;
    const d = s * ca;
    const e = shift * ca - module.x;
    const f = shift * sa - module.y;
    return { a: cm * a - sm * b, b: sm * a + cm * b, c: cm * c - sm * d, d: sm * c + cm * d, e: cm * e - sm * f, f: sm * e + cm * f };
}
