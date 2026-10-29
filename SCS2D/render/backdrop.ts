import type { Snapshot } from "../sim/index.js";
import { gridStep, type Camera } from "./camera.js";

/**
 * What a battle is drawn over — the field, the grid and the wells — as line
 * segments, so that a renderer of either kind draws the same lines. DOM-free,
 * so it is unit-tested.
 */

export const BACKGROUND = "#0b0f16";
export const GRID = "#161d29";
export const WELL = "#3a4e7a";

/** The pulls, m/s², a well's rings are drawn at. */
export const WELL_PULLS = [1, 0.1] as const;
/** Half a well's centre cross, canvas pixels: sized on screen so it stays visible at any zoom. */
export const WELL_ARM_PX = 8;

/** Screen pixels a ring's chord spans at most. */
const RING_CHORD_PX = 4;
const MIN_RING_SEGMENTS = 24;
const MAX_RING_SEGMENTS = 720;

/**
 * Line segments as `x0, y0, x1, y1` in metres from the camera: relative to it
 * rather than to the world's origin, so a 32-bit float on the GPU keeps a
 * battle fought far out as steady as one fought at home.
 */
export class Segments {
    data = new Float32Array(4096);
    count = 0;

    clear(): void {
        this.count = 0;
    }

    add(x0: number, y0: number, x1: number, y1: number): void {
        if ((this.count + 1) * 4 > this.data.length) {
            const grown = new Float32Array(this.data.length * 2);
            grown.set(this.data);
            this.data = grown;
        }
        const k = this.count * 4;
        this.data[k] = x0;
        this.data[k + 1] = y0;
        this.data[k + 2] = x1;
        this.data[k + 3] = y1;
        this.count++;
    }
}

/** The grid lines over a `widthPx` by `heightPx` view, as `drawGrid` in canvas2d.ts lays them. */
export function gridSegments(out: Segments, camera: Camera, widthPx: number, heightPx: number): void {
    const step = gridStep(camera.scale);
    const halfW = widthPx / 2 / camera.scale;
    const halfH = heightPx / 2 / camera.scale;
    const x0 = Math.floor((camera.x - halfW) / step) * step;
    const x1 = camera.x + halfW;
    const y0 = Math.floor((camera.y - halfH) / step) * step;
    const y1 = camera.y + halfH;
    for (let x = x0; x <= x1; x += step) out.add(x - camera.x, y0 - camera.y, x - camera.x, y1 - camera.y);
    for (let y = y0; y <= y1; y += step) out.add(x0 - camera.x, y - camera.y, x1 - camera.x, y - camera.y);
}

/** Each well's rings and centre cross, as `drawWells` in canvas2d.ts draws them. */
export function wellSegments(out: Segments, snapshot: Snapshot, camera: Camera): void {
    for (let i = 0; i < snapshot.wells.length; i++) {
        const well = snapshot.wells[i]!;
        const cx = well.x - camera.x;
        const cy = well.y - camera.y;
        for (const pull of WELL_PULLS) {
            // r where gm/r² is `pull`.
            const r = Math.sqrt(well.gm / pull);
            const n = ringSegments(r * camera.scale);
            let px = cx + r;
            let py = cy;
            for (let k = 1; k <= n; k++) {
                const a = (k / n) * 2 * Math.PI;
                const qx = cx + r * Math.cos(a);
                const qy = cy + r * Math.sin(a);
                out.add(px, py, qx, qy);
                px = qx;
                py = qy;
            }
        }
        const arm = WELL_ARM_PX / camera.scale;
        out.add(cx - arm, cy, cx + arm, cy);
        out.add(cx, cy - arm, cx, cy + arm);
    }
}

/** Chords for a ring `radiusPx` across on screen, enough that none is seen as straight. */
export function ringSegments(radiusPx: number): number {
    const n = Math.ceil((2 * Math.PI * radiusPx) / RING_CHORD_PX);
    return Math.min(MAX_RING_SEGMENTS, Math.max(MIN_RING_SEGMENTS, n));
}
