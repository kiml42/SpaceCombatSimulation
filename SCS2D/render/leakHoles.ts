import type { ShipView } from "../sim/index.js";
import { LEAK_SCRATCH_FADE } from "../sim/snapshot.js";
import { BUCKLE, hash, HOLE, PIT, ragged, SCRAPE, within, type Bounds, type ScarShape } from "./scars.js";

/**
 * A leak's hole where the round went in, as wide as it is open now, so it
 * shrinks as its lining or a patch closes it, in a patch of scratched and
 * buckled plate. The scratches stay once a lining has sealed it, and fade
 * once it has been patched (`LEAK_SCRATCH_FADE`). Polygons in the module's
 * frame, kept inside its box, so a hole on its edge is a notch.
 */

/** How far the scratches reach from the hole, in the widths it opened. */
const SCRATCH_REACH = 1.6;
const STREAKS = 7;

/** How much of hole `k`'s scratches still show: all, unless it has been patched. */
export function scratchShows(ship: ShipView, k: number): number {
    const patched = ship.leakPatched?.[k] ?? -1;
    if (!(patched >= 0)) return 1;
    const since = (ship.leakAge?.[k] ?? patched) - patched;
    return Math.max(0, Math.min(1, 1 - since / LEAK_SCRATCH_FADE));
}

/** The widest a hole's mark is drawn, metres: what decides whether it is too small to draw. */
export function holeMarkWidth(opened: number): number {
    return 2 * SCRATCH_REACH * opened;
}

/**
 * A hole at `(x, y)` in a face whose outward normal is `(nx, ny)`, both in
 * its module's frame, `opened` wide at first and `width` now, its scratches
 * showing by `shows`, into `out`.
 */
export function leakHoleShapes(
    x: number,
    y: number,
    nx: number,
    ny: number,
    opened: number,
    width: number,
    shows: number,
    bounds: Bounds,
    out: ScarShape[],
): void {
    // From where it is, so a hole keeps its look whatever else comes and goes.
    const seed = Math.floor(hash(Math.round(x * 1000), Math.round(y * 1000), 5) * 1e6);
    const add = (points: number[], colour: number, alpha: number): void => {
        if (alpha > 0) out.push({ points: within(points, bounds), colour, alpha });
    };
    const reach = SCRATCH_REACH * opened;
    if (shows > 0) {
        add(ragged(x, y, x, y, nx, ny, reach, seed, 0.3), SCRAPE, 0.35 * shows);
        // Scored out from the hole into the plate, by the metal it tore.
        const thin = Math.max(0.004, opened * 0.05);
        for (let n = 0; n < STREAKS; n++) {
            const turn = Math.PI + (hash(seed, n, 6) - 0.5) * Math.PI * 0.9;
            const c = Math.cos(turn);
            const s = Math.sin(turn);
            const ux = nx * c - ny * s;
            const uy = nx * s + ny * c;
            const from = opened * 0.4;
            const to = reach * (0.55 + 0.4 * hash(seed, n, 7));
            add(ragged(x + ux * from, y + uy * from, x + ux * to, y + uy * to, ux, uy, thin, seed + n, 0.2), PIT, 0.55 * shows);
        }
        add(ragged(x, y, x, y, nx, ny, opened * 0.75, seed + 1, 0.35), BUCKLE, 0.4 * shows);
    }
    if (width > 0) add(ragged(x, y, x, y, nx, ny, width / 2, seed + 2, 0.2), HOLE, 0.95);
}
