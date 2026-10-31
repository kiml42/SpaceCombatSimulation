import type { Light } from "./light.js";

/**
 * Rounded parts lit by the battle's light: engine bells and barrels as
 * cylinders, a turret's dome as a flattened hemisphere. Each is an image laid
 * over the part, black where it turns from the light and white where it turns
 * to it, clear where it faces up as the flat hull does, so it shades whatever
 * colour the part is. Made once per angle of the light across the part,
 * rounded to `STEPS`, and kept.
 */

type Image = CanvasImageSource & { width: number; height: number };

/** How dark the far side of a rounded part goes, and how bright its lit side. */
const DARKEST = 0.5;
const BRIGHTEST = 0.35;
/** A dome's height as a share of its radius: a little flatter than a hemisphere. */
const DOME_HEIGHT = 0.6;
/** Steps the light's angle across a part is rounded to, either side of square on. */
const STEPS = 12;
const ALONG = 32;
const ACROSS = 32;

/** The light as a direction: how much of it comes across the deck, and how much from above. */
export function lightSlope(light: Light): { across: number; up: number } {
    // A slant of 1 is a light 45° up; nearer overhead as it falls.
    const slant = light.slant ?? 1;
    const length = Math.sqrt(1 + slant * slant);
    return { across: slant / length, up: 1 / length };
}

const cache = new Map<string, Image | null>();

/**
 * A cylinder lying along x, the light `side` of the way across from -1 (all
 * from -y) to 1 (all from +y), and `up` from above. Rows run across it from -y
 * to +y. `taper` is its width at its right-hand end as a share of its left's,
 * so a bell, wide at its exit, narrows to its throat.
 */
export function cylinderShade(side: number, up: number, taper = 1): Image | null {
    const s = Math.round(side * STEPS);
    const u = Math.round(up * STEPS);
    const t = Math.round(taper * STEPS);
    const key = `c ${s} ${u} ${t}`;
    let made = cache.get(key);
    if (made === undefined) {
        made = paint(
            ALONG,
            ACROSS,
            (x, y) => {
                const half = 1 + (t / STEPS - 1) * x;
                const v = y / half;
                if (Math.abs(v) >= 1) return null;
                // Out of the surface at v across it, and how much of the light it takes.
                const lit = (v * s) / STEPS + Math.sqrt(1 - v * v) * (u / STEPS);
                return [lit, edge(half - Math.abs(y), ACROSS)];
            },
            u / STEPS,
        );
        cache.set(key, made);
    }
    return made;
}

/** A dome, the light coming from +x and `up` from above, `across` along the deck. */
export function domeShade(across: number, up: number): Image | null {
    const a = Math.round(across * STEPS);
    const u = Math.round(up * STEPS);
    const key = `d ${a} ${u}`;
    let made = cache.get(key);
    if (made === undefined) {
        made = paint(
            ACROSS,
            ACROSS,
            (x, y) => {
                const px = 2 * x - 1;
                const r2 = px * px + y * y;
                if (r2 >= 1) return null;
                // The flattened hemisphere's normal: the gradient of x² + y² + (z / h)².
                const z = DOME_HEIGHT * Math.sqrt(1 - r2);
                const nz = z / (DOME_HEIGHT * DOME_HEIGHT);
                const length = Math.sqrt(px * px + y * y + nz * nz);
                const lit = (px * (a / STEPS) + nz * (u / STEPS)) / length;
                return [lit, edge(1 - Math.sqrt(r2), ACROSS)];
            },
            u / STEPS,
        );
        cache.set(key, made);
    }
    return made;
}

/** How much of a pixel `inside` of an edge is covered, `scale` pixels to a unit. */
function edge(inside: number, scale: number): number {
    return Math.min(1, Math.max(0, inside * scale * 0.5 + 0.5));
}

/**
 * An image `width` by `height`, each pixel from `at(x, y)` with x from 0 to 1
 * and y from -1 to 1: how much light the surface there takes, and how much of
 * the pixel it covers, or null for none. Against `flat`, what the deck takes.
 */
function paint(width: number, height: number, at: (x: number, y: number) => [number, number] | null, flat: number): Image | null {
    const canvas = blank(width, height);
    const ctx = canvas?.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (canvas === null || ctx === null || ctx === undefined) return null;
    const image = ctx.createImageData(width, height);
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const sample = at((col + 0.5) / width, (2 * (row + 0.5)) / height - 1);
            if (sample === null) continue;
            const [taken, covered] = sample;
            const lit = Math.max(0, taken) - flat;
            const i = 4 * (row * width + col);
            const shade = lit >= 0 ? (BRIGHTEST * lit) / Math.max(1e-6, 1 - flat) : (DARKEST * -lit) / Math.max(1e-6, flat);
            const v = lit >= 0 ? 255 : 0;
            image.data[i] = v;
            image.data[i + 1] = v;
            image.data[i + 2] = v;
            image.data[i + 3] = Math.round(255 * Math.min(1, shade) * covered);
        }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
}

function blank(width: number, height: number): (Image & { getContext(id: "2d"): unknown }) | null {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
    if (typeof document !== "undefined") {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }
    return null;
}
