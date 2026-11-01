import { degreesToRadians, radiansToDegrees } from "./math.js";
import { unreadOf, writeUnread, type UnreadKeys } from "./unread.js";

/**
 * How a fleet is painted: a base colour, a highlight and a pattern of the
 * highlight over the base. Only drawn; nothing in the simulation reads it.
 *
 * A fleet's livery is worn by every ship in it, whatever their own say; a
 * blueprint's is for a ship flying alone (ROADMAP.md §8 step 17).
 */
export interface Livery {
    /** `#rrggbb`. */
    base: string;
    /** `#rrggbb`. */
    highlight: string;
    pattern: LiveryPattern;
    /** How wide a stripe or spot is, as a share of the ship's radius. */
    size: number;
    /**
     * From one stripe or spot to the next, in its widths: at least one, where
     * spots touch and the base still shows between them; stripes that close
     * are drawn a little apart, so the base always shows.
     */
    spacing: number;
    /** How far the pattern is moved across the hull, as a share of its spacing. */
    offset: number;
    /** Which way stripes or chevrons run across the design. Radians here, degrees in the file. */
    angle: number;
    /** How far each arm of a chevron turns from straight, radians; none is a straight stripe. Degrees in the file. */
    chevron: number;
    /**
     * From one point of a zigzag to the next pointing the same way, in stripe
     * widths; none for a single chevron, its point at the design's middle.
     */
    points: number;
    /** Keys its file carried that nothing reads, kept to be written back (`UnreadKeys`). */
    unread?: UnreadKeys;
    /** Parts its file had that could not be read, each worn as its default instead (`toLivery`). Not written back. */
    problems?: readonly string[];
}

export const LIVERY_PATTERNS = ["none", "stripes", "spots", "chevrons"] as const;
export type LiveryPattern = (typeof LIVERY_PATTERNS)[number];

/** What a livery is read as where its file leaves a part out, or has one that cannot be read. */
const DEFAULTS = {
    base: "#5b8dd6",
    highlight: "#a8c8f0",
    pattern: "none",
    size: 0.1,
    spacing: 3,
    offset: 0,
    angle: 0,
    chevron: 45,
    points: 0,
} as const;

/** The most a chevron's arms turn from straight, degrees: further, and they lie along the stripes' run. */
export const MOST_CHEVRON = 75;

const COLOUR = /^#[0-9a-f]{6}$/i;

/** Why a part of a livery cannot be read as `key`, or null if it can. */
function partProblem(key: keyof typeof DEFAULTS, value: unknown): string | null {
    if (key === "base" || key === "highlight") {
        return typeof value === "string" && COLOUR.test(value) ? null : "must be a colour as #rrggbb";
    }
    if (key === "pattern") return LIVERY_PATTERNS.includes(value as LiveryPattern) ? null : `must be one of ${LIVERY_PATTERNS.join(", ")}`;
    if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number";
    if (key === "size" && value <= 0) return "must be above zero";
    // A stripe as wide as its period would paint the whole hull.
    if (key === "spacing" && value < 1) return "must be at least one stripe width";
    if (key === "chevron" && (value < 0 || value > MOST_CHEVRON)) return `must be from 0 to ${MOST_CHEVRON} degrees`;
    if (key === "points" && value < 0) return "must not be below zero";
    return null;
}

/**
 * A livery its file carried that is not even an object: kept to be written
 * back as it was, and said as a warning, while side colours are drawn instead.
 * A livery changes nothing but looks, so it is never a reason to refuse a file.
 */
export interface UnreadLivery {
    readonly value: unknown;
    readonly problem: string;
}

/** A file's livery, read as far as it can be, or kept as unread with why. */
export function readLivery(value: unknown): { livery: Livery } | { unreadLivery: UnreadLivery } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { unreadLivery: { value, problem: `livery must be an object, got ${JSON.stringify(value)}` } };
    }
    return { livery: toLivery(value) };
}

/** What a file holds for a livery: the one read, or else the one that could not be. */
export function writtenLivery(of: { readonly livery?: Livery; readonly unreadLivery?: UnreadLivery }): unknown {
    return of.livery !== undefined ? serialiseLivery(of.livery) : of.unreadLivery?.value;
}

/** A warning for each part of a livery its file had that could not be read, and for one that could not be read at all. */
export function liveryWarnings(of: { readonly livery?: Livery; readonly unreadLivery?: UnreadLivery }, out: string[]): void {
    for (const problem of of.livery?.problems ?? []) out.push(problem);
    if (of.unreadLivery !== undefined) {
        out.push(`${of.unreadLivery.problem}: kept as written, and drawn in side colours until another is set`);
    }
}

const LIVERY_KEYS: readonly string[] = ["base", "highlight", "pattern", "size", "spacing", "offset", "angle", "chevron", "points"];

/**
 * A livery from a file, each part read on its own: one left out is its
 * default, and one that cannot be read is too, with a warning
 * (`Livery.problems`), so the rest of it is still worn.
 */
export function toLivery(value: unknown): Livery {
    const raw = value as Record<string, unknown>;
    const problems: string[] = [];
    const part = <K extends keyof typeof DEFAULTS>(key: K): unknown => {
        const given = raw[key];
        if (given === undefined) return DEFAULTS[key];
        const problem = partProblem(key, given);
        if (problem === null) return given;
        problems.push(`livery: ${key} ${problem}, got ${JSON.stringify(given)}; ${JSON.stringify(DEFAULTS[key])} is worn instead`);
        return DEFAULTS[key];
    };
    const livery: Livery = {
        base: (part("base") as string).toLowerCase(),
        highlight: (part("highlight") as string).toLowerCase(),
        pattern: part("pattern") as LiveryPattern,
        size: part("size") as number,
        spacing: part("spacing") as number,
        offset: part("offset") as number,
        angle: degreesToRadians(part("angle") as number),
        chevron: degreesToRadians(part("chevron") as number),
        points: part("points") as number,
    };
    const unread = unreadOf(raw, LIVERY_KEYS);
    if (unread !== undefined) livery.unread = unread;
    if (problems.length > 0) livery.problems = problems;
    return livery;
}

/** What `toLivery` reads. */
export function serialiseLivery(livery: Livery): Record<string, unknown> {
    const raw: Record<string, unknown> = {
        base: livery.base,
        highlight: livery.highlight,
        pattern: livery.pattern,
        size: livery.size,
        spacing: livery.spacing,
        offset: livery.offset,
        angle: radiansToDegrees(livery.angle),
        chevron: radiansToDegrees(livery.chevron),
        points: livery.points,
    };
    writeUnread(raw, livery.unread);
    return raw;
}
