/**
 * How the 3D views look at the battle: tilted from straight down by `tilt`,
 * from the side `turn` says, through a lens `fov` wide.
 *
 * `orbit` false keeps the ship plane exactly where the 2D view has it, by
 * moving the eye and shearing the frustum to match (an off-axis projection),
 * so clicks and everything drawn flat still line up. True swings a camera
 * round the plane, which looks more like 3D but leaves input where it was.
 */
export interface ViewAngle {
    /** Degrees from straight down, 0 to `MOST_TILT`. */
    readonly tilt: number;
    /** Degrees round from looking up the screen. */
    readonly turn: number;
    /** Degrees of the lens, top to bottom. */
    readonly fov: number;
    readonly orbit: boolean;
}

export const MOST_TILT = 75;

export const DEFAULT_ANGLE: ViewAngle = { tilt: 0, turn: 0, fov: 50, orbit: false };

/** What the editors are seen from: a little tilted, through a long lens, so depth shows without leaning far. */
export const EDITOR_ANGLE: ViewAngle = { tilt: 25, turn: 0, fov: 12, orbit: false };

const KEY = "scs2d.viewAngle";
const EVENT = "scs2d-view-angle";

let current: ViewAngle | null = null;

export function viewAngle(): ViewAngle {
    if (current !== null) return current;
    try {
        const kept = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ViewAngle> | null;
        current = { ...DEFAULT_ANGLE, ...(kept ?? {}) };
    } catch {
        current = DEFAULT_ANGLE;
    }
    return current;
}

export function setViewAngle(change: Partial<ViewAngle>): void {
    const next = { ...viewAngle(), ...change };
    current = { ...next, tilt: Math.max(0, Math.min(MOST_TILT, next.tilt)), turn: ((next.turn % 360) + 360) % 360 };
    try {
        localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
        // Kept for this page only.
    }
    window.dispatchEvent(new CustomEvent(EVENT));
}

export function onViewAngleChange(listener: () => void): () => void {
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
}
