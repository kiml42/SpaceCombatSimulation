import {
    AlwaysStencilFunc,
    CanvasTexture,
    CustomBlending,
    DoubleSide,
    EqualStencilFunc,
    Group,
    Mesh,
    MeshBasicMaterial,
    NormalBlending,
    OneFactor,
    AddEquation,
    ReplaceStencilOp,
    RepeatWrapping,
    ShaderMaterial,
    type Texture,
    ZeroStencilOp,
    KeepStencilOp,
    type Material,
} from "three";
import { isDomed, originOf, type Livery, type ModuleSpec, type ShipDesign, type Snapshot } from "../../sim/index.js";
import { SCAR_VIEW_STRIDE } from "../../sim/index.js";
import { patternColour, patternTile, patternTransform, tileKey, type Affine } from "../livery.js";
import {
    BEVEL_DARK,
    BEVEL_LIGHT,
    BEVEL_OF_RADIUS,
    BEVEL_STRIDE,
    bevelQuad,
    drawnBevels,
    drawnMounts,
    MIN_BEVEL_LIT,
    MIN_BEVEL_PX,
    mountsOf,
    type Mounts,
} from "../bevels.js";
import { domeOutline, footprintOf, shapesOf } from "../blocks.js";
import { engineLayout } from "../engineLayout.js";
import { lightSlope } from "../shading.js";
import type { Camera } from "../camera.js";
import {
    BARREL_SHADOW_M,
    DEFAULT_LIGHT,
    fighterHeight,
    KERNEL_RISE,
    LANDED_SHADOW_M,
    rockHeight,
    THICK_ROCK_RISE,
    THICK_SHADOW_M,
    type Light,
} from "../light.js";
import { barrelLines, MIN_BARREL_PX } from "../barrels.js";
import { fillAlpha, fillColour, isFighterModule, moduleFills, padMark, paintedSide, type Fill } from "../moduleFills.js";
import { legibleWidth } from "../strokes.js";
import { MIN_SCAR_PX, scarShapes, scarWidth, type Bounds, type ScarShape } from "../scars.js";
import { holeMarkWidth, leakHoleShapes, scratchShows } from "../leakHoles.js";
import { SOOT, SOOT_ALPHA, wearLevel, wearSeed, wearShows, wearTile, wearTransform } from "../wear.js";
import { shipColours, teamLivery, type Palette } from "../teams.js";
import { blockShadow } from "../hullLayer.js";
import { parseColour } from "../pixiCanvas.js";
import { Batch, configure, strokeLine, triangulate, uploadBatch } from "./threeCanvas.js";

/**
 * `HullLayer`'s twin in three.js: the capital ships' module fills, bevels,
 * scars and the shadows the thick modules, rock and fighters cast, in metres
 * from the camera, y up. A shadow is cut to what may take it with the stencil
 * buffer, which also keeps where two shadows overlap from being any darker.
 */

/** Triangles kept from frame to frame: x, y, r, g, b, a, u, v a corner, by the texture they are drawn with. */
interface Piece {
    readonly texture: Texture | null;
    readonly data: number[];
}

/** A module's or a ship's shapes, triangulated once, in its own frame. */
class Shapes {
    readonly pieces: Piece[] = [];

    private piece(texture: Texture | null): Piece {
        const last = this.pieces[this.pieces.length - 1];
        if (last !== undefined && last.texture === texture) return last;
        const made = { texture, data: [] };
        this.pieces.push(made);
        return made;
    }

    poly(points: readonly number[], colour: string | number, alpha = 1): void {
        const [rgb, a] = typeof colour === "number" ? [colour, 1] : parseColour(colour);
        const r = ((rgb >> 16) & 0xff) / 255;
        const g = ((rgb >> 8) & 0xff) / 255;
        const b = (rgb & 0xff) / 255;
        const data = this.piece(null).data;
        triangulate(points, (x, y) => data.push(x, y, r, g, b, a * alpha, 0, 0));
    }

    /** `points` filled with `texture` repeated, laid by `t` (tile pixels to this frame), `size` pixels a tile. */
    textured(points: readonly number[], texture: Texture, t: Affine, width: number, height: number, alpha = 1): void {
        const det = t.a * t.d - t.b * t.c;
        if (det === 0) return;
        const data = this.piece(texture).data;
        triangulate(points, (x, y) => {
            const dx = x - t.e;
            const dy = y - t.f;
            data.push(x, y, 1, 1, 1, alpha, (t.d * dx - t.c * dy) / det / width, (-t.b * dx + t.a * dy) / det / height);
        });
    }

    line(points: readonly number[], closed: boolean, width: number, colour: string | number): void {
        const [rgb, a] = typeof colour === "number" ? [colour, 1] : parseColour(colour);
        const r = ((rgb >> 16) & 0xff) / 255;
        const g = ((rgb >> 8) & 0xff) / 255;
        const b = (rgb & 0xff) / 255;
        const data = this.piece(null).data;
        strokeLine(points, closed, width / 2, "butt", (x, y) => data.push(x, y, r, g, b, a, 0, 0));
    }
}

/** Triangles placed afresh each frame, a batch a texture, drawn with one material each. */
class Layer {
    readonly group = new Group();
    private readonly batches = new Map<Texture | null, Batch>();
    private readonly meshes = new Map<Texture | null, Mesh>();
    /** Every layer's vertices multiplied by this colour. */
    tint: [number, number, number] = [1, 1, 1];

    constructor(private readonly material: (texture: Texture | null) => Material) {}

    begin(): void {
        for (const batch of this.batches.values()) batch.count = 0;
    }

    private batch(texture: Texture | null): Batch {
        let batch = this.batches.get(texture);
        if (batch === undefined) {
            batch = new Batch();
            batch.reset(texture !== null, texture, false, null);
            this.batches.set(texture, batch);
        }
        return batch;
    }

    /** `shapes` turned by `angle` and moved to `(x, y)`, its alpha times `alpha`. */
    place(shapes: Shapes, x: number, y: number, angle: number, alpha = 1): void {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const [tr, tg, tb] = this.tint;
        for (const piece of shapes.pieces) {
            const batch = this.batch(piece.texture);
            const d = piece.data;
            for (let k = 0; k < d.length; k += 8) {
                const px = d[k]!;
                const py = d[k + 1]!;
                batch.vertex(
                    x + px * c - py * s,
                    y + px * s + py * c,
                    d[k + 2]! * tr,
                    d[k + 3]! * tg,
                    d[k + 4]! * tb,
                    d[k + 5]! * alpha,
                    d[k + 6]!,
                    d[k + 7]!,
                );
            }
        }
    }

    /** A polygon in the layer's own frame, in one colour. */
    poly(points: readonly number[], r: number, g: number, b: number, a: number): void {
        const batch = this.batch(null);
        triangulate(points, (x, y) => batch.vertex(x, y, r, g, b, a));
    }

    /** A line between each four numbers of `ends`, `width` wide. */
    lines(ends: readonly number[], width: number, r: number, g: number, b: number, a: number): void {
        const batch = this.batch(null);
        for (let k = 0; k + 3 < ends.length; k += 4) {
            strokeLine([ends[k]!, ends[k + 1]!, ends[k + 2]!, ends[k + 3]!], false, width / 2, "butt", (x, y) =>
                batch.vertex(x, y, r, g, b, a),
            );
        }
    }

    get count(): number {
        let n = 0;
        for (const batch of this.batches.values()) n += batch.count;
        return n;
    }

    /** Hand what was placed this frame to the meshes that draw it. */
    end(): void {
        for (const [texture, batch] of this.batches) {
            let mesh = this.meshes.get(texture);
            if (mesh === undefined) {
                mesh = new Mesh(undefined, this.material(texture));
                mesh.frustumCulled = false;
                this.meshes.set(texture, mesh);
                this.group.add(mesh);
            }
            mesh.visible = batch.count > 0;
            if (mesh.visible) uploadBatch(mesh, batch);
        }
    }
}

function plainMaterial(texture: Texture | null): MeshBasicMaterial {
    return new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
        map: texture,
        blending: NormalBlending,
    });
}

/** Writes where it covers into the stencil buffer, and nothing to the screen. */
function maskMaterial(): MeshBasicMaterial {
    return new MeshBasicMaterial({
        colorWrite: false,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
        stencilWrite: true,
        stencilFunc: AlwaysStencilFunc,
        stencilRef: 1,
        stencilZPass: ReplaceStencilOp,
    });
}

/** Black, at `alpha`, only where the stencil is set, and clearing it so nothing there is darkened twice. */
function shadowMaterial(): MeshBasicMaterial {
    return new MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.8,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
        stencilWrite: true,
        stencilFunc: EqualStencilFunc,
        stencilRef: 1,
        stencilFail: KeepStencilOp,
        stencilZFail: KeepStencilOp,
        stencilZPass: ZeroStencilOp,
    });
}

/** Lit by the light buffer: a fill's own colour times the light where it is on screen, added over the scene. */
export function litMaterial(): ShaderMaterial {
    return new ShaderMaterial({
        uniforms: {
            uLight: { value: null },
            uScreen: { value: [1, 1] },
            uGain: { value: 1 },
            uHeadroom: { value: 1 },
        },
        vertexColors: true,
        vertexShader: /* glsl */ `
            // Declared by three.js, as a vec4 since vertex colours here have alpha.
            varying vec4 vColour;
            void main() {
                vColour = color;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */ `
            uniform sampler2D uLight;
            uniform vec2 uScreen;
            uniform float uGain;
            uniform float uHeadroom;
            varying vec4 vColour;
            void main() {
                vec3 light = 1.0 - exp(-texture2D(uLight, gl_FragCoord.xy / uScreen).rgb * uHeadroom);
                gl_FragColor = vec4(vColour.rgb * light * uGain * vColour.a, 1.0);
            }
        `,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
        blending: CustomBlending,
        blendEquation: AddEquation,
        blendSrc: OneFactor,
        blendDst: OneFactor,
    });
}

/** Shadows masked to what may take them: the mask drawn into the stencil, then the shadows through it. */
export class StencilShadows {
    readonly mask = new Layer(() => maskMaterial());
    readonly shadows: Layer;
    private readonly material = shadowMaterial();

    constructor() {
        this.shadows = new Layer(() => this.material);
    }

    set alpha(alpha: number) {
        this.material.opacity = alpha;
    }

    begin(): void {
        this.mask.begin();
        this.shadows.begin();
    }

    end(): void {
        this.mask.end();
        this.shadows.end();
    }

    cast(
        spec: ModuleSpec,
        x: number,
        y: number,
        angle: number,
        dx: number,
        dy: number,
        footprint: readonly (readonly number[])[] = shapesOf(spec),
    ): void {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        for (const corners of footprint) {
            const placed: number[] = [];
            for (let k = 0; k < corners.length; k += 2) {
                placed.push(x + corners[k]! * c - corners[k + 1]! * s, y + corners[k]! * s + corners[k + 1]! * c);
            }
            this.shadows.poly(blockShadow(placed, dx, dy), 0, 0, 0, 1);
        }
    }
}

/** What to draw, in order, for the hulls: a group, or a clear of the stencil before a mask. */
export type HullPass =
    | { readonly draw: Group }
    | { readonly clearStencil: true }
    | { readonly deck: true }
    | { readonly lit: "deck" | "thick"; readonly draw: Group };

export class ThreeHulls {
    readonly thin = new Layer(plainMaterial);
    readonly thick = new Layer(plainMaterial);
    readonly rock = new Layer(plainMaterial);
    readonly thickRock = new Layer(plainMaterial);
    readonly kernel = new Layer(plainMaterial);
    readonly thinBevels = new Layer(plainMaterial);
    readonly thickBevels = new Layer(plainMaterial);
    readonly thinScars = new Layer(plainMaterial);
    readonly thickScars = new Layer(plainMaterial);
    readonly thinHoles = new Layer(plainMaterial);
    readonly thickHoles = new Layer(plainMaterial);
    readonly thickShadows = new StencilShadows();
    readonly fighterShadows = new StencilShadows();
    readonly rockShadows = new StencilShadows();
    readonly thickRockShadows = new StencilShadows();
    readonly kernelShadows = new StencilShadows();
    /** The fills again, untinted, for the dynamic lights. */
    readonly deckLit: ShaderMaterial = litMaterial();
    readonly thickLit: ShaderMaterial = litMaterial();
    readonly lit = new Layer(() => this.deckLit);
    readonly litThick = new Layer(() => this.thickLit);
    /** Whether to fill `lit` and `litThick`. */
    lighting = false;
    private light: Light | null = null;
    private readonly quad: number[] = [];
    private readonly barrelEnds: number[] = [];

    /** The passes, lowest first, as `HullLayer` orders its containers. */
    readonly passes: readonly HullPass[] = [
        { draw: this.thin.group },
        { draw: this.thinBevels.group },
        { draw: this.thinScars.group },
        { draw: this.thinHoles.group },
        { clearStencil: true },
        { draw: this.thickShadows.mask.group },
        { draw: this.thickShadows.shadows.group },
        { clearStencil: true },
        { draw: this.fighterShadows.mask.group },
        { draw: this.fighterShadows.shadows.group },
        { deck: true },
        { draw: this.thick.group },
        { draw: this.thickBevels.group },
        { draw: this.thickScars.group },
        { draw: this.thickHoles.group },
        { clearStencil: true },
        { draw: this.rockShadows.mask.group },
        { draw: this.rockShadows.shadows.group },
        { draw: this.rock.group },
        { clearStencil: true },
        { draw: this.thickRockShadows.mask.group },
        { draw: this.thickRockShadows.shadows.group },
        { draw: this.thickRock.group },
        { clearStencil: true },
        { draw: this.kernelShadows.mask.group },
        { draw: this.kernelShadows.shadows.group },
        { draw: this.kernel.group },
        { lit: "deck", draw: this.lit.group },
        { lit: "thick", draw: this.litThick.group },
    ];

    update(snapshot: Snapshot, camera: Camera, widthPx: number, heightPx: number, light: Light = DEFAULT_LIGHT): void {
        this.see(light);
        const halfW = widthPx / 2 / camera.scale;
        const halfH = heightPx / 2 / camera.scale;
        const slant = light.slant ?? 1;
        const awayX = -Math.cos(light.from) * slant;
        const awayY = -Math.sin(light.from) * slant;
        for (const layer of this.layers()) layer.begin();
        for (const shadows of this.allShadows()) shadows.begin();
        const { across } = lightSlope(light);
        const towardX = Math.cos(light.from) * across;
        const towardY = Math.sin(light.from) * across;
        for (let s = 0; s < snapshot.shipCount; s++) {
            const ship = snapshot.ships[s]!;
            const design = ship.currentStructure;
            const dx = ship.x - camera.x;
            const dy = ship.y - camera.y;
            const rock = rockHeight(design.radius);
            const reach = design.radius + rock * KERNEL_RISE;
            if (Math.abs(dx) - reach > halfW || Math.abs(dy) - reach > halfH) continue;
            const sc = Math.cos(ship.angle);
            const ss = Math.sin(ship.angle);
            const worn = wearShows(design.radius, camera.scale);
            for (let i = 0; i < design.modules.length; i++) {
                if (ship.drawn?.[i] === false) continue;
                const m = design.modules[i]!;
                const x = dx + m.x * sc - m.y * ss;
                const y = dy + m.x * ss + m.y * sc;
                const angle = ship.angle + m.angle;
                const mounts = drawnMounts(design, i);
                const outline = outlineFor(m.spec, mounts);
                if (isFighterModule(design, i)) {
                    const height = design.fighter ? fighterHeight(ship.riding, ship.lowered) : LANDED_SHADOW_M;
                    this.fighterShadows.shadows.place(outline, x + awayX * height, y + awayY * height, angle);
                    continue;
                }
                const fill = shapesFor(design, i, paintedSide(ship, i), ship.integrity?.[i] ?? 1, worn ? wearSeed(ship) : null);
                const kind = m.spec.kind;
                const domed = isDomed(kind);
                const depth =
                    kind === "kernel"
                        ? this.kernel
                        : kind === "rock"
                          ? m.weaponsLayer
                              ? this.thickRock
                              : this.rock
                          : m.weaponsLayer && !domed
                            ? this.thick
                            : this.thin;
                const alpha = fillAlpha(ship, i);
                depth.place(fill, x, y, angle, alpha);
                if (this.lighting) (depth === this.thick ? this.litThick : this.lit).place(fill, x, y, angle, alpha);
                if (depth === this.thin || depth === this.thick) {
                    const origin = originOf(design, i);
                    const bevel = BEVEL_OF_RADIUS * origin.design.radius;
                    if (bevel * camera.scale >= MIN_BEVEL_PX) {
                        this.bevel(
                            depth === this.thin ? this.thinBevels : this.thickBevels,
                            drawnBevels(design, i),
                            x,
                            y,
                            angle,
                            bevel,
                            towardX,
                            towardY,
                            alpha,
                        );
                    }
                }
                if (depth === this.thin) {
                    this.thickShadows.mask.place(outline, x, y, angle);
                    this.fighterShadows.mask.place(outline, x, y, angle);
                }
                if (depth === this.thin || depth === this.thick) this.rockShadows.mask.place(outline, x, y, angle);
                if (depth === this.rock) this.thickRockShadows.mask.place(outline, x, y, angle);
                if (depth === this.rock || depth === this.thickRock) this.kernelShadows.mask.place(outline, x, y, angle);
                const cast = (on: StencilShadows, length: number): void =>
                    on.cast(m.spec, x, y, angle, awayX * length, awayY * length, footprintOf(m.spec, mounts));
                if (depth === this.thick) cast(this.thickShadows, THICK_SHADOW_M);
                else if (domed)
                    this.thickShadows.cast(m.spec, x, y, angle, awayX * THICK_SHADOW_M, awayY * THICK_SHADOW_M, [domeOutline(m.spec)]);
                else if (depth === this.thickRock) {
                    cast(this.rockShadows, rock * (THICK_ROCK_RISE - 1));
                    cast(this.thickRockShadows, rock * (THICK_ROCK_RISE - 1));
                } else if (depth === this.kernel) cast(this.kernelShadows, rock * (KERNEL_RISE - THICK_ROCK_RISE));
            }
            if ((ship.scars?.length ?? 0) > 0) {
                const scars = scarsOf(ship, camera.scale);
                if (scars.thin !== null) this.thinScars.place(scars.thin, dx, dy, ship.angle);
                if (scars.thick !== null) this.thickScars.place(scars.thick, dx, dy, ship.angle);
            }
            if ((ship.leakX?.length ?? 0) > 0) {
                const holes = holesOf(ship, camera.scale);
                if (holes.thin !== null) this.thinHoles.place(holes.thin, dx, dy, ship.angle);
                if (holes.thick !== null) this.thickHoles.place(holes.thick, dx, dy, ship.angle);
            }
            const bx = awayX * BARREL_SHADOW_M - camera.x;
            const by = awayY * BARREL_SHADOW_M - camera.y;
            for (let t = 0; t < design.turrets.length; t++) {
                const module = design.turrets[t]!.module;
                if (ship.drawn?.[module] === false || isFighterModule(design, module)) continue;
                if (!isDomed(design.modules[module]!.spec.kind)) continue;
                const ends = this.barrelEnds;
                ends.length = 0;
                const width = barrelLines(ship, t, (x0, y0, x1, y1) => ends.push(x0 + bx, y0 + by, x1 + bx, y1 + by));
                this.thickShadows.shadows.lines(ends, legibleWidth(width, MIN_BARREL_PX, camera.scale), 0, 0, 0, 1);
            }
            const height = design.fighter ? fighterHeight(ship.riding, ship.lowered) : LANDED_SHADOW_M;
            const fx = awayX * height - camera.x;
            const fy = awayY * height - camera.y;
            for (let t = 0; t < design.turrets.length; t++) {
                const module = design.turrets[t]!.module;
                if (ship.drawn?.[module] === false || !isFighterModule(design, module)) continue;
                const ends = this.barrelEnds;
                ends.length = 0;
                const width = barrelLines(ship, t, (x0, y0, x1, y1) => ends.push(x0 + fx, y0 + fy, x1 + fx, y1 + fy));
                this.fighterShadows.shadows.lines(ends, legibleWidth(width, MIN_BARREL_PX, camera.scale), 0, 0, 0, 1);
            }
        }
        for (const layer of this.layers()) layer.end();
        for (const shadows of this.allShadows()) shadows.end();
    }

    /** Whether anything is lit at a thick module's height. */
    get litThickCount(): number {
        return this.litThick.count;
    }

    private bevel(
        into: Layer,
        edges: readonly number[],
        x: number,
        y: number,
        angle: number,
        width: number,
        towardX: number,
        towardY: number,
        alpha: number,
    ): void {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const [tr, tg, tb] = into.tint;
        for (let k = 0; k < edges.length; k += BEVEL_STRIDE) {
            const nx = edges[k + 4]! * c - edges[k + 5]! * s;
            const ny = edges[k + 4]! * s + edges[k + 5]! * c;
            const lit = nx * towardX + ny * towardY;
            if (Math.abs(lit) < MIN_BEVEL_LIT) continue;
            const quad = this.quad;
            bevelQuad(edges, k, width, quad);
            for (let v = 0; v < 8; v += 2) {
                const qx = quad[v]!;
                const qy = quad[v + 1]!;
                quad[v] = x + qx * c - qy * s;
                quad[v + 1] = y + qx * s + qy * c;
            }
            const a = alpha * Math.abs(lit) * (lit > 0 ? BEVEL_LIGHT : BEVEL_DARK);
            if (lit > 0) into.poly(quad, tr, tg, tb, a);
            else into.poly(quad, 0, 0, 0, a);
        }
    }

    private see(light: Light): void {
        if (this.light === light) return;
        this.light = light;
        const [rgb] = parseColour(light.colour);
        const tint: [number, number, number] = [((rgb >> 16) & 0xff) / 255, ((rgb >> 8) & 0xff) / 255, (rgb & 0xff) / 255];
        for (const layer of [this.thin, this.thick, this.rock, this.thickRock, this.kernel, this.thinBevels, this.thickBevels])
            layer.tint = tint;
        for (const shadows of this.allShadows()) shadows.alpha = 1 - light.ambient;
    }

    private allShadows(): StencilShadows[] {
        return [this.thickShadows, this.fighterShadows, this.rockShadows, this.thickRockShadows, this.kernelShadows];
    }

    private layers(): Layer[] {
        return [
            this.thin,
            this.thick,
            this.rock,
            this.thickRock,
            this.kernel,
            this.thinBevels,
            this.thickBevels,
            this.thinScars,
            this.thickScars,
            this.thinHoles,
            this.thickHoles,
            this.lit,
            this.litThick,
        ];
    }
}

// The shapes each module is filled with, kept as hullLayer.ts keeps its GraphicsContexts.

const plain = new WeakMap<ModuleSpec, Map<string, Shapes>>();
const outlines = new WeakMap<ModuleSpec, Map<string, Shapes>>();
const fills: Fill[] = [];

function shapesFor(design: ShipDesign, i: number, side: number, integrity: number, seed: number | null): Shapes {
    const m = design.modules[i]!;
    const spec = m.spec;
    const ground = spec.kind === "rock" || spec.kind === "kernel";
    const livery = ground ? undefined : teamLivery(side);
    const level = ground || seed === null ? 0 : wearLevel(integrity);
    const burnt = !ground && integrity <= 0;
    if (level > 0 || burnt) return wornShapes(design, i, side, integrity, livery, level, burnt, seed ?? 0);
    if (livery !== undefined && livery.pattern !== "none") return patternedShapes(design, i, side, integrity, livery);
    return plainShapes(spec, side, integrity, drawnMounts(design, i));
}

function plainShapes(spec: ModuleSpec, side: number, integrity: number, mounts: Mounts): Shapes {
    const colours = shipColours(side);
    const colour = fillColour(spec, colours);
    const key = `${colour}|${colours.hull}${colours.trim}${colours.pivot}|${integrity <= 0}|${mounts.key}`;
    let bySpec = plain.get(spec);
    if (bySpec === undefined) {
        bySpec = new Map();
        plain.set(spec, bySpec);
    }
    let shapes = bySpec.get(key);
    if (shapes === undefined) {
        shapes = new Shapes();
        moduleFills(spec, colour, colours, integrity, fills, mounts.polygons);
        for (const fill of fills) shapes.poly(fill.points, fill.colour);
        markPad(shapes, spec, colours);
        bySpec.set(key, shapes);
    }
    return shapes;
}

function markPad(shapes: Shapes, spec: ModuleSpec, colours: Palette): void {
    if (spec.kind !== "pad") return;
    const mark = padMark(spec);
    const { x, y, width, height } = mark;
    shapes.line([x, y, x + width, y, x + width, y + height, x, y + height], true, mark.line, colours.highlight ?? colours.trim);
}

const patterned = new WeakMap<ShipDesign, Map<string, Shapes>>();
const patternTextures = new Map<string, { texture: Texture; size: number } | null>();

function patternedShapes(design: ShipDesign, i: number, side: number, integrity: number, livery: Livery): Shapes {
    const m = design.modules[i]!;
    const colours = shipColours(side);
    const colour = fillColour(m.spec, colours);
    const origin = originOf(design, i);
    const key =
        `${origin.module}|${colour}|${colours.hull}${colours.trim}${colours.pivot}${colours.highlight}|${integrity <= 0}|` +
        `${tileKey(livery, "")}|${livery.size}|${livery.spacing}|${livery.offset}|${livery.lateral}|${livery.angle}`;
    let byDesign = patterned.get(origin.design);
    if (byDesign === undefined) {
        byDesign = new Map();
        patterned.set(origin.design, byDesign);
    }
    let shapes = byDesign.get(key);
    if (shapes === undefined) {
        shapes = new Shapes();
        moduleFills(m.spec, colour, colours, integrity, fills, mountsOf(origin.design, origin.module).polygons);
        const t = patternTransform(livery, design, i);
        for (const fill of fills) {
            shapes.poly(fill.points, fill.colour);
            const over = patternColour(m.spec.kind, fill.colour, colours);
            const tile = over === null ? null : tileTexture(livery, over);
            if (tile !== null) shapes.textured(fill.points, tile.texture, t, tile.size, tile.size);
        }
        markPad(shapes, m.spec, colours);
        byDesign.set(key, shapes);
    }
    return shapes;
}

const wornShapesCache = new WeakMap<ShipDesign, Map<string, Shapes>>();
const wearTextures = new Map<number, { texture: Texture; size: number } | null>();

function wornShapes(
    design: ShipDesign,
    i: number,
    side: number,
    integrity: number,
    livery: Livery | undefined,
    level: number,
    burnt: boolean,
    seed: number,
): Shapes {
    const m = design.modules[i]!;
    const colours = shipColours(side);
    const colour = fillColour(m.spec, colours);
    const origin = originOf(design, i);
    const pattern = livery !== undefined && livery.pattern !== "none" ? livery : undefined;
    const shell = m.shell;
    const mounts = drawnMounts(design, i);
    const key =
        `${origin.module}|${shell === undefined ? "" : `${shell.face}|${shell.share}`}|${mounts.key}|` +
        `${colour}|${colours.hull}${colours.trim}${colours.pivot}${colours.highlight}|${level}|${burnt}|${level > 0 ? seed : ""}|` +
        (pattern === undefined
            ? ""
            : `${tileKey(pattern, "")}|${pattern.size}|${pattern.spacing}|${pattern.offset}|${pattern.lateral}|${pattern.angle}`);
    let byDesign = wornShapesCache.get(origin.design);
    if (byDesign === undefined) {
        byDesign = new Map();
        wornShapesCache.set(origin.design, byDesign);
    }
    let shapes = byDesign.get(key);
    if (shapes === undefined) {
        shapes = new Shapes();
        moduleFills(m.spec, colour, colours, integrity, fills, mounts.polygons);
        const t = pattern === undefined ? null : patternTransform(pattern, design, i);
        for (const fill of fills) {
            shapes.poly(fill.points, fill.colour);
            const over = pattern === undefined ? null : patternColour(m.spec.kind, fill.colour, colours);
            const tile = over === null ? null : tileTexture(pattern!, over);
            if (tile !== null) shapes.textured(fill.points, tile.texture, t!, tile.size, tile.size);
        }
        markPad(shapes, m.spec, colours);
        const w = wearTransform(design, i, seed);
        const wear = level > 0 ? wearTexture(level) : null;
        for (const fill of fills) {
            if (burnt) shapes.poly(fill.points, SOOT, SOOT_ALPHA);
            if (wear !== null) shapes.textured(fill.points, wear.texture, w, wear.size, wear.size);
        }
        byDesign.set(key, shapes);
    }
    return shapes;
}

function repeating(image: HTMLCanvasElement | OffscreenCanvas): { texture: Texture; size: number } {
    const texture = new CanvasTexture(image as HTMLCanvasElement);
    configure(texture);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    return { texture, size: image.width };
}

function wearTexture(level: number): { texture: Texture; size: number } | null {
    let texture = wearTextures.get(level);
    if (texture === undefined) {
        const tile = wearTile(level);
        texture = tile === null ? null : repeating(tile);
        wearTextures.set(level, texture);
    }
    return texture;
}

function tileTexture(livery: Livery, colour: string): { texture: Texture; size: number } | null {
    const key = tileKey(livery, colour);
    let texture = patternTextures.get(key);
    if (texture === undefined) {
        const tile = patternTile(livery, colour);
        texture = tile === null ? null : repeating(tile);
        patternTextures.set(key, texture);
    }
    return texture;
}

function outlineFor(spec: ModuleSpec, mounts: Mounts): Shapes {
    let byMounts = outlines.get(spec);
    if (byMounts === undefined) {
        byMounts = new Map();
        outlines.set(spec, byMounts);
    }
    let shapes = byMounts.get(mounts.key);
    if (shapes === undefined) {
        shapes = new Shapes();
        moduleFills(spec, "#000000", shipColours(0), 1, fills, mounts.polygons);
        for (const fill of fills) shapes.poly(fill.points, 0x000000);
        byMounts.set(mounts.key, shapes);
    }
    return shapes;
}

interface ShipMarks {
    readonly design: ShipDesign;
    readonly key: string;
    readonly thin: Shapes | null;
    readonly thick: Shapes | null;
}

const scarCache = new Map<number, ShipMarks>();
const holeCache = new Map<number, ShipMarks>();
const scratch: ScarShape[] = [];

function scarsOf(ship: Snapshot["ships"][number], scale: number): ShipMarks {
    const design = ship.currentStructure;
    const band = Math.round(Math.log2(scale));
    const key = `${ship.scarsVersion ?? 0}|${band}`;
    const kept = scarCache.get(ship.body);
    if (kept !== undefined && kept.design === design && kept.key === key) return kept;
    const scars = ship.scars ?? [];
    let thin: Shapes | null = null;
    let thick: Shapes | null = null;
    const least = MIN_SCAR_PX / 2 ** band;
    for (let k = 0; k + SCAR_VIEW_STRIDE <= scars.length; k += SCAR_VIEW_STRIDE) {
        const i = scars[k]!;
        const m = design.modules[i];
        if (m === undefined || m.spec.kind === "rock" || m.spec.kind === "kernel" || isFighterModule(design, i)) continue;
        if (scarWidth(scars, k, m.spec) < least) continue;
        const into = m.weaponsLayer && !isDomed(m.spec.kind) ? (thick ??= new Shapes()) : (thin ??= new Shapes());
        const box = boundsOf(m.spec);
        const cx = (scars[k + 3]! + scars[k + 5]!) / 2;
        const cy = (scars[k + 4]! + scars[k + 6]!) / 2;
        if (cx < box.x0 || cx > box.x1 || cy < box.y0 || cy > box.y1) continue;
        scratch.length = 0;
        scarShapes(scars, k, m.spec, box, scratch);
        placeMarks(into, m, scratch);
    }
    const made = { design, key, thin, thick };
    scarCache.set(ship.body, made);
    return made;
}

function placeMarks(into: Shapes, m: { x: number; y: number; angle: number }, shapes: readonly ScarShape[]): void {
    const c = Math.cos(m.angle);
    const s = Math.sin(m.angle);
    for (const shape of shapes) {
        const p = shape.points;
        for (let v = 0; v < p.length; v += 2) {
            const x = p[v]!;
            const y = p[v + 1]!;
            p[v] = m.x + x * c - y * s;
            p[v + 1] = m.y + x * s + y * c;
        }
        into.poly(p, shape.colour, shape.alpha);
    }
}

function holesOf(ship: Snapshot["ships"][number], scale: number): ShipMarks {
    const design = ship.currentStructure;
    const band = Math.round(Math.log2(scale));
    const xs = ship.leakX!;
    const modules = ship.leakModule;
    const parts: number[] = [band];
    for (let k = 0; k < xs.length; k++) {
        parts.push(
            modules?.[k] ?? -1,
            Math.round(xs[k]! * 1000),
            Math.round(ship.leakY![k]! * 1000),
            Math.round(ship.leakWidth![k]! * 1000),
            Math.round(scratchShows(ship, k) * 32),
        );
    }
    const key = parts.join();
    const kept = holeCache.get(ship.body);
    if (kept !== undefined && kept.design === design && kept.key === key) return kept;
    let thin: Shapes | null = null;
    let thick: Shapes | null = null;
    const least = MIN_SCAR_PX / 2 ** band;
    for (let k = 0; modules !== undefined && k < xs.length; k++) {
        const i = modules[k]!;
        const m = design.modules[i];
        if (m === undefined || m.spec.kind === "rock" || m.spec.kind === "kernel" || isFighterModule(design, i)) continue;
        const width = ship.leakWidth![k]!;
        const opened = ship.leakOpened?.[k] ?? width;
        if (holeMarkWidth(opened) < least) continue;
        const shows = scratchShows(ship, k);
        if (!(shows > 0) && !(width > 0)) continue;
        const c = Math.cos(m.angle);
        const s = Math.sin(m.angle);
        const bx = xs[k]! - m.x;
        const by = ship.leakY![k]! - m.y;
        const dx = ship.leakDirX![k]!;
        const dy = ship.leakDirY![k]!;
        scratch.length = 0;
        leakHoleShapes(
            bx * c + by * s,
            -bx * s + by * c,
            dx * c + dy * s,
            -dx * s + dy * c,
            opened,
            width,
            shows,
            boundsOf(m.spec),
            scratch,
        );
        if (scratch.length === 0) continue;
        const into = m.weaponsLayer && !isDomed(m.spec.kind) ? (thick ??= new Shapes()) : (thin ??= new Shapes());
        placeMarks(into, m, scratch);
    }
    const made = { design, key, thin, thick };
    holeCache.set(ship.body, made);
    return made;
}

const bounds = new WeakMap<ModuleSpec, Bounds>();

function boundsOf(spec: ModuleSpec): Bounds {
    let box = bounds.get(spec);
    if (box === undefined) {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        const layout = spec.kind === "engine" ? engineLayout(spec) : null;
        const all = layout === null ? shapesOf(spec) : [[layout.mouth, -layout.halfWidth, layout.front, layout.halfWidth]];
        for (const points of all) {
            for (let v = 0; v < points.length; v += 2) {
                x0 = Math.min(x0, points[v]!);
                x1 = Math.max(x1, points[v]!);
                y0 = Math.min(y0, points[v + 1]!);
                y1 = Math.max(y1, points[v + 1]!);
            }
        }
        box = { x0, y0, x1, y1 };
        bounds.set(spec, box);
    }
    return box;
}
