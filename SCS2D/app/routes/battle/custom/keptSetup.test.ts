import { expect, test } from "vitest";
import { memoryStore } from "~/features/storage/observedStorage";
import { BLUEPRINTS } from "~/scenarios/blueprints";
import { serialiseFleet, shipFleet } from "~/sim/index";
import { DEFAULT_FIELDS, type Slot } from "./customSetup";
import { CUSTOM_SETUP_KEY, keepSetup, keptSetup, withReturned } from "./keptSetup";

const [one, two] = Object.values(BLUEPRINTS);
const slots: Slot[] = [
    { fleet: shipFleet(one!), source: { kind: "ship", name: one!.name } },
    { fleet: shipFleet(two!), source: { kind: "other", label: "from a file" } },
];

test("keeps the sides, the boxes and the side gone to an editor", () => {
    const store = memoryStore();
    keepSetup(store, slots, { ...DEFAULT_FIELDS, range: "2500" }, 1);
    const kept = keptSetup(store)!;
    expect(kept.slots.map((slot) => serialiseFleet(slot.fleet))).toEqual(slots.map((slot) => serialiseFleet(slot.fleet)));
    expect(kept.slots[1]!.source).toEqual({ kind: "other", label: "from a file" });
    expect(kept.fields.range).toBe("2500");
    expect(kept.editing).toBe(1);
});

test("reads nothing it cannot use as no setup at all", () => {
    const store = memoryStore();
    expect(keptSetup(store)).toBeNull();
    store.setItem(CUSTOM_SETUP_KEY, "not json");
    expect(keptSetup(store)).toBeNull();
});

test("puts what an editor hands back in the place of the side that went to it", () => {
    const back = { ...shipFleet(one!), name: "Renamed" };
    const kept = { slots, fields: DEFAULT_FIELDS, editing: 0 };
    const saved = withReturned(kept, back, (kind, name) => kind === "ship" && name === "Renamed");
    expect(saved[0]).toEqual({ fleet: back, source: { kind: "ship", name: "Renamed" } });
    expect(saved[1]).toBe(slots[1]);
    // Not in the library under its name: shown as handed back.
    const unsaved = withReturned(kept, back, () => false);
    expect(unsaved[0]!.source).toEqual({ kind: "other", label: "Renamed (from the editor)" });
});
