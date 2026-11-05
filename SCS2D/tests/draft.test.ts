import { describe, expect, it } from "vitest";
import { DRAFT_KEY, draftOf, keepDraft, sameShip } from "../editor/draft.js";
import type { KeyValueStore } from "../editor/library.js";
import { CORVETTE } from "../scenarios/blueprints.js";

function memoryStore(entries: Record<string, string> = {}): KeyValueStore {
    const items = new Map(Object.entries(entries));
    return {
        get length() {
            return items.size;
        },
        key: (index) => [...items.keys()][index] ?? null,
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => void items.set(key, value),
        removeItem: (key) => void items.delete(key),
    };
}

describe("the ship draft", () => {
    it("gives back the ship kept, when that ship or none is asked for", () => {
        const store = memoryStore();
        const edited = { ...CORVETTE, notes: "edited" };
        keepDraft(store, edited);
        expect(sameShip(draftOf(store, null)!, edited)).toBe(true);
        expect(sameShip(draftOf(store, CORVETTE.name)!, edited)).toBe(true);
        expect(draftOf(store, "Gunship")).toBeNull();
    });

    it("keeps one draft in all: the ship last kept", () => {
        const store = memoryStore();
        keepDraft(store, CORVETTE);
        keepDraft(store, { ...CORVETTE, name: "Other" });
        expect(draftOf(store, CORVETTE.name)).toBeNull();
        expect(draftOf(store, "Other")?.name).toBe("Other");
    });

    it("is nothing when there is none or it does not read", () => {
        expect(draftOf(memoryStore(), null)).toBeNull();
        expect(draftOf(memoryStore({ [DRAFT_KEY]: "{not json" }), null)).toBeNull();
    });

    it("tells a changed ship from the one it was", () => {
        expect(sameShip(CORVETTE, { ...CORVETTE })).toBe(true);
        expect(sameShip(CORVETTE, { ...CORVETTE, notes: "changed" })).toBe(false);
    });
});
