import { isHullMount, originOf, type Livery, type ModuleKind, type ShipDesign } from "../sim/index.js";
import type { Palette } from "./teams.js";

/**
 * A livery's pattern, as a tile repeated across a ship's hull in its design's
 * frame, so it runs on across modules however each is drawn. A tile of
 * stripes or spots is one period `TILE` pixels square, a stripe or spot
 * covering its share of it; a tile of chevrons is one period across and, for a
 * zigzag, one period of its points down, at `CHEVRON_WIDTH` pixels a stripe.
 * A tile is made once for each shape and colour.
 */
export const TILE = 64;
/** Pixels a chevron's stripe is wide on its tile. */
const CHEVRON_WIDTH = 16;
/** The tallest a single chevron's tile grows, pixels: a hull's width at the thinnest stripes. */
const TALLEST = 4096;

/** A tile's size, how many of its pixels a stripe's width spans, and the row the design's middle falls on. */
interface TileShape {
    readonly width: number;
    readonly height: number;
    readonly perWidth: number;
    readonly middle: number;
}

function shapeOf(livery: Livery): TileShape {
    if (livery.pattern !== "chevrons") return { width: TILE, height: TILE, perWidth: TILE / livery.spacing, middle: 0 };
    const width = Math.max(2, Math.round(CHEVRON_WIDTH * livery.spacing));
    // A single chevron reaches a radius either side of its point, which is 1 / size stripe widths.
    const height =
        livery.points > 0
            ? Math.max(2, Math.round(CHEVRON_WIDTH * livery.points))
            : Math.min(TALLEST, Math.round((2 * CHEVRON_WIDTH) / livery.size));
    return { width, height, perWidth: CHEVRON_WIDTH, middle: livery.points > 0 ? 0 : height / 2 };
}

/**
 * A stripe's or spot's share of a tile, in whole pixels, so a slider dragged
 * makes few tiles: never all of it for stripes, which would cover the hull;
 * spots as wide as the tile still leave its corners.
 */
function share(livery: Livery): number {
    return Math.max(1, Math.min(livery.pattern === "stripes" ? TILE - 1 : TILE, Math.round(TILE / livery.spacing)));
}

/** What a tile is made from: the same for any two liveries tiled alike. */
export function tileKey(livery: Livery, colour: string): string {
    if (livery.pattern !== "chevrons") return `${livery.pattern} ${share(livery)} ${colour}`;
    const { width, height } = shapeOf(livery);
    // In half degrees, so a slider dragged makes few.
    return `chevrons ${width}x${height} ${Math.round((livery.chevron * 360) / Math.PI)} ${colour}`;
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
    const { width: w, height: h } = shapeOf(livery);
    const canvas =
        typeof OffscreenCanvas !== "undefined"
            ? new OffscreenCanvas(w, h)
            : typeof document !== "undefined"
              ? Object.assign(document.createElement("canvas"), { width: w, height: h })
              : null;
    const ctx = canvas?.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
    if (canvas == null || ctx == null) return null;
    ctx.fillStyle = colour;
    if (livery.pattern === "chevrons") chevrons(ctx, livery, w, h);
    else if (livery.pattern === "stripes") ctx.fillRect(0, 0, share(livery), TILE);
    else {
        ctx.beginPath();
        ctx.arc(TILE / 2, TILE / 2, share(livery) / 2, 0, 2 * Math.PI);
        ctx.fill();
    }
    return canvas;
}

/**
 * A band `CHEVRON_WIDTH` across, square to its arms, bent at its points: for a
 * zigzag at the tile's top and bottom edges and the other way at its middle,
 * for a single chevron at its middle alone. Drawn again either side, as far
 * as its arms reach, so it wraps across the tile's sides.
 */
function chevrons(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, livery: Livery, w: number, h: number): void {
    const lean = Math.tan(livery.chevron);
    const half = CHEVRON_WIDTH / 2 / Math.cos(livery.chevron);
    // How far from its point the band has leaned, at the top, middle and bottom rows.
    const away = livery.points > 0 ? [0, h / 2, 0] : [h / 2, 0, h / 2];
    const rows = [0, h / 2, h];
    const reach = Math.ceil((lean * h) / 2 / w) + 1;
    for (let k = -reach; k <= 1; k++) {
        const x = w / 2 + k * w;
        ctx.beginPath();
        rows.forEach((row, n) => ctx.lineTo(x - half + lean * away[n]!, row));
        for (let n = 2; n >= 0; n--) ctx.lineTo(x + half + lean * away[n]!, rows[n]!);
        ctx.closePath();
        ctx.fill();
    }
}

/**
 * The pattern's colour over a fill of `fill`: the highlight on any part in the
 * hull's tones, none on anything else. Engines and hull mounts take none, so
 * they stay told apart from the hull.
 */
export function patternColour(kind: ModuleKind, fill: string, palette: Palette): string | null {
    if (palette.highlight === undefined || kind === "engine" || isHullMount(kind)) return null;
    return fill === palette.hull || fill === palette.trim || fill === palette.pivot ? palette.highlight : null;
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
 * of the design `m` was built in, a stripe `size` of that design's radius
 * across and a period `spacing` stripes, turned by the livery's angle and
 * moved by its offset. A piece cut
 * from a ship keeps the pattern where it was.
 */
export function patternTransform(livery: Livery, design: ShipDesign, m: number): Affine {
    const origin = originOf(design, m);
    const built = origin.design;
    const module = built.modules[origin.module]!;
    const shape = shapeOf(livery);
    const s = (livery.size * built.radius) / shape.perWidth;
    const period = shape.width * s;
    // Tile pixels to the design's frame: scaled, moved along the stripes' normal and the tile's middle row to the
    // design's, turned.
    const ca = Math.cos(livery.angle);
    const sa = Math.sin(livery.angle);
    const along = livery.offset * period;
    const down = -shape.middle * s;
    const shiftX = along * ca - down * sa;
    const shiftY = along * sa + down * ca;
    // Then the design's frame to the module's: back from its place, and turned back by its angle.
    const cm = Math.cos(-module.angle);
    const sm = Math.sin(-module.angle);
    const a = s * ca;
    const b = s * sa;
    const c = -s * sa;
    const d = s * ca;
    const e = shiftX - module.x;
    const f = shiftY - module.y;
    return { a: cm * a - sm * b, b: sm * a + cm * b, c: cm * c - sm * d, d: sm * c + cm * d, e: cm * e - sm * f, f: sm * e + cm * f };
}
