import { abs, atan2, cos, HALF_PI, max, min, round, sin } from './math.js';
import { moduleCentre, type ModuleSpec } from './modules.js';
import {
  ATTACHMENT_TOLERANCE,
  contactWidth,
  expandBlueprint,
  isInstance,
  type Assembly,
  type Placement,
} from './blueprint.js';

/**
 * Moving a module's face carries its neighbours with it.
 *
 * When a module is resized, whatever sits against a face that moved goes with
 * the face: pushed when it grows, pulled when it shrinks. It spreads from
 * there: whatever a moving placement would run into moves too, and so does
 * whatever hangs off a moving placement — anything that reaches the resized
 * module only through something that is moving — so a spar pushed aside takes
 * the engine on its end with it rather than leaving it behind.
 *
 * Only placements in the same list are candidates — the layout, or one
 * assembly's definition — because only those share a frame. A neighbour that is
 * an assembly instance moves as a whole. What still goes wrong is left for the
 * layout rules to report: a moving placement sliding off one it was welded to
 * side by side, and anything outside the list.
 */

interface Face {
  /** Which face of the module, in its own frame. */
  of: FaceOf;
  /** Outward normal. */
  nx: number;
  ny: number;
  /** The face's offset along the normal, before and after. */
  at: number;
  moved: number;
  /** The face's middle and half-length along it. */
  middle: number;
  half: number;
}

/**
 * `list` with every placement a resize from `before` to `after` carries along
 * moved by as far as the face that carries it moved. `list[index]` is left as
 * it is; the caller writes the resized module. Everything is in the list's own
 * frame. Faces are taken one at a time, so a corner drag pushes one way and
 * then the other.
 */
export function pushNeighbours(
  list: readonly Placement[],
  index: number,
  assemblies: Readonly<Record<string, Assembly>> | undefined,
  before: ModuleSpec,
  after: ModuleSpec,
): Placement[] {
  let out = list.slice();
  let current = before;
  for (let i = 0; i < 4; i++) {
    const face = movedFaces(current, after)[0];
    if (face === undefined) break;
    out = pushFace(out, index, assemblies ?? {}, current, face);
    current = withFaceMoved(current, face.of, face.moved - face.at);
  }
  return out;
}

/** One face's push: what it carries, found and moved. */
function pushFace(
  list: Placement[],
  index: number,
  assemblies: Readonly<Record<string, Assembly>>,
  resized: ModuleSpec,
  face: Face,
): Placement[] {
  const shift = face.moved - face.at;
  const boxes = list.map((placement, j) =>
    j === index
      ? [resized]
      : isInstance(placement)
        ? expandBlueprint({ name: '', modules: [placement], assemblies })
        : [placement],
  );

  const dx = shift > 0 ? face.nx : -face.nx;
  const dy = shift > 0 ? face.ny : -face.ny;
  const distance = abs(shift);

  // What sits against the face, and — when it grows — whatever it grows into,
  // which takes in a module turned so its corner hangs below the face.
  const moving = new Set<number>();
  for (let j = 0; j < list.length; j++) {
    if (j === index) continue;
    const mine = boxes[j]!;
    if (mine.some((box) => against(box, face) || (shift > 0 && sweeps(resized, box, dx, dy, distance)))) {
      moving.add(j);
    }
  }
  if (moving.size === 0) return list;

  const welded = boxes.map((mine, j) =>
    boxes.flatMap((theirs, k) =>
      k !== j && mine.some((a) => theirs.some((b) => contactWidth(a, b) > 0)) ? [k] : [],
    ),
  );
  const joined = reachable(welded, index, new Set());

  for (let grew = true; grew; ) {
    grew = false;
    for (let j = 0; j < list.length; j++) {
      if (j === index || moving.has(j)) continue;
      const hit = [...moving].some((m) =>
        boxes[m]!.some((a) => boxes[j]!.some((b) => sweeps(a, b, dx, dy, distance))),
      );
      if (hit) {
        moving.add(j);
        grew = true;
      }
    }
    // Hanging off what moves: joined to the resized module, but not without it.
    const free = reachable(welded, index, moving);
    for (const j of joined) {
      if (j === index || moving.has(j) || free.has(j)) continue;
      moving.add(j);
      grew = true;
    }
  }

  const out = list.slice();
  for (const j of moving) {
    const placement = list[j]!;
    out[j] = {
      ...placement,
      x: tidy(placement.x + face.nx * shift),
      y: tidy(placement.y + face.ny * shift),
    };
  }
  return out;
}

/** The placements reachable from `from` through welds, never entering `avoid`. */
function reachable(welded: readonly number[][], from: number, avoid: ReadonlySet<number>): Set<number> {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    for (const next of welded[queue.pop()!]!) {
      if (seen.has(next) || avoid.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/**
 * Whether `b` is in the way of `a` moving `distance` along `(dx, dy)`: whether
 * it overlaps the region `a` sweeps, by the separating-axis test on that
 * region. Touching side by side, or at a corner, is not in the way.
 */
function sweeps(a: ModuleSpec, b: ModuleSpec, dx: number, dy: number, distance: number): boolean {
  const ca = corners(a);
  const cb = corners(b);
  const aa = a.angle ?? 0;
  const ba = b.angle ?? 0;
  const axes = [cos(aa), sin(aa), -sin(aa), cos(aa), cos(ba), sin(ba), -sin(ba), cos(ba), -dy, dx];
  for (let k = 0; k < axes.length; k += 2) {
    const ax = axes[k]!;
    const ay = axes[k + 1]!;
    const step = (dx * ax + dy * ay) * distance;
    let aLo = Infinity;
    let aHi = -Infinity;
    let bLo = Infinity;
    let bHi = -Infinity;
    for (let c = 0; c < 8; c += 2) {
      const pa = ca[c]! * ax + ca[c + 1]! * ay;
      aLo = min(aLo, pa, pa + step);
      aHi = max(aHi, pa, pa + step);
      const pb = cb[c]! * ax + cb[c + 1]! * ay;
      bLo = min(bLo, pb);
      bHi = max(bHi, pb);
    }
    if (min(aHi, bHi) - max(aLo, bLo) <= ATTACHMENT_TOLERANCE) return false;
  }
  return true;
}

function corners(box: ModuleSpec): number[] {
  const mid = moduleCentre(box);
  const angle = box.angle ?? 0;
  const c = cos(angle);
  const s = sin(angle);
  const hl = box.length / 2;
  const hw = box.width / 2;
  const out: number[] = [];
  for (const [l, w] of [
    [hl, hw],
    [hl, -hw],
    [-hl, -hw],
    [-hl, hw],
  ] as const) {
    out.push(mid.x + l * c - w * s, mid.y + l * s + w * c);
  }
  return out;
}

/** The four faces of `before`, keeping those that are somewhere else in `after`. */
function movedFaces(before: ModuleSpec, after: ModuleSpec): Face[] {
  const angle = before.angle ?? 0;
  const ux = cos(angle);
  const uy = sin(angle);
  const was = moduleCentre(before);
  const now = moduleCentre(after);
  const faces: Face[] = [];
  const add = (
    of: FaceOf,
    nx: number,
    ny: number,
    halfBefore: number,
    halfAfter: number,
    span: number,
  ) => {
    const at = was.x * nx + was.y * ny + halfBefore;
    const moved = now.x * nx + now.y * ny + halfAfter;
    if (abs(moved - at) < 1e-6) return;
    faces.push({ of, nx, ny, at, moved, middle: was.x * -ny + was.y * nx, half: span });
  };
  for (const side of [1, -1] as const) {
    add({ along: side, across: 0 }, side * ux, side * uy, before.length / 2, after.length / 2, before.width / 2);
    add({ along: 0, across: side }, -side * uy, side * ux, before.width / 2, after.width / 2, before.length / 2);
  }
  return faces;
}

/**
 * Whether a box sits against a face or in the way of it: its near side is at
 * the face, or between where the face was and where it has grown to, and it
 * overlaps the face along its length rather than meeting it at a corner.
 */
function against(box: ModuleSpec, face: Face): boolean {
  const centre = moduleCentre(box);
  const angle = box.angle ?? 0;
  const c = cos(angle);
  const s = sin(angle);
  const depth = extent(box, c, s, face.nx, face.ny);
  const beside = extent(box, c, s, -face.ny, face.nx);
  const along = centre.x * face.nx + centre.y * face.ny;
  const across = centre.x * -face.ny + centre.y * face.nx;
  const near = along - depth;
  if (along <= face.at) return false;
  if (near < face.at - ATTACHMENT_TOLERANCE) return false;
  if (near > max(face.at, face.moved) + ATTACHMENT_TOLERANCE) return false;
  const overlap =
    min(across + beside, face.middle + face.half) - max(across - beside, face.middle - face.half);
  return overlap > ATTACHMENT_TOLERANCE;
}

/** How far a box reaches from its middle along a direction. */
function extent(box: ModuleSpec, c: number, s: number, nx: number, ny: number): number {
  return (abs(c * nx + s * ny) * box.length + abs(-s * nx + c * ny) * box.width) / 2;
}

function tidy(value: number): number {
  return round(value * 1e9) / 1e9;
}

/** A face of a module: ±1 along its length or across it, the other 0. */
export interface FaceOf {
  along: -1 | 0 | 1;
  across: -1 | 0 | 1;
}

/**
 * The face two modules share: the middle of the stretch both cover, the normal
 * from `a` into `b` and which way the seam runs, and which face of each it is.
 */
export interface SharedFace {
  x: number;
  y: number;
  nx: number;
  ny: number;
  angle: number;
  a: FaceOf;
  b: FaceOf;
  /**
   * Whether each module's face lies wholly within the other's. Only then can
   * that module grow across the seam without reaching past the other one.
   */
  aWithinB: boolean;
  bWithinA: boolean;
}

/** The face two modules share, or null unless they are square to each other and joined along one. */
export function sharedFace(a: ModuleSpec, b: ModuleSpec): SharedFace | null {
  const angleA = a.angle ?? 0;
  const turn = ((((b.angle ?? 0) - angleA) % HALF_PI) + HALF_PI) % HALF_PI;
  if (min(turn, HALF_PI - turn) > 1e-9) return null;
  if (contactWidth(a, b) <= 0) return null;

  const ca = moduleCentre(a);
  const cb = moduleCentre(b);
  const c = cos(angleA);
  const s = sin(angleA);
  const cbA = cos(b.angle ?? 0);
  const sbA = sin(b.angle ?? 0);
  for (const [along, across] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nx = along * c - across * s;
    const ny = along * s + across * c;
    const face = ca.x * nx + ca.y * ny + (along !== 0 ? a.length : a.width) / 2;
    const near = cb.x * nx + cb.y * ny - extent(b, cbA, sbA, nx, ny);
    if (abs(near - face) > ATTACHMENT_TOLERANCE) continue;

    const tx = -ny;
    const ty = nx;
    const halfA = (along !== 0 ? a.width : a.length) / 2;
    const halfB = extent(b, cbA, sbA, tx, ty);
    const midA = ca.x * tx + ca.y * ty;
    const midB = cb.x * tx + cb.y * ty;
    const middle = (max(midA - halfA, midB - halfB) + min(midA + halfA, midB + halfB)) / 2;

    // The face of b looking back at a, in b's own frame.
    const bx = -(nx * cbA + ny * sbA);
    const by = -(-nx * sbA + ny * cbA);
    return {
      x: face * nx + middle * tx,
      y: face * ny + middle * ty,
      nx,
      ny,
      angle: atan2(ty, tx),
      a: { along, across },
      b: { along: unit(bx), across: unit(by) },
      aWithinB:
        midA - halfA >= midB - halfB - ATTACHMENT_TOLERANCE &&
        midA + halfA <= midB + halfB + ATTACHMENT_TOLERANCE,
      bWithinA:
        midB - halfB >= midA - halfA - ATTACHMENT_TOLERANCE &&
        midB + halfB <= midA + halfA + ATTACHMENT_TOLERANCE,
    };
  }
  return null;
}

/**
 * The modules with their shared face moved `delta` from `a` into `b`, `a`
 * growing as `b` shrinks and neither going below `smallest`. Each keeps its
 * other faces where they were.
 */
export function shiftSeam(
  a: ModuleSpec,
  b: ModuleSpec,
  seam: SharedFace,
  delta: number,
  smallest: number,
): { a: ModuleSpec; b: ModuleSpec } {
  const sizeA = seam.a.along !== 0 ? a.length : a.width;
  const sizeB = seam.b.along !== 0 ? b.length : b.width;
  // A module already below `smallest` may grow but not shrink.
  const moved = max(min(0, smallest - sizeA), min(max(0, sizeB - smallest), delta));
  return { a: withFaceMoved(a, seam.a, moved), b: withFaceMoved(b, seam.b, -moved) };
}

/** A module with one face moved outward by `delta`, the opposite face held. */
export function withFaceMoved(spec: ModuleSpec, face: FaceOf, delta: number): ModuleSpec {
  const length = face.along !== 0 ? tidy(spec.length + delta) : spec.length;
  const width = face.across !== 0 ? tidy(spec.width + delta) : spec.width;
  const angle = spec.angle ?? 0;
  const c = cos(angle);
  const s = sin(angle);
  const lx = (face.along * delta) / 2;
  const ly = (face.across * delta) / 2;
  const was = moduleCentre(spec);
  const offset = moduleCentre({ ...spec, x: 0, y: 0, length, width });
  return {
    ...spec,
    length,
    width,
    x: tidy(was.x + lx * c - ly * s - offset.x),
    y: tidy(was.y + lx * s + ly * c - offset.y),
  };
}

function unit(value: number): -1 | 0 | 1 {
  return value > 0.5 ? 1 : value < -0.5 ? -1 : 0;
}
