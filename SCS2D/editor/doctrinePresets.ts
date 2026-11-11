import { APPROACH_FIELDS, DEFAULT_DOCTRINE, SHIP_TARGETING_FIELDS, type Approach, type Doctrine, type Targeting } from "../sim/index.js";
import { withShipField } from "./doctrine.js";

/**
 * Ready-made ways for a ship to fight, offered at the top of the doctrine
 * panels as a quick start.
 *
 * **A preset is an action, not a setting.** Picking one writes its numbers
 * into the ship's doctrine as though typed, and nothing remembers which was
 * picked: what the ship goes by is still only its numbers, so a preset tweaked
 * afterwards is just a doctrine.
 *
 * **A preset is the whole of the ship's doctrine**: every number it does not
 * name goes back to its default, so nothing left over from before, or from
 * another preset, works against it.
 */
export interface DoctrinePreset {
    readonly name: string;
    /** What it does, for the tooltip. */
    readonly hint: string;
    readonly targeting?: Readonly<Partial<Targeting>>;
    readonly approach?: Readonly<Partial<Approach>>;
}

export const DOCTRINE_PRESETS: readonly DoctrinePreset[] = [
    {
        name: "Standard",
        hint: "The default doctrine: holds at two thirds of its reach and fights what is near",
    },
    {
        name: "Sniper",
        hint: "Holds at the edge of its reach, however big the target, and keeps away from anything that closes",
        targeting: { closingWeight: 30 },
        approach: { standoffRadii: 10000, standoff: 0.95, tolerance: 0.05, fleeMargin: 2 },
    },
    {
        name: "Knife fighter",
        hint: "Goes in close for sure hits, and circles so slow guns cannot track it",
        targeting: { proximityWeight: 150 },
        approach: { standoffRadii: 4, standoff: 0.3, approachSpeed: 120, tangentialMin: 30, tangentialMax: 120 },
    },
    {
        name: "Gun line",
        hint: "Keeps its main guns on its target rather than turning to its engines; for spinal mounts",
        targeting: { loyaltyWeight: 60, facingWeight: 60 },
        approach: { burnWeight: 0.5, rangeHold: 4, turnBias: 0.2 },
    },
    {
        name: "Scavenger",
        hint: "Keeps its holds full from wrecks and rocks, and withdraws rather than fight once it is losing",
        approach: {
            scavengeFuelBelow: 0.8,
            scavengeMetalBelow: 0.8,
            scavengeDanger: 3,
            deliverFuelAbove: 0.9,
            fleeArmed: 0.5,
        },
    },
    {
        name: "Tender",
        hint: "Scavenges and mines whenever it has room, and takes fuel to friends that want it",
        approach: {
            scavengeFuelBelow: 0.9,
            scavengeMetalBelow: 0.9,
            deliverFuelAbove: 0.5,
            scavengeDanger: 3,
            dockDanger: 2,
            fleeArmed: 0.5,
        },
    },
    {
        name: "Escort",
        hint: "Stays by a friend, and turns its guns on anything that comes near",
        targeting: { escortWeight: 100, loyaltyWeight: 40 },
        approach: { rangeHold: 4, burnWeight: 1 },
    },
    {
        name: "Torpedo",
        hint: "Goes for the biggest thing there is and rams it",
        targeting: { preferredMass: 20, ramMass: 20, massWeight: 100 },
        approach: { ramRadii: 3, ramArmed: 1, approachSpeed: 150 },
    },
];

/** One field a preset sets: the half of the doctrine it is in, its name and its value. */
export interface PresetField {
    readonly half: "targeting" | "approach";
    readonly field: string;
    readonly value: number;
}

const SHIP_FIELDS = { targeting: SHIP_TARGETING_FIELDS, approach: APPROACH_FIELDS } as const;

/** Every field of a ship's doctrine as `preset` leaves it: its own numbers, and every other at its default. */
export function presetFields(preset: DoctrinePreset): PresetField[] {
    return (["targeting", "approach"] as const).flatMap((half) =>
        (SHIP_FIELDS[half] as readonly string[]).map((field) => ({
            half,
            field,
            value:
                (preset[half] as Record<string, number> | undefined)?.[field] ??
                (DEFAULT_DOCTRINE[half] as unknown as Record<string, number>)[field]!,
        })),
    );
}

/** A ship's doctrine as `preset` makes it, whatever it was; `undefined` where that is the default. */
export function presetDoctrine(preset: DoctrinePreset): Doctrine | undefined {
    let next: Doctrine | undefined = undefined;
    for (const { half, field, value } of presetFields(preset)) next = withShipField(next, half, field, value);
    return next;
}
