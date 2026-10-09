import { abs, max, min, round, sqrt } from './math.js';
import type { ModuleKind, ModuleSpec } from './modules.js';

/**
 * What shape a module is, as geometry rather than as an archetype.
 *
 * Nearly every archetype is a box, because nearly every archetype has
 * something that comes out of one face of it — a bell, a barrel, a ring — and
 * a box is what those are measured against. Hull and store are the exception:
 * a plate or a tank is only ever a volume with walls round it, so nothing
 * breaks if its outline is something other than a rectangle, and a hull built
 * of rectangles alone cannot draw a prow.
 *
 * So `structure` and `tank` may be **triangles**, given as three corners the
 * author places one at a time (`ModuleSpec.vertices`), and every other
 * archetype is the box it declares. This file is the one place that knows
 * which: everything geometric — mass, the corners a shot crosses, what two
 * modules share a face along, what a turret cannot see past, what the renderer
 * draws — asks `moduleOutline` (which `modules.ts` owns, since which end of a
 * module its position names is a question about the archetype) for a module's
 * corners, and the laws here for what is inside them, rather than
 * reconstructing a rectangle from `length` and `width`.
 *
 * **The outline is convex and wound anticlockwise**, which is what lets one
 * separating-axis test serve boxes and triangles alike: the axes are the edge
 * normals, and a box's four are two pairs of opposites, so testing a box's
 * normals and a triangle's three is the same loop with a different count.
 */

/** Corners a triangular module has. */
export const TRIANGLE_CORNERS = 3;

/** The most corners any module's outline has, which is a box's four. */
export const MAX_CORNERS = 4;

/**
 * The smallest triangle that is a module, m².
 *
 * Three corners in a line enclose nothing: no interior, no mass, and an edge
 * normal that is whatever the arithmetic happened to produce. Refused rather
 * than tolerated, since every law below divides by the area or by an edge
 * length at some point.
 */
export const MIN_TRIANGLE_AREA = 1e-6;

/**
 * Whether this archetype may be drawn as something other than a box.
 *
 * Hull and store only. What rules the rest out is not the mass law — that
 * generalises — but what each kind has sticking out of a face: an engine's
 * bell leaves a face it has to be as wide as, a hull weapon's barrel comes out
 * of one and swings inside the opening, and a turret's ring has to fit within
 * the mount. Those are all measured along the module's length and across its
 * width, and a triangle has neither.
 */
export function canShape(kind: ModuleKind): boolean {
  return kind === 'structure' || kind === 'tank' || kind === 'hold';
}

/** The module's corners in its own frame, or null if it is the box it declares. */
export function triangleOf(spec: ModuleSpec): readonly number[] | null {
  const vertices = spec.vertices;
  if (vertices === undefined || !canShape(spec.kind)) return null;
  return vertices.length === TRIANGLE_CORNERS * 2 ? vertices : null;
}

/** Whether this module is drawn as a triangle rather than as its box. */
export function isTriangle(spec: ModuleSpec): boolean {
  return triangleOf(spec) !== null;
}

/**
 * Twice the signed area a corner list encloses, m² — positive anticlockwise.
 *
 * The shoelace sum, which is where the area, the centroid and the winding all
 * come from, so they cannot disagree about a triangle the author has turned
 * inside out by dragging one corner past the opposite edge.
 */
export function signedArea2(vertices: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < vertices.length; i += 2) {
    const j = (i + 2) % vertices.length;
    sum += vertices[i]! * vertices[j + 1]! - vertices[j]! * vertices[i + 1]!;
  }
  return sum;
}

/** The area a corner list encloses, m², whichever way round it is wound. */
export function polygonArea(vertices: readonly number[]): number {
  return abs(signedArea2(vertices)) * 0.5;
}

/**
 * A corner list made into a module's shape: centred on its own centroid and
 * wound anticlockwise, or null if the three corners enclose nothing.
 *
 * **Every triangle in a layout is stored this way**, which is what keeps
 * `ModuleSpec.x`/`y` meaning the same thing it means for a box — the middle
 * the module's mass acts at and everything else is measured from. A triangle
 * free to sit anywhere relative to its own position would put a second origin
 * into the format, and every law that asks where a module *is* would have to
 * ask which one it meant.
 *
 * The caller is the one that knows where the triangle was meant to be, so this
 * reports the shift as well: a vertex drag keeps the other two corners still
 * by moving the module by `dx`, `dy` in its own frame.
 */
export function normalizeShape(
  vertices: readonly number[],
): { vertices: number[]; dx: number; dy: number } | null {
  if (vertices.length !== TRIANGLE_CORNERS * 2) return null;
  if (polygonArea(vertices) < MIN_TRIANGLE_AREA) return null;

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < vertices.length; i += 2) {
    cx += vertices[i]!;
    cy += vertices[i + 1]!;
  }
  cx /= TRIANGLE_CORNERS;
  cy /= TRIANGLE_CORNERS;

  const out: number[] = [];
  for (let i = 0; i < vertices.length; i += 2) {
    out.push(tidy(vertices[i]! - cx), tidy(vertices[i + 1]! - cy));
  }
  // Anticlockwise, so the edge normals below point outwards.
  if (signedArea2(out) < 0) {
    const swapX = out[2]!;
    const swapY = out[3]!;
    out[2] = out[4]!;
    out[3] = out[5]!;
    out[4] = swapX;
    out[5] = swapY;
  }
  return { vertices: out, dx: tidy(cx), dy: tidy(cy) };
}

/** Rounds away the last-bit noise a turned frame leaves, so a file does not gain 1e-16s. */
function tidy(value: number): number {
  const rounded = round(value * 1e9) / 1e9;
  return rounded === 0 ? 0 : rounded;
}

/**
 * The bounding box a triangle needs, in its own frame: `length` along the
 * facing and `width` across it.
 *
 * A triangle keeps those two fields filled in because they are what the rest
 * of the format means by how big a module is — the mutation operators, the
 * editor's number boxes, a refit into a kind that has to be a box. They are
 * *derived* rather than authored, and no law that cares where the matter
 * actually is may read them: the box is not centred on the module's position,
 * since a triangle's centroid is not the middle of the box round it. Its
 * middle is reported with it, in the module's own frame, which is what squaring
 * a triangle off again has to move the module by.
 */
export function triangleBounds(
  vertices: readonly number[],
): { length: number; width: number; x: number; y: number } {
  let loX = Infinity;
  let hiX = -Infinity;
  let loY = Infinity;
  let hiY = -Infinity;
  for (let i = 0; i < vertices.length; i += 2) {
    loX = min(loX, vertices[i]!);
    hiX = max(hiX, vertices[i]!);
    loY = min(loY, vertices[i + 1]!);
    hiY = max(hiY, vertices[i + 1]!);
  }
  return {
    length: tidy(hiX - loX),
    width: tidy(hiY - loY),
    x: tidy((loX + hiX) * 0.5),
    y: tidy((loY + hiY) * 0.5),
  };
}

/**
 * How far across a triangle is at its narrowest, metres: the shortest of the
 * three altitudes.
 *
 * What "across" is for depth (`moduleThickness`): a module is as deep as it is
 * across, and the honest reading of that for a triangle is the narrowest way
 * through it rather than either side of the box round it. A long thin wedge is
 * a thin module however far it reaches.
 */
export function triangleAcross(vertices: readonly number[]): number {
  const area2 = abs(signedArea2(vertices));
  let longest = 0;
  for (let i = 0; i < vertices.length; i += 2) {
    const j = (i + 2) % vertices.length;
    const ex = vertices[j]! - vertices[i]!;
    const ey = vertices[j + 1]! - vertices[i + 1]!;
    longest = max(longest, sqrt(ex * ex + ey * ey));
  }
  return longest > 0 ? area2 / longest : 0;
}

/** How far the furthest corner is from the module's centre, metres. */
export function triangleRadius(vertices: readonly number[]): number {
  let furthest = 0;
  for (let i = 0; i < vertices.length; i += 2) {
    const x = vertices[i]!;
    const y = vertices[i + 1]!;
    furthest = max(furthest, sqrt(x * x + y * y));
  }
  return furthest;
}

/**
 * The triangle left when the walls are taken off the inside of this one,
 * metres `inset` thick, or null if the walls meet before there is anything
 * left.
 *
 * Each edge is moved `inset` along its inward normal and the three are
 * intersected again, which is what a wall of constant thickness actually
 * leaves: the inner triangle is similar to the outer one, so a sharp corner
 * loses far more area than a blunt one and a sliver of a plate is all wall.
 * That is the same pressure the box law applies — a long thin module carries
 * proportionally more wall for the space it encloses — arriving through the
 * shape instead of through the proportions.
 *
 * A negative `inset` pushes the edges the other way and grows the triangle,
 * which is what a tolerance applied to a module's faces is.
 */
export function insetTriangle(vertices: readonly number[], inset: number): number[] | null {
  if (inset === 0 || !Number.isFinite(inset)) return vertices.slice();
  const out: number[] = [];
  for (let i = 0; i < vertices.length; i += 2) {
    // The corner between the edge arriving at it and the edge leaving it.
    const prev = (i + vertices.length - 2) % vertices.length;
    const next = (i + 2) % vertices.length;
    const a = inwardLine(vertices, prev, i, inset);
    const b = inwardLine(vertices, i, next, inset);
    const point = meet(a, b);
    if (point === null) return null;
    out.push(point[0], point[1]);
  }
  // Walls that have met or crossed leave a triangle wound the other way, or
  // none at all: a plate thinner than two walls is solid, not hollow.
  if (signedArea2(out) < MIN_TRIANGLE_AREA * 2) return null;
  return out;
}

/** The edge from corner `i` to corner `j`, moved `inset` towards the interior. */
function inwardLine(
  vertices: readonly number[],
  i: number,
  j: number,
  inset: number,
): [number, number, number] {
  const ex = vertices[j]! - vertices[i]!;
  const ey = vertices[j + 1]! - vertices[i + 1]!;
  const span = sqrt(ex * ex + ey * ey);
  // Anticlockwise winding puts the interior to the left of every edge.
  const nx = -ey / span;
  const ny = ex / span;
  // n·p = c, with the line pushed `inset` the way the interior lies.
  return [nx, ny, nx * vertices[i]! + ny * vertices[i + 1]! + inset];
}

/** Where two lines given as `n·p = c` cross, or null if they are parallel. */
function meet(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number] | null {
  const det = a[0] * b[1] - a[1] * b[0];
  if (abs(det) < 1e-12) return null;
  return [(a[2] * b[1] - a[1] * b[2]) / det, (a[0] * b[2] - a[2] * b[0]) / det];
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
 * Second moment of area about the centroid, m⁴, for a corner list centred on
 * it — the shape's own contribution to how hard it is to turn.
 *
 * Returned as a moment of *area* rather than of mass so a caller can apply it
 * to whatever density the module works out to: `inertia = mass * J / A`, which
 * is the polygon's answer to the box's `m (l² + w²) / 12` and reduces to it
 * for a rectangle.
 */
export function polygonMomentOfArea(vertices: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < vertices.length; i += 2) {
    const j = (i + 2) % vertices.length;
    const ax = vertices[i]!;
    const ay = vertices[i + 1]!;
    const bx = vertices[j]!;
    const by = vertices[j + 1]!;
    const cross = ax * by - bx * ay;
    sum += cross * (ax * ax + ax * bx + bx * bx + ay * ay + ay * by + by * by);
  }
  return abs(sum) / 12;
}

/**
 * The separating axes an outline contributes: its edges' outward unit normals,
 * written into `out` as x,y pairs, and how many there are.
 *
 * A box has four edges and two distinct normals, and giving both of each pair
 * would only test the same axis twice, so a box reports two. A triangle
 * reports three, none of them parallel.
 */
export function outlineAxes(corners: readonly number[], count: number, out: number[]): number {
  const axes = count === MAX_CORNERS ? 2 : count;
  for (let i = 0; i < axes; i++) {
    const a = i * 2;
    const b = ((i + 1) % count) * 2;
    const ex = corners[b]! - corners[a]!;
    const ey = corners[b + 1]! - corners[a + 1]!;
    const span = sqrt(ex * ex + ey * ey);
    // Anticlockwise winding puts the outside to the right of every edge.
    out[i * 2] = span > 0 ? ey / span : 1;
    out[i * 2 + 1] = span > 0 ? -ex / span : 0;
  }
  out.length = axes * 2;
  return axes;
}

/** How far an outline reaches along an axis: `[lo, hi]` written into `out`. */
export function projectOutline(
  corners: readonly number[],
  count: number,
  ax: number,
  ay: number,
  out: { lo: number; hi: number },
): void {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < count * 2; i += 2) {
    const p = corners[i]! * ax + corners[i + 1]! * ay;
    lo = min(lo, p);
    hi = max(hi, p);
  }
  out.lo = lo;
  out.hi = hi;
}

/** Whether a point is inside an outline, its edges counting as inside. */
export function insideOutline(
  corners: readonly number[],
  count: number,
  x: number,
  y: number,
): boolean {
  for (let i = 0; i < count * 2; i += 2) {
    const j = (i + 2) % (count * 2);
    const ex = corners[j]! - corners[i]!;
    const ey = corners[j + 1]! - corners[i + 1]!;
    // Anticlockwise: inside is to the left of every edge.
    if ((x - corners[i]!) * ey - (y - corners[i + 1]!) * ex > 0) return false;
  }
  return true;
}

/** Distance from a point to the nearest point of an outline, metres. */
export function distanceToOutline(
  corners: readonly number[],
  count: number,
  x: number,
  y: number,
): number {
  if (insideOutline(corners, count, x, y)) return 0;
  let nearest = Infinity;
  for (let i = 0; i < count * 2; i += 2) {
    const j = (i + 2) % (count * 2);
    const ex = corners[j]! - corners[i]!;
    const ey = corners[j + 1]! - corners[i + 1]!;
    const span = ex * ex + ey * ey;
    let t = span > 0 ? ((x - corners[i]!) * ex + (y - corners[i + 1]!) * ey) / span : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (corners[i]! + ex * t);
    const dy = y - (corners[i + 1]! + ey * t);
    nearest = min(nearest, sqrt(dx * dx + dy * dy));
  }
  return nearest;
}
