import { describe, expect, it } from 'vitest';
import {
  expandBlueprint,
  expandWithOrigins,
  math,
  radiansToDegrees as toDegrees,
  moduleStats,
  placementAt,
  samePlacement,
  parseBlueprint,
  serialiseBlueprint,
  type Blueprint,
  type ModulePath,
  type ModuleSpec,
  type Placement,
  type ShipDesign,
} from '../sim/index.js';
import { CORVETTE, GUNSHIP } from '../scenarios/blueprints.js';
import { EditorDocument } from '../editor/document.js';
import {
  addModule,
  addToGroup,
  addToGroupProblem,
  cloneBlueprint,
  duplicateInstance,
  duplicatePlacement,
  groupPlacements,
  groupProblem,
  instanceHandle,
  instanceOf,
  setMirror,
  setRepetition,
  extentAlong,
  toPlacementAngle,
  positionHandle,
  removeCopy,
  unlinkable,
  unlinkPlacement,
  moduleAt,
  movePlacement,
  removePlacement,
  renameAssembly,
  renameProblem,
  snap,
  toPlacementFrame,
  updatePlacement,
} from '../editor/edit.js';
import { emptyBlueprint, Library, toFileText, type KeyValueStore } from '../editor/library.js';
import { Demonstration, ROUND_LIFETIME } from '../editor/demonstrate.js';
import { MAX_BEAM_LENGTH } from '../sim/beams.js';
import { GunType } from '../sim/modules.js';
import {
  facingTo,
  handleAt,
  handlesFor,
  HANDLE_GRAB_PX,
  MIN_SIZE,
  ROTATE_ARM_PX,
  sizedTo,
} from '../editor/handles.js';
import { previewSnapshot } from '../editor/preview.js';
import { designStats, envelopes, groupMass, headingCost, moduleReadout } from '../editor/stats.js';

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

  it('says which drawn modules the problems are about', () => {
    const doc = new EditorDocument(CORVETTE);
    expect(doc.view.faulty).toEqual([]);

    // Dragged clear of the ship: the module is adrift, and the canvas has to
    // be able to say which one without the player counting down the list.
    const origin = doc.view.origins[1]!;
    doc.apply(movePlacement(doc.blueprint, origin, 500, 500)!);
    expect(doc.view.faulty).toContain(1);
    expect(doc.view.problems.some((p) => /touches nothing|separate piece/.test(p))).toBe(true);

    doc.undo();
    expect(doc.view.faulty).toEqual([]);
  });

  it('flags every copy of a shared part that is at fault', () => {
    // One placement, several drawn modules: the mistake is made once and shown
    // everywhere it lands, the same way the selection highlight works.
    const doc = new EditorDocument(GUNSHIP);
    expect(doc.view.faulty).toEqual([]);
    const drawn = doc.view.modules.length;
    doc.apply({
      ...doc.blueprint,
      assemblies: {
        ...doc.blueprint.assemblies,
        pod: { modules: [{ kind: 'structure', x: 0, y: 0, length: 4, width: 4 }] },
      },
      modules: [
        ...doc.blueprint.modules,
        { use: 'pod', x: 400, y: 0 },
        { use: 'pod', x: 400, y: 80 },
      ],
    });
    expect(doc.view.faulty).toEqual([drawn, drawn + 1]);
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

describe('the handles on a selected module', () => {
  // A box 8 long and 4 wide at the origin, square to the world: its corners
  // are at (±4, ±2) and there is no frame conversion in the way of reading
  // them.
  const box: ModuleSpec = { kind: 'structure', x: 0, y: 0, length: 8, width: 4 };

  it('puts one on each corner, and the knob beyond the bow', () => {
    const handles = handlesFor(box, 10);
    expect(handles.filter((handle) => handle.kind === 'size')).toHaveLength(4);
    expect(handles.slice(0, 4).map((h) => [h.x, h.y])).toEqual([
      [4, 2],
      [4, -2],
      [-4, -2],
      [-4, 2],
    ]);
    // Beyond the +x face, which is the way the module points, and standing off
    // it by a fixed number of pixels rather than metres.
    expect(handles[4]).toMatchObject({ kind: 'rotate', y: 0 });
    expect(handles[4]!.x).toBeCloseTo(4 + ROTATE_ARM_PX / 10, 12);
  });

  it('turns with the module', () => {
    const turned = handlesFor({ ...box, angle: math.HALF_PI }, 10);
    // A quarter turn anticlockwise: the bow corner goes to +y.
    expect(turned[0]!.x).toBeCloseTo(-2, 12);
    expect(turned[0]!.y).toBeCloseTo(4, 12);
    expect(turned[4]!.y).toBeCloseTo(4 + ROTATE_ARM_PX / 10, 12);
  });

  it('is grabbed within a few pixels of it, whatever the zoom', () => {
    const scale = 10;
    const handles = handlesFor(box, scale);
    const near = (HANDLE_GRAB_PX - 1) / scale;
    expect(handleAt(handles, 4, 2, scale)).toBe(0);
    expect(handleAt(handles, 4 + near, 2, scale)).toBe(0);
    expect(handleAt(handles, 4 + (HANDLE_GRAB_PX + 1) / scale, 2, scale)).toBe(-1);
    // The reach is in pixels, so zooming out shrinks it in metres: the same
    // point in the world is no longer on the handle.
    expect(handleAt(handles, 4 + near, 2, scale * 4)).toBe(-1);
  });

  it('takes the nearest when two are in reach', () => {
    // A module small enough that its corners are within a grab of each other.
    const small: ModuleSpec = { kind: 'structure', x: 0, y: 0, length: 1, width: 1 };
    const handles = handlesFor(small, 4);
    expect(handleAt(handles, 0.5, 0.4, 4)).toBe(0);
    expect(handleAt(handles, 0.5, -0.4, 4)).toBe(1);
  });
});

describe('sizing a module by a corner', () => {
  const box: ModuleSpec = { kind: 'structure', x: 3, y: -2, length: 8, width: 4 };

  it('sizes about the centre, so the module stays where it is', () => {
    // The corner dragged two metres out along each axis: the box grows by four
    // in each, because the opposite corner moves with it.
    expect(sizedTo(box, 3 + 6, -2 + 4, 0.5)).toEqual({ length: 12, width: 8 });
  });

  it('measures in the module’s own frame', () => {
    const turned = { ...box, angle: math.HALF_PI };
    // Along the module's length is now along the world's +y.
    expect(sizedTo(turned, 3, -2 + 6, 0.5)).toEqual({ length: 12, width: 0.5 });
  });

  it('snaps to the grid, and Alt escapes it', () => {
    expect(sizedTo(box, 3 + 3.1, -2, 0.5)).toMatchObject({ length: 6 });
    expect(sizedTo(box, 3 + 3.1, -2, 0).length).toBeCloseTo(6.2, 12);
  });

  it('will not go below the smallest a module may be', () => {
    expect(sizedTo(box, 3, -2, 0.5)).toEqual({ length: MIN_SIZE, width: MIN_SIZE });
  });
});

describe('turning a module by its knob', () => {
  const box: ModuleSpec = { kind: 'structure', x: 2, y: 2, length: 8, width: 4 };

  it('points the module at the pointer, snapped', () => {
    expect(facingTo(box, 12, 2, 15)).toBeCloseTo(0, 12);
    expect(facingTo(box, 2, 12, 15)).toBeCloseTo(math.HALF_PI, 12);
    // 40° from the module, which is nearest to 45.
    expect(toDegrees(facingTo(box, 2 + 10, 2 + 8.4, 15))).toBeCloseTo(45, 9);
  });

  it('lands on angles somebody could have typed', () => {
    // Snapped in degrees rather than radians: rounding in radians and
    // converting back produces -74.99999999999999, which then appears in the
    // box and in the file.
    expect(String(toDegrees(facingTo(box, 2 + 1, 2 - 3.6, 15)))).toBe('-75');
  });

  it('gives the bearing itself when the snap is escaped', () => {
    expect(toDegrees(facingTo(box, 2 + 10, 2 + 8.4, 0))).toBeCloseTo(40.03, 1);
  });

  it('is written in the frame the module was written in', () => {
    // A module in a mirrored group is drawn turned one way and written the
    // other, so a knob dragged clockwise on screen writes an anticlockwise
    // facing.
    const origin = { path: [], rotation: 0, mirrored: true, instanceFrame: null };
    expect(toPlacementAngle(origin, math.HALF_PI)).toBeCloseTo(-math.HALF_PI, 12);
    const turned = { path: [], rotation: math.HALF_PI, mirrored: false, instanceFrame: null };
    expect(toPlacementAngle(turned, math.HALF_PI)).toBeCloseTo(0, 12);
  });
});

describe('repeating a group', () => {
  const wing = { modules: [{ kind: 'structure', x: 0, y: 0, length: 4, width: 4 } as const] };
  const bp = ship({ assemblies: { wing }, modules: [hull, { use: 'wing', x: 12, y: 0 }] });
  const path = [{ index: 1, copy: 0 }];

  it('sets the count and the step together', () => {
    const next = setRepetition(bp, path, 3, { x: 4, y: 0 })!;
    expect(positions(next)).toEqual([
      [0, 0],
      [12, 0],
      [16, 0],
      [20, 0],
    ]);
  });

  it('takes the step away again when it drops back to one copy', () => {
    // A count of one with a step left behind is a layout the parser refuses,
    // so the two have to leave together.
    const repeated = setRepetition(bp, path, 3, { x: 4, y: 0 })!;
    const once = setRepetition(repeated, path, 1, { x: 4, y: 0 })!;
    expect(once.modules[1]).not.toHaveProperty('repeat');
    expect(once.modules[1]).not.toHaveProperty('step');
    expect(positions(once)).toEqual(positions(bp));
  });

  it('walks the copies round an arc when the step turns', () => {
    const arc = setRepetition(bp, path, 2, { x: 4, y: 0, angle: math.HALF_PI })!;
    const drawn = expandWithOrigins(arc).modules;
    expect(drawn[2]!.angle).toBeCloseTo(math.HALF_PI, 12);
  });

  it('refuses a placement that is not a group', () => {
    expect(setRepetition(bp, [{ index: 0, copy: 0 }], 3, { x: 4, y: 0 })).toBeNull();
  });
});

describe('how far a group reaches', () => {
  it('measures the whole of what it covers, along a direction', () => {
    const specs: ModuleSpec[] = [
      { kind: 'structure', x: 0, y: 0, length: 4, width: 2 },
      { kind: 'structure', x: 6, y: 0, length: 4, width: 2 },
    ];
    // Two 4 m boxes with their centres 6 m apart: 10 m from end to end.
    expect(extentAlong(specs, 0)).toBeCloseTo(10, 12);
    // Across the row, both boxes are only as wide as one.
    expect(extentAlong(specs, math.HALF_PI)).toBeCloseTo(2, 12);
  });

  it('measures a turned module by what it actually covers', () => {
    const specs: ModuleSpec[] = [{ kind: 'structure', x: 0, y: 0, length: 4, width: 2, angle: math.HALF_PI }];
    expect(extentAlong(specs, 0)).toBeCloseTo(2, 12);
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

describe('grouping modules into an assembly', () => {
  /** A wing: a root that joins it to the hull, and two things hanging off it. */
  const wing = (): Blueprint =>
    ship({
      modules: [
        hull,
        { kind: 'structure', x: 0, y: 6, length: 4, width: 6 },
        { kind: 'turret', x: 4, y: 9, length: 4, width: 3, barrels: 1 },
        { kind: 'thruster', x: -4, y: 9, angle: 0, length: 3, width: 3 },
      ],
    });

  /** Pick the drawn modules at these indices, in this order. */
  function pick(doc: EditorDocument, ...indices: number[]) {
    doc.selectModule(indices[0]!);
    for (const index of indices.slice(1)) doc.toggleModule(index);
    return doc.selectedOrigins();
  }

  it('refuses a selection it cannot make a group out of', () => {
    const doc = new EditorDocument(wing());
    expect(groupProblem(doc.blueprint, pick(doc, 1))).toMatch(/two or more/);

    const grouped = groupPlacements(doc.blueprint, pick(doc, 1, 2))!;
    const after = new EditorDocument(grouped.blueprint);
    // The hull is written in the layout; the wing's modules are now written
    // inside the assembly, so the two are not in the same list.
    const across = pick(after, 0, after.view.modules.length - 1);
    expect(groupProblem(after.blueprint, across)).toMatch(/same group/);
  });

  it('builds the group around the first module picked', () => {
    // Not the centre of the selection: a wing hangs off one connecting module,
    // and that module is the one whose position means something.
    const doc = new EditorDocument(wing());
    const grouped = groupPlacements(doc.blueprint, pick(doc, 1, 2, 3))!;
    const assemblies = grouped.blueprint.assemblies!;
    const definition = Object.values(assemblies)[0]!;

    expect(Object.keys(assemblies)).toHaveLength(1);
    // The root was picked first, so it sits at the assembly's origin and the
    // instance carries where that origin lands.
    expect(definition.modules[0]).toMatchObject({ kind: 'structure', x: 0, y: 0 });
    const instance = grouped.blueprint.modules[grouped.blueprint.modules.length - 1]!;
    expect(instance).toMatchObject({ x: 0, y: 6 });
  });

  it('puts the same ship back, in the same places', () => {
    // The whole safety property: grouping is a change to how a layout is
    // *written* and not to what it builds, so every module comes out where it
    // went in. Order is the one thing that moves, and it moves knowingly.
    const before = wing();
    const doc = new EditorDocument(before);
    const grouped = groupPlacements(before, pick(doc, 1, 2, 3))!;

    expect(positions(grouped.blueprint).sort()).toEqual(positions(before).sort());
    expect(expandBlueprint(grouped.blueprint)).toHaveLength(expandBlueprint(before).length);
  });

  it('keeps the members in the order they were written, not the order picked', () => {
    // Clicked back to front. Inside the group they stay as the file had them,
    // so the group's own internals are as close to the original as they can be.
    const doc = new EditorDocument(wing());
    const grouped = groupPlacements(doc.blueprint, pick(doc, 3, 2, 1))!;
    const definition = Object.values(grouped.blueprint.assemblies!)[0]!;
    expect(definition.modules.map((m) => (m as ModuleSpec).kind)).toEqual([
      'structure',
      'turret',
      'thruster',
    ]);
    // The thruster was picked first, so it is the origin even though it is
    // written last.
    expect(definition.modules[2]).toMatchObject({ x: 0, y: 0 });
  });

  it('appends the instance, which moves the group down the firing order', () => {
    // Stated because it is a real consequence and not a detail: thrusters are
    // allocated over the columns in order and turrets fire in order, so a
    // layout that depended on the old order flies slightly differently.
    const doc = new EditorDocument(wing());
    const grouped = groupPlacements(doc.blueprint, pick(doc, 1, 2))!;
    const last = grouped.blueprint.modules[grouped.blueprint.modules.length - 1]!;
    expect('use' in last).toBe(true);
    // The hull, untouched, keeps its place at the front.
    expect(grouped.blueprint.modules[0]).toMatchObject({ length: 20, width: 6 });
  });

  it('selects the new group, so its pose can be edited straight away', () => {
    const doc = new EditorDocument(wing());
    const grouped = groupPlacements(doc.blueprint, pick(doc, 1, 2))!;
    doc.apply(grouped.blueprint);
    doc.select(grouped.path);
    const placement = doc.selectedPlacement!;
    expect(placement).not.toBeNull();
    expect('use' in placement).toBe(true);
  });
});

describe('mirroring a group', () => {
  const wing = (): Blueprint =>
    ship({
      modules: [
        hull,
        { kind: 'structure', x: 0, y: 6, length: 4, width: 6 },
        { kind: 'turret', x: 4, y: 9, length: 4, width: 3, barrels: 1 },
      ],
    });

  it('reaches the instance from a module inside it', () => {
    // Clicking a module selects the module; the pose belongs to the instance
    // above it, and without this there is no way to get there.
    const doc = new EditorDocument(wing());
    doc.selectModule(1);
    doc.toggleModule(2);
    const grouped = groupPlacements(doc.blueprint, doc.selectedOrigins())!;
    doc.apply(grouped.blueprint);

    const inside = doc.view.origins.findIndex((o) => o.path.length > 1);
    expect(inside).toBeGreaterThanOrEqual(0);
    doc.selectModule(inside);
    const path = instanceOf(doc.selectedOrigin()!)!;
    expect(path).not.toBeNull();
    const placement = placementAt(doc.blueprint, path)!;
    expect('use' in placement).toBe(true);
  });

  it('reflects a placed group, and stops reflecting it again', () => {
    const doc = new EditorDocument(wing());
    doc.selectModule(1);
    doc.toggleModule(2);
    const grouped = groupPlacements(doc.blueprint, doc.selectedOrigins())!;

    const mirrored = setMirror(grouped.blueprint, grouped.path, true)!;
    const turret = expandBlueprint(mirrored).find((m) => m.kind === 'turret')!;
    const wasAt = expandBlueprint(grouped.blueprint).find((m) => m.kind === 'turret')!;
    // Reflected across the instance's own x-axis: the turret was 3 m outboard
    // of the wing root, and is now 3 m the other way.
    expect(turret.x).toBeCloseTo(wasAt.x, 9);
    expect(turret.y - 6).toBeCloseTo(-(wasAt.y - 6), 9);

    const back = setMirror(mirrored, grouped.path, false)!;
    expect(expandBlueprint(back).map((m) => [m.x, m.y])).toEqual(
      expandBlueprint(grouped.blueprint).map((m) => [m.x, m.y]),
    );
    // Cleared rather than written false, so a layout that was never mirrored
    // round-trips through the file unchanged.
    expect('mirror' in (back.modules[back.modules.length - 1] as object)).toBe(false);
  });

  it('keeps a group selected through an edit to the group itself', () => {
    // An instance draws nothing of its own — its assembly's modules do — so a
    // "does this still draw anything" test that only asked which placement
    // wrote each module called every group selection dead. The panel would
    // then close on the first edit made from it, which is the one moment it
    // must not.
    const doc = new EditorDocument(wing());
    doc.selectModule(1);
    doc.toggleModule(2);
    const grouped = groupPlacements(doc.blueprint, doc.selectedOrigins())!;
    doc.apply(grouped.blueprint);
    doc.select(grouped.path);
    expect(doc.selectedPlacement).not.toBeNull();

    doc.apply(setMirror(doc.blueprint, doc.selection!, true)!);

    expect(doc.selection).not.toBeNull();
    const still = doc.selectedPlacement!;
    expect('use' in still).toBe(true);
    expect((still as { mirror?: boolean }).mirror).toBe(true);
    // And it accounts for the modules it placed, which is what the highlight
    // and the panel's own count both read.
    expect(doc.accountedFor(doc.selection!)).toBe(2);
    expect(doc.highlightedModules()).toHaveLength(2);
  });

  it('forgets a group that an edit removed', () => {
    // The other half of the same rule: still gone when it is genuinely gone.
    const doc = new EditorDocument(wing());
    doc.selectModule(1);
    doc.toggleModule(2);
    const grouped = groupPlacements(doc.blueprint, doc.selectedOrigins())!;
    doc.apply(grouped.blueprint);
    doc.select(grouped.path);

    doc.apply(removePlacement(doc.blueprint, doc.selection!)!);

    expect(doc.selection).toBeNull();
  });

  it('builds a symmetrical ship out of one side and a reflection', () => {
    // The workflow this exists for. Draw one wing, group it, place the group
    // again reflected, and the two sides cannot drift apart.
    const doc = new EditorDocument(wing());
    doc.selectModule(1);
    doc.toggleModule(2);
    const grouped = groupPlacements(doc.blueprint, doc.selectedOrigins())!;

    // Place it again, and reflect the copy. Three operations, which is the
    // whole workflow.
    const placed = duplicateInstance(grouped.blueprint, grouped.path)!;
    const ship2 = setMirror(placed.blueprint, placed.path, true)!;

    // One definition serving both sides is the property that makes them unable
    // to disagree: there is nowhere for a difference to be written.
    expect(Object.keys(ship2.assemblies!)).toHaveLength(1);
    const turrets = expandBlueprint(ship2).filter((m) => m.kind === 'turret');
    expect(turrets).toHaveLength(2);
    expect(turrets[0]!.x).toBeCloseTo(turrets[1]!.x, 9);
    expect(turrets[0]!.y).not.toBeCloseTo(turrets[1]!.y, 3);

    // And widening the wing root widens it on both sides at once, which is the
    // thing a mirrored *mode* could only keep in step by watching for it.
    const root = expandWithOrigins(ship2).origins.findIndex((o) => o.path.length > 1);
    const wider = updatePlacement(ship2, expandWithOrigins(ship2).origins[root]!.path, (p) => ({
      ...(p as ModuleSpec),
      width: 10,
    }))!;
    const widened = expandBlueprint(wider).filter((m) => m.kind === 'structure' && m.width === 10);
    expect(widened).toHaveLength(2);
  });
});

describe('picking several modules', () => {
  const three = (): Blueprint =>
    ship({
      modules: [
        hull,
        { kind: 'structure', x: 0, y: 6, length: 4, width: 4 },
        { kind: 'structure', x: 0, y: -6, length: 4, width: 4 },
      ],
    });

  it('adds to the selection, and takes back out again', () => {
    const doc = new EditorDocument(three());
    doc.selectModule(0);
    expect(doc.selections).toHaveLength(1);
    doc.toggleModule(1);
    expect(doc.selections).toHaveLength(2);
    doc.toggleModule(1);
    expect(doc.selections).toHaveLength(1);
  });

  it('keeps the order they were picked in, because the first one is the origin', () => {
    const doc = new EditorDocument(three());
    doc.selectModule(2);
    doc.toggleModule(0);
    const origins = doc.selectedOrigins();
    expect(origins).toHaveLength(2);
    expect(origins[0]!.path[0]!.index).toBe(2);
    expect(origins[1]!.path[0]!.index).toBe(0);
  });

  it('highlights every copy of everything picked', () => {
    // A shared part picked once is drawn several times, and all of them are
    // the selection — the placement is what was picked.
    const doc = new EditorDocument(GUNSHIP);
    doc.selectModule(0);
    const first = doc.highlightedModules().length;
    const other = doc.view.origins.findIndex((_, i) => !doc.highlightedModules().includes(i));
    doc.toggleModule(other);
    expect(doc.highlightedModules().length).toBeGreaterThan(first);
  });

  it('drops only what an edit removed, keeping the rest picked', () => {
    const doc = new EditorDocument(three());
    doc.selectModule(1);
    doc.toggleModule(2);
    const removed = removePlacement(doc.blueprint, doc.selections[0]!)!;
    doc.apply(removed);
    expect(doc.selections).toHaveLength(1);
  });

  it('replaces the selection on a plain pick', () => {
    const doc = new EditorDocument(three());
    doc.selectModule(0);
    doc.toggleModule(1);
    doc.selectModule(2);
    expect(doc.selections).toHaveLength(1);
  });
});

describe('clicking a grouped module', () => {
  /** A hull, and a wing of two modules grouped and placed twice. */
  function twoWings(): { doc: EditorDocument; group: ModulePath } {
    const doc = new EditorDocument(
      ship({
        modules: [
          hull,
          { kind: 'structure', x: 0, y: 6, length: 4, width: 6 },
          { kind: 'turret', x: 4, y: 9, length: 4, width: 3, barrels: 1 },
        ],
      }),
    );
    doc.selectModule(1);
    doc.toggleModule(2);
    const grouped = groupPlacements(doc.blueprint, doc.selectedOrigins())!;
    doc.apply(grouped.blueprint);
    const placed = duplicateInstance(doc.blueprint, grouped.path)!;
    doc.apply(setMirror(placed.blueprint, placed.path, true)!);
    doc.select(null);
    return { doc, group: grouped.path };
  }

  /** The first drawn module that came through an assembly. */
  function inAGroup(doc: EditorDocument): number {
    const at = doc.view.origins.findIndex((o) => o.path.length > 1);
    expect(at).toBeGreaterThanOrEqual(0);
    return at;
  }

  it('selects the group, not the module', () => {
    // A grouped module is part of a thing before it is a module, and the thing
    // is what you usually want: dragging a wing should move the wing.
    const { doc } = twoWings();
    const index = inAGroup(doc);

    doc.selectAt(index, doc.resolveClick(index));

    const placement = doc.selectedPlacement!;
    expect('use' in placement).toBe(true);
  });

  it('goes in a level when the group is already selected', () => {
    const { doc } = twoWings();
    const index = inAGroup(doc);
    doc.selectAt(index, doc.resolveClick(index));

    doc.selectAt(index, doc.resolveClick(index));

    const placement = doc.selectedPlacement!;
    expect('use' in placement).toBe(false);
    expect((placement as ModuleSpec).kind).toBeDefined();
  });

  it('reaches a sibling directly once you are inside the group', () => {
    // Otherwise working on a wing means clicking twice for every part of it,
    // being thrown back out to the wing each time.
    const { doc } = twoWings();
    const inside = doc.view.origins
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => o.path.length > 1);
    const first = inside[0]!.i;
    const sibling = inside.find(({ o }) => !samePlacement(o.path, inside[0]!.o.path))!.i;

    doc.selectAt(first, doc.resolveClick(first));
    doc.selectAt(first, doc.resolveClick(first));
    doc.selectAt(sibling, doc.resolveClick(sibling));

    const placement = doc.selectedPlacement!;
    expect('use' in placement).toBe(false);
  });

  it('selects a loose module directly, having no group to stop at', () => {
    const { doc } = twoWings();
    const loose = doc.view.origins.findIndex((o) => o.path.length === 1);
    doc.selectAt(loose, doc.resolveClick(loose));
    expect('use' in doc.selectedPlacement!).toBe(false);
  });

  it('tells a selected group apart from several picked modules', () => {
    // What the overlay draws from: a group is outlined as a group, several
    // modules separately, and reading it off the selection means the picture
    // cannot disagree with what an edit would do.
    const { doc } = twoWings();
    const index = inAGroup(doc);
    doc.selectAt(index, doc.resolveClick(index));

    const groups = doc.selectedGroups();
    expect(groups.every((group) => group.context)).toBe(false);
    expect(groups.find((group) => group.primary)!.modules).toHaveLength(2);
    expect(doc.selectedLoose()).toHaveLength(0);

    doc.selectModule(0);
    doc.toggleModule(1);
    // Loose modules: any box drawn is the group one of them sits in, which is
    // context rather than the selection.
    expect(doc.selectedGroups().every((group) => group.context)).toBe(true);
    expect(doc.selectedLoose().length).toBeGreaterThan(1);
  });

  it('boxes every copy of the selected group, the clicked one as the selection', () => {
    // A group placed twice is two things in two places: one box round both
    // would enclose most of the ship, and the copies a drag would leave alone
    // have to look different from the one it would move.
    const { doc } = twoWings();
    const index = inAGroup(doc);
    doc.selectAt(index, doc.resolveClick(index));

    const groups = doc.selectedGroups();
    expect(groups).toHaveLength(2);
    expect(groups.filter((group) => group.primary)).toHaveLength(1);
    expect(groups.find((group) => group.primary)!.modules).toContain(index);
    // No module is boxed twice: each copy holds its own.
    const all = groups.flatMap((group) => group.modules);
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps the group’s box while a module inside it is selected', () => {
    const { doc } = twoWings();
    const index = inAGroup(doc);
    doc.selectAt(index, doc.resolveClick(index));
    doc.selectAt(index, doc.resolveClick(index));

    expect('use' in doc.selectedPlacement!).toBe(false);
    const groups = doc.selectedGroups();
    expect(groups.length).toBeGreaterThan(0);
    // Context, not selection: nothing is drawn as the thing being edited.
    expect(groups.every((group) => group.context && !group.primary)).toBe(true);
    expect(groups.some((group) => group.modules.includes(index))).toBe(true);
  });

  it('drags the whole group, in the frame the instance was written in', () => {
    const { doc } = twoWings();
    const index = inAGroup(doc);
    doc.selectAt(index, doc.resolveClick(index));
    const group = doc.selectedGroupPath()!;
    const handle = instanceHandle(doc.view.origins, group)!;
    expect(handle).not.toBeNull();

    const before = expandBlueprint(doc.blueprint).map((m) => [m.x, m.y]);
    const moved = movePlacement(doc.blueprint, handle, 3, 0)!;
    const after = expandBlueprint(moved).map((m) => [m.x, m.y]);

    // Only the modules this copy of the group placed have moved, and all of
    // them have, together and by the same amount.
    const shifted = after.filter(([x, y], i) => x !== before[i]![0] || y !== before[i]![1]);
    expect(shifted).toHaveLength(2);
    for (let i = 0; i < after.length; i++) {
      const dx = after[i]![0] - before[i]![0];
      expect(dx === 0 || Math.abs(dx - 3) < 1e-9).toBe(true);
    }
  });
});

describe('adding modules to a group', () => {
  function wingAndSpare(): { doc: EditorDocument; group: ModulePath } {
    const doc = new EditorDocument(
      ship({
        modules: [
          hull,
          { kind: 'structure', x: 0, y: 6, length: 4, width: 6 },
          { kind: 'turret', x: 4, y: 9, length: 4, width: 3, barrels: 1 },
          // The spare, written alongside and added later.
          { kind: 'thruster', x: -6, y: 6, angle: 0, length: 3, width: 3 },
        ],
      }),
    );
    doc.selectModule(1);
    doc.toggleModule(2);
    const grouped = groupPlacements(doc.blueprint, doc.selectedOrigins())!;
    doc.apply(grouped.blueprint);
    return { doc, group: grouped.path };
  }

  it('refuses what it cannot add', () => {
    const { doc, group } = wingAndSpare();
    expect(addToGroupProblem(doc.blueprint, group, [])).toMatch(/some modules/);
    // A group cannot be put inside a group here, which would nest.
    expect(addToGroupProblem(doc.blueprint, group, [group])).toMatch(/not other groups/);
  });

  it('moves the module into the definition, leaving the ship where it was', () => {
    const { doc, group } = wingAndSpare();
    const spare = doc.view.origins.findIndex(
      (_, i) => doc.view.modules[i]!.kind === 'thruster',
    );
    const before = positions(doc.blueprint).sort();

    const added = addToGroup(doc.blueprint, group, [doc.view.origins[spare]!.path])!;
    const next = added.blueprint;

    expect(positions(next).sort()).toEqual(before);
    const definition = Object.values(next.assemblies!)[0]!;
    expect(definition.modules).toHaveLength(3);
    // Out of the layout's own list, into the group's.
    expect(next.modules).toHaveLength(2);
    // The group moved up the list as the module left it, so the path handed
    // back has to be the one that still names it.
    expect(placementAt(next, added.path)).toHaveProperty('use');
  });

  it('re-expresses the module through a turned and mirrored group', () => {
    // The whole reason this is not a list operation. A module is written in the
    // parent's frame and the group's are written in the group's, so getting the
    // transform wrong moves the ship — and only on a posed group, which is
    // exactly the kind that gets built once and trusted.
    const { doc, group } = wingAndSpare();
    const posed = setMirror(
      updatePlacement(doc.blueprint, group, (p) => ({ ...p, angle: Math.PI / 2 }) as Placement)!,
      group,
      true,
    )!;
    const withSpare = new EditorDocument(posed);
    const spare = withSpare.view.origins.findIndex(
      (_, i) => withSpare.view.modules[i]!.kind === 'thruster',
    );
    const before = positions(posed).sort();

    const next = addToGroup(posed, group, [withSpare.view.origins[spare]!.path])!.blueprint;

    expect(positions(next).sort()).toEqual(before);
  });

  it('gives every copy of the group the new module', () => {
    // The bargain rather than a surprise: the part joins the group, and the
    // group is what is placed twice.
    const { doc, group } = wingAndSpare();
    const twice = duplicateInstance(doc.blueprint, group)!;
    const withSpare = new EditorDocument(twice.blueprint);
    const spare = withSpare.view.origins.findIndex(
      (_, i) => withSpare.view.modules[i]!.kind === 'thruster',
    );
    const thrustersBefore = expandBlueprint(twice.blueprint).filter((m) => m.kind === 'thruster');

    const next = addToGroup(twice.blueprint, group, [withSpare.view.origins[spare]!.path])!.blueprint;

    expect(thrustersBefore).toHaveLength(1);
    expect(expandBlueprint(next).filter((m) => m.kind === 'thruster')).toHaveLength(2);
  });

  it('offers the operation only when one group and some modules are picked', () => {
    const { doc, group } = wingAndSpare();
    doc.select(group);
    expect(doc.groupAndLooseSelection()).toBeNull();

    const spare = doc.view.origins.findIndex((_, i) => doc.view.modules[i]!.kind === 'thruster');
    doc.togglePath(doc.view.origins[spare]!.path);
    const both = doc.groupAndLooseSelection()!;
    expect(both).not.toBeNull();
    expect(both.modules).toHaveLength(1);
  });
});

describe('naming a group', () => {
  /** A layout with two groups, so a name can collide with one that exists. */
  function twoGroups(): { doc: EditorDocument; first: ModulePath; second: ModulePath } {
    const doc = new EditorDocument(
      ship({
        modules: [
          hull,
          { kind: 'structure', x: 0, y: 6, length: 4, width: 6 },
          { kind: 'turret', x: 4, y: 9, length: 4, width: 3, barrels: 1 },
          { kind: 'structure', x: 0, y: -6, length: 4, width: 6 },
          { kind: 'turret', x: 4, y: -9, length: 4, width: 3, barrels: 1 },
        ],
      }),
    );
    doc.selectModule(1);
    doc.toggleModule(2);
    const one = groupPlacements(doc.blueprint, doc.selectedOrigins())!;
    doc.apply(one.blueprint);
    // The other side, which the first grouping left where it was.
    const after = new EditorDocument(doc.blueprint);
    const lower = after.view.modules
      .map((module, i) => ({ module, i }))
      .filter(({ module }) => module.y < -1)
      .map(({ i }) => i);
    after.selectModule(lower[0]!);
    after.toggleModule(lower[1]!);
    const two = groupPlacements(after.blueprint, after.selectedOrigins())!;
    after.apply(two.blueprint);
    // Found afterwards rather than kept: the second grouping took modules out
    // of the same list the first instance sits in, so the path it was made
    // with no longer names it.
    const instances = after.blueprint.modules
      .map((placement, index) => ({ placement, index }))
      .filter(({ placement }) => 'use' in placement)
      .map(({ index }) => [{ index, copy: 0 }] as ModulePath);
    return { doc: after, first: instances[0]!, second: instances[1]! };
  }

  it('renames the definition and every instance that names it', () => {
    const { doc, first } = twoGroups();
    const before = positions(doc.blueprint).sort();
    const next = renameAssembly(doc.blueprint, first, 'port wing')!;

    expect(Object.keys(next.assemblies!)).toContain('port wing');
    expect(placementAt(next, first)).toHaveProperty('use', 'port wing');
    // A `use` left pointing at the old name would place nothing, so the ship
    // itself is the check that both halves of the rename happened.
    expect(positions(next).sort()).toEqual(before);
  });

  it('refuses a name that is blank or already another group’s', () => {
    const { doc, first, second } = twoGroups();
    const taken = (placementAt(doc.blueprint, second) as { use: string }).use;
    expect(renameProblem(doc.blueprint, first, '  ')).toMatch(/needs a name/);
    expect(renameProblem(doc.blueprint, first, taken)).toMatch(/already called/);
    expect(renameAssembly(doc.blueprint, first, taken)).toBeNull();
    // Its own name is not a collision with itself.
    const own = (placementAt(doc.blueprint, first) as { use: string }).use;
    expect(renameProblem(doc.blueprint, first, own)).toBeNull();
  });

  it('is offered for a group and not for a module', () => {
    const { doc } = twoGroups();
    const loose = doc.view.origins[0]!.path;
    expect(renameProblem(doc.blueprint, loose, 'anything')).toMatch(/Only a group/);
  });

  it('keeps the table in order, so a rename is one line of a diff', () => {
    const { doc, first, second } = twoGroups();
    const order = Object.keys(doc.blueprint.assemblies!);
    const at = order.indexOf((placementAt(doc.blueprint, first) as { use: string }).use);
    const next = renameAssembly(doc.blueprint, first, 'nose')!;
    expect(Object.keys(next.assemblies!)[at]).toBe('nose');
    expect(Object.keys(next.assemblies!)).toHaveLength(order.length);
    expect(placementAt(next, second)).toHaveProperty('use', order[1 - at]);
  });
});

describe('what a group weighs', () => {
  it('sums the same masses the ship totals are summed from', () => {
    const parts: ModuleSpec[] = [
      { kind: 'structure', x: 0, y: 6, length: 4, width: 6 },
      { kind: 'turret', x: 4, y: 9, length: 4, width: 3, barrels: 1 },
    ];
    const each = parts.map((spec) => moduleStats(spec).mass);
    expect(groupMass(parts)).toBeCloseTo(each[0]! + each[1]!, 9);
    expect(groupMass([])).toBe(0);
  });
});
