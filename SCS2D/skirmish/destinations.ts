import { DEFAULT_MAP, math, Rng } from "../sim/index.js";
import type { SkirmishSettings } from "../scenarios/skirmish.js";

/**
 * Where the next round is fought, offered to the player once they win one: a
 * few changes to how a round is set out, of which they pick one. Picked
 * before the enemy breeds its answer, since that is bred on the next round as
 * it will be fought.
 */
export interface Destination {
    readonly id: string;
    readonly name: string;
    /** What it changes under these settings, from what to what. */
    readonly change: (settings: SkirmishSettings) => string;
    /** What that means for a fight. */
    readonly means: string;
    /** Whether it would change anything under these settings. */
    readonly open: (settings: SkirmishSettings) => boolean;
    readonly apply: (settings: SkirmishSettings) => SkirmishSettings;
}

/** How much a step moves the gap, m, and either starting speed, m/s. */
const GAP_STEP = 1500;
const SPEED_STEP = 40;
/**
 * The most majors a step brings: two orbit each other as real bodies do, and
 * more is an approximation, which a round has only if its setup asked for it.
 */
const MOST_MAJORS = 2;
/** The most minors a step brings a round up to. */
const MOST_MINORS = 30;
/** How much a step dims the light, and the dimmest it goes. */
const DIMMING = 0.6;
const DARKEST = 0.2;

const majors = (s: SkirmishSettings): number => s.map.majors ?? DEFAULT_MAP.majors;
const minors = (s: SkirmishSettings): number => s.map.minors ?? DEFAULT_MAP.minors;

export const DESTINATIONS: readonly Destination[] = [
    {
        id: "further",
        name: "Long range",
        change: (s) => `Fleets start ${metres(s.gap)} → ${metres(s.gap + GAP_STEP)} apart`,
        means: "More time before the guns bear: long reach and speed get the first word.",
        open: () => true,
        apply: (s) => ({ ...s, gap: s.gap + GAP_STEP }),
    },
    {
        id: "closer",
        name: "Close quarters",
        change: (s) => `Fleets start ${metres(s.gap)} → ${metres(math.max(0, s.gap - GAP_STEP))} apart`,
        means: "Guns are in reach almost at once: armour and weight of fire count for more than speed.",
        open: (s) => s.gap > 0,
        apply: (s) => ({ ...s, gap: math.max(0, s.gap - GAP_STEP) }),
    },
    {
        id: "rocks",
        name: "Asteroid field",
        change: (s) =>
            majors(s) < MOST_MAJORS
                ? `Major asteroids ${majors(s)} → ${majors(s) + 1}, minor ${minors(s)} → ${math.min(MOST_MINORS, minors(s) + 6)}`
                : `Minor asteroids ${minors(s)} → ${math.min(MOST_MINORS, minors(s) + 6)}`,
        means: "Rock to hide behind and to fight around: lines of fire break, and a major's pull drags at anything slow.",
        open: (s) => majors(s) < MOST_MAJORS || minors(s) < MOST_MINORS,
        apply: (s) => ({
            ...s,
            map: {
                ...s.map,
                majors: majors(s) < MOST_MAJORS ? majors(s) + 1 : majors(s),
                minors: math.min(MOST_MINORS, minors(s) + 6),
            },
        }),
    },
    {
        id: "clear",
        name: "Open space",
        change: (s) => `Asteroids ${majors(s) + minors(s)} → none`,
        means: "Nothing to hide behind or steer round: it comes down to the ships and their guns.",
        open: (s) => majors(s) > 0 || minors(s) > 0,
        apply: (s) => ({ ...s, map: { ...s.map, majors: 0, minors: 0 }, mapSpread: { ...s.mapSpread, majors: 0, minors: 0 } }),
    },
    {
        id: "headOn",
        name: "Head on",
        change: (s) => `Closing speed ${s.closingSpeed} → ${s.closingSpeed + SPEED_STEP} m/s`,
        means: "The fleets meet fast: a short, sharp first pass, then a long turn to come back.",
        open: () => true,
        apply: (s) => ({ ...s, closingSpeed: s.closingSpeed + SPEED_STEP }),
    },
    {
        id: "passing",
        name: "Passing",
        change: (s) => `Crossing speed ${s.crossingSpeed} → ${s.crossingSpeed + SPEED_STEP} m/s`,
        means: "The fleets slide past each other: guns that can track across matter more than fixed ones.",
        open: () => true,
        apply: (s) => ({ ...s, crossingSpeed: s.crossingSpeed + SPEED_STEP }),
    },
    {
        id: "still",
        name: "From rest",
        change: (s) =>
            [
                ...(s.closingSpeed !== 0 ? [`Closing ${s.closingSpeed} → 0 m/s`] : []),
                ...(s.crossingSpeed !== 0 ? [`crossing ${s.crossingSpeed} → 0 m/s`] : []),
            ]
                .join(", ")
                .replace(/^c/, "C"),
        means: "No momentum carrying anyone in: each side chooses when, and whether, to close.",
        open: (s) => s.closingSpeed !== 0 || s.crossingSpeed !== 0,
        apply: (s) => ({ ...s, closingSpeed: 0, crossingSpeed: 0 }),
    },
    {
        id: "dark",
        name: "Into the dark",
        change: (s) => `Sunlight ${percent(s.light)} → ${percent(math.max(DARKEST, tidy(s.light * DIMMING)))}`,
        means: "Harder to watch, as what ships light themselves is most of what shows; the fight itself is the same.",
        open: (s) => s.light > DARKEST,
        apply: (s) => ({ ...s, light: math.max(DARKEST, tidy(s.light * DIMMING)) }),
    },
    {
        id: "bright",
        name: "Into the light",
        change: (s) => `Sunlight ${percent(s.light)} → ${percent(math.min(1, tidy(s.light / DIMMING)))}`,
        means: "A brighter sun and softer shadows: easier to watch; the fight itself is the same.",
        open: (s) => s.light < 1,
        apply: (s) => ({ ...s, light: math.min(1, tidy(s.light / DIMMING)) }),
    },
];

const metres = (m: number): string => `${math.round(m).toLocaleString("en-GB")} m`;
const percent = (share: number): string => `${math.round(share * 100)}%`;

/** To two places, so a light dimmed and brightened again comes back to where it was. */
const tidy = (n: number): number => math.round(n * 100) / 100;

/** How many are offered. */
export const OFFERED = 3;

export function destinationById(id: string): Destination | null {
    return DESTINATIONS.find((destination) => destination.id === id) ?? null;
}

/** The destinations offered after a win, drawn from the next round's seed so a reload offers the same. */
export function offerDestinations(settings: SkirmishSettings, seed: number): string[] {
    const open = DESTINATIONS.filter((destination) => destination.open(settings)).map((destination) => destination.id);
    const rng = new Rng((seed ^ 0x77686572) >>> 0);
    const out: string[] = [];
    while (out.length < OFFERED && open.length > 0) out.push(open.splice(rng.nextInt(open.length), 1)[0]!);
    return out;
}
