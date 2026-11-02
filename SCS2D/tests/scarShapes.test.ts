import { describe, expect, it } from "vitest";
import { SCAR_BURN, SCAR_GOUGE, SCAR_PEPPER, SCAR_ROUND, type ModuleSpec } from "../sim/index.js";
import { scarShapes, scarWidth, type ScarShape } from "../render/scars.js";

const spec = { kind: "structure", length: 8, width: 4 } as ModuleSpec;
const bounds = { x0: -4, y0: -2, x1: 4, y1: 2 };

/** One scar's view numbers: module, slot, kind, ends, direction, energy, through. */
function scar(kind: number, energy: number, through = 0, ax = 0, bx = 0): number[] {
    return [3, 1, kind, ax, 0, bx, 0, 1, 0, energy, through];
}

function shapes(view: number[]): ScarShape[] {
    const out: ScarShape[] = [];
    scarShapes(view, 0, spec, bounds, out);
    return out;
}

describe("drawing scars", () => {
    it("draws a heavier hit wider, no wider than a share of its module", () => {
        expect(scarWidth(scar(SCAR_ROUND, 1e7), 0, spec)).toBeGreaterThan(scarWidth(scar(SCAR_ROUND, 1e5), 0, spec));
        expect(scarWidth(scar(SCAR_ROUND, 1e15), 0, spec)).toBeLessThanOrEqual(0.45 * 4);
    });

    it("keeps every kind inside its module", () => {
        for (const kind of [SCAR_ROUND, SCAR_PEPPER, SCAR_BURN, SCAR_GOUGE]) {
            for (const shape of shapes(scar(kind, 1e12, 1, -3.9, 3.9))) {
                for (let v = 0; v < shape.points.length; v += 2) {
                    expect(Math.abs(shape.points[v]!)).toBeLessThanOrEqual(4);
                    expect(Math.abs(shape.points[v + 1]!)).toBeLessThanOrEqual(2);
                }
            }
        }
    });

    it("ends a round that went through in a hole, and one that did not in a lip", () => {
        const through = shapes(scar(SCAR_ROUND, 1e7, 1, -1, 1));
        const stopped = shapes(scar(SCAR_ROUND, 1e7, 0, -1, 1));
        expect(through).toHaveLength(2);
        expect(stopped).toHaveLength(2);
        expect(through[1]!.colour).not.toBe(stopped[1]!.colour);
    });

    it("draws the same scar the same way every time", () => {
        expect(shapes(scar(SCAR_PEPPER, 1e7))).toEqual(shapes(scar(SCAR_PEPPER, 1e7)));
    });
});
