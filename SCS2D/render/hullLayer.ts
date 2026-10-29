import { AlphaFilter, Container, Graphics, GraphicsContext } from "pixi.js";
import type { ModuleSpec, Snapshot } from "../sim/index.js";
import type { Camera } from "./camera.js";
import { DEFAULT_LIGHT, FIGHTER_SHADOW_M, KERNEL_SHADOW_M, LANDED_SHADOW_M, ROCK_SHADOW_M, THICK_SHADOW_M, type Light } from "./light.js";
import { fillAlpha, fillColour, isFighterModule, moduleFills, padMark, type Fill } from "./moduleFills.js";
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
 * the fighters' shadows, on any hull. Fighters themselves stay with
 * Canvas2D, drawn above robots and the details of the decks they sit on,
 * which a layer underneath cannot be; a shadow needs only their outline.
 */
export class HullLayer {
    /** Holds the fills in metres from the camera, y up: the world container's frame. */
    readonly container = new Container();
    readonly thin = new Pool();
    readonly thick = new Pool();
    /** An asteroid's rock, standing higher than any ship. */
    readonly rock = new Pool();
    /** An asteroid's kernel, higher still. */
    readonly kernel = new Pool();
    /** Thick modules' shadows, on thin hull. */
    readonly thickShadows: BlockShadows;
    /** Rock's shadows, on ships' hulls. */
    readonly rockShadows: BlockShadows;
    /** Kernels' shadows, on rock. */
    readonly kernelShadows: BlockShadows;
    readonly fighterShadows = new Pool();
    /** Where a thick module's shadow may fall: the thin hull. */
    readonly thinHull = new Pool();
    /** Where a fighter's shadow may fall: any ship's hull. */
    readonly hull = new Pool();
    /** Where rock's shadow may fall: any ship's hull. */
    readonly hullUnderRock = new Pool();
    /** Where a kernel's shadow may fall: rock. */
    readonly rockUnderKernel = new Pool();
    private readonly fighterShade: AlphaFilter;
    private light: Light | null = null;

    /**
     * `shade` makes the filter a shadow layer is darkened through, all at once
     * so that where shadows overlap is no darker; a test, without a browser to
     * build one in, passes a stand-in.
     */
    constructor(shade: () => AlphaFilter = () => new AlphaFilter()) {
        this.thickShadows = new BlockShadows(shade(), this.thinHull.container);
        this.rockShadows = new BlockShadows(shade(), this.hullUnderRock.container);
        this.kernelShadows = new BlockShadows(shade(), this.rockUnderKernel.container);
        this.fighterShade = shade();
        this.fighterShadows.container.mask = this.hull.container;
        this.fighterShadows.container.filters = [this.fighterShade];
        // Lowest first: each depth's shadows fall on what is drawn before them.
        this.container.addChild(
            this.thin.container,
            this.thickShadows.layer,
            this.thick.container,
            this.fighterShadows.container,
            this.rockShadows.layer,
            this.rock.container,
            this.kernelShadows.layer,
            this.kernel.container,
            this.thinHull.container,
            this.hull.container,
            this.hullUnderRock.container,
            this.rockUnderKernel.container,
        );
    }

    update(snapshot: Snapshot, camera: Camera, widthPx: number, heightPx: number, light: Light = DEFAULT_LIGHT): void {
        this.see(light);
        const halfW = widthPx / 2 / camera.scale;
        const halfH = heightPx / 2 / camera.scale;
        // Away from the light, so a shadow falls on the side it is not lit from.
        const awayX = -Math.cos(light.from);
        const awayY = -Math.sin(light.from);
        for (const pool of this.pools()) pool.begin();
        for (const shadows of [this.thickShadows, this.rockShadows, this.kernelShadows]) shadows.clear();
        for (let s = 0; s < snapshot.shipCount; s++) {
            const ship = snapshot.ships[s]!;
            const design = ship.currentStructure;
            const dx = ship.x - camera.x;
            const dy = ship.y - camera.y;
            const reach = design.radius + ROCK_SHADOW_M;
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
                    // A fighter of its own is flying; one that is part of its carrier is on a pad.
                    const height = design.fighter ? FIGHTER_SHADOW_M : LANDED_SHADOW_M;
                    place(this.fighterShadows.next(outline), x + awayX * height, y + awayY * height, angle);
                    continue;
                }
                // A piece hooked on from another ship keeps that ship's colours.
                const fill = contextFor(m.spec, ship.sides?.[i] ?? ship.team, ship.integrity?.[i] ?? 1, m.weaponsLayer);
                const kind = m.spec.kind;
                const depth = kind === "kernel" ? this.kernel : kind === "rock" ? this.rock : m.weaponsLayer ? this.thick : this.thin;
                place(depth.next(fill), x, y, angle).alpha = fillAlpha(ship, i);
                if (depth === this.thin) place(this.thinHull.next(outline), x, y, angle);
                if (depth === this.thin || depth === this.thick) {
                    place(this.hull.next(outline), x, y, angle);
                    place(this.hullUnderRock.next(outline), x, y, angle);
                }
                if (depth === this.rock) place(this.rockUnderKernel.next(outline), x, y, angle);
                // A module standing above what is below it is a block, so its shadow
                // runs from its foot out to where its top's shadow falls.
                const shadows =
                    depth === this.thick
                        ? this.thickShadows
                        : depth === this.rock
                          ? this.rockShadows
                          : depth === this.kernel
                            ? this.kernelShadows
                            : null;
                if (shadows === null) continue;
                // As far as it stands above what its shadow falls on.
                const length =
                    depth === this.rock ? ROCK_SHADOW_M : depth === this.kernel ? KERNEL_SHADOW_M - ROCK_SHADOW_M : THICK_SHADOW_M;
                shadows.cast(m.spec, x, y, angle, awayX * length, awayY * length);
            }
        }
        for (const pool of this.pools()) pool.end();
    }

    /** What is lit is tinted the light's colour; what is in shadow keeps only its ambient share. */
    private see(light: Light): void {
        if (this.light === light) return;
        this.light = light;
        for (const lit of [this.thin, this.thick, this.rock, this.kernel]) lit.container.tint = light.colour;
        for (const shadows of [this.thickShadows, this.rockShadows, this.kernelShadows]) shadows.shade.alpha = 1 - light.ambient;
        this.fighterShade.alpha = 1 - light.ambient;
    }

    private pools(): Pool[] {
        return [
            this.thin,
            this.thick,
            this.rock,
            this.kernel,
            this.fighterShadows,
            this.thinHull,
            this.hull,
            this.hullUnderRock,
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
    }

    cast(spec: ModuleSpec, x: number, y: number, angle: number, dx: number, dy: number): void {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        for (const corners of shapesOf(spec)) {
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
    const key = `${colour}|${side}|${integrity <= 0}`;
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
