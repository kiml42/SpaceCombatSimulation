import { describe, expect, it } from "vitest";
import { DOME, ROUNDED_VERTEX, RoundedParts, SPHERE, TUBE } from "../render/roundedLights.js";

/** Two pixels to the metre, turned a quarter, and moved: as a part's frame might be on the canvas. */
const FRAME = { a: 0, b: 2, c: -2, d: 0, e: 100, f: 50 };
const at = (data: readonly number[], vertex: number, field: number): number => data[vertex * ROUNDED_VERTEX + field]!;

describe("rounded parts for the dynamic lights", () => {
    it("lays a tube's corners on the canvas, with where each is across it and its frame's axes made units", () => {
        const parts = new RoundedParts();
        parts.tube(FRAME, 0, 0, 3, 1, 0.5, [255, 0, 51], 1, false);
        expect(parts.deck.length).toBe(4 * ROUNDED_VERTEX);
        expect(parts.thick.length).toBe(0);
        // Its first corner, (0, -1) in its frame.
        expect([at(parts.deck, 0, 0), at(parts.deck, 0, 1)]).toEqual([102, 50]);
        // Along it from 0 to 1, and across it from -1 to 1.
        expect([at(parts.deck, 0, 2), at(parts.deck, 0, 3)]).toEqual([0, -1]);
        expect([at(parts.deck, 2, 2), at(parts.deck, 2, 3)]).toEqual([1, 1]);
        expect([at(parts.deck, 0, 4), at(parts.deck, 0, 5), at(parts.deck, 0, 6), at(parts.deck, 0, 7)]).toEqual([0, 1, -1, 0]);
        expect([at(parts.deck, 0, 8), at(parts.deck, 0, 9)]).toEqual([TUBE, 0.5]);
        expect([at(parts.deck, 0, 10), at(parts.deck, 0, 11), at(parts.deck, 0, 12), at(parts.deck, 0, 13)]).toEqual([1, 0, 0.2, 1]);
    });

    it("puts a sphere's cut ends where they are on it, in its radii from its centre", () => {
        const parts = new RoundedParts();
        parts.sphere(FRAME, 1, 0, 2, 0, 2, [0, 0, 0], 1, true);
        expect(parts.thick.length).toBe(4 * ROUNDED_VERTEX);
        expect(at(parts.thick, 0, 8)).toBe(SPHERE);
        expect(at(parts.thick, 0, 2)).toBeCloseTo(-0.5, 12);
        expect(at(parts.thick, 1, 2)).toBeCloseTo(0.5, 12);
    });

    it("keeps a dome where a turret stands, and nothing of no size", () => {
        const parts = new RoundedParts();
        parts.dome(FRAME, 0, 0, 1, [0, 0, 0], 0, true);
        parts.dome(FRAME, 0, 0, 0, [0, 0, 0], 0, true);
        parts.tube(FRAME, 0, 0, 0, 1, 1, [0, 0, 0], 0, true);
        expect(parts.thick.length).toBe(4 * ROUNDED_VERTEX);
        expect(at(parts.thick, 0, 8)).toBe(DOME);
        parts.clear();
        expect(parts.thick.length + parts.deck.length).toBe(0);
    });
});
