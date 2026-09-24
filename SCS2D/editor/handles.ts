import {
  ATTACHMENT_TOLERANCE,
  contactWidth,
  degreesToRadians,
  math,
  moduleCentre,
  radiansToDegrees,
  type ModuleSpec,
} from '../sim/index.js';
import { snap } from './edit.js';

const { abs, atan2, cos, sin, max, min, round, sqrt, HALF_PI } = math;

/**
 * The grab points on a selected module: a corner or an edge to size it by, and
 * a knob to turn it.
 *
 * Size and facing are properties a module *has a picture of* — a box this long
 * and this wide, pointing that way — so they are the two the panel's number
 * boxes serve worst: typing 4.5 into a field and looking up to see what
 * happened is a slower loop than dragging the corner until it looks right.
 * Position was given a drag first for the same reason.
 *
 * The geometry lives here rather than in the overlay because the same answers
 * are needed twice, by things that must agree exactly: the overlay draws the
 * handles and the pointer has to hit them. A drawn handle nobody can grab, or
 * a grab point where nothing is drawn, is the failure mode, and one function
 * for both is the cheapest way to make it impossible.
 */

/** Where a handle sits, in the blueprint's own frame. */
export interface Handle {
  /**
   * A corner or edge, which sizes the module; the knob beyond the bow, which
   * turns it; or the seam between two selected modules, which moves the face
   * they share.
   */
  kind: 'size' | 'rotate' | 'seam';
  x: number;
  y: number;
  /**
   * Which face a size handle is on along the module's length and across it:
   * ±1 for a face, 0 for the middle. A corner has both, an edge one.
   */
  along: -1 | 0 | 1;
  across: -1 | 0 | 1;
  /** Which way a seam runs, radians, so it can be drawn along it. */
  angle?: number;
}

/** How big a handle is drawn, pixels. */
export const HANDLE_RADIUS_PX = 4.5;
/**
 * How close the pointer must come, pixels.
 *
 * Larger than the handle is drawn, because a handle is aimed at rather than
 * covered — and a corner handle sits exactly on the module's own corner, where
 * missing it by two pixels starts a drag of the module instead of a resize.
 */
export const HANDLE_GRAB_PX = 10;
/** How far the rotate knob stands off the module's bow face, pixels. */
export const ROTATE_ARM_PX = 26;
/**
 * The smallest a module can be dragged to, metres.
 *
 * The same floor the size boxes carry, and on the same half-metre grid as
 * every other snap, so a module sized by dragging and one sized by typing can
 * hold exactly the same values.
 */
export const MIN_SIZE = 0.5;

/**
 * The handles for a module, in the blueprint's frame.
 *
 * Corners in the order (+l,+w), (+l,-w), (-l,-w), (-l,+w), then the edges in
 * the order +l, -w, -l, +w, and the rotate knob last — beyond the bow, because
 * that is the face a module's facing points out of, so the knob says which way
 * the module is pointing before it is touched.
 *
 * `scale` is pixels per metre: the handles keep their size on screen rather
 * than in the world, so a small thruster is as grabbable zoomed out as a hull
 * is zoomed in.
 */
export function handlesFor(spec: ModuleSpec, scale: number): Handle[] {
  const angle = spec.angle ?? 0;
  const c = cos(angle);
  const s = sin(angle);
  const hl = spec.length / 2;
  const hw = spec.width / 2;
  const mid = moduleCentre(spec);
  const size = (along: Handle['along'], across: Handle['across']): Handle => ({
    kind: 'size',
    x: mid.x + along * hl * c - across * hw * s,
    y: mid.y + along * hl * s + across * hw * c,
    along,
    across,
  });
  const arm = hl + ROTATE_ARM_PX / scale;
  return [
    size(1, 1),
    size(1, -1),
    size(-1, -1),
    size(-1, 1),
    size(1, 0),
    size(0, -1),
    size(-1, 0),
    size(0, 1),
    {
      kind: 'rotate',
      x: mid.x + arm * c,
      y: mid.y + arm * s,
      along: 0,
      across: 0,
    },
  ];
}

/** Which handle a point is within reach of — the nearest of them — or -1. */
export function handleAt(
  handles: readonly Handle[],
  x: number,
  y: number,
  scale: number,
): number {
  let found = -1;
  let nearest = HANDLE_GRAB_PX / scale;
  for (let i = 0; i < handles.length; i++) {
    const handle = handles[i]!;
    const dx = handle.x - x;
    const dy = handle.y - y;
    const distance = sqrt(dx * dx + dy * dy);
    if (distance > nearest) continue;
    found = i;
    nearest = distance;
  }
  return found;
}

/**
 * The size a module takes when a size handle is dragged to a point, and how far
 * its position moves so the opposite corner or edge stays put.
 *
 * A dimension the handle is not on keeps its size and its middle, so an edge
 * changes one dimension only. The size snaps rather than the dragged face, so a
 * module whose faces were on the grid keeps them there.
 *
 * `dx`/`dy` are in the blueprint's frame, for `movePlacement`. On a shared part
 * the size changes every copy but the move is this copy's alone, so only the
 * copy being dragged is anchored; the others grow about their own positions.
 */
export function resizedTo(
  spec: ModuleSpec,
  handle: Pick<Handle, 'along' | 'across'>,
  x: number,
  y: number,
  step: number,
): { length: number; width: number; dx: number; dy: number } {
  const angle = spec.angle ?? 0;
  const c = cos(angle);
  const s = sin(angle);
  const mid = moduleCentre(spec);
  // The pointer in the module's own frame, from its middle.
  const px = (x - mid.x) * c + (y - mid.y) * s;
  const py = -(x - mid.x) * s + (y - mid.y) * c;

  const side = (face: number, half: number, pointer: number, held: number) => {
    if (face === 0) return { size: held, middle: 0 };
    const anchor = -face * half;
    const size = max(MIN_SIZE, snap(face * (pointer - anchor), step));
    return { size, middle: anchor + (face * size) / 2 };
  };
  const along = side(handle.along, spec.length / 2, px, spec.length);
  const across = side(handle.across, spec.width / 2, py, spec.width);

  // Where the new box's middle is, then where the position must be to put it
  // there — a thruster's position is its mounting face rather than its middle.
  const centreX = mid.x + along.middle * c - across.middle * s;
  const centreY = mid.y + along.middle * s + across.middle * c;
  const offset = moduleCentre({
    ...spec,
    x: 0,
    y: 0,
    length: along.size,
    width: across.size,
  });
  return {
    length: tidy(along.size),
    width: tidy(across.size),
    dx: tidy(centreX - offset.x - spec.x),
    dy: tidy(centreY - offset.y - spec.y),
  };
}

/**
 * The face two modules share, for moving it: where its handle sits, the normal
 * from `a` into `b`, and which face of each it is.
 */
export interface Seam {
  handle: Handle;
  nx: number;
  ny: number;
  a: Pick<Handle, 'along' | 'across'>;
  b: Pick<Handle, 'along' | 'across'>;
}

/**
 * The seam between two modules, or null unless they are square to each other
 * and joined along a face. The handle is at the middle of the part they share.
 */
export function seamBetween(a: ModuleSpec, b: ModuleSpec): Seam | null {
  const angleA = a.angle ?? 0;
  const turn = ((((b.angle ?? 0) - angleA) % HALF_PI) + HALF_PI) % HALF_PI;
  if (min(turn, HALF_PI - turn) > 1e-9) return null;
  if (contactWidth(a, b) <= 0) return null;

  const ca = moduleCentre(a);
  const cb = moduleCentre(b);
  const c = cos(angleA);
  const s = sin(angleA);
  for (const [along, across] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nx = along * c - across * s;
    const ny = along * s + across * c;
    const face = ca.x * nx + ca.y * ny + (along !== 0 ? a.length : a.width) / 2;
    const depthB = boxReach(b, nx, ny);
    const near = cb.x * nx + cb.y * ny - depthB;
    if (abs(near - face) > ATTACHMENT_TOLERANCE) continue;

    // Along the seam: the middle of the stretch both faces cover.
    const tx = -ny;
    const ty = nx;
    const halfA = (along !== 0 ? a.width : a.length) / 2;
    const halfB = boxReach(b, tx, ty);
    const midA = ca.x * tx + ca.y * ty;
    const midB = cb.x * tx + cb.y * ty;
    const middle = (max(midA - halfA, midB - halfB) + min(midA + halfA, midB + halfB)) / 2;

    // The face of b looking back at a, in b's own frame.
    const cbA = cos(b.angle ?? 0);
    const sbA = sin(b.angle ?? 0);
    const bx = -(nx * cbA + ny * sbA);
    const by = -(-nx * sbA + ny * cbA);
    return {
      handle: {
        kind: 'seam',
        x: face * nx + middle * tx,
        y: face * ny + middle * ty,
        along: 0,
        across: 0,
        angle: atan2(ty, tx),
      },
      nx,
      ny,
      a: { along, across },
      b: { along: sign(bx), across: sign(by) },
    };
  }
  return null;
}

/**
 * Both modules' new sizes and moves when their seam is dragged to a point: the
 * shared face moves along its normal by a snapped amount, one module growing
 * as the other shrinks, and neither going below `MIN_SIZE`.
 */
export function seamTo(
  a: ModuleSpec,
  b: ModuleSpec,
  seam: Seam,
  x: number,
  y: number,
  step: number,
): { a: ReturnType<typeof resizedTo>; b: ReturnType<typeof resizedTo> } {
  const sizeA = seam.a.along !== 0 ? a.length : a.width;
  const sizeB = seam.b.along !== 0 ? b.length : b.width;
  const wanted = snap((x - seam.handle.x) * seam.nx + (y - seam.handle.y) * seam.ny, step);
  const delta = max(MIN_SIZE - sizeA, min(sizeB - MIN_SIZE, wanted));
  const tx = seam.handle.x + seam.nx * delta;
  const ty = seam.handle.y + seam.ny * delta;
  return { a: resizedTo(a, seam.a, tx, ty, 0), b: resizedTo(b, seam.b, tx, ty, 0) };
}

function boxReach(box: ModuleSpec, nx: number, ny: number): number {
  const c = cos(box.angle ?? 0);
  const s = sin(box.angle ?? 0);
  return (abs(c * nx + s * ny) * box.length + abs(-s * nx + c * ny) * box.width) / 2;
}

function sign(value: number): -1 | 0 | 1 {
  return value > 0.5 ? 1 : value < -0.5 ? -1 : 0;
}

/** Rounds away the last-bit noise a turned frame leaves, so a file does not gain 1e-16s. */
function tidy(value: number): number {
  return round(value * 1e9) / 1e9;
}

/**
 * The facing a module takes when its knob is dragged to a point: the direction
 * from the module to the pointer, snapped to `stepDegrees` and returned in
 * radians.
 *
 * Snapped in **degrees** although the answer is radians, because degrees are
 * what the layout is written in and what the panel shows. Rounding to a
 * multiple of 15° in radians and converting back lands on -74.99999999999999
 * as often as on -75, which is a number nobody typed appearing in a file and
 * in the box beside the ship.
 *
 * In the blueprint's frame, like everything else drawn — a module inside a
 * turned or mirrored group is written in another, and converting between the
 * two is the caller's job, as it is for a drag.
 */
export function facingTo(spec: ModuleSpec, x: number, y: number, stepDegrees: number): number {
  const bearing = radiansToDegrees(atan2(y - spec.y, x - spec.x));
  return degreesToRadians(snap(bearing, stepDegrees));
}
