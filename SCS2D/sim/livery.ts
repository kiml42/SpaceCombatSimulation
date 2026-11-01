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
    /** From one stripe or spot to the next, as a share of the ship's radius. */
    spacing: number;
    /** How far the pattern is moved across the hull, as a share of its spacing. */
    offset: number;
    /** Which way stripes run across the design. Radians here, degrees in the file. */
    angle: number;
    /** Keys its file carried that nothing reads, kept to be written back (`UnreadKeys`). */
    unread?: UnreadKeys;
}

export const LIVERY_PATTERNS = ["none", "stripes", "spots"] as const;
export type LiveryPattern = (typeof LIVERY_PATTERNS)[number];

/** What a file may leave out of a livery. */
const PATTERN_DEFAULTS = { pattern: "none", size: 0.1, spacing: 0.3, offset: 0, angle: 0 } as const;

const COLOUR = /^#[0-9a-f]{6}$/i;

/** Why `value` is not a livery as a file holds it, or null if it is one. */
export function liveryProblem(value: unknown, where: string): string | null {
    if (value === undefined) return null;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return `${where} must be an object, got ${JSON.stringify(value)}`;
    }
    const raw = value as Record<string, unknown>;
    for (const key of ["base", "highlight"]) {
        const colour = raw[key];
        if (typeof colour !== "string" || !COLOUR.test(colour)) {
            return `${where}: ${key} must be a colour as #rrggbb, got ${JSON.stringify(colour)}`;
        }
    }
    const pattern = raw["pattern"];
    if (pattern !== undefined && !LIVERY_PATTERNS.includes(pattern as LiveryPattern)) {
        return `${where}: pattern must be one of ${LIVERY_PATTERNS.join(", ")}, got ${JSON.stringify(pattern)}`;
    }
    for (const key of ["size", "spacing", "offset", "angle"]) {
        const n = raw[key];
        if (n !== undefined && (typeof n !== "number" || !Number.isFinite(n))) {
            return `${where}: ${key} must be a number, got ${JSON.stringify(n)}`;
        }
    }
    for (const key of ["size", "spacing"]) {
        const n = raw[key] as number | undefined;
        if (n !== undefined && n <= 0) return `${where}: ${key} must be above zero, got ${n}`;
    }
    return null;
}

const LIVERY_KEYS: readonly string[] = ["base", "highlight", "pattern", "size", "spacing", "offset", "angle"];

/** A livery from a file whose shape `liveryProblem` has passed. */
export function toLivery(value: unknown): Livery {
    const raw = value as Record<string, unknown>;
    const number = (key: "size" | "spacing" | "offset"): number => (raw[key] as number | undefined) ?? PATTERN_DEFAULTS[key];
    const livery: Livery = {
        base: (raw["base"] as string).toLowerCase(),
        highlight: (raw["highlight"] as string).toLowerCase(),
        pattern: (raw["pattern"] as LiveryPattern | undefined) ?? PATTERN_DEFAULTS.pattern,
        size: number("size"),
        spacing: number("spacing"),
        offset: number("offset"),
        angle: raw["angle"] === undefined ? PATTERN_DEFAULTS.angle : degreesToRadians(raw["angle"] as number),
    };
    const unread = unreadOf(raw, LIVERY_KEYS);
    if (unread !== undefined) livery.unread = unread;
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
    };
    writeUnread(raw, livery.unread);
    return raw;
}
