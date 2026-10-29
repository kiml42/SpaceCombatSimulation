import { Container, Graphics, GraphicsContext } from "pixi.js";
import type { ModuleSpec, Snapshot } from "../sim/index.js";
import type { Camera } from "./camera.js";
import { fillAlpha, fillColour, isFighterModule, moduleFills, type Fill } from "./moduleFills.js";
import { shipColours } from "./teams.js";

/**
 * The capital ships' module fills, drawn by Pixi under the Canvas2D view.
 * Each module's fills are triangulated once into a `GraphicsContext`, shared
 * by every module of that spec in those colours, so a frame only places them.
 * Fighters stay with Canvas2D, since they are drawn above robots and the
 * details of the decks they sit on, which a layer underneath cannot be.
 */
export class HullLayer {
    /** Holds the fills in metres from the camera, y up: the world container's frame. */
    readonly container = new Container();
    private readonly pool: Graphics[] = [];

    update(snapshot: Snapshot, camera: Camera, widthPx: number, heightPx: number): void {
        const halfW = widthPx / 2 / camera.scale;
        const halfH = heightPx / 2 / camera.scale;
        let used = 0;
        for (let s = 0; s < snapshot.shipCount; s++) {
            const ship = snapshot.ships[s]!;
            const design = ship.currentStructure;
            if (design.fighter) continue;
            const dx = ship.x - camera.x;
            const dy = ship.y - camera.y;
            if (Math.abs(dx) - design.radius > halfW || Math.abs(dy) - design.radius > halfH) continue;
            const sc = Math.cos(ship.angle);
            const ss = Math.sin(ship.angle);
            for (let i = 0; i < design.modules.length; i++) {
                if (ship.drawn?.[i] === false || isFighterModule(design, i)) continue;
                const m = design.modules[i]!;
                let g = this.pool[used];
                if (g === undefined) {
                    g = new Graphics();
                    this.pool.push(g);
                    this.container.addChild(g);
                }
                used++;
                // A piece hooked on from another ship keeps that ship's colours.
                g.context = contextFor(m.spec, ship.sides?.[i] ?? ship.team, ship.integrity?.[i] ?? 1, m.weaponsLayer);
                g.position.set(dx + m.x * sc - m.y * ss, dy + m.x * ss + m.y * sc);
                g.rotation = ship.angle + m.angle;
                g.alpha = fillAlpha(ship, i);
                g.visible = true;
            }
        }
        for (let k = used; k < this.pool.length; k++) this.pool[k]!.visible = false;
    }
}

const contexts = new WeakMap<ModuleSpec, Map<string, GraphicsContext>>();
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
