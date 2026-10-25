import { expandFleet, math, parseFleet, serialiseFleet, type Fleet } from "../sim/index.js";

/**
 * Every match of a skirmish, in order: each round the player fought, the best
 * of each generation the enemy bred to answer one, and each answer it took.
 * Both fleets of a match are kept, by content, so any match can be fought
 * again and either side saved; a fleet the player keeps reusing is kept once.
 */

export type MatchKind = "try" | "search" | "answer";

export interface MatchRow {
    readonly kind: MatchKind;
    readonly round: number;
    readonly seed: number;
    /** The side that won: 0 the player, 1 the enemy, -1 a draw, which the player loses. */
    readonly winner: number;
    /** The fleets, as ids into `History.fleets`, or null once dropped for room. */
    readonly player: string | null;
    readonly enemy: string | null;
    readonly playerVersion: number;
    readonly enemyVersion: number;
    /** The enemy's generation, for a search's best. */
    readonly generation?: number;
    /** What a dropped fleet still says of itself. */
    readonly playerName: string;
    readonly enemyName: string;
    readonly playerShips: number;
    readonly enemyShips: number;
    /** What the player told their fleet, as a log file holds it, for a round fought with orders. */
    readonly orders?: WrittenLog;
}

/** A log of orders as a file or a link writes it (`writeLog`). */
export interface WrittenLog {
    readonly orders: unknown[];
    readonly designs?: unknown[];
}

export interface History {
    /** Fleets as fleet files, by id. */
    readonly fleets: Readonly<Record<string, unknown>>;
    readonly rows: readonly MatchRow[];
    readonly playerVersion: number;
    readonly enemyVersion: number;
    readonly lastPlayer: string | null;
}

export const EMPTY_HISTORY: History = { fleets: {}, rows: [], playerVersion: 0, enemyVersion: 1, lastPlayer: null };

/** Where a page keeps the skirmish's history, beside the skirmish itself. */
export const HISTORY_STORAGE_KEY = "scs2d.skirmish.history";

/** A fleet's id: a hash of its file, so the same fleet is the same id. */
export function fleetId(file: unknown): string {
    const text = JSON.stringify(file);
    // FNV-1a, 32 bits, twice over with different offsets, for 64 bits of name.
    let a = 0x811c9dc5;
    let b = 0x01000193 ^ 0x9e3779b9;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        a = math.imul(a ^ c, 0x01000193) >>> 0;
        b = math.imul(b ^ c, 0x01000193 ^ 0x5bd1e995) >>> 0;
    }
    return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

export interface Played {
    readonly kind: MatchKind;
    readonly round: number;
    readonly seed: number;
    readonly winner: number;
    readonly player: Fleet;
    readonly enemy: Fleet;
    readonly generation?: number;
    readonly orders?: WrittenLog;
}

/**
 * The history with this match added. The player's version goes up when the
 * fleet they fight with changes; the enemy's when an answer is taken, and a
 * search's best is the version it is breeding towards.
 */
export function record(history: History, match: Played): History {
    const playerFile = serialiseFleet(match.player);
    const enemyFile = serialiseFleet(match.enemy);
    const player = fleetId(playerFile);
    const enemy = fleetId(enemyFile);
    const playerVersion = player === history.lastPlayer ? history.playerVersion : history.playerVersion + 1;
    const breeding = match.kind !== "try";
    const row: MatchRow = {
        kind: match.kind,
        round: match.round,
        seed: match.seed,
        winner: match.winner,
        player,
        enemy,
        playerVersion,
        enemyVersion: breeding ? history.enemyVersion + 1 : history.enemyVersion,
        ...(match.generation === undefined ? {} : { generation: match.generation }),
        playerName: match.player.name,
        enemyName: match.enemy.name,
        playerShips: expandFleet(match.player).length,
        enemyShips: expandFleet(match.enemy).length,
        ...(match.orders === undefined ? {} : { orders: match.orders }),
    };
    return {
        fleets: { ...history.fleets, [player]: playerFile, [enemy]: enemyFile },
        rows: [...history.rows, row],
        playerVersion,
        enemyVersion: match.kind === "answer" ? history.enemyVersion + 1 : history.enemyVersion,
        lastPlayer: player,
    };
}

/** The side that lost a match: a draw is the player's loss. */
export function loserOf(row: MatchRow): number {
    return row.winner === 0 ? 1 : 0;
}

/** A run of matches lost by the same side, by index into the rows, `end` exclusive. */
export interface Chain {
    readonly loser: number;
    readonly start: number;
    readonly end: number;
}

/** The rows as chains, oldest first. The last is the one still being fought. */
export function chains(rows: readonly MatchRow[]): Chain[] {
    const out: Chain[] = [];
    let start = 0;
    for (let i = 1; i <= rows.length; i++) {
        if (i === rows.length || loserOf(rows[i]!) !== loserOf(rows[start]!)) {
            out.push({ loser: loserOf(rows[start]!), start, end: i });
            start = i;
        }
    }
    return out;
}

/** A row's fleet, or null if it has been dropped for room. */
export function fleetOf(history: History, id: string | null): Fleet | null {
    if (id === null) return null;
    const file = history.fleets[id];
    if (file === undefined) return null;
    try {
        return parseFleet(file);
    } catch {
        return null;
    }
}

/**
 * Room made by letting go of the fleets of the oldest chain that still holds
 * any, never the last chain's: its rows keep their names and results, and
 * lose being fought again or saved. Null when there is nothing left to drop.
 */
export function dropOldest(history: History): History | null {
    const all = chains(history.rows);
    const target = all
        .slice(0, -1)
        .find((chain) => history.rows.slice(chain.start, chain.end).some((row) => row.player !== null || row.enemy !== null));
    if (target === undefined) return null;
    const rows = history.rows.map((row, i) => (i >= target.start && i < target.end ? { ...row, player: null, enemy: null } : row));
    const used = new Set<string>();
    for (const row of rows) {
        if (row.player !== null) used.add(row.player);
        if (row.enemy !== null) used.add(row.enemy);
    }
    // Ids still in use elsewhere keep their fleets.
    const fleets: Record<string, unknown> = {};
    for (const [id, file] of Object.entries(history.fleets)) if (used.has(id)) fleets[id] = file;
    return { ...history, rows, fleets };
}

/** Read a history back, or an empty one if it cannot be read. */
export function parseHistory(value: unknown): History {
    if (typeof value !== "object" || value === null) return EMPTY_HISTORY;
    const raw = value as Record<string, unknown>;
    if (!Array.isArray(raw["rows"]) || typeof raw["fleets"] !== "object" || raw["fleets"] === null) return EMPTY_HISTORY;
    return {
        fleets: raw["fleets"] as Record<string, unknown>,
        rows: raw["rows"] as MatchRow[],
        playerVersion: typeof raw["playerVersion"] === "number" ? raw["playerVersion"] : 0,
        enemyVersion: typeof raw["enemyVersion"] === "number" ? raw["enemyVersion"] : 1,
        lastPlayer: typeof raw["lastPlayer"] === "string" ? raw["lastPlayer"] : null,
    };
}
