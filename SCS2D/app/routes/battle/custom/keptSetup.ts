import type { KeyValueStore } from "~/editor/library";
import { parseFleet, serialiseFleet, type Fleet } from "~/sim/index";
import { DEFAULT_FIELDS, type SetupFields, type Slot } from "./customSetup";

/** Where the custom battle's setup is kept between visits to the route. */
export const CUSTOM_SETUP_KEY = "scs2d.battle.custom";

/** A custom battle's setup as it was left, and which side, if any, went to an editor. */
export interface KeptSetup {
    readonly slots: readonly Slot[];
    readonly fields: SetupFields;
    readonly editing: number | null;
}

/** Keep the setup, with the side going to an editor if one is. */
export function keepSetup(store: KeyValueStore, slots: readonly Slot[], fields: SetupFields, editing: number | null = null): void {
    const value = { slots: slots.map((slot) => ({ fleet: serialiseFleet(slot.fleet), source: slot.source })), fields, editing };
    try {
        store.setItem(CUSTOM_SETUP_KEY, JSON.stringify(value));
    } catch {
        // Storage full or refused: the setup lasts as long as the route.
    }
}

/** The setup kept, or null where there is none or it cannot be read. */
export function keptSetup(store: KeyValueStore): KeptSetup | null {
    try {
        const raw = store.getItem(CUSTOM_SETUP_KEY);
        if (raw === null) return null;
        const value = JSON.parse(raw) as {
            slots: { fleet: unknown; source: Slot["source"] }[];
            fields: Partial<SetupFields>;
            editing?: unknown;
        };
        return {
            slots: value.slots.map((slot) => ({ fleet: parseFleet(slot.fleet), source: slot.source })),
            fields: { ...DEFAULT_FIELDS, ...value.fields, map: { ...DEFAULT_FIELDS.map, ...value.fields.map } },
            editing: typeof value.editing === "number" && value.editing >= 0 && value.editing < value.slots.length ? value.editing : null,
        };
    } catch {
        // Unreadable: a setup never kept.
        return null;
    }
}

/**
 * The setup an editor hands a fleet back to: the side that went to it replaced
 * by what came back, named from the library where it is there by that name,
 * as the editors keep what they had on leaving.
 */
export function withReturned(
    kept: KeptSetup & { editing: number },
    fleet: Fleet,
    saved: (kind: "fleet" | "ship", name: string) => boolean,
): Slot[] {
    const went = kept.slots[kept.editing]!.source;
    const kind = went.kind === "ship" ? "ship" : "fleet";
    const source: Slot["source"] = saved(kind, fleet.name)
        ? { kind, name: fleet.name }
        : { kind: "other", label: `${fleet.name} (from the editor)` };
    return kept.slots.map((slot, i) => (i === kept.editing ? { fleet, source } : slot));
}
