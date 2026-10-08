import { describe, expect, it } from 'vitest';
import { expandFleet, isGroupUse, type Fleet } from '../sim/index.js';
import { FLEETS } from '../scenarios/fleets.js';
import { DINKY } from '../scenarios/blueprints.js';
import { dissolveGroup, makeGroup, renameGroup } from '../editor/fleetEdit.js';

/** Where every ship of a fleet stands and faces, in order, to compare two writings of one fleet. */
function standing(fleet: Fleet): { design: string; x: number; y: number; angle: number }[] {
  return expandFleet(fleet).map(({ design, x, y, angle }) => ({ design, x, y, angle }));
}

function expectSameShips(a: Fleet, b: Fleet): void {
  const one = standing(a).sort((p, q) => p.x - q.x || p.y - q.y);
  const two = standing(b).sort((p, q) => p.x - q.x || p.y - q.y);
  expect(two).toHaveLength(one.length);
  one.forEach((ship, i) => {
    expect(two[i]!.design).toBe(ship.design);
    expect(two[i]!.x).toBeCloseTo(ship.x, 6);
    expect(two[i]!.y).toBeCloseTo(ship.y, 6);
    expect(Math.cos(two[i]!.angle)).toBeCloseTo(Math.cos(ship.angle), 9);
    expect(Math.sin(two[i]!.angle)).toBeCloseTo(Math.sin(ship.angle), 9);
  });
}

/** A group mirrored, turned and repeated, holding a ship with a row of its own and a mirrored group. */
const awkward: Fleet = {
  name: 'Awkward',
  designs: { Dinky: DINKY },
  groups: {
    Pair: { ships: [{ design: 'Dinky', x: 10, y: 5, angle: 0.3 }, { design: 'Dinky', x: -10, y: 5, repeat: 3, step: { x: 4, y: 2, angle: 0.2 } }] },
    Wing: { ships: [{ group: 'Pair', x: 0, y: 20, angle: 0.5, mirror: true }, { design: 'Dinky', x: 30, y: -8, angle: -1 }] },
  },
  ships: [
    { group: 'Wing', x: 100, y: 40, angle: 1.1, mirror: true, repeat: 2, step: { x: 80, y: 10, angle: 0.4 } },
    { design: 'Dinky', x: -50, y: 0 },
  ],
};

describe('grouping a fleet in the editor', () => {
  it('dissolves a group use where its ships stood, mirrored, turned and repeated', () => {
    const dissolved = dissolveGroup(awkward, [0])!;
    expectSameShips(awkward, dissolved.fleet);
    // Wing is gone, as nothing uses it now; Pair is used by what came out of it.
    expect(dissolved.fleet.groups?.['Wing']).toBeUndefined();
    expect(dissolved.fleet.groups?.['Pair']).toBeDefined();
    // And again, down to ships alone.
    let fleet = dissolved.fleet;
    for (let i = fleet.ships.length - 1; i >= 0; i--) {
      if (isGroupUse(fleet.ships[i]!)) fleet = dissolveGroup(fleet, [i])!.fleet;
    }
    expect(fleet.groups).toBeUndefined();
    expectSameShips(awkward, fleet);
  });

  it('dissolves every stock fleet\'s groups without moving a ship', () => {
    for (const stock of Object.values(FLEETS)) {
      let fleet = stock;
      for (let i = fleet.ships.length - 1; i >= 0; i--) {
        if (isGroupUse(fleet.ships[i]!)) fleet = dissolveGroup(fleet, [i])!.fleet;
      }
      expectSameShips(stock, fleet);
    }
  });

  it('makes a group of entries in one list where they stood, and refuses entries from two lists', () => {
    const made = makeGroup(awkward, [[1], [0]])!;
    expectSameShips(awkward, made.fleet);
    expect(made.fleet.ships).toHaveLength(1);
    expect(made.path).toEqual([0]);
    expect(Object.keys(made.fleet.groups!)).toContain('Group');
    expect(makeGroup(awkward, [[1], [0, 1]])).toBeNull();
  });

  it('renames a group in its definition and every use, and refuses a name in use', () => {
    const renamed = renameGroup(awkward, 'Pair', 'Twins')!;
    expect(renamed.groups?.['Twins']).toBeDefined();
    expect(renamed.groups?.['Pair']).toBeUndefined();
    expectSameShips(awkward, renamed);
    expect(renameGroup(awkward, 'Pair', 'Wing')).toBeNull();
    expect(renameGroup(awkward, 'Pair', ' ')).toBeNull();
  });
});
