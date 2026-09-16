import {
  degreesToRadians,
  math,
  moduleCentre,
  radiansToDegrees,
  type ModuleSpec,
} from '../sim/index.js';
import { snap } from './edit.js';

const { abs, atan2, cos, sin, max, sqrt } = math;

/**
 * The grab points on a selected module: a corner to size it by, and a knob to
 * turn it.
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
  /** A corner, which sizes the module; or the knob beyond the bow, which turns it. */
  kind: 'size' | 'rotate';
  x: number;
  y: number;
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
 * Corners in the order (+l,+w), (+l,-w), (-l,-w), (-l,+w), and the rotate knob
 * last — beyond the bow, because that is the face a module's facing points out
 * of, so the knob says which way the module is pointing before it is touched.
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
  const at = (dl: number, dw: number, kind: Handle['kind']): Handle => ({
    kind,
    x: mid.x + dl * c - dw * s,
    y: mid.y + dl * s + dw * c,
  });
  return [
    at(hl, hw, 'size'),
    at(hl, -hw, 'size'),
    at(-hl, -hw, 'size'),
    at(-hl, hw, 'size'),
    at(hl + ROTATE_ARM_PX / scale, 0, 'rotate'),
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
 * The size a module takes when a corner is dragged to a point.
 *
 * **About the module's position**, which keeps that position meaning what it
 * says: a hull grows equally from its middle, and a thruster grows back from
 * the face it is bolted on by, because that face is where a thruster's
 * position is. An engine dragged longer therefore stays bolted where it was
 * and reaches further into its own exhaust, which is the only direction it
 * has room to grow in.
 *
 * Anchoring the corner *opposite* the one being dragged — what a drawing
 * program does — was rejected for two reasons that both come from what a
 * module is here. A module's position is the thing that belongs to a *copy*
 * where its size belongs to the shared part, so anchoring a corner would make
 * every resize of a shared module also a move of one copy of it, and the other
 * copies would have nothing to anchor. And with size snapping to half a metre,
 * an anchored corner puts the position on a quarter-metre grid, which takes
 * the module off the grid its neighbours abut on.
 *
 * Both dimensions move together, since a corner is a statement about both. A
 * drag along one edge would be the handle for one of them, and there is no
 * edge handle: four corners and a knob is the whole set, deliberately.
 */
export function sizedTo(
  spec: ModuleSpec,
  x: number,
  y: number,
  step: number,
): { length: number; width: number } {
  const angle = spec.angle ?? 0;
  const c = cos(-angle);
  const s = sin(-angle);
  const dx = x - spec.x;
  const dy = y - spec.y;
  // The pointer in the module's own frame, measured from where the module is
  // attached. A box centred on that point reaches half its length either side
  // of it; a thruster hanging back from it reaches the whole of its length one
  // way, so the same drag buys twice as much engine.
  const local = { x: dx * c - dy * s, y: dx * s + dy * c };
  const lengthwise = spec.kind === 'thruster' ? abs(local.x) : abs(local.x) * 2;
  return {
    length: max(MIN_SIZE, snap(lengthwise, step)),
    width: max(MIN_SIZE, snap(abs(local.y) * 2, step)),
  };
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
