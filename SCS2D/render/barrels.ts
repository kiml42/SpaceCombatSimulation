import { hullMountGeometry, isHullMount, math, type ShipView } from "../sim/index.js";

const { cos, sin } = math;

/** A barrel is never narrower than this on screen, nor its shadow. */
export const MIN_BARREL_PX = 1;

/**
 * Each of a turret's barrels as a line in world metres, pointing where the
 * mount bears now, so a barrel and its shadow are drawn from one place.
 * Returns the barrels' width before any floor on screen: twice the calibre,
 * the tube's outer diameter (for a beam mount, the housing round the optic),
 * or a hull mount's outlets.
 */
export function barrelLines(ship: ShipView, t: number, visit: (x0: number, y0: number, x1: number, y1: number) => void): number {
    const design = ship.currentStructure;
    const turret = design.turrets[t]!;
    const spec = design.modules[turret.module]!.spec;
    const mount = turret.mount;
    const c = cos(ship.angle);
    const s = sin(ship.angle);
    const mx = ship.x + mount.x * c - mount.y * s;
    const my = ship.y + mount.x * s + mount.y * c;
    const reach = mount.muzzleOffset ?? 0;
    const rest = ship.angle + (mount.restBearing ?? 0);
    const bearing = ship.turretBearings[t] ?? 0;
    const dirX = cos(bearing);
    const dirY = sin(bearing);
    const count = turret.gun.barrelCount;
    const spacing = turret.gun.barrelSpacing;
    const hull = isHullMount(spec.kind) ? hullMountGeometry(spec) : null;
    const lenses = spec.kind === "hullBeam";
    for (let k = 0; k < count; k++) {
        const lat = count > 1 ? (k - (count - 1) * 0.5) * spacing : 0;
        if (lenses) {
            // Each lens about its own centre, the row laid across the mount.
            const cx = mx - sin(rest) * lat;
            const cy = my + cos(rest) * lat;
            visit(cx - dirX * reach, cy - dirY * reach, cx + dirX * reach, cy + dirY * reach);
            continue;
        }
        const bx = mx - dirY * lat;
        const by = my + dirX * lat;
        visit(bx, by, bx + dirX * reach, by + dirY * reach);
    }
    return hull !== null ? hull.outletWidth : 2 * turret.gun.calibre;
}
