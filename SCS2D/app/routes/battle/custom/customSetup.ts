import { DEFAULT_SETUP, type BattleSetup } from "~/scenarios/customBattle";
import { DEFAULT_MAP, degreesToRadians, MAP_KEYS, radiansToDegrees, writeMap, type Fleet, type MapKey } from "~/sim/index";

/**
 * A side of a custom battle: its fleet, and where that came from — a fleet or a
 * single ship from a library, by name, or somewhere the libraries cannot give
 * back (a file, an editor, a link), described.
 */
export interface Slot {
    readonly fleet: Fleet;
    readonly source: { readonly kind: "fleet" | "ship"; readonly name: string } | { readonly kind: "other"; readonly label: string };
}

/** Each setting as its box holds it: text, so a box can be empty or half typed. */
export interface SetupFields {
    readonly range: string;
    readonly rangeSpread: string;
    readonly closing: string;
    readonly closingSpread: string;
    readonly crossing: string;
    readonly crossingSpread: string;
    readonly rotation: string;
    readonly rotationSpread: string;
    readonly seed: string;
    readonly map: Readonly<Record<MapKey, string>>;
}

/** The boxes filled from a setup: its own settings, defaults where it says nothing, angles in degrees. */
export function fieldsOf(setup: Omit<BattleSetup, "fleets">): SetupFields {
    const map = {} as Record<MapKey, string>;
    for (const key of MAP_KEYS) map[key] = String(setup.map?.[key] ?? DEFAULT_MAP[key]);
    return {
        range: String(setup.range),
        rangeSpread: String(setup.spread?.range ?? 0),
        closing: String(setup.closingSpeed),
        closingSpread: String(setup.spread?.closingSpeed ?? 0),
        crossing: String(setup.crossingSpeed),
        crossingSpread: String(setup.spread?.crossingSpeed ?? 0),
        rotation: String(radiansToDegrees(setup.rotation)),
        rotationSpread: String(radiansToDegrees(setup.spread?.rotation ?? 0)),
        seed: String(setup.seed),
        map,
    };
}

export const DEFAULT_FIELDS: SetupFields = fieldsOf(DEFAULT_SETUP);

/** What a box says, or `fallback` where it is empty or not a number. */
function number(text: string, fallback: number): number {
    const value = Number(text);
    return text.trim() === "" || !Number.isFinite(value) ? fallback : value;
}

/** The battle the sides and boxes describe, a box that says nothing usable taken as its default. */
export function setupOf(slots: readonly Slot[], fields: SetupFields): BattleSetup {
    const map: Partial<Record<MapKey, number>> = {};
    for (const key of MAP_KEYS) {
        const value = number(fields.map[key], NaN);
        map[key] = Number.isFinite(value) && value >= 0 ? value : DEFAULT_MAP[key];
    }
    const written = writeMap(map);
    return {
        fleets: slots.map((slot) => slot.fleet),
        range: Math.max(1, number(fields.range, DEFAULT_SETUP.range)),
        closingSpeed: number(fields.closing, DEFAULT_SETUP.closingSpeed),
        crossingSpeed: number(fields.crossing, DEFAULT_SETUP.crossingSpeed),
        rotation: degreesToRadians(number(fields.rotation, 0)),
        seed: Math.round(number(fields.seed, DEFAULT_SETUP.seed)),
        spread: {
            range: Math.max(0, number(fields.rangeSpread, 0)),
            closingSpeed: Math.max(0, number(fields.closingSpread, 0)),
            crossingSpeed: Math.max(0, number(fields.crossingSpread, 0)),
            rotation: degreesToRadians(Math.max(0, number(fields.rotationSpread, 0))),
        },
        ...(written === undefined ? {} : { map: written }),
    };
}

/** A whole setup's sides, each labelled as coming from `from`, as a file or a link gives them. */
export function slotsOf(setup: BattleSetup, from: string): Slot[] {
    return setup.fleets.map((fleet) => ({ fleet, source: { kind: "other", label: `${fleet.name} (${from})` } }));
}
