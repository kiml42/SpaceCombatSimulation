import { describe, expect, it } from "vitest";
import { BEVEL_QUAD_STRIDE, bevelGain, pushLitBevel } from "../render/bevelLighting.js";

const gain = (light: number[], tx: number, ty: number, nx: number, ny: number): number[] => {
    const out = [0, 0, 0];
    bevelGain(light, [Math.max(tx, 0), Math.max(-tx, 0), Math.max(ty, 0), Math.max(-ty, 0)], nx, ny, 4, out);
    return out;
};

describe("a bevel lit by the dynamic lights", () => {
    it("takes more of a light it faces, and none of one it is turned from or side on to", () => {
        const white = [0.5, 0.5, 0.5];
        // Light coming from +x across the deck.
        expect(gain(white, 0.3, 0, 1, 0)[0]).toBeGreaterThan(0);
        expect(gain(white, 0.3, 0, -1, 0)).toEqual([0, 0, 0]);
        expect(gain(white, 0.3, 0, 0, 1)).toEqual([0, 0, 0]);
        // Squarer, more.
        expect(gain(white, 0.3, 0, 1, 0)[0]).toBeGreaterThan(gain(white, 0.3, 0, Math.SQRT1_2, Math.SQRT1_2)[0]);
    });

    it("between two lights, takes each on the side facing it, rather than their directions cancelling", () => {
        const white = [0.5, 0.5, 0.5];
        const out = [0, 0, 0];
        for (const nx of [1, -1]) {
            bevelGain(white, [0.3, 0.3, 0, 0], nx, 0, 4, out);
            expect(out[0]).toBeCloseTo(gain(white, 0.3, 0, 1, 0)[0]!, 12);
        }
    });

    it("takes more the more light comes from that side, easing towards full", () => {
        const white = [0.5, 0.5, 0.5];
        const some = gain(white, 0.1, 0, 1, 0)[0]!;
        const more = gain(white, 0.4, 0, 1, 0)[0]!;
        expect(more).toBeGreaterThan(some);
        expect(gain(white, 100, 0, 1, 0)[0]).toBeLessThanOrEqual(1);
    });

    it("takes it in the light's own colour", () => {
        const orange = [0.6, 0.3, 0];
        const [r, g, b] = gain(orange, 0.3, 0, 1, 0);
        expect(r).toBeGreaterThan(g!);
        // Nearly none of what the light has none of.
        expect(b).toBeLessThan(0.2 * r!);
    });

    it("takes light too faint to tell its colour from rounding as white, not as pure red or green", () => {
        // A few levels of an 8-bit buffer, all red, coming strongly from one side: as beside a light on the deck.
        const [r, g, b] = gain([2 / 255, 0, 0], 0.3, 0, 1, 0);
        expect(r).toBeGreaterThan(0);
        expect(g! / r!).toBeGreaterThan(0.6);
        expect(b! / r!).toBeGreaterThan(0.6);
    });

    it("is laid out as its corners, its normal and its colour", () => {
        const out: number[] = [];
        pushLitBevel(out, [0, 0, 1, 0, 1, 1, 0, 1], 0, 1, [255, 0, 51]);
        expect(out.length).toBe(BEVEL_QUAD_STRIDE);
        expect(out.slice(8)).toEqual([0, 1, 1, 0, 0.2]);
    });
});
