import type { Camera } from './camera.js';
import type { InsetRect } from './inset.js';

/**
 * The fleets down the sides of a battle view: a live tile for every ship, each
 * drawn by a camera of its own, the even sides on the left and the odd on the
 * right. A side's fighters of one design share a tile, one of them shown with
 * a count of all. DOM-free arithmetic, so it is unit-tested; `canvas2d.ts`
 * draws it.
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
  /** For a fighter, its design, the same for every fighter of that design; absent for any other ship. */
  readonly fighter?: number;
  /** Weapons it can still fight with, so a fighter's tile shows the one least likely to be lost. */
  readonly weapons?: number;
}

export interface StripTile extends InsetRect {
  readonly body: number;
  readonly team: number;
  readonly camera: Camera;
  /** How many fighters the tile stands for; 1 for any other ship. */
  readonly count: number;
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

/** One column of tiles down one edge, `fromLeft` the left edge. */
/**
 * One entry a tile: every ship but fighters as given, then a ship for each
 * side's design of fighter, the one with most weapons left (the lowest body of
 * equals, so it holds steady), with how many there are.
 */
function grouped(ships: readonly StripShip[]): { ship: StripShip; count: number }[] {
  const out: { ship: StripShip; count: number }[] = [];
  const fighters = new Map<string, { ship: StripShip; count: number }>();
  for (const ship of ships) {
    if (ship.fighter === undefined) {
      out.push({ ship, count: 1 });
      continue;
    }
    const key = `${ship.team}:${ship.fighter}`;
    const group = fighters.get(key);
    if (group === undefined) {
      fighters.set(key, { ship, count: 1 });
      continue;
    }
    group.count++;
    const best = group.ship;
    const [mine, theirs] = [ship.weapons ?? 0, best.weapons ?? 0];
    if (mine > theirs || (mine === theirs && ship.body < best.body)) group.ship = ship;
  }
  return [...out, ...fighters.values()];
}

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
  const tiles = ships.slice(0, shown).map(({ ship, count }, k): StripTile => {
    const half = size / 2;
    return {
      body: ship.body,
      count,
      team: ship.team,
      x,
      y: margin + k * (size + gap),
      size,
      camera: { x: ship.x, y: ship.y, scale: (half * FILL) / Math.max(ship.radius, 0.1), vx: ship.vx, vy: ship.vy },
    };
  });
  const hidden = ships.slice(shown).reduce((sum, entry) => sum + entry.count, 0);
  return {
    tiles,
    hidden,
    more: shown < ships.length ? { x, y: margin + shown * (size + gap), size } : null,
    width: size + margin,
  };
}

/** The two columns: even sides on the left, odd on the right, each in the order given, its fighters last. */
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
