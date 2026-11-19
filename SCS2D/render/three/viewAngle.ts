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

/** Seconds for a swing to fall by e once let go. */
const EASE_S = 0.12;

/** How far a right-drag has swung a camera off its set angle, degrees; it eases back once let go. */
export class Swing {
    private tilt = 0;
    private turn = 0;
    private easing = 0;

    /** `moved` is told each time it moves, for a view that draws only when asked. */
    constructor(private readonly moved: () => void = () => {}) {}

    /** `set`, swung. */
    shown(set: ViewAngle): ViewAngle {
        if (this.tilt === 0 && this.turn === 0) return set;
        return { ...set, tilt: Math.max(0, Math.min(MOST_TILT, set.tilt + this.tilt)), turn: set.turn + this.turn };
    }

    /** Swing by this much more off `set`, for as long as the drag lasts. */
    by(tilt: number, turn: number, set: ViewAngle): void {
        cancelAnimationFrame(this.easing);
        // Kept within what can be shown, so dragging back undoes it at once.
        this.tilt = Math.max(-set.tilt, Math.min(MOST_TILT - set.tilt, this.tilt + tilt));
        this.turn += turn;
        this.moved();
    }

    /** Ease back to the set angle. */
    letGo(): void {
        cancelAnimationFrame(this.easing);
        // The short way back round.
        this.turn = ((((this.turn + 180) % 360) + 360) % 360) - 180;
        let last = performance.now();
        const step = (now: number): void => {
            const keep = Math.exp(-(now - last) / 1000 / EASE_S);
            last = now;
            this.tilt *= keep;
            this.turn *= keep;
            if (Math.abs(this.tilt) + Math.abs(this.turn) < 0.05) this.tilt = this.turn = 0;
            else this.easing = requestAnimationFrame(step);
            this.moved();
        };
        this.easing = requestAnimationFrame(step);
    }

    dispose(): void {
        cancelAnimationFrame(this.easing);
    }
}
