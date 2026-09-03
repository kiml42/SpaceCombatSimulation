import { cos, min, sin } from './math.js';

/**
 * Planar rigid-body storage.
 *
 * Structure-of-arrays over `Float64Array`s, because the alternative — an array
 * of objects each holding `{x, y}` vectors — allocates continuously and turns
 * GC pauses into frame stutter (DESIGN.md non-negotiable 4).
 *
 * A *module* of a ship is not a body. One ship is one body, with its mass
 * properties baked from its module layout, and modules tracked as data
 * elsewhere. Bodies are created for: ships, severed hull chunks, and debris.
 * Projectiles are not bodies either — they are swept segments (DESIGN.md §4).
 */

/** Maximum simultaneous bodies. Generous: the design targets a few hundred. */
const INDEX_LIMIT = 1 << 20;

/**
 * A handle to a body: `index + generation * INDEX_LIMIT`.
 *
 * The generation counter means a handle to a destroyed body is detectably
 * stale rather than silently addressing whatever was recycled into its slot.
 * Encoded with arithmetic rather than bit shifts so it stays exact past 32
 * bits — a double holds 53 bits of integer, so 20 for the index leaves 33 for
 * the generation.
 */
export type BodyId = number;

export const NO_BODY: BodyId = -1;

export function bodyIndex(id: BodyId): number {
  return id % INDEX_LIMIT;
}

export function bodyGeneration(id: BodyId): number {
  return (id - (id % INDEX_LIMIT)) / INDEX_LIMIT;
}

export interface BodySpec {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  angle?: number;
  angularVel?: number;
  /** Zero or omitted means immovable (infinite mass). */
  mass?: number;
  /** Zero or omitted means non-rotating (infinite moment of inertia). */
  inertia?: number;
  /** Bounding-circle radius, used by the broadphase. */
  radius?: number;
}

export class Bodies {
  /**
   * WARNING: these array references are replaced when the store grows. Never
   * cache them across a call that might create a body — re-read them from the
   * store instead.
   */
  x!: Float64Array;
  y!: Float64Array;
  vx!: Float64Array;
  vy!: Float64Array;
  /** Acceleration, retained between steps for the leapfrog integrator. */
  ax!: Float64Array;
  ay!: Float64Array;

  angle!: Float64Array;
  angularVel!: Float64Array;
  angularAcc!: Float64Array;

  mass!: Float64Array;
  invMass!: Float64Array;
  inertia!: Float64Array;
  invInertia!: Float64Array;

  /** Force and torque accumulators. Cleared at the start of each evaluation. */
  fx!: Float64Array;
  fy!: Float64Array;
  torque!: Float64Array;

  radius!: Float64Array;

  alive!: Uint8Array;
  generation!: Uint32Array;

  capacity = 0;
  /** Number of live bodies. */
  count = 0;
  /** One past the highest index ever used; loops may stop here. */
  highWater = 0;

  private free: number[] = [];

  constructor(initialCapacity = 256) {
    this.grow(initialCapacity);
  }

  private grow(capacity: number): void {
    const previous = this.capacity;
    const f = (old: Float64Array | undefined): Float64Array => {
      const next = new Float64Array(capacity);
      if (old) next.set(old);
      return next;
    };
    this.x = f(this.x);
    this.y = f(this.y);
    this.vx = f(this.vx);
    this.vy = f(this.vy);
    this.ax = f(this.ax);
    this.ay = f(this.ay);
    this.angle = f(this.angle);
    this.angularVel = f(this.angularVel);
    this.angularAcc = f(this.angularAcc);
    this.mass = f(this.mass);
    this.invMass = f(this.invMass);
    this.inertia = f(this.inertia);
    this.invInertia = f(this.invInertia);
    this.fx = f(this.fx);
    this.fy = f(this.fy);
    this.torque = f(this.torque);
    this.radius = f(this.radius);

    const alive = new Uint8Array(capacity);
    if (this.alive) alive.set(this.alive);
    this.alive = alive;

    const generation = new Uint32Array(capacity);
    if (this.generation) generation.set(this.generation);
    // Generations start at 1, so that a valid handle is always >= INDEX_LIMIT
    // and therefore always truthy. Handle 0 is never valid.
    generation.fill(1, previous, capacity);
    this.generation = generation;

    this.capacity = capacity;
  }

  create(spec: BodySpec = {}): BodyId {
    let i: number;
    const reused = this.free.pop();
    if (reused !== undefined) {
      i = reused;
    } else {
      if (this.highWater >= INDEX_LIMIT) {
        throw new Error(`Bodies: exceeded INDEX_LIMIT (${INDEX_LIMIT})`);
      }
      if (this.highWater >= this.capacity) {
        this.grow(min(this.capacity * 2, INDEX_LIMIT));
      }
      i = this.highWater++;
    }

    const mass = spec.mass ?? 0;
    const inertia = spec.inertia ?? 0;

    this.x[i] = spec.x ?? 0;
    this.y[i] = spec.y ?? 0;
    this.vx[i] = spec.vx ?? 0;
    this.vy[i] = spec.vy ?? 0;
    this.ax[i] = 0;
    this.ay[i] = 0;
    this.angle[i] = spec.angle ?? 0;
    this.angularVel[i] = spec.angularVel ?? 0;
    this.angularAcc[i] = 0;
    this.mass[i] = mass;
    this.invMass[i] = mass > 0 ? 1 / mass : 0;
    this.inertia[i] = inertia;
    this.invInertia[i] = inertia > 0 ? 1 / inertia : 0;
    this.fx[i] = 0;
    this.fy[i] = 0;
    this.torque[i] = 0;
    this.radius[i] = spec.radius ?? 0;
    this.alive[i] = 1;
    this.count++;

    return i + this.generation[i] * INDEX_LIMIT;
  }

  destroy(id: BodyId): void {
    const i = this.indexOf(id);
    if (i < 0) return;
    this.alive[i] = 0;
    // Bump the generation so existing handles to this slot become stale.
    this.generation[i] = (this.generation[i] + 1) >>> 0;
    this.free.push(i);
    this.count--;
  }

  /** The array index for a handle, or -1 if the handle is stale. */
  indexOf(id: BodyId): number {
    if (id < 0) return -1;
    const i = id % INDEX_LIMIT;
    if (i >= this.highWater) return -1;
    if (this.alive[i] === 0) return -1;
    const gen = (id - i) / INDEX_LIMIT;
    return this.generation[i] === gen ? i : -1;
  }

  isAlive(id: BodyId): boolean {
    return this.indexOf(id) >= 0;
  }

  setMass(id: BodyId, mass: number): void {
    const i = this.indexOf(id);
    if (i < 0) return;
    this.mass[i] = mass;
    this.invMass[i] = mass > 0 ? 1 / mass : 0;
  }

  setInertia(id: BodyId, inertia: number): void {
    const i = this.indexOf(id);
    if (i < 0) return;
    this.inertia[i] = inertia;
    this.invInertia[i] = inertia > 0 ? 1 / inertia : 0;
  }

  // --- Force application ---------------------------------------------------

  /** A world-frame force through the centre of mass. Produces no torque. */
  applyForce(id: BodyId, fx: number, fy: number): void {
    const i = this.indexOf(id);
    if (i < 0) return;
    this.fx[i] += fx;
    this.fy[i] += fy;
  }

  /** A world-frame force applied at a world-frame point. */
  applyForceAtPoint(id: BodyId, fx: number, fy: number, px: number, py: number): void {
    const i = this.indexOf(id);
    if (i < 0) return;
    this.fx[i] += fx;
    this.fy[i] += fy;
    this.torque[i] += (px - this.x[i]) * fy - (py - this.y[i]) * fx;
  }

  /**
   * A body-frame force applied at a body-frame point — the thruster case, and
   * the reason it exists as one call: doing it from outside would need either
   * an allocated vector or two rotations of the same angle.
   */
  applyLocalForceAtLocalPoint(
    id: BodyId,
    localFx: number,
    localFy: number,
    localPx: number,
    localPy: number,
  ): void {
    const i = this.indexOf(id);
    if (i < 0) return;
    const c = cos(this.angle[i]);
    const s = sin(this.angle[i]);
    const wfx = localFx * c - localFy * s;
    const wfy = localFx * s + localFy * c;
    this.fx[i] += wfx;
    this.fy[i] += wfy;
    // Torque is frame-independent, so use the body-frame lever and force.
    this.torque[i] += localPx * localFy - localPy * localFx;
  }

  applyTorque(id: BodyId, t: number): void {
    const i = this.indexOf(id);
    if (i < 0) return;
    this.torque[i] += t;
  }

  clearForces(): void {
    this.fx.fill(0, 0, this.highWater);
    this.fy.fill(0, 0, this.highWater);
    this.torque.fill(0, 0, this.highWater);
  }
}
