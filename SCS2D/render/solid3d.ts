import type { ShipView } from "../sim/index.js";

/**
 * What a context that draws the battle in 3D offers canvas2d.ts, so what it
 * draws flat can stand at the height it belongs at: a flame, a round or a
 * flash is laid along an axis at a height and turned about that axis to face
 * the camera, or about its middle where the axis has no length.
 */
export interface Solid3D {
    /** What is drawn from here on lies along `(x0, y0)` to `(x1, y1)`, in the current transform, `height` metres above the deck's middle. */
    along(x0: number, y0: number, x1: number, y1: number, height: number): void;
    /** What is drawn from here on lies flat `height` metres above the deck's middle, hidden by what is in front of it. */
    on(height: number): void;
    /** What is drawn from here on lies flat on the deck again. */
    flat(): void;
    /** How high module `i`'s top is. */
    moduleTop(ship: ShipView, i: number): number;
    /** How high a ship's middle is. */
    shipLift(ship: ShipView): number;
    /** How high turret `t`'s barrels are. */
    barrelLift(ship: ShipView, t: number): number;
    /** How high a round flies: as high as the barrels in view, on average. */
    roundLift(): number;
}
