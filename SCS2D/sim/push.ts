import { abs, cos, max, min, round, sin } from './math.js';
import { moduleCentre, type ModuleSpec } from './modules.js';
import {
  ATTACHMENT_TOLERANCE,
  expandBlueprint,
  isInstance,
  type Assembly,
  type Placement,
} from './blueprint.js';

/**
 * Moving a module's face carries its neighbours with it.
 *
 * When a module is resized, whatever sits against a face that moved goes with
 * the face: pushed when it grows, pulled when it shrinks. That keeps a resize
 * from being refused because something is in the way, and keeps a shrink from
 * leaving its neighbours adrift.
 *
 * Only placements in the same list are candidates — the layout, or one
 * assembly's definition — because only those share a frame. A neighbour that is
 * an assembly instance moves as a whole. Nothing chains: a pushed neighbour
 * does not push its own neighbours, so whatever it now overlaps is left for the
 * layout rules to report.
 */

interface Face {
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
 * `list` with every placement that sat against a face `before` moved from, or
 * in the way of one it grew into, shifted by as far as that face moved.
 * `list[index]` is left as it is; the caller writes the resized module.
 * Everything is in the list's own frame.
 */
export function pushNeighbours(
  list: readonly Placement[],
  index: number,
  assemblies: Readonly<Record<string, Assembly>> | undefined,
  before: ModuleSpec,
  after: ModuleSpec,
): Placement[] {
  const faces = movedFaces(before, after);
  const out = list.slice();
  if (faces.length === 0) return out;
  for (let j = 0; j < list.length; j++) {
    if (j === index) continue;
    const placement = list[j]!;
    const boxes = isInstance(placement)
      ? expandBlueprint({ name: '', modules: [placement], assemblies: assemblies ?? {} })
      : [placement];
    const face = faces.find((f) => boxes.some((box) => against(box, f)));
    if (face === undefined) continue;
    const shift = face.moved - face.at;
    out[j] = {
      ...placement,
      x: tidy(placement.x + face.nx * shift),
      y: tidy(placement.y + face.ny * shift),
    };
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
  const add = (nx: number, ny: number, halfBefore: number, halfAfter: number, span: number) => {
    const at = was.x * nx + was.y * ny + halfBefore;
    const moved = now.x * nx + now.y * ny + halfAfter;
    if (abs(moved - at) < 1e-9) return;
    faces.push({ nx, ny, at, moved, middle: was.x * -ny + was.y * nx, half: span });
  };
  for (const side of [1, -1]) {
    add(side * ux, side * uy, before.length / 2, after.length / 2, before.width / 2);
    add(-side * uy, side * ux, before.width / 2, after.width / 2, before.length / 2);
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
