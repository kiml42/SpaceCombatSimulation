import type { WellSpec } from "./gravity.js";
import { abs, cos, normalizeAngle, PI, sin, sqrt, TAU } from "./math.js";
import type { ForceProvider, World } from "./world.js";

/**
 * Wells that move, on rails.
 *
 * A well is moved by a function of time, never integrated, so nothing a ship
 * does reaches it and a battle copied or replayed puts it in the same place.
 * Its motion is a hierarchy of two-body Kepler orbits: two wells circling their
 * shared centre on ellipses, and a pair treated as one body to orbit a third.
 * Real three-body motion is not attempted; a map with three or more is laid
 * out so the pairing is a fair approximation.
 */

/**
 * The relative orbit of a pair: where the second is from the first, on an
 * ellipse with the first at a focus.
 */
export interface Orbit {
    /** Semi-major axis, metres. */
    readonly a: number;
    /** Eccentricity, from 0 (a circle) up to but not including 1. */
    readonly e: number;
    /** Bearing of periapsis from the first body, radians. */
    readonly periapsis?: number;
    /** Mean anomaly at time zero, radians: 0 starts at periapsis, π at apoapsis. */
    readonly phase?: number;
    /** Clockwise rather than anticlockwise. */
    readonly retrograde?: boolean;
}

/** One well, or a pair of systems circling their shared centre. */
export type System = { readonly well: number } | { readonly pair: readonly [System, System]; readonly orbit: Orbit };

/** A system of wells, its shared centre fixed at `x`, `y`. */
export interface Rails {
    readonly x?: number;
    readonly y?: number;
    readonly root: System;
}

/** Newton steps Kepler's equation is given; it has converged long before at any eccentricity below 0.99. */
const KEPLER_ITERATIONS = 30;

/** Total GM of a system. */
export function systemGm(system: System, wells: readonly WellSpec[]): number {
    if ("well" in system) return wells[system.well]!.gm;
    return systemGm(system.pair[0], wells) + systemGm(system.pair[1], wells);
}

/** Seconds a pair takes round its orbit. */
export function orbitPeriod(orbit: Orbit, gm: number): number {
    return TAU * sqrt((orbit.a * orbit.a * orbit.a) / gm);
}

/** Eccentric anomaly for mean anomaly `m`: Kepler's equation `M = E − e sin E`, by Newton's method. */
export function eccentricAnomaly(m: number, e: number): number {
    let E = e < 0.8 ? m : m < 0 ? -PI : PI;
    for (let k = 0; k < KEPLER_ITERATIONS; k++) {
        const step = (E - e * sin(E) - m) / (1 - e * cos(E));
        E -= step;
        if (abs(step) < 1e-13) break;
    }
    return E;
}

/**
 * Where the second of a pair is from the first at time `t`, and how fast it is
 * going, into `out` as x, y, vx, vy. `gm` is the pair's total.
 */
export function orbitState(orbit: Orbit, gm: number, t: number, out: Float64Array): void {
    const { a, e } = orbit;
    const n = sqrt(gm / (a * a * a));
    const m = normalizeAngle((orbit.phase ?? 0) + normalizeAngle(n * t));
    const E = eccentricAnomaly(m, e);
    const sE = sin(E);
    const cE = cos(E);
    const b = a * sqrt(1 - e * e);
    const rate = n / (1 - e * cE);
    const flip = orbit.retrograde === true ? -1 : 1;
    const px = a * (cE - e);
    const py = flip * b * sE;
    const pvx = -a * sE * rate;
    const pvy = flip * b * cE * rate;
    const w = orbit.periapsis ?? 0;
    const sw = sin(w);
    const cw = cos(w);
    out[0] = px * cw - py * sw;
    out[1] = px * sw + py * cw;
    out[2] = pvx * cw - pvy * sw;
    out[3] = pvx * sw + pvy * cw;
}

/**
 * Moves the wells along their rails, as the first force provider of a world so
 * every other reads them where they are. Holds no state but scratch, so a
 * battle copied mid-flight moves its own wells to the same places.
 */
export class Railway implements Exclude<ForceProvider, (world: World) => void> {
    private readonly scratch = new Float64Array(4);

    constructor(
        readonly rails: Rails,
        readonly wells: readonly WellSpec[],
    ) {
        this.at(0);
    }

    applyForces(world: World): void {
        this.at(world.forcesAt);
    }

    /** Put every well where its rail has it at `t` seconds. */
    at(t: number): void {
        this.place(this.rails.root, this.rails.x ?? 0, this.rails.y ?? 0, 0, 0, t);
    }

    private place(system: System, x: number, y: number, vx: number, vy: number, t: number): void {
        if ("well" in system) {
            const well = this.wells[system.well]!;
            well.x = x;
            well.y = y;
            well.vx = vx;
            well.vy = vy;
            return;
        }
        const [first, second] = system.pair;
        const gm1 = systemGm(first, this.wells);
        const gm2 = systemGm(second, this.wells);
        const gm = gm1 + gm2;
        const s = this.scratch;
        orbitState(system.orbit, gm, t, s);
        // Each sits off the shared centre in proportion to the other's share.
        const rx = s[0]!;
        const ry = s[1]!;
        const rvx = s[2]!;
        const rvy = s[3]!;
        const k1 = gm2 / gm;
        const k2 = gm1 / gm;
        this.place(first, x - rx * k1, y - ry * k1, vx - rvx * k1, vy - rvy * k1, t);
        this.place(second, x + rx * k2, y + ry * k2, vx + rvx * k2, vy + rvy * k2, t);
    }
}
