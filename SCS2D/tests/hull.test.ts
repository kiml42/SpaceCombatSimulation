import { describe, expect, it } from 'vitest';
import { compileBlueprint, compileDraft, type Blueprint } from '../sim/blueprint.js';
import { HullPath, modulesAlong } from '../sim/hull.js';
import { HALF_PI, QUARTER_PI } from '../sim/math.js';
import { CORVETTE } from '../scenarios/blueprints.js';

/**
 * What a shot meets inside a ship.
 *
 * The properties that matter are ordering and exactness at the edges, because
 * both decide what a hit does: the first module in the list is the one whose
 * armour terminal ballistics is decided against, and a round that grazes a
 * corner must not be handed a module to spend itself on.
 */

/** A ship of three boxes in a row along x, each 4 long and 4 wide. */
const ROW: Blueprint = {
  name: 'Row',
  modules: [
    { kind: 'structure', x: -4, y: 0, length: 4, width: 4 },
    { kind: 'structure', x: 0, y: 0, length: 4, width: 4 },
    { kind: 'structure', x: 4, y: 0, length: 4, width: 4 },
  ],
};

/** Where a path meets things, as `[module, entry, exit]` rows rounded to millimetres. */
function rows(path: HullPath): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < path.count; i++) {
    out.push([
      path.module[i]!,
      Math.round(path.entry[i]! * 1000) / 1000,
      Math.round(path.exit[i]! * 1000) / 1000,
    ]);
  }
  return out;
}

describe('the modules a shot crosses', () => {
  const path = new HullPath();
  // The row's mass is symmetric, so the centre of mass is the middle box and
  // the design's frame is the layout's.
  const row = compileBlueprint(ROW);

  it('reports them in the order they are met, with the distance to each', () => {
    modulesAlong(row, -10, 0, 10, 0, path);
    expect(rows(path)).toEqual([
      [0, 4, 8],
      [1, 8, 12],
      [2, 12, 16],
    ]);
  });

  it('reports them in that order whichever way the shot goes', () => {
    modulesAlong(row, 10, 0, -10, 0, path);
    expect(rows(path)).toEqual([
      [2, 4, 8],
      [1, 8, 12],
      [0, 12, 16],
    ]);
  });

  it('measures in metres along the shot, not in fractions of it', () => {
    // The same line, cast twice as far: the distances do not move.
    modulesAlong(row, -10, 0, 30, 0, path);
    expect(rows(path)[0]).toEqual([0, 4, 8]);
  });

  it('stops where the shot stops', () => {
    // A shot that runs out inside the first box reports that box alone, and
    // reports it leaving where the shot ended rather than where the box does.
    modulesAlong(row, -10, 0, -3, 0, path);
    expect(rows(path)).toEqual([[0, 4, 7]]);
  });

  it('reports a module the shot starts inside, from zero', () => {
    // A round that was stopped at a surface and resumes from there is this
    // case, and so is anything that goes off inside a hull.
    modulesAlong(row, 0, 0, 10, 0, path);
    expect(rows(path)).toEqual([
      [1, 0, 2],
      [2, 2, 6],
    ]);
  });

  it('gives the outward normal of the face it enters by', () => {
    modulesAlong(row, -10, 0, 10, 0, path);
    // Arriving from -x, so the face met points back the way the round came.
    expect(path.nx[0]).toBeCloseTo(-1, 12);
    expect(path.ny[0]).toBeCloseTo(0, 12);

    modulesAlong(row, 0, -10, 0, 10, path);
    expect(path.nx[0]).toBeCloseTo(0, 12);
    expect(path.ny[0]).toBeCloseTo(-1, 12);
  });

  it('leaves the normal at zero for a module the shot began inside', () => {
    // It entered by no face, and saying so is better than naming whichever
    // one the arithmetic happened to compare first.
    modulesAlong(row, 0, 0, 10, 0, path);
    expect(path.nx[0]).toBe(0);
    expect(path.ny[0]).toBe(0);
  });

  it('misses a ship it passes beside', () => {
    modulesAlong(row, -10, 3, 10, 3, path);
    expect(path.count).toBe(0);
  });

  it('crosses nothing when it grazes a corner or runs along a face', () => {
    // Exactly on the outside face: no matter is crossed, and handing the
    // damage model a module to spend a shot on would be wrong.
    modulesAlong(row, -10, 2, 10, 2, path);
    expect(path.count).toBe(0);
    modulesAlong(row, -6, -10, -6, 10, path);
    expect(path.count).toBe(0);
  });

  it('crosses a canted module by its own faces', () => {
    const canted = compileBlueprint({
      name: 'Canted',
      modules: [{ kind: 'structure', x: 0, y: 0, angle: QUARTER_PI, length: 4, width: 4 }],
    });
    // A square 4 on a side turned through 45° presents its diagonal to a shot
    // through the middle of it, and the face met is its own, at 45°.
    modulesAlong(canted, -10, 0, 10, 0, path);
    expect(path.count).toBe(1);
    expect(path.exit[0]! - path.entry[0]!).toBeCloseTo(4 * Math.SQRT2, 9);
    expect(path.nx[0]).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(path.ny[0]).toBeCloseTo(-Math.SQRT1_2, 9);
  });

  it('keeps the layout’s own order when two modules start at the same distance', () => {
    // Two boxes in the same place: an invalid layout, and the cleanest way to
    // put two modules at exactly the same distance. Which is reported first
    // has to be the same on every machine, so it is the order the layout
    // lists them in rather than whatever a sort happened to do.
    const stacked = compileDraft({
      name: 'Stacked',
      modules: [
        { kind: 'structure', x: 0, y: 0, length: 4, width: 4 },
        { kind: 'turret', x: 0, y: 0, length: 4, width: 4, barrels: 1 },
      ],
    });
    modulesAlong(stacked, -10, 0, 10, 0, path);
    expect(path.count).toBe(2);
    expect([path.module[0], path.module[1]]).toEqual([0, 1]);
    expect(path.entry[0]).toBe(path.entry[1]);
  });

  it('finds what a shot down the corvette’s axis goes through', () => {
    const design = compileBlueprint(CORVETTE);
    // Nose-on from well ahead: the gun first, then the hull behind it, then
    // the engine bolted to its stern.
    modulesAlong(design, 100, 0, -100, 0, path);
    const kinds = [];
    for (let i = 0; i < path.count; i++) kinds.push(design.modules[path.module[i]!]!.spec.kind);
    expect(kinds).toEqual(['turret', 'structure', 'thruster']);
    // In order, and each entered after the last was left.
    for (let i = 1; i < path.count; i++) {
      expect(path.entry[i]!).toBeGreaterThanOrEqual(path.entry[i - 1]!);
    }
  });

  it('finds nothing along a line that misses the ship', () => {
    const design = compileBlueprint(CORVETTE);
    modulesAlong(design, 100, 40, -100, 40, path);
    expect(path.count).toBe(0);
  });

  it('is not confused by a shot that turns up edge-on to a face', () => {
    // A direction with no x component at all: the x slab cannot be divided
    // through, and the answer comes from the y slab alone.
    modulesAlong(row, -4, -10, -4, 10, path);
    expect(rows(path)).toEqual([[0, 8, 12]]);
    // And with no y component, mirrored.
    modulesAlong(row, -10, 0, 10, 0, path);
    expect(path.count).toBe(3);
  });

  it('reuses its arrays, so resolving a hit allocates nothing', () => {
    const fresh = new HullPath(2);
    modulesAlong(row, -10, 0, 10, 0, fresh);
    expect(fresh.count).toBe(3);
    const arrays = [fresh.module, fresh.entry];
    modulesAlong(row, -10, 0, 10, 0, fresh);
    expect(fresh.count).toBe(3);
    // Grown once on the first pass, then kept.
    expect(fresh.module).toBe(arrays[0]);
    expect(fresh.entry).toBe(arrays[1]);
  });

  it('turns with the ship, because it works in the ship’s own frame', () => {
    // The same ship listed turned through a right angle: a shot that crossed
    // it along x now has to come along y.
    const turned = compileBlueprint({
      name: 'Turned row',
      modules: ROW.modules.map((m) => ({
        ...(m as { kind: 'structure'; x: number; y: number; length: number; width: number }),
        x: 0,
        y: (m as { x: number }).x,
        angle: HALF_PI,
      })),
    });
    modulesAlong(turned, 0, -10, 0, 10, path);
    expect(rows(path)).toEqual([
      [0, 4, 8],
      [1, 8, 12],
      [2, 12, 16],
    ]);
  });
});
