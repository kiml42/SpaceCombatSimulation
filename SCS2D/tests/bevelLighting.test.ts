import { describe, expect, it } from "vitest";
import { BEVEL_QUAD_STRIDE, bevelGain, pushLitBevel } from "../render/bevelLighting.js";

const gain = (light: number[], tx: number, ty: number, nx: number, ny: number): number[] => {
    const out = [0, 0, 0];
    bevelGain(light, tx, ty, nx, ny, 4, out);
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
        expect(b).toBe(0);
    });

    it("is laid out as its corners, its normal and its colour", () => {
        const out: number[] = [];
        pushLitBevel(out, [0, 0, 1, 0, 1, 1, 0, 1], 0, 1, [255, 0, 51]);
        expect(out.length).toBe(BEVEL_QUAD_STRIDE);
        expect(out.slice(8)).toEqual([0, 1, 1, 0, 0.2]);
    });
});
