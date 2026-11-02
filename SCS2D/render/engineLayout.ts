import { engineGeometry, isPressureFed, nozzleOffset, type ModuleSpec } from "../sim/index.js";

/**
 * How an engine's block is drawn, in its own frame with the bells' exit at -x:
 * a combustion chamber on each bell's throat and, on a pumped engine, one
 * turbopump across the whole block on the hull's side of them. Each chamber is
 * a sphere cut flat where it sits on its throat and, where there is a pump, cut
 * a little flat where it meets that too. A pressure-fed engine has no pump, so
 * its chambers run on to the block's front as capsules, rounded there.
 * DOM-free, so it is unit-tested.
 */
export interface EngineLayout {
    /** Where the bells meet the block, and the block's forward face. */
    readonly mouth: number;
    readonly front: number;
    /** Half the block's width. */
    readonly halfWidth: number;
    readonly pressureFed: boolean;
    /**
     * Each chamber's radius; the centres along x of its aft and forward ends,
     * the same for a sphere; and how far it reaches, cut flat aft and maybe fore.
     */
    readonly radius: number;
    readonly centre: number;
    readonly nose: number;
    readonly aft: number;
    readonly fore: number;
    /** Each chamber's centre across the block, one per nozzle. */
    readonly centres: readonly number[];
    /** Where the pump's aft face is; `front` where there is none. */
    readonly pumpAft: number;
    /** Whether the pump is a cylinder: it feeds one nozzle. Feeding several, it is a block across them. */
    readonly roundPump: boolean;
}

/** How much of a pumped engine's block its chambers may take, so the pump keeps the rest. */
const CHAMBER_MOST = 0.75;
/** A chamber's width as a share of its bell's throat. */
const CHAMBER_OF_THROAT = 1.5;
/**
 * How far forward of its centre a pumped chamber is cut flat against the pump,
 * in radii: as far as there is room for, between these. Short of room, the
 * chamber is cut deeper rather than drawn narrower, so it stays wider than the
 * throat it sits on.
 */
const PUMP_CUT = 0.8;
const DEEPEST_CUT = 0.2;

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
        const most = pressureFed ? 1 : PUMP_CUT;
        const room = pressureFed ? long : long * CHAMBER_MOST;
        // Wider than its throat, and no wider than its share of the block.
        let radius = Math.min(engine.throatWidth * CHAMBER_OF_THROAT, engine.pitch) / 2;
        // Narrower only where even cut as deep as it goes it would not fit.
        if (behind(radius) + DEEPEST_CUT * radius > room) {
            let low = 0;
            for (let n = 0; n < 30; n++) {
                const mid = (low + radius) / 2;
                if (behind(mid) + DEEPEST_CUT * mid > room) radius = mid;
                else low = mid;
            }
            radius = low;
        }
        const centre = mouth + behind(radius);
        const ahead = radius > 0 ? Math.min(most, Math.max(DEEPEST_CUT, (room - behind(radius)) / radius)) : 0;
        // A pressure-fed chamber with room to spare runs on to the front as a capsule.
        const nose = pressureFed && ahead >= 1 ? Math.max(centre, front - radius) : centre;
        const fore = nose + ahead * radius;
        const centres: number[] = [];
        for (let n = 0; n < engine.nozzles; n++) centres.push(nozzleOffset(engine, n));
        made = {
            mouth,
            front,
            halfWidth: spec.width / 2,
            pressureFed,
            radius,
            centre,
            nose,
            aft: mouth,
            fore,
            centres,
            pumpAft: pressureFed ? front : fore,
            roundPump: !pressureFed && engine.nozzles === 1,
        };
        layouts.set(spec, made);
    }
    return made;
}

/** Segments in each quarter of a chamber's round. */
const SEGMENTS = 8;

/**
 * A capsule `radius` round between centres `x` and `nose` along x at `y` (a
 * sphere where they are the same), cut flat at `aft` and `fore`, anticlockwise.
 */
export function cutCapsule(x: number, nose: number, y: number, radius: number, aft: number, fore: number): number[] {
    const out: number[] = [];
    const angle = (at: number, about: number): number => Math.acos(Math.min(1, Math.max(-1, (at - about) / radius)));
    const from = angle(fore, nose);
    const to = angle(aft, x);
    const arc = (about: number, a0: number, a1: number): void => {
        for (let k = 0; k <= SEGMENTS; k++) {
            const t = a0 + ((a1 - a0) * k) / SEGMENTS;
            out.push(about + radius * Math.cos(t), y + radius * Math.sin(t));
        }
    };
    // Over the top from the fore cut to the aft one, then back underneath.
    arc(nose, from, Math.PI / 2);
    arc(x, Math.PI / 2, to);
    arc(x, -to, -Math.PI / 2);
    arc(nose, -Math.PI / 2, -from);
    return out;
}
