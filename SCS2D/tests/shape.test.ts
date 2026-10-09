import { describe, expect, it } from 'vitest';
import { BASE_WALL_THICKNESS, HULL_DENSITY } from '../sim/modules.js';
import {
  compileBlueprint,
  contactWidth,
  DECK_HEIGHT,
  expandBlueprint,
  HullPath,
  modulesAlong,
  insetTriangle,
  modulesOverlap,
  moduleOutline,
  moduleProblem,
  moduleRadius,
  moduleStats,
  polygonArea,
  refitModule,
  shapeModule,
  triangleAcross,
  triangleBounds,
  triangleOf,
  type Blueprint,
  type ModuleSpec,
} from '../sim/index.js';
import { parseBlueprint, serialiseBlueprint } from '../sim/blueprintFile.js';
import { handlesFor, vertexTo } from '../editor/handles.js';
import { moduleAt } from '../editor/edit.js';

/**
 * Triangular hull and tanks: three corners instead of a box.
 *
 * What is checked here is the invariant the whole feature rests on — the
 * corners are the module, and every law reads them rather than the box they
 * fit inside. A triangle that weighed its bounding box, or that a shot crossed
 * as a rectangle, would be a module the editor draws and the battle does not
 * have.
 */

/**
 * The wedge filling a box of this size, about the box's own middle — the shape
 * the editor starts a module from, and the one `shapeModule` re-centres.
 */
function wedge(length = 2, width = 2): readonly number[] {
  return [length / 2, 0, -length / 2, width / 2, -length / 2, -width / 2];
}

function plate(over: Partial<ModuleSpec> = {}): ModuleSpec {
  return { kind: 'structure', x: 0, y: 0, length: 2, width: 2, ...over };
}

describe('a module given corners', () => {
  it('is centred on their middle, however they were placed', () => {
    const shaped = shapeModule(plate(), [10, 10, 12, 10, 10, 13]);
    expect(shaped).not.toBeNull();
    const corners = shaped!.vertices!;
    expect(corners[0]! + corners[2]! + corners[4]!).toBeCloseTo(0, 8);
    expect(corners[1]! + corners[3]! + corners[5]!).toBeCloseTo(0, 8);
    // Moved onto the corners' own middle, so the corners stayed where they
    // were put: the module's position changed and the shape did not move.
    expect(shaped!.x).toBeCloseTo(32 / 3, 8);
    expect(shaped!.y).toBeCloseTo(11, 8);
  });

  it('keeps length and width as the box they fit inside', () => {
    const shaped = shapeModule(plate(), [0, 0, 6, 0, 0, 3])!;
    expect(shaped.length).toBeCloseTo(6, 9);
    expect(shaped.width).toBeCloseTo(3, 9);
  });

  it('refuses three corners in a line', () => {
    expect(shapeModule(plate(), [0, 0, 1, 1, 2, 2])).toBeNull();
  });

  it('refuses a kind with something sticking out of a face', () => {
    expect(shapeModule(plate({ kind: 'engine' }), wedge())).toBeNull();
    expect(moduleProblem(plate({ kind: 'turret', vertices: wedge() }))).toContain(
      'only structure, tanks and holds',
    );
  });

  it('refuses corners that do not average to the module’s own position', () => {
    expect(moduleProblem(plate({ vertices: [1, 0, 2, 0, 1, 1] }))).toContain('centred');
  });

  it('is squared off to the box its corners fitted, in the place that box was', () => {
    const shaped = shapeModule(plate(), [0, 0, 6, 0, 0, 3])!;
    const squared = shapeModule(shaped, null)!;
    expect(squared.vertices).toBeUndefined();
    expect(squared.length).toBeCloseTo(6, 9);
    expect(squared.width).toBeCloseTo(3, 9);
    // The box's middle, not the triangle's centroid.
    expect(squared.x).toBeCloseTo(3, 9);
    expect(squared.y).toBeCloseTo(1.5, 9);
  });

  it('loses its corners on a refit into a kind that cannot have them', () => {
    const shaped = shapeModule(plate(), wedge())!;
    expect(refitModule(shaped, 'tank').vertices).toBeDefined();
    expect(refitModule(shaped, 'engine').vertices).toBeUndefined();
  });
});

describe('what a triangle weighs', () => {
  const shaped = shapeModule(plate(), wedge(4, 4))!;

  it('encloses half the floor of the box round it', () => {
    expect(polygonArea(triangleOf(shaped)!)).toBeCloseTo(8, 9);
  });

  it('weighs its own walls rather than the box’s', () => {
    const triangle = moduleStats(shaped);
    const box = moduleStats(plate({ length: 4, width: 4 }));
    // Half the floor, so rather less than half the wall: a triangle's corners
    // are sharper than a box's, and the walls take proportionally more of it.
    expect(triangle.capacity).toBeGreaterThan(0);
    expect(triangle.capacity).toBeLessThan(box.capacity * 0.5);
    expect(triangle.structureMass).toBeLessThan(box.structureMass);
    expect(triangle.structureMass).toBeGreaterThan(box.structureMass * 0.4);
  });

  it('weighs what the geometry says, to the kilogram', () => {
    const stats = moduleStats(shaped);
    // The walls are the shape less what the walls leave inside it, on all
    // sides — the box law over a triangle's own floor.
    const inside = insetTriangle(triangleOf(shaped)!, BASE_WALL_THICKNESS)!;
    expect(stats.capacity).toBeCloseTo(polygonArea(inside), 9);
    const walls = 8 * DECK_HEIGHT - stats.capacity * (DECK_HEIGHT - 2 * BASE_WALL_THICKNESS);
    expect(stats.wallVolume).toBeCloseTo(walls, 9);
    expect(stats.structureMass).toBeCloseTo(walls * HULL_DENSITY, 6);
  });

  it('is as deep as its narrowest way through', () => {
    // A long thin wedge is a thin module however far it reaches.
    const sliver = shapeModule(plate(), wedge(40, 1))!;
    expect(triangleAcross(triangleOf(sliver)!)).toBeLessThan(1);
    expect(moduleStats(sliver).thickness).toBeLessThan(1);
  });

  it('turns about its own centroid, not the middle of its box', () => {
    // A triangle and the box round it have the same mass here only by
    // coincidence of the test, so the figures are compared as ratios of mass.
    const triangle = moduleStats(shaped);
    const box = moduleStats(plate({ length: 4, width: 4 }));
    expect(triangle.inertia / triangle.mass).toBeLessThan(box.inertia / box.mass);
    expect(triangle.inertia).toBeGreaterThan(0);
  });
});

describe('what a triangle is to the rest of the simulation', () => {
  const shaped = shapeModule(plate({ x: 10, y: 0 }), wedge(4, 4))!;

  it('reaches as far as its furthest corner', () => {
    const corners: number[] = [];
    const count = moduleOutline(shaped, corners);
    expect(count).toBe(3);
    let furthest = 0;
    for (let i = 0; i < count * 2; i += 2) {
      const dx = corners[i]! - shaped.x;
      const dy = corners[i + 1]! - shaped.y;
      furthest = Math.max(furthest, Math.sqrt(dx * dx + dy * dy));
    }
    expect(moduleRadius(shaped)).toBeCloseTo(furthest, 9);
  });

  // The wedge fills the box the plate was: nose at x = 12, stern across x = 8.
  it('leaves the corners of its box clear', () => {
    // Inside the box round the wedge, outside the wedge itself.
    expect(modulesOverlap(shaped, plate({ x: 11.8, y: 1.8, length: 0.3, width: 0.3 }))).toBe(false);
    expect(modulesOverlap(shaped, plate({ x: 9, y: 0, length: 0.5, width: 0.5 }))).toBe(true);
  });

  it('is welded along the edge it actually shares', () => {
    const astern = plate({ x: 7, y: 0, length: 2, width: 4 });
    expect(contactWidth(shaped, astern)).toBeCloseTo(4, 6);
    // Meeting the stern corner at a point: a corner touch is not a joint.
    expect(contactWidth(shaped, plate({ x: 7.75, y: 2.25, length: 0.5, width: 0.5 }))).toBe(0);
  });

  it('is crossed by a shot where the corners are, and not where they are not', () => {
    // The wedge about the origin — nose at x = 2, stern across x = -2 — with a
    // core welded to its flat stern.
    const bow = shapeModule(plate(), wedge(4, 4))!;
    const design = compileBlueprint({
      name: 'wedge',
      modules: [bow, { kind: 'core', x: -2.5, y: 0, length: 1, width: 2 }],
    });
    // Measured in the ship's own frame, which is about its centre of mass.
    const shift = design.modules[0]!.x - bow.x;
    const path = new HullPath();
    // Along the spine: through the core, then the whole length of the wedge.
    modulesAlong(design, shift - 10, 0, shift + 10, 0, path);
    expect(path.count).toBe(2);
    expect(path.exit[1]! - path.entry[1]!).toBeCloseTo(4, 6);

    // Across the bow quarter: inside the box round the wedge, clear of the
    // wedge, which at that distance off the spine has ended well astern.
    const miss = new HullPath();
    modulesAlong(design, shift + 1.5, 1.9, shift + 2.5, 1.9, miss);
    expect(miss.count).toBe(0);
  });
});

describe('a triangle through the file and the layout', () => {
  const file: Blueprint = {
    name: 'Wedge',
    modules: [
      { kind: 'core', x: 0, y: 0, length: 2, width: 2 },
      // Deliberately off-centre and wound the wrong way, as a hand-written
      // file may well be: reading it re-centres and rewinds without moving it.
      { kind: 'structure', x: 0, y: 0, length: 0, width: 0, vertices: [1, -1, 3, 0, 1, 1] },
    ],
  };

  it('survives a round trip, as the simulation holds it', () => {
    const read = parseBlueprint(serialiseBlueprint(file));
    const plateSpec = read.modules[1] as ModuleSpec;
    expect(plateSpec.vertices).toHaveLength(6);
    expect(plateSpec.length).toBeCloseTo(2, 9);
    expect(plateSpec.width).toBeCloseTo(2, 9);
    expect(moduleProblem(plateSpec)).toBeNull();
    // Written back and read again gives the same module, corner for corner.
    const again = parseBlueprint(serialiseBlueprint(read)).modules[1] as ModuleSpec;
    expect(again.vertices).toEqual(plateSpec.vertices);
    expect(again.x).toBeCloseTo(plateSpec.x, 9);
  });

  it('is reflected with a mirrored copy of the part it is in', () => {
    const shaped = shapeModule(plate({ x: 2, y: 1 }), wedge())!;
    const drawn = expandBlueprint({
      name: 'pair',
      modules: [
        { kind: 'core', x: 0, y: 0, length: 2, width: 2 },
        { use: 'wing', x: 0, y: 0 },
        { use: 'wing', x: 0, y: 0, mirror: true },
      ],
      assemblies: { wing: { modules: [shaped] } },
    });
    const port = drawn[1]!.vertices!;
    const starboard = drawn[2]!.vertices!;
    // The same corners across the x-axis, and still wound anticlockwise.
    expect(drawn[2]!.y).toBeCloseTo(-drawn[1]!.y, 9);
    expect([...starboard].map((v, i) => (i % 2 === 1 ? -v : v)).sort()).toEqual(
      [...port].sort(),
    );
    expect(polygonArea(starboard)).toBeCloseTo(polygonArea(port), 9);
  });
});

describe('the bounding box a triangle keeps filled in', () => {
  it('is the corners’ own extent, and says where its middle is', () => {
    const bounds = triangleBounds([2, 0, -1, 3, -1, -3]);
    expect(bounds.length).toBeCloseTo(3, 9);
    expect(bounds.width).toBeCloseTo(6, 9);
    // Not the centroid, which these corners put at the origin.
    expect(bounds.x).toBeCloseTo(0.5, 9);
    expect(bounds.y).toBeCloseTo(0, 9);
  });
});

describe('shaping a module in the editor', () => {
  const shaped = shapeModule(plate({ x: 10, y: 0 }), wedge(4, 4))!;

  it('offers a handle on each corner and the knob, and no faces to size by', () => {
    const handles = handlesFor(shaped, 10);
    expect(handles.filter((h) => h.kind === 'vertex')).toHaveLength(3);
    expect(handles.filter((h) => h.kind === 'size')).toHaveLength(0);
    expect(handles.filter((h) => h.kind === 'rotate')).toHaveLength(1);
    // On the corners themselves, so a drawn handle is a grabbable one.
    const corners: number[] = [];
    const count = moduleOutline(shaped, corners);
    for (let i = 0; i < count; i++) {
      const handle = handles[i]!;
      expect(handle.x).toBeCloseTo(corners[i * 2]!, 9);
      expect(handle.y).toBeCloseTo(corners[i * 2 + 1]!, 9);
    }
  });

  it('moves one corner and leaves the other two exactly where they were', () => {
    const before: number[] = [];
    moduleOutline(shaped, before);
    const moved = vertexTo(shaped, 0, 16, 0, 1)!;
    expect(moved).not.toBeNull();
    const after: number[] = [];
    moduleOutline({ ...shaped, x: shaped.x + moved.dx, y: shaped.y + moved.dy, vertices: moved.vertices }, after);
    expect(after[0]).toBeCloseTo(16, 6);
    expect(after[2]).toBeCloseTo(before[2]!, 6);
    expect(after[3]).toBeCloseTo(before[3]!, 6);
    expect(after[4]).toBeCloseTo(before[4]!, 6);
    expect(after[5]).toBeCloseTo(before[5]!, 6);
  });

  it('stops rather than flattening the module onto a line', () => {
    // The nose dragged back onto the stern edge: not a smaller module, none.
    expect(vertexTo(shaped, 0, 8, 0, 0)).toBeNull();
  });

  it('is picked by a click inside its corners, not inside the box round them', () => {
    expect(moduleAt([shaped], 9, 0)).toBe(0);
    expect(moduleAt([shaped], 11.8, 1.8)).toBe(-1);
  });
});
