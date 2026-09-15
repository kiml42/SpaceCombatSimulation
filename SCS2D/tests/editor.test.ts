import { describe, expect, it } from 'vitest';
import {
  expandBlueprint,
  expandWithOrigins,
  math,
  moduleStats,
  samePlacement,
  parseBlueprint,
  serialiseBlueprint,
  type Blueprint,
  type ModuleSpec,
  type ShipDesign,
} from '../sim/index.js';
import { CORVETTE, GUNSHIP } from '../scenarios/blueprints.js';
import { EditorDocument } from '../editor/document.js';
import {
  addModule,
  cloneBlueprint,
  duplicatePlacement,
  positionHandle,
  removeCopy,
  unlinkable,
  unlinkPlacement,
  moduleAt,
  movePlacement,
  removePlacement,
  snap,
  toPlacementFrame,
  updatePlacement,
} from '../editor/edit.js';
import { emptyBlueprint, Library, toFileText, type KeyValueStore } from '../editor/library.js';
import { Demonstration, ROUND_LIFETIME } from '../editor/demonstrate.js';
import { MAX_BEAM_LENGTH } from '../sim/beams.js';
import { GunType } from '../sim/modules.js';
import { previewSnapshot } from '../editor/preview.js';
import { designStats, envelopes, headingCost, moduleReadout } from '../editor/stats.js';

/**
 * The editor's half: what an edit does to a layout, and what the page reads
 * back off it.
 *
 * All of it is arithmetic and data, deliberately — the canvas and the panels
 * are wiring, and the failures worth catching are here: an edit through the
 * wrong frame, a selection surviving the deletion of what it pointed at, an
 * undo that half-restores, a shared part that one copy diverges from.
 */

const hull: ModuleSpec = { kind: 'structure', x: 0, y: 0, length: 20, width: 6 };

function ship(blueprint: Omit<Blueprint, 'name'>): Blueprint {
  return { name: 'Test', ...blueprint };
}

/** Where a layout draws its modules, for comparing one edit's result with another's. */
function positions(blueprint: Blueprint): [number, number][] {
  return expandWithOrigins(blueprint).modules.map((m) => [m.x, m.y]);
}

describe('moving a module', () => {
  it('moves a plain placement by what it was dragged', () => {
    const bp = ship({ modules: [hull] });
    const { origins } = expandWithOrigins(bp);
    const moved = movePlacement(bp, origins[0]!, 3, -2)!;
    expect(positions(moved)).toEqual([[3, -2]]);
  });

  it('writes the movement in the frame the placement was written in', () => {
    // The pod is placed inside an assembly turned a quarter turn, so a drag
    // towards +x on screen is a drag towards -y in the text of the file.
    const bp = ship({
      assemblies: { pod: { modules: [{ kind: 'structure', x: 0, y: 0, length: 2, width: 2 }] } },
      modules: [hull, { use: 'pod', x: 10, y: 0, angle: math.HALF_PI }],
    });
    const { origins } = expandWithOrigins(bp);
    const moved = movePlacement(bp, origins[1]!, 1, 0)!;
    // What the file says changed; what the player sees moved by what they dragged.
    expect(positions(moved)[1]![0]).toBeCloseTo(11, 12);
    expect(positions(moved)[1]![1]).toBeCloseTo(0, 12);
  });

  it('undoes mirroring, so a reflected copy follows the pointer', () => {
    const bp = ship({
      assemblies: { pod: { modules: [{ kind: 'structure', x: 0, y: 0, length: 2, width: 2 }] } },
      modules: [hull, { use: 'pod', x: 0, y: 8, mirror: true }],
    });
    const { origins } = expandWithOrigins(bp);
    const moved = movePlacement(bp, origins[1]!, 0, 3)!;
    expect(positions(moved)[1]).toEqual([0, 11]);
  });

  it('moves every copy of a shared part together', () => {
    // The corvette's four wing boxes are four instances of one assembly, so
    // the module inside it is written once and moves four times.
    const { origins, modules } = expandWithOrigins(CORVETTE);
    const wing = modules.findIndex((m) => m.length === 4 && m.width === 3);
    const moved = movePlacement(CORVETTE, origins[wing]!, 1, 0)!;
    const before = positions(CORVETTE);
    const after = positions(moved);
    const shifted = after.filter((p, i) => p[0] !== before[i]![0] || p[1] !== before[i]![1]);
    expect(shifted).toHaveLength(4);
  });

  it('leaves the original blueprint alone', () => {
    const bp = ship({ modules: [hull] });
    const copy = cloneBlueprint(bp);
    movePlacement(bp, expandWithOrigins(bp).origins[0]!, 5, 5);
    expect(bp).toEqual(copy);
  });

  it('reports a path that no longer leads anywhere', () => {
    const bp = ship({ modules: [hull] });
    const origin = expandWithOrigins(bp).origins[0]!;
    const emptied = removePlacement(bp, origin.path)!;
    expect(movePlacement(emptied, origin, 1, 1)).toBeNull();
  });
});

describe('toPlacementFrame', () => {
  it('is the identity in an unturned, unreflected frame', () => {
    expect(toPlacementFrame({ path: [], rotation: 0, mirrored: false, instanceFrame: null }, 2, 3)).toEqual({ dx: 2, dy: 3 });
  });

  it('undoes the rotation before the reflection', () => {
    const local = toPlacementFrame({ path: [], rotation: math.HALF_PI, mirrored: true, instanceFrame: null }, 0, 1);
    expect(local.dx).toBeCloseTo(1, 12);
    expect(local.dy).toBeCloseTo(0, 12);
  });
});

describe('adding and removing', () => {
  it('appends, because module order is part of the ship', () => {
    const bp = ship({ modules: [hull] });
    const spec: ModuleSpec = { kind: 'turret', x: 8, y: 0, length: 3, width: 3 };
    const added = addModule(bp, spec);
    expect(added.blueprint.modules).toHaveLength(2);
    expect(added.blueprint.modules[1]).toEqual(spec);
    expect(added.path).toEqual([{ index: 1, copy: 0 }]);
  });

  it('removes the placement a path names, and every copy with it', () => {
    const { origins, modules } = expandWithOrigins(CORVETTE);
    const wing = modules.findIndex((m) => m.length === 4 && m.width === 3);
    const cut = removePlacement(CORVETTE, origins[wing]!.path)!;
    expect(expandWithOrigins(cut).modules).toHaveLength(modules.length - 4);
  });
});

describe('updatePlacement', () => {
  it('edits the text of a shared part once', () => {
    const { origins, modules } = expandWithOrigins(CORVETTE);
    const wing = modules.findIndex((m) => m.length === 4 && m.width === 3);
    const wider = updatePlacement(CORVETTE, origins[wing]!.path, (p) => ({ ...p, width: 4 }) as ModuleSpec)!;
    const drawn = expandWithOrigins(wider).modules.filter((m) => m.length === 4 && m.width === 4);
    expect(drawn).toHaveLength(4);
  });
});

describe('snapping and picking', () => {
  it('snaps a displacement rather than a position, so offsets survive', () => {
    expect(snap(1.2, 0.5)).toBe(1);
    expect(snap(-1.4, 0.5)).toBe(-1.5);
    expect(snap(1.2, 0)).toBe(1.2);
  });

  it('picks the module under a point', () => {
    const modules: ModuleSpec[] = [hull, { kind: 'turret', x: 8, y: 0, length: 4, width: 4 }];
    expect(moduleAt(modules, 0, 0)).toBe(0);
    expect(moduleAt(modules, 8, 1)).toBe(1);
    expect(moduleAt(modules, 40, 0)).toBe(-1);
  });

  it('respects a module’s facing', () => {
    const modules: ModuleSpec[] = [{ kind: 'structure', x: 0, y: 0, angle: math.HALF_PI, length: 20, width: 2 }];
    expect(moduleAt(modules, 0, 8)).toBe(0);
    expect(moduleAt(modules, 8, 0)).toBe(-1);
  });

  it('picks the topmost when a layout being worked on has modules overlapping', () => {
    const modules: ModuleSpec[] = [hull, { kind: 'turret', x: 0, y: 0, length: 4, width: 4 }];
    expect(moduleAt(modules, 0, 0)).toBe(1);
  });
});

describe('EditorDocument', () => {
  it('derives a design, and keeps deriving one while the layout is invalid', () => {
    const doc = new EditorDocument(CORVETTE);
    expect(doc.view.problems).toEqual([]);
    expect(doc.view.design).not.toBeNull();

    const origin = doc.view.origins[1]!;
    doc.apply(movePlacement(doc.blueprint, origin, -6, 0)!);
    expect(doc.view.problems.length).toBeGreaterThan(0);
    // Overlapping is a complaint, not a refusal: the picture and the numbers
    // have to survive dragging one module through another.
    expect(doc.view.design).not.toBeNull();
  });

  it('has nothing to measure in an empty layout, and says why', () => {
    const doc = new EditorDocument(emptyBlueprint('Blank'));
    expect(doc.view.design).toBeNull();
    expect(doc.view.underivable).toMatch(/at least one module/);
  });

  it('undoes and redoes', () => {
    const doc = new EditorDocument(ship({ modules: [hull] }));
    expect(doc.canUndo).toBe(false);
    doc.apply(movePlacement(doc.blueprint, doc.view.origins[0]!, 4, 0)!);
    expect(positions(doc.blueprint)).toEqual([[4, 0]]);
    expect(doc.undo()).toBe(true);
    expect(positions(doc.blueprint)).toEqual([[0, 0]]);
    expect(doc.redo()).toBe(true);
    expect(positions(doc.blueprint)).toEqual([[4, 0]]);
    expect(doc.redo()).toBe(false);
  });

  it('collapses a drag into one undo step', () => {
    const doc = new EditorDocument(ship({ modules: [hull] }));
    const from = doc.blueprint;
    const origin = doc.view.origins[0]!;
    doc.apply(movePlacement(from, origin, 1, 0)!);
    for (let i = 2; i <= 20; i++) doc.amend(movePlacement(from, origin, i, 0)!);
    expect(positions(doc.blueprint)).toEqual([[20, 0]]);
    doc.undo();
    expect(positions(doc.blueprint)).toEqual([[0, 0]]);
  });

  it('drops a redo once a new edit is made', () => {
    const doc = new EditorDocument(ship({ modules: [hull] }));
    doc.apply(movePlacement(doc.blueprint, doc.view.origins[0]!, 4, 0)!);
    doc.undo();
    doc.apply(movePlacement(doc.blueprint, doc.view.origins[0]!, 0, 4)!);
    expect(doc.canRedo).toBe(false);
  });

  it('selects the placement, not the copy', () => {
    const doc = new EditorDocument(CORVETTE);
    const wing = doc.view.modules.findIndex((m) => m.length === 4 && m.width === 3);
    doc.selectModule(wing);
    expect(doc.selectedModules()).toHaveLength(4);
    // The copy that was picked is the one an edit is written through.
    expect(doc.selectedModules()[0]).toBe(wing);
    expect(doc.selectedOrigin()!.path).toEqual(doc.view.origins[wing]!.path);
  });

  it('gives the panel what was typed, not what it expanded to', () => {
    const doc = new EditorDocument(CORVETTE);
    const wing = doc.view.modules.findIndex((m) => m.length === 4 && m.width === 3);
    doc.selectModule(wing);
    // The drawn copy sits out on the wing; the placement is written at the
    // assembly's own origin.
    expect(doc.selectedPlacement).toMatchObject({ x: 0, y: 0 });
  });

  it('lets a selection go when the layout stops drawing it', () => {
    const doc = new EditorDocument(ship({ modules: [hull, { kind: 'turret', x: 8, y: 0, length: 3, width: 3 }] }));
    doc.selectModule(1);
    expect(doc.selection).not.toBeNull();
    doc.apply(removePlacement(doc.blueprint, doc.selection!)!);
    expect(doc.selection).toBeNull();
    expect(doc.selectedPlacement).toBeNull();
  });

  it('restores a selection when the deletion is undone', () => {
    const doc = new EditorDocument(ship({ modules: [hull, { kind: 'turret', x: 8, y: 0, length: 3, width: 3 }] }));
    doc.selectModule(1);
    doc.apply(removePlacement(doc.blueprint, doc.selection!)!);
    doc.undo();
    doc.selectModule(1);
    expect(doc.selectedPlacement).toMatchObject({ kind: 'turret' });
  });

  it('does not carry a history from one ship to the next', () => {
    const doc = new EditorDocument(CORVETTE);
    doc.apply(movePlacement(doc.blueprint, doc.view.origins[0]!, 1, 0)!);
    doc.replace(GUNSHIP);
    expect(doc.canUndo).toBe(false);
    expect(doc.blueprint.name).toBe(GUNSHIP.name);
  });

  it('does not hold the blueprint it was given', () => {
    const bp = ship({ modules: [hull] });
    const doc = new EditorDocument(bp);
    doc.apply(movePlacement(doc.blueprint, doc.view.origins[0]!, 9, 9)!);
    expect(positions(bp)).toEqual([[0, 0]]);
  });
});

describe('previewSnapshot', () => {
  it('puts the blueprint frame at the origin, so an edit does not move the ship', () => {
    const doc = new EditorDocument(CORVETTE);
    const snapshot = previewSnapshot(doc.view.design!);
    const view = snapshot.ships[0]!;
    // Module positions are stored about the centre of mass, so placing the
    // body at the centre of mass puts them back where they were written.
    const drawn = view.design.modules.map((m) => [m.x + view.x, m.y + view.y]);
    expect(drawn[0]![0]).toBeCloseTo(doc.view.modules[0]!.x, 9);
    expect(drawn[0]![1]).toBeCloseTo(doc.view.modules[0]!.y, 9);
  });

  it('shows a ship at rest, with its guns where they were mounted', () => {
    const design = new EditorDocument(GUNSHIP).view.design!;
    const snapshot = previewSnapshot(design);
    const view = snapshot.ships[0]!;
    expect(view.throttles.every((t) => t === 0)).toBe(true);
    expect(view.turretReady.every((r) => r === false)).toBe(true);
    expect(view.turretBearings).toEqual(design.turrets.map((t) => t.mount.restBearing ?? 0));
    expect(snapshot.projectileCount).toBe(0);
  });

  it('reuses the snapshot it is given', () => {
    const design = new EditorDocument(CORVETTE).view.design!;
    const first = previewSnapshot(design);
    expect(previewSnapshot(design, first)).toBe(first);
    expect(first.shipCount).toBe(1);
  });
});

describe('designStats', () => {
  it('reads the design rather than working anything out again', () => {
    const design = new EditorDocument(CORVETTE).view.design!;
    const stats = designStats(design, envelopes(design));
    expect(stats.mass).toBe(design.mass);
    expect(stats.inertia).toBe(design.inertia);
    expect(stats.moduleCount).toBe(design.modules.length);
    expect(stats.fullAuthority).toBe(design.thrusterLayout.hasFullAuthority());
  });

  it('reports the acceleration a ship can use, not the most it can project', () => {
    const design = new EditorDocument(CORVETTE).view.design!;
    const stats = designStats(design, envelopes(design));
    // The corvette is balanced on its axes, so on the cardinals the two agree —
    // which is what makes the diagonal gap below a statement about the layout
    // rather than about the measurement.
    expect(stats.accelFore).toBeCloseTo(design.thrusterLayout.maxThrustAlong(1, 0) / design.mass, 2);
    expect(stats.accelPort).toBeCloseTo(design.thrusterLayout.maxThrustAlong(0, 1) / design.mass, 2);
  });

  it('reports a gun in the figures a player compares', () => {
    const design = new EditorDocument(GUNSHIP).view.design!;
    const turret = designStats(design, envelopes(design)).turrets[0]!;
    const gun = design.turrets[0]!.gun;
    expect(turret.calibre).toBe(gun.calibre);
    expect(turret.roundsPerMinute).toBeCloseTo(60 / gun.cycleTime, 9);
    expect(turret.arcLeft).toBeGreaterThan(0);
  });
});

describe('the manoeuvring envelopes', () => {
  it('samples the unconstrained curve from the bow, anticlockwise', () => {
    const design = new EditorDocument(CORVETTE).view.design!;
    const layout = design.thrusterLayout;
    const envelope = envelopes(design, 4);
    expect(envelope.free[0]).toBeCloseTo(layout.maxThrustAlong(1, 0) / design.mass, 9);
    expect(envelope.free[1]).toBeCloseTo(layout.maxThrustAlong(0, 1) / design.mass, 9);
    expect(envelope.free[2]).toBeCloseTo(layout.maxThrustAlong(-1, 0) / design.mass, 9);
    expect(envelope.free[3]).toBeCloseTo(layout.maxThrustAlong(0, -1) / design.mass, 9);
  });

  it('never claims a ship can hold more than it can project', () => {
    for (const blueprint of [CORVETTE, GUNSHIP]) {
      const design = new EditorDocument(blueprint).view.design!;
      const envelope = envelopes(design);
      for (let i = 0; i < envelope.samples; i++) {
        expect(envelope.holding[i]!).toBeLessThanOrEqual(envelope.free[i]! + 1e-9);
      }
    }
  });

  it('costs the corvette nothing on its axes and something on the diagonal', () => {
    const design = new EditorDocument(CORVETTE).view.design!;
    const envelope = envelopes(design, 8);
    // The lateral thrusters are written at x = ±4 while the centre of mass sits
    // at x = +0.92, pulled forward by the bow turret — so pushing abeam needs
    // trimming, and the trim runs out where the main engine is already at full
    // throttle. That is the whole of what the two curves are drawn to show.
    expect(envelope.holding[0]).toBeCloseTo(envelope.free[0]!, 6);
    expect(envelope.holding[2]).toBeCloseTo(envelope.free[2]!, 6);
    expect(envelope.holding[1]!).toBeLessThan(envelope.free[1]! * 0.95);
    expect(headingCost(envelope)).toBeGreaterThan(0.05);
  });

  it('is zero for a layout whose thrust is balanced about its centre of mass', () => {
    // One thruster either side of the centre of mass, pushing the same way:
    // the torques cancel, so nothing is given up to avoid spinning.
    const design = new EditorDocument(
      ship({
        modules: [
          { kind: 'structure', x: 0, y: 0, length: 20, width: 6 },
          { kind: 'thruster', x: 6, y: -4, angle: math.HALF_PI, length: 2, width: 3 },
          { kind: 'thruster', x: -6, y: -4, angle: math.HALF_PI, length: 2, width: 3 },
        ],
      }),
    ).view.design!;
    // Eight samples, so index 2 is abeam to port — the direction those two
    // thrusters push.
    const envelope = envelopes(design, 8);
    expect(envelope.free[2]!).toBeGreaterThan(0);
    expect(envelope.holding[2]).toBeCloseTo(envelope.free[2]!, 6);
  });

  it('gives up everything in a direction it can only push by spinning', () => {
    // One lateral thruster, well forward of the centre of mass, with nothing to
    // cancel the torque it makes.
    const design = new EditorDocument(
      ship({
        modules: [
          { kind: 'structure', x: 0, y: 0, length: 20, width: 6 },
          { kind: 'thruster', x: 6, y: -4, angle: math.HALF_PI, length: 2, width: 3 },
        ],
      }),
    ).view.design!;
    const envelope = envelopes(design, 4);
    expect(envelope.free[1]).toBeGreaterThan(0);
    expect(envelope.holding[1]).toBe(0);
    expect(headingCost(envelope)).toBeCloseTo(1, 6);
  });
});

/** A `localStorage` that is a plain object, so the library can be tested in Node. */
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

describe('Library', () => {
  it('lists the ships that come with the game', () => {
    const names = new Library(fakeStore()).list().map((e) => e.name);
    expect(names).toContain(CORVETTE.name);
    expect(names).toContain(GUNSHIP.name);
  });

  it('round-trips a saved ship through the file format', () => {
    const library = new Library(fakeStore());
    const edited = { ...CORVETTE, name: 'Corvette II' };
    library.save(edited);
    expect(library.load('Corvette II')).toEqual(edited);
  });

  it('shadows a built-in ship rather than replacing it', () => {
    const library = new Library(fakeStore());
    const edited = { ...CORVETTE, notes: 'mine now' };
    library.save(edited);
    expect(library.list().filter((e) => e.name === CORVETTE.name)).toHaveLength(1);
    expect(library.load(CORVETTE.name)).toEqual(edited);
    library.remove(CORVETTE.name);
    expect(library.load(CORVETTE.name)).toEqual(CORVETTE);
  });

  it('exports text a parser reads back unchanged', () => {
    expect(parseBlueprint(JSON.parse(toFileText(GUNSHIP)))).toEqual(GUNSHIP);
    expect(JSON.parse(toFileText(GUNSHIP))).toEqual(serialiseBlueprint(GUNSHIP));
  });

  it('starts a new ship blank, with no module chosen for the player', () => {
    expect(emptyBlueprint('Blank').modules).toEqual([]);
  });
});

describe('duplicating a module', () => {
  it('makes it a shared part and places a second copy', () => {
    const bp = ship({ modules: [hull, { kind: 'turret', x: 12, y: 0, length: 4, width: 4 }] });
    const before = expandWithOrigins(bp);
    const result = duplicatePlacement(bp, before.origins[1]!)!;
    const after = expandWithOrigins(result.blueprint);

    expect(after.modules).toHaveLength(3);
    // The ship it was made from is untouched: the first two modules are where
    // and what they were, so only the copy is new.
    expect(after.modules[0]).toEqual(before.modules[0]);
    expect(after.modules[1]).toEqual(before.modules[1]);
    // And the two turrets are now the same part.
    expect(samePlacement(after.origins[1]!.path, after.origins[2]!.path)).toBe(true);
  });

  it('puts the copy somewhere it can be seen and grabbed', () => {
    const bp = ship({ modules: [hull, { kind: 'turret', x: 12, y: 0, length: 4, width: 4 }] });
    const result = duplicatePlacement(bp, expandWithOrigins(bp).origins[1]!)!;
    const copies = expandWithOrigins(result.blueprint).modules.slice(1);
    expect(copies[0]).toMatchObject({ x: 12, y: 0 });
    expect(copies[1]).toMatchObject({ x: 12, y: 4 });
  });

  it('changes both copies when the shared module is edited', () => {
    const bp = ship({ modules: [hull, { kind: 'turret', x: 12, y: 0, length: 4, width: 4 }] });
    const doc = new EditorDocument(duplicatePlacement(bp, expandWithOrigins(bp).origins[1]!)!.blueprint);
    doc.selectModule(1);
    doc.apply(updatePlacement(doc.blueprint, doc.selection!, (p) => ({ ...p, length: 6 }))!);
    const turrets = doc.view.modules.filter((m) => m.kind === 'turret');
    expect(turrets).toHaveLength(2);
    expect(turrets.every((m) => m.length === 6)).toBe(true);
  });

  it('places one more copy rather than nesting when pressed again', () => {
    const bp = ship({ modules: [hull, { kind: 'turret', x: 12, y: 0, length: 4, width: 4 }] });
    let current = duplicatePlacement(bp, expandWithOrigins(bp).origins[1]!)!.blueprint;
    for (let i = 0; i < 2; i++) {
      const origins = expandWithOrigins(current).origins;
      current = duplicatePlacement(current, origins[origins.length - 1]!)!.blueprint;
    }
    // Three presses, three extra turrets — not the eight that wrapping an
    // assembly inside a copy of itself would have produced.
    expect(expandWithOrigins(current).modules.filter((m) => m.kind === 'turret')).toHaveLength(4);
    expect(Object.keys(current.assemblies ?? {})).toHaveLength(1);
  });
});

describe('the placement that carries a copy’s position', () => {
  it('is the module itself when it is not shared', () => {
    const bp = ship({ modules: [hull] });
    const origin = expandWithOrigins(bp).origins[0]!;
    const handle = positionHandle(bp, origin);
    expect(handle.perCopy).toBe(false);
    expect(handle.origin.path).toEqual(origin.path);
  });

  it('is the instance when the module is the whole of its assembly', () => {
    const origins = expandWithOrigins(CORVETTE).origins;
    const wing = expandWithOrigins(CORVETTE).modules.findIndex(
      (m) => m.length === 4 && m.width === 3,
    );
    const handle = positionHandle(CORVETTE, origins[wing]!);
    expect(handle.perCopy).toBe(true);
    // Each wing box's instance is its own placement, so moving one moves one.
    const moved = movePlacement(CORVETTE, handle.origin, 0, 2)!;
    const before = positions(CORVETTE);
    const after = positions(moved);
    expect(after.filter((p, i) => p[1] !== before[i]![1])).toHaveLength(1);
  });

  it('stays with the module when the assembly holds more than it', () => {
    const bp = ship({
      assemblies: {
        wing: {
          modules: [
            { kind: 'structure', x: 0, y: 0, length: 4, width: 3 },
            { kind: 'structure', x: 4, y: 0, length: 4, width: 3 },
          ],
        },
      },
      modules: [hull, { use: 'wing', x: 0, y: 6 }, { use: 'wing', x: 0, y: -6 }],
    });
    const origins = expandWithOrigins(bp).origins;
    // Dragging one part of a group has to move the part, not the whole group.
    expect(positionHandle(bp, origins[1]!).perCopy).toBe(false);
  });
});

describe('unlinking a shared module', () => {
  it('leaves the ship bit-identical when the module was the whole assembly', () => {
    const before = expandBlueprint(CORVETTE);
    const wing = before.findIndex((m) => m.length === 4 && m.width === 3);
    const origins = expandWithOrigins(CORVETTE).origins;
    expect(unlinkable(CORVETTE, origins[wing]!)).toBe(4);

    const unlinked = unlinkPlacement(CORVETTE, origins[wing]!)!;
    // Exact, down to module order — which is part of the ship, since thruster
    // allocation and firing both run over it.
    expect(expandBlueprint(unlinked)).toEqual(before);
    expect(unlinked.assemblies?.['wingBox']).toBeUndefined();
  });

  it('lets the copies be edited apart afterwards', () => {
    const origins = expandWithOrigins(CORVETTE).origins;
    const wing = expandWithOrigins(CORVETTE).modules.findIndex(
      (m) => m.length === 4 && m.width === 3,
    );
    const doc = new EditorDocument(unlinkPlacement(CORVETTE, origins[wing]!)!);
    doc.selectModule(wing);
    expect(doc.selectedModules()).toHaveLength(1);
    doc.apply(updatePlacement(doc.blueprint, doc.selection!, (p) => ({ ...p, width: 5 }))!);
    expect(doc.view.modules.filter((m) => m.length === 4 && m.width === 5)).toHaveLength(1);
  });

  it('hands the module to each instance as an extra when the assembly holds more', () => {
    const bp = ship({
      assemblies: {
        wing: {
          modules: [
            { kind: 'structure', x: 0, y: 0, length: 4, width: 3 },
            { kind: 'structure', x: 4, y: 0, length: 4, width: 3 },
          ],
        },
      },
      modules: [hull, { use: 'wing', x: 0, y: 6 }, { use: 'wing', x: 0, y: -6 }],
    });
    const origins = expandWithOrigins(bp).origins;
    const unlinked = unlinkPlacement(bp, origins[2]!)!;
    expect(unlinked.assemblies?.['wing']?.modules).toHaveLength(1);
    // Same modules in the same places, and each copy now separately editable.
    expect(expandWithOrigins(unlinked).modules).toHaveLength(5);
    const after = expandWithOrigins(unlinked);
    expect(samePlacement(after.origins[2]!.path, after.origins[4]!.path)).toBe(false);
  });

  it('is offered only for a part that is actually shared', () => {
    const bp = ship({ modules: [hull] });
    expect(unlinkable(bp, expandWithOrigins(bp).origins[0]!)).toBe(0);
  });
});

describe('moduleReadout', () => {
  it('reports the module rather than the ship', () => {
    const spec: ModuleSpec = { kind: 'turret', x: 0, y: 0, length: 6, width: 4, barrels: 2 };
    const readout = moduleReadout(spec);
    const stats = moduleStats(spec);
    const mass = readout.rows.find(([k]) => k === 'Mass')![1];
    expect(mass).toBe(`${(stats.mass / 1000).toLocaleString('en-GB', { maximumFractionDigits: 2 })} t`);
    expect(readout.gun!.barrels).toBe(2);
    expect(readout.gun!.calibre).toBe(stats.gun!.calibre);
  });

  it('gives a thruster a thrust row and a structure module none', () => {
    const thruster = moduleReadout({ kind: 'thruster', x: 0, y: 0, length: 3, width: 3 });
    expect(thruster.rows.some(([k]) => k === 'Thrust')).toBe(true);
    expect(thruster.gun).toBeNull();
    const structure = moduleReadout({ kind: 'structure', x: 0, y: 0, length: 3, width: 3 });
    expect(structure.rows.some(([k]) => k === 'Thrust')).toBe(false);
  });
});

describe('deleting a copy', () => {
  it('takes one copy of a shared part, not the part itself', () => {
    const bp = ship({ modules: [hull, { kind: 'turret', x: 12, y: 0, length: 4, width: 4 }] });
    const shared = duplicatePlacement(bp, expandWithOrigins(bp).origins[1]!)!.blueprint;
    expect(expandWithOrigins(shared).modules).toHaveLength(3);

    const origins = expandWithOrigins(shared).origins;
    const left = removeCopy(shared, origins[2]!)!;
    // One turret goes, one stays — where deleting the shared module would have
    // taken both.
    expect(expandWithOrigins(left).modules.filter((m) => m.kind === 'turret')).toHaveLength(1);
  });

  it('takes the assembly with the last copy', () => {
    const bp = ship({ modules: [hull, { kind: 'turret', x: 12, y: 0, length: 4, width: 4 }] });
    let current = duplicatePlacement(bp, expandWithOrigins(bp).origins[1]!)!.blueprint;
    expect(Object.keys(current.assemblies ?? {})).toHaveLength(1);
    for (let i = 0; i < 2; i++) {
      const origins = expandWithOrigins(current).origins;
      current = removeCopy(current, origins[origins.length - 1]!)!;
    }
    expect(expandWithOrigins(current).modules).toHaveLength(1);
    // Nothing places it any more, so it does not linger in the file.
    expect(Object.keys(current.assemblies ?? {})).toHaveLength(0);
  });

  it('takes a module out of every copy of a group it is part of', () => {
    const bp = ship({
      assemblies: {
        wing: {
          modules: [
            { kind: 'structure', x: 0, y: 0, length: 4, width: 3 },
            { kind: 'structure', x: 4, y: 0, length: 4, width: 3 },
          ],
        },
      },
      modules: [hull, { use: 'wing', x: 0, y: 6 }, { use: 'wing', x: 0, y: -6 }],
    });
    const origins = expandWithOrigins(bp).origins;
    const cut = removeCopy(bp, origins[1]!)!;
    // Deleting part of a group deletes it from the group, which is both wings.
    expect(expandWithOrigins(cut).modules).toHaveLength(3);
  });
});

describe('a turret’s arc on the module panel', () => {
  it('is read off what is around it', () => {
    const modules: ModuleSpec[] = [
      { kind: 'structure', x: 0, y: 0, length: 20, width: 6 },
      { kind: 'turret', x: 12, y: 0, length: 4, width: 4 },
    ];
    const open = moduleReadout(modules[1]!, modules, 1).gun!;
    // The same mount walled in on one beam must lose sweep that way.
    const walled: ModuleSpec[] = [...modules, { kind: 'structure', x: 12, y: 6, length: 8, width: 6 }];
    const blocked = moduleReadout(walled[1]!, walled, 1).gun!;
    expect(open.arcLeft).toBeGreaterThan(blocked.arcLeft);
  });

  it('is absent without the layout around it', () => {
    const spec: ModuleSpec = { kind: 'turret', x: 0, y: 0, length: 4, width: 4 };
    expect(moduleReadout(spec).gun!.arcLeft).toBe(0);
  });
});

describe('Demonstration', () => {
  /** A light mount, whose cycle is short enough to watch several rounds of. */
  const popgun = (): ShipDesign =>
    new EditorDocument(
      ship({
        modules: [
          { kind: 'structure', x: 0, y: 0, length: 20, width: 6 },
          { kind: 'turret', x: 11, y: 0, length: 0.8, width: 0.8, barrels: 2 },
          { kind: 'thruster', x: -11, y: 0, angle: 0, length: 2, width: 6 },
        ],
      }),
    ).view.design!;

  it('does nothing, and asks for no frames, while nothing is selected', () => {
    const demo = new Demonstration();
    demo.step(popgun(), [], 1 / 60);
    expect(demo.running).toBe(false);
  });

  it('spools a selected engine up and back down', () => {
    const design = popgun();
    const demo = new Demonstration();
    const thruster = design.modules.findIndex((m) => m.spec.kind === 'thruster');
    const snapshot = previewSnapshot(design);

    for (let i = 0; i < 120; i++) demo.step(design, [design.modules[thruster]!.index], 1 / 60);
    demo.writeInto(snapshot);
    expect(Math.max(...snapshot.ships[0]!.throttles)).toBe(1);

    for (let i = 0; i < 120; i++) demo.step(design, [], 1 / 60);
    demo.writeInto(snapshot);
    expect(Math.max(...snapshot.ships[0]!.throttles)).toBe(0);
    expect(demo.running).toBe(false);
  });

  it('burns only the engine that was selected', () => {
    const design = new EditorDocument(GUNSHIP).view.design!;
    const demo = new Demonstration();
    const thruster = design.modules.findIndex((m) => m.spec.kind === 'thruster');
    for (let i = 0; i < 120; i++) demo.step(design, [design.modules[thruster]!.index], 1 / 60);
    const snapshot = previewSnapshot(design);
    demo.writeInto(snapshot);
    expect(snapshot.ships[0]!.throttles.filter((t) => t > 0)).toHaveLength(1);
  });

  it('fires a selected gun at the rate its own figures claim', () => {
    const design = popgun();
    const turret = design.turrets[0]!;
    const cycle = turret.gun.cycleTime;
    // The assumption the count rests on: a round outlives three cycles, so
    // none has been forgotten by the time they are counted.
    expect(cycle * 3.5).toBeLessThan(ROUND_LIFETIME);

    const demo = new Demonstration();
    const selected = [design.modules[turret.module]!.index];
    for (let t = 0; t < cycle * 3.5; t += 1 / 240) demo.step(design, selected, 1 / 240);

    const snapshot = previewSnapshot(design);
    demo.writeInto(snapshot);
    // One at the start and one per cycle since.
    expect(snapshot.projectileCount).toBe(4);
    expect(demo.running).toBe(true);
  });

  it('sends rounds out at the muzzle speed, and forgets them in the end', () => {
    const design = popgun();
    const turret = design.turrets[0]!;
    const demo = new Demonstration();
    demo.step(design, [design.modules[turret.module]!.index], 1 / 240);

    const snapshot = previewSnapshot(design);
    demo.writeInto(snapshot);
    expect(snapshot.projectileCount).toBe(1);
    const speed = Math.hypot(snapshot.projectileVx[0]!, snapshot.projectileVy[0]!);
    expect(speed).toBeCloseTo(turret.gun.muzzleSpeed, 6);
    expect(snapshot.projectileWidth[0]).toBe(turret.gun.calibre);

    // Nothing stops a round, so it has to be forgotten or it accumulates.
    for (let t = 0; t < ROUND_LIFETIME + 1; t += 1 / 60) demo.step(design, [], 1 / 60);
    demo.writeInto(snapshot);
    expect(snapshot.projectileCount).toBe(0);
    expect(demo.running).toBe(false);
  });

  /** A beam mount, to show the other branch of `fire`. */
  const beamBoat = (): ShipDesign =>
    new EditorDocument(
      ship({
        modules: [
          { kind: 'structure', x: 0, y: 0, length: 20, width: 6 },
          { kind: 'beamTurret', x: 11, y: 0, length: 4, width: 3 },
          { kind: 'thruster', x: -11, y: 0, angle: 0, length: 2, width: 6 },
        ],
      }),
    ).view.design!;

  it('lights a selected beam mount, and lets the renderer know it is there', () => {
    // Every array reaching the snapshot with the count left at zero draws
    // exactly nothing, which is indistinguishable from a gun that never fired.
    const design = beamBoat();
    const turret = design.turrets[0]!;
    expect(turret.gun.type).toBe(GunType.Beam);
    const demo = new Demonstration();

    demo.step(design, [design.modules[turret.module]!.index], 1 / 240);

    const snapshot = previewSnapshot(design);
    demo.writeInto(snapshot);
    expect(snapshot.beamCount).toBe(1);
    expect(snapshot.projectileCount).toBe(0);
    expect(snapshot.beamWidth[0]).toBe(turret.gun.calibre);
    expect(snapshot.beamPower[0]).toBe(turret.gun.beamPower);
  });

  it('runs a beam from the muzzle outward, rather than from the origin', () => {
    // Both ends are positions. Writing the heading into `end` instead draws a
    // beam from the muzzle to a point measured from the world origin, which
    // points somewhere else entirely and is the wrong length besides.
    const design = beamBoat();
    const turret = design.turrets[0]!;
    const demo = new Demonstration();
    demo.step(design, [design.modules[turret.module]!.index], 1 / 240);

    const snapshot = previewSnapshot(design);
    demo.writeInto(snapshot);
    const dx = snapshot.beamEndX[0]! - snapshot.beamStartX[0]!;
    const dy = snapshot.beamEndY[0]! - snapshot.beamStartY[0]!;
    expect(Math.hypot(dx, dy)).toBeCloseTo(MAX_BEAM_LENGTH, 6);
    // The mount rests along the hull's +x, so the beam leaves that way.
    expect(dx).toBeCloseTo(MAX_BEAM_LENGTH, 6);
    expect(dy).toBeCloseTo(0, 6);
    // And it starts at the muzzle, out beyond the mount's own centre.
    expect(snapshot.beamStartX[0]).toBeCloseTo(
      design.centreOfMassX + turret.mount.x + turret.gun.barrelLength,
      6,
    );
  });

  it('holds a beam for its dwell and then drops it', () => {
    // A beam is not in flight; it is lit while the mount holds the trigger.
    // Removing it the frame it appears leaves nothing on screen at all.
    const design = beamBoat();
    const turret = design.turrets[0]!;
    const dwell = turret.gun.beamOnTime;
    expect(dwell).toBeGreaterThan(0);
    const demo = new Demonstration();
    const selected = [design.modules[turret.module]!.index];
    const snapshot = previewSnapshot(design);

    // Most of the way through the dwell, it is still lit.
    for (let t = 0; t < dwell * 0.9; t += 1 / 240) demo.step(design, selected, 1 / 240);
    demo.writeInto(snapshot);
    expect(snapshot.beamCount).toBe(1);

    // Deselected, it goes out once the dwell runs down rather than persisting.
    for (let t = 0; t < dwell * 1.2; t += 1 / 240) demo.step(design, [], 1 / 240);
    demo.writeInto(snapshot);
    expect(snapshot.beamCount).toBe(0);
    expect(demo.running).toBe(false);
  });

  it('alternates between the barrels of a multi-barrel mount', () => {
    const design = popgun();
    const turret = design.turrets[0]!;
    expect(turret.gun.barrelCount).toBe(2);
    const demo = new Demonstration();
    const selected = [design.modules[turret.module]!.index];
    for (let t = 0; t < turret.gun.cycleTime * 1.5; t += 1 / 240) demo.step(design, selected, 1 / 240);

    const snapshot = previewSnapshot(design);
    demo.writeInto(snapshot);
    expect(snapshot.projectileCount).toBe(2);
    // Two rounds from two barrels leave from different places across the mount.
    expect(snapshot.projectileY[0]).not.toBe(snapshot.projectileY[1]);
  });
});
