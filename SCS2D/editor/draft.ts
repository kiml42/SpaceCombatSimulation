import { parseBlueprint, serialiseBlueprint, type Blueprint } from "../sim/index.js";
import type { KeyValueStore } from "./library.js";

/**
 * The ship being edited, kept as it is after every edit, so a reload reopens
 * the work rather than the saved copy. One draft in all: it is the ship last
 * edited, apart from the library, so it never overwrites a saved ship.
 */
export const DRAFT_KEY = "scs2d.shipDraft";

/** Keep `blueprint` as the draft. Storage that is full or refused keeps nothing. */
export function keepDraft(store: KeyValueStore, blueprint: Blueprint): void {
    try {
        store.setItem(DRAFT_KEY, JSON.stringify(serialiseBlueprint(blueprint)));
    } catch {
        // Nothing more to be done: the work lasts as long as the page.
    }
}

/** The draft, if there is one and it reads; when `named`, only if it is that ship. */
export function draftOf(store: KeyValueStore, named: string | null): Blueprint | null {
    let draft: Blueprint;
    try {
        const raw = store.getItem(DRAFT_KEY);
        if (raw === null) return null;
        draft = parseBlueprint(JSON.parse(raw));
    } catch {
        return null;
    }
    return named === null || draft.name === named ? draft : null;
}

/** Whether two blueprints would be written the same: a draft that has nothing a saved copy has not. */
export function sameShip(a: Blueprint, b: Blueprint): boolean {
    return JSON.stringify(serialiseBlueprint(a)) === JSON.stringify(serialiseBlueprint(b));
}
