import { contactWidth, type ShipDesign } from './blueprint.js';
import { min } from './math.js';

/**
 * Which modules of a hull hold which, and how well.
 *
 * A blueprint says where the modules go and nothing about what joins them
 * (ROADMAP.md §12), so the graph is **derived from the geometry** for the
 * reason firing arcs are: a layout should not be able to claim an attachment
 * its shape does not support. Two modules are joined when their boundaries
 * touch within `ATTACHMENT_TOLERANCE`. It is literally the same question the
 * layout rule asks — `contactWidth` answers both — so "how close counts as
 * welded", and whether a corner counts at all, have one answer in the game
 * and not two.
 *
 * **A graph, not a tree.** A ring of structure has two load paths to every
 * part of it, and surviving a cut is exactly what makes that layout worth its
 * mass; parent pointers would make severing trivial and delete the decision.
 *
 * It is a property of a *design* and never of a ship, so it is worked out once
 * per design and shared by every hull built to it — damage cannot change it,
 * because damage never moves a module (DESIGN.md §4). What damage changes is
 * which of these joints still holds, which is the caller's question.
 */

/** Two modules welded together, and what the weld is worth. */
export interface Joint {
  /** Indices into the design's modules, `a` always the lower of the two. */
  readonly a: number;
  readonly b: number;
  /** Length of the faces in contact, metres. A corner joins nothing. */
  readonly width: number;
  /**
   * Energy the weld takes before it gives way, joules — comparable with what
   * `Damage` puts into a module, because that is what breaks it.
   */
  readonly strength: number;
}

/**
 * What a square metre of weld cross-section is worth, joules.
 *
 * A joint's section is the length of the faces in contact by the thinner of
 * the two walls meeting there, so a wing hung off a narrow neck comes away
 * long before the same wing welded along its whole root — which is the design
 * decision the graph exists to make possible.
 *
 * Set so that **a weld outlasts the lightest plate it joins**: on the shipped
 * hulls the weakest joint is worth about half again what the weakest module
 * can absorb, so something comes off when the metal around it has been wrecked
 * rather than merely dented. Lower and ships shed parts every few hits, which
 * ends fights before their guns do; higher and nothing ever comes apart. A
 * dial, and in §12 with the others.
 */
export const JOINT_ENERGY_PER_AREA = 2.4e8;

/**
 * Every joint in a design, in a fixed order: ascending by the lower module,
 * then by the higher.
 *
 * Worked out once per design and kept, because a hundred strike craft off one
 * blueprint have one graph between them and a hull's joints cannot change
 * while it is one hull. A severed chunk gets a design of its own, and so a
 * graph of its own, the first time anything asks.
 */
const cache = new WeakMap<ShipDesign, readonly Joint[]>();

export function joints(design: ShipDesign): readonly Joint[] {
  const known = cache.get(design);
  if (known !== undefined) return known;

  const found: Joint[] = [];
  const n = design.modules.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Both modules are written in the blueprint's own frame, which is the
      // body frame shifted rather than turned, so the geometry the layout rule
      // asks is exactly the geometry asked here.
      const width = contactWidth(design.modules[i]!.spec, design.modules[j]!.spec);
      if (width <= 0) continue;
      // The thinner wall is what gives way, so it is what the section is cut
      // from: welding a light plate to a heavy one makes a light joint.
      const thickness = min(
        design.modules[i]!.stats.wallThickness,
        design.modules[j]!.stats.wallThickness,
      );
      found.push({ a: i, b: j, width, strength: width * thickness * JOINT_ENERGY_PER_AREA });
    }
  }
  cache.set(design, found);
  return found;
}

/**
 * The pieces a hull is in, given which of its joints have let go.
 *
 * A flood fill over a static array, which is all §4's "damage never changes
 * topology" asks for: this runs when something breaks and never per step.
 * Components come back with their modules in ascending order and themselves
 * ordered by their lowest module, so the piece holding module 0 is first —
 * which is how the ship is told from what came off it.
 */
export function components(design: ShipDesign, broken: (joint: Joint) => boolean): number[][] {
  const n = design.modules.length;
  const holding = joints(design).filter((joint) => !broken(joint));

  // Adjacency as flat lists, built once: the fill walks it rather than the
  // whole joint list per module.
  const heads: number[][] = [];
  for (let i = 0; i < n; i++) heads.push([]);
  for (const joint of holding) {
    heads[joint.a]!.push(joint.b);
    heads[joint.b]!.push(joint.a);
  }

  const piece = new Int32Array(n).fill(-1);
  const pieces: number[][] = [];
  const frontier: number[] = [];
  for (let seed = 0; seed < n; seed++) {
    if (piece[seed] !== -1) continue;
    const found: number[] = [];
    piece[seed] = pieces.length;
    frontier.push(seed);
    while (frontier.length > 0) {
      const at = frontier.pop()!;
      found.push(at);
      for (const next of heads[at]!) {
        if (piece[next] !== -1) continue;
        piece[next] = pieces.length;
        frontier.push(next);
      }
    }
    found.sort((x, y) => x - y);
    pieces.push(found);
  }
  return pieces;
}
