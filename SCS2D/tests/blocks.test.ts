import { describe, expect, it } from "vitest";
import { compileBlueprint, type ShipView } from "../sim/index.js";
import { Overshadowed } from "../render/blocks.js";
import type { Light } from "../render/light.js";

/** Thin deck either side of a thick block 4 m square, in a row along x. */
const STEP = compileBlueprint({
    name: "Step",
    modules: [
        { kind: "core", x: -4, y: 0, length: 4, width: 4 },
        { kind: "structure", x: 0, y: 0, length: 4, width: 4, thick: true },
        { kind: "structure", x: 4, y: 0, length: 4, width: 4 },
    ],
});
const block = STEP.modules.findIndex((m) => m.weaponsLayer);
/** Where the block's face toward -x is, in the ship's frame. */
const face = STEP.modules[block]!.x - 2;

const shipOf = (angle = 0, drawn?: boolean[]): ShipView => ({ currentStructure: STEP, angle, drawn }) as unknown as ShipView;
/** From +x, low in the sky: a thick module's shadow falls its full length towards -x. */
const fromEast: Light = { from: 0, colour: "#ffffff", ambient: 0.2 };

describe("what is in a ship's own shadows", () => {
    it("is a point within a shadow's length of a block, on its side away from the light", () => {
        const shadows = new Overshadowed();
        expect(shadows.set(shipOf(), fromEast)).toBe(true);
        expect(shadows.covers(face - 1, 0)).toBe(true);
        // Past the shadow's 1.5 m, beside the block rather than behind it, and on its lit side.
        expect(shadows.covers(face - 2, 0)).toBe(false);
        expect(shadows.covers(face - 1, 3)).toBe(false);
        expect(shadows.covers(face + 5, 0)).toBe(false);
    });

    it("turns with the ship, the light staying where it is", () => {
        const shadows = new Overshadowed();
        // Turned half round, the light comes from the ship's -x, so the shadow falls to its +x.
        shadows.set(shipOf(Math.PI), fromEast);
        expect(shadows.covers(face - 1, 0)).toBe(false);
        expect(shadows.covers(face + 5, 0)).toBe(true);
    });

    it("falls shorter as the light comes from overhead, and not at all from a block that is not drawn", () => {
        const shadows = new Overshadowed();
        shadows.set(shipOf(), { ...fromEast, slant: 0.35 });
        expect(shadows.covers(face - 1, 0)).toBe(false);
        const drawn = STEP.modules.map((_, i) => i !== block);
        shadows.set(shipOf(0, drawn), fromEast);
        expect(shadows.covers(face - 1, 0)).toBe(false);
    });
});
