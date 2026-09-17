import { abs, cos, max, min, sin, sqrt } from './math.js';
import type { ShipDesign } from './blueprint.js';
import type { Bodies } from './bodies.js';
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
 * The modules a segment crosses, written into `out` in the order it crosses
 * them.
 *
 * The segment runs from (x0, y0) to (x1, y1) in the ship's own frame, and the
 * distances reported are metres along it from the start — not a fraction of
 * it, because what a shot has left to give is spent in metres of armour and a
 * fraction would have to be multiplied back out by every caller.
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
  design: ShipDesign,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  out: HullPath,
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
      let face = inv > 0 ? -1 : 1;
      if (t0 > t1) {
        const swap = t0;
        t0 = t1;
        t1 = swap;
        face = -face;
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
      let face = inv > 0 ? -1 : 1;
      if (t0 > t1) {
        const swap = t0;
        t0 = t1;
        t1 = swap;
        face = -face;
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

  constructor(
    private readonly designs: HullDesigns,
    private readonly live?: LiveModules,
  ) {}

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

    modulesAlong(design, lx0, ly0, lx0 + ldx, ly0 + ldy, this.path);
    if (this.live !== undefined) this.skipSpent(bodyIndex);
    if (this.path.count === 0) return -1;

    // `modulesAlong` reports metres along the segment and the cast wants a
    // fraction of it, since that is what the grid orders hits by.
    const length = sqrt(ldx * ldx + ldy * ldy);
    if (!(length > 0)) return -1;
    return this.path.entry[0]! / length;
  }
}
