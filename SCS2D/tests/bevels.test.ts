import { describe, expect, it } from "vitest";
import { compileBlueprint, originOf, subDesign, type Blueprint } from "../sim/index.js";
import { BEVEL_STRIDE, bevelsOf } from "../render/bevels.js";

/** Three boxes in a row along x, each 4 by 4. */
const ROW: Blueprint = {
    name: "Row",
    modules: [
        { kind: "structure", x: -4, y: 0, length: 4, width: 4 },
        { kind: "core", x: 0, y: 0, length: 4, width: 4 },
        { kind: "structure", x: 4, y: 0, length: 4, width: 4 },
    ],
};

/** How long bevelled edges are in all, metres. */
const bevelled = (edges: readonly number[]): number => {
    let total = 0;
    for (let k = 0; k < edges.length; k += BEVEL_STRIDE) total += Math.hypot(edges[k + 2]! - edges[k]!, edges[k + 3]! - edges[k + 1]!);
    return total;
};

describe("bevels", () => {
    const row = compileBlueprint(ROW);
    const at = (x: number): number => row.modules.findIndex((m) => Math.abs(m.x - row.modules[1]!.x - x) < 1e-6);

    it("bevels a module's edges on the outline, not those it shares with a neighbour", () => {
        // The ends each show three sides, the middle its top and bottom.
        expect(bevelled(bevelsOf(row, at(-4)))).toBeCloseTo(12, 6);
        expect(bevelled(bevelsOf(row, at(0)))).toBeCloseTo(8, 6);
        expect(bevelled(bevelsOf(row, at(4)))).toBeCloseTo(12, 6);
        // Every bevel faces out of the hull: none faces along the row from the middle.
        const middle = bevelsOf(row, at(0));
        for (let k = 0; k < middle.length; k += BEVEL_STRIDE) expect(Math.abs(middle[k + 4]!)).toBeLessThan(1e-9);
        // Each 4 m box reaches 4 m in from any of its edges.
        for (let k = 0; k < middle.length; k += BEVEL_STRIDE) expect(middle[k + 6]).toBeCloseTo(4, 9);
    });

    it("knows how far a thin plate reaches in from each edge: its length from its short ends", () => {
        // A plate 8 long and 1 wide, its long sides against a box either side.
        const strip = compileBlueprint({
            name: "Strip",
            modules: [
                { kind: "structure", x: 0, y: 1, length: 8, width: 1 },
                { kind: "core", x: 0, y: -1, length: 8, width: 3 },
                { kind: "structure", x: 0, y: 3, length: 8, width: 3 },
            ],
        });
        const plate = strip.modules.findIndex((m) => m.spec.width === 1);
        const edges = bevelsOf(strip, plate);
        // Only its two short ends are open, each reaching 8 m in.
        expect(edges.length / BEVEL_STRIDE).toBe(2);
        for (let k = 0; k < edges.length; k += BEVEL_STRIDE) expect(edges[k + 6]).toBeCloseTo(8, 6);
    });

    it("keeps a cut-off piece's edges as built, rather than bevelling where it broke", () => {
        const piece = subDesign(row, [at(0)]);
        const origin = originOf(piece, 0);
        expect(origin.design).toBe(row);
        expect(bevelled(bevelsOf(origin.design, origin.module))).toBeCloseTo(8, 6);
    });
});
