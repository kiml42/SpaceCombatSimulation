import type { Livery } from "../sim/index.js";

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
const TEAM_COLOURS: readonly Palette[] = [
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

export interface Palette {
    readonly hull: string;
    readonly trim: string;
    readonly pivot: string;
    /**
     * A livery's second colour: its pattern, and the parts picked out in it
     * (engine bands, turret domes, pads' and ports' markings). Side colours
     * have none, and those parts keep their usual tones.
     */
    readonly highlight?: string;
    /**
     * The pattern's colour on each tone: the highlight tinted as the hull,
     * trim and pivot are from the base, so a pattern on a lighter part is
     * lighter too. Side colours have none.
     */
    readonly highlights?: { readonly hull: string; readonly trim: string; readonly pivot: string };
}

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
    const out = {
        hull: towards(palette.hull, palette.pivot, FIGHTER_SHADE),
        trim: towards(palette.trim, palette.pivot, FIGHTER_SHADE),
        pivot: towards(palette.pivot, "#000000", 1 - FIGHTER_PIVOT),
    };
    const h = palette.highlights;
    if (palette.highlight === undefined || h === undefined) return out;
    return {
        ...out,
        highlight: towards(palette.highlight, palette.pivot, FIGHTER_SHADE),
        highlights: {
            hull: towards(h.hull, h.pivot, FIGHTER_SHADE),
            trim: towards(h.trim, h.pivot, FIGHTER_SHADE),
            pivot: towards(h.pivot, "#000000", 1 - FIGHTER_PIVOT),
        },
    };
}

const FIGHTER_COLOURS = TEAM_COLOURS.map(shaded);
const NEUTRAL_FIGHTER = shaded(NEUTRAL);

const TEAM_NAMES = ["Blue", "Red", "Green", "Magenta"];

/** What a side is drawn in, and what it is called by its colour. */
export interface Side {
    readonly ship: Palette;
    readonly fighter: Palette;
    readonly name: string;
    /** What it was resolved from, where it wears one: its pattern. */
    readonly livery?: Livery;
}

/**
 * Each team's colours, by team: what a battle's liveries resolve to
 * (`sidesOf`). Past its end, and with none given, the stock sides come round.
 */
export type Sides = readonly Side[];

/** The side colours, worn where no livery is. */
export const STOCK: Sides = TEAM_COLOURS.map((ship, k) => ({ ship, fighter: FIGHTER_COLOURS[k]!, name: TEAM_NAMES[k]! }));

/** The sides drawn in, set round a drawing by `withSides`. */
let shown: Sides = STOCK;

/**
 * Draw with `sides` as the teams' colours, the stock ones again once done, so
 * nothing drawn afterwards wears a battle's liveries by accident.
 */
export function withSides<T>(sides: Sides, draw: () => T): T {
    const before = shown;
    shown = sides;
    try {
        return draw();
    } finally {
        shown = before;
    }
}

function sideOf(team: number, sides: Sides): Side {
    return sides[team] ?? STOCK[team % STOCK.length]!;
}

export function shipColours(team: number): Palette {
    // Below zero is nobody's side (`NEUTRAL_TEAM`, the editor's `NO_TEAM`).
    return team < 0 ? NEUTRAL : sideOf(team, shown).ship;
}

/** A side's colours for a fighter: its ships', a shade darker. */
export function fighterColours(team: number): Palette {
    return team < 0 ? NEUTRAL_FIGHTER : sideOf(team, shown).fighter;
}

/** A side's livery, where it wears one, for its pattern. */
export function teamLivery(team: number): Livery | undefined {
    return team < 0 ? undefined : sideOf(team, shown).livery;
}

/** A side's name, which is its colour's; empty for nobody's side. */
export function teamName(team: number, sides: Sides = shown): string {
    return team < 0 ? "" : sideOf(team, sides).name;
}

/** A side's hull colour, for anything that names the side outside the picture. */
export function teamColour(team: number, sides: Sides = shown): string {
    return team < 0 ? NEUTRAL.hull : sideOf(team, sides).ship.hull;
}

/** How far a livery's trim is drawn towards white, and its pivot towards black, from its base: as the stock sides' are. */
const TRIM_LIGHTER = 0.45;
const PIVOT_DARKER = 0.5;

/** A side's palette from its livery's base colour. */
export function liveryPalette(livery: Livery): Palette {
    return {
        hull: livery.base,
        trim: towards(livery.base, "#ffffff", TRIM_LIGHTER),
        pivot: towards(livery.base, "#000000", PIVOT_DARKER),
        highlight: livery.highlight,
        highlights: {
            hull: livery.highlight,
            trim: towards(livery.highlight, "#ffffff", TRIM_LIGHTER),
            pivot: towards(livery.highlight, "#000000", PIVOT_DARKER),
        },
    };
}

/**
 * How far apart two colours look, in CIELAB (ΔE*76). Under about 2 the eye
 * cannot tell them apart; the stock sides are over 50 from each other.
 */
export function colourDistance(a: string, b: string): number {
    const [l1, a1, b1] = lab(a);
    const [l2, a2, b2] = lab(b);
    return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

/** Two sides' hulls closer than this are too alike to tell apart at a glance. */
export const TOO_ALIKE = 30;

/**
 * Each team's colours from its livery, in team order. An earlier side keeps
 * its own, so the player, listed first, never gives way; a later side too
 * like one before it wears its stock colours, or the first stock colours
 * unlike all of them, as does a side with no livery.
 */
export function sidesOf(liveries: readonly (Livery | undefined)[] | undefined): Sides {
    if (liveries === undefined) return STOCK;
    const out: Side[] = [];
    const unlike = (hull: string): boolean => out.every((side) => colourDistance(side.ship.hull, hull) >= TOO_ALIKE);
    liveries.forEach((livery, team) => {
        if (livery !== undefined && unlike(livery.base)) {
            const ship = liveryPalette(livery);
            out.push({ ship, fighter: shaded(ship), name: colourName(livery.base), livery });
            return;
        }
        const n = STOCK.length;
        let pick = sideOf(team, STOCK);
        for (let k = 0; k < n; k++) {
            const stock = STOCK[(team + k) % n]!;
            if (unlike(stock.ship.hull)) {
                pick = stock;
                break;
            }
        }
        out.push(pick);
    });
    return out;
}

/** Colours a side may be called by, the nearest naming it. */
const NAMED: readonly (readonly [string, string])[] = [
    ["Blue", "#5b8dd6"],
    ["Red", "#d65b5b"],
    ["Green", "#5bd66f"],
    ["Magenta", "#d65bd6"],
    ["Navy", "#1f2f6b"],
    ["Cyan", "#4fd0e0"],
    ["Teal", "#2a8a85"],
    ["Olive", "#7a7a2a"],
    ["Yellow", "#e6d24a"],
    ["Orange", "#e68a3a"],
    ["Brown", "#7a4a2a"],
    ["Maroon", "#6b1f2a"],
    ["Pink", "#f0a0c0"],
    ["Purple", "#7a4ac8"],
    ["White", "#f2f2f2"],
    ["Grey", "#8a8a8a"],
    ["Black", "#1a1a1a"],
];

/** The name of the named colour nearest `hex`. */
export function colourName(hex: string): string {
    let best = NAMED[0]!;
    for (const named of NAMED) if (colourDistance(hex, named[1]) < colourDistance(hex, best[1])) best = named;
    return best[0];
}

/** sRGB `#rrggbb` to CIELAB under D65. */
function lab(hex: string): [number, number, number] {
    const linear = (k: number): number => {
        const c = channel(hex, k) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const r = linear(1);
    const g = linear(3);
    const b = linear(5);
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
