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
  /** Where the weld is, in the hull's frame — how far a blow has to travel. */
  readonly x: number;
  readonly y: number;
  /**
   * Impulse the weld can pass before it tears, newton-seconds, with the
   * modules it joins undamaged.
   *
   * An impulse and not an energy, because **what parts a hull is a blow, not
   * a wound**. Damage decides how much of this is left (`Ships.sever`); the
   * shock of a collision decides whether what is left is enough.
   */
  readonly strength: number;
}

/**
 * What a square metre of weld cross-section can carry, newton-seconds.
 *
 * A joint's section is the length of the faces in contact by the thinner of
 * the two walls meeting there, so a wing hung off a narrow neck comes away
 * long before the same wing welded along its whole root — which is the design
 * decision the graph exists to make possible.
 *
 * Set so that an undamaged hull shrugs off the bumps of a crowded battle and
 * a real ram takes something off it, while a hull whose metal has been shot to
 * pieces sheds parts on contacts it would once have ignored. A dial, and in
 * §12 with the others.
 */
export const JOINT_IMPULSE_PER_AREA = 3.0e6;

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
      // Between the two modules it joins, which is close enough to the weld
      // for measuring how far a shock had to travel to reach it.
      const x = (design.modules[i]!.x + design.modules[j]!.x) * 0.5;
      const y = (design.modules[i]!.y + design.modules[j]!.y) * 0.5;
      found.push({
        a: i,
        b: j,
        width,
        x,
        y,
        strength: width * thickness * JOINT_IMPULSE_PER_AREA,
      });
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
 * ordered by their lowest module, which makes the order a property of the
 * layout rather than of the fill. Which of the pieces goes on being the ship
 * is a question about its cores and is the caller's (`Ships.sever`).
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

/**
 * What hangs off either side of one weld, if that weld alone lets go.
 *
 * A weld's job is to drag whatever is on the far side of it along with the
 * rest of the ship, so this is what a blow has to pull through it. Worked out
 * per design and kept, because it is geometry and cannot change while a hull
 * is one hull.
 */
export interface Cut {
  /** Which side of this weld each module is on, 0 or 1. */
  readonly side: Int8Array;
  /** Each side's mass, kg. */
  readonly mass: readonly number[];
  /** Each side's own centre of mass, in the hull's frame. */
  readonly x: readonly number[];
  readonly y: readonly number[];
}

/**
 * One entry per joint, in `joints` order, or null where cutting that weld
 * alone parts nothing.
 *
 * Null is a weld in a **ring**: the hull is still in one piece without it, so
 * nothing hangs off it and no blow can load it on its own. That is exactly
 * what a second load path is worth, and it falls out of the geometry rather
 * than being a rule about rings.
 */
export function cuts(design: ShipDesign): readonly (Cut | null)[] {
  const known = cutCache.get(design);
  if (known !== undefined) return known;

  const all = joints(design);
  const found: (Cut | null)[] = [];
  for (const joint of all) {
    const parts = components(design, (other) => other === joint);
    if (parts.length !== 2) {
      found.push(null);
      continue;
    }
    const side = new Int8Array(design.modules.length);
    const mass = [0, 0];
    const x = [0, 0];
    const y = [0, 0];
    for (let p = 0; p < 2; p++) {
      for (const module of parts[p]!) {
        side[module] = p;
        const m = design.modules[module]!;
        mass[p]! += m.stats.mass;
        x[p]! += m.x * m.stats.mass;
        y[p]! += m.y * m.stats.mass;
      }
      if (mass[p]! > 0) {
        x[p]! /= mass[p]!;
        y[p]! /= mass[p]!;
      }
    }
    found.push({ side, mass, x, y });
  }
  cutCache.set(design, found);
  return found;
}

const cutCache = new WeakMap<ShipDesign, readonly (Cut | null)[]>();

/**
 * Which joint holds two modules together, or -1 if nothing does.
 *
 * Kept per design as a lookup, because anything walking a path *through* a
 * hull — a round crossing from one module into the next — asks it once per
 * boundary it crosses.
 */
export function jointBetween(design: ShipDesign, a: number, b: number): number {
  let index = indexCache.get(design);
  if (index === undefined) {
    index = new Map<number, number>();
    const all = joints(design);
    for (let k = 0; k < all.length; k++) {
      index.set(all[k]!.a * design.modules.length + all[k]!.b, k);
    }
    indexCache.set(design, index);
  }
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  return index.get(lo * design.modules.length + hi) ?? -1;
}

const indexCache = new WeakMap<ShipDesign, Map<number, number>>();
