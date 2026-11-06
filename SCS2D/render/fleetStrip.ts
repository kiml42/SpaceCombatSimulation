import type { Camera } from "./camera.js";
import type { InsetRect } from "./inset.js";

/**
 * The fleets down the sides of a battle view: a live tile for every ship, each
 * drawn by a camera of its own, the even sides on the left and the odd on the
 * right. A column with more ships than `MOST_TILES` shares a tile among a
 * side's ships of one design, one of them shown with a count of all. DOM-free
 * arithmetic, so it is unit-tested; `canvas2d.ts` draws it.
 */

/** What laying out a tile needs of the ship it shows. */
export interface StripShip {
    readonly body: number;
    readonly team: number;
    readonly x: number;
    readonly y: number;
    readonly vx: number;
    readonly vy: number;
    /** Hull radius, m. */
    readonly radius: number;
    /** Its design, the same for every ship of that design; absent for one never grouped. */
    readonly design?: number;
    /** Weapons it can still fight with, so a shared tile shows the one least likely to be lost. */
    readonly weapons?: number;
}

export interface StripTile extends InsetRect {
    readonly body: number;
    readonly team: number;
    readonly camera: Camera;
    /** How many ships the tile stands for. */
    readonly count: number;
    /** The bodies of every ship it stands for, `body` among them. */
    readonly bodies: readonly number[];
}

export interface StripSettings {
    /** Largest and smallest a tile may be, canvas pixels. */
    readonly largest: number;
    readonly smallest: number;
    /** Gap kept from the view's edge, canvas pixels. */
    readonly margin: number;
    /** Gap between tiles, canvas pixels. */
    readonly gap: number;
}

/** One side of the view's tiles, and how many ships did not fit, in a box under the last tile. */
export interface StripColumn {
    readonly tiles: StripTile[];
    readonly hidden: number;
    /** Where the count of ships that did not fit goes; null when they all did. */
    readonly more: InsetRect | null;
    /** How much of the view's width the column takes from its edge, canvas pixels; nothing if it is empty. */
    readonly width: number;
}

export interface Strips {
    readonly left: StripColumn;
    readonly right: StripColumn;
}

/** How much of a tile's half-width the ship's radius fills. */
const FILL = 0.8;

/** Tiles a column shows before it starts sharing them among ships of one design. */
export const MOST_TILES = 5;

interface Entry {
    ship: StripShip;
    bodies: number[];
}

/**
 * One entry a tile, in the order given, a shared tile where the first of its
 * ships was. Past `MOST_TILES`, a side's most numerous design shares one, then
 * the next, until the column is down to `MOST_TILES` or every tile is a design
 * of its own. A shared tile shows the ship with most weapons left (the lowest
 * body of equals, so it holds steady).
 */
function grouped(ships: readonly StripShip[]): Entry[] {
    const designs = new Map<string, StripShip[]>();
    for (const ship of ships) {
        if (ship.design === undefined) continue;
        const key = `${ship.team}:${ship.design}`;
        const same = designs.get(key);
        if (same === undefined) designs.set(key, [ship]);
        else same.push(ship);
    }
    // A stable sort, so of equal numbers the design met first goes first.
    const commonest = [...designs].filter(([, same]) => same.length > 1).sort(([, a], [, b]) => b.length - a.length);
    const shared = new Set<string>();
    let tiles = ships.length;
    for (const [key, same] of commonest) {
        if (tiles <= MOST_TILES) break;
        shared.add(key);
        tiles -= same.length - 1;
    }
    const out: Entry[] = [];
    const placed = new Map<string, Entry>();
    for (const ship of ships) {
        const key = ship.design === undefined ? "" : `${ship.team}:${ship.design}`;
        if (!shared.has(key)) {
            out.push({ ship, bodies: [ship.body] });
            continue;
        }
        const entry = placed.get(key);
        if (entry === undefined) {
            const first = { ship, bodies: [ship.body] };
            placed.set(key, first);
            out.push(first);
            continue;
        }
        entry.bodies.push(ship.body);
        const [mine, theirs] = [ship.weapons ?? 0, entry.ship.weapons ?? 0];
        if (mine > theirs || (mine === theirs && ship.body < entry.ship.body)) entry.ship = ship;
    }
    return out;
}

/** One column of tiles down one edge, `fromLeft` the left edge. */
function column(entries: readonly StripShip[], widthPx: number, heightPx: number, settings: StripSettings, fromLeft: boolean): StripColumn {
    const { largest, smallest, margin, gap } = settings;
    const ships = grouped(entries);
    if (ships.length === 0) return { tiles: [], hidden: 0, more: null, width: 0 };
    const room = heightPx - 2 * margin;
    const size = Math.max(smallest, Math.min(largest, (room - (ships.length - 1) * gap) / ships.length));
    const fit = Math.max(1, Math.floor((room + gap) / (size + gap)));
    // One slot kept for saying how many more there are, when they do not all fit.
    const shown = ships.length <= fit ? ships.length : Math.max(0, fit - 1);
    const x = fromLeft ? margin : widthPx - margin - size;
    const tiles = ships.slice(0, shown).map(({ ship, bodies }, k): StripTile => {
        const half = size / 2;
        return {
            body: ship.body,
            count: bodies.length,
            bodies,
            team: ship.team,
            x,
            y: margin + k * (size + gap),
            size,
            camera: { x: ship.x, y: ship.y, scale: (half * FILL) / Math.max(ship.radius, 0.1), vx: ship.vx, vy: ship.vy },
        };
    });
    const hidden = ships.slice(shown).reduce((sum, entry) => sum + entry.bodies.length, 0);
    return {
        tiles,
        hidden,
        more: shown < ships.length ? { x, y: margin + shown * (size + gap), size } : null,
        width: size + margin,
    };
}

/** The two columns: even sides on the left, odd on the right, each in the order given. */
export function stripsFor(ships: readonly StripShip[], widthPx: number, heightPx: number, settings: StripSettings): Strips {
    return {
        left: column(
            ships.filter((ship) => ship.team % 2 === 0),
            widthPx,
            heightPx,
            settings,
            true,
        ),
        right: column(
            ships.filter((ship) => ship.team % 2 === 1),
            widthPx,
            heightPx,
            settings,
            false,
        ),
    };
}

/** The body whose tile holds a canvas point, or -1. */
export function stripTileAt(strips: Strips, x: number, y: number): number {
    return stripTileUnder(strips, x, y)?.body ?? -1;
}

/** The tile under canvas pixel (x, y), or null. */
export function stripTileUnder(strips: Strips, x: number, y: number): StripTile | null {
    for (const tile of [...strips.left.tiles, ...strips.right.tiles]) {
        if (x >= tile.x && x <= tile.x + tile.size && y >= tile.y && y <= tile.y + tile.size) return tile;
    }
    return null;
}
