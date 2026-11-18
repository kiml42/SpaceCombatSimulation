/**
 * How the 3D views look at the battle: a camera swung round the point the
 * 2D camera is on, tilted from straight down by `tilt`, from the side `turn`
 * says, through a lens `fov` wide. Clicks are found on the deck through it
 * (`worldAt` in render/layerView.ts).
 */
export interface ViewAngle {
    /** Degrees from straight down, 0 to `MOST_TILT`. */
    readonly tilt: number;
    /** Degrees round from looking up the screen. */
    readonly turn: number;
    /** Degrees of the lens, top to bottom. */
    readonly fov: number;
}

export const MOST_TILT = 75;

export const DEFAULT_ANGLE: ViewAngle = { tilt: 0, turn: 0, fov: 50 };

/** What the editors are seen from: a little tilted, through a long lens, so depth shows without leaning far. */
export const EDITOR_ANGLE: ViewAngle = { tilt: 25, turn: 0, fov: 12 };

const KEY = "scs2d.viewAngle";
const EVENT = "scs2d-view-angle";

let current: ViewAngle | null = null;

export function viewAngle(): ViewAngle {
    if (current !== null) return current;
    try {
        const kept = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ViewAngle> | null;
        current = { tilt: kept?.tilt ?? DEFAULT_ANGLE.tilt, turn: kept?.turn ?? DEFAULT_ANGLE.turn, fov: kept?.fov ?? DEFAULT_ANGLE.fov };
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
