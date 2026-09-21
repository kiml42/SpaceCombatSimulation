import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_TOLERANCE,
  JOINT_IMPULSE_PER_AREA,
  compileBlueprint,
  components,
  joints,
  subDesign,
  type Blueprint,
  type ModuleSpec,
} from '../sim/index.js';
import { CORVETTE, FRACTAL, GUNSHIP } from '../scenarios/blueprints.js';

/**
 * The graph that says which modules hold which.
 *
 * Geometry here, and nothing about damage: what breaks a weld is the ship's
 * business and is tested with it. What this pins is that the graph is derived
 * from the layout the way arcs and mass are — a layout cannot claim an
 * attachment its shape does not support — and that it is a graph rather than a
 * tree, which is what makes a ring of structure worth its mass.
 */

function structure(x: number, y: number, length: number, width: number): ModuleSpec {
  return { kind: 'structure', x, y, length, width };
}

/** Three boxes in a row: a wide join to the middle, a narrow one to the tip. */
const CHAIN: Blueprint = {
  name: 'Chain',
  modules: [structure(0, 0, 10, 4), structure(-10, 0, 10, 4), structure(8, 0, 6, 2)],
};

describe('deriving the joints', () => {
  const design = compileBlueprint(CHAIN);
  const found = joints(design);

  it('joins each module to the one it abuts and no further', () => {
    expect(found.map((j) => [j.a, j.b])).toEqual([
      [0, 1],
      [0, 2],
    ]);
  });

  it('measures the weld across the faces actually in contact', () => {
    // The middle box meets the long one along all 4 m of its end and the tip
    // along only the 2 m the tip is wide.
    expect(found[0]!.width).toBeCloseTo(4, 9);
    expect(found[1]!.width).toBeCloseTo(2, 9);
  });

  it('prices a weld by its section, so the narrow join is the weak one', () => {
    const thinner = Math.min(
      design.modules[0]!.stats.wallThickness,
      design.modules[2]!.stats.wallThickness,
    );
    expect(found[1]!.strength).toBeCloseTo(2 * thinner * JOINT_IMPULSE_PER_AREA, 6);
    expect(found[1]!.strength).toBeLessThan(found[0]!.strength);
  });

  it('counts a module within the attachment tolerance as welded', () => {
    const gap: Blueprint = {
      name: 'Gap',
      modules: [structure(0, 0, 10, 4), structure(-10 - ATTACHMENT_TOLERANCE * 0.5, 0, 10, 4)],
    };
    expect(joints(compileBlueprint(gap))).toHaveLength(1);
  });

  it('finds no joint at a corner, which joins nothing', () => {
    // Diagonally adjacent to the first box: touching it, across no face.
    const corner: Blueprint = {
      name: 'Corner',
      modules: [structure(0, 0, 10, 4), structure(-10, 0, 10, 4), structure(-10, 4, 10, 4)],
    };
    const found = joints(compileBlueprint(corner));
    expect(found.some((j) => j.a === 0 && j.b === 2)).toBe(false);
    // Still one ship: the corner piece is welded along the face it shares
    // with the module below it.
    expect(components(compileBlueprint(corner), () => false)).toHaveLength(1);
  });

  it('holds every shipped hull together in one piece', () => {
    for (const blueprint of [CORVETTE, GUNSHIP, FRACTAL]) {
      const hull = compileBlueprint(blueprint);
      expect(components(hull, () => false)).toHaveLength(1);
    }
  });
});

describe('the pieces a hull is in', () => {
  const design = compileBlueprint(CHAIN);

  it('is one piece while every weld holds', () => {
    expect(components(design, () => false)).toEqual([[0, 1, 2]]);
  });

  it('puts the piece holding the first module first', () => {
    const parts = components(design, (j) => j.a === 0 && j.b === 2);
    expect(parts).toEqual([[0, 1], [2]]);
  });

  it('comes apart into separate modules when every weld goes', () => {
    expect(components(design, () => true)).toEqual([[0], [1], [2]]);
  });

  it('survives a cut in a ring, which a tree could not', () => {
    // Four boxes round a square: every part of it has two ways home.
    const ring: Blueprint = {
      name: 'Ring',
      modules: [
        structure(-5, 0, 2, 12),
        structure(5, 0, 2, 12),
        structure(0, -5, 8, 2),
        structure(0, 5, 8, 2),
      ],
    };
    const hull = compileBlueprint(ring);
    expect(joints(hull)).toHaveLength(4);
    const cut = joints(hull)[0]!;
    expect(components(hull, (j) => j === cut)).toHaveLength(1);
  });
});

describe('the design a piece makes on its own', () => {
  const design = compileBlueprint(CHAIN);

  it('weighs what its modules weigh, about their own centre of mass', () => {
    const piece = subDesign(design, [0, 2]);
    const mass = design.modules[0]!.stats.mass + design.modules[2]!.stats.mass;
    expect(piece.mass).toBeCloseTo(mass, 9);

    const moment =
      design.modules[0]!.stats.mass * design.modules[0]!.spec.x +
      design.modules[2]!.stats.mass * design.modules[2]!.spec.x;
    expect(piece.centreOfMassX).toBeCloseTo(moment / mass, 9);
    expect(piece.centreOfMassY).toBeCloseTo(0, 9);

    // Measured about the piece's own centre, so it is less than the whole
    // ship's however the arithmetic is done.
    expect(piece.inertia).toBeLessThan(design.inertia);
  });

  it('keeps each module pointing back at the layout it came from', () => {
    const piece = subDesign(design, [1, 2]);
    expect(piece.modules.map((m) => m.index)).toEqual([
      design.modules[1]!.index,
      design.modules[2]!.index,
    ]);
  });

  it('works the arcs out against what is left, so a lost obstruction frees a gun', () => {
    const gunship = compileBlueprint(GUNSHIP);
    const whole = gunship.turrets[0]!;
    const alone = subDesign(
      gunship,
      gunship.modules.map((_, i) => i).filter((i) => i === whole.module || gunship.modules[i]!.spec.kind === 'structure'),
    );
    const freed = alone.turrets[0]!;
    const span = (turret: typeof whole): number =>
      (turret.mount.leftArc ?? 0) + (turret.mount.rightArc ?? 0);
    expect(span(freed)).toBeGreaterThanOrEqual(span(whole));
  });
});
