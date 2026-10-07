import {
  degreesToRadians,
  sharedFace,
  shiftSeam,
  type SharedFace,
  math,
  BARREL_OUTER_CALIBRES,
  DEFAULT_NOZZLE_SHARE,
  hullMountGeometry,
  MAX_BARREL_CALIBRES,
  moduleCentre,
  normalizeShape,
  readsNozzle,
  triangleOf,
  moduleRadius,
  radiansToDegrees,
  type ModuleSpec,
} from '../sim/index.js';
import { snap } from './edit.js';
import { snapBearing } from './snapping.js';

const { atan2, cos, sin, max, round, sqrt, HALF_PI } = math;

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
   * A corner or edge, which sizes the module; one of a shaped module's own
   * corners, which moves that corner alone; the knob beyond the bow, which
   * turns it; the seam between two selected modules, which moves the face
   * they share; or the split between an engine's machinery and its bell, or a
   * hull weapon's block and its barrel, which sets how much is which.
   */
  kind: 'size' | 'vertex' | 'rotate' | 'seam' | 'split';
  x: number;
  y: number;
  /**
   * Which face a size handle is on along the module's length and across it:
   * ±1 for a face, 0 for the middle. A corner has both, an edge one.
   */
  along: -1 | 0 | 1;
  across: -1 | 0 | 1;
  /** Which corner a vertex handle moves, as an index into `ModuleSpec.vertices`. */
  vertex?: number;
  /** Which way a seam runs, radians, so it can be drawn along it. */
  angle?: number;
  /** Where a knob's arm starts, when that is not the selected module's middle. */
  fromX?: number;
  fromY?: number;
}

/**
 * The knob that turns a selected assembly: beyond everything it holds, along
 * the way its own +x points, on an arm from its origin — the point it turns
 * about, which is the module it was built around.
 */
export function assemblyKnob(
  pose: { x: number; y: number; rotation: number },
  modules: readonly ModuleSpec[],
  scale: number,
): Handle {
  let reach = 0;
  for (const spec of modules) {
    const mid = moduleCentre(spec);
    const dx = mid.x - pose.x;
    const dy = mid.y - pose.y;
    reach = max(reach, sqrt(dx * dx + dy * dy) + moduleRadius(spec));
  }
  const arm = reach + ROTATE_ARM_PX / scale;
  return {
    kind: 'rotate',
    x: pose.x + arm * cos(pose.rotation),
    y: pose.y + arm * sin(pose.rotation),
    along: 0,
    across: 0,
    fromX: pose.x,
    fromY: pose.y,
  };
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
 * A floor on the drag, under which no zoom can take it. The grid is the other
 * floor and usually the higher one — a drag cannot make a module smaller than
 * one step of the grid it is snapping to — so this only bites when the zoom is
 * fine enough that the grid has stopped being the binding constraint.
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
 * than in the world, so a small engine is as grabbable zoomed out as a hull
 * is zoomed in.
 */
export function handlesFor(spec: ModuleSpec, scale: number): Handle[] {
  const angle = spec.angle ?? 0;
  const c = cos(angle);
  const s = sin(angle);
  const hl = spec.length / 2;
  const hw = spec.width / 2;
  const mid = moduleCentre(spec);
  const triangle = triangleOf(spec);
  if (triangle !== null) {
    // A shaped module has no faces to size it by: each corner is grabbed on
    // its own, and the other two stay exactly where they are. The knob is
    // still beyond the bow, since a triangle faces a way like anything else.
    const corners: Handle[] = [];
    for (let i = 0; i < triangle.length; i += 2) {
      corners.push({
        kind: 'vertex',
        x: mid.x + triangle[i]! * c - triangle[i + 1]! * s,
        y: mid.y + triangle[i]! * s + triangle[i + 1]! * c,
        along: 0,
        across: 0,
        vertex: i / 2,
      });
    }
    const reach = moduleRadius(spec) + ROTATE_ARM_PX / scale;
    corners.push({ kind: 'rotate', x: mid.x + reach * c, y: mid.y + reach * s, along: 0, across: 0 });
    return corners;
  }
  const size = (along: Handle['along'], across: Handle['across']): Handle => ({
    kind: 'size',
    x: mid.x + along * hl * c - across * hw * s,
    y: mid.y + along * hl * s + across * hw * c,
    along,
    across,
  });
  const arm = hl + ROTATE_ARM_PX / scale;
  const split = readsNozzle(spec.kind) || spec.kind === 'hullGun' ? [splitHandle(spec)] : [];
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
    ...split,
  ];
}

/**
 * The fraction of an engine or hull gun that sticks out: its bell or barrel,
 * at the far end of its facing.
 */
function share(spec: ModuleSpec): number {
  if (spec.kind === 'hullGun') return hullMountGeometry(spec).share;
  return spec.nozzle ?? DEFAULT_NOZZLE_SHARE;
}

/** The most of a module that can be what sticks out, as the panel allows. */
export const MAX_SHARE = 0.95;

/**
 * The bar across a module where what sticks out meets the block behind it,
 * drawn and dragged like the seam between two modules.
 */
export function splitHandle(spec: ModuleSpec): Handle {
  const angle = spec.angle ?? 0;
  const mid = moduleCentre(spec);
  const along = spec.length * (0.5 - share(spec));
  return {
    kind: 'split',
    x: mid.x + along * cos(angle),
    y: mid.y + along * sin(angle),
    along: 0,
    across: 0,
    angle: angle + HALF_PI,
  };
}

/**
 * The share of the module that sticks out when the split is dragged to a
 * point: the length from the far end to the pointer, snapped to the grid.
 *
 * An engine may have no bell at all; a hull weapon must keep some barrel,
 * so its floor is one grid step, or a twentieth of the module off the grid.
 */
export function shareTo(spec: ModuleSpec, x: number, y: number, step: number): number {
  const angle = spec.angle ?? 0;
  const mid = moduleCentre(spec);
  const along = (x - mid.x) * cos(angle) + (y - mid.y) * sin(angle);
  const out = snap(spec.length / 2 - along, step);
  const floor = spec.kind === 'engine' ? 0 : max(step, spec.length * 0.05);
  const most = spec.length * MAX_SHARE;
  const length = out < floor ? floor : out > most ? most : out;
  return round((length / spec.length) * 1e6) / 1e6;
}

/**
 * A hull gun's barrel in calibres when the split is dragged to a point: whole
 * calibres unless `exact`, at least one, and leaving some block.
 */
export function barrelCalibresTo(spec: ModuleSpec, x: number, y: number, exact: boolean): number {
  const angle = spec.angle ?? 0;
  const mid = moduleCentre(spec);
  const along = (x - mid.x) * cos(angle) + (y - mid.y) * sin(angle);
  const calibre = hullMountGeometry(spec).outletWidth / BARREL_OUTER_CALIBRES;
  const wanted = (spec.length / 2 - along) / calibre;
  const fits = (spec.length * MAX_SHARE) / calibre;
  const most = fits < MAX_BARREL_CALIBRES ? fits : MAX_BARREL_CALIBRES;
  const held = wanted < 1 ? 1 : wanted > most ? most : wanted;
  return exact ? round(held * 1000) / 1000 : max(1, Math.floor(held));
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
 * With `fromCentre` the opposite face moves as far the other way instead, so
 * the middle stays put: what a module on a ship's centre line needs to stay
 * on it. The dragged face's movement snaps then, so both faces move by whole
 * grid steps.
 *
 * `dx`/`dy` are in the blueprint's frame, for `movePlacement` on the module
 * itself rather than its copy's instance, so every copy of a shared part moves
 * the same way within its own frame and a mirrored pair stays mirrored.
 */
export function resizedTo(
  spec: ModuleSpec,
  handle: Pick<Handle, 'along' | 'across'>,
  x: number,
  y: number,
  step: number,
  fromCentre = false,
): { length: number; width: number; dx: number; dy: number } {
  const angle = spec.angle ?? 0;
  const c = cos(angle);
  const s = sin(angle);
  const mid = moduleCentre(spec);
  // The pointer in the module's own frame, from its middle.
  const px = (x - mid.x) * c + (y - mid.y) * s;
  const py = -(x - mid.x) * s + (y - mid.y) * c;

  // Never below one step of the grid either: at a zoom where the grid is ten
  // metres, half a metre is not something the drag could have said, and it
  // would put the face off the grid its neighbours abut on.
  const side = (face: number, half: number, pointer: number, held: number) => {
    if (face === 0) return { size: held, middle: 0 };
    if (fromCentre) {
      const size = max(MIN_SIZE, step, held + 2 * snap(face * pointer - half, step));
      return { size, middle: 0 };
    }
    const anchor = -face * half;
    const size = max(MIN_SIZE, step, snap(face * (pointer - anchor), step));
    return { size, middle: anchor + (face * size) / 2 };
  };
  const along = side(handle.along, spec.length / 2, px, spec.length);
  const across = side(handle.across, spec.width / 2, py, spec.width);

  // Where the new box's middle is, then where the position must be to put it
  // there — an engine's position is its mounting face rather than its middle.
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
 * The triangle a module takes when it is first shaped: the wedge filling its
 * own box, nose on the bow face and base across the stern.
 *
 * In the module's own frame and about the middle of its box, which is where
 * the box it replaces was — `shapeModule` re-centres it on its own centroid
 * and moves the module to match, so the wedge stays where the box was drawn.
 *
 * The one shape worth starting from: it is what a hull of rectangles cannot
 * draw and what anybody reaching for a triangle wanted, and every other
 * triangle is a corner or two away from it.
 */
export function wedge(spec: ModuleSpec): number[] {
  const hl = spec.length / 2;
  const hw = spec.width / 2;
  return [hl, 0, -hl, hw, -hl, -hw];
}

/**
 * The corners a shaped module takes when one of them is dragged to a point,
 * and how far its position moves so the other two stay where they were.
 *
 * In the module's own frame, like the corners themselves, so every copy of a
 * shared part is reshaped the same way within its own frame and a mirrored
 * pair stays mirrored. The dragged corner snaps in the layout's frame rather
 * than the module's, so a corner put on the grid lands on it whatever the
 * module is turned to.
 *
 * Null when the three corners would no longer enclose anything: a corner
 * dragged onto the line between the other two is not a smaller module but no
 * module at all, and the drag simply stops there.
 */
export function vertexTo(
  spec: ModuleSpec,
  index: number,
  x: number,
  y: number,
  step: number,
): { vertices: number[]; dx: number; dy: number } | null {
  const triangle = triangleOf(spec);
  if (triangle === null || index < 0 || index * 2 >= triangle.length) return null;
  const angle = spec.angle ?? 0;
  const c = cos(angle);
  const s = sin(angle);
  const mid = moduleCentre(spec);
  const px = snap(x, step) - mid.x;
  const py = snap(y, step) - mid.y;
  const moved = triangle.slice();
  moved[index * 2] = px * c + py * s;
  moved[index * 2 + 1] = -px * s + py * c;

  const shape = normalizeShape(moved);
  if (shape === null) return null;
  // The re-centring is in the module's own frame; a move is in the layout's.
  return {
    vertices: shape.vertices,
    dx: tidy(shape.dx * c - shape.dy * s),
    dy: tidy(shape.dx * s + shape.dy * c),
  };
}

/** A seam as the editor draws and drags it: `sim`'s seam with a handle on it. */
export interface Seam extends SharedFace {
  handle: Handle;
}

/**
 * The seam between two modules, or null unless they are square to each other
 * and joined along a face. The handle is at the middle of the part they share.
 */
export function seamBetween(a: ModuleSpec, b: ModuleSpec): Seam | null {
  const seam = sharedFace(a, b);
  if (seam === null) return null;
  return {
    ...seam,
    handle: { kind: 'seam', x: seam.x, y: seam.y, along: 0, across: 0, angle: seam.angle },
  };
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
  const wanted = snap((x - seam.x) * seam.nx + (y - seam.y) * seam.ny, step);
  const moved = shiftSeam(a, b, seam, wanted, MIN_SIZE);
  const change = (was: ModuleSpec, now: ModuleSpec) => ({
    length: now.length,
    width: now.width,
    dx: tidy(now.x - was.x),
    dy: tidy(now.y - was.y),
  });
  return { a: change(a, moved.a), b: change(b, moved.b) };
}

/** Rounds away the last-bit noise a turned frame leaves, so a file does not gain 1e-16s. */
function tidy(value: number): number {
  const tidied = round(value * 1e9) / 1e9;
  // A negative zero is a frame turned half round, not a direction.
  return tidied === 0 ? 0 : tidied;
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
 * turned or mirrored assembly is written in another, and converting between the
 * two is the caller's job, as it is for a drag.
 *
 * `drawn` are the angles the rest of the design is already laid out at, which
 * a facing lands on as readily as on an increment: a ship with a wedge in it
 * has a diagonal that nothing on a 15° grid can be laid along.
 */
export function facingTo(
  spec: ModuleSpec,
  x: number,
  y: number,
  stepDegrees: number,
  drawn: readonly number[] = [],
): number {
  const bearing = radiansToDegrees(atan2(y - spec.y, x - spec.x));
  return degreesToRadians(snapBearing(bearing, stepDegrees, drawn));
}
