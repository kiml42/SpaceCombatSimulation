import { engineGeometry, isPressureFed, nozzleOffset, type ModuleSpec } from "../sim/index.js";

/**
 * How an engine's block is drawn, in its own frame with the bells' exit at -x:
 * a combustion chamber on each bell's throat and, on a pumped engine, one
 * turbopump across the whole block on the hull's side of them. A pressure-fed
 * engine has no pump, so its chambers take the block's length as capsules.
 * DOM-free, so it is unit-tested.
 */
export interface EngineLayout {
    /** Where the bells meet the block, and the block's forward face. */
    readonly mouth: number;
    readonly front: number;
    /** Half the block's width. */
    readonly halfWidth: number;
    readonly pressureFed: boolean;
    /** Each chamber's radius, and the ends of its capsule along x; a sphere where they are 2r apart. */
    readonly radius: number;
    readonly aft: number;
    readonly fore: number;
    /** Each chamber's centre across the block, one per nozzle. */
    readonly centres: readonly number[];
    /** Where the pump's aft face is; `front` where there is none. */
    readonly pumpAft: number;
}

/** How far a chamber sinks into its bell's throat, in radii, so the two read as one piece. */
const CHAMBER_SINK = 0.2;
/** How much of a pumped engine's block its chambers may take, so the pump keeps the rest. */
const CHAMBER_MOST = 0.6;
/** A chamber's width as a share of its bell's throat. */
const CHAMBER_OF_THROAT = 1.5;
/** How far into a pumped chamber the pump reaches, in radii. */
const PUMP_CLIP = 0.6;

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
        // Wider than its bell's throat, but no wider than its share of the block.
        const widest = Math.min(engine.throatWidth * CHAMBER_OF_THROAT, engine.pitch) / 2;
        const radius = pressureFed ? Math.min(widest, long / (2 - CHAMBER_SINK)) : Math.min(widest, (long * CHAMBER_MOST) / 2);
        const aft = mouth - CHAMBER_SINK * radius;
        const centres: number[] = [];
        for (let n = 0; n < engine.nozzles; n++) centres.push(nozzleOffset(engine, n));
        made = {
            mouth,
            front,
            halfWidth: spec.width / 2,
            pressureFed,
            radius,
            aft,
            fore: pressureFed ? front : aft + 2 * radius,
            centres,
            pumpAft: pressureFed ? front : aft + (2 - PUMP_CLIP) * radius,
        };
        layouts.set(spec, made);
    }
    return made;
}

/** Segments in a chamber's rounded end. */
const END_SEGMENTS = 10;

/** A capsule along x from `aft` to `fore`, `radius` round, centred at `y`, anticlockwise. */
export function capsule(aft: number, fore: number, y: number, radius: number): number[] {
    const out: number[] = [];
    const a = aft + radius;
    const f = fore - radius;
    for (let k = 0; k <= END_SEGMENTS; k++) {
        const t = -Math.PI / 2 + (Math.PI * k) / END_SEGMENTS;
        out.push(f + radius * Math.cos(t), y + radius * Math.sin(t));
    }
    for (let k = 0; k <= END_SEGMENTS; k++) {
        const t = Math.PI / 2 + (Math.PI * k) / END_SEGMENTS;
        out.push(a + radius * Math.cos(t), y + radius * Math.sin(t));
    }
    return out;
}
