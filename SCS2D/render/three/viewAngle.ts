/**
 * How the 3D views look at the battle: a camera swung round the point the
 * 2D camera is on, tilted from straight down by `tilt`, from the side `turn`
 * says, through a lens `fov` wide. Tilt and lens are settings; turn is only
 * ever a right-drag's swing. Clicks are found on the deck through it
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
        current = { tilt: kept?.tilt ?? DEFAULT_ANGLE.tilt, turn: 0, fov: kept?.fov ?? DEFAULT_ANGLE.fov };
    } catch {
        current = DEFAULT_ANGLE;
    }
    return current;
}

export function setViewAngle(change: Partial<Omit<ViewAngle, "turn">>): void {
    const next = { ...viewAngle(), ...change };
    current = { ...next, tilt: Math.max(0, Math.min(MOST_TILT, next.tilt)) };
    try {
        localStorage.setItem(KEY, JSON.stringify({ tilt: current.tilt, fov: current.fov }));
    } catch {
        // Kept for this page only.
    }
    window.dispatchEvent(new CustomEvent(EVENT));
}

export function onViewAngleChange(listener: () => void): () => void {
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
}

/** How far a right-drag has swung the camera off the set angle, degrees; it eases back once let go. */
let swing = { tilt: 0, turn: 0 };
let easing = 0;
/** Seconds for the swing to fall by e once let go. */
const EASE_S = 0.12;

/** The set angle, swung by any right-drag. */
export function shownAngle(): ViewAngle {
    const set = viewAngle();
    if (swing.tilt === 0 && swing.turn === 0) return set;
    return { ...set, tilt: Math.max(0, Math.min(MOST_TILT, set.tilt + swing.tilt)), turn: set.turn + swing.turn };
}

/** Swing the camera by this much more, for as long as the drag lasts. */
export function swingBy(tilt: number, turn: number): void {
    cancelAnimationFrame(easing);
    const set = viewAngle().tilt;
    // Kept within what can be shown, so dragging back undoes it at once.
    swing = { tilt: Math.max(-set, Math.min(MOST_TILT - set, swing.tilt + tilt)), turn: swing.turn + turn };
}

/** Ease the swing back to the set angle. */
export function letGo(): void {
    cancelAnimationFrame(easing);
    // The short way back round.
    swing = { ...swing, turn: ((((swing.turn + 180) % 360) + 360) % 360) - 180 };
    let last = performance.now();
    const step = (now: number): void => {
        const keep = Math.exp(-(now - last) / 1000 / EASE_S);
        last = now;
        swing = { tilt: swing.tilt * keep, turn: swing.turn * keep };
        if (Math.abs(swing.tilt) + Math.abs(swing.turn) < 0.05) swing = { tilt: 0, turn: 0 };
        else easing = requestAnimationFrame(step);
    };
    easing = requestAnimationFrame(step);
}
