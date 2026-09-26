import { describe, expect, it } from 'vitest';
import { math, type Blueprint, type Fleet } from '../sim/index.js';
import { DINKY, GUNSHIP } from '../scenarios/blueprints.js';
import { LINE_OF_BATTLE } from '../scenarios/fleets.js';
import { History } from '../editor/history.js';
import { FLEET_FILES, Library, type KeyValueStore } from '../editor/library.js';
import {
  addShip,
  deleteEntries,
  duplicateEntries,
  emptyFleet,
  entryAt,
  moveEntries,
  refreshDesign,
  updateEntry,
} from '../editor/fleetEdit.js';
import { FleetDocument, toFrame, toFrameAngle } from '../editor/fleetDocument.js';
import { fleetSnapshot } from '../editor/fleetPreview.js';

function fakeStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const noLibrary = (): Blueprint | null => null;

describe('History', () => {
  it('undoes, redoes, and folds an amend into the step before it', () => {
    const h = new History(1);
    h.apply(2);
    h.amend(3);
    expect(h.current).toBe(3);
    expect(h.undo()).toBe(true);
    expect(h.current).toBe(1);
    expect(h.redo()).toBe(true);
    expect(h.current).toBe(3);
    h.replace(9);
    expect(h.canUndo).toBe(false);
  });
});

describe('the fleet library', () => {
  it('lists stock fleets and saves others under their own prefix', () => {
    const store = fakeStore();
    const fleets = new Library(store, FLEET_FILES);
    expect(fleets.list().map((e) => e.name)).toContain(LINE_OF_BATTLE.name);
    fleets.save({ ...LINE_OF_BATTLE, name: 'Mine' });
    expect(store.key(0)).toBe('scs2d.fleet.Mine');
    expect(fleets.load('Mine')?.ships).toEqual(LINE_OF_BATTLE.ships);
    expect(new Library(store).savedNames()).toEqual([]);
  });
});

describe('editing a fleet', () => {
  it('embeds a design the first time it is added, and reuses it after', () => {
    const one = addShip(emptyFleet('F'), DINKY, 0, 0);
    const changed = { ...DINKY, notes: 'changed' };
    const two = addShip(one, changed, 20, 0);
    expect(Object.keys(two.designs)).toEqual(['Dinky']);
    expect(two.designs['Dinky']!.notes).toBe(DINKY.notes);
    expect(two.ships).toHaveLength(2);
  });

  it('drops a design nothing flies any more', () => {
    const fleet = addShip(addShip(emptyFleet('F'), DINKY, 0, 0), GUNSHIP, 100, 0);
    expect(Object.keys(deleteEntries(fleet, [[1]]).designs)).toEqual(['Dinky']);
  });

  it('moves and duplicates by path', () => {
    const fleet = addShip(emptyFleet('F'), DINKY, 0, 0);
    expect(moveEntries(fleet, [{ path: [0], dx: 5, dy: -5 }]).ships[0]).toMatchObject({ x: 5, y: -5 });
    const copied = duplicateEntries(fleet, [[0]], 0, 30);
    expect(copied.fleet.ships[1]).toMatchObject({ x: 0, y: 30 });
    expect(copied.paths).toEqual([[1]]);
  });

  it('edits and deletes a member inside a group, for every use of the group', () => {
    const group = LINE_OF_BATTLE.ships.findIndex((entry) => 'group' in entry);
    const moved = moveEntries(LINE_OF_BATTLE, [{ path: [group, 1], dx: 10, dy: 0 }]);
    expect(entryAt(moved, [group, 1])).toMatchObject({ x: 10, y: -120 });
    expect(moved.groups!['Fighter Pair']!.ships[1]).toMatchObject({ x: 10 });
    const fewer = deleteEntries(LINE_OF_BATTLE, [[group, 0], [group, 1]]);
    expect(fewer.groups!['Fighter Pair']!.ships).toEqual([]);
    expect(fewer.designs['Dinky']).toBeUndefined();
  });

  it('keeps a repeat as a setting on the entry', () => {
    const fleet = updateEntry(addShip(emptyFleet('F'), DINKY, 0, 0), [0], (e) => ({ ...e, repeat: 3, step: { x: 0, y: 20 } }));
    const doc = new FleetDocument(fleet, noLibrary);
    expect(doc.view.ships.map((s) => s.y)).toEqual([0, 20, 40]);
    doc.apply(updateEntry(doc.fleet, [0], (e) => ({ ...e, step: { x: 0, y: 30 } })));
    expect(doc.view.ships.map((s) => s.y)).toEqual([0, 30, 60]);
    // Every copy picks the one entry.
    expect(doc.resolveClick(2)).toEqual([0]);
  });
});

describe('FleetDocument', () => {
  it('counts ships and mass by design, groups flattened', () => {
    const doc = new FleetDocument(LINE_OF_BATTLE, noLibrary);
    expect(doc.view.ships).toHaveLength(5);
    const dinky = doc.view.lines.find((line) => line.name === 'Dinky')!;
    expect(dinky.count).toBe(2);
    expect(doc.view.mass).toBeCloseTo(doc.view.lines.reduce((sum, l) => sum + l.count * l.mass, 0), 6);
    expect(doc.view.problems).toEqual([]);
  });

  it('lists hulls overlapping at the start, and draws them as faulty', () => {
    const doc = new FleetDocument(addShip(addShip(emptyFleet('F'), GUNSHIP, 0, 0), DINKY, 0, 0), noLibrary);
    expect(doc.view.problems).toEqual(['Gunship#1 and Dinky#1 overlap at the start']);
    expect(doc.view.faulty).toEqual([0, 1]);
  });

  it('warns when an embedded design differs from the library, until refreshed', () => {
    const newer = { ...DINKY, notes: 'refitted' };
    const lookup = (name: string) => (name === 'Dinky' ? newer : null);
    const doc = new FleetDocument(addShip(emptyFleet('F'), DINKY, 0, 0), lookup);
    expect(doc.view.stale).toEqual(['Dinky']);
    expect(doc.view.problems).toEqual(["Dinky differs from the library's Dinky"]);
    doc.apply(refreshDesign(doc.fleet, newer));
    expect(doc.view.stale).toEqual([]);
    expect(doc.fleet.designs['Dinky']!.notes).toBe('refitted');
  });

  it('picks a whole group first, and a member of it on the next click', () => {
    const doc = new FleetDocument(LINE_OF_BATTLE, noLibrary);
    const group = LINE_OF_BATTLE.ships.findIndex((entry) => 'group' in entry);
    const lower = doc.shipAt(0, -120);
    expect(doc.resolveClick(lower)).toEqual([group]);
    expect(doc.shipsOf([group])).toHaveLength(2);
    doc.select([[group]], lower);
    expect(doc.covers(lower)).toBe(true);
    expect(doc.resolveClick(lower)).toEqual([group, 1]);
    // Once inside, a sibling is reached directly rather than going back out.
    doc.select([[group, 1]], lower);
    expect(doc.resolveClick(doc.shipAt(0, 120))).toEqual([group, 0]);
    expect(doc.shipAt(1000, 1000)).toBe(-1);
  });

  it('frames a member of a mirrored, turned group by the copy clicked', () => {
    const fleet: Fleet = {
      name: 'F',
      designs: { Dinky: DINKY },
      groups: { Pair: { ships: [{ design: 'Dinky', x: 0, y: 20 }] } },
      ships: [{ group: 'Pair', x: 100, y: 0, angle: math.HALF_PI, mirror: true }],
    };
    const doc = new FleetDocument(fleet, noLibrary);
    doc.select([[0, 0]], 0);
    const frame = doc.frameOf([0, 0])!;
    // Turned a quarter and reflected: +y on the field is +x in the group, and +x is +y.
    const local = toFrame(frame, 0, 10);
    expect(local.dx).toBeCloseTo(10, 9);
    expect(local.dy).toBeCloseTo(0, 9);
    expect(toFrame(frame, 10, 0).dy).toBeCloseTo(10, 9);
    expect(toFrameAngle(frame, math.HALF_PI)).toBeCloseTo(0, 9);
  });

  it('splits a repeated group into one box per copy, the clicked copy primary', () => {
    const group = LINE_OF_BATTLE.ships.findIndex((entry) => 'group' in entry);
    const fleet = updateEntry(LINE_OF_BATTLE, [group], (e) => ({ ...e, repeat: 3, step: { x: -60, y: 0 } }));
    const doc = new FleetDocument(fleet, noLibrary);
    const second = doc.shipsOf([group])[2]!;
    doc.select([[group]], second);
    const copies = doc.copiesOf([group]);
    expect(copies.map((copy) => copy.ships.length)).toEqual([2, 2, 2]);
    expect(copies.map((copy) => copy.primary)).toEqual([false, true, false]);
  });

  it('forgets a selection an undo took away', () => {
    const doc = new FleetDocument(emptyFleet('F'), noLibrary);
    doc.apply(addShip(doc.fleet, DINKY, 0, 0));
    doc.select([[0]]);
    doc.undo();
    expect(doc.selection).toEqual([]);
  });
});

describe('fleetSnapshot', () => {
  it('stands each ship where the fleet puts it, turned as it is', () => {
    const fleet: Fleet = { name: 'F', designs: { Dinky: DINKY }, ships: [{ design: 'Dinky', x: 100, y: 50, angle: math.HALF_PI }] };
    const doc = new FleetDocument(fleet, noLibrary);
    const snapshot = fleetSnapshot(doc.view);
    const design = doc.view.designs[0]!;
    expect(snapshot.shipCount).toBe(1);
    expect(snapshot.ships[0]!.angle).toBe(math.HALF_PI);
    expect(snapshot.ships[0]!.x).toBeCloseTo(100 - design.centreOfMassY, 9);
    expect(snapshot.ships[0]!.y).toBeCloseTo(50 + design.centreOfMassX, 9);
    expect(snapshot.maxX - snapshot.minX).toBeCloseTo(design.radius * 2, 9);
  });
});
