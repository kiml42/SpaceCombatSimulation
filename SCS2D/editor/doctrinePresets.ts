import { APPROACH_FIELDS, DEFAULT_DOCTRINE, type Approach, type Doctrine, type Targeting } from "../sim/index.js";
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
 * **Every preset sets every field any preset touches**, the ones it does not
 * care about at their defaults. So one preset picked after another replaces
 * it whole, rather than leaving the first's numbers behind in fields the
 * second does not mention.
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
        name: "Torpedo",
        hint: "Goes for the biggest thing there is and rams it",
        targeting: { preferredMass: 20, ramMass: 20, massWeight: 100 },
        approach: { ramRadii: 3, ramArmed: 1, approachSpeed: 150 },
    },
];

const TOUCHED = {
    targeting: [...new Set(DOCTRINE_PRESETS.flatMap((preset) => Object.keys(preset.targeting ?? {})))] as (keyof Targeting)[],
    approach: APPROACH_FIELDS.filter((field) => DOCTRINE_PRESETS.some((preset) => preset.approach?.[field] !== undefined)),
};

/** One field a preset sets: the half of the doctrine it is in, its name and its value. */
export interface PresetField {
    readonly half: "targeting" | "approach";
    readonly field: string;
    readonly value: number;
}

/** Every field `preset` sets, including those it leaves at their defaults. */
export function presetFields(preset: DoctrinePreset): PresetField[] {
    return (["targeting", "approach"] as const).flatMap((half) =>
        TOUCHED[half].map((field) => ({
            half,
            field,
            value:
                (preset[half] as Record<string, number> | undefined)?.[field] ??
                (DEFAULT_DOCTRINE[half] as unknown as Record<string, number>)[field]!,
        })),
    );
}

/** A blueprint's doctrine with `preset` written over it; `undefined` where that leaves it the default. */
export function withPreset(doctrine: Doctrine | undefined, preset: DoctrinePreset): Doctrine | undefined {
    let next = doctrine;
    for (const { half, field, value } of presetFields(preset)) next = withShipField(next, half, field, value);
    return next;
}
