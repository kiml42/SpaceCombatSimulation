import { cos, max, min, sin } from './math.js';
import { footprintOf, partsDesign, type PartOf, type ShipDesign } from './blueprint.js';
import { moduleCentre, moduleOutline, type ModuleSpec } from './modules.js';
import { faceNearest, shellOf } from './rebuild.js';
import { components } from './connectivity.js';
import { distanceToOutline } from './shape.js';

/**
 * What a slipway has built of a ship, and where it lies (ROADMAP.md §8 step
 * 12, slice 3). A slipway builds like a printer: bow first out of its face,
 * every module the face crosses growing at once as a shell from its far face,
 * the part built pushed out as it grows, the stern last. What `Ships` does
 * with this is its own; this is the shape.
 */

/** How deep each step of a slipway's building goes, metres: each step is a remade hull. */
export const SLIPWAY_STEP = 1;

/** Grown no further than this short of a face, a module is built to it. */
const EDGE = 1e-6;

/** How far a ship reaches from bow to stern, metres: how far a slipway builds it out. */
export function printLength(craft: ShipDesign): number {
  const box = footprintOf(craft);
  return box.maxX - box.minX;
}

/** A ship built `depth` from its bow, in its own blueprint frame. */
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
 * Ship `craft` built to `depth` from its bow (its +x end): each module wholly
 * ahead of the cut whole, each the cut crosses a shell from its foremost face
 * as far as the cut. Null while the cut has reached nothing. A module turned
 * off the bow axis is grown square to its foremost face, as near as a shell
 * can come to the cut.
 */
export function printedCraft(craft: ShipDesign, depth: number): Print | null {
  const box = footprintOf(craft);
  const cut = craft.centreOfMassX + box.maxX - depth;
  const midY = craft.centreOfMassY + (box.minY + box.maxY) / 2;
  const parts: PartOf[] = [];
  const modules: number[] = [];
  const corners: number[] = [];
  const near: number[] = [];
  for (let k = 0; k < craft.modules.length; k++) {
    const { spec, stats } = craft.modules[k]!;
    const count = moduleOutline(spec, corners);
    let lo = Infinity;
    let hi = -Infinity;
    for (let v = 0; v < count; v++) {
      lo = min(lo, corners[v * 2]!);
      hi = max(hi, corners[v * 2]!);
    }
    if (hi <= cut + EDGE) continue;
    const origin = { design: craft, module: k };
    if (lo >= cut - EDGE) {
      parts.push({ spec, stats, origin, shell: null });
    } else {
      const share = (hi - cut) / (hi - lo);
      const centre = moduleCentre(spec);
      const face = faceNearest(spec, hi + (hi - lo) * 1e3, centre.y);
      const part = shellOf(spec, stats, face, share);
      parts.push({ spec: part.spec, stats: part.stats, origin, shell: { share, face, placed: spec } });
    }
    near.push(distanceToOutline(corners, count, cut, midY));
    modules.push(k);
  }
  if (parts.length === 0) return null;
  const design = partsDesign(craft.name, craft.doctrine, parts);
  const held = components(design, () => false).map((piece) => piece.reduce((best, m) => (near[m]! < near[best]! ? m : best), piece[0]!));
  return { design, modules, held };
}

/**
 * Where ship `craft`'s blueprint frame lies in the frame `slipway` is laid out
 * in, built to `depth`: turned to the slipway's facing, its beam centred on
 * the slipway, and the cut at the slipway's face.
 */
export function printFrame(slipway: ModuleSpec, craft: ShipDesign, depth: number): { dx: number; dy: number; angle: number } {
  const box = footprintOf(craft);
  const cut = craft.centreOfMassX + box.maxX - depth;
  const midY = craft.centreOfMassY + (box.minY + box.maxY) / 2;
  const angle = slipway.angle ?? 0;
  const c = cos(angle);
  const s = sin(angle);
  const ox = slipway.length / 2 - cut;
  const oy = -midY;
  return { dx: slipway.x + ox * c - oy * s, dy: slipway.y + ox * s + oy * c, angle };
}
