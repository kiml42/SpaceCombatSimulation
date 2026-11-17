import { BUILT_IN, Library, SHIPS, type KeyValueStore } from "~/editor/library";
import { compileBlueprint, parseFleet, serialiseFleet, shipFleet, type Blueprint, type Fleet } from "~/sim/index";
import { DEFAULT_FIELDS, type SetupFields, type Slot } from "./customSetup";

/** Each ship's last custom battle, by its library key, most recent first. */
export const SHIP_SETUPS_KEY = "scs2d.battle.shipSetups";

/** How many ships' battles are kept: each holds whole fleets. */
export const KEPT_SHIPS = 30;

interface Kept {
    ship: string;
    side: number;
    others: { fleet: unknown; source: Slot["source"] }[];
    fields: SetupFields;
}

/** The ship a side is, if it is a single ship. */
function loneShip(fleet: Fleet): Blueprint | null {
    const [entry, ...rest] = fleet.ships;
    return entry === undefined || rest.length > 0 || !("design" in entry) ? null : (fleet.designs[entry.design] ?? null);
}

function read(store: KeyValueStore): Kept[] {
    try {
        const value = JSON.parse(store.getItem(SHIP_SETUPS_KEY) ?? "[]") as unknown;
        return Array.isArray(value) ? (value as Kept[]) : [];
    } catch {
        return [];
    }
}

/** Remember the setup against each single-ship side in it; a ship alone is not a battle, so is not kept. */
export function rememberShipSetups(store: KeyValueStore, slots: readonly Slot[], fields: SetupFields): void {
    if (slots.length < 2) return;
    const keys = new Library(store, SHIPS);
    let kept = read(store);
    slots.forEach((slot, side) => {
        const ship = loneShip(slot.fleet);
        if (ship === null) return;
        const key = keys.keyOf(ship);
        const others = slots.filter((_, i) => i !== side).map((other) => ({ fleet: serialiseFleet(other.fleet), source: other.source }));
        kept = [{ ship: key, side, others, fields }, ...kept.filter((each) => each.ship !== key)];
    });
    try {
        store.setItem(SHIP_SETUPS_KEY, JSON.stringify(kept.slice(0, KEPT_SHIPS)));
    } catch {
        // Storage full or refused: nothing remembered.
    }
}

/** This ship's last custom battle with it in its side, or null where it has none or it cannot be read. */
export function recalledSetup(store: KeyValueStore, slot: Slot): { slots: Slot[]; fields: SetupFields } | null {
    const ship = loneShip(slot.fleet);
    if (ship === null) return null;
    const key = new Library(store, SHIPS).keyOf(ship);
    const kept = read(store).find((each) => each.ship === key);
    if (kept === undefined) return null;
    try {
        const slots: Slot[] = kept.others.map((other) => ({ fleet: parseFleet(other.fleet), source: other.source }));
        slots.splice(Math.min(Math.max(0, kept.side), slots.length), 0, slot);
        return { slots, fields: { ...DEFAULT_FIELDS, ...kept.fields, map: { ...DEFAULT_FIELDS.map, ...kept.fields.map } } };
    } catch {
        return null;
    }
}

/** Whether it has something to fight with: a main weapon, or a hangar to launch what does. */
function armed(blueprint: Blueprint): boolean {
    const design = compileBlueprint(blueprint);
    return (
        design.turrets.some((turret) => turret.main) ||
        design.mainWeaponEngines.length > 0 ||
        Object.keys(blueprint.hangar ?? {}).length > 0
    );
}

let opponents: readonly { blueprint: Blueprint; mass: number }[] | null = null;

/** What the opponent is picked from: the armed stock ships, less fighters and other categories. */
function stockOpponents(): readonly { blueprint: Blueprint; mass: number }[] {
    opponents ??= BUILT_IN.filter((blueprint) => blueprint.category === "Stock" && blueprint.fighter !== true && armed(blueprint)).map(
        (blueprint) => ({ blueprint, mass: compileBlueprint(blueprint).mass }),
    );
    return opponents;
}

/** The armed stock ship nearest this one's mass, by ratio, other than itself. */
export function similarOpponent(ship: Blueprint, mass: number): Blueprint | null {
    let best: Blueprint | null = null;
    let bestRatio = Infinity;
    for (const each of stockOpponents()) {
        if (each.blueprint.name === ship.name) continue;
        const ratio = Math.max(each.mass, mass) / Math.min(each.mass, mass);
        if (ratio < bestRatio) {
            best = each.blueprint;
            bestRatio = ratio;
        }
    }
    return best;
}

/**
 * The setup a ship tested from its editor opens in: its last, if it has one,
 * else against the stock ship nearest its mass, with the boxes as last left.
 * `stockKey` gives a stock ship's library key, for its side's source.
 */
export function testSetup(
    store: KeyValueStore,
    slot: Slot,
    fields: SetupFields,
    stockKey: (name: string) => string,
): { slots: Slot[]; fields: SetupFields } {
    const recalled = recalledSetup(store, slot);
    if (recalled !== null) return recalled;
    const ship = loneShip(slot.fleet);
    if (ship === null) return { slots: [slot], fields };
    let opponent: Blueprint | null;
    try {
        opponent = similarOpponent(ship, compileBlueprint(ship).mass);
    } catch {
        // A design that does not compile has no mass to match.
        opponent = null;
    }
    if (opponent === null) return { slots: [slot], fields };
    return { slots: [slot, { fleet: shipFleet(opponent), source: { kind: "ship", name: stockKey(opponent.name) } }], fields };
}
