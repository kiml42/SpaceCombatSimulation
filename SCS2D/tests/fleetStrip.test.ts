import { describe, expect, it } from 'vitest';
import { stripsFor, stripTileAt, type StripShip } from '../render/fleetStrip.js';

const W = 1000;
const H = 600;
const SETTINGS = { largest: 80, smallest: 30, margin: 6, gap: 4 };

function ship(body: number, team: number, radius = 20): StripShip {
  return { body, team, x: body * 100, y: 0, vx: 0, vy: 0, radius };
}

describe('the fleets down the edges', () => {
  it('puts even sides on the left and odd on the right, in the order given', () => {
    const strips = stripsFor([ship(1, 0), ship(2, 1), ship(3, 0), ship(4, 3)], W, H, SETTINGS);
    expect(strips.left.tiles.map((tile) => tile.body)).toEqual([1, 3]);
    expect(strips.right.tiles.map((tile) => tile.body)).toEqual([2, 4]);
    expect(strips.left.tiles[0]!.x).toBe(SETTINGS.margin);
    expect(strips.right.tiles[0]!.x + strips.right.tiles[0]!.size).toBe(W - SETTINGS.margin);
  });

  it('stacks a column down from the top, at its largest when few', () => {
    const [a, b] = stripsFor([ship(1, 0), ship(2, 0)], W, H, SETTINGS).left.tiles;
    expect(a!.size).toBe(SETTINGS.largest);
    expect(a!.y).toBe(SETTINGS.margin);
    expect(b!.y).toBe(SETTINGS.margin + SETTINGS.largest + SETTINGS.gap);
  });

  it('shrinks tiles to fit a column, and says how many more there are past the smallest', () => {
    const many = Array.from({ length: 40 }, (_, k) => ship(k, 0));
    const column = stripsFor(many, W, H, SETTINGS).left;
    expect(column.tiles[0]!.size).toBe(SETTINGS.smallest);
    expect(column.tiles.length + column.hidden).toBe(40);
    expect(column.more).not.toBeNull();
    // Everything, the count included, inside the view.
    expect(column.more!.y + column.more!.size).toBeLessThanOrEqual(H);
    const twelve = stripsFor(many.slice(0, 12), W, H, SETTINGS).left;
    expect(twelve.hidden).toBe(0);
    expect(twelve.tiles.at(-1)!.y + twelve.tiles.at(-1)!.size).toBeLessThanOrEqual(H - SETTINGS.margin + 0.001);
  });

  it('takes no width for a side with no ships', () => {
    const strips = stripsFor([ship(1, 0)], W, H, SETTINGS);
    expect(strips.right.width).toBe(0);
    expect(strips.left.width).toBe(SETTINGS.largest + SETTINGS.margin);
  });

  it('frames each ship in its own tile, zoomed to it', () => {
    const tile = stripsFor([ship(3, 0, 40)], W, H, SETTINGS).left.tiles[0]!;
    expect(tile.camera).toMatchObject({ x: 300, y: 0 });
    expect(2 * 40 * tile.camera.scale).toBeLessThan(tile.size);
  });

  it('finds the tile under a point', () => {
    const strips = stripsFor([ship(1, 0), ship(2, 1)], W, H, SETTINGS);
    expect(stripTileAt(strips, SETTINGS.margin + 5, SETTINGS.margin + 5)).toBe(1);
    expect(stripTileAt(strips, W - SETTINGS.margin - 5, SETTINGS.margin + 5)).toBe(2);
    expect(stripTileAt(strips, W / 2, H / 2)).toBe(-1);
  });
});
