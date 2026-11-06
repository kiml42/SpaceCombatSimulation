import { coneSprite, sprite } from "./sprites.js";

/**
 * What gives off light this frame, and the glow each is seen by: points
 * (flashes, bursts, beams' emitters), lines (beams, muzzle flashes, burns on
 * a hull) and cones (plumes, brightest at the nozzle and narrowing to the tip).
 * Filled while a scene is drawn and drawn as one additive pass at its end, so a
 * glow brightens whatever is under it, whichever pass that came from.
 *
 * Kept in canvas pixels rather than metres, as the frame is drawn: a source is
 * recorded under whatever transform its pass was drawing in, which is what lets
 * a burn worked out in its engine's frame go on the list as it is.
 *
 * What a source is, not how it looks up close: a flash's hot core, a beam's
 * line and a flame are drawn by their own passes, and this is only the light
 * round them.
 */
export class Lights {
    count = 0;
    /** Ends, canvas pixels; a point's are the same. */
    x0 = new Float64Array(64);
    y0 = new Float64Array(64);
    x1 = new Float64Array(64);
    y1 = new Float64Array(64);
    /** How far the glow reaches from the point or line, canvas pixels. */
    radius = new Float64Array(64);
    /** How bright, as the glow's opacity at its middle. */
    brightness = new Float64Array(64);
    /** Whether each is a cone, from its first end out to its second, rather than a point or a line. */
    cone = new Uint8Array(64);
    /**
     * Whether each lights what is near it without a glow of its own: light
     * thrown back along a gun's barrel by its muzzle flash, say, which would
     * look like the barrel glowing if it were seen.
     */
    unseen = new Uint8Array(64);
    /**
     * Whether each is a glow that lights nothing round it: a muzzle flash's
     * wedge, whose light comes from a point at the muzzle instead.
     */
    lightless = new Uint8Array(64);
    /**
     * How high above the deck its layer is, canvas pixels: nothing for what is
     * on a capital ship's hull, a turret's height for its guns and beams, a
     * fighter's for what a flying fighter gives off. The light itself stands a
     * little above that (`lightHeight`).
     */
    height = new Float64Array(64);
    colour: string[] = [];

    clear(): void {
        this.count = 0;
    }

    /** Take on all of `from`'s lights as well, as they are. */
    add(from: Lights): void {
        for (let k = 0; k < from.count; k++) {
            if (this.count === this.x0.length) this.grow();
            const i = this.count++;
            this.x0[i] = from.x0[k]!;
            this.y0[i] = from.y0[k]!;
            this.x1[i] = from.x1[k]!;
            this.y1[i] = from.y1[k]!;
            this.radius[i] = from.radius[k]!;
            this.brightness[i] = from.brightness[k]!;
            this.cone[i] = from.cone[k]!;
            this.unseen[i] = from.unseen[k]!;
            this.lightless[i] = from.lightless[k]!;
            this.height[i] = from.height[k]!;
            this.colour[i] = from.colour[k]!;
        }
    }

    /**
     * A light at `(x, y)` reaching `radius` out, both in the frame `m` maps to
     * canvas pixels, as a context's transform does, its layer `height` above the deck.
     */
    point(m: Transform, x: number, y: number, radius: number, colour: string, brightness: number, height = 0): void {
        this.line(m, x, y, x, y, radius, colour, brightness, false, false, false, height);
    }

    /** A light along `(x0, y0)`–`(x1, y1)`, reaching `radius` out to either side and past either end, its layer `height` above the deck. */
    line(
        m: Transform,
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        radius: number,
        colour: string,
        brightness: number,
        cone = false,
        unseen = false,
        lightless = false,
        height = 0,
    ): void {
        if (!(brightness > 0) || !(radius > 0)) return;
        if (this.count === this.x0.length) this.grow();
        const k = this.count++;
        this.x0[k] = m.a * x0 + m.c * y0 + m.e;
        this.y0[k] = m.b * x0 + m.d * y0 + m.f;
        this.x1[k] = m.a * x1 + m.c * y1 + m.e;
        this.y1[k] = m.b * x1 + m.d * y1 + m.f;
        const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
        this.radius[k] = radius * scale;
        this.height[k] = height * scale;
        this.brightness[k] = brightness;
        this.cone[k] = cone ? 1 : 0;
        this.unseen[k] = unseen ? 1 : 0;
        this.lightless[k] = lightless ? 1 : 0;
        this.colour[k] = colour;
    }

    /** A light from `(x0, y0)`, `radius` either side of it, narrowing and fading out to `(x1, y1)`: a flame's glow. */
    coneOf(
        m: Transform,
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        radius: number,
        colour: string,
        brightness: number,
        height = 0,
    ): void {
        this.line(m, x0, y0, x1, y1, radius, colour, brightness, true, false, false, height);
    }

    private grow(): void {
        const more = (a: Float64Array): Float64Array<ArrayBuffer> => {
            const b = new Float64Array(a.length * 2);
            b.set(a);
            return b;
        };
        this.x0 = more(this.x0);
        this.y0 = more(this.y0);
        this.x1 = more(this.x1);
        this.y1 = more(this.y1);
        this.radius = more(this.radius);
        this.brightness = more(this.brightness);
        this.height = more(this.height);
        const cone = new Uint8Array(this.cone.length * 2);
        cone.set(this.cone);
        this.cone = cone;
        const unseen = new Uint8Array(this.unseen.length * 2);
        unseen.set(this.unseen);
        this.unseen = unseen;
        const lightless = new Uint8Array(this.lightless.length * 2);
        lightless.set(this.lightless);
        this.lightless = lightless;
    }
}

/** How far behind its root a cone's glow starts, in its radii. */
const CONE_BEHIND = 0.4;

/** A 2D affine transform, as `getTransform` returns one. */
export interface Transform {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
}

/**
 * Every light's glow: a halo for a point, a capsule for a line — a band along
 * it capped with a halo's halves, so the two meet without a seam. Additive, and
 * drawn in canvas pixels, so it leaves the context's transform at the identity.
 */
export function drawGlows(ctx: CanvasRenderingContext2D, lights: Lights): void {
    if (lights.count === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < lights.count; k++) {
        if (lights.unseen[k] === 1) continue;
        const colour = lights.colour[k]!;
        const r = lights.radius[k]!;
        const x0 = lights.x0[k]!;
        const y0 = lights.y0[k]!;
        const dx = lights.x1[k]! - x0;
        const dy = lights.y1[k]! - y0;
        const length = Math.sqrt(dx * dx + dy * dy);
        ctx.globalAlpha = Math.min(1, lights.brightness[k]!);
        // Under a pixel long, a line is a point.
        if (length < 1) {
            const halo = sprite("halo", colour);
            if (halo === null) continue;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(halo, x0 + dx / 2 - r, y0 + dy / 2 - r, 2 * r, 2 * r);
            continue;
        }
        if (lights.cone[k] === 1) {
            const image = coneSprite(colour);
            const cap = sprite("cap", colour);
            if (image === null || cap === null) continue;
            const c = dx / length;
            const s = dy / length;
            ctx.setTransform(c, s, -s, c, x0, y0);
            ctx.drawImage(image, 0, -r, length, 2 * r);
            // Wrapping a little way back round its root, round the nozzle it comes out of.
            ctx.setTransform(-c, -s, s, -c, x0, y0);
            ctx.drawImage(cap, 0, -r, r * CONE_BEHIND, 2 * r);
            continue;
        }
        const band = sprite("band", colour);
        const cap = sprite("cap", colour);
        if (band === null || cap === null) continue;
        // Along the line as x, from its start.
        const c = dx / length;
        const s = dy / length;
        ctx.setTransform(c, s, -s, c, x0, y0);
        ctx.drawImage(band, 0, -r, length, 2 * r);
        ctx.drawImage(cap, length, -r, r, 2 * r);
        ctx.setTransform(-c, -s, s, -c, x0, y0);
        ctx.drawImage(cap, 0, -r, r, 2 * r);
    }
    ctx.restore();
}
