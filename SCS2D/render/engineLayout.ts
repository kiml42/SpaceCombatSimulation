import { engineGeometry, isPressureFed, nozzleOffset, type ModuleSpec } from "../sim/index.js";

/**
 * How an engine's block is drawn, in its own frame with the bells' exit at -x:
 * a combustion chamber on each bell's throat and, on a pumped engine, one
 * turbopump across the whole block on the hull's side of them. Each chamber is
 * a sphere cut flat where it sits on its throat and, where there is a pump, cut
 * a little flat where it meets that too. A pressure-fed engine has no pump.
 * DOM-free, so it is unit-tested.
 */
export interface EngineLayout {
    /** Where the bells meet the block, and the block's forward face. */
    readonly mouth: number;
    readonly front: number;
    /** Half the block's width. */
    readonly halfWidth: number;
    readonly pressureFed: boolean;
    /** Each chamber's radius and centre along x, and where it is cut flat aft and fore. */
    readonly radius: number;
    readonly centre: number;
    readonly aft: number;
    readonly fore: number;
    /** Each chamber's centre across the block, one per nozzle. */
    readonly centres: readonly number[];
    /** Where the pump's aft face is; `front` where there is none. */
    readonly pumpAft: number;
}

/** How much of a pumped engine's block its chambers may take, so the pump keeps the rest. */
const CHAMBER_MOST = 0.6;
/** A chamber's width as a share of its bell's throat. */
const CHAMBER_OF_THROAT = 1.5;
/** How far forward of its centre a pumped chamber is cut flat against the pump, in radii. */
const PUMP_CUT = 0.8;

const layouts = new WeakMap<ModuleSpec, EngineLayout>();

/** An engine's drawn layout. Engines only. */
export function engineLayout(spec: ModuleSpec): EngineLayout {
    let made = layouts.get(spec);
    if (made === undefined) {
        const engine = engineGeometry(spec);
        const front = spec.length / 2;
        const long = engine.machineryLength;
        const mouth = front - long;
        const pressureFed = isPressureFed(engine);
        const throat = engine.throatWidth / 2;
        // Its centre behind its flat aft face, where the sphere is as wide as the throat.
        const behind = (r: number): number => Math.sqrt(Math.max(0, r * r - throat * throat));
        const ahead = pressureFed ? 1 : PUMP_CUT;
        const room = pressureFed ? long : long * CHAMBER_MOST;
        // Wider than its throat, no wider than its share of the block, and no longer than its room.
        let radius = Math.min(engine.throatWidth * CHAMBER_OF_THROAT, engine.pitch) / 2;
        if (behind(radius) + ahead * radius > room) {
            let low = 0;
            for (let n = 0; n < 30; n++) {
                const mid = (low + radius) / 2;
                if (behind(mid) + ahead * mid > room) radius = mid;
                else low = mid;
            }
            radius = low;
        }
        const centre = mouth + behind(radius);
        const fore = centre + ahead * radius;
        const centres: number[] = [];
        for (let n = 0; n < engine.nozzles; n++) centres.push(nozzleOffset(engine, n));
        made = {
            mouth,
            front,
            halfWidth: spec.width / 2,
            pressureFed,
            radius,
            centre,
            aft: mouth,
            fore,
            centres,
            pumpAft: pressureFed ? front : fore,
        };
        layouts.set(spec, made);
    }
    return made;
}

/** Segments round a chamber. */
const SEGMENTS = 24;

/** A sphere `radius` round about `x`, `y`, cut flat at `aft` and `fore` along x, anticlockwise. */
export function cutSphere(x: number, y: number, radius: number, aft: number, fore: number): number[] {
    const out: number[] = [];
    const angle = (at: number): number => Math.acos(Math.min(1, Math.max(-1, (at - x) / radius)));
    const from = angle(fore);
    const to = angle(aft);
    // Over the top from the fore cut to the aft one, then the same underneath.
    for (let k = 0; k <= SEGMENTS; k++) {
        const t = from + ((to - from) * k) / SEGMENTS;
        out.push(x + radius * Math.cos(t), y + radius * Math.sin(t));
    }
    for (let k = 0; k <= SEGMENTS; k++) {
        const t = -to + ((to - from) * k) / SEGMENTS;
        out.push(x + radius * Math.cos(t), y + radius * Math.sin(t));
    }
    return out;
}
