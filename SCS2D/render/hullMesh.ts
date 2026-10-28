import type { Snapshot } from "../sim/index.js";
import type { Camera } from "./camera.js";
import { fillAlpha, fillColour, isFighterModule, moduleFills, type Fill } from "./moduleFills.js";
import { shipColours } from "./teams.js";

/**
 * The capital ships' module fills as triangles, for WebGL to draw under the
 * Canvas2D layer: what canvas2d.ts leaves unfilled when it is told a layer
 * underneath has filled them. Fighters stay with Canvas2D, since they are
 * drawn above robots and the details of the hulls they sit on, which a layer
 * underneath cannot be. DOM-free, so it is unit-tested.
 */

/** Floats a vertex: x and y in metres from the camera, then red, green, blue and alpha from 0 to 1. */
export const VERTEX_FLOATS = 6;

/** Triangles as vertices, three to a triangle, in a buffer that grows to fit. */
export class Triangles {
    data = new Float32Array(6 * 4096);
    /** Vertices written. */
    count = 0;

    clear(): void {
        this.count = 0;
    }

    vertex(x: number, y: number, r: number, g: number, b: number, a: number): void {
        if ((this.count + 1) * VERTEX_FLOATS > this.data.length) {
            const grown = new Float32Array(this.data.length * 2);
            grown.set(this.data);
            this.data = grown;
        }
        const k = this.count * VERTEX_FLOATS;
        this.data[k] = x;
        this.data[k + 1] = y;
        this.data[k + 2] = r;
        this.data[k + 3] = g;
        this.data[k + 4] = b;
        this.data[k + 5] = a;
        this.count++;
    }
}

const fills: Fill[] = [];
const channels = new Map<string, readonly [number, number, number]>();

/** A CSS colour as `#rrggbb` or `rgb(r, g, b)`, as three channels from 0 to 1. */
export function channelsOf(colour: string): readonly [number, number, number] {
    let out = channels.get(colour);
    if (out === undefined) {
        const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(colour);
        if (rgb !== null) out = [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
        else {
            const n = Number.parseInt(colour.slice(1, 7), 16);
            out = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
        }
        channels.set(colour, out);
    }
    return out;
}

/** Every capital ship's module fills, into `out`, which is emptied first. */
export function hullTriangles(snapshot: Snapshot, camera: Camera, out: Triangles): void {
    out.clear();
    for (let s = 0; s < snapshot.shipCount; s++) {
        const ship = snapshot.ships[s]!;
        const design = ship.currentStructure;
        if (design.fighter) continue;
        const sc = Math.cos(ship.angle);
        const ss = Math.sin(ship.angle);
        for (let i = 0; i < design.modules.length; i++) {
            if (ship.drawn?.[i] === false || isFighterModule(design, i)) continue;
            const m = design.modules[i]!;
            const integrity = ship.integrity?.[i] ?? 1;
            // A piece hooked on from another ship keeps that ship's colours.
            const colours = shipColours(ship.sides?.[i] ?? ship.team);
            moduleFills(m.spec, fillColour(m.spec, integrity, m.weaponsLayer, colours), colours, integrity, fills);
            const alpha = fillAlpha(ship, i);
            const mc = Math.cos(m.angle);
            const ms = Math.sin(m.angle);
            // Module frame to body frame to metres from the camera.
            const ox = ship.x - camera.x + m.x * sc - m.y * ss;
            const oy = ship.y - camera.y + m.x * ss + m.y * sc;
            const xc = mc * sc - ms * ss;
            const xs = mc * ss + ms * sc;
            for (const fill of fills) {
                const [r, g, b] = channelsOf(fill.colour);
                const p = fill.points;
                // Every fill is convex, so a fan from its first corner covers it.
                const x0 = ox + p[0]! * xc - p[1]! * xs;
                const y0 = oy + p[0]! * xs + p[1]! * xc;
                for (let v = 2; v + 3 < p.length; v += 2) {
                    out.vertex(x0, y0, r, g, b, alpha);
                    out.vertex(ox + p[v]! * xc - p[v + 1]! * xs, oy + p[v]! * xs + p[v + 1]! * xc, r, g, b, alpha);
                    out.vertex(ox + p[v + 2]! * xc - p[v + 3]! * xs, oy + p[v + 2]! * xs + p[v + 3]! * xc, r, g, b, alpha);
                }
            }
        }
    }
}
