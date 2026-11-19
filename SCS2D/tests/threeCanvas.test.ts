import { describe, expect, it } from "vitest";
import { strokeLine, ThreeCanvas, triangulate } from "../render/three/threeCanvas.js";

const area = (points: number[]): number => {
    let sum = 0;
    for (let k = 0; k + 5 < points.length; k += 6) {
        const [ax, ay, bx, by, cx, cy] = points.slice(k, k + 6) as [number, number, number, number, number, number];
        sum += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
    }
    return sum;
};

describe("ThreeCanvas geometry", () => {
    it("triangulates a concave polygon to its area", () => {
        const out: number[] = [];
        // An arrowhead, as a ship's icon is.
        triangulate([10, 0, -10, 8, -5, 0, -10, -8], (x, y) => out.push(x, y));
        // The triangle 20 long and 16 across, less the notch 5 deep in its back.
        expect(area(out)).toBeCloseTo(160 - 40, 6);
    });

    it("strokes a closed square with no corner left without a direction", () => {
        const out: number[] = [];
        strokeLine([0, 0, 10, 0, 10, 10, 0, 10, 0, 0], true, 1, "butt", (x, y) => out.push(x, y));
        expect(out.every(Number.isFinite)).toBe(true);
        // Four sides 2 wide and 10 long, and four mitred corners a unit square each outside them.
        expect(area(out)).toBeCloseTo(4 * 20 + 4 * 1, 6);
    });

    it("lays fills in the order they are drawn, tinted", () => {
        const ctx = new ThreeCanvas();
        ctx.begin();
        ctx.fillStyle = "#ff0000";
        ctx.fillRect(0, 0, 10, 10);
        ctx.save();
        ctx.tinted(0x808080);
        ctx.globalCompositeOperation = "lighter";
        ctx.fillRect(0, 0, 10, 10);
        ctx.restore();
        ctx.end();
        expect(ctx.batches.length).toBe(2);
        expect(ctx.batches[0]!.additive).toBe(false);
        expect(ctx.batches[1]!.additive).toBe(true);
        expect(ctx.batches[1]!.col[0]).toBeCloseTo(128 / 255, 6);
    });
});
