import { describe, expect, it } from 'vitest';
import { radiansToDegrees as toDegrees, shapeModule, type ModuleSpec } from '../sim/index.js';
import {
  alignment,
  cornersOf,
  drawnAngles,
  offsetBy,
  landing,
  landOrGrid,
  snapBearing,
  snapField,
} from '../editor/snapping.js';
import { facingTo, resizedTo, vertexTo } from '../editor/handles.js';

/**
 * Landing a drag on what is already drawn.
 *
 * The grid is the wrong unit for a ship that is mostly drawn: a new module
 * wants to sit flush against a hull's side or cornered into the step between
 * two plates, and on a layout authored on half metres, or turned to 20°, the
 * nearest grid line is never where that is.
 */

const box = (x: number, y: number, length = 4, width = 4, angle?: number): ModuleSpec => ({
  kind: 'structure',
  x,
  y,
  length,
  width,
  ...(angle === undefined ? {} : { angle }),
});

// A plate from 2 to 6 along x, -2 to 2 across: corners on whole metres that
// are not the half-metre grid a drag would otherwise round to.
const plate = box(4, 0);

describe('what a drag can land on', () => {
  it('takes a corner over an edge, since every corner is on two', () => {
    const field = snapField([plate]);
    // Nearer the bow starboard corner than any point along either edge.
    expect(landing(field, 6.2, 2.2, 1)).toEqual({ x: 6, y: 2 });
  });

  it('lands along an edge, at the nearest point of it', () => {
    const field = snapField([plate]);
    expect(landing(field, 4.3, 2.4, 1)).toEqual({ x: 4.3, y: 2 });
  });

  it('reaches nothing further away than it is given', () => {
    const field = snapField([plate]);
    expect(landing(field, 4.3, 3.2, 1)).toBeNull();
    expect(landing(field, 4.3, 3.2, 2)).toEqual({ x: 4.3, y: 2 });
  });

  it('falls back to the grid where there is nothing to land on', () => {
    const field = snapField([plate]);
    expect(landOrGrid(field, 9.3, 9.4, 1, 0.5)).toEqual({ x: 9.5, y: 9.5 });
    // And the field wins where there is, grid or no grid.
    expect(landOrGrid(field, 4.3, 2.4, 1, 0.5)).toEqual({ x: 4.3, y: 2 });
  });

  it('leaves out the modules the drag is carrying', () => {
    const both = [plate, box(-4, 0)];
    const field = snapField(both, (i) => i === 0);
    // The plate's own corners are no longer offered; the other module's are.
    expect(landing(field, 6.2, 2.2, 1)).toBeNull();
    expect(landing(field, -2.2, 2.2, 1)).toEqual({ x: -2, y: 2 });
  });

  it("finds a triangle's edges, which is most of why this exists", () => {
    // A wedge with equal legs, so its hypotenuse runs at 45° from (2, -2) to
    // (6, 2) — a line no grid has a point on.
    const wedge = shapeModule(box(4, 0), [2, 2, -2, 2, -2, -2])!;
    const field = snapField([wedge]);
    expect(landing(field, 4.3, 0.1, 0.5)).toEqual({ x: 4.2, y: 0.2 });
  });
});

describe('moving a module onto what is drawn', () => {
  it('pulls whichever of its own corners is nearly on something', () => {
    const moving = box(-4, 0);
    const field = snapField([plate]);
    // A drag that takes its bow face to within a tenth of the plate's stern.
    const pull = alignment(field, offsetBy(cornersOf([moving]), 3.9, 0), 0.5);
    expect(pull).toEqual({ dx: 0.1, dy: 0 });
  });

  it('leaves a move alone when no corner of it is near anything', () => {
    const field = snapField([plate]);
    expect(alignment(field, offsetBy(cornersOf([box(-4, 0)]), 0.5, 0), 0.5)).toEqual({ dx: 0, dy: 0 });
  });

  it('carries the rest of what is moving with the corner that landed', () => {
    const field = snapField([plate]);
    const carried = [box(-4, 0), box(-9, 0)];
    const pull = alignment(field, offsetBy(cornersOf(carried), 3.9, 0), 0.5);
    expect(pull).toEqual({ dx: 0.1, dy: 0 });
  });
});

describe('sizing and reshaping onto what is drawn', () => {
  it('sizes a face flush with a neighbour it is dragged against', () => {
    const field = snapField([plate]);
    const sizing = box(-4, 0);
    // The bow face dragged to just short of the plate's stern face.
    const point = landing(field, 1.9, 0.4, 0.5)!;
    const sized = resizedTo(sizing, { along: 1, across: 0 }, point.x, point.y, 0);
    // Stern stays at -6, bow lands on 2: eight metres, middle at -2.
    expect(sized).toMatchObject({ length: 8, dx: 2 });
  });

  it("puts a corner on a neighbour's edge", () => {
    const wedge = shapeModule(box(-4, 0), [2, 2, -2, 2, -2, -2])!;
    const field = snapField([plate]);
    const point = landing(field, 2.1, 1.9, 0.5)!;
    const moved = vertexTo(wedge, 0, point.x, point.y, 0)!;
    // The corner is now on the plate's corner, so the module reaches it.
    const corners = cornersOf([{ ...wedge, ...moved, x: wedge.x + moved.dx, y: wedge.y + moved.dy }]);
    expect(corners).toContain(2);
  });
});

describe('the angles a design is drawn at', () => {
  it("offers a module's own facing, within a right angle", () => {
    expect(drawnAngles([box(0, 0, 4, 4, Math.PI / 9)])).toContain(20);
  });

  it("offers a wedge's edges, which is what a 15° grid cannot say", () => {
    // A right triangle with equal legs: its hypotenuse is at 45°, its legs
    // square to the ship.
    const wedge = shapeModule(box(4, 0), [2, 2, -2, 2, -2, -2])!;
    expect(drawnAngles([wedge])).toEqual([0, 45]);
  });

  it('leaves out the module being turned', () => {
    const turned = box(0, 0, 4, 4, Math.PI / 9);
    expect(drawnAngles([turned, box(10, 0)], (i) => i === 0)).toEqual([0]);
  });

  it('lands on a drawn angle, or its square, over an increment', () => {
    expect(snapBearing(19, 15, [20])).toBe(20);
    expect(snapBearing(112, 15, [20])).toBe(110);
    expect(snapBearing(-70, 15, [20])).toBe(-70);
  });

  it('keeps the increments, so a first module at 20° does not own the ship', () => {
    expect(snapBearing(2, 15, [20])).toBe(0);
    expect(snapBearing(44, 15, [20])).toBe(45);
  });

  it('turns a module onto a drawn angle through facingTo', () => {
    const turning = box(0, 0);
    // A pointer at 19°, which is nearer the drawn 20° than the 15° grid.
    const to = { x: 10 * Math.cos((19 * Math.PI) / 180), y: 10 * Math.sin((19 * Math.PI) / 180) };
    expect(toDegrees(facingTo(turning, to.x, to.y, 15, [20]))).toBeCloseTo(20, 9);
    expect(toDegrees(facingTo(turning, to.x, to.y, 15))).toBeCloseTo(15, 9);
  });
});
