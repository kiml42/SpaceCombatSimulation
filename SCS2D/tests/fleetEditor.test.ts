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
  moveEntries,
  refreshDesign,
  repeatEntry,
} from '../editor/fleetEdit.js';
import { FleetDocument } from '../editor/fleetDocument.js';
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
    expect(Object.keys(deleteEntries(fleet, [1]).designs)).toEqual(['Dinky']);
  });

  it('moves and duplicates by entry', () => {
    const fleet = addShip(emptyFleet('F'), DINKY, 0, 0);
    expect(moveEntries(fleet, [0], 5, -5).ships[0]).toMatchObject({ x: 5, y: -5 });
    expect(duplicateEntries(fleet, [0], 0, 30).ships[1]).toMatchObject({ x: 0, y: 30 });
  });

  it('lays out a row stepped in each copy’s own frame', () => {
    const fleet = addShip(emptyFleet('F'), DINKY, 0, 0);
    const row = repeatEntry(fleet, 0, 3, { x: 10, y: 0, angle: math.HALF_PI });
    expect(row.ships).toHaveLength(3);
    expect(row.ships[1]).toMatchObject({ x: 10, y: 0 });
    expect(row.ships[2]!.x).toBeCloseTo(10, 9);
    expect(row.ships[2]!.y).toBeCloseTo(10, 9);
    expect(row.ships[2]!.angle).toBeCloseTo(math.PI, 9);
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

  it('picks a whole group by any ship in it', () => {
    const doc = new FleetDocument(LINE_OF_BATTLE, noLibrary);
    const group = LINE_OF_BATTLE.ships.findIndex((entry) => 'group' in entry);
    expect(doc.entryAt(0, 120)).toBe(group);
    expect(doc.entryAt(0, -120)).toBe(group);
    expect(doc.shipsOf(group)).toHaveLength(2);
    expect(doc.entryAt(1000, 1000)).toBe(-1);
  });

  it('forgets a selection an undo took away', () => {
    const doc = new FleetDocument(emptyFleet('F'), noLibrary);
    doc.apply(addShip(doc.fleet, DINKY, 0, 0));
    doc.select([0]);
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
