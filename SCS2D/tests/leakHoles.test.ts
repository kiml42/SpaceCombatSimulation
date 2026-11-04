import { describe, expect, it } from "vitest";
import type { ShipView } from "../sim/index.js";
import { LEAK_SCRATCH_FADE } from "../sim/snapshot.js";
import { leakHoleShapes, scratchShows } from "../render/leakHoles.js";
import { HOLE, type ScarShape } from "../render/scars.js";

const BOX = { x0: -3, y0: -2, x1: 3, y1: 2 };

function shapes(width: number, shows: number): ScarShape[] {
    const out: ScarShape[] = [];
    // On the top face, leaking upwards.
    leakHoleShapes(0, 2, 0, 1, 0.2, width, shows, BOX, out);
    return out;
}

function extent(points: readonly number[]): number {
    let least = Infinity;
    let most = -Infinity;
    for (let v = 0; v < points.length; v += 2) {
        least = Math.min(least, points[v]!);
        most = Math.max(most, points[v]!);
    }
    return most - least;
}

describe("a leak's hole", () => {
    it("is drawn as wide as it is open, so it shrinks as it closes", () => {
        const wide = shapes(0.2, 1).find((s) => s.colour === HOLE)!;
        const narrow = shapes(0.05, 1).find((s) => s.colour === HOLE)!;
        expect(extent(narrow.points)).toBeLessThan(extent(wide.points) / 2);
        expect(shapes(0, 1).some((s) => s.colour === HOLE)).toBe(false);
    });

    it("has scratches reaching well past it, kept inside its module", () => {
        const all = shapes(0.2, 1);
        const hole = all.find((s) => s.colour === HOLE)!;
        expect(all.length).toBeGreaterThan(2);
        expect(Math.max(...all.map((s) => extent(s.points)))).toBeGreaterThan(2 * extent(hole.points));
        for (const s of all) for (let v = 1; v < s.points.length; v += 2) expect(s.points[v]!).toBeLessThanOrEqual(2);
    });

    it("keeps its scratches once sealed, and fades them once patched", () => {
        const view = (patched: number, age: number): ShipView => ({ leakPatched: [patched], leakAge: [age] }) as unknown as ShipView;
        expect(scratchShows(view(-1, 100), 0)).toBe(1);
        expect(scratchShows(view(10, 10 + LEAK_SCRATCH_FADE / 2), 0)).toBeCloseTo(0.5, 9);
        expect(scratchShows(view(10, 10 + LEAK_SCRATCH_FADE), 0)).toBe(0);
        expect(shapes(0, 0)).toHaveLength(0);
    });
});
