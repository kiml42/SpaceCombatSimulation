import { math, moduleOutline, radiansToDegrees, type ModuleSpec } from '../sim/index.js';
import { snap } from './edit.js';

const { abs, atan2, round, sqrt } = math;

/**
 * What a drag can land on besides the grid: the corners and edges of the
 * modules it is not moving, and the angles the design is already drawn at.
 *
 * The grid is the wrong unit for a ship that is mostly already drawn. A new
 * module wants to sit *against* what is there — flush with a hull's side,
 * cornered into the step between two plates — and on a layout authored on half
 * metres, or turned to 20°, the nearest grid line is never where that is. So
 * everything already drawn offers itself as somewhere to land, and the grid
 * stays as the fallback for a drag that is near nothing.
 *
 * Kept apart from the drags themselves so it can be read: a field is a list of
 * points and segments, and landing on one is arithmetic over that list.
 */

/** How far from a corner, an edge or an angle a drag still lands on it, pixels. */
export const SNAP_WITHIN_PIXELS = 10;

/** The corners and edges a drag may land on, in the blueprint's own frame. */
export interface SnapField {
  /** Corners, as `x, y` pairs. */
  readonly points: readonly number[];
  /** Edges, as `x0, y0, x1, y1` runs. */
  readonly edges: readonly number[];
}

export const EMPTY_FIELD: SnapField = { points: [], edges: [] };

/**
 * The field a layout offers, leaving out the modules a drag is moving.
 *
 * A module cannot snap to itself, and a module being carried along with it —
 * the rest of an assembly, the other copies of a shared part — would drag its
 * own targets along underneath the pointer.
 */
export function snapField(
  modules: readonly ModuleSpec[],
  moving: (index: number) => boolean = () => false,
): SnapField {
  const points: number[] = [];
  const edges: number[] = [];
  const outline: number[] = [];
  for (let i = 0; i < modules.length; i++) {
    if (moving(i)) continue;
    const corners = moduleOutline(modules[i]!, outline);
    for (let k = 0; k < corners; k++) {
      const x = outline[k * 2]!;
      const y = outline[k * 2 + 1]!;
      const j = (k + 1) % corners;
      points.push(x, y);
      edges.push(x, y, outline[j * 2]!, outline[j * 2 + 1]!);
    }
  }
  return { points, edges };
}

/**
 * Where a point lands, or null if it is near nothing.
 *
 * **A corner beats an edge** wherever both are in reach, since every corner is
 * on two edges and landing on the edge instead would be the near miss the snap
 * exists to prevent. Otherwise the nearest, and on an edge that means the
 * nearest point *along* it: a drag near the middle of a long face wants the
 * face, not its ends.
 */
export function landing(field: SnapField, x: number, y: number, within: number): { x: number; y: number } | null {
  if (!(within > 0)) return null;
  let best: { x: number; y: number } | null = null;
  let closest = within;
  const { points, edges } = field;
  for (let i = 0; i < points.length; i += 2) {
    const d = distance(x, y, points[i]!, points[i + 1]!);
    if (d < closest) {
      closest = d;
      best = { x: points[i]!, y: points[i + 1]! };
    }
  }
  if (best !== null) return best;
  for (let i = 0; i < edges.length; i += 4) {
    const on = along(edges[i]!, edges[i + 1]!, edges[i + 2]!, edges[i + 3]!, x, y);
    const d = distance(x, y, on.x, on.y);
    if (d < closest) {
      closest = d;
      best = on;
    }
  }
  return best;
}

/**
 * A point snapped to the field where it is near something, and to the grid
 * where it is not.
 *
 * The field is tried against where the pointer actually is rather than against
 * the grid-snapped point, so being near an edge is a fact about the drag and
 * not about which way the grid happened to round it.
 */
export function landOrGrid(
  field: SnapField,
  x: number,
  y: number,
  within: number,
  step: number,
): { x: number; y: number } {
  return landing(field, x, y, within) ?? { x: snap(x, step), y: snap(y, step) };
}

/**
 * The correction that puts one of a moving module's own corners on the field,
 * or no correction when none of them is near anything.
 *
 * A move is the one drag the pointer does not speak for: what should land on a
 * neighbour's edge is the moving module's own corner, wherever in it the drag
 * was started. The least correction wins, so the corner that is nearly there
 * is the one that goes there and the others follow.
 */
export function alignment(
  field: SnapField,
  corners: readonly number[],
  within: number,
): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  let closest = within;
  for (let i = 0; i < corners.length; i += 2) {
    const x = corners[i]!;
    const y = corners[i + 1]!;
    const on = landing(field, x, y, closest);
    if (on === null) continue;
    const d = distance(x, y, on.x, on.y);
    if (d >= closest) continue;
    closest = d;
    dx = on.x - x;
    dy = on.y - y;
  }
  return { dx: tidyMetres(dx), dy: tidyMetres(dy) };
}

/** The corners of some modules as `x, y` pairs. */
export function cornersOf(modules: readonly ModuleSpec[]): number[] {
  const out: number[] = [];
  const outline: number[] = [];
  for (const spec of modules) {
    const corners = moduleOutline(spec, outline);
    for (let k = 0; k < corners; k++) out.push(outline[k * 2]!, outline[k * 2 + 1]!);
  }
  return out;
}

/** The same points, moved by a displacement. */
export function offsetBy(points: readonly number[], dx: number, dy: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 2) out.push(points[i]! + dx, points[i + 1]! + dy);
  return out;
}

/**
 * The bearings a design is already drawn at, in degrees within a right angle.
 *
 * A ship with a module at 20° has a 20° line in it, and the next thing laid
 * along that line wants to be at 20° exactly — which a 15° grid cannot say.
 * Within a right angle because a facing's quadrant is the drag's business:
 * every angle is offered square to itself as well, so a module can be laid
 * along such a line or across it.
 *
 * Triangle edges count as much as facings do, since the whole point of a wedge
 * is the diagonal it draws and the thing most likely to be laid against it is
 * something square to that diagonal.
 */
export function drawnAngles(modules: readonly ModuleSpec[], moving: (index: number) => boolean = () => false): number[] {
  const out: number[] = [];
  const outline: number[] = [];
  const offer = (degrees: number): void => {
    const within = ((degrees % 90) + 90) % 90;
    const tidied = tidyMetres(within);
    if (!out.includes(tidied)) out.push(tidied);
  };
  for (let i = 0; i < modules.length; i++) {
    if (moving(i)) continue;
    const spec = modules[i]!;
    offer(radiansToDegrees(spec.angle ?? 0));
    const corners = moduleOutline(spec, outline);
    if (corners !== 3) continue;
    for (let k = 0; k < corners; k++) {
      const j = (k + 1) % corners;
      offer(radiansToDegrees(atan2(outline[j * 2 + 1]! - outline[k * 2 + 1]!, outline[j * 2]! - outline[k * 2]!)));
    }
  }
  return out;
}

/**
 * A bearing snapped to the nearest of the fixed increments and the angles the
 * design is already drawn at, in degrees.
 *
 * The nearest of all of them rather than the design's by preference: an
 * increment is a line in the design too, and a ship whose first module is at
 * 20° would otherwise be unable to put the second at 0°.
 */
export function snapBearing(degrees: number, step: number, drawn: readonly number[]): number {
  let best = step > 0 ? snap(degrees, step) : degrees;
  if (step <= 0) return best;
  let closest = abs(degrees - best);
  for (const angle of drawn) {
    // Each drawn angle is a line, so it is offered in all four quadrants.
    const nearest = angle + 90 * round((degrees - angle) / 90);
    const off = abs(degrees - nearest);
    if (off < closest) {
      closest = off;
      best = tidyMetres(nearest);
    }
  }
  return best;
}

/** The nearest point of a segment to a point. */
function along(x0: number, y0: number, x1: number, y1: number, x: number, y: number): { x: number; y: number } {
  const ex = x1 - x0;
  const ey = y1 - y0;
  const span = ex * ex + ey * ey;
  if (!(span > 0)) return { x: x0, y: y0 };
  let t = ((x - x0) * ex + (y - y0) * ey) / span;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  // Tidied, because a landing becomes a position in the file: a point two
  // thirds along an edge is a long number, but it should not be a long number
  // ending in 0000000018.
  return { x: tidyMetres(x0 + ex * t), y: tidyMetres(y0 + ey * t) };
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return sqrt(dx * dx + dy * dy);
}

/** Nine places, so a landing is a number somebody could have typed. */
export function tidyMetres(value: number): number {
  const tidied = round(value * 1e9) / 1e9;
  return tidied === 0 ? 0 : tidied;
}
