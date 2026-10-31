import { describe, expect, it } from "vitest";
import { compileBlueprint, originOf, subDesign, type Blueprint } from "../sim/index.js";
import { rebuiltDesign } from "../sim/blueprint.js";
import { shellOf } from "../sim/rebuild.js";
import { bevelsOf, drawnBevels } from "../render/bevels.js";

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

    it("bevels a module going up by its walls so far, not the whole of it", () => {
        // The end box, its walls a third of the way up from one end.
        const m = at(4);
        const whole = row.modules[m]!;
        const share = 1 / 3;
        const part = shellOf(whole.spec, whole.stats, 0, share);
        const shelled = rebuiltDesign(row, m, part.spec, part.stats, originOf(row, m), { share, face: 0 });
        const spec = shelled.modules[m]!.spec;
        const edges = drawnBevels(shelled, m);
        expect(edges.length).toBeGreaterThan(0);
        // Every end in the shell's own box, in its own frame.
        for (let k = 0; k < edges.length; k += 6) {
            for (const [x, y] of [
                [edges[k]!, edges[k + 1]!],
                [edges[k + 2]!, edges[k + 3]!],
            ] as const) {
                expect(Math.abs(x)).toBeLessThanOrEqual(spec.length / 2 + 1e-6);
                expect(Math.abs(y)).toBeLessThanOrEqual(spec.width / 2 + 1e-6);
            }
        }
        // The whole module's would not have been.
        expect(bevelled(bevelsOf(row, m))).toBeGreaterThan(bevelled(edges));
    });
});
