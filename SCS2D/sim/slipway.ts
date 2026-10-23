import { cos, max, min, sin } from './math.js';
import { berthOf, partsDesign, type PartOf, type ShipDesign } from './blueprint.js';
import { moduleCentre, moduleOutline, type ModuleSpec } from './modules.js';
import { faceNearest, shellOf } from './rebuild.js';
import { components } from './connectivity.js';
import { distanceToOutline } from './shape.js';

/**
 * What a slipway has built of a ship, and where it lies (ROADMAP.md §8 step
 * 12, slice 3). A slipway builds like a printer: out of its face, bow first
 * unless it lays the ship turned (`ModuleSpec.craftAngle`), every module the
 * face crosses growing at once as a shell from its far face, the part built
 * pushed out as it grows, the far end last. What `Ships` does with this is
 * its own; this is the shape.
 */

/** How deep each step of a slipway's building goes, metres: each step is a remade hull. */
export const SLIPWAY_STEP = 1;

/** Grown no further than this short of a face, a module is built to it. */
const EDGE = 1e-6;

/** How far a ship reaches along slipway `slipway`: how far the slipway builds it out. */
export function printLength(craft: ShipDesign, slipway: ModuleSpec): number {
  const berth = berthOf(craft, slipway);
  return berth.maxAlong - berth.minAlong;
}

/** A ship built `depth` from its leading end, in its own blueprint frame. */
export interface Print {
  readonly design: ShipDesign;
  /** The ship's module each of the design's modules is, by index. */
  readonly modules: readonly number[];
  /**
   * Where the slipway holds it: in each piece of it, the module nearest the
   * middle of the slipway's face. A design that joins up only further aft,
   * two hulls a beam at the stern ties, is in pieces until the beam is built.
   */
  readonly held: readonly number[];
}

/**
 * Where the cut lies in ship `craft`'s blueprint frame, built to `depth` on
 * `slipway`: how far along the slipway's facing, and the middle of the ship
 * across it.
 */
function cutOf(craft: ShipDesign, slipway: ModuleSpec, depth: number): { ax: number; ay: number; cut: number; mid: number } {
  const berth = berthOf(craft, slipway);
  const { ax, ay } = berth;
  const along = craft.centreOfMassX * ax + craft.centreOfMassY * ay;
  const across = craft.centreOfMassY * ax - craft.centreOfMassX * ay;
  return { ax, ay, cut: along + berth.maxAlong - depth, mid: across + (berth.minAcross + berth.maxAcross) / 2 };
}

/**
 * Ship `craft` built to `depth` on `slipway`, from its end that leads out of
 * the face (its bow, +x, unturned): each module wholly ahead of the cut whole,
 * each the cut crosses a shell from its foremost face as far as the cut. Null
 * while the cut has reached nothing. A module turned off the slipway's axis is
 * grown square to its foremost face, as near as a shell can come to the cut,
 * unless that would reach back past it: then it waits until it is whole.
 */
export function printedCraft(craft: ShipDesign, slipway: ModuleSpec, depth: number): Print | null {
  const { ax, ay, cut, mid } = cutOf(craft, slipway, depth);
  const parts: PartOf[] = [];
  const modules: number[] = [];
  const corners: number[] = [];
  const shell: number[] = [];
  const near: number[] = [];
  for (let k = 0; k < craft.modules.length; k++) {
    const { spec, stats } = craft.modules[k]!;
    const count = moduleOutline(spec, corners);
    let lo = Infinity;
    let hi = -Infinity;
    for (let v = 0; v < count; v++) {
      const along = corners[v * 2]! * ax + corners[v * 2 + 1]! * ay;
      lo = min(lo, along);
      hi = max(hi, along);
    }
    if (hi <= cut + EDGE) continue;
    const origin = { design: craft, module: k };
    if (lo >= cut - EDGE) {
      parts.push({ spec, stats, origin, shell: null });
    } else {
      const share = (hi - cut) / (hi - lo);
      const centre = moduleCentre(spec);
      // A point far out ahead of the module along the slipway, level with its centre.
      const ahead = hi + (hi - lo) * 1e3;
      const level = centre.y * ax - centre.x * ay;
      const face = faceNearest(spec, ahead * ax - level * ay, ahead * ay + level * ax);
      const part = shellOf(spec, stats, face, share);
      // Grown square to a face turned off the slipway's axis, a shell reaches
      // back past the cut, into the builder: such a module waits to be whole.
      if (behind(part.spec, ax, ay, cut, shell)) continue;
      parts.push({ spec: part.spec, stats: part.stats, origin, shell: { share, face, placed: spec } });
    }
    near.push(distanceToOutline(corners, count, cut * ax - mid * ay, cut * ay + mid * ax));
    modules.push(k);
  }
  if (parts.length === 0) return null;
  const design = partsDesign(craft.name, craft.doctrine, parts);
  const held = components(design, () => false).map((piece) => piece.reduce((best, m) => (near[m]! < near[best]! ? m : best), piece[0]!));
  return { design, modules, held };
}

/** Whether any of `spec` lies behind the cut, along the slipway's facing `ax, ay`. */
function behind(spec: ModuleSpec, ax: number, ay: number, cut: number, corners: number[]): boolean {
  const count = moduleOutline(spec, corners);
  for (let v = 0; v < count; v++) if (corners[v * 2]! * ax + corners[v * 2 + 1]! * ay < cut - EDGE) return true;
  return false;
}

/**
 * Where ship `craft`'s blueprint frame lies in the frame `slipway` is laid out
 * in, built to `depth`: turned to the slipway's facing and then by its
 * `craftAngle`, the middle of it across the slipway on the slipway's centre
 * line, and the cut at the slipway's face.
 */
export function printFrame(slipway: ModuleSpec, craft: ShipDesign, depth: number): { dx: number; dy: number; angle: number } {
  const { ax, ay, cut, mid } = cutOf(craft, slipway, depth);
  // The cut's middle in the ship's frame, and then turned as the slipway lays it.
  const px = cut * ax - mid * ay;
  const py = cut * ay + mid * ax;
  const turn = slipway.craftAngle ?? 0;
  const ct = turn === 0 ? 1 : cos(turn);
  const st = turn === 0 ? 0 : sin(turn);
  const angle = slipway.angle ?? 0;
  const c = cos(angle);
  const s = sin(angle);
  const ox = slipway.length / 2 - (px * ct - py * st);
  const oy = -(px * st + py * ct);
  return { dx: slipway.x + ox * c - oy * s, dy: slipway.y + ox * s + oy * c, angle: turn === 0 ? angle : angle + turn };
}
