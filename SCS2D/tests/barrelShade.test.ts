import { describe, expect, it } from "vitest";
import { throughBox } from "../render/canvas2d.js";

describe("a hull mount's barrel against its block", () => {
    // A block 2 m long from its back at the origin, 2 m across, running along x.
    const block = { x: 0, y: 0, ax: 1, ay: 0, back: 0, front: 2, half: 1 };

    it("is in the block from its root to the block's face", () => {
        // From the middle of the block, 4 m out along x: in it for the first quarter.
        expect(throughBox(block, 1, 0, 4, 0)).toEqual([0, 0.25]);
    });

    it("leaves by the side when trained across", () => {
        const [, to] = throughBox(block, 1, 0, 0, 4);
        expect(to).toBeCloseTo(0.25, 9);
        // Turned with the block, the same.
        const [, turned] = throughBox({ ...block, ax: 0, ay: 1 }, 0, 1, 4, 0);
        expect(turned).toBeCloseTo(0.25, 9);
    });

    it("is not in a block it misses", () => {
        expect(throughBox(block, 5, 5, 1, 0)).toEqual([1, 1]);
        expect(throughBox(block, 3, 0, 1, 0)).toEqual([1, 1]);
    });
});
