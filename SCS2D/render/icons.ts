/**
 * The ship icon: how strongly it shows, and what shape it is.
 *
 * Zoomed out far enough to see a battle, a corvette is a couple of pixels of
 * hull and is indistinguishable from a round in flight — so past that point
 * each ship is also drawn as a marker of a fixed size on screen, which keeps
 * it findable however far out the camera goes. The marker is an arrowhead
 * rather than a dot, because in two dimensions the thing lost with the hull is
 * not only where a ship is but which way it is pointing.
 *
 * Here rather than in `canvas2d.ts` for the same reason `strokes.ts` is its
 * own file: it is arithmetic over numbers with no canvas in it, and the only
 * symptom of getting the ramp wrong is somebody sitting in front of the screen
 * saying the icons pop.
 */

import type { ShipDesign } from "../sim/blueprint.js";
import type { ShipView } from "../sim/snapshot.js";

/** Nose-to-tail length of an icon on screen, pixels. */
export const ICON_PX = 18;

/**
 * Opacity of an icon once it has fully faded in. Short of solid, so the hull
 * underneath is still readable at the zooms where both are drawn.
 */
export const ICON_MAX_ALPHA = 0.3;

/**
 * The on-screen widths, in pixels, between which an icon fades in: absent
 * while the ship is larger than `ICON_FADE_START_PX` across, full once it is
 * smaller than `ICON_FADE_FULL_PX`.
 *
 * The ramp is over the ship's *drawn* size rather than over the camera's
 * scale, so a frigate keeps its hull at a zoom where a fighter alongside it
 * has already become an icon. That is the behaviour worth having: the icon
 * stands in for detail that has stopped being legible, and when it stops being
 * legible is a property of the ship, not of the camera.
 *
 * The far end is well above a pixel because the hull is unreadable long before
 * it is invisible — at twelve pixels a ship is a smudge whose facing cannot be
 * made out, which is exactly what the icon is there to replace.
 *
 * **The near end is set by when the hull stops speaking for itself, not by
 * when it starts getting small.** An icon over a hull that is still perfectly
 * legible is clutter, and worse, it is clutter on exactly the ships that need
 * it least — so the ramp starts late, once a hull is down to a size where its
 * shape is going rather than merely reduced.
 */
export const ICON_FADE_START_PX = 16;
export const ICON_FADE_FULL_PX = 8;

/**
 * Below this mass, kg, a hulk is wreckage: no icon, and framed with the debris.
 * Under an intact Y-wing, so a broken-up fighter or a dead torpedo stops
 * cluttering the view while a crippled capital stays findable.
 */
export const HULK_ICON_MASS = 150_000;

/** Whether a ship is out of the fight: core out, or every gun and engine it set out with lost. */
export function isHulk(ship: ShipView): boolean {
    return !ship.hasControl || ship.isMissionKilled;
}

/** Whether a ship is debris: a severed piece, or a hulk too small to be worth marking. */
export function isWreckage(ship: ShipView): boolean {
    return ship.isDerelict || (isHulk(ship) && ship.currentStructure.mass < HULK_ICON_MASS);
}

/**
 * How solid a ship's icon is, for a hull drawn `shipPx` across on screen.
 * Zero while the hull speaks for itself, so nothing is drawn at all close up.
 */
export function iconAlpha(shipPx: number): number {
    if (!(shipPx < ICON_FADE_START_PX)) return 0;
    if (shipPx <= ICON_FADE_FULL_PX) return ICON_MAX_ALPHA;
    const t = (ICON_FADE_START_PX - shipPx) / (ICON_FADE_START_PX - ICON_FADE_FULL_PX);
    return ICON_MAX_ALPHA * t;
}

/**
 * The arrowhead, as points in a frame where the nose is at +x and the whole
 * shape is one unit long.
 *
 * Notched at the tail rather than a plain triangle: a triangle's base is as
 * straight as its sides and reads as a wedge pointing either way at a glance,
 * where the notch makes the nose unambiguous. Kept as data so the shape is
 * fixed once and the drawing merely scales it — and so a test can check the
 * thing is actually pointed.
 */
export const ICON_OUTLINE: readonly (readonly [number, number])[] = [
    [0.5, 0],
    [-0.5, 0.42],
    [-0.24, 0],
    [-0.5, -0.42],
];

/**
 * A ship's icon: a hull with a pointed bow, in the same frame as the
 * arrowhead, so it reads as a ship with a front rather than as a dart.
 * Moved back so the ship's position is at the middle of its area, as a hull's
 * centre of mass is, rather than at the middle of its length.
 */
export const LONG_ICON_OUTLINE: readonly (readonly [number, number])[] = aboutCentroid([
    [0.5, 0],
    [0.22, 0.2],
    [-0.5, 0.2],
    [-0.5, -0.2],
    [0.22, -0.2],
]);

/** How much larger than the arrowhead a ship's long icon is drawn, so a ship stands out among fighters. */
export const LONG_ICON_SCALE = 1.3;

/** Half the side of a square icon, in the arrowhead's frame. */
export const SQUARE_ICON_HALF = 0.3;

/**
 * What an icon says about a ship: `square` that it pushes much alike every
 * way, `arrow` that it is a fighter, and `long` that it is any other ship.
 */
export type IconShape = "arrow" | "square" | "long";

/**
 * The least share of its strongest push a layout must have along each of its
 * four axes for its thrust to count as symmetrical.
 */
export const SQUARE_THRUST_SHARE = 0.5;

const shapes = new WeakMap<ShipDesign, IconShape>();

/** `square` for a ship that pushes much alike every way, else `arrow` for a fighter and `long` for any other. Worked out once per design. */
export function iconShape(design: ShipDesign): IconShape {
    let shape = shapes.get(design);
    if (shape !== undefined) return shape;
    const layout = design.engineLayout;
    let most = 0;
    let least = Infinity;
    for (let k = 0; k < 4; k++) {
        const along = layout.maxThrustAlong(k === 0 ? 1 : k === 2 ? -1 : 0, k === 1 ? 1 : k === 3 ? -1 : 0);
        most = Math.max(most, along);
        least = Math.min(least, along);
    }
    const even = !(most > 0) || least >= SQUARE_THRUST_SHARE * most;
    shape = even ? "square" : design.fighter ? "arrow" : "long";
    shapes.set(design, shape);
    return shape;
}

/** A polygon moved so its area's centroid is at the origin. */
function aboutCentroid(points: readonly (readonly [number, number])[]): (readonly [number, number])[] {
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < points.length; k++) {
        const [x0, y0] = points[k]!;
        const [x1, y1] = points[(k + 1) % points.length]!;
        const cross = x0 * y1 - x1 * y0;
        area += cross;
        cx += (x0 + x1) * cross;
        cy += (y0 + y1) * cross;
    }
    cx /= 3 * area;
    cy /= 3 * area;
    return points.map(([x, y]) => [x - cx, y - cy] as const);
}
