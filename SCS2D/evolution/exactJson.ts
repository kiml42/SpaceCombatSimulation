/**
 * Plain data written so that reading it back gives exactly what was written:
 * JSON keeps every finite double exactly, but writes an infinity or NaN as
 * null, and a run's settings hold infinities for "no limit"; and it writes
 * minus zero as zero. Those are written as `{ "$number": "Infinity" }` and the
 * like.
 */

const NUMBER = "$number";

/** `value` with every non-finite number marked, ready for `JSON.stringify`. */
export function encodeExact(value: unknown): unknown {
    if (typeof value === "number") {
        // JSON writes minus zero as 0.
        if (Object.is(value, -0)) return { [NUMBER]: "-0" };
        return Number.isFinite(value) ? value : { [NUMBER]: String(value) };
    }
    if (Array.isArray(value)) return value.map(encodeExact);
    if (value !== null && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) if (item !== undefined) out[key] = encodeExact(item);
        return out;
    }
    return value;
}

/** What `encodeExact` was given, once through JSON. */
export function decodeExact(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(decodeExact);
    if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record);
        if (keys.length === 1 && keys[0] === NUMBER) return Number(record[NUMBER]);
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(record)) out[key] = decodeExact(item);
        return out;
    }
    return value;
}
