import { AlphaFilter, Container, Graphics, GraphicsContext } from "pixi.js";
import type { ModuleSpec, Snapshot } from "../sim/index.js";
import type { Camera } from "./camera.js";
import { DEFAULT_LIGHT, FIGHTER_SHADOW_M, THICK_SHADOW_M, type Light } from "./light.js";
import { fillAlpha, fillColour, isFighterModule, moduleFills, type Fill } from "./moduleFills.js";
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
    /** The thick modules' shadows, made afresh each frame: each falls a different way across its module as its ship turns. */
    readonly thickShadows = new Graphics();
    /** What `thickShadows` drew in the last frame, each shadow's corners in metres from the camera. */
    readonly thickShadowShapes: number[][] = [];
    readonly thickShadowLayer = new Container();
    readonly fighterShadows = new Pool();
    /** Where a thick module's shadow may fall: the thin hull. */
    readonly thinHull = new Pool();
    /** Where a fighter's shadow may fall: any hull. */
    readonly hull = new Pool();
    private readonly thickShade: AlphaFilter;
    private readonly fighterShade: AlphaFilter;
    private light: Light | null = null;

    /**
     * `shade` makes the filter a shadow layer is darkened through, all at once
     * so that where shadows overlap is no darker; a test, without a browser to
     * build one in, passes a stand-in.
     */
    constructor(shade: () => AlphaFilter = () => new AlphaFilter()) {
        this.thickShade = shade();
        this.fighterShade = shade();
        this.thickShadowLayer.addChild(this.thickShadows);
        this.thickShadowLayer.mask = this.thinHull.container;
        this.thickShadowLayer.filters = [this.thickShade];
        this.fighterShadows.container.mask = this.hull.container;
        this.fighterShadows.container.filters = [this.fighterShade];
        this.container.addChild(
            this.thin.container,
            this.thickShadowLayer,
            this.thick.container,
            this.fighterShadows.container,
            this.thinHull.container,
            this.hull.container,
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
        this.thickShadows.clear();
        this.thickShadowShapes.length = 0;
        for (let s = 0; s < snapshot.shipCount; s++) {
            const ship = snapshot.ships[s]!;
            const design = ship.currentStructure;
            const dx = ship.x - camera.x;
            const dy = ship.y - camera.y;
            const reach = design.radius + FIGHTER_SHADOW_M;
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
                    place(this.fighterShadows.next(outline), x + awayX * FIGHTER_SHADOW_M, y + awayY * FIGHTER_SHADOW_M, angle);
                    continue;
                }
                // A piece hooked on from another ship keeps that ship's colours.
                const fill = contextFor(m.spec, ship.sides?.[i] ?? ship.team, ship.integrity?.[i] ?? 1, m.weaponsLayer);
                place((m.weaponsLayer ? this.thick : this.thin).next(fill), x, y, angle).alpha = fillAlpha(ship, i);
                place(this.hull.next(outline), x, y, angle);
                if (!m.weaponsLayer) {
                    place(this.thinHull.next(outline), x, y, angle);
                    continue;
                }
                // A thick module is a block standing on the hull, so its shadow runs
                // from its foot out to where its top's shadow falls: for each of its
                // shapes, the hull round the shape and the shape moved away.
                const c = Math.cos(angle);
                const sn = Math.sin(angle);
                for (const corners of shapesOf(m.spec)) {
                    const placed: number[] = [];
                    for (let k = 0; k < corners.length; k += 2) {
                        placed.push(x + corners[k]! * c - corners[k + 1]! * sn, y + corners[k]! * sn + corners[k + 1]! * c);
                    }
                    const shadow = blockShadow(placed, awayX * THICK_SHADOW_M, awayY * THICK_SHADOW_M);
                    this.thickShadows.poly(shadow, true).fill(0x000000);
                    this.thickShadowShapes.push(shadow);
                }
            }
        }
        for (const pool of this.pools()) pool.end();
    }

    /** What is lit is tinted the light's colour; what is in shadow keeps only its ambient share. */
    private see(light: Light): void {
        if (this.light === light) return;
        this.light = light;
        this.thin.container.tint = light.colour;
        this.thick.container.tint = light.colour;
        this.thickShade.alpha = 1 - light.ambient;
        this.fighterShade.alpha = 1 - light.ambient;
    }

    private pools(): Pool[] {
        return [this.thin, this.thick, this.fighterShadows, this.thinHull, this.hull];
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
