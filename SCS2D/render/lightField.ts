import type { Lights } from "./glows.js";
import { rgba } from "./sprites.js";

/**
 * The dynamic lights asked of a point rather than drawn: how much light falls
 * on whatever is there, as the light buffer (`render/lightBuffer.ts`) holds it
 * for the hull, worked out from the list of sources itself. For what is not
 * in the hull layer and is lit a piece at a time: fighters, leaking vapour and
 * bits of metal. Kept in world metres, so it can be asked of a later frame
 * than the one whose lights it holds. DOM-free, so it is unit-tested.
 *
 * **A light stands above what it lights**, its layer's height and then
 * two-fifths of its glow's radius, and what it lights faces up. So it lights a surface by
 * how far it is from it, in three dimensions, and by how squarely it shines
 * down on it: a fighter's plume lights the hull under it well, and the other
 * fighters level with it hardly at all, its light only grazing their tops.
 * The light buffer's shader works the same out on the GPU (`lightBuffer.ts`).
 */

/**
 * How much further a light at full brightness reaches over a surface than its
 * glow does round it: a glow is the halo seen in the light's own
 * neighbourhood, and the hull beside an engine is lit well past it.
 */
export const LIGHT_REACH = 9;
/** The brightest a light is taken to be in how far it reaches: sixteen times as bright as its glow at full, reaching four times as far. */
export const LIGHT_BRIGHTEST = 16;

/**
 * How many times further than its glow a light of `brightness` reaches over a
 * surface: further the brighter it is, as the square root, since light thins
 * as the square of the distance it has come.
 */
export function lightReach(brightness: number): number {
    return LIGHT_REACH * Math.sqrt(Math.min(LIGHT_BRIGHTEST, Math.max(0, brightness)));
}
/**
 * How many times brighter than white the buffer can hold light before it is
 * clipped: lights are drawn into it at this share and scaled back after, so
 * where several overlap their sum still falls off rather than being cut flat.
 */
export const LIGHT_HEADROOM = 4;
/** How strongly a surface is lit by a light as bright as the buffer holds, as a share of its own colour. */
export const LIGHT_GAIN = 1.5;
/** How far behind its root a cone's glow starts, in its radii, as `render/glows.ts` draws it. */
const CONE_BEHIND = 0.4;
/** How much narrower a cone is at its tip than at its root, as `render/sprites.ts` draws it. */
const CONE_NARROWING = 0.85;

/** A camera as the lights were seen through: the middle of the view, and pixels to the metre. */
export interface Seen {
    x: number;
    y: number;
    scale: number;
}

export class LightField {
    count = 0;
    private x0: number[] = [];
    private y0: number[] = [];
    private x1: number[] = [];
    private y1: number[] = [];
    /** How far it reaches, metres. */
    private reach: number[] = [];
    /** How high it stands above the deck, metres. */
    private z: number[] = [];
    private brightness: number[] = [];
    private cone: boolean[] = [];
    /** Its colour, each channel 0 to 1. */
    private r: number[] = [];
    private g: number[] = [];
    private b: number[] = [];

    /** Take on `lights`, in the canvas pixels of a view `widthPx` by `heightPx` through `camera`. */
    set(lights: Lights, camera: Seen, widthPx: number, heightPx: number): void {
        this.count = 0;
        const toX = (px: number): number => camera.x + (px - widthPx / 2) / camera.scale;
        const toY = (py: number): number => camera.y - (py - heightPx / 2) / camera.scale;
        for (let k = 0; k < lights.count; k++) {
            // A glow that lights nothing round it, as a muzzle flash's wedge.
            if (lights.lightless[k] === 1) continue;
            const i = this.count++;
            let x0 = lights.x0[k]!;
            let y0 = lights.y0[k]!;
            let x1 = lights.x1[k]!;
            let y1 = lights.y1[k]!;
            const cone = lights.cone[k] === 1;
            // Under a pixel long, a line is a point at its middle, as its glow is drawn.
            if ((x1 - x0) ** 2 + (y1 - y0) ** 2 < 1) {
                x0 = x1 = (x0 + x1) / 2;
                y0 = y1 = (y0 + y1) / 2;
            }
            this.x0[i] = toX(x0);
            this.y0[i] = toY(y0);
            this.x1[i] = toX(x1);
            this.y1[i] = toY(y1);
            this.reach[i] = (lights.radius[k]! * lightReach(lights.brightness[k]!)) / camera.scale;
            this.z[i] = lightHeight(lights.height[k]!, lights.radius[k]!) / camera.scale;
            // As the buffer takes it: no brighter than its glow can be drawn, at its headroom's share.
            this.brightness[i] = Math.min(LIGHT_HEADROOM, lights.brightness[k]!);
            this.cone[i] = cone && (x1 !== x0 || y1 !== y0);
            const [r, g, b] = rgba(lights.colour[k]!);
            this.r[i] = r / 255;
            this.g[i] = g / 255;
            this.b[i] = b / 255;
        }
    }

    clear(): void {
        this.count = 0;
    }

    /**
     * The light on a surface facing up at `(x, y)` in the world, `surface`
     * metres above the deck, each channel 0 to 1, into `out`; false where
     * there is none.
     */
    at(x: number, y: number, out: { r: number; g: number; b: number }, surface = 0): boolean {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let k = 0; k < this.count; k++) {
            const reach = this.reach[k]!;
            const x0 = this.x0[k]!;
            const y0 = this.y0[k]!;
            const x1 = this.x1[k]!;
            const y1 = this.y1[k]!;
            if (x < Math.min(x0, x1) - reach || x > Math.max(x0, x1) + reach) continue;
            if (y < Math.min(y0, y1) - reach || y > Math.max(y0, y1) + reach) continue;
            const rise = this.z[k]! - surface;
            if (!(rise > 0)) continue;
            const strength = this.brightness[k]! * shine(x - x0, y - y0, x1 - x0, y1 - y0, reach, this.cone[k]!, rise);
            if (strength <= 0) continue;
            r += this.r[k]! * strength;
            g += this.g[k]! * strength;
            b += this.b[k]! * strength;
        }
        // As the buffer holds it, clipped at its headroom, and eased towards full as the filter does.
        out.r = eased(r);
        out.g = eased(g);
        out.b = eased(b);
        return r + g + b > 0;
    }
}

/**
 * How far above its layer a light stands, as a share of its glow's radius:
 * the flame or flash inside it, its glow being the halo round it, far wider.
 * Low, so a light shines across what is level with it rather than down on it.
 */
export const LIGHT_RISE = 0.4;

/** How high a light stands above the deck: its layer's `height`, and then a share of its glow's `radius`. In whatever units both are in. */
export function lightHeight(height: number, radius: number): number {
    return height + radius * LIGHT_RISE;
}

/**
 * How much of a light reaches `(dx, dy)` from its first end, the light running
 * `(lx, ly)` to its second and standing `rise` above the surface there: a
 * halo round a point, a capsule round a line, and for a cone, bright at its
 * root and narrowing and fading to its tip. Each in three dimensions, the
 * height counting as distance, and times how squarely the nearest of the light
 * shines down on a surface facing up.
 */
export function shine(dx: number, dy: number, lx: number, ly: number, reach: number, cone: boolean, rise: number): number {
    const length2 = lx * lx + ly * ly;
    const t = length2 > 0 ? (dx * lx + dy * ly) / length2 : 0;
    // The nearest of the light, and how squarely it shines down from there.
    const u = Math.min(1, Math.max(0, t));
    const distance = Math.sqrt((dx - lx * u) ** 2 + (dy - ly * u) ** 2 + rise * rise);
    const down = distance > 0 ? rise / distance : 1;
    if (!cone) return falloff(distance / reach) * down;
    const length = Math.sqrt(length2);
    const across = Math.sqrt(((dx * ly - dy * lx) / length) ** 2 + rise * rise) / reach;
    // Behind its root, a cap a share of its reach deep.
    if (t < 0) return falloff(Math.sqrt(((-t * length) / (reach * CONE_BEHIND)) ** 2 + across * across)) * down;
    if (t >= 1) return 0;
    return (1 - t) ** 1.5 * falloff(across / (1 - CONE_NARROWING * t)) * down;
}

/** How bright light of `sum` lights a surface, as the filter has it: nothing to full, never quite reached. */
function eased(sum: number): number {
    return 1 - Math.exp(-Math.min(LIGHT_HEADROOM, sum));
}

/** Full at the middle, nothing at the edge, softly, as a glow's sprite. */
function falloff(r: number): number {
    if (r >= 1) return 0;
    const left = 1 - r * r;
    return left * left;
}
