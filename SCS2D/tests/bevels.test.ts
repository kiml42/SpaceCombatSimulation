import { describe, expect, it } from "vitest";
import { compileBlueprint, originOf, subDesign, type Blueprint } from "../sim/index.js";
import { bevelsOf } from "../render/bevels.js";

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
    for (let k = 0; k < edges.length; k += 6) total += Math.hypot(edges[k + 2]! - edges[k]!, edges[k + 3]! - edges[k + 1]!);
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
        for (let k = 0; k < middle.length; k += 6) expect(Math.abs(middle[k + 4]!)).toBeLessThan(1e-9);
    });

    it("keeps a cut-off piece's edges as built, rather than bevelling where it broke", () => {
        const piece = subDesign(row, [at(0)]);
        const origin = originOf(piece, 0);
        expect(origin.design).toBe(row);
        expect(bevelled(bevelsOf(origin.design, origin.module))).toBeCloseTo(8, 6);
    });
});
