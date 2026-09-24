import { describe, expect, it } from 'vitest';
import {
  math,
  pushNeighbours,
  sharedFace,
  shiftSeam,
  type ModuleSpec,
  type Placement,
} from '../sim/index.js';

/**
 * A resize carrying its neighbours: what sits against a face that moved goes
 * with it, and nothing else does.
 */

const box = (x: number, y: number, length = 2, width = 2): ModuleSpec => ({
  kind: 'structure',
  x,
  y,
  length,
  width,
});
// A 4×2 hull at the origin, its faces at x = ±2 and y = ±1.
const hull = box(0, 0, 4, 2);
/** The hull's +x face moved out by `by`, the -x face held. */
const grownX = (by: number): ModuleSpec => ({ ...hull, x: by / 2, length: 4 + by });
const at = (list: readonly Placement[], i: number) => [list[i]!.x, list[i]!.y];

describe('pushing neighbours with a moved face', () => {
  it('pushes what sits against the face, and leaves the other faces’ neighbours', () => {
    const list = [hull, box(3, 0), box(-3, 0), box(0, 2)];
    const out = pushNeighbours(list, 0, undefined, hull, grownX(1));
    expect(at(out, 1)).toEqual([4, 0]);
    expect(at(out, 2)).toEqual([-3, 0]);
    expect(at(out, 3)).toEqual([0, 2]);
    // The resized module itself is the caller's to write.
    expect(out[0]).toBe(hull);
  });

  it('pulls what sits against a face that shrinks', () => {
    const out = pushNeighbours([hull, box(3, 0)], 0, undefined, hull, grownX(-1));
    expect(at(out, 1)).toEqual([2, 0]);
  });

  it('pushes something the face grows into only once the gap has closed', () => {
    // 0.3 clear of the face, which grows 0.5: pushed the last 0.2.
    const out = pushNeighbours([hull, box(3.3, 0)], 0, undefined, hull, grownX(0.5));
    expect(at(out, 1)).toEqual([3.5, 0]);
  });

  it('leaves what is beyond the face’s reach, or only meets it at a corner', () => {
    const far = pushNeighbours([hull, box(4, 0)], 0, undefined, hull, grownX(0.5));
    expect(at(far, 1)).toEqual([4, 0]);
    // Touching the hull's +x,+y corner and nothing else.
    const corner = pushNeighbours([hull, box(3, 2)], 0, undefined, hull, grownX(1));
    expect(at(corner, 1)).toEqual([3, 2]);
    // Not pulled when it was never touching.
    const gap = pushNeighbours([hull, box(3.5, 0)], 0, undefined, hull, grownX(-1));
    expect(at(gap, 1)).toEqual([3.5, 0]);
  });

  it('moves an assembly instance as a whole', () => {
    const assemblies = { pod: { modules: [box(0, 0), box(2, 0)] } };
    const list: Placement[] = [hull, { use: 'pod', x: 3, y: 0 }];
    const out = pushNeighbours(list, 0, assemblies, hull, grownX(1));
    expect(out[1]).toEqual({ use: 'pod', x: 4, y: 0 });
  });

  it('works in the module’s own frame', () => {
    // The hull turned a quarter: its length is along y, so its +l face is at
    // y = 2, and growing it one metre that way moves the middle half a metre.
    const turned = { ...hull, angle: math.HALF_PI };
    const grown = { ...turned, y: 0.5, length: 5 };
    const out = pushNeighbours([turned, box(0, 3), box(2, 0)], 0, undefined, turned, grown);
    expect(at(out, 1)).toEqual([0, 4]);
    expect(at(out, 2)).toEqual([2, 0]);
  });

  it('moves each face’s neighbours by that face’s own movement', () => {
    // A corner drag: +x out by 1 and +y out by 2.
    const grown = { ...hull, x: 0.5, y: 1, length: 5, width: 4 };
    const out = pushNeighbours([hull, box(3, 0), box(0, 2)], 0, undefined, hull, grown);
    expect(at(out, 1)).toEqual([4, 0]);
    expect(at(out, 2)).toEqual([0, 4]);
  });
});

describe('what a push carries further', () => {
  it('pushes along a chain, each pushing what is in its way', () => {
    // Hull, then a block against it, then one 0.3 clear of that: the push of
    // 0.5 closes the gap and moves the far block the 0.2 left over.
    const list = [hull, box(3, 0), box(5.3, 0)];
    const out = pushNeighbours(list, 0, undefined, hull, grownX(0.5));
    expect(at(out, 1)).toEqual([3.5, 0]);
    expect(at(out, 2)).toEqual([5.5, 0]);
    // With a wider gap, the second is out of reach.
    const clear = pushNeighbours([hull, box(3, 0), box(5.6, 0)], 0, undefined, hull, grownX(0.5));
    expect(at(clear, 2)).toEqual([5.6, 0]);
  });

  it('takes what hangs off a pushed module with it', () => {
    // A spar off the hull's +x face running up in y, and an engine hung off
    // the spar's side: widening the hull pushes the spar, and the engine goes
    // with it rather than staying where it was along the spar.
    const spar = box(3, 3, 2, 8); // x 2..4, y -1..7
    const engine = box(5, 6); // against the spar's +x face, clear of the hull
    const out = pushNeighbours([hull, spar, engine], 0, undefined, hull, grownX(1));
    expect(at(out, 1)).toEqual([4, 3]);
    expect(at(out, 2)).toEqual([6, 6]);
  });

  it('leaves what still has its own way back to the resized module', () => {
    // The same, but a strut from the hull's +y face also holds the engine, so
    // it is not hanging off the spar alone.
    const spar = box(3, 3, 2, 8);
    const engine = box(1, 6, 2, 2); // x 0..2: against the spar's -x face
    const strut = box(1, 3, 2, 4); // x 0..2, y 1..5: on the hull and under the engine
    const out = pushNeighbours([hull, spar, engine, strut], 0, undefined, hull, grownX(1));
    expect(at(out, 1)).toEqual([4, 3]);
    expect(at(out, 2)).toEqual([1, 6]);
    expect(at(out, 3)).toEqual([1, 3]);
  });

  it('pulls what hangs off a pulled module too', () => {
    const spar = box(3, 3, 2, 8);
    const engine = box(5, 6);
    const out = pushNeighbours([hull, spar, engine], 0, undefined, hull, grownX(-1));
    expect(at(out, 1)).toEqual([2, 3]);
    expect(at(out, 2)).toEqual([4, 6]);
  });
});

describe('pushing only as far as it takes', () => {
  // A 4×4 hull with an engine on its top and bottom faces, both overhanging
  // its +x end, and a turret against that end between them with a metre
  // clear above and below — the corvette's bow, pulled back between its
  // engines.
  const square = box(0, 0, 4, 4);
  const top = box(2, 3); // x 1..3, y 2..4
  const turret = box(3, 0); // x 2..4, y -1..1
  const bottom = box(2, -3);
  const list = [square, top, turret, bottom];
  /** The hull's +y face pulled in by `by`. */
  const pulled = (by: number): ModuleSpec => ({ ...square, y: -by / 2, width: 4 - by });

  it('closes a gap before pushing across it, so the pushed module ends up touching', () => {
    // The engine comes down 1.5, meeting the turret after 1: the turret is
    // pushed the remaining half metre and ends against the engine.
    const out = pushNeighbours(list, 0, undefined, square, pulled(1.5));
    expect(at(out, 1)).toEqual([2, 1.5]);
    expect(at(out, 2)).toEqual([3, -0.5]);
    // Which leaves it touching the bottom engine, not pushing it.
    expect(at(out, 3)).toEqual([2, -3]);
  });

  it('agrees with itself however far the drag has gone', () => {
    // A drag re-applies the whole resize to the layout it started from, so
    // each step's answer must be where the steps before it would have led.
    for (const by of [0.5, 1, 1.5]) {
      const out = pushNeighbours(list, 0, undefined, square, pulled(by));
      const engineBottom = out[1]!.y - 1;
      const turretTop = out[2]!.y + 1;
      expect(engineBottom).toBeGreaterThanOrEqual(turretTop - 1e-9);
      expect(engineBottom - turretTop).toBeCloseTo(Math.max(0, 1 - by), 9);
    }
  });
});

describe('moving the face two modules share', () => {
  // The hull, and a 2×2 block against its +x face covering y = -1..1.
  const block = box(3, 0);

  it('says whose face lies within whose', () => {
    const seam = sharedFace(hull, block)!;
    // The block's face and the hull's +x face are the same two metres.
    expect(seam).toMatchObject({ aWithinB: true, bWithinA: true });
    const wide = sharedFace(box(0, 0, 4, 6), block)!;
    expect(wide).toMatchObject({ aWithinB: false, bWithinA: true });
  });

  it('grows one as the other shrinks, their outer faces held', () => {
    const moved = shiftSeam(hull, block, sharedFace(hull, block)!, 0.5, 0.5);
    expect(moved.a).toMatchObject({ x: 0.25, length: 4.5 });
    expect(moved.b).toMatchObject({ x: 3.25, length: 1.5 });
  });

  it('never shrinks a module below the floor, nor one already under it', () => {
    const seam = sharedFace(hull, block)!;
    expect(shiftSeam(hull, block, seam, 5, 0.5).b.length).toBe(0.5);
    // A block smaller than the floor may still grow, but may not shrink.
    const tiny = box(2.05, 0, 0.1, 2);
    const small = sharedFace(hull, tiny)!;
    expect(shiftSeam(hull, tiny, small, 0.5, 0.5).b.length).toBe(0.1);
    expect(shiftSeam(hull, tiny, small, -0.5, 0.5).b.length).toBe(0.6);
  });
});
