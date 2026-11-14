import type { Battle } from "../scenarios/types.js";
import { math } from "../sim/index.js";

/**
 * Giving up on a fighter that has sat still in `frame`'s frame (a ship index), touching something, for `seconds`:
 * crashed for good, on it or on something moored to it.
 */
export interface Stillness {
    readonly frame: number;
    readonly seconds: number;
}

/** How far a fighter may drift, metres, and still count as not having moved. */
const STILL = 0.1;

/**
 * When each of `fighters` came home, by `home`, run until all have, or have stopped for good by `stopped`, or
 * `limit` seconds pass: the step it landed or stopped on, in seconds, or that it had done neither by then; and how
 * many bumps and crashes the battle had. Recorded as the goldens are, to say what happens rather than whether it is
 * good, so any change to it shows.
 */
export function landings(
    run: Battle,
    fighters: readonly number[],
    home: (k: number) => boolean,
    limit: number,
    stopped?: Stillness,
): { landed: string[]; bumps: number; crashes: number } {
    const bodies = run.world.bodies;
    const at: (number | null)[] = fighters.map(() => null);
    const stuck: (number | null)[] = fighters.map(() => null);
    // Where each fighter was in the frame when it last moved, and the step that was.
    const sinceX = fighters.map(() => NaN);
    const sinceY = fighters.map(() => NaN);
    const since = fighters.map(() => 0);
    // The last step it touched anything, so one hovering still is not taken for crashed.
    const touched = fighters.map(() => -1);
    const open = (k: number): boolean => at[k] === null && stuck[k] === null;
    for (let t = 1; t <= limit * 60 && fighters.some((_, k) => open(k)); t++) {
        run.step();
        for (let k = 0; k < at.length; k++) if (open(k) && home(k)) at[k] = t;
        if (stopped === undefined) continue;
        const fb = bodies.indexOf(run.ships.body(stopped.frame));
        const contacts = run.collisions.contacts;
        for (let k = 0; k < at.length; k++) {
            if (!open(k)) continue;
            const b = bodies.indexOf(run.ships.body(fighters[k]!));
            if (b < 0 || fb < 0) continue;
            for (let n = 0; n < contacts.count; n++) {
                if (contacts.a[n] === b || contacts.b[n] === b) touched[k] = t;
            }
            const dx = bodies.x[b]! - bodies.x[fb]!;
            const dy = bodies.y[b]! - bodies.y[fb]!;
            const c = math.cos(-bodies.angle[fb]!);
            const s = math.sin(-bodies.angle[fb]!);
            const x = dx * c - dy * s;
            const y = dx * s + dy * c;
            if (!(math.sqrt((x - sinceX[k]!) ** 2 + (y - sinceY[k]!) ** 2) <= STILL)) {
                sinceX[k] = x;
                sinceY[k] = y;
                since[k] = t;
            } else if (t - since[k]! >= stopped.seconds * 60 && touched[k]! >= since[k]!) stuck[k] = since[k]!;
        }
    }
    const seconds = (t: number): string => `${(t / 60).toFixed(2)} s`;
    return {
        landed: at.map((t, k) => (t !== null ? seconds(t) : stuck[k] !== null ? `stopped at ${seconds(stuck[k]!)}` : `not by ${limit} s`)),
        bumps: run.contactGrades.bumps,
        crashes: run.contactGrades.crashes,
    };
}
