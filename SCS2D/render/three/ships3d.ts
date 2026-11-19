import {
    AmbientLight,
    BufferAttribute,
    BufferGeometry,
    CanvasTexture,
    Color,
    CylinderGeometry,
    DirectionalLight,
    Group,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshLambertMaterial,
    NoColorSpace,
    PCFShadowMap,
    PointLight,
    Quaternion,
    RepeatWrapping,
    Scene,
    Vector3,
    type WebGLRenderer,
} from "three";
import {
    DECK_HEIGHT,
    domeRadius,
    HULL_LAYER,
    isDomed,
    originOf,
    WEAPONS_LAYER,
    type ShipDesign,
    type ShipView,
    type Snapshot,
} from "../../sim/index.js";
import { BEVEL_OF_RADIUS, BEVEL_STRIDE, bevelQuad, drawnBevels, drawnMounts, isBevelled } from "../bevels.js";
import { barrelLines } from "../barrels.js";
import type { Camera } from "../camera.js";
import { engineLayout } from "../engineLayout.js";
import type { Lights } from "../glows.js";
import { DEFAULT_LIGHT, FIGHTER_SHADOW_M, fighterHeight, LANDED_SHADOW_M, type Light } from "../light.js";
import { BARREL, fillColour, isFighterModule, moduleFills, paintedSide, type Fill } from "../moduleFills.js";
import { parseColour } from "../pixiCanvas.js";
import { fighterColours, shipColours, teamLivery } from "../teams.js";
import { patternColour, patternTile, patternTransform, tileKey, type Affine } from "../livery.js";
import { WEAR_TILE, wearLevel, wearSeed, wearTile, wearTransform } from "../wear.js";
import { triangulate } from "./threeCanvas.js";

/**
 * Ships as solid models, made from their modules: each module's fills, as the
 * 2D view draws them, stood up into prisms as deep as the module is, so seen
 * from straight above a ship looks as it does in 2D. Engines' bells become
 * cones, tanks cylinders, and turrets' domes hemispheres with their barrels
 * as cylinders, turned each frame. Lit by the battle's light, with shadows,
 * and by the brightest of the dynamic lights.
 */

/** How deep a module is drawn: by its layer, thin 3 m and thick 9 m, or by the depth its stats were worked out with. */

/** A box on the deck, metres from the camera's point. */
export interface DeckBox {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
}

/**
 * The layers' heights (DESIGN.md §3), metres from the plane between them: the
 * hull's middle below it, where thin modules and their guns are; the weapons
 * layer's above, where fighters fly and turrets fire; and between them, a thick
 * module's middle and its guns', which meet both. The plane is the thin hull's
 * top and the deck's, which a pad's top is.
 */
const THIN = DECK_HEIGHT;
export const HULL_HEIGHT = -THIN / 2;
export const FIGHTER_HEIGHT = THIN / 2;
export const DECK_TOP = 0;
/** The least a thick module is deep: through both layers. */
const THICK_LEAST = 2 * THIN;
/** How much higher each fill of a module stands than the one under it, so their tops do not fight. */
const STACK = 0.02;
/** Corners round a cylinder, dome or cone. */
const ROUND = 20;
/** How much narrower an engine bell is inside than outside at its throat, as a share of the throat. */
const BELL_WALL = 0.25;
/** An engine's throat, looking up its bell: black, whatever lights it. */
const THROAT = [0, 0, 0] as const;
/** How far a livery's band stands proud of the pump it goes round, as a share of its radius. */
const BAND_PROUD = 1.02;
/** Dynamic lights shed as point lights: the brightest this many. */
const POINT_LIGHTS = 8;

class Builder {
    readonly pos: number[] = [];
    readonly nor: number[] = [];
    readonly col: number[] = [];
    readonly uv: number[] = [];
    /** Where a texture is on a point of the module, from where it is and which way it faces, in the module's frame. */
    uvMap: ((x: number, y: number, z: number, nx: number, ny: number, nz: number) => readonly [number, number]) | null = null;
    /** Module frame to ship frame, and how high its middle is. */
    x = 0;
    y = 0;
    c = 1;
    s = 0;
    z = 0;
    /** How far what is built is turned from the module's frame, which a texture is laid in. */
    private tc = 1;
    private ts = 0;

    place(x: number, y: number, angle: number, z: number, turn = 0): void {
        this.x = x;
        this.y = y;
        this.c = Math.cos(angle);
        this.s = Math.sin(angle);
        this.z = z;
        this.tc = Math.cos(turn);
        this.ts = Math.sin(turn);
    }

    private vertex(px: number, py: number, pz: number, nx: number, ny: number, nz: number, r: number, g: number, b: number): void {
        this.pos.push(this.x + px * this.c - py * this.s, this.y + px * this.s + py * this.c, this.z + pz);
        this.nor.push(nx * this.c - ny * this.s, nx * this.s + ny * this.c, nz);
        this.col.push(r, g, b);
        if (this.uvMap !== null) {
            const [c, s] = [this.tc, this.ts];
            this.uv.push(...this.uvMap(px * c - py * s, px * s + py * c, pz, nx * c - ny * s, nx * s + ny * c, nz));
        }
    }

    /** A triangle in the module's frame, its normal worked out from its corners. */
    tri(a: readonly number[], b: readonly number[], c: readonly number[], rgb: readonly number[]): void {
        const ux = b[0]! - a[0]!;
        const uy = b[1]! - a[1]!;
        const uz = b[2]! - a[2]!;
        const vx = c[0]! - a[0]!;
        const vy = c[1]! - a[1]!;
        const vz = c[2]! - a[2]!;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const n = Math.hypot(nx, ny, nz) || 1;
        nx /= n;
        ny /= n;
        nz /= n;
        for (const p of [a, b, c]) this.vertex(p[0]!, p[1]!, p[2]!, nx, ny, nz, rgb[0]!, rgb[1]!, rgb[2]!);
    }

    /** Polygon `points` stood up from `bottom` to `top`. */
    prism(points: readonly number[], bottom: number, top: number, rgb: readonly number[]): void {
        const n = points.length / 2;
        // Anticlockwise, so the sides face out.
        let area = 0;
        for (let k = 0; k < n; k++) {
            const j = (k + 1) % n;
            area += points[2 * k]! * points[2 * j + 1]! - points[2 * j]! * points[2 * k + 1]!;
        }
        const p: number[] = [];
        if (area >= 0) p.push(...points);
        else for (let k = n - 1; k >= 0; k--) p.push(points[2 * k]!, points[2 * k + 1]!);
        const caps: number[] = [];
        triangulate(p, (x, y) => caps.push(x, y));
        for (let k = 0; k < caps.length; k += 6) {
            const [ax, ay, bx, by, cx, cy] = caps.slice(k, k + 6) as [number, number, number, number, number, number];
            const ccw = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) >= 0;
            if (ccw) {
                this.tri([ax, ay, top], [bx, by, top], [cx, cy, top], rgb);
                this.tri([ax, ay, bottom], [cx, cy, bottom], [bx, by, bottom], rgb);
            } else {
                this.tri([ax, ay, top], [cx, cy, top], [bx, by, top], rgb);
                this.tri([ax, ay, bottom], [bx, by, bottom], [cx, cy, bottom], rgb);
            }
        }
        for (let k = 0; k < n; k++) {
            const j = (k + 1) % n;
            const a0 = [p[2 * k]!, p[2 * k + 1]!, bottom];
            const b0 = [p[2 * j]!, p[2 * j + 1]!, bottom];
            const a1 = [p[2 * k]!, p[2 * k + 1]!, top];
            const b1 = [p[2 * j]!, p[2 * j + 1]!, top];
            this.tri(a0, b0, b1, rgb);
            this.tri(a0, b1, a1, rgb);
        }
    }

    /**
     * Polygon `points` stood up from `bottom` to `top`, its top edges cut at 45°
     * along each of `bevels` (`Bevels`) on its outline, `width` deep at most,
     * mitred where two meet as Pixi draws them.
     */
    bevelled(
        points: readonly number[],
        bevels: readonly number[],
        width: number,
        bottom: number,
        top: number,
        rgb: readonly number[],
    ): void {
        const n = points.length / 2;
        let area = 0;
        for (let k = 0; k < n; k++) {
            const j = (k + 1) % n;
            area += points[2 * k]! * points[2 * j + 1]! - points[2 * j]! * points[2 * k + 1]!;
        }
        // Anticlockwise, as the bevels' outline is.
        const p: number[] = [];
        if (area >= 0) p.push(...points);
        else for (let k = n - 1; k >= 0; k--) p.push(points[2 * k]!, points[2 * k + 1]!);
        const quad = [0, 0, 0, 0, 0, 0, 0, 0];
        const cap: number[] = [];
        const near = (ax: number, ay: number, bx: number, by: number): boolean => Math.abs(ax - bx) + Math.abs(ay - by) < 1e-6;
        for (let k = 0; k < n; k++) {
            const j = (k + 1) % n;
            const [ax, ay, bx, by] = [p[2 * k]!, p[2 * k + 1]!, p[2 * j]!, p[2 * j + 1]!];
            const ex = bx - ax;
            const ey = by - ay;
            const span = Math.hypot(ex, ey);
            if (!(span > 0)) continue;
            // The stretches of this edge that are bevelled, in order along it.
            const on = (x: number, y: number): number =>
                Math.abs((x - ax) * ey - (y - ay) * ex) / span < 1e-4 ? ((x - ax) * ex + (y - ay) * ey) / (span * span) : NaN;
            const runs: { t: number; e: number }[] = [];
            for (let e = 0; e < bevels.length; e += BEVEL_STRIDE) {
                const t0 = on(bevels[e]!, bevels[e + 1]!);
                const t1 = on(bevels[e + 2]!, bevels[e + 3]!);
                if (t0 >= -1e-6 && t1 <= 1 + 1e-6 && t1 > t0) runs.push({ t: t0, e });
            }
            runs.sort((r, q) => r.t - q.t);
            cap.push(ax, ay);
            let from = [ax, ay];
            for (const { e } of runs) {
                bevelQuad(bevels, e, width, quad);
                const deep = Math.min(width, bevels[e + 6]!);
                const low = top - deep;
                const [px, py, qx, qy, iqx, iqy, ipx, ipy] = quad as [number, number, number, number, number, number, number, number];
                this.wall(from[0]!, from[1]!, px, py, bottom, top, rgb);
                this.wall(px, py, qx, qy, bottom, low, rgb);
                this.tri([px, py, low], [qx, qy, low], [iqx, iqy, top], rgb);
                this.tri([px, py, low], [iqx, iqy, top], [ipx, ipy, top], rgb);
                // An end meeting no other bevel stops square.
                if (!(bevels[e + 9]! > 0)) this.tri([px, py, low], [ipx, ipy, top], [px, py, top], rgb);
                if (!(bevels[e + 12]! > 0)) this.tri([qx, qy, low], [qx, qy, top], [iqx, iqy, top], rgb);
                cap.push(px, py, ipx, ipy, iqx, iqy, qx, qy);
                from = [qx, qy];
            }
            this.wall(from[0]!, from[1]!, bx, by, bottom, top, rgb);
        }
        // The top inside the bevels: where two meet at a corner, the corner itself is cut away.
        let changed = true;
        while (changed && cap.length > 6) {
            changed = false;
            const m = cap.length / 2;
            for (let k = 0; k < m; k++) {
                const j = (k + 1) % m;
                const h = (k + m - 1) % m;
                if (near(cap[2 * k]!, cap[2 * k + 1]!, cap[2 * j]!, cap[2 * j + 1]!)) {
                    cap.splice(2 * k, 2);
                    changed = true;
                    break;
                }
                if (near(cap[2 * h]!, cap[2 * h + 1]!, cap[2 * j]!, cap[2 * j + 1]!)) {
                    // A spike out to the corner and back.
                    cap.splice(2 * k, 2);
                    changed = true;
                    break;
                }
            }
        }
        const flat = (outline: readonly number[], z: number, up: boolean): void => {
            const tris: number[] = [];
            triangulate(outline, (x, y) => tris.push(x, y));
            for (let k = 0; k < tris.length; k += 6) {
                const [ax, ay, bx, by, cx, cy] = tris.slice(k, k + 6) as [number, number, number, number, number, number];
                const ccw = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) >= 0;
                if (ccw === up) this.tri([ax, ay, z], [bx, by, z], [cx, cy, z], rgb);
                else this.tri([ax, ay, z], [cx, cy, z], [bx, by, z], rgb);
            }
        };
        flat(cap, top, true);
        flat(p, bottom, false);
    }

    /** A wall up the outline from `(ax, ay)` to `(bx, by)`, anticlockwise, between `bottom` and `top`. */
    private wall(ax: number, ay: number, bx: number, by: number, bottom: number, top: number, rgb: readonly number[]): void {
        if (Math.abs(ax - bx) + Math.abs(ay - by) < 1e-9) return;
        this.tri([ax, ay, bottom], [bx, by, bottom], [bx, by, top], rgb);
        this.tri([ax, ay, bottom], [bx, by, top], [ax, ay, top], rgb);
    }

    /**
     * A cylinder or cone lying along the module's x from `x0` to `x1`, round
     * `y` at height `z`, `r0` and `r1` across at its ends and `squash` as deep
     * as it is wide.
     */
    lying(
        x0: number,
        x1: number,
        y: number,
        z: number,
        r0: number,
        r1: number,
        squash: number,
        rgb: readonly number[],
        capped = true,
        inward = false,
    ): void {
        this.lathe([x0, r0, x1, r1], y, z, squash, rgb, capped, inward);
    }

    /**
     * `profile`, pairs of x and radius, turned round the module's x at `y`, `z`,
     * `squash` as deep as it is wide; capped flat at its ends, and facing in if `inward`.
     */
    lathe(profile: readonly number[], y: number, z: number, squash: number, rgb: readonly number[], capped = true, inward = false): void {
        const p: number[] = [];
        // Along +x, so the winding faces out.
        if (profile[0]! <= profile[profile.length - 2]!) p.push(...profile);
        else for (let k = profile.length - 2; k >= 0; k -= 2) p.push(profile[k]!, profile[k + 1]!);
        const ring = (x: number, r: number, k: number): number[] => {
            const a = (k / ROUND) * 2 * Math.PI;
            return [x, y + Math.cos(a) * r, z + Math.sin(a) * r * squash];
        };
        const last = p.length - 2;
        // The way along the profile at each of its points, the two stretches either side of it averaged, so it is shaded smooth.
        const along: number[] = [];
        for (let j = 0; j <= last; j += 2) {
            let dx = 0;
            let dr = 0;
            for (const [from, to] of [
                [j - 2, j],
                [j, j + 2],
            ] as const) {
                if (from < 0 || to > last) continue;
                const ex = p[to]! - p[from]!;
                const er = p[to + 1]! - p[from + 1]!;
                const l = Math.hypot(ex, er);
                if (l > 1e-9) {
                    dx += ex / l;
                    dr += er / l;
                }
            }
            along.push(dx, dr);
        }
        const r = rgb[0]!;
        const g = rgb[1]!;
        const bl = rgb[2]!;
        // Point `j` of the profile `k`th of the way round, with the surface's normal there.
        const put = (j: number, k: number): void => {
            const a = (k / ROUND) * 2 * Math.PI;
            const [dx, dr] = [along[j]!, along[j + 1]!];
            let nx = -squash * dr;
            let ny = squash * dx * Math.cos(a);
            let nz = dx * Math.sin(a);
            const n = (inward ? -1 : 1) / (Math.hypot(nx, ny, nz) || 1);
            nx *= n;
            ny *= n;
            nz *= n;
            const at = ring(p[j]!, p[j + 1]!, k);
            this.vertex(at[0]!, at[1]!, at[2]!, nx, ny, nz, r, g, bl);
        };
        for (let k = 0; k < ROUND; k++) {
            for (let j = 0; j < last; j += 2) {
                if (Math.abs(p[j]! - p[j + 2]!) + Math.abs(p[j + 1]! - p[j + 3]!) < 1e-9) continue;
                if (inward) {
                    put(j, k);
                    put(j + 2, k);
                    put(j + 2, k + 1);
                    put(j, k);
                    put(j + 2, k + 1);
                    put(j, k + 1);
                } else {
                    put(j, k);
                    put(j + 2, k + 1);
                    put(j + 2, k);
                    put(j, k);
                    put(j, k + 1);
                    put(j + 2, k + 1);
                }
            }
            if (capped) {
                this.tri([p[0]!, y, z], ring(p[0]!, p[1]!, k + 1), ring(p[0]!, p[1]!, k), rgb);
                this.tri([p[last]!, y, z], ring(p[last]!, p[last + 1]!, k), ring(p[last]!, p[last + 1]!, k + 1), rgb);
            }
        }
    }

    /**
     * A bar along x from `x0` to `x1`, `w` either side of it and `h` above and
     * below, its long sides at +y and -y rounded where `roundPlus` and
     * `roundMinus` say: each corner there part of a cylinder as deep as the bar,
     * or as wide as it allows.
     */
    bar(x0: number, x1: number, w: number, h: number, roundPlus: boolean, roundMinus: boolean, rgb: readonly number[]): void {
        const most = roundPlus && roundMinus ? w : 2 * w;
        const rPlus = roundPlus ? Math.min(h, most) : 0;
        const rMinus = roundMinus ? Math.min(h, most) : 0;
        // Round it anticlockwise in y and z, from the +y side up: where, and which way out.
        const ring: number[] = [];
        const corner = (cy: number, cz: number, r: number, from: number): void => {
            const steps = r > 0 ? ROUND / 4 : 1;
            for (let k = 0; k <= steps; k++) {
                const a = from + (k / steps) * (Math.PI / 2);
                ring.push(cy + Math.cos(a) * r, cz + Math.sin(a) * r, Math.cos(a), Math.sin(a));
            }
        };
        corner(w - rPlus, h - rPlus, rPlus, 0);
        corner(-w + rMinus, h - rMinus, rMinus, Math.PI / 2);
        corner(-w + rMinus, -h + rMinus, rMinus, Math.PI);
        corner(w - rPlus, -h + rPlus, rPlus, (3 * Math.PI) / 2);
        const n = ring.length / 4;
        const [r, g, bl] = [rgb[0]!, rgb[1]!, rgb[2]!];
        for (let k = 0; k < n; k++) {
            const j = (k + 1) % n;
            const [ay, az, any, anz] = ring.slice(4 * k, 4 * k + 4) as [number, number, number, number];
            const [by, bz, bny, bnz] = ring.slice(4 * j, 4 * j + 4) as [number, number, number, number];
            if (Math.abs(ay - by) + Math.abs(az - bz) < 1e-9) continue;
            this.vertex(x0, ay, az, 0, any, anz, r, g, bl);
            this.vertex(x1, by, bz, 0, bny, bnz, r, g, bl);
            this.vertex(x1, ay, az, 0, any, anz, r, g, bl);
            this.vertex(x0, ay, az, 0, any, anz, r, g, bl);
            this.vertex(x0, by, bz, 0, bny, bnz, r, g, bl);
            this.vertex(x1, by, bz, 0, bny, bnz, r, g, bl);
            this.tri([x0, 0, 0], [x0, by, bz], [x0, ay, az], rgb);
            this.tri([x1, 0, 0], [x1, ay, az], [x1, by, bz], rgb);
        }
    }

    /** A disc `r` across at `x`, round `y`, `z`, `squash` as deep as it is wide, facing -x. */
    disc(x: number, y: number, z: number, r: number, squash: number, rgb: readonly number[]): void {
        for (let k = 0; k < ROUND; k++) {
            const a0 = (k / ROUND) * 2 * Math.PI;
            const a1 = ((k + 1) / ROUND) * 2 * Math.PI;
            this.tri(
                [x, y, z],
                [x, y + Math.cos(a1) * r, z + Math.sin(a1) * r * squash],
                [x, y + Math.cos(a0) * r, z + Math.sin(a0) * r * squash],
                rgb,
            );
        }
    }

    /** Half a sphere `r` across on the plane at `z`, round `(x, y)`. */
    dome(x: number, y: number, z: number, r: number, rgb: readonly number[]): void {
        const rows = 6;
        const at = (row: number, k: number): number[] => {
            const up = (row / rows) * (Math.PI / 2);
            const a = (k / ROUND) * 2 * Math.PI;
            return [x + Math.cos(a) * Math.cos(up) * r, y + Math.sin(a) * Math.cos(up) * r, z + Math.sin(up) * r];
        };
        for (let row = 0; row < rows; row++) {
            for (let k = 0; k < ROUND; k++) {
                const a0 = at(row, k);
                const a1 = at(row, k + 1);
                const b0 = at(row + 1, k);
                const b1 = at(row + 1, k + 1);
                this.smoothTri(a0, a1, b1, x, y, z, rgb);
                if (row < rows - 1) this.smoothTri(a0, b1, b0, x, y, z, rgb);
            }
        }
    }

    /** A triangle on a sphere round `(cx, cy, cz)`, each corner's normal pointing out of it. */
    private smoothTri(a: number[], b: number[], c: number[], cx: number, cy: number, cz: number, rgb: readonly number[]): void {
        for (const p of [a, b, c]) {
            const nx = p[0]! - cx;
            const ny = p[1]! - cy;
            const nz = p[2]! - cz;
            const n = Math.hypot(nx, ny, nz) || 1;
            this.vertex(p[0]!, p[1]!, p[2]!, nx / n, ny / n, nz / n, rgb[0]!, rgb[1]!, rgb[2]!);
        }
    }

    geometry(): BufferGeometry {
        const g = new BufferGeometry();
        g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
        g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nor), 3));
        g.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3));
        if (this.uv.length > 0) g.setAttribute("uv", new BufferAttribute(new Float32Array(this.uv), 2));
        g.computeBoundingSphere();
        return g;
    }
}

const rgbs = new Map<string, readonly number[]>();
function rgbOf(colour: string): readonly number[] {
    let rgb = rgbs.get(colour);
    if (rgb === undefined) {
        const [n] = parseColour(colour);
        rgb = [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
        rgbs.set(colour, rgb);
    }
    return rgb;
}

const SOOT_SHARE = 0.25;
const fills: Fill[] = [];

/**
 * How deep module `i` is drawn: as deep as its stats take it, within its
 * layer, and a thick one at least through both.
 */
export function moduleDepth(design: ShipDesign, i: number): number {
    const m = design.modules[i]!;
    const kind = m.spec.kind;
    const stats = m.stats.thickness;
    if (kind === "rock" || kind === "kernel") return stats;
    if (isThick(design, i)) return Math.max(stats, THICK_LEAST);
    return Math.min(stats, THIN);
}

/** Whether module `i` stands through both layers. A turret's is hull, and a fighter's flies in the weapons layer alone. */
function isThick(design: ShipDesign, i: number): boolean {
    const m = design.modules[i]!;
    return m.weaponsLayer && !isDomed(m.spec.kind) && !isFighterModule(design, i);
}

/** How high module `i`'s middle is in its ship's frame: in its layer, or a fighter's piece parked aboard sitting on the deck. */
function moduleMiddle(design: ShipDesign, i: number): number {
    const kind = design.modules[i]!.spec.kind;
    if (kind === "rock" || kind === "kernel" || design.fighter) return 0;
    if (isFighterModule(design, i)) return DECK_TOP + moduleDepth(design, i) / 2;
    return isThick(design, i) ? 0 : HULL_HEIGHT;
}

/** How high what flies in `layers` (a `HULL_LAYER` / `WEAPONS_LAYER` mask) is drawn: in its layer, or between them in both. */
export function layerHeight(layers: number): number {
    const hull = (layers & HULL_LAYER) !== 0;
    const weapons = (layers & WEAPONS_LAYER) !== 0;
    return hull && weapons ? 0 : weapons ? FIGHTER_HEIGHT : HULL_HEIGHT;
}

/** A livery's pattern over the fills it is laid on, in one colour, as a model. */
interface Patterned {
    readonly geometry: BufferGeometry;
    readonly key: string;
    readonly tile: HTMLCanvasElement | OffscreenCanvas;
}

/**
 * A ship's modules as one model, in its own frame, its middle at the deck; its
 * worn modules again, a model a level of wear; and its liveries' patterns, a
 * model a tile.
 */
function build(ship: ShipView): { model: BufferGeometry; worn: Map<number, BufferGeometry>; patterned: Patterned[] } {
    const design = ship.currentStructure;
    const base = new Builder();
    const wear = new Map<number, Builder>();
    const patterns = new Map<string, { builder: Builder; tile: HTMLCanvasElement | OffscreenCanvas }>();
    const seed = wearSeed(ship);
    for (let i = 0; i < design.modules.length; i++) {
        if (ship.drawn?.[i] === false) continue;
        const m = design.modules[i]!;
        const spec = m.spec;
        const integrity = ship.integrity?.[i] ?? 1;
        /** The module into `b`: all of it, or only fill `only`. */
        const emit = (b: Builder, only = -1): void => {
            const side = paintedSide(ship, i);
            const colours = isFighterModule(design, i) ? fighterColours(side) : shipColours(side);
            const burnt = integrity <= 0 && spec.kind !== "rock" && spec.kind !== "kernel";
            const shade = (rgb: readonly number[]): readonly number[] => (burnt ? rgb.map((v) => v * SOOT_SHARE) : rgb);
            const depth = moduleDepth(design, i);
            b.place(m.x, m.y, m.angle, moduleMiddle(design, i));
            moduleFills(spec, fillColour(spec, colours), colours, integrity, fills, drawnMounts(design, i).polygons);
            const half = depth / 2;
            if (spec.kind === "engine") {
                if (only >= 0) return;
                const layout = engineLayout(spec);
                const l = spec.length / 2;
                const w = spec.width / 2;
                const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
                const mounts = drawnMounts(design, i);
                // What joins it to its neighbours is half its depth, and runs into it.
                const joint = half / 2;
                const firstMount = fills.length - mounts.polygons.length;
                // Every chamber has the same outline, moved across.
                const chamberTop: number[] = [];
                for (let v = 0; v < layout.chamber.length; v += 2)
                    if (layout.chamber[v + 1]! >= 0) chamberTop.push(layout.chamber[v]!, layout.chamber[v + 1]!);
                fills.forEach((fill, k) => {
                    const p = fill.points;
                    const rgb = shade(rgbOf(fill.colour));
                    let x0 = Infinity;
                    let x1 = -Infinity;
                    let y0 = Infinity;
                    let y1 = -Infinity;
                    for (let v = 0; v < p.length; v += 2) {
                        x0 = Math.min(x0, p[v]!);
                        x1 = Math.max(x1, p[v]!);
                        y0 = Math.min(y0, p[v + 1]!);
                        y1 = Math.max(y1, p[v + 1]!);
                    }
                    const y = (y0 + y1) / 2;
                    if (k >= firstMount) {
                        b.prism(p, -joint - k * STACK, joint + k * STACK, rgb);
                        return;
                    }
                    // A bell, behind the block: a cone from its exit to its throat, its inside
                    // a shallower one thickening towards the throat, which is black.
                    if (x1 <= layout.mouth + 1e-6 && p.length >= 6) {
                        const widthAt = (x: number): number => {
                            let most = 0;
                            for (let v = 0; v < p.length; v += 2)
                                if (Math.abs(p[v]! - x) < (x1 - x0) * 0.05 + 1e-6) most = Math.max(most, Math.abs(p[v + 1]! - y));
                            return most;
                        };
                        const exit = Math.max(widthAt(x0), 0.05);
                        const throat = Math.max(widthAt(x1), 0.05);
                        const squash = Math.min(1, half / Math.max(exit, throat, 1e-6));
                        const inner = throat * (1 - BELL_WALL);
                        b.lying(x0, x1, y, 0, exit, throat, squash, rgb, false);
                        b.lying(x0, x1, y, 0, exit, inner, squash, rgb, false, true);
                        // Just out of the chamber's flat end, so they do not fight.
                        b.disc(x1 - STACK, y, 0, inner, squash, THROAT);
                        return;
                    }
                    // A chamber: a sphere, cut flat where it meets the throat and the pump.
                    if (p.length === layout.chamber.length && near(p[0]!, layout.chamber[0]!) && layout.radius > 0) {
                        b.lathe(chamberTop, p[1]! - layout.chamber[1]!, 0, Math.min(1, half / layout.radius), rgb);
                        return;
                    }
                    // The pump, and a livery's band round it: a cylinder along the thrust.
                    if (p.length === 8 && near(y0, -w) && near(y1, w) && near(x1, l) && x0 >= layout.pumpAft - 1e-6) {
                        const pump = near(x0, layout.pumpAft);
                        const r = pump ? w : w * BAND_PROUD;
                        b.lying(x0, x1, 0, 0, r, r, Math.min(1, half / w), rgb);
                        // Against something beside it, a block across it holds it there.
                        if (pump && !mounts.round) b.prism(p, -joint, joint, rgb);
                        return;
                    }
                    b.prism(p, -half - k * STACK, half + k * STACK, rgb);
                });
                return;
            }
            if (spec.kind === "tank" && fills.length > 0 && fills[0]!.points.length === 8) {
                // A tank: a bar along its length, rounded as a cylinder on each long side
                // with nothing beside it, as Pixi bevels it there, and square where it is joined.
                const long = spec.length >= spec.width;
                const across = (long ? spec.width : spec.length) / 2;
                const l = (long ? spec.length : spec.width) / 2;
                const rgb = shade(rgbOf(fills[0]!.colour));
                const z = b.z;
                const bevels = drawnBevels(design, i);
                // Whether the side facing `side` across the bar is open at `t` along it, in the module's frame.
                const open = (t: number, side: number): boolean => {
                    const [px, py, nx, ny] = long ? [t, side * across, 0, side] : [-side * across, t, -side, 0];
                    for (let e = 0; e < bevels.length; e += BEVEL_STRIDE) {
                        if (bevels[e + 4]! * nx + bevels[e + 5]! * ny < 0.9) continue;
                        const ax = bevels[e]!;
                        const ay = bevels[e + 1]!;
                        const ex = bevels[e + 2]! - ax;
                        const ey = bevels[e + 3]! - ay;
                        const u = ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1);
                        if (u >= 0 && u <= 1 && Math.abs((px - ax) * ey - (py - ay) * ex) / Math.hypot(ex, ey) < 1e-3) return true;
                    }
                    return false;
                };
                // Where along it a side opens or closes.
                const cuts = [-l, l];
                for (let e = 0; e < bevels.length; e += BEVEL_STRIDE)
                    for (const v of [0, 2]) {
                        const t = long ? bevels[e + v]! : bevels[e + v + 1]!;
                        if (t > -l && t < l) cuts.push(t);
                    }
                cuts.sort((a, c) => a - c);
                if (only > 0) {
                    const fill = fills[only]!;
                    b.prism(fill.points, half - STACK, half + STACK, shade(rgbOf(fill.colour)));
                    return;
                }
                if (!long) b.place(m.x, m.y, m.angle + Math.PI / 2, z, Math.PI / 2);
                for (let c = 0; c + 1 < cuts.length; c++) {
                    const x0 = cuts[c]!;
                    const x1 = cuts[c + 1]!;
                    if (x1 - x0 < 1e-6) continue;
                    const mid = (x0 + x1) / 2;
                    b.bar(x0, x1, across, half, open(mid, 1), open(mid, -1), rgb);
                }
                if (!long) b.place(m.x, m.y, m.angle, z);
                if (only === 0) return;
                fills.slice(1).forEach((fill) => b.prism(fill.points, half - STACK, half + STACK, shade(rgbOf(fill.colour))));
                return;
            }
            // The body is chamfered where Pixi bevels it, as wide as its bevels.
            const bevels = isBevelled(spec) ? drawnBevels(design, i) : [];
            const width = BEVEL_OF_RADIUS * originOf(design, i).design.radius;
            fills.forEach((fill, k) => {
                if (only >= 0 && only !== k) return;
                if (k === 0 && bevels.length > 0) b.bevelled(fill.points, bevels, width, -half, half, shade(rgbOf(fill.colour)));
                else b.prism(fill.points, -half - k * STACK, half + k * STACK, shade(rgbOf(fill.colour)));
            });
            if (only < 0 && isDomed(spec.kind)) {
                // Raised on a pedestal where it is too low to bring its barrels up to where they fire from.
                const r = domeRadius(spec);
                const rgb = shade(rgbOf(colours.highlight ?? colours.pivot));
                const base = Math.max(half, firingHeight(design, i) - moduleMiddle(design, i) - r * BARREL_ON_DOME);
                if (base > half + 1e-6) b.prism(disc(r * PEDESTAL), half, base, rgb);
                b.dome(0, 0, base, r, rgb);
            }
        };
        emit(base);
        const level = spec.kind === "rock" || spec.kind === "kernel" ? 0 : wearLevel(integrity);
        if (level > 0) {
            let worn = wear.get(level);
            if (worn === undefined) wear.set(level, (worn = new Builder()));
            worn.uvMap = wearUv(wearTransform(design, i, seed));
            emit(worn);
        }
        // A livery's pattern over each fill in the hull's tones, as Pixi lays it (canvas2d.ts's `fillModule`), unless it is burnt.
        const side = paintedSide(ship, i);
        const livery = spec.kind === "rock" || spec.kind === "kernel" || integrity <= 0 ? undefined : teamLivery(side);
        if (livery !== undefined && livery.pattern !== "none") {
            const colours = isFighterModule(design, i) ? fighterColours(side) : shipColours(side);
            moduleFills(spec, fillColour(spec, colours), colours, integrity, fills, drawnMounts(design, i).polygons);
            const overs = fills.map((fill) => patternColour(spec.kind, fill.colour, colours));
            const t = patternTransform(livery, design, i);
            overs.forEach((over, k) => {
                if (over === null) return;
                const tile = patternTile(livery, over);
                if (tile === null) return;
                const key = tileKey(livery, over);
                let pattern = patterns.get(key);
                if (pattern === undefined) patterns.set(key, (pattern = { builder: new Builder(), tile }));
                pattern.builder.uvMap = tileUv(t, tile.width, tile.height);
                emit(pattern.builder, k);
            });
        }
    }
    const worn = new Map<number, BufferGeometry>();
    for (const [level, b] of wear) worn.set(level, b.geometry());
    const patterned = [...patterns].map(([key, { builder, tile }]) => ({ geometry: builder.geometry(), key, tile }));
    return { model: base.geometry(), worn, patterned };
}

/** Where on a tile laid through `t` (tile pixels to the module's frame) a point is, seen from above: down a side, as on its top. */
function tileUv(t: Affine, width: number, height: number): (x: number, y: number) => readonly [number, number] {
    const det = t.a * t.d - t.b * t.c;
    return (x, y) => {
        const dx = x - t.e;
        const dy = y - t.f;
        return [(t.d * dx - t.c * dy) / det / width, (-t.b * dx + t.a * dy) / det / height];
    };
}

/**
 * Where on the wear tile a point of a module is: on what faces up or down,
 * through `t` (`wearTransform`), as the 2D view lays it; on a side, by how far
 * along the side and how high, at the same scale.
 */
function wearUv(t: Affine): (x: number, y: number, z: number, nx: number, ny: number, nz: number) => readonly [number, number] {
    const det = t.a * t.d - t.b * t.c;
    const metre = 1 / Math.sqrt(Math.abs(det)) / WEAR_TILE;
    return (x, y, z, nx, ny, nz) => {
        if (Math.abs(nz) > 0.5) {
            const dx = x - t.e;
            const dy = y - t.f;
            return [(t.d * dx - t.c * dy) / det / WEAR_TILE, (-t.b * dx + t.a * dy) / det / WEAR_TILE];
        }
        return [(-x * ny + y * nx) * metre, z * metre];
    };
}

/** How far up a turret's dome its barrels are, in its radii. */
const BARREL_ON_DOME = 0.55;
/** How wide a turret's pedestal is, in its dome's radii. */
const PEDESTAL = 0.6;

/** A circle `r` across round the module's middle, as corners. */
function disc(r: number): number[] {
    const out: number[] = [];
    for (let k = 0; k < ROUND; k++) out.push(Math.cos((k / ROUND) * 2 * Math.PI) * r, Math.sin((k / ROUND) * 2 * Math.PI) * r);
    return out;
}

const halfDepths = new WeakMap<ShipDesign, number>();
/** Half the depth of the deepest module of a fighter: how far its middle stands above what it sits on. */
function halfDepthOf(design: ShipDesign): number {
    let half = halfDepths.get(design);
    if (half === undefined) {
        half = 0;
        for (let i = 0; i < design.modules.length; i++) half = Math.max(half, moduleDepth(design, i) / 2);
        halfDepths.set(design, half);
    }
    return half;
}

/**
 * How high a ship's middle is: a capital ship's at the plane between the
 * layers; a fighter's in the weapons layer flying, sitting on a pad's top when
 * landed, and lowered from one to the other.
 */
export function liftOf(ship: ShipView): number {
    const design = ship.currentStructure;
    if (!design.fighter) return 0;
    const landed = DECK_TOP + halfDepthOf(design);
    const up = (fighterHeight(ship.riding, ship.lowered) - LANDED_SHADOW_M) / (FIGHTER_SHADOW_M - LANDED_SHADOW_M);
    return landed + Math.max(0, Math.min(1, up)) * (FIGHTER_HEIGHT - landed);
}

/** How high module `i`'s middle is. */
export function moduleLift(ship: ShipView, i: number): number {
    return liftOf(ship) + moduleMiddle(ship.currentStructure, i);
}

/** How high module `i`'s top is. */
export function moduleTop(ship: ShipView, i: number): number {
    return moduleLift(ship, i) + moduleDepth(ship.currentStructure, i) / 2;
}

/**
 * How high a gun on module `i` fires from, in its ship's frame: in the layer
 * its rounds fly in; a fighter's, and a turret's, the weapons layer's.
 */
function firingHeight(design: ShipDesign, i: number): number {
    if (design.fighter) return 0;
    if (isFighterModule(design, i)) return moduleMiddle(design, i);
    if (isDomed(design.modules[i]!.spec.kind)) return FIGHTER_HEIGHT;
    return moduleMiddle(design, i);
}

/** How high turret `t`'s barrels are: where its rounds fly. */
export function barrelLift(ship: ShipView, t: number): number {
    return liftOf(ship) + firingHeight(ship.currentStructure, ship.currentStructure.turrets[t]!.module);
}

interface Kept {
    key: string;
    /** The ship, placed each frame, holding its model and its wear. */
    group: Group;
    model: Mesh;
    worn: Mesh[];
}

export class Ships3D {
    readonly scene = new Scene();
    private readonly material = new MeshLambertMaterial({ vertexColors: true });
    private readonly kept = new Map<number, Kept>();
    private readonly sun = new DirectionalLight(0xffffff, 1);
    private readonly ambient = new AmbientLight(0xffffff, 1);
    private readonly points: PointLight[] = [];
    private readonly ships = new Group();
    private barrels: InstancedMesh;
    private readonly barrelMaterial = new MeshLambertMaterial({ color: BARREL });
    private readonly unitBarrel = new CylinderGeometry(0.5, 0.5, 1, 8, 1);
    private readonly matrix = new Matrix4();
    private readonly quaternion = new Quaternion();
    private readonly up = new Vector3(0, 1, 0);
    private readonly along = new Vector3();
    private readonly at = new Vector3();
    private readonly size = new Vector3();

    constructor(renderer: WebGLRenderer) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = PCFShadowMap;
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(2048, 2048);
        this.sun.shadow.bias = -0.0005;
        this.sun.shadow.normalBias = 0.02;
        this.scene.add(this.sun, this.sun.target, this.ambient, this.ships);
        for (let k = 0; k < POINT_LIGHTS; k++) {
            const light = new PointLight(0xffffff, 0, 1, 2);
            this.points.push(light);
            this.scene.add(light);
        }
        this.barrels = this.makeBarrels(256);
    }

    /** How many barrels the instanced mesh has room for, whatever it is drawing this frame. */
    private barrelRoom = 0;

    private makeBarrels(count: number): InstancedMesh {
        this.barrelRoom = count;
        const mesh = new InstancedMesh(this.unitBarrel, this.barrelMaterial, count);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        return mesh;
    }

    /** Place every ship over the deck `seen`, its barrels, and the lights. */
    update(snapshot: Snapshot, camera: Camera, seen: DeckBox, light: Light = DEFAULT_LIGHT): void {
        this.light(light, seen);
        const shown = new Set<number>();
        let barrels = 0;
        const ends: number[] = [];
        for (let s = 0; s < snapshot.shipCount; s++) {
            const ship = snapshot.ships[s]!;
            const design = ship.currentStructure;
            const dx = ship.x - camera.x;
            const dy = ship.y - camera.y;
            const reach = design.radius * 1.5 + 10;
            if (dx + reach < seen.minX || dx - reach > seen.maxX || dy + reach < seen.minY || dy - reach > seen.maxY) continue;
            shown.add(ship.body);
            const key = keyOf(ship);
            let kept = this.kept.get(ship.body);
            if (kept === undefined || kept.key !== key) {
                if (kept === undefined) {
                    const model = new Mesh(undefined, this.material);
                    model.castShadow = true;
                    model.receiveShadow = true;
                    const group = new Group();
                    group.add(model);
                    this.ships.add(group);
                    kept = { key, group, model, worn: [] };
                    this.kept.set(ship.body, kept);
                }
                this.fill(kept, ship);
                kept.key = key;
            }
            const z = liftOf(ship);
            kept.group.position.set(dx, dy, z);
            kept.group.rotation.set(0, 0, ship.angle);
            kept.group.visible = true;
            // Barrels, turned each frame: on top of a turret's dome, along a hull mount's middle.
            for (let t = 0; t < design.turrets.length; t++) {
                const module = design.turrets[t]!.module;
                if (ship.drawn?.[module] === false) continue;
                const lift = barrelLift(ship, t);
                ends.length = 0;
                const width = barrelLines(ship, t, (x0, y0, x1, y1) =>
                    ends.push(x0 - camera.x, y0 - camera.y, x1 - camera.x, y1 - camera.y),
                );
                for (let k = 0; k < ends.length; k += 4) {
                    if (barrels >= this.barrelRoom) {
                        const old = this.barrels;
                        this.barrels = this.makeBarrels(this.barrelRoom * 2);
                        this.barrels.instanceMatrix.array.set(old.instanceMatrix.array);
                        this.scene.remove(old);
                        old.dispose();
                    }
                    const [x0, y0, x1, y1] = [ends[k]!, ends[k + 1]!, ends[k + 2]!, ends[k + 3]!];
                    this.along.set(x1 - x0, y1 - y0, 0);
                    const length = this.along.length();
                    if (length <= 0) continue;
                    this.quaternion.setFromUnitVectors(this.up, this.along.normalize());
                    this.at.set((x0 + x1) / 2, (y0 + y1) / 2, lift);
                    const w = Math.max(width, 0.05);
                    this.size.set(w, length, w);
                    this.barrels.setMatrixAt(barrels++, this.matrix.compose(this.at, this.quaternion, this.size));
                }
            }
        }
        this.barrels.count = barrels;
        this.barrels.instanceMatrix.needsUpdate = true;
        for (const [body, kept] of this.kept) {
            if (shown.has(body)) continue;
            // Out of view: hidden, and let go once its ship is gone.
            kept.group.visible = false;
            if (!snapshot.ships.slice(0, snapshot.shipCount).some((ship) => ship.body === body)) {
                this.empty(kept);
                this.ships.remove(kept.group);
                this.kept.delete(body);
            }
        }
    }

    /** The battle's light as the sun, and the brightest dynamic lights, given in canvas pixels, as point lights. */
    private light(light: Light, seen: DeckBox): void {
        const slant = light.slant ?? 1;
        const toward = new Vector3(Math.cos(light.from) * slant, Math.sin(light.from) * slant, 1).normalize();
        this.sun.color = new Color(light.colour);
        // Lambert in three.js is divided by π, and a top facing up takes the light at a slant.
        this.sun.intensity = (Math.PI * (1 - light.ambient)) / toward.z;
        this.ambient.color = new Color(light.colour);
        this.ambient.intensity = Math.PI * light.ambient;
        // The shadows' map over what is in view, square on to the light.
        const cx = (seen.minX + seen.maxX) / 2;
        const cy = (seen.minY + seen.maxY) / 2;
        const reach = Math.hypot(seen.maxX - seen.minX, seen.maxY - seen.minY) / 2 + 20;
        this.sun.position
            .copy(toward)
            .multiplyScalar(reach * 2)
            .add(new Vector3(cx, cy, 0));
        this.sun.target.position.set(cx, cy, 0);
        this.sun.target.updateMatrixWorld();
        const shadow = this.sun.shadow.camera;
        shadow.left = -reach;
        shadow.right = reach;
        shadow.top = reach;
        shadow.bottom = -reach;
        shadow.near = 0.1;
        shadow.far = reach * 4;
        shadow.updateProjectionMatrix();
    }

    /** The brightest of `lights`, canvas pixels on a canvas `widthPx` by `heightPx` at `scale`, as point lights. */
    shed(lights: Lights, widthPx: number, heightPx: number, scale: number): void {
        const order: number[] = [];
        for (let k = 0; k < lights.count; k++) if (lights.lightless[k] !== 1) order.push(k);
        order.sort((p, q) => lights.brightness[q]! * lights.radius[q]! - lights.brightness[p]! * lights.radius[p]!);
        for (let n = 0; n < POINT_LIGHTS; n++) {
            const point = this.points[n]!;
            const k = order[n];
            if (k === undefined) {
                point.intensity = 0;
                continue;
            }
            const x = ((lights.x0[k]! + lights.x1[k]!) / 2 - widthPx / 2) / scale;
            const y = -((lights.y0[k]! + lights.y1[k]!) / 2 - heightPx / 2) / scale;
            const reach = (lights.radius[k]! * 3) / scale;
            const standing = lights.standing[k]!;
            const z = Number.isNaN(standing) ? lights.height[k]! / scale : standing;
            point.position.set(x, y, z + reach * 0.15);
            point.color = new Color(lights.colour[k]!);
            point.distance = reach;
            point.decay = 1;
            point.intensity = Math.min(4, lights.brightness[k]!) * 6;
        }
    }

    /** Build `ship`'s model and its wear afresh into `kept`. */
    private fill(kept: Kept, ship: ShipView): void {
        this.empty(kept);
        const built = build(ship);
        kept.model.geometry = built.model;
        // Over the model's own faces: a livery, then wear over that.
        for (const { geometry, key, tile } of built.patterned) {
            const mesh = new Mesh(geometry, this.patternMaterial(key, tile));
            mesh.receiveShadow = true;
            mesh.renderOrder = 1;
            kept.group.add(mesh);
            kept.worn.push(mesh);
        }
        for (const [level, geometry] of built.worn) {
            const mesh = new Mesh(geometry, this.wearMaterial(level));
            mesh.receiveShadow = true;
            mesh.renderOrder = 2;
            kept.group.add(mesh);
            kept.worn.push(mesh);
        }
    }

    private empty(kept: Kept): void {
        kept.model.geometry.dispose();
        for (const mesh of kept.worn) {
            mesh.geometry.dispose();
            kept.group.remove(mesh);
        }
        kept.worn.length = 0;
    }

    private readonly patternMaterials = new Map<string, MeshLambertMaterial>();

    /** A livery's tile, repeating, the right way up, lit as the hull is and laid just over it. */
    private patternMaterial(key: string, tile: HTMLCanvasElement | OffscreenCanvas): MeshLambertMaterial {
        let material = this.patternMaterials.get(key);
        if (material === undefined) {
            const map = new CanvasTexture(tile as HTMLCanvasElement);
            map.colorSpace = NoColorSpace;
            map.wrapS = RepeatWrapping;
            map.wrapT = RepeatWrapping;
            map.flipY = false;
            map.anisotropy = 4;
            material = new MeshLambertMaterial({
                map,
                transparent: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -4,
            });
            this.patternMaterials.set(key, material);
        }
        return material;
    }

    private readonly wearMaterials = new Map<number, MeshLambertMaterial>();

    /** The wear tile for `level`, repeating, lit as the hull is and laid just over it. */
    private wearMaterial(level: number): MeshLambertMaterial {
        let material = this.wearMaterials.get(level);
        if (material === undefined) {
            const tile = wearTile(level);
            let map: CanvasTexture | null = null;
            if (tile !== null) {
                map = new CanvasTexture(tile as HTMLCanvasElement);
                map.colorSpace = NoColorSpace;
                map.wrapS = RepeatWrapping;
                map.wrapT = RepeatWrapping;
                map.anisotropy = 4;
            }
            material = new MeshLambertMaterial({
                map,
                transparent: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -4,
            });
            this.wearMaterials.set(level, material);
        }
        return material;
    }

    dispose(): void {
        for (const kept of this.kept.values()) this.empty(kept);
        this.kept.clear();
        this.barrels.dispose();
        this.material.dispose();
        this.unitBarrel.dispose();
        this.barrelMaterial.dispose();
        for (const material of [...this.patternMaterials.values(), ...this.wearMaterials.values()]) {
            material.map?.dispose();
            material.dispose();
        }
        this.patternMaterials.clear();
        this.wearMaterials.clear();
    }
}

/** What a ship's model is built from, which changes as it is damaged or built. */
function keyOf(ship: ShipView): string {
    const design = ship.currentStructure;
    let key = `${ship.team}|`;
    for (let i = 0; i < design.modules.length; i++) {
        const drawn = ship.drawn?.[i] !== false;
        const burnt = (ship.integrity?.[i] ?? 1) <= 0;
        const worn = wearLevel(ship.integrity?.[i] ?? 1).toString(17);
        key += drawn ? (burnt ? "x" : `${ship.sides?.[i] ?? ship.team}${worn}`) : "-";
    }
    // Each side's colours and livery, so a change to either is seen.
    for (let side = -1; side < SIDES_KEYED; side++) key += `|${idOf(shipColours(side))}.${idOf(teamLivery(side))}`;
    return key + designId(design);
}

/** Sides whose colours a model's key follows; enough for any battle's. */
const SIDES_KEYED = 8;
const ids = new WeakMap<object, number>();
let nextId = 0;
function idOf(thing: object | undefined): number {
    if (thing === undefined) return -1;
    let id = ids.get(thing);
    if (id === undefined) ids.set(thing, (id = nextId++));
    return id;
}

const designIds = new WeakMap<ShipDesign, number>();
let nextDesign = 0;
function designId(design: ShipDesign): number {
    let id = designIds.get(design);
    if (id === undefined) designIds.set(design, (id = nextDesign++));
    return id;
}
