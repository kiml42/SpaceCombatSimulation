import type { Bodies } from './bodies.js';
import type { ShipDesign } from './blueprint.js';
import type { HullDesigns } from './hull.js';
import { abs, cos, max, min, sin, sqrt } from './math.js';

/**
 * Hulls that are solid: ships meeting each other rather than passing through.
 *
 * **Impulse-based, single pass** (DESIGN.md §4). Stacking and resting contact
 * are artefacts of a persistent force pressing bodies together; in space there
 * is no such force, so the hard case a contact solver is usually built for
 * never arises. A collision here is a rare, violent event between two things
 * that were flying free a moment ago and will be flying free a moment later.
 *
 * Geometry is the same two-stage question shots ask: the bounding circles say
 * which pairs *could* have met, and the module boxes say whether they did and
 * where. A circle is not where the hull is, so resolving against one would
 * have ships bouncing off empty space beside each other's bows.
 *
 * A body with no hull does not collide. Everything in a battle is a ship or
 * the wreck of one, and a bare mass with a radius — a test fixture's drifting
 * target — is not a shape anything can hit.
 */

/** How much of the closing speed is given back. Ships are not billiard balls. */
export const RESTITUTION = 0.15;

/**
 * Overlap left alone, metres.
 *
 * Pushing out the last centimetre buys nothing and costs a jitter: two hulls
 * touching within this are treated as touching, not as overlapping.
 */
const PENETRATION_SLOP = 0.02;

/** How much of the remaining overlap is corrected each step. */
const CORRECTION = 0.8;

/**
 * Contacts found this step, in the order the bodies are indexed.
 *
 * Parallel arrays, reused between steps, so a fleet action's worth of contacts
 * allocates nothing — and the order is the body order, which is what keeps the
 * resolution reproducible.
 */
export class Contacts {
  /** The two bodies, always with `a` the lower index. */
  a = new Int32Array(64);
  b = new Int32Array(64);
  /** Where they met, world frame. */
  x = new Float64Array(64);
  y = new Float64Array(64);
  /** Unit normal, pointing from `a` towards `b`. */
  nx = new Float64Array(64);
  ny = new Float64Array(64);
  /** How far they overlap along that normal, metres. */
  depth = new Float64Array(64);
  /** Which module of each hull met, for a damage model to spend the hit on. */
  moduleA = new Int32Array(64);
  moduleB = new Int32Array(64);
  /** Closing speed along the normal when they met, m/s. Zero if separating. */
  closing = new Float64Array(64);
  /**
   * Impulse the solver put through the contact, newton-seconds, along the
   * normal — what `a` took one way and `b` the other. Zero for a pair already
   * coming apart, and what decides whether a hull holds together (§4).
   */
  impulse = new Float64Array(64);
  count = 0;

  clear(): void {
    this.count = 0;
  }

  push(
    a: number,
    b: number,
    x: number,
    y: number,
    nx: number,
    ny: number,
    depth: number,
    moduleA: number,
    moduleB: number,
  ): void {
    if (this.count === this.a.length) this.grow();
    const i = this.count++;
    this.a[i] = a;
    this.b[i] = b;
    this.x[i] = x;
    this.y[i] = y;
    this.nx[i] = nx;
    this.ny[i] = ny;
    this.depth[i] = depth;
    this.moduleA[i] = moduleA;
    this.moduleB[i] = moduleB;
    this.closing[i] = 0;
    this.impulse[i] = 0;
  }

  private grow(): void {
    const size = this.a.length * 2;
    const a = new Int32Array(size);
    const b = new Int32Array(size);
    const x = new Float64Array(size);
    const y = new Float64Array(size);
    const nx = new Float64Array(size);
    const ny = new Float64Array(size);
    const depth = new Float64Array(size);
    const moduleA = new Int32Array(size);
    const moduleB = new Int32Array(size);
    const closing = new Float64Array(size);
    const impulse = new Float64Array(size);
    a.set(this.a);
    b.set(this.b);
    x.set(this.x);
    y.set(this.y);
    nx.set(this.nx);
    ny.set(this.ny);
    depth.set(this.depth);
    moduleA.set(this.moduleA);
    moduleB.set(this.moduleB);
    closing.set(this.closing);
    impulse.set(this.impulse);
    this.impulse = impulse;
    this.a = a;
    this.b = b;
    this.x = x;
    this.y = y;
    this.nx = nx;
    this.ny = ny;
    this.depth = depth;
    this.moduleA = moduleA;
    this.moduleB = moduleB;
    this.closing = closing;
  }
}

/** One module's box in the world: centre, axes and half extents. */
interface Box {
  x: number;
  y: number;
  /** Unit axis along the module's length, and the one across it. */
  ux: number;
  uy: number;
  halfLength: number;
  halfWidth: number;
  /** Corner distance, for rejecting a pair before the separating-axis test. */
  radius: number;
}

/** Fill `out` with a module's box in the world, given its body's pose. */
function boxOf(design: ShipDesign, module: number, bx: number, by: number, angle: number, out: Box): void {
  const m = design.modules[module]!;
  const c = cos(angle);
  const s = sin(angle);
  out.x = bx + m.x * c - m.y * s;
  out.y = by + m.x * s + m.y * c;
  const own = angle + m.angle;
  out.ux = cos(own);
  out.uy = sin(own);
  out.halfLength = m.spec.length * 0.5;
  out.halfWidth = m.spec.width * 0.5;
  out.radius = sqrt(out.halfLength * out.halfLength + out.halfWidth * out.halfWidth);
}

/**
 * Every module of a hull, in the world.
 *
 * Built once per hull per pair rather than once per module pair: the boxes
 * cost two of our own sines apiece, and a thirteen-module ship against another
 * is a hundred and sixty-nine pairs that would otherwise rebuild them.
 */
function boxesOf(
  design: ShipDesign,
  bx: number,
  by: number,
  angle: number,
  out: Box[],
): void {
  for (let m = 0; m < design.modules.length; m++) {
    if (out.length <= m) {
      out.push({ x: 0, y: 0, ux: 1, uy: 0, halfLength: 0, halfWidth: 0, radius: 0 });
    }
    boxOf(design, m, bx, by, angle, out[m]!);
  }
}

/** How far a box reaches along an axis from its centre. */
function reach(box: Box, ax: number, ay: number): number {
  // The across axis is the along axis turned a quarter turn: (-uy, ux).
  return (
    abs(box.halfLength * (box.ux * ax + box.uy * ay)) +
    abs(box.halfWidth * (-box.uy * ax + box.ux * ay))
  );
}

/**
 * The middle of the region two overlapping boxes share, written into `point`.
 *
 * The middle rather than the deepest corner, which is the difference between a
 * hull that shoves and a hull that spins: two boxes meeting face to face share
 * a strip of face, and the force acts through the middle of it. Taking a
 * corner instead invents a lever arm, and two ships meeting squarely nose to
 * nose would come apart tumbling.
 *
 * Measured along the contact normal and across it, which are orthogonal, so
 * the two midpoints are the point.
 */
function contactPoint(a: Box, b: Box, nx: number, ny: number): void {
  const tx = -ny;
  const ty = nx;

  // Across the normal: the strip both boxes cover.
  const alongT = a.x * tx + a.y * ty;
  const bAlongT = b.x * tx + b.y * ty;
  const lo = max(alongT - reach(a, tx, ty), bAlongT - reach(b, tx, ty));
  const hi = min(alongT + reach(a, tx, ty), bAlongT + reach(b, tx, ty));
  const across = (lo + hi) * 0.5;

  // Along it: between the face of one and the face of the other.
  const faceA = a.x * nx + a.y * ny + reach(a, nx, ny);
  const faceB = b.x * nx + b.y * ny - reach(b, nx, ny);
  const depth = (faceA + faceB) * 0.5;

  point.x = nx * depth + tx * across;
  point.y = ny * depth + ty * across;
}

/** Scratch, so finding contacts allocates nothing after the first few steps. */
const boxesA: Box[] = [];
const boxesB: Box[] = [];
/** The bodies that have hulls this step, and what they are built from. */
const solid: number[] = [];
const solidDesigns: ShipDesign[] = [];
const point = { x: 0, y: 0 };
const axes = new Float64Array(8);

/**
 * The shallowest way to push two boxes apart, or nothing if they are clear.
 *
 * Separating-axis test over the four face normals, which is all a pair of
 * rectangles has. Returns the overlap along the best axis, with the axis
 * written into `axes[0..1]` pointing from A towards B.
 */
function overlap(a: Box, b: Box): number {
  axes[0] = a.ux;
  axes[1] = a.uy;
  axes[2] = -a.uy;
  axes[3] = a.ux;
  axes[4] = b.ux;
  axes[5] = b.uy;
  axes[6] = -b.uy;
  axes[7] = b.ux;

  const dx = b.x - a.x;
  const dy = b.y - a.y;

  let best = Infinity;
  let bestX = 0;
  let bestY = 0;
  for (let k = 0; k < 8; k += 2) {
    const ax = axes[k]!;
    const ay = axes[k + 1]!;
    const centres = dx * ax + dy * ay;
    const gap = reach(a, ax, ay) + reach(b, ax, ay) - abs(centres);
    // A single axis with daylight along it is a proof of separation.
    if (gap <= 0) return 0;
    if (gap < best) {
      best = gap;
      // Always from A towards B, so the impulse has a side to push from.
      bestX = centres < 0 ? -ax : ax;
      bestY = centres < 0 ? -ay : ay;
    }
  }
  axes[0] = bestX;
  axes[1] = bestY;
  return best;
}

/**
 * Find every pair of hulls that are overlapping, one contact per pair.
 *
 * **Every body against every other**, per §4: at a few hundred bodies that is
 * cheaper than building an index to avoid it, and the bounding-circle test
 * rejects all but a handful of pairs in a couple of multiplications.
 *
 * One contact per pair — the deepest module meeting the deepest module — which
 * is the approximation this makes. A manifold of two points would hold two
 * hulls flat against each other; nothing in space presses them together for
 * long enough to need it.
 */
export function findContacts(bodies: Bodies, hulls: HullDesigns, out: Contacts): void {
  out.clear();

  // The hulls, once. Asking which body has which design inside the pair loop
  // would ask it forty-five thousand times a step in a three-hundred-ship
  // action, and the answer cannot change while the loop runs.
  solid.length = 0;
  solidDesigns.length = 0;
  for (let i = 0; i < bodies.highWater; i++) {
    if (bodies.alive[i] === 0 || bodies.ghost[i] === 1) continue;
    const design = hulls.designOf(i);
    if (design === null) continue;
    solid.push(i);
    solidDesigns.push(design);
  }

  for (let a = 0; a < solid.length; a++) {
    const i = solid[a]!;
    const designA = solidDesigns[a]!;
    // Built on the first pair that gets past the circles, and not at all for a
    // ship nothing is near — which is most of them, most of the time.
    let builtA = false;

    for (let b = a + 1; b < solid.length; b++) {
      const j = solid[b]!;
      const designB = solidDesigns[b]!;

      // Could they have met at all? Bounding circles, as the broad phase.
      const dx = bodies.x[j]! - bodies.x[i]!;
      const dy = bodies.y[j]! - bodies.y[i]!;
      const reach = bodies.radius[i]! + bodies.radius[j]!;
      if (dx * dx + dy * dy > reach * reach) continue;

      if (!builtA) {
        boxesOf(designA, bodies.x[i]!, bodies.y[i]!, bodies.angle[i]!, boxesA);
        builtA = true;
      }
      boxesOf(designB, bodies.x[j]!, bodies.y[j]!, bodies.angle[j]!, boxesB);

      let deepest = 0;
      let deepestX = 0;
      let deepestY = 0;
      let deepestNx = 0;
      let deepestNy = 0;
      let moduleA = -1;
      let moduleB = -1;

      for (let ma = 0; ma < designA.modules.length; ma++) {
        const boxA = boxesA[ma]!;
        for (let mb = 0; mb < designB.modules.length; mb++) {
          const boxB = boxesB[mb]!;
          // Corner circles first: most module pairs on two hulls that are
          // touching somewhere are nowhere near each other.
          const mx = boxB.x - boxA.x;
          const my = boxB.y - boxA.y;
          const corners = boxA.radius + boxB.radius;
          if (mx * mx + my * my > corners * corners) continue;

          const depth = overlap(boxA, boxB);
          if (!(depth > deepest)) continue;

          const nx = axes[0]!;
          const ny = axes[1]!;
          contactPoint(boxA, boxB, nx, ny);
          deepest = depth;
          deepestNx = nx;
          deepestNy = ny;
          deepestX = point.x;
          deepestY = point.y;
          moduleA = ma;
          moduleB = mb;
        }
      }

      if (deepest > 0) {
        out.push(i, j, deepestX, deepestY, deepestNx, deepestNy, deepest, moduleA, moduleB);
      }
    }
  }
}

/**
 * Turn the contacts into impulses, and push the hulls out of each other.
 *
 * One pass, in contact order. Each contact is solved as if it were the only
 * one, which is what "single pass" costs and what §4 says is affordable: a
 * second contact on the same hull in the same step is already the rare case,
 * and a third is a pile-up that does not happen without gravity to make one.
 */
export function resolveContacts(bodies: Bodies, contacts: Contacts): void {
  for (let k = 0; k < contacts.count; k++) {
    const a = contacts.a[k]!;
    const b = contacts.b[k]!;
    const nx = contacts.nx[k]!;
    const ny = contacts.ny[k]!;

    // Arms from each centre of mass to the contact, which is what turns a
    // glancing hit into a spin.
    const rax = contacts.x[k]! - bodies.x[a]!;
    const ray = contacts.y[k]! - bodies.y[a]!;
    const rbx = contacts.x[k]! - bodies.x[b]!;
    const rby = contacts.y[k]! - bodies.y[b]!;

    // Velocity of each hull *at the contact*, its spin included.
    const vax = bodies.vx[a]! - bodies.angularVel[a]! * ray;
    const vay = bodies.vy[a]! + bodies.angularVel[a]! * rax;
    const vbx = bodies.vx[b]! - bodies.angularVel[b]! * rby;
    const vby = bodies.vy[b]! + bodies.angularVel[b]! * rbx;

    const vn = (vbx - vax) * nx + (vby - vay) * ny;
    // Already coming apart: they met on an earlier step and are leaving.
    if (vn >= 0) continue;
    contacts.closing[k] = -vn;

    const crossA = rax * ny - ray * nx;
    const crossB = rbx * ny - rby * nx;
    const invMassSum =
      bodies.invMass[a]! +
      bodies.invMass[b]! +
      crossA * crossA * bodies.invInertia[a]! +
      crossB * crossB * bodies.invInertia[b]!;
    // Two immovable objects. Neither can give, so nothing happens to either.
    if (!(invMassSum > 0)) continue;

    const impulse = (-(1 + RESTITUTION) * vn) / invMassSum;
    contacts.impulse[k] = impulse;
    const jx = impulse * nx;
    const jy = impulse * ny;

    bodies.vx[a]! -= jx * bodies.invMass[a]!;
    bodies.vy[a]! -= jy * bodies.invMass[a]!;
    bodies.angularVel[a]! -= crossA * impulse * bodies.invInertia[a]!;
    bodies.vx[b]! += jx * bodies.invMass[b]!;
    bodies.vy[b]! += jy * bodies.invMass[b]!;
    bodies.angularVel[b]! += crossB * impulse * bodies.invInertia[b]!;

    // And out of each other, or a fast hull meeting a heavy one sinks into it
    // faster than the impulse can carry it back out.
    const correction = (max(contacts.depth[k]! - PENETRATION_SLOP, 0) * CORRECTION) / invMassSum;
    bodies.x[a]! -= correction * nx * bodies.invMass[a]!;
    bodies.y[a]! -= correction * ny * bodies.invMass[a]!;
    bodies.x[b]! += correction * nx * bodies.invMass[b]!;
    bodies.y[b]! += correction * ny * bodies.invMass[b]!;
  }
}

/**
 * Finding and resolving together, with the contacts kept for whatever wants to
 * read them — a damage model, or a renderer drawing where two hulls met.
 *
 * Call it after the world has stepped and before the index is rebuilt: the
 * impulse belongs to the positions the hulls actually reached.
 */
export class Collisions {
  readonly contacts = new Contacts();

  step(bodies: Bodies, hulls: HullDesigns): void {
    findContacts(bodies, hulls, this.contacts);
    resolveContacts(bodies, this.contacts);
  }
}
