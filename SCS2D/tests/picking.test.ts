import { describe, expect, it } from 'vitest';
import { NEUTRAL_TEAM, Snapshot, type ShipView } from '../sim/index.js';
import { boxed, clicked, fighterGroup, sameDesign, shipViewAt, sideOf, stillThere, wholeSide } from '../render/picking.js';

function ship(index: number, team: number, x: number, y = 0, design = 'Corvette'): ShipView {
  return {
    currentStructure: { radius: 20, name: design } as ShipView['currentStructure'],
    body: 100 + index,
    ship: index,
    team,
    serial: index + 1,
    x,
    y,
    angle: 0,
    vx: 0,
    vy: 0,
    hasControl: true,
  } as ShipView;
}

function snapshotOf(ships: ShipView[]): Snapshot {
  const snapshot = new Snapshot();
  snapshot.ships = ships;
  snapshot.shipCount = ships.length;
  return snapshot;
}

// Side 0 at the left, side 1 at the right, a neutral in the middle.
const ships = [
  ship(0, 0, -300),
  ship(1, 0, -200, 0, 'Gunship'),
  ship(2, 0, -100),
  ship(3, 1, 100),
  ship(4, 1, 200),
  ship(5, NEUTRAL_TEAM, 0),
];
const picture = snapshotOf(ships);

describe('picking ships out', () => {
  it('finds the ship under a point', () => {
    expect(shipViewAt(picture, 101, 5, 1)?.ship).toBe(3);
    expect(shipViewAt(picture, 150, 0, 1)).toBeNull();
  });

  it('picks one with a click, and with Shift adds or takes away, keeping to one side', () => {
    let picked = clicked(picture, [], ships[0]!, false);
    expect(picked).toEqual([0]);
    picked = clicked(picture, picked, ships[2]!, true);
    expect(picked).toEqual([0, 2]);
    // Another side, or a neutral, is not added.
    expect(clicked(picture, picked, ships[3]!, true)).toEqual([0, 2]);
    expect(clicked(picture, picked, ships[5]!, true)).toEqual([0, 2]);
    expect(clicked(picture, picked, ships[0]!, true)).toEqual([2]);
    // A plain click on another side starts again there; on nothing, lets go.
    expect(clicked(picture, picked, ships[3]!, false)).toEqual([3]);
    expect(clicked(picture, picked, null, false)).toEqual([]);
  });

  it('lets a neutral be looked at alone, but never be given orders', () => {
    const picked = clicked(picture, [], ships[5]!, false);
    expect(picked).toEqual([5]);
    expect(sideOf(picture, picked)).toBeNull();
  });

  it('boxes the side with most ships in it, or the side already picked', () => {
    // Two of side 0 and one of side 1.
    expect(boxed(picture, [], -250, -50, 150, 50)).toEqual([1, 2]);
    // The same box, side 1 already picked, adds only side 1.
    expect(boxed(picture, [4], -250, -50, 150, 50)).toEqual([4, 3]);
  });

  it('breaks a tie in a box by the side of the ship nearest where it started', () => {
    // Two of each side between -250 and 250.
    expect(boxed(picture, [], 250, -50, -250, 50)).toEqual([3, 4]);
    expect(boxed(picture, [], -250, -50, 250, 50)).toEqual([1, 2]);
  });

  it('takes every ship of a design on its side, or the whole side', () => {
    expect(sameDesign(picture, ships[0]!)).toEqual([0, 2]);
    expect(wholeSide(picture, 1)).toEqual([3, 4]);
  });

  it('lets go of ships no longer there', () => {
    expect(stillThere(snapshotOf(ships.slice(1)), [0, 1])).toEqual([1]);
  });
});

describe('a fleet strip tile of fighters', () => {
  const fighter = { radius: 5, name: 'TIE', fighter: true } as unknown as ShipView['currentStructure'];
  const other = { radius: 5, name: 'TIE', fighter: true } as unknown as ShipView['currentStructure'];
  const craft = (index: number, team: number, design: ShipView['currentStructure'], hasControl = true): ShipView =>
    ({ ...ship(index, team, index * 10), currentStructure: design, hasControl }) as ShipView;
  const swarm = [
    craft(0, 0, fighter),
    craft(1, 0, fighter),
    craft(2, 0, fighter, false),
    craft(3, 0, other),
    craft(4, 1, fighter),
    ship(5, 0, 300),
  ];
  const picture = snapshotOf(swarm);

  it('picks every fighter of its design on its side still under control, as the tile counts them', () => {
    expect(fighterGroup(picture, swarm[1]!)).toEqual([0, 1]);
  });

  it('groups fighters by the design they are built to, not what damage has made of them', () => {
    const knocked = { radius: 5, name: 'TIE', fighter: true } as unknown as ShipView['currentStructure'];
    const hurt = { ...craft(6, 0, knocked), blueprint: fighter } as ShipView;
    const whole = { ...craft(7, 0, fighter), blueprint: fighter } as ShipView;
    expect(fighterGroup(snapshotOf([whole, hurt]), whole)).toEqual([7, 6]);
  });

  it('picks only the ship itself for anything but a fighter', () => {
    expect(fighterGroup(picture, swarm[5]!)).toEqual([5]);
    expect(fighterGroup(picture, null)).toEqual([]);
  });
});
