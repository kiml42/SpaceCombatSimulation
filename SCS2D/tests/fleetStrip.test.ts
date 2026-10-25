import { describe, expect, it } from 'vitest';
import { stripsFor, stripTileAt, type StripShip } from '../render/fleetStrip.js';
import { Snapshot, type ShipView } from '../sim/index.js';
import { fleetStrips } from '../render/canvas2d.js';
import { fighterGroup } from '../render/picking.js';
import { capture } from '../sim/snapshot.js';
import { beamCarrier } from '../scenarios/beamCarrier.js';

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

  it("shows a side's fighters of a design in one tile, the best armed of them, with how many there are", () => {
    const fighter = (body: number, team: number, weapons: number, design = 0): StripShip => ({
      ...ship(body, team, 5),
      fighter: design,
      weapons,
    });
    const strips = stripsFor(
      [fighter(5, 0, 1), ship(1, 0), fighter(6, 0, 2), fighter(7, 0, 2), fighter(8, 0, 1, 1), fighter(9, 2, 3), fighter(10, 1, 0)],
      W,
      H,
      SETTINGS,
    );
    // Other ships first, then one tile a design and side; of equals, the lowest body.
    expect(strips.left.tiles.map((tile) => [tile.body, tile.count])).toEqual([
      [1, 1],
      [6, 3],
      [8, 1],
      [9, 1],
    ]);
    expect(strips.right.tiles.map((tile) => [tile.body, tile.count])).toEqual([[10, 1]]);
  });

  it('counts the fighters in a tile that did not fit among those left out', () => {
    const many = Array.from({ length: 40 }, (_, k) => ship(k, 0));
    const fighters = Array.from({ length: 5 }, (_, k): StripShip => ({ ...ship(100 + k, 0, 5), fighter: 0, weapons: 1 }));
    const column = stripsFor([...many, ...fighters], W, H, SETTINGS).left;
    expect(column.tiles.length + column.hidden).toBe(45);
  });
});

describe('the fleet strips of a battle', () => {
  it('give a side one tile for its fighters of a design, however damaged each is', () => {
    const tie = {
      radius: 5,
      name: 'TIE',
      fighter: true,
      modules: [],
      turrets: [],
      engines: [],
      weaponEngines: [],
      mainWeaponEngines: [],
    } as unknown as ShipView['currentStructure'];
    const knocked = { ...tie } as ShipView['currentStructure'];
    const fighter = (body: number, design: ShipView['currentStructure']): ShipView =>
      ({
        currentStructure: design,
        blueprint: tie,
        body,
        ship: body,
        team: 0,
        serial: body,
        x: body * 20,
        y: 0,
        angle: 0,
        vx: 0,
        vy: 0,
        hasControl: true,
        integrity: [],
        turretBearings: [],
        turretReady: [],
      }) as unknown as ShipView;
    const picture = new Snapshot();
    picture.ships = [fighter(0, tie), fighter(1, knocked), fighter(2, knocked)];
    picture.shipCount = 3;
    const strips = fleetStrips(picture, 1000, 600);
    expect(strips.left.tiles.map((tile) => tile.count)).toEqual([3]);
  });

  it("puts a carrier's fighters from every pad on one tile, though each pad compiled its own copy of the design", () => {
    const run = beamCarrier();
    run.step();
    const picture = capture(new Snapshot(), run.world, run.ships, run.projectiles, run.beams);
    const strips = fleetStrips(picture, 1000, 2000);
    const tiles = [...strips.left.tiles, ...strips.right.tiles];
    const dinkies = picture.ships.slice(0, picture.shipCount).filter((v) => v.blueprint?.name === 'Dinky Beam' && v.hasControl);
    expect(dinkies.length).toBeGreaterThan(1);
    const bodies = new Set(dinkies.map((v) => v.body));
    expect(tiles.filter((tile) => bodies.has(tile.body))).toHaveLength(1);
    expect(tiles.find((tile) => bodies.has(tile.body))!.count).toBe(dinkies.length);
    // Picking that tile stands for all of them.
    expect(fighterGroup(picture, dinkies[0]!).length).toBe(dinkies.length);
  });
});
