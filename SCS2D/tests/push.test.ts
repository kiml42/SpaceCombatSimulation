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

  it('pushes something the face grows into, keeping the gap', () => {
    const out = pushNeighbours([hull, box(3.3, 0)], 0, undefined, hull, grownX(0.5));
    expect(at(out, 1)).toEqual([3.8, 0]);
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
    // Hull, then a block against it, then one against that with a gap of 0.3
    // the push is too far to leave.
    const list = [hull, box(3, 0), box(5.3, 0)];
    const out = pushNeighbours(list, 0, undefined, hull, grownX(0.5));
    expect(at(out, 1)).toEqual([3.5, 0]);
    expect(at(out, 2)).toEqual([5.8, 0]);
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
