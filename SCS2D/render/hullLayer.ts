import { AlphaFilter, Container, Graphics, GraphicsContext } from "pixi.js";
import { domeRadius, isDomed, originOf, type ModuleSpec, type Snapshot } from "../sim/index.js";
import { BEVEL_DARK, BEVEL_LIGHT, BEVEL_OF_RADIUS, BEVEL_STRIDE, bevelQuad, drawnBevels, MIN_BEVEL_LIT, MIN_BEVEL_PX } from "./bevels.js";
import { lightSlope } from "./shading.js";
import type { Camera } from "./camera.js";
import {
    BARREL_SHADOW_M,
    DEFAULT_LIGHT,
    FIGHTER_SHADOW_M,
    KERNEL_RISE,
    LANDED_SHADOW_M,
    rockHeight,
    THICK_ROCK_RISE,
    THICK_SHADOW_M,
    type Light,
} from "./light.js";
import { barrelLines, MIN_BARREL_PX } from "./barrels.js";
import { fillAlpha, fillColour, isFighterModule, moduleFills, padMark, type Fill } from "./moduleFills.js";
import { legibleWidth } from "./strokes.js";
import { shipColours } from "./teams.js";

/**
 * The capital ships' module fills, drawn by Pixi under the Canvas2D view, lit
 * and shadowed as the battle's light falls. Each module's fills are
 * triangulated once into a `GraphicsContext`, shared by every module of that
 * spec in those colours, so a frame only places them.
 *
 * Lighting takes a module as one of two depths, thin (the hull) or thick
 * (the weapons layer), and a fighter as higher still. In order: the thin
 * fills; the thick modules' shadows, on thin hull only; the thick fills; and
 * the fighters' shadows, on any hull. A turret's block is thin and its dome
 * casts a thick module's shadow. Asteroids stand higher than any ship,
 * thin rock, thick rock and kernel each a step above the last. Fighters themselves stay with
 * Canvas2D, drawn above robots and the details of the decks they sit on,
 * which a layer underneath cannot be; a shadow needs only their outline.
 */
export class HullLayer {
    /** Holds the fills in metres from the camera, y up: the world container's frame. */
    readonly container = new Container();
    readonly thin = new Pool();
    readonly thick = new Pool();
    /** An asteroid's thin rock, standing higher than any ship. */
    readonly rock = new Pool();
    /** An asteroid's thick rock, a step higher. */
    readonly thickRock = new Pool();
    /** An asteroid's kernel, higher still. */
    readonly kernel = new Pool();
    /** Thick modules' shadows, on thin hull. */
    readonly thickShadows: BlockShadows;
    /** Rock's shadows, on ships' hulls. */
    readonly rockShadows: BlockShadows;
    /** Thick rock's shadows, on thin rock. */
    readonly thickRockShadows: BlockShadows;
    /** Kernels' shadows, on rock. */
    readonly kernelShadows: BlockShadows;
    readonly fighterShadows = new Pool();
    /** The bevels along the thin hull's outside edges, and the thick modules'. */
    readonly thinBevels = new Graphics();
    readonly thickBevels = new Graphics();
    /** Where a thick module's shadow may fall: the thin hull. */
    readonly thinHull = new Pool();
    /** Where a fighter's shadow may fall: any ship's hull. */
    readonly hull = new Pool();
    /** Where rock's shadow may fall: any ship's hull. */
    readonly hullUnderRock = new Pool();
    /** Where thick rock's shadow may fall: thin rock. */
    readonly thinRock = new Pool();
    /** Where a kernel's shadow may fall: rock. */
    readonly rockUnderKernel = new Pool();
    private readonly fighterShade: AlphaFilter;
    private light: Light | null = null;
    private readonly barrelEnds: number[] = [];

    /**
     * `shade` makes the filter a shadow layer is darkened through, all at once
     * so that where shadows overlap is no darker; a test, without a browser to
     * build one in, passes a stand-in.
     */
    constructor(shade: () => AlphaFilter = () => new AlphaFilter()) {
        this.thickShadows = new BlockShadows(shade(), this.thinHull.container);
        this.rockShadows = new BlockShadows(shade(), this.hullUnderRock.container);
        this.thickRockShadows = new BlockShadows(shade(), this.thinRock.container);
        this.kernelShadows = new BlockShadows(shade(), this.rockUnderKernel.container);
        this.fighterShade = shade();
        this.fighterShadows.container.mask = this.hull.container;
        this.fighterShadows.container.filters = [this.fighterShade];
        // Lowest first: each depth's shadows fall on what is drawn before them.
        this.container.addChild(
            this.thin.container,
            this.thinBevels,
            this.thickShadows.layer,
            this.thick.container,
            this.thickBevels,
            this.fighterShadows.container,
            this.rockShadows.layer,
            this.rock.container,
            this.thickRockShadows.layer,
            this.thickRock.container,
            this.kernelShadows.layer,
            this.kernel.container,
            this.thinHull.container,
            this.hull.container,
            this.hullUnderRock.container,
            this.thinRock.container,
            this.rockUnderKernel.container,
        );
    }

    update(snapshot: Snapshot, camera: Camera, widthPx: number, heightPx: number, light: Light = DEFAULT_LIGHT): void {
        this.see(light);
        const halfW = widthPx / 2 / camera.scale;
        const halfH = heightPx / 2 / camera.scale;
        // Away from the light, so a shadow falls on the side it is not lit from.
        const slant = light.slant ?? 1;
        const awayX = -Math.cos(light.from) * slant;
        const awayY = -Math.sin(light.from) * slant;
        for (const pool of this.pools()) pool.begin();
        for (const shadows of this.blockShadows()) shadows.clear();
        this.thinBevels.clear();
        this.thickBevels.clear();
        this.bevelled = 0;
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
            for (let i = 0; i < design.modules.length; i++) {
                if (ship.drawn?.[i] === false) continue;
                const m = design.modules[i]!;
                const x = dx + m.x * sc - m.y * ss;
                const y = dy + m.x * ss + m.y * sc;
                const angle = ship.angle + m.angle;
                const outline = outlineFor(m.spec);
                if (isFighterModule(design, i)) {
                    // A fighter of its own is flying, unless parked on a pad; one that is part of its carrier is on one.
                    const height = design.fighter && ship.riding !== true ? FIGHTER_SHADOW_M : LANDED_SHADOW_M;
                    place(this.fighterShadows.next(outline), x + awayX * height, y + awayY * height, angle);
                    continue;
                }
                // A piece hooked on from another ship keeps that ship's colours.
                const fill = contextFor(m.spec, ship.sides?.[i] ?? ship.team, ship.integrity?.[i] ?? 1, m.weaponsLayer);
                const kind = m.spec.kind;
                // A turret's block is hull; its dome stands on it, drawn with the turrets.
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
                place(depth.next(fill), x, y, angle).alpha = alpha;
                if (depth === this.thin || depth === this.thick) {
                    // As wide on every module of a ship, by the size it was built: a piece keeps its ship's.
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
                if (depth === this.thin) place(this.thinHull.next(outline), x, y, angle);
                if (depth === this.thin || depth === this.thick) {
                    place(this.hull.next(outline), x, y, angle);
                    place(this.hullUnderRock.next(outline), x, y, angle);
                }
                if (depth === this.rock) place(this.thinRock.next(outline), x, y, angle);
                if (depth === this.rock || depth === this.thickRock) place(this.rockUnderKernel.next(outline), x, y, angle);
                // A module standing above what is below it is a block, so its shadow
                // runs from its foot out to where its top's shadow falls, as long as
                // it stands above what the shadow falls on.
                const cast = (on: BlockShadows, length: number): void => on.cast(m.spec, x, y, angle, awayX * length, awayY * length);
                if (depth === this.thick) cast(this.thickShadows, THICK_SHADOW_M);
                // A dome as a short cylinder as high as a thick module: its rounded top
                // is left for when mounts are shaded as rounded.
                else if (domed)
                    this.thickShadows.cast(m.spec, x, y, angle, awayX * THICK_SHADOW_M, awayY * THICK_SHADOW_M, [domeOutline(m.spec)]);
                else if (depth === this.rock) cast(this.rockShadows, rock);
                else if (depth === this.thickRock) {
                    cast(this.rockShadows, rock * THICK_ROCK_RISE);
                    cast(this.thickRockShadows, rock * (THICK_ROCK_RISE - 1));
                }
                // On thick rock; thin rock under a kernel takes the same, a little short.
                else if (depth === this.kernel) cast(this.kernelShadows, rock * (KERNEL_RISE - THICK_ROCK_RISE));
            }
            // A capital ship's turrets' barrels, standing on their domes as high as a
            // thick module, as the thick modules' shadows are on the thin hull. A
            // hull mount's are at the deck, with nothing lower to fall on.
            const bx = awayX * BARREL_SHADOW_M - camera.x;
            const by = awayY * BARREL_SHADOW_M - camera.y;
            for (let t = 0; t < design.turrets.length; t++) {
                const module = design.turrets[t]!.module;
                if (ship.drawn?.[module] === false || isFighterModule(design, module)) continue;
                if (!isDomed(design.modules[module]!.spec.kind)) continue;
                const ends = this.barrelEnds;
                ends.length = 0;
                const width = barrelLines(ship, t, (x0, y0, x1, y1) => ends.push(x0 + bx, y0 + by, x1 + bx, y1 + by));
                this.thickShadows.lines(ends, legibleWidth(width, MIN_BARREL_PX, camera.scale));
            }
        }
        for (const pool of this.pools()) pool.end();
    }

    /** Bevels drawn in the last frame. */
    bevelled = 0;

    /**
     * A module's bevelled `edges`, each a strip `width` wide inside it, lighter
     * as it faces `toward` the light and darker as it faces away.
     */
    private bevel(
        into: Graphics,
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
        for (let k = 0; k < edges.length; k += BEVEL_STRIDE) {
            const nx = edges[k + 4]! * c - edges[k + 5]! * s;
            const ny = edges[k + 4]! * s + edges[k + 5]! * c;
            const lit = nx * towardX + ny * towardY;
            if (Math.abs(lit) < MIN_BEVEL_LIT) continue;
            // Its own array: Pixi keeps the one it is given until it draws.
            const quad: number[] = [];
            bevelQuad(edges, k, width, quad);
            for (let v = 0; v < 8; v += 2) {
                const qx = quad[v]!;
                const qy = quad[v + 1]!;
                quad[v] = x + qx * c - qy * s;
                quad[v + 1] = y + qx * s + qy * c;
            }
            into.poly(quad).fill({
                color: lit > 0 ? 0xffffff : 0x000000,
                alpha: alpha * Math.abs(lit) * (lit > 0 ? BEVEL_LIGHT : BEVEL_DARK),
            });
            this.bevelled++;
        }
    }

    /** What is lit is tinted the light's colour; what is in shadow keeps only its ambient share. */
    private see(light: Light): void {
        if (this.light === light) return;
        this.light = light;
        for (const lit of [this.thin, this.thick, this.rock, this.thickRock, this.kernel]) lit.container.tint = light.colour;
        for (const shadows of this.blockShadows()) shadows.shade.alpha = 1 - light.ambient;
        this.fighterShade.alpha = 1 - light.ambient;
    }

    private blockShadows(): BlockShadows[] {
        return [this.thickShadows, this.rockShadows, this.thickRockShadows, this.kernelShadows];
    }

    private pools(): Pool[] {
        return [
            this.thin,
            this.thick,
            this.rock,
            this.thickRock,
            this.kernel,
            this.fighterShadows,
            this.thinHull,
            this.hull,
            this.hullUnderRock,
            this.thinRock,
            this.rockUnderKernel,
        ];
    }
}

/**
 * The shadows of blocks standing above what they fall on, made afresh each
 * frame, since each falls a different way across its block as its ship turns:
 * for each of a block's shapes, the hull round it and it moved away from the
 * light. Masked to what is low enough to take them, and darkened all at once.
 */
export class BlockShadows {
    readonly layer = new Container();
    private readonly graphics = new Graphics();
    /** What was drawn in the last frame, each shadow's corners in metres from the camera. */
    readonly shapes: number[][] = [];

    constructor(
        readonly shade: AlphaFilter,
        under: Container,
    ) {
        this.layer.addChild(this.graphics);
        this.layer.mask = under;
        this.layer.filters = [shade];
    }

    clear(): void {
        this.graphics.clear();
        this.shapes.length = 0;
        this.strokes = 0;
    }

    /** How many lines were drawn in the last frame. */
    strokes = 0;

    /** Lines `width` wide, each four numbers in `ends`, as the shadows of things standing clear of the hull. */
    lines(ends: readonly number[], width: number): void {
        for (let k = 0; k < ends.length; k += 4) {
            this.graphics.moveTo(ends[k]!, ends[k + 1]!).lineTo(ends[k + 2]!, ends[k + 3]!);
            this.strokes++;
        }
        if (ends.length > 0) this.graphics.stroke({ width, color: 0x000000 });
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
            const shadow = blockShadow(placed, dx, dy);
            this.graphics.poly(shadow, true).fill(0x000000);
            this.shapes.push(shadow);
        }
    }
}

/** Graphics kept from frame to frame, placed afresh each one. */
export class Pool {
    readonly container = new Container();
    private readonly items: Graphics[] = [];
    private used = 0;

    begin(): void {
        this.used = 0;
    }

    next(context: GraphicsContext): Graphics {
        let g = this.items[this.used];
        if (g === undefined) {
            g = new Graphics();
            this.items.push(g);
            this.container.addChild(g);
        }
        this.used++;
        g.context = context;
        g.alpha = 1;
        g.visible = true;
        return g;
    }

    end(): void {
        for (let k = this.used; k < this.items.length; k++) this.items[k]!.visible = false;
    }

    /** What was placed in the last frame. */
    shown(): Graphics[] {
        return this.items.slice(0, this.used);
    }
}

function place(g: Graphics, x: number, y: number, angle: number): Graphics {
    g.position.set(x, y);
    g.rotation = angle;
    return g;
}

const contexts = new WeakMap<ModuleSpec, Map<string, GraphicsContext>>();
const outlines = new WeakMap<ModuleSpec, GraphicsContext>();
const fills: Fill[] = [];

/** Module fills for `spec` on side `side`, built the first time they are asked for. */
function contextFor(spec: ModuleSpec, side: number, integrity: number, weaponsLayer: boolean): GraphicsContext {
    const colours = shipColours(side);
    const colour = fillColour(spec, integrity, weaponsLayer, colours);
    // What else moduleFills reads: the side's palette, and whether it is wreckage.
    const key = `${colour}|${colours.hull}${colours.trim}${colours.pivot}|${integrity <= 0}`;
    let bySpec = contexts.get(spec);
    if (bySpec === undefined) {
        bySpec = new Map();
        contexts.set(spec, bySpec);
    }
    let context = bySpec.get(key);
    if (context === undefined) {
        context = new GraphicsContext();
        moduleFills(spec, colour, colours, integrity, fills);
        for (const fill of fills) context.poly(fill.points).fill(fill.colour);
        if (spec.kind === "pad") {
            const mark = padMark(spec);
            context.rect(mark.x, mark.y, mark.width, mark.height).stroke({ width: mark.line, color: colours.trim });
        }
        bySpec.set(key, context);
    }
    return context;
}

const domes = new Map<number, number[]>();
/** Corners round a turret's dome, many enough that its shadow's edge reads as round. */
const DOME_SHADOW_CORNERS = 24;

/** A turret's dome as a polygon in its module's frame, for the shadow it casts. */
function domeOutline(spec: ModuleSpec): number[] {
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

/** `spec`'s fills in black: the shape a shadow or a mask takes from it. */
function outlineFor(spec: ModuleSpec): GraphicsContext {
    let context = outlines.get(spec);
    if (context === undefined) {
        context = new GraphicsContext();
        moduleFills(spec, "#000000", shipColours(0), 1, fills);
        for (const fill of fills) context.poly(fill.points).fill(0x000000);
        outlines.set(spec, context);
    }
    return context;
}

const shapes = new WeakMap<ModuleSpec, number[][]>();

/** `spec`'s fills as polygons in its own frame, each convex. */
function shapesOf(spec: ModuleSpec): number[][] {
    let out = shapes.get(spec);
    if (out === undefined) {
        moduleFills(spec, "#000000", shipColours(0), 1, fills);
        out = fills.map((fill) => [...fill.points]);
        shapes.set(spec, out);
    }
    return out;
}

/**
 * The shadow a convex block casts on the surface it stands on: the convex hull
 * of its footprint `points` and the footprint moved by `dx`, `dy`.
 */
export function blockShadow(points: readonly number[], dx: number, dy: number): number[] {
    const all: [number, number][] = [];
    for (let k = 0; k + 1 < points.length; k += 2) {
        all.push([points[k]!, points[k + 1]!], [points[k]! + dx, points[k + 1]! + dy]);
    }
    all.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    // Andrew's monotone chain: the lower hull, then the upper, each without its last point.
    const half = (ordered: readonly [number, number][]): [number, number][] => {
        const out: [number, number][] = [];
        for (const p of ordered) {
            while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop();
            out.push(p);
        }
        out.pop();
        return out;
    };
    return [...half(all), ...half([...all].reverse())].flat();
}
