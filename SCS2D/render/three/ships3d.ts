import {
    AmbientLight,
    BufferAttribute,
    BufferGeometry,
    Color,
    CylinderGeometry,
    DirectionalLight,
    Group,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshLambertMaterial,
    PCFShadowMap,
    PointLight,
    Quaternion,
    Scene,
    Vector3,
    type WebGLRenderer,
} from "three";
import { DECK_HEIGHT, domeRadius, isDomed, isHullMount, type ShipDesign, type ShipView, type Snapshot } from "../../sim/index.js";
import { drawnMounts } from "../bevels.js";
import { barrelLines } from "../barrels.js";
import type { Camera } from "../camera.js";
import { engineLayout } from "../engineLayout.js";
import type { Lights } from "../glows.js";
import { DEFAULT_LIGHT, fighterHeight, KERNEL_RISE, rockHeight, THICK_ROCK_RISE, type Light } from "../light.js";
import { BARREL, fillColour, isFighterModule, moduleFills, paintedSide, type Fill } from "../moduleFills.js";
import { parseColour } from "../pixiCanvas.js";
import { fighterColours, shipColours } from "../teams.js";
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
export type Depths = "layers" | "stats";

/** Thin and thick, in the layers' reading: a thick module stands a deck above and below the thin hull. */
const THIN = DECK_HEIGHT;
const THICK = 3 * DECK_HEIGHT;
/** How much higher each fill of a module stands than the one under it, so their tops do not fight. */
const STACK = 0.02;
/** Corners round a cylinder, dome or cone. */
const ROUND = 20;
/** Dynamic lights shed as point lights: the brightest this many. */
const POINT_LIGHTS = 8;

class Builder {
    readonly pos: number[] = [];
    readonly nor: number[] = [];
    readonly col: number[] = [];
    /** Module frame to ship frame, and how high its middle is. */
    x = 0;
    y = 0;
    c = 1;
    s = 0;
    z = 0;

    place(x: number, y: number, angle: number, z: number): void {
        this.x = x;
        this.y = y;
        this.c = Math.cos(angle);
        this.s = Math.sin(angle);
        this.z = z;
    }

    private vertex(px: number, py: number, pz: number, nx: number, ny: number, nz: number, r: number, g: number, b: number): void {
        this.pos.push(this.x + px * this.c - py * this.s, this.y + px * this.s + py * this.c, this.z + pz);
        this.nor.push(nx * this.c - ny * this.s, nx * this.s + ny * this.c, nz);
        this.col.push(r, g, b);
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
    ): void {
        const ring = (x: number, r: number, k: number): number[] => {
            const a = (k / ROUND) * 2 * Math.PI;
            return [x, y + Math.cos(a) * r, z + Math.sin(a) * r * squash];
        };
        for (let k = 0; k < ROUND; k++) {
            const a0 = ring(x0, r0, k);
            const a1 = ring(x0, r0, k + 1);
            const b0 = ring(x1, r1, k);
            const b1 = ring(x1, r1, k + 1);
            this.tri(a0, b0, b1, rgb);
            this.tri(a0, b1, a1, rgb);
            if (capped) {
                this.tri([x0, y, z], a1, a0, rgb);
                this.tri([x1, y, z], b0, b1, rgb);
            }
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

/** How deep module `i` is drawn. */
export function moduleDepth(design: ShipDesign, i: number, depths: Depths): number {
    const m = design.modules[i]!;
    const kind = m.spec.kind;
    if (kind === "rock" || kind === "kernel") {
        const rock = rockHeight(design.radius) * 2;
        if (depths === "stats") return m.stats.thickness;
        return kind === "kernel" ? rock * KERNEL_RISE : m.weaponsLayer ? rock * THICK_ROCK_RISE : rock;
    }
    if (depths === "stats") return isDomed(kind) ? Math.min(m.stats.thickness, THIN) : m.stats.thickness;
    return m.weaponsLayer && !isDomed(kind) ? THICK : THIN;
}

/** A ship's modules as one model, in its own frame, its middle at the deck. */
function build(ship: ShipView, depths: Depths): BufferGeometry {
    const design = ship.currentStructure;
    const b = new Builder();
    for (let i = 0; i < design.modules.length; i++) {
        if (ship.drawn?.[i] === false) continue;
        const m = design.modules[i]!;
        const spec = m.spec;
        const fighterPart = isFighterModule(design, i) && !design.fighter;
        const side = paintedSide(ship, i);
        const colours = isFighterModule(design, i) ? fighterColours(side) : shipColours(side);
        const integrity = ship.integrity?.[i] ?? 1;
        const burnt = integrity <= 0 && spec.kind !== "rock" && spec.kind !== "kernel";
        const shade = (rgb: readonly number[]): readonly number[] => (burnt ? rgb.map((v) => v * SOOT_SHARE) : rgb);
        const depth = moduleDepth(design, i, depths);
        // A fighter parked aboard sits on the deck it is parked on.
        b.place(m.x, m.y, m.angle, fighterPart ? THIN / 2 + depth / 2 : 0);
        moduleFills(spec, fillColour(spec, colours), colours, integrity, fills, drawnMounts(design, i).polygons);
        const half = depth / 2;
        if (spec.kind === "engine") {
            const layout = engineLayout(spec);
            fills.forEach((fill, k) => {
                const p = fill.points;
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
                // A bell, behind the block: a cone, from its throat out to its exit.
                if (x1 <= layout.mouth + 1e-6 && p.length >= 6) {
                    const y = (y0 + y1) / 2;
                    const widthAt = (x: number): number => {
                        let most = 0;
                        for (let v = 0; v < p.length; v += 2)
                            if (Math.abs(p[v]! - x) < (x1 - x0) * 0.05 + 1e-6) most = Math.max(most, Math.abs(p[v + 1]! - y));
                        return most;
                    };
                    const r0 = Math.max(widthAt(x0), 0.05);
                    const r1 = Math.max(widthAt(x1), 0.05);
                    b.lying(x0, x1, y, 0, r0, r1, Math.min(1, half / Math.max(r0, r1, 1e-6)), shade(rgbOf(fill.colour)), false);
                } else b.prism(p, -half - k * STACK, half + k * STACK, shade(rgbOf(fill.colour)));
            });
            continue;
        }
        if (spec.kind === "tank" && fills.length > 0 && fills[0]!.points.length === 8) {
            // A tank: a cylinder along its length, as deep as the module.
            const long = spec.length >= spec.width;
            const r = (long ? spec.width : spec.length) / 2;
            const l = (long ? spec.length : spec.width) / 2;
            const rgb = shade(rgbOf(fills[0]!.colour));
            if (long) b.lying(-l, l, 0, 0, r, r, half / r, rgb);
            else {
                b.place(m.x, m.y, m.angle + Math.PI / 2, 0);
                b.lying(-l, l, 0, 0, r, r, half / r, rgb);
                b.place(m.x, m.y, m.angle, 0);
            }
            fills.slice(1).forEach((fill) => b.prism(fill.points, half - STACK, half + STACK, shade(rgbOf(fill.colour))));
            continue;
        }
        fills.forEach((fill, k) => b.prism(fill.points, -half - k * STACK, half + k * STACK, shade(rgbOf(fill.colour))));
        if (isDomed(spec.kind)) b.dome(0, 0, half, domeRadius(spec), shade(rgbOf(colours.highlight ?? colours.pivot)));
    }
    return b.geometry();
}

/** How high above the deck a ship's middle is: a flying fighter above the thick modules, anything else on the deck. */
function heightOf(ship: ShipView): number {
    if (!ship.currentStructure.fighter) return 0;
    return THICK / 2 + 2 * fighterHeight(ship.riding, ship.lowered);
}

interface Kept {
    key: string;
    mesh: Mesh;
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

    private makeBarrels(count: number): InstancedMesh {
        const mesh = new InstancedMesh(this.unitBarrel, this.barrelMaterial, count);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        return mesh;
    }

    /** Place every ship in view, its barrels, and the lights, for a view `halfW` by `halfH` metres either side of the camera. */
    update(snapshot: Snapshot, camera: Camera, halfW: number, halfH: number, depths: Depths, light: Light = DEFAULT_LIGHT): void {
        this.light(light, Math.max(halfW, halfH));
        const seen = new Set<number>();
        let barrels = 0;
        const ends: number[] = [];
        for (let s = 0; s < snapshot.shipCount; s++) {
            const ship = snapshot.ships[s]!;
            const design = ship.currentStructure;
            const dx = ship.x - camera.x;
            const dy = ship.y - camera.y;
            const reach = design.radius * 1.5 + 10;
            if (Math.abs(dx) - reach > halfW * 1.5 || Math.abs(dy) - reach > halfH * 1.5) continue;
            seen.add(ship.body);
            const key = keyOf(ship, depths);
            let kept = this.kept.get(ship.body);
            if (kept === undefined || kept.key !== key) {
                if (kept !== undefined) {
                    kept.mesh.geometry.dispose();
                    kept.mesh.geometry = build(ship, depths);
                    kept.key = key;
                } else {
                    const mesh = new Mesh(build(ship, depths), this.material);
                    mesh.castShadow = true;
                    mesh.receiveShadow = true;
                    this.ships.add(mesh);
                    kept = { key, mesh };
                    this.kept.set(ship.body, kept);
                }
            }
            const z = heightOf(ship);
            kept.mesh.position.set(dx, dy, z);
            kept.mesh.rotation.set(0, 0, ship.angle);
            kept.mesh.visible = true;
            // Barrels, turned each frame: on top of a turret's dome, along a hull mount's middle.
            for (let t = 0; t < design.turrets.length; t++) {
                const module = design.turrets[t]!.module;
                if (ship.drawn?.[module] === false) continue;
                const m = design.modules[module]!;
                const depth = moduleDepth(design, module, depths);
                const domed = isDomed(m.spec.kind);
                const parked = isFighterModule(design, module) && !design.fighter;
                const lift =
                    z +
                    (parked ? THIN / 2 + depth / 2 : 0) +
                    (domed ? depth / 2 + domeRadius(m.spec) * 0.55 : isHullMount(m.spec.kind) ? 0 : depth / 2);
                ends.length = 0;
                const width = barrelLines(ship, t, (x0, y0, x1, y1) =>
                    ends.push(x0 - camera.x, y0 - camera.y, x1 - camera.x, y1 - camera.y),
                );
                for (let k = 0; k < ends.length; k += 4) {
                    if (barrels >= this.barrels.count) {
                        this.scene.remove(this.barrels);
                        this.barrels.dispose();
                        this.barrels = this.makeBarrels(this.barrels.count * 2);
                        // Placed again from the start next frame; this one shows those it had room for.
                        break;
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
            if (seen.has(body)) continue;
            // Gone, or out of view: let it go once it has been out of view a while.
            kept.mesh.visible = false;
            if (!snapshot.ships.slice(0, snapshot.shipCount).some((ship) => ship.body === body)) {
                kept.mesh.geometry.dispose();
                this.ships.remove(kept.mesh);
                this.kept.delete(body);
            }
        }
    }

    /** The battle's light as the sun, and the brightest dynamic lights, given in canvas pixels, as point lights. */
    private light(light: Light, reach: number): void {
        const slant = light.slant ?? 1;
        const toward = new Vector3(Math.cos(light.from) * slant, Math.sin(light.from) * slant, 1).normalize();
        this.sun.color = new Color(light.colour);
        // Lambert in three.js is divided by π, and a top facing up takes the light at a slant.
        this.sun.intensity = (Math.PI * (1 - light.ambient)) / toward.z;
        this.ambient.color = new Color(light.colour);
        this.ambient.intensity = Math.PI * light.ambient;
        this.sun.position.copy(toward).multiplyScalar(reach * 4);
        this.sun.target.position.set(0, 0, 0);
        const shadow = this.sun.shadow.camera;
        shadow.left = -reach * 1.5;
        shadow.right = reach * 1.5;
        shadow.top = reach * 1.5;
        shadow.bottom = -reach * 1.5;
        shadow.near = 0.1;
        shadow.far = reach * 8;
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
            point.position.set(x, y, lights.height[k]! / scale + reach * 0.15);
            point.color = new Color(lights.colour[k]!);
            point.distance = reach;
            point.decay = 1;
            point.intensity = Math.min(4, lights.brightness[k]!) * 6;
        }
    }

    dispose(): void {
        for (const kept of this.kept.values()) kept.mesh.geometry.dispose();
        this.kept.clear();
        this.barrels.dispose();
        this.material.dispose();
    }
}

/** What a ship's model is built from, which changes as it is damaged or built. */
function keyOf(ship: ShipView, depths: Depths): string {
    const design = ship.currentStructure;
    let key = `${depths}|${ship.team}|`;
    for (let i = 0; i < design.modules.length; i++) {
        const drawn = ship.drawn?.[i] !== false;
        const burnt = (ship.integrity?.[i] ?? 1) <= 0;
        key += drawn ? (burnt ? "x" : String(ship.sides?.[i] ?? ship.team)) : "-";
    }
    return key + designId(design);
}

const designIds = new WeakMap<ShipDesign, number>();
let nextDesign = 0;
function designId(design: ShipDesign): number {
    let id = designIds.get(design);
    if (id === undefined) designIds.set(design, (id = nextDesign++));
    return id;
}
