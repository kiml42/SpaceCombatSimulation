import { expect, test } from "vitest";
import { memoryStore } from "~/features/storage/observedStorage";
import { BLUEPRINTS } from "~/scenarios/blueprints";
import { compileBlueprint, serialiseFleet, shipFleet, type Blueprint } from "~/sim/index";
import { DEFAULT_FIELDS, type Slot } from "./customSetup";
import { KEPT_SHIPS, recalledSetup, rememberShipSetups, similarOpponent, testSetup } from "./shipSetups";

const stock = (name: string): Blueprint => Object.values(BLUEPRINTS).find((blueprint) => blueprint.name === name)!;
const side = (blueprint: Blueprint, label = "from the editor"): Slot => ({ fleet: shipFleet(blueprint), source: { kind: "other", label } });
const stockKey = (name: string): string => `Stock/${name}`;

test("picks the armed stock ship nearest its mass, never itself, a fighter or one unarmed", () => {
    const corvette = stock("Corvette");
    // The Tanker is nearer the Corvette's mass, but unarmed.
    expect(similarOpponent(corvette, compileBlueprint(corvette).mass)?.name).toBe("Beam Corvette");
    expect(similarOpponent({ ...corvette, name: "Mine" }, compileBlueprint(corvette).mass)?.name).toBe("Corvette");
    // Nearest by ratio: a tonne is nearer the Dinky's five than the Corvette's three hundred, but the Dinky is a fighter.
    expect(similarOpponent({ ...corvette, name: "Tiny" }, 1000)?.category).toBe("Stock");
    expect(similarOpponent({ ...corvette, name: "Tiny" }, 1000)?.fighter).not.toBe(true);
});

test("a ship first tested fights the stock ship nearest its mass, with the boxes as last left", () => {
    const store = memoryStore();
    const fields = { ...DEFAULT_FIELDS, range: "1234" };
    const setup = testSetup(store, side(stock("Corvette")), fields, stockKey);
    expect(setup.slots.map((slot) => slot.fleet.name)).toEqual(["Corvette", "Beam Corvette"]);
    expect(setup.slots[1]!.source).toEqual({ kind: "ship", name: "Stock/Beam Corvette" });
    expect(setup.fields).toBe(fields);
});

test("a ship tested again gets back its last battle: its side, its opponents and its boxes", () => {
    const store = memoryStore();
    const mine = { ...stock("Corvette"), name: "Mine", category: "My ships" };
    const gunship: Slot = { fleet: shipFleet(stock("Gunship")), source: { kind: "ship", name: "Stock/Gunship" } };
    rememberShipSetups(store, [gunship, side(mine)], { ...DEFAULT_FIELDS, range: "4000" });

    // A later version of it, by the same name.
    const changed = { ...mine, notes: "Mk II" };
    const setup = testSetup(store, side(changed, "again"), DEFAULT_FIELDS, stockKey);
    expect(setup.slots.map((slot) => slot.fleet.name)).toEqual(["Gunship", "Mine"]);
    expect(setup.slots[0]!.source).toEqual(gunship.source);
    expect(serialiseFleet(setup.slots[1]!.fleet)).toEqual(serialiseFleet(shipFleet(changed)));
    expect(setup.fields.range).toBe("4000");

    // Another category is another ship.
    expect(recalledSetup(store, side({ ...mine, category: "Elsewhere" }))).toBeNull();
});

test("a ship alone is not a battle, and only the most recent ships are kept", () => {
    const store = memoryStore();
    const corvette = stock("Corvette");
    rememberShipSetups(store, [side(corvette)], DEFAULT_FIELDS);
    expect(recalledSetup(store, side(corvette))).toBeNull();

    const opponent = side(stock("Gunship"));
    for (let i = 0; i <= KEPT_SHIPS; i++) rememberShipSetups(store, [side({ ...corvette, name: `Ship ${i}` }), opponent], DEFAULT_FIELDS);
    expect(recalledSetup(store, side({ ...corvette, name: "Ship 0" }))).toBeNull();
    expect(recalledSetup(store, side({ ...corvette, name: `Ship ${KEPT_SHIPS}` }))).not.toBeNull();
});
