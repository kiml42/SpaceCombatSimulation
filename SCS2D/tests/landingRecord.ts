import type { Battle } from "../scenarios/types.js";

/**
 * When each of `fighters` came home, by `home`, run until all have or `limit` seconds pass: the step it
 * landed on, in seconds, or that it had not by then; and how many contacts the battle had. Recorded as
 * the goldens are, to say what happens rather than whether it is good, so any change to it shows.
 */
export function landings(
    run: Battle,
    fighters: readonly number[],
    home: (k: number) => boolean,
    limit: number,
): { landed: string[]; contacts: number } {
    const at: (number | null)[] = fighters.map(() => null);
    for (let t = 1; t <= limit * 60 && at.includes(null); t++) {
        run.step();
        for (let k = 0; k < at.length; k++) if (at[k] === null && home(k)) at[k] = t;
    }
    return {
        landed: at.map((t) => (t === null ? `not by ${limit} s` : `${(t / 60).toFixed(2)} s`)),
        contacts: run.totalContacts,
    };
}
