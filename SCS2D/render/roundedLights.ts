import type { Transform } from "./glows.js";

/**
 * Rounded parts as the dynamic lights light them (`render/litRounded.ts`):
 * bells, chambers, barrels and the like as tubes, the ends of chambers as
 * spheres, turrets' domes as flattened hemispheres. Each is the rectangle its
 * battle-light shading is laid over, in canvas pixels, with where each corner
 * is on the shape, so its shader can tell which way each point of it faces.
 * Filled while the main view is drawn; DOM-free, so it is unit-tested.
 */

/** What shape a part is. */
export const TUBE = 0;
export const SPHERE = 1;
export const DOME = 2;

/** Floats a vertex takes: where it is, where on the shape, its frame's two axes, its shape and taper, its colour, and how much of the light from above it already has. */
export const ROUNDED_VERTEX = 14;

/** Which of the light buffer's surfaces a part is lit as: the deck, halfway up the hull, or a thick module's top. */
export type Level = "deck" | "middle" | "thick";

export class RoundedParts {
    /** Parts lit as the deck is: capital ships' engines and ports. */
    readonly deck: number[] = [];
    /** Parts lit halfway up the hull: capital ships' turrets' domes and barrels. */
    readonly middle: number[] = [];
    /** Parts lit as a thick module's top is, the nearest to a fighter's height: everything a fighter has. */
    readonly thick: number[] = [];

    clear(): void {
        this.deck.length = 0;
        this.middle.length = 0;
        this.thick.length = 0;
    }

    /**
     * A tube lying along x in the frame `m` maps to canvas pixels, from `x` for
     * `length`, `halfWidth` either side of `y` at its start and `taper` as much
     * at its end, in `colour`. `flat` is how much of the light from above it
     * already takes, as a part laid over a lit fill does; `level`, which
     * height it is lit at.
     */
    tube(
        m: Transform,
        x: number,
        y: number,
        length: number,
        halfWidth: number,
        taper: number,
        colour: readonly number[],
        flat: number,
        level: Level,
    ): void {
        this.quad(m, x, y - halfWidth, length, 2 * halfWidth, [0, -1, 1, -1, 1, 1, 0, 1], TUBE, taper, colour, flat, level);
    }

    /**
     * A sphere `radius` round `(cx, cy)` in the frame `m` maps to canvas
     * pixels, cut flat across x at `from` and `to`: a chamber's end.
     */
    sphere(
        m: Transform,
        cx: number,
        cy: number,
        radius: number,
        from: number,
        to: number,
        colour: readonly number[],
        flat: number,
        level: Level,
    ): void {
        if (!(radius > 0) || !(to > from)) return;
        const u0 = (from - cx) / radius;
        const u1 = (to - cx) / radius;
        this.quad(m, from, cy - radius, to - from, 2 * radius, [u0, -1, u1, -1, u1, 1, u0, 1], SPHERE, 1, colour, flat, level);
    }

    /** A dome `radius` round `(cx, cy)` in the frame `m` maps to canvas pixels: a turret's. */
    dome(m: Transform, cx: number, cy: number, radius: number, colour: readonly number[], flat: number, level: Level): void {
        if (!(radius > 0)) return;
        this.quad(m, cx - radius, cy - radius, 2 * radius, 2 * radius, [-1, -1, 1, -1, 1, 1, -1, 1], DOME, 1, colour, flat, level);
    }

    /** The rectangle from `(x, y)`, `w` along x and `h` along y, its corners at `local` on its shape, anticlockwise from `(x, y)`. */
    private quad(
        m: Transform,
        x: number,
        y: number,
        w: number,
        h: number,
        local: readonly number[],
        shape: number,
        taper: number,
        colour: readonly number[],
        flat: number,
        level: Level,
    ): void {
        if (!(w > 0) || !(h > 0)) return;
        const out = this[level];
        // Its frame's axes on the canvas: which way along and across it each point faces is told from these.
        const along = Math.hypot(m.a, m.b) || 1;
        const across = Math.hypot(m.c, m.d) || 1;
        const corners = [x, y, x + w, y, x + w, y + h, x, y + h];
        for (let v = 0; v < 4; v++) {
            const px = corners[2 * v]!;
            const py = corners[2 * v + 1]!;
            out.push(
                m.a * px + m.c * py + m.e,
                m.b * px + m.d * py + m.f,
                local[2 * v]!,
                local[2 * v + 1]!,
                m.a / along,
                m.b / along,
                m.c / across,
                m.d / across,
                shape,
                taper,
                colour[0]! / 255,
                colour[1]! / 255,
                colour[2]! / 255,
                flat,
            );
        }
    }
}
