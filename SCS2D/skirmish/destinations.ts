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
    readonly hint: string;
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

const majors = (s: SkirmishSettings): number => s.map.majors ?? DEFAULT_MAP.majors;
const minors = (s: SkirmishSettings): number => s.map.minors ?? DEFAULT_MAP.minors;

export const DESTINATIONS: readonly Destination[] = [
    {
        id: "further",
        name: "Long range",
        hint: `The fleets start ${GAP_STEP} m further apart`,
        open: () => true,
        apply: (s) => ({ ...s, gap: s.gap + GAP_STEP }),
    },
    {
        id: "closer",
        name: "Close quarters",
        hint: `The fleets start ${GAP_STEP} m closer, or touching range`,
        open: (s) => s.gap > 0,
        apply: (s) => ({ ...s, gap: math.max(0, s.gap - GAP_STEP) }),
    },
    {
        id: "rocks",
        name: "Asteroid field",
        hint: "More rock to fight among: a scatter of minor asteroids, and another major while there are fewer than two",
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
        hint: "No asteroids at all",
        open: (s) => majors(s) > 0 || minors(s) > 0,
        apply: (s) => ({ ...s, map: { ...s.map, majors: 0, minors: 0 }, mapSpread: { ...s.mapSpread, majors: 0, minors: 0 } }),
    },
    {
        id: "headOn",
        name: "Head on",
        hint: `The fleets start closing at ${SPEED_STEP} m/s more`,
        open: () => true,
        apply: (s) => ({ ...s, closingSpeed: s.closingSpeed + SPEED_STEP }),
    },
    {
        id: "passing",
        name: "Passing",
        hint: `The fleets start crossing each other's path at ${SPEED_STEP} m/s more`,
        open: () => true,
        apply: (s) => ({ ...s, crossingSpeed: s.crossingSpeed + SPEED_STEP }),
    },
    {
        id: "still",
        name: "From rest",
        hint: "The fleets start still",
        open: (s) => s.closingSpeed !== 0 || s.crossingSpeed !== 0,
        apply: (s) => ({ ...s, closingSpeed: 0, crossingSpeed: 0 }),
    },
];

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
