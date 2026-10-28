import { describe, expect, it } from "vitest";
import { Snapshot } from "../sim/index.js";
import { gridSegments, ringSegments, Segments, wellSegments } from "../render/backdrop.js";
import { gridStep, type Camera } from "../render/camera.js";
import { rgb } from "../render/webgl.js";

describe("backdrop", () => {
    it("lays grid lines a grid step apart across the whole view, relative to the camera", () => {
        const camera: Camera = { x: 12_345, y: -678, scale: 0.5 };
        const out = new Segments();
        gridSegments(out, camera, 800, 600);
        const step = gridStep(camera.scale);
        const halfW = 800 / 2 / camera.scale;
        const halfH = 600 / 2 / camera.scale;
        const xs: number[] = [];
        for (let i = 0; i < out.count; i++) {
            const [x0, y0, x1, y1] = out.data.subarray(i * 4, i * 4 + 4);
            if (x0 === x1) {
                xs.push(x0! + camera.x);
                expect(y0).toBeLessThanOrEqual(-halfH);
                expect(y1).toBeGreaterThanOrEqual(halfH - 1e-3);
            }
        }
        expect(xs[0]!).toBeLessThanOrEqual(camera.x - halfW);
        expect(xs.at(-1)!).toBeGreaterThan(camera.x + halfW - step);
        for (const x of xs) expect(Math.abs(x / step - Math.round(x / step))).toBeLessThan(1e-3);
    });

    it("draws each well as two closed rings at the pulls they mark, and a cross", () => {
        const snapshot = new Snapshot();
        snapshot.wells = [{ x: 100, y: 200, gm: 4e6 }];
        const camera: Camera = { x: 0, y: 0, scale: 0.2 };
        const out = new Segments();
        wellSegments(out, snapshot, camera);
        const inner = ringSegments(Math.sqrt(4e6) * camera.scale);
        const outer = ringSegments(Math.sqrt(4e7) * camera.scale);
        expect(out.count).toBe(inner + outer + 2);
        for (let i = 0; i < inner; i++) {
            const x = out.data[i * 4]! - 100;
            const y = out.data[i * 4 + 1]! - 200;
            expect(Math.hypot(x, y)).toBeCloseTo(2000, 0);
        }
        // Each ring ends where it began.
        expect(out.data[(inner - 1) * 4 + 2]).toBeCloseTo(out.data[0]!, 1);
        expect(out.data[(inner - 1) * 4 + 3]).toBeCloseTo(out.data[1]!, 1);
    });

    it("grows to hold as many segments as it is given", () => {
        const out = new Segments();
        for (let i = 0; i < 5000; i++) out.add(i, i, i, i);
        expect(out.count).toBe(5000);
        expect(out.data[4999 * 4]).toBe(4999);
        out.clear();
        expect(out.count).toBe(0);
    });

    it("reads a hex colour as channels", () => {
        expect(rgb("#ff8000")).toEqual([1, 128 / 255, 0]);
    });
});
