import { isDomed, insideOutline, domeRadius, type ModuleSpec, type ShipDesign, type ShipView } from "../sim/index.js";
import { drawnMounts, type Mounts } from "./bevels.js";
import { THICK_SHADOW_M, type Light } from "./light.js";
import { isFighterModule, moduleFills, type Fill } from "./moduleFills.js";
import { shipColours } from "./teams.js";

/**
 * What stands above a ship's deck, as shapes: the thick modules and turrets'
 * domes whose shadows fall on its thin hull, and on whatever hangs over it, as
 * leaking vapour does. DOM-free, so it is unit-tested.
 */

const fills: Fill[] = [];
const shapes = new WeakMap<ModuleSpec, number[][]>();

/** `spec`'s fills as polygons in its own frame, each convex. */
export function shapesOf(spec: ModuleSpec): number[][] {
    let out = shapes.get(spec);
    if (out === undefined) {
        moduleFills(spec, "#000000", shipColours(0), 1, fills);
        out = fills.map((fill) => [...fill.points]);
        shapes.set(spec, out);
    }
    return out;
}

/** `spec`'s fills with `mounts` as polygons, for its shadow. */
export function footprintOf(spec: ModuleSpec, mounts: Mounts): readonly (readonly number[])[] {
    return mounts.polygons.length === 0 ? shapesOf(spec) : [...shapesOf(spec), ...mounts.polygons];
}

const domes = new Map<number, number[]>();
/** Corners round a turret's dome, many enough that its shadow's edge reads as round. */
const DOME_SHADOW_CORNERS = 24;

/** A turret's dome as a polygon in its module's frame, for the shadow it casts. */
export function domeOutline(spec: ModuleSpec): number[] {
    const radius = domeRadius(spec);
    let made = domes.get(radius);
    if (made === undefined) {
        const corners: number[] = [];
        for (let k = 0; k < DOME_SHADOW_CORNERS; k++) {
            const a = (k * 2 * Math.PI) / DOME_SHADOW_CORNERS;
            corners.push(radius * Math.cos(a), radius * Math.sin(a));
        }
        made = corners;
        domes.set(radius, made);
    }
    return made;
}

/** A module standing a thick module's height above the deck: its shapes in its ship's frame, and the box round them. */
interface Standing {
    module: number;
    polygons: number[][];
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

const standing = new WeakMap<ShipDesign, Standing[]>();

/** What of `design` stands a thick module's height, in its frame: its thick modules and its turrets' domes, not its fighters. */
function standingOf(design: ShipDesign): Standing[] {
    let all = standing.get(design);
    if (all !== undefined) return all;
    all = [];
    for (let i = 0; i < design.modules.length; i++) {
        const m = design.modules[i]!;
        const kind = m.spec.kind;
        if (kind === "rock" || kind === "kernel" || isFighterModule(design, i)) continue;
        const domed = isDomed(kind);
        if (!m.weaponsLayer && !domed) continue;
        const c = Math.cos(m.angle);
        const s = Math.sin(m.angle);
        const local = domed ? [domeOutline(m.spec)] : footprintOf(m.spec, drawnMounts(design, i));
        const block: Standing = { module: i, polygons: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        for (const corners of local) {
            const placed: number[] = [];
            for (let k = 0; k + 1 < corners.length; k += 2) {
                const x = m.x + corners[k]! * c - corners[k + 1]! * s;
                const y = m.y + corners[k]! * s + corners[k + 1]! * c;
                placed.push(x, y);
                block.x0 = Math.min(block.x0, x);
                block.y0 = Math.min(block.y0, y);
                block.x1 = Math.max(block.x1, x);
                block.y1 = Math.max(block.y1, y);
            }
            block.polygons.push(placed);
        }
        all.push(block);
    }
    standing.set(design, all);
    return all;
}

/**
 * Whether a point at deck height is in the shadow of what stands on its own
 * ship: whether anything thick lies between it and the light, within the
 * length a thick module's shadow falls. The same region as the shadows the
 * hull layer sweeps, asked of a point rather than drawn.
 */
export class Overshadowed {
    private blocks: Standing[] = [];
    private drawn: readonly boolean[] | undefined;
    /** Towards the light, in the ship's frame, as far as a shadow falls. */
    private towardX = 0;
    private towardY = 0;

    /** Ask of `ship`, as it is drawn now, in `light`; false if nothing on it stands to cast a shadow. */
    set(ship: ShipView, light: Light): boolean {
        this.blocks = standingOf(ship.currentStructure);
        this.drawn = ship.drawn;
        const length = THICK_SHADOW_M * (light.slant ?? 1);
        const bearing = light.from - ship.angle;
        this.towardX = Math.cos(bearing) * length;
        this.towardY = Math.sin(bearing) * length;
        return this.blocks.length > 0;
    }

    /** Whether `(x, y)`, in the ship's frame, is in a shadow. */
    covers(x: number, y: number): boolean {
        const ex = x + this.towardX;
        const ey = y + this.towardY;
        const x0 = Math.min(x, ex);
        const x1 = Math.max(x, ex);
        const y0 = Math.min(y, ey);
        const y1 = Math.max(y, ey);
        for (const block of this.blocks) {
            if (this.drawn?.[block.module] === false) continue;
            if (block.x1 < x0 || block.x0 > x1 || block.y1 < y0 || block.y0 > y1) continue;
            for (const corners of block.polygons) if (crosses(corners, x, y, ex, ey)) return true;
        }
        return false;
    }
}

/** Whether the segment from `(ax, ay)` to `(bx, by)` touches the polygon `corners`. */
function crosses(corners: readonly number[], ax: number, ay: number, bx: number, by: number): boolean {
    const n = corners.length / 2;
    if (insideOutline(corners, n, ax, ay)) return true;
    for (let k = 0; k < n; k++) {
        const j = (k + 1) % n;
        const cx = corners[2 * k]!;
        const cy = corners[2 * k + 1]!;
        const dx = corners[2 * j]!;
        const dy = corners[2 * j + 1]!;
        const d1 = side(ax, ay, bx, by, cx, cy);
        const d2 = side(ax, ay, bx, by, dx, dy);
        const d3 = side(cx, cy, dx, dy, ax, ay);
        const d4 = side(cx, cy, dx, dy, bx, by);
        if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    }
    return false;
}

/** Which side of the line from `(px, py)` to `(qx, qy)` the point `(rx, ry)` is on, by sign. */
function side(px: number, py: number, qx: number, qy: number, rx: number, ry: number): number {
    return (qx - px) * (ry - py) - (qy - py) * (rx - px);
}
