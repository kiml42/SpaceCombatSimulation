import { shutterWeight } from "./exposure.js";
import { muzzleWedge } from "./flashes.js";

/**
 * Small images stretched over what is drawn, for shading a stroke cannot do:
 * a fade along a streak, across it, or out from a centre. Made once per colour
 * and kept.
 */

export type SpriteShape =
    /** Fades along its length with the shutter; hard sides. */
    | "streak"
    /** Fades along its length with the shutter, and out from its centre line. */
    | "glowStreak"
    /** White-hot through its middle, fading out to its edge: a spot of hot metal. */
    | "hot"
    /** Fades out from its centre. */
    | "halo"
    /** Even along its length, fading out from its centre line as a halo does from its centre. */
    | "band"
    /** A halo's right half, so a band capped with two is a capsule with no seam. */
    | "cap"
    /** Even along its length, and as bright across as a rod is thick there: a beam seen side on. */
    | "rod"
    /** A torn, jagged sliver, solid, its edge a texel soft: a bit of metal broken off. */
    | "shard";

type Image = CanvasImageSource & { width: number; height: number };

const ALONG = 64;
const ACROSS = 32;
const cache = new Map<string, Image | null>();

/** The sprite for this shape and colour, or null where nothing can draw one. */
export function sprite(shape: SpriteShape, colour: string): Image | null {
    const key = `${shape} ${colour}`;
    let made = cache.get(key);
    if (made === undefined) {
        made = makeSprite(shape, colour);
        cache.set(key, made);
    }
    return made;
}

/** How bright the sprite is at `(u, v)`, both from 0 to 1 across it. */
function shade(shape: SpriteShape, u: number, v: number): number {
    const across = Math.abs(2 * v - 1);
    switch (shape) {
        case "streak":
            return shutterWeight(u);
        case "glowStreak":
            return shutterWeight(u) * falloff(across);
        case "halo":
            return falloff(radial(u, v));
        case "hot": {
            const r = radial(u, v);
            return r >= 1 ? 0 : Math.min(1, HOT_PLATEAU * (1 - r * r));
        }
        case "band":
            return falloff(across);
        case "shard": {
            const x = 2 * u - 1;
            const y = 2 * v - 1;
            // A lozenge with a torn edge.
            const edge = 1 - 0.18 * Math.sin(9 * x + 2) - 0.12 * Math.sin(13 * y);
            const reach = Math.abs(x) * 0.9 + Math.abs(y) * 1.1;
            return Math.min(1, Math.max(0, (edge - reach) * (ACROSS / 2) + 0.5));
        }
        case "rod":
            return Math.sqrt(Math.max(0, 1 - across * across));
        case "cap":
            return falloff(Math.sqrt(u * u + (2 * v - 1) ** 2));
    }
}

/** How far past full a hot spot's middle is, so it stays white out to about three-fifths of its radius. */
const HOT_PLATEAU = 1.6;

/** Distance from the centre, 1 at the edge of the square. */
function radial(u: number, v: number): number {
    const x = 2 * u - 1;
    const y = 2 * v - 1;
    return Math.sqrt(x * x + y * y);
}

/** Full at the centre, nothing at the edge, softly. */
function falloff(r: number): number {
    if (r >= 1) return 0;
    const left = 1 - r * r;
    return left * left;
}

function makeSprite(shape: SpriteShape, colour: string): Image | null {
    const width =
        shape === "streak" || shape === "glowStreak"
            ? ALONG
            : shape === "band" || shape === "rod"
              ? 1
              : shape === "cap"
                ? ACROSS / 2
                : ACROSS;
    const height = shape === "streak" ? 1 : ACROSS;
    const canvas = blankCanvas(width, height);
    const ctx = canvas?.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (canvas === null || ctx === null || ctx === undefined) return null;
    const [r, g, b, a] = rgba(colour);
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = 4 * (y * width + x);
            image.data[i] = r;
            image.data[i + 1] = g;
            image.data[i + 2] = b;
            image.data[i + 3] = Math.round(a * shade(shape, (x + 0.5) / width, (y + 0.5) / height));
        }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
}

function blankCanvas(width: number, height: number): (Image & { getContext(id: "2d"): unknown }) | null {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
    if (typeof document !== "undefined") {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }
    return null;
}

/** `#rrggbb` or `#rrggbbaa` as four bytes. */
export function rgba(colour: string): [number, number, number, number] {
    const hex = colour.slice(1);
    const byte = (at: number): number => parseInt(hex.slice(at, at + 2), 16);
    return [byte(0), byte(2), byte(4), hex.length >= 8 ? byte(6) : 255];
}

/** How far along a flame, from its root, its hot core reaches. */
const CORE_REACH = 0.55;
/** How wide a flame's hot core is, as a share of the flame's width where it is. */
const CORE_WIDTH = 0.45;
/** How bright a flame's edge is beside its core, which is the sprite's brightest. */
const EDGE_SHARE = 0.8;
const flames = new Map<string, Image | null>();

/**
 * A flame, root at the right, tip at the left: a triangle fading to nothing
 * along its length and softly out to its sides, its colour running from
 * `edge` to `core` towards the hot middle of its root. One image stretched
 * over every plume, so each is a single quad. Colours as `"r, g, b"`.
 */
export function flameSprite(edge: string, core: string): Image | null {
    const key = `${edge}|${core}`;
    let made = flames.get(key);
    if (made === undefined) {
        made = makeFlame(edge, core);
        flames.set(key, made);
    }
    return made;
}

function makeFlame(edge: string, core: string): Image | null {
    const canvas = blankCanvas(ALONG, ACROSS);
    const ctx = canvas?.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (canvas === null || ctx === null || ctx === undefined) return null;
    const [er, eg, eb] = edge.split(",").map(Number) as [number, number, number];
    const [cr, cg, cb] = core.split(",").map(Number) as [number, number, number];
    const image = ctx.createImageData(ALONG, ACROSS);
    for (let y = 0; y < ACROSS; y++) {
        for (let x = 0; x < ALONG; x++) {
            // From the root, and across as a share of the flame's half-width there.
            const u = 1 - (x + 0.5) / ALONG;
            const w = Math.abs(2 * ((y + 0.5) / ACROSS) - 1) / (1 - u);
            const side = Math.max(0, 1 - w ** 4);
            const heat = Math.max(0, 1 - u / CORE_REACH) * Math.max(0, 1 - (w / CORE_WIDTH) ** 2);
            const i = 4 * (y * ALONG + x);
            image.data[i] = Math.round(er + (cr - er) * heat);
            image.data[i + 1] = Math.round(eg + (cg - eg) * heat);
            image.data[i + 2] = Math.round(eb + (cb - eb) * heat);
            image.data[i + 3] = Math.round(255 * (1 - u) * side * (EDGE_SHARE + (1 - EDGE_SHARE) * heat));
        }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
}

/** Steps a muzzle flash's growth is rounded to, so there are few to make. */
export const WEDGE_STEPS = 8;
/**
 * How much brighter than white a wedge's middle is: its discs overlap to more
 * than white there, which the sprite keeps by holding a share of it and being
 * drawn as many times over, so a fading flash stays white-hot in the middle.
 */
export const WEDGE_HEADROOM = 2;
/** Most discs a wedge is made of. */
const WEDGE_DISCS = 32;
const wedges = new Map<string, Image | null>();

/**
 * A muzzle flash's core at growth step `step` of `WEDGE_STEPS`, along x from
 * its back to its front, over the box `wedgeBox` gives: soft discs from its
 * narrow back to its wide front, brightest at the back, overlapping into one
 * shape with a round front. Its shape is the same at every size, so it is made
 * once per step and stretched.
 */
export function wedgeSprite(colour: string, step: number): Image | null {
    const key = `${colour}|${step}`;
    let made = wedges.get(key);
    if (made === undefined) {
        made = makeWedge(colour, step);
        wedges.set(key, made);
    }
    return made;
}

/** The box a wedge sprite covers, along and across, for a flash of `radius` at growth step `step`. */
export function wedgeBox(radius: number, step: number): { from: number; to: number; half: number } {
    const w = muzzleWedge(radius, (step / WEDGE_STEPS) ** 2, 1);
    return { from: w.back - w.backWidth, to: w.front + w.frontWidth, half: w.frontWidth };
}

function makeWedge(colour: string, step: number): Image | null {
    const canvas = blankCanvas(ALONG, ACROSS);
    const ctx = canvas?.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (canvas === null || ctx === null || ctx === undefined) return null;
    const [r, g, b, a] = rgba(colour);
    const w = muzzleWedge(1, (step / WEDGE_STEPS) ** 2, 1);
    const box = wedgeBox(1, step);
    const span = w.front - w.back;
    const n = Math.min(WEDGE_DISCS, Math.max(2, Math.ceil(span / (w.backWidth * 0.5)) + 1));
    const spacing = span / (n - 1);
    const image = ctx.createImageData(ALONG, ACROSS);
    for (let y = 0; y < ACROSS; y++) {
        for (let x = 0; x < ALONG; x++) {
            const px = box.from + ((x + 0.5) / ALONG) * (box.to - box.from);
            const py = (2 * ((y + 0.5) / ACROSS) - 1) * box.half;
            let sum = 0;
            for (let k = 0; k < n; k++) {
                const u = k / (n - 1);
                const radius = w.backWidth + u * (w.frontWidth - w.backWidth);
                const share = Math.min(1, (2.5 * spacing) / radius) * (1 - 0.5 * u);
                const dx = px - (w.back + u * span);
                sum += share * falloff(Math.sqrt(dx * dx + py * py) / radius);
            }
            const i = 4 * (y * ALONG + x);
            image.data[i] = r;
            image.data[i + 1] = g;
            image.data[i + 2] = b;
            image.data[i + 3] = Math.round(a * Math.min(1, (0.9 * sum) / WEDGE_HEADROOM));
        }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
}

const cones = new Map<string, Image | null>();

/**
 * A flame's glow: a flame's shape blurred, brightest at its root at the left
 * and narrowing and fading to nothing at its tip at the right. Its root is a
 * halo's middle across, so a "cap" laid behind it closes it without a seam.
 */
export function coneSprite(colour: string): Image | null {
    let made = cones.get(colour);
    if (made === undefined) {
        made = makeCone(colour);
        cones.set(colour, made);
    }
    return made;
}

/** How much narrower a flame's glow is at its tip than at its root. */
const CONE_NARROWING = 0.85;

function makeCone(colour: string): Image | null {
    const canvas = blankCanvas(ALONG, ACROSS);
    const ctx = canvas?.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (canvas === null || ctx === null || ctx === undefined) return null;
    const [r, g, b, a] = rgba(colour);
    const image = ctx.createImageData(ALONG, ACROSS);
    for (let y = 0; y < ACROSS; y++) {
        for (let x = 0; x < ALONG; x++) {
            const t = (x + 0.5) / ALONG;
            const across = Math.abs(2 * ((y + 0.5) / ACROSS) - 1);
            const i = 4 * (y * ALONG + x);
            image.data[i] = r;
            image.data[i + 1] = g;
            image.data[i + 2] = b;
            image.data[i + 3] = Math.round(a * (1 - t) ** 1.5 * falloff(across / (1 - CONE_NARROWING * t)));
        }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
}
