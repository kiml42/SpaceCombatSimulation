import { describe, expect, it } from 'vitest';
import { math, pushNeighbours, type ModuleSpec, type Placement } from '../sim/index.js';

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
    const out = pushNeighbours([turned, box(0, 3), box(1.5, 0)], 0, undefined, turned, grown);
    expect(at(out, 1)).toEqual([0, 4]);
    expect(at(out, 2)).toEqual([1.5, 0]);
  });

  it('moves each face’s neighbours by that face’s own movement', () => {
    // A corner drag: +x out by 1 and +y out by 2.
    const grown = { ...hull, x: 0.5, y: 1, length: 5, width: 4 };
    const out = pushNeighbours([hull, box(3, 0), box(0, 2)], 0, undefined, hull, grown);
    expect(at(out, 1)).toEqual([4, 0]);
    expect(at(out, 2)).toEqual([0, 4]);
  });
});
