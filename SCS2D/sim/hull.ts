import { abs, cos, max, min, sin, sqrt } from './math.js';
import { triangleOf } from './shape.js';
import type { DesignModule, ShipDesign } from './blueprint.js';
import type { Bodies } from './bodies.js';
import type { Rng } from './rng.js';
import { segmentCircleT, type RayNarrowPhase } from './spatialGrid.js';

/**
 * What a shot meets inside a ship: the modules a line crosses, in the order it
 * crosses them.
 *
 * Everything that resolves a hit needs this and nothing else has it. The
 * broad phase stops at a ship's bounding circle, which is enough to say *that*
 * a round arrived and hopeless for saying what it arrived at — a circle is not
 * where the armour is. Terminal ballistics needs the first module the round
 * meets and the face it meets it by; the damage model needs the rest of the
 * list, in order, because a shell that gets through the outer plating spends
 * what is left on whatever is behind it.
 *
 * Both of those are the same question asked twice, so it is answered once,
 * here, as pure geometry: a segment against a ship's boxes, no state, no
 * decisions about what a hit does.
 *
 * **In the ship's own frame**, which is the frame a `ShipDesign` lists its
 * modules in — about the centre of mass, unrotated. A caller holding a world
 * segment turns it into this frame first, which is two lines and keeps the
 * trigonometry at the call site rather than duplicating a pose here.
 */

/**
 * The modules a segment crosses, in order, reused between shots so that
 * resolving a hit allocates nothing.
 *
 * Parallel arrays rather than objects, for the same reason the body store is:
 * this is walked once per round that arrives, and a fleet action arrives a lot.
 */
export class HullPath {
  /** Index into `ShipDesign.modules`, in the order the segment meets them. */
  module: Int32Array;
  /** Distance along the segment at which the module's box is entered, metres. */
  entry: Float64Array;
  /** Distance at which it is left. `exit - entry` is the path through it. */
  exit: Float64Array;
  /**
   * Outward unit normal of the face the segment enters by, in the ship's
   * frame — what decides incidence, and therefore whether a shot skids off.
   *
   * Outward means out of the module, so a round arriving from outside meets a
   * normal pointing back at it: the dot product of the round's direction with
   * this is negative for any real impact.
   */
  nx: Float64Array;
  ny: Float64Array;
  count = 0;

  constructor(capacity = 16) {
    this.module = new Int32Array(capacity);
    this.entry = new Float64Array(capacity);
    this.exit = new Float64Array(capacity);
    this.nx = new Float64Array(capacity);
    this.ny = new Float64Array(capacity);
  }

  clear(): void {
    this.count = 0;
  }

  /** Room for one more, growing the arrays if this is the first time. */
  private reserve(): void {
    if (this.count < this.module.length) return;
    const size = this.module.length * 2;
    const next = new Int32Array(size);
    next.set(this.module);
    this.module = next;
    const f64 = (old: Float64Array): Float64Array => {
      const grown = new Float64Array(size);
      grown.set(old);
      return grown;
    };
    this.entry = f64(this.entry);
    this.exit = f64(this.exit);
    this.nx = f64(this.nx);
    this.ny = f64(this.ny);
  }

  /**
   * Add a crossing, keeping the list sorted by where it starts.
   *
   * An insertion sort as they are found, rather than a sort afterwards: a
   * round crosses a handful of modules out of a ship's dozens, so the list
   * being built is short, and inserting into it needs no comparator, no
   * allocation and no assumption about the engine's sort being stable. Ties —
   * two modules whose faces a round enters at exactly the same distance,
   * which abutting hull plates make ordinary rather than freakish — keep the
   * order the design lists them in, which is the layout's own order and the
   * same on every machine.
   */
  push(module: number, entry: number, exit: number, nx: number, ny: number): void {
    this.reserve();
    let at = this.count;
    while (at > 0 && this.entry[at - 1]! > entry) {
      this.module[at] = this.module[at - 1]!;
      this.entry[at] = this.entry[at - 1]!;
      this.exit[at] = this.exit[at - 1]!;
      this.nx[at] = this.nx[at - 1]!;
      this.ny[at] = this.ny[at - 1]!;
      at--;
    }
    this.module[at] = module;
    this.entry[at] = entry;
    this.exit[at] = exit;
    this.nx[at] = nx;
    this.ny[at] = ny;
    this.count++;
  }
}

/**
 * Just enough of a design to cast against: the boxes it is built from, in its
 * own frame. A `ShipDesign` is one, and so is a design still being compiled.
 */
export interface Boxes {
  readonly modules: readonly DesignModule[];
}

/**
 * The modules a segment crosses, written into `out` in the order it crosses
 * them.
 *
 * The segment runs from (x0, y0) to (x1, y1) in the ship's own frame, and the
 * distances reported are metres along it from the start — not a fraction of
 * it, because what a shot has left to give is spent in metres of armour and a
 * fraction would have to be multiplied back out by every caller.
 *
 * `layers` is what the cast is in (DESIGN.md §3), and it meets only modules
 * in one of them; `bodyLayers` puts every module of the ship in the same
 * layers, as a fighter's are, or leaves each its own (`OWN_LAYERS`). `skip`
 * leaves one module out.
 *
 * A segment that starts *inside* a module reports it, entering at zero: a
 * round that was stopped at a surface last step and resumes from there is
 * exactly that case, and so is a blast going off inside a hull.
 *
 * Modules are boxes and the test is the standard slab intersection, done in
 * each module's own frame so that a canted module is no harder than a square
 * one. There is no bounding-circle pre-test: a ship carries tens of modules,
 * the arithmetic per module is a dozen multiplications, and a circle test
 * would only add a second set of arithmetic to nearly every one of them.
 */
export function modulesAlong(
  design: Boxes,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  out: HullPath,
  layers = BOTH_LAYERS,
  skip = -1,
  bodyLayers = OWN_LAYERS,
): void {
  out.clear();
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = sqrt(dx * dx + dy * dy);
  if (!(length > 0)) return;
  // Unit direction, so the distances come out in metres.
  const ux = dx / length;
  const uy = dy / length;

  for (let i = 0; i < design.modules.length; i++) {
    const m = design.modules[i]!;
    if (i === skip || (moduleLayers(m, bodyLayers) & layers) === 0) continue;
    const triangle = triangleOf(m.spec);
    if (triangle !== null) {
      shapedModuleAlong(m, triangle, i, x0, y0, ux, uy, length, out);
      continue;
    }
    const c = cos(m.angle);
    const s = sin(m.angle);

    // The segment in the module's own frame, where its box is axis-aligned.
    const ox = x0 - m.x;
    const oy = y0 - m.y;
    const px = ox * c + oy * s;
    const py = -ox * s + oy * c;
    const vx = ux * c + uy * s;
    const vy = -ux * s + uy * c;

    const hl = m.spec.length * 0.5;
    const hw = m.spec.width * 0.5;

    // One slab per axis. The face that decides entry is the one entered last,
    // which is what makes the normal fall out of the same comparison.
    let near = 0;
    let far = length;
    let axis = 0;
    let sign = 0;

    // x slab
    if (abs(vx) < EDGE_ON) {
      // Parallel to the slab: either inside it for the whole segment or never.
      // The faces themselves count as outside, so a shot running exactly along
      // one goes past rather than through — the same rule that stops two
      // modules merely touching from overlapping.
      if (px <= -hl || px >= hl) continue;
    } else {
      const inv = 1 / vx;
      let t0 = (-hl - px) * inv;
      let t1 = (hl - px) * inv;
      const face = inv > 0 ? -1 : 1;
      if (t0 > t1) {
        const swap = t0;
        t0 = t1;
        t1 = swap;
      }
      if (t0 > near) {
        near = t0;
        axis = 1;
        sign = face;
      }
      far = min(far, t1);
      if (near > far) continue;
    }

    // y slab
    if (abs(vy) < EDGE_ON) {
      if (py <= -hw || py >= hw) continue;
    } else {
      const inv = 1 / vy;
      let t0 = (-hw - py) * inv;
      let t1 = (hw - py) * inv;
      const face = inv > 0 ? -1 : 1;
      if (t0 > t1) {
        const swap = t0;
        t0 = t1;
        t1 = swap;
      }
      if (t0 > near) {
        near = t0;
        axis = 2;
        sign = face;
      }
      far = min(far, t1);
      if (near > far) continue;
    }

    if (far < 0) continue;
    const entry = max(near, 0);
    const exit = min(far, length);
    // A segment that only grazes a corner or runs along a face crosses no
    // matter, and reporting it would hand the damage model a module to spend
    // a shot on that the shot never went through.
    if (!(exit > entry)) continue;

    // The face entered by, back in the ship's frame. A segment that began
    // inside the box entered by no face at all, and says so with a zero
    // normal rather than with whichever slab happened to compare first.
    let nx = 0;
    let ny = 0;
    if (near > 0 && axis !== 0) {
      const lx = axis === 1 ? sign : 0;
      const ly = axis === 2 ? sign : 0;
      nx = lx * c - ly * s;
      ny = lx * s + ly * c;
    }
    out.push(i, entry, exit, nx, ny);
  }
}

/**
 * `modulesAlong` for a module that is not a box: the same answer by the same
 * rules, over however many edges the module has.
 *
 * A box is two slabs, and a slab is a pair of parallel faces — which is what
 * makes the test above a comparison per axis rather than per face. A triangle
 * has no parallel faces at all, so each edge is clipped on its own: the
 * segment enters at the latest of the edges it crosses inwards and leaves at
 * the earliest it crosses outwards, which is the same near/far pair arrived at
 * one edge at a time.
 *
 * Every rule the box path keeps: a face itself counts as outside, so a shot
 * running exactly along one goes past rather than through; a segment that
 * begins inside reports the module entering at zero and by no face; and a
 * crossing of no length is not reported at all.
 */
function shapedModuleAlong(
  m: DesignModule,
  triangle: readonly number[],
  index: number,
  x0: number,
  y0: number,
  ux: number,
  uy: number,
  length: number,
  out: HullPath,
): void {
  const c = cos(m.angle);
  const s = sin(m.angle);
  // The segment in the module's own frame, where its corners are written.
  const ox = x0 - m.x;
  const oy = y0 - m.y;
  const px = ox * c + oy * s;
  const py = -ox * s + oy * c;
  const vx = ux * c + uy * s;
  const vy = -ux * s + uy * c;

  let near = 0;
  let far = length;
  let nlx = 0;
  let nly = 0;
  let entered = false;

  for (let e = 0; e < triangle.length; e += 2) {
    const j = (e + 2) % triangle.length;
    const ex = triangle[j]! - triangle[e]!;
    const ey = triangle[j + 1]! - triangle[e + 1]!;
    const span = sqrt(ex * ex + ey * ey);
    if (!(span > 0)) return;
    // Anticlockwise winding puts the outside to the right of every edge.
    const nx = ey / span;
    const ny = -ex / span;
    // How far outside this edge the segment starts, and how fast it closes.
    const outside = (px - triangle[e]!) * nx + (py - triangle[e + 1]!) * ny;
    const closing = vx * nx + vy * ny;

    if (abs(closing) < EDGE_ON) {
      // Parallel to the edge: outside it for the whole segment, or inside for
      // all of it. The edge itself counts as outside.
      if (outside >= 0) return;
      continue;
    }
    const t = -outside / closing;
    if (closing < 0) {
      // Crossing inwards: the latest such crossing is where the module starts.
      if (t > near) {
        near = t;
        nlx = nx;
        nly = ny;
        entered = true;
      }
    } else {
      far = min(far, t);
    }
    if (near > far) return;
  }

  if (far < 0) return;
  const entry = max(near, 0);
  const exit = min(far, length);
  if (!(exit > entry)) return;

  // The face entered by, back in the ship's frame. A segment that began inside
  // entered by no face at all, and says so with a zero normal.
  const faced = entered && near > 0;
  out.push(
    index,
    entry,
    exit,
    faced ? nlx * c - nly * s : 0,
    faced ? nlx * s + nly * c : 0,
  );
}

/**
 * How nearly parallel to a face counts as parallel to it.
 *
 * Not a tolerance for sloppiness but a guard on the division below: a
 * direction component of 1e-300 turns into a distance of 1e300, and two of
 * those subtract into a NaN that then loses every comparison silently. A
 * millionth is far below any incidence worth distinguishing and far above
 * where the arithmetic stops meaning anything.
 */
const EDGE_ON = 1e-6;

/**
 * Which body has a hull to be met, and what it is built from.
 *
 * A body is a mass with a radius; a *hull* is a list of modules. Most bodies
 * in a battle have one and some — debris, a race goal — do not, and a body
 * with no design keeps the bounding circle it always had rather than becoming
 * unhittable.
 */
export interface HullDesigns {
  designOf(bodyIndex: number): ShipDesign | null;
  /** The layers every module of this body is in, or `OWN_LAYERS` to leave each its own. */
  layersOf?(bodyIndex: number): number;
  /** How much of a module's interior is fuel, 0 to 1, for what a round has to get through. */
  fuelDepth?(bodyIndex: number, module: number): number;
  /**
   * A round of `calibre` has gone through a face of a module that is open to
   * space, at `(x, y)` with outward normal `(nx, ny)` in the hull's frame. The
   * module's integrity was `integrity` before the round reached it, and `rng`
   * is what decides whether the hole is left open.
   */
  holed?(bodyIndex: number, module: number, integrity: number, x: number, y: number, nx: number, ny: number, calibre: number, rng: Rng): void;
}

/** The deck and below. */
export const HULL_LAYER = 1;
/** Above the deck, where turrets fire and strike craft fly. */
export const WEAPONS_LAYER = 2;
export const BOTH_LAYERS = HULL_LAYER | WEAPONS_LAYER;
/** Each module in the layers its own kind and depth put it in. */
export const OWN_LAYERS = -1;

/** Which layers a module is in: the whole ship's, where it has one, else its own. */
export function moduleLayers(m: { readonly weaponsLayer: boolean }, bodyLayers: number): number {
  if (bodyLayers !== OWN_LAYERS) return bodyLayers;
  return m.weaponsLayer ? BOTH_LAYERS : HULL_LAYER;
}

/**
 * Which modules still stop the thing being cast.
 *
 * Shells are stopped by matter, so nothing implements this for them. A beam is
 * stopped by matter it can still boil away: once a module is spent, a beam
 * bores on through to what is behind it, which is how a beam ship kills
 * anything at all.
 */
export interface LiveModules {
  stops(bodyIndex: number, module: number): boolean;
}

/**
 * The narrow phase: a shot lands on a ship's hull rather than on the circle
 * drawn round it.
 *
 * A bounding circle is drawn to the furthest module, so for a ship longer than
 * it is wide most of that circle is empty space — and a round stopped by it
 * stops in the vacuum beside the bow. This turns the segment into the ship's
 * frame, asks `modulesAlong` what it crosses, and reports the first crossing;
 * a round that crosses nothing is a **miss**, and the cast carries on to
 * whatever is behind the ship.
 *
 * One `HullPath` is kept and reused, so a cast allocates nothing. It holds the
 * last answer rather than returning it, which is what lets `confirm` be the
 * cheap question the traversal asks of every candidate and `describe` the one
 * the caller asks once, about the winner.
 */
export class Hulls implements RayNarrowPhase {
  private readonly path = new HullPath();
  /** The module struck by the last `describe`, or -1 if it missed. */
  module = -1;
  /** Outward normal of the face it was entered by, in the **world** frame. */
  nx = 0;
  ny = 0;

  /**
   * What the cast in hand is, set by the caller around it and cleared with
   * `reset`: the layers it is in, and the module it was fired from, which it
   * never meets.
   */
  layers = BOTH_LAYERS;
  private skipBody = -1;
  private skipModule = -1;

  constructor(
    private readonly designs: HullDesigns,
    private readonly live?: LiveModules,
  ) {}

  /** Cast in some layers, from a module of a body, until `reset`. */
  castFrom(layers: number, body: number, module: number): void {
    this.layers = layers;
    this.skipBody = body;
    this.skipModule = module;
  }

  reset(): void {
    this.layers = BOTH_LAYERS;
    this.skipBody = -1;
    this.skipModule = -1;
  }

  confirm(
    bodies: Bodies,
    bodyIndex: number,
    x0: number,
    y0: number,
    dx: number,
    dy: number,
  ): number {
    const design = this.designs.designOf(bodyIndex);
    // No hull to meet: the circle was the answer all along.
    if (design === null) return segmentCircleT(x0, y0, dx, dy, bodies.x[bodyIndex]!, bodies.y[bodyIndex]!, bodies.radius[bodyIndex]!);
    return this.cast(design, bodies, bodyIndex, x0, y0, dx, dy);
  }

  /**
   * Re-run the narrow phase for the body the cast settled on, filling
   * `module`, `nx` and `ny`. Returns false if it finds nothing, which a caller
   * that has just been told the body was hit should treat as a bug rather than
   * as a miss.
   *
   * Recomputed rather than remembered: `confirm` is asked about every
   * candidate and only one of them wins, so keeping each answer would cost
   * more bookkeeping than one repeat of a dozen multiplications per module.
   */
  describe(
    bodies: Bodies,
    bodyIndex: number,
    x0: number,
    y0: number,
    dx: number,
    dy: number,
  ): boolean {
    this.module = -1;
    this.nx = 0;
    this.ny = 0;
    const design = this.designs.designOf(bodyIndex);
    if (design === null) return false;
    if (this.cast(design, bodies, bodyIndex, x0, y0, dx, dy) < 0) return false;

    const angle = bodies.angle[bodyIndex]!;
    const c = cos(angle);
    const s = sin(angle);
    const nx = this.path.nx[0]!;
    const ny = this.path.ny[0]!;
    this.module = this.path.module[0]!;
    // Back out of the ship's frame. A segment that began inside a module
    // entered by no face and carries a zero normal, which rotates to zero.
    this.nx = nx * c - ny * s;
    this.ny = nx * s + ny * c;
    return true;
  }

  /**
   * Drop the crossings at the front of the path that no longer stop anything,
   * so that the first one left is what the cast actually meets.
   *
   * Only the leading ones: a spent module deeper in still shadows nothing, and
   * the list stays in the order the segment crosses it.
   */
  private skipSpent(bodyIndex: number): void {
    const live = this.live;
    if (live === undefined) return;
    let first = 0;
    while (first < this.path.count && !live.stops(bodyIndex, this.path.module[first]!)) first++;
    if (first === 0) return;
    for (let i = first; i < this.path.count; i++) {
      const to = i - first;
      this.path.module[to] = this.path.module[i]!;
      this.path.entry[to] = this.path.entry[i]!;
      this.path.exit[to] = this.path.exit[i]!;
      this.path.nx[to] = this.path.nx[i]!;
      this.path.ny[to] = this.path.ny[i]!;
    }
    this.path.count -= first;
  }

  /** The segment in the ship's frame, and the first module it crosses. */
  private cast(
    design: ShipDesign,
    bodies: Bodies,
    bodyIndex: number,
    x0: number,
    y0: number,
    dx: number,
    dy: number,
  ): number {
    const bx = bodies.x[bodyIndex]!;
    const by = bodies.y[bodyIndex]!;
    const angle = bodies.angle[bodyIndex]!;
    const c = cos(angle);
    const s = sin(angle);

    const rx = x0 - bx;
    const ry = y0 - by;
    const lx0 = rx * c + ry * s;
    const ly0 = -rx * s + ry * c;
    const ldx = dx * c + dy * s;
    const ldy = -dx * s + dy * c;

    modulesAlong(
      design,
      lx0,
      ly0,
      lx0 + ldx,
      ly0 + ldy,
      this.path,
      this.layers,
      bodyIndex === this.skipBody ? this.skipModule : -1,
      this.designs.layersOf?.(bodyIndex) ?? OWN_LAYERS,
    );
    if (this.live !== undefined) this.skipSpent(bodyIndex);
    if (this.path.count === 0) return -1;

    // `modulesAlong` reports metres along the segment and the cast wants a
    // fraction of it, since that is what the grid orders hits by.
    const length = sqrt(ldx * ldx + ldy * ldy);
    if (!(length > 0)) return -1;
    return this.path.entry[0]! / length;
  }
}
