import {
    engineGeometry,
    hullMountGeometry,
    isHullMount,
    nozzleOffset,
    shapeOf,
    type ModuleSpec,
    type ShipDesign,
    type ShipView,
} from "../sim/index.js";
import type { Palette } from "./teams.js";

/**
 * The solid shape of each module, as polygons in its own frame, and the
 * colour and strength it is filled with: what both renderers fill, so a hull
 * drawn by Canvas2D and by Pixi (render/hullLayer.ts) is the same hull. What is
 * drawn over the fill — gauges, berths, a pad's landing square — stays with
 * the renderer that draws it. DOM-free, so it is unit-tested.
 */

/** How much of a claw's width each of its two jaws is drawn across. */
const CLAW_JAW_SHARE = 0.3;

/** How much of a slipway's width each side rail takes, and of its length the feed block aft. */
const SLIPWAY_RAIL_SHARE = 0.12;
const SLIPWAY_FEED_SHARE = 0.25;

/** How much of a port's length its collar is drawn as. */
export const PORT_COLLAR_SHARE = 0.3;
/** A port's collar's width as a share of its block's. */
export const PORT_COLLAR_WIDTH = 0.7;

/** A module that has taken everything it can: still there, no longer anything. */
export const WRECKAGE = "#3c4048";
/** An asteroid's kernel: darker than any rock, so what will be left once the rock is mined is plain. */
const KERNEL = "#3a3530";

/** What rock is drawn as by what it holds: white for ice, grey for ore, brown for the worthless rest. */
const ICE_RGB = [235, 240, 245] as const;
const ORE_RGB = [130, 132, 138] as const;
const WASTE_RGB = [110, 80, 55] as const;
const rockColours = new Map<string, string>();

function rockColour(ore: number, ice: number): string {
    // Quantised, so a field of wedges shares a handful of strings.
    const key = `${Math.round(ore * 20)},${Math.round(ice * 20)}`;
    let colour = rockColours.get(key);
    if (colour === undefined) {
        const o = Math.round(ore * 20) / 20;
        const i = Math.round(ice * 20) / 20;
        const w = Math.max(0, 1 - o - i);
        const mix = (k: 0 | 1 | 2): number => Math.round(ICE_RGB[k] * i + ORE_RGB[k] * o + WASTE_RGB[k] * w);
        colour = `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
        rockColours.set(key, colour);
    }
    return colour;
}

/** How faint a module no working core reaches is drawn, so a ship that lost one shows what went dark. */
const OUT_OF_REACH_ALPHA = 0.35;

/** One polygon to fill, its corners as x, y pairs in the module's frame. */
export interface Fill {
    colour: string;
    readonly points: number[];
}

/**
 * The colour a module is filled with, before what its kind fills in a colour
 * of its own: a core in the darkest of the team's colours, since shooting it
 * out is what leaves a hulk; wreckage grey; rock by what it holds.
 */
export function fillColour(spec: ModuleSpec, integrity: number, colours: Palette): string {
    if (spec.kind === "kernel") return KERNEL;
    if (spec.kind === "rock") return rockColour(spec.ore ?? 0, spec.ice ?? 0);
    if (integrity <= 0) return WRECKAGE;
    // Structure is drawn in the hull's colour, thick or thin: its bevels and its
    // shadow say which it is.
    if (spec.kind === "structure" || spec.kind === "tank" || spec.kind === "hold" || spec.kind === "battery") return colours.hull;
    if (spec.kind === "core") return colours.pivot;
    // A deck, as a pad is, for its berth pads to stand out on.
    if (spec.kind === "robotBay") return colours.hull;
    return colours.trim;
}

/** How strongly module `i` of a ship is filled: fainter as it is worn, and fainter still out of its cores' reach. */
export function fillAlpha(ship: ShipView, i: number): number {
    const integrity = ship.integrity?.[i] ?? 1;
    if (integrity <= 0) return 1;
    return (0.45 + 0.55 * integrity) * (ship.outOfReach?.[i] === true ? OUT_OF_REACH_ALPHA : 1);
}

/**
 * The polygons a module is filled as, into `out`, which is emptied first:
 * the box for most, a block and its bells for an engine, the block alone for
 * a hull gun (its barrel is drawn with the turrets), and so on.
 */
export function moduleFills(spec: ModuleSpec, colour: string, colours: Palette, integrity: number, out: Fill[]): void {
    out.length = 0;
    const l = spec.length / 2;
    const w = spec.width / 2;
    const box = (x0: number, y0: number, x1: number, y1: number, fill = colour): void => {
        out.push({ colour: fill, points: [x0, y0, x1, y0, x1, y1, x0, y1] });
    };
    const deck = integrity <= 0 ? WRECKAGE : colours.hull;
    if (spec.kind === "engine") {
        // The block a box like any other module, each bell flaring from its throat
        // to the exit at -x: the throat is the number the thrust is worked out
        // from, so what the bell looks like is what it does.
        const engine = engineGeometry(spec);
        const mouth = l - engine.machineryLength;
        box(mouth, -w, l, w);
        // A livery's band across the block, as far from the bells as it is wide.
        if (colours.highlight !== undefined && integrity > 0) {
            const band = (l - mouth) * ENGINE_BAND_SHARE;
            box(mouth + band, -w, mouth + 2 * band, w, colours.highlight);
        }
        const throat = engine.throatWidth / 2;
        const exit = engine.exitWidth / 2;
        for (let n = 0; n < engine.nozzles; n++) {
            const across = nozzleOffset(engine, n);
            out.push({ colour: BELL, points: [mouth, across - throat, mouth, across + throat, -l, across + exit, -l, across - exit] });
        }
    } else if (isHullMount(spec.kind)) {
        box(-l, -w, -l + hullMountGeometry(spec).blockLength, w);
    } else if (spec.kind === "pad") {
        box(-l, -w, l, w, deck);
    } else if (spec.kind === "port") {
        // A coupling block with a collar standing proud of its outward face.
        const collar = spec.length * PORT_COLLAR_SHARE;
        box(-l, -w, l - collar, w);
        box(l - collar, -w * PORT_COLLAR_WIDTH, l, w * PORT_COLLAR_WIDTH, integrity > 0 ? (colours.highlight ?? colour) : colour);
    } else if (spec.kind === "slipway") {
        // A cradle in the hull's colour, open at the face a ship comes out of,
        // between rails along its sides and the feed block aft.
        const rail = spec.width * SLIPWAY_RAIL_SHARE;
        const feed = spec.length * SLIPWAY_FEED_SHARE;
        const trim = integrity <= 0 ? WRECKAGE : colours.trim;
        box(-l, -w, l, w, deck);
        box(-l, -w, -l + feed, w, trim);
        box(-l, -w, l, -w + rail, trim);
        box(-l, w - rail, l, w, trim);
    } else if (spec.kind === "claw") {
        // The pump aft, and two jaws reaching out of the bow face it grips with.
        const jaw = spec.width * CLAW_JAW_SHARE;
        box(-l, -w, 0, w);
        box(0, -w, l, -w + jaw);
        box(0, w - jaw, l, w);
    } else {
        // A shaped module's corners as authored, which is what the simulation
        // weighs, shoots at and welds.
        const triangle = shapeOf(spec);
        if (triangle !== null) out.push({ colour, points: [...triangle] });
        else box(-l, -w, l, w);
    }
}

/** Engine bells, whatever side they are on. */
const BELL = "#4a4a4a";

/** How much of an engine's block a livery's band covers. */
const ENGINE_BAND_SHARE = 0.25;

/** How far in from a pad's edge its landing square is drawn, as a share of its smaller side. */
const PAD_MARK_INSET = 0.1;

/** A pad's landing square, in its own frame: the rectangle to stroke, and how wide. */
export function padMark(spec: ModuleSpec): { x: number; y: number; width: number; height: number; line: number } {
    const inset = Math.min(spec.length, spec.width) * PAD_MARK_INSET;
    return {
        x: -spec.length / 2 + inset,
        y: -spec.width / 2 + inset,
        width: spec.length - 2 * inset,
        height: spec.width - 2 * inset,
        line: inset * 0.5,
    };
}

/** Whether module `m` is a fighter's, flying or aboard a carrier. */
export function isFighterModule(design: ShipDesign, m: number): boolean {
    if (design.fighter) return true;
    const fighters = design.fighterPieces;
    return fighters !== undefined && fighters.includes(design.pieces?.[m] ?? 0);
}
