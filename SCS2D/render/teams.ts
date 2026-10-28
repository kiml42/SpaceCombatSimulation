/**
 * The colours each side is drawn in. DOM-free, so it is unit-tested.
 *
 * **A side differs from the others by hue alone.** Every palette here is the
 * same three tones — a mid hull, a pale trim, a dark pivot — turned round the
 * wheel, so the value ordering that makes a turret legible holds for every
 * side rather than being got right once for blue and approximated afterwards.
 * The hues are spread as far apart as four will go without colliding with
 * something that already means a thing: a gun's firing wedge goes amber when
 * it is on target, and a beam is a bright green, so the sides take blue, red,
 * green and magenta and leave the yellows alone.
 *
 * Four because that is a free-for-all of a size worth watching — an evolution
 * match puts every entrant on its own side (DESIGN.md §7). Past four they come
 * round again, so a fifth side is blue like the first: a colour shared with a
 * side far off beats one grey shared with every neutral and every wreck.
 */
const TEAM_COLOURS = [
    {
        hull: "#5b8dd6",
        trim: "#a8c8f0",
        pivot: "#2c4a72",
    },
    {
        hull: "#d65b5b",
        trim: "#f0a8a8",
        pivot: "#722c2c",
    },
    {
        hull: "#5bd66f",
        trim: "#a8f0b4",
        pivot: "#2c7238",
    },
    {
        hull: "#d65bd6",
        trim: "#f0a8f0",
        pivot: "#722c72",
    },
];
export const NEUTRAL = {
    hull: "#8a8a8a",
    trim: "#c4c4c4",
    pivot: "#4a4a4a",
};

export type Palette = (typeof TEAM_COLOURS)[number];

/**
 * How far a fighter's hull and trim are drawn towards its side's dark pivot
 * tone, and how much darker its pivot is: enough to stand out on a carrier's
 * pad and hull, which are drawn in the side's own tones. Towards the pivot
 * rather than towards black, so a fighter keeps the saturation that tells it
 * from a grey hulk.
 */
const FIGHTER_SHADE = 0.5;
const FIGHTER_PIVOT = 0.7;

function channel(hex: string, k: number): number {
    return parseInt(hex.slice(k, k + 2), 16);
}

function toHex(r: number, g: number, b: number): string {
    return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function towards(hex: string, dark: string, share: number): string {
    const mix = (k: number): number => channel(hex, k) + (channel(dark, k) - channel(hex, k)) * share;
    return toHex(mix(1), mix(3), mix(5));
}

function shaded(palette: Palette): Palette {
    return {
        hull: towards(palette.hull, palette.pivot, FIGHTER_SHADE),
        trim: towards(palette.trim, palette.pivot, FIGHTER_SHADE),
        pivot: towards(palette.pivot, "#000000", 1 - FIGHTER_PIVOT),
    };
}

const FIGHTER_COLOURS = TEAM_COLOURS.map(shaded);
const NEUTRAL_FIGHTER = shaded(NEUTRAL);

export function shipColours(team: number): Palette {
    // Below zero is nobody's side (`NEUTRAL_TEAM`, the editor's `NO_TEAM`).
    return team < 0 ? NEUTRAL : TEAM_COLOURS[team % TEAM_COLOURS.length]!;
}

/** A side's colours for a fighter: its ships', a shade darker. */
export function fighterColours(team: number): Palette {
    return team < 0 ? NEUTRAL_FIGHTER : FIGHTER_COLOURS[team % FIGHTER_COLOURS.length]!;
}

const TEAM_NAMES = ["Blue", "Red", "Green", "Magenta"];

/** A side's name, which is its colour's; empty for nobody's side. */
export function teamName(team: number): string {
    return team < 0 ? "" : TEAM_NAMES[team % TEAM_NAMES.length]!;
}

/** A side's hull colour, for anything that names the side outside the picture. */
export function teamColour(team: number): string {
    return shipColours(team).hull;
}
