import type { Bodies } from './bodies.js';
import type { WellSpec } from './gravity.js';
import { wellPull } from './gravity.js';
import { sqrt } from './math.js';
import { RayHit, type SpatialGrid } from './spatialGrid.js';

/**
 * Projectiles: shells, slugs and other ballistic rounds in flight.
 *
 * **A torpedo is not a projectile.** DESIGN.md §2 settles that a torpedo is a
 * strike craft carrying a warhead in place of a gun — so it thrusts, steers,
 * picks its own targets, obeys doctrine and collides, none of which a swept
 * segment can do. It is a *body*, and it belongs with the fighters.
 *
 * The discriminator is **propulsion and guidance, not lethality or size**. What
 * belongs here is anything launched that thereafter merely *falls*, with nothing
 * but physics acting on it. A one-tonne kinetic penetrator is a projectile; a
 * tiny guided munition is not.
 *
 * Beams are neither. A laser is an instantaneous cast against the index with no
 * store and no flight time at all.
 *
 * A projectile is **not a rigid body**. It is a position, a velocity and a
 * payload in a flat array, and a step of its flight is a *swept segment* tested
 * against the spatial index. Two consequences follow, and both are the reason
 * for the design:
 *
 *  - **Tunnelling is impossible.** A body moved forward and then tested where it
 *    landed can pass clean through a hull between one step and the next, and the
 *    usual patch is to raycast afterwards and teleport it back. Casting the
 *    whole step as one segment is that algorithm done in the right place.
 *  - **It is far cheaper.** No rigid body, no mass properties, no integration
 *    into the collision graph. Thousands of rounds in the air are an array walk.
 *
 * Unlike bodies, projectiles get plain integer indices rather than generational
 * handles. Nothing holds a reference to a round across steps: it is spawned,
 * flies, and is consumed on impact or expiry, all inside the system that owns
 * it. Handles exist to catch stale references, and there are none to catch.
 *
 * Impacts are *reported*, not applied — and that includes not deciding whether
 * the round survives. On impact a round is parked at the point of contact and
 * marked **pending**: it stops moving and stops being cast, and waits for
 * something else to say what became of it.
 *
 * That is what lets terminal ballistics live outside this file. A round that
 * penetrates is consumed with `kill`; one that embeds in the hull is consumed
 * after its mass and momentum are transferred; one that deflects has its
 * velocity rewritten and is returned to flight with `resume`. Ballistics does
 * not need to know which, and consuming a round unilaterally would already be
 * applying an outcome.
 *
 * Because the round is still alive when its hit is reported, the hit record
 * carries only what the *cast* discovered — which body, where, when in the step
 * and the surface normal. Mass, velocity, remaining flight time and payload are
 * read straight from the store by index, so there is no second copy to diverge.
 */

/** A projectile with no firing ship to pass through. */
export const NO_OWNER = -1;

export interface ProjectileSpec {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds of flight before the round expires. */
  ttl: number;
  /** Used for imparted momentum, and for the mass gained if the round embeds. */
  mass?: number;
  damage?: number;
  /** How deeply the round reaches into a hull's internals. */
  penetration?: number;
  /**
   * A body *index* the round passes through — the firing ship, normally, so a
   * turret does not shoot its own hull.
   */
  owner?: number;
  /** Caller-defined classification (AP, HE, and so on). Uninterpreted here. */
  kind?: number;
}

/**
 * Impacts from one step, in projectile order. Reused between steps so that
 * reporting hits allocates nothing.
 */
export class ProjectileHits {
  /** Index of the round, which is still alive and pending resolution. */
  projectile: Int32Array;
  /** Body index struck. */
  body: Int32Array;
  /**
   * Where in the step the impact happened, 0 to 1. A deflected round has
   * `(1 - t) * dt` of its step left, and the remainder is what a substep would
   * carry forward.
   */
  t: Float64Array;
  x: Float64Array;
  y: Float64Array;
  /**
   * Outward unit surface normal at the impact point — what decides incidence
   * angle, and therefore whether an oblique hit skids off armour.
   *
   * Exact for the bounding circles the broad phase tests. Once hulls are
   * polygons this becomes the narrow phase's to supply, which is why it is
   * reported rather than left for the caller to infer.
   */
  nx: Float64Array;
  ny: Float64Array;
  count = 0;

  constructor(capacity = 256) {
    this.projectile = new Int32Array(capacity);
    this.body = new Int32Array(capacity);
    this.t = new Float64Array(capacity);
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.nx = new Float64Array(capacity);
    this.ny = new Float64Array(capacity);
  }

  clear(): void {
    this.count = 0;
  }

  private grow(): void {
    const size = this.projectile.length * 2;
    const i32 = (old: Int32Array): Int32Array => {
      const next = new Int32Array(size);
      next.set(old);
      return next;
    };
    const f64 = (old: Float64Array): Float64Array => {
      const next = new Float64Array(size);
      next.set(old);
      return next;
    };
    this.projectile = i32(this.projectile);
    this.body = i32(this.body);
    this.t = f64(this.t);
    this.x = f64(this.x);
    this.y = f64(this.y);
    this.nx = f64(this.nx);
    this.ny = f64(this.ny);
  }

  /** Append an impact. Called by `Projectiles.step`. */
  push(
    projectile: number,
    body: number,
    t: number,
    x: number,
    y: number,
    nx: number,
    ny: number,
  ): void {
    if (this.count === this.projectile.length) this.grow();
    const i = this.count++;
    this.projectile[i] = projectile;
    this.body[i] = body;
    this.t[i] = t;
    this.x[i] = x;
    this.y[i] = y;
    this.nx[i] = nx;
    this.ny[i] = ny;
  }
}

export class Projectiles {
  x!: Float64Array;
  y!: Float64Array;
  vx!: Float64Array;
  vy!: Float64Array;
  ttl!: Float64Array;
  mass!: Float64Array;
  damage!: Float64Array;
  penetration!: Float64Array;
  owner!: Int32Array;
  kind!: Int32Array;
  alive!: Uint8Array;
  /**
   * Set on impact. A pending round is stopped at the point of contact and is
   * not cast again until something resolves it — see the note at the top of
   * this file.
   */
  pending!: Uint8Array;

  capacity = 0;
  /** Rounds currently in flight, including those awaiting resolution. */
  count = 0;
  /** Rounds stopped at an impact, awaiting resolution. */
  pendingCount = 0;
  /** One past the highest slot ever used; loops may stop here. */
  highWater = 0;

  private free: number[] = [];
  private readonly hit = new RayHit();

  constructor(initialCapacity = 1024) {
    this.grow(initialCapacity);
  }

  private grow(capacity: number): void {
    const f64 = (old: Float64Array | undefined): Float64Array => {
      const next = new Float64Array(capacity);
      if (old) next.set(old);
      return next;
    };
    const i32 = (old: Int32Array | undefined): Int32Array => {
      const next = new Int32Array(capacity);
      if (old) next.set(old);
      return next;
    };
    this.x = f64(this.x);
    this.y = f64(this.y);
    this.vx = f64(this.vx);
    this.vy = f64(this.vy);
    this.ttl = f64(this.ttl);
    this.mass = f64(this.mass);
    this.damage = f64(this.damage);
    this.penetration = f64(this.penetration);
    this.owner = i32(this.owner);
    this.kind = i32(this.kind);

    const alive = new Uint8Array(capacity);
    if (this.alive) alive.set(this.alive);
    this.alive = alive;

    const pending = new Uint8Array(capacity);
    if (this.pending) pending.set(this.pending);
    this.pending = pending;

    this.capacity = capacity;
  }

  /**
   * Put a round in the air, allocating nothing. Returns its index.
   *
   * The long argument list is deliberate: firing is frequent enough that the
   * gunnery code should not have to build an options object per shot.
   */
  spawnRaw(
    x: number,
    y: number,
    vx: number,
    vy: number,
    ttl: number,
    mass: number,
    damage: number,
    penetration: number,
    owner: number,
    kind: number,
  ): number {
    let i: number;
    const reused = this.free.pop();
    if (reused !== undefined) {
      i = reused;
    } else {
      if (this.highWater >= this.capacity) this.grow(this.capacity * 2);
      i = this.highWater++;
    }

    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.ttl[i] = ttl;
    this.mass[i] = mass;
    this.damage[i] = damage;
    this.penetration[i] = penetration;
    this.owner[i] = owner;
    this.kind[i] = kind;
    this.alive[i] = 1;
    this.pending[i] = 0;
    this.count++;
    return i;
  }

  /** `spawnRaw` with named fields and defaults, for setup code and tests. */
  spawn(spec: ProjectileSpec): number {
    return this.spawnRaw(
      spec.x,
      spec.y,
      spec.vx,
      spec.vy,
      spec.ttl,
      spec.mass ?? 1,
      spec.damage ?? 0,
      spec.penetration ?? 0,
      spec.owner ?? NO_OWNER,
      spec.kind ?? 0,
    );
  }

  /**
   * Remove a round from flight — it penetrated, embedded, detonated or expired.
   * Safe to call on an already-dead slot.
   */
  kill(i: number): void {
    if (i < 0 || i >= this.highWater || this.alive[i] === 0) return;
    if (this.pending[i] === 1) {
      this.pending[i] = 0;
      this.pendingCount--;
    }
    this.alive[i] = 0;
    this.free.push(i);
    this.count--;
  }

  /**
   * Return a pending round to flight, after a deflection has rewritten its
   * velocity. The round resumes from the impact point on the next step.
   *
   * A caller that neither kills nor resumes a pending round leaves it stopped
   * in space indefinitely — visible in `pendingCount`, rather than silently
   * re-reporting the same impact every step.
   */
  resume(i: number): void {
    if (i < 0 || i >= this.highWater || this.alive[i] === 0) return;
    if (this.pending[i] === 0) return;
    this.pending[i] = 0;
    this.pendingCount--;
  }

  /** Remove every round. */
  clear(): void {
    for (let i = 0; i < this.highWater; i++) {
      this.alive[i] = 0;
      this.pending[i] = 0;
    }
    this.free.length = 0;
    this.count = 0;
    this.pendingCount = 0;
    this.highWater = 0;
  }

  /**
   * Advance every round by one step, reporting impacts into `hits`.
   *
   * **`grid` must have been rebuilt from `bodies` at their current positions.**
   * Casting against a stale index is the one way to get this wrong, and it
   * fails quietly — rounds pass through hulls that have moved. The step order
   * is: advance bodies, rebuild the index, then advance projectiles.
   *
   * `wells` curves the rounds under gravity. Velocity is updated before the
   * segment is cast, so the path within a step is treated as straight — an
   * approximation whose error is dominated by the step length, and rounds live
   * for seconds rather than orbits, so a first-order scheme is ample here. The
   * scheme that has to behave over thousands of steps is the one in `world.ts`.
   */
  step(
    dt: number,
    bodies: Bodies,
    grid: SpatialGrid,
    hits: ProjectileHits,
    wells?: readonly WellSpec[],
  ): void {
    hits.clear();
    const hit = this.hit;

    for (let i = 0; i < this.highWater; i++) {
      if (this.alive[i] === 0 || this.pending[i] === 1) continue;

      if (wells !== undefined) {
        let ax = 0;
        let ay = 0;
        for (let w = 0; w < wells.length; w++) {
          const well = wells[w]!;
          const pull = wellPull(well, this.x[i], this.y[i]);
          ax += (well.x - this.x[i]) * pull;
          ay += (well.y - this.y[i]) * pull;
        }
        this.vx[i] += ax * dt;
        this.vy[i] += ay * dt;
      }

      const x0 = this.x[i];
      const y0 = this.y[i];
      const dx = this.vx[i] * dt;
      const dy = this.vy[i] * dt;

      if (grid.raycast(bodies, x0, y0, x0 + dx, y0 + dy, hit, this.owner[i])) {
        // Outward surface normal. Exact for a bounding circle; a polygon narrow
        // phase would supply the struck edge's normal instead.
        const bi = hit.bodyIndex;
        const ox = hit.x - bodies.x[bi];
        const oy = hit.y - bodies.y[bi];
        const olen = sqrt(ox * ox + oy * oy);
        // A round starting exactly at the centre has no meaningful normal;
        // oppose its travel, which is the only defensible answer.
        const oinv = olen > 0 ? 1 / olen : 0;
        const seglen = sqrt(dx * dx + dy * dy);
        const sinv = seglen > 0 ? 1 / seglen : 0;
        const nx = olen > 0 ? ox * oinv : -dx * sinv;
        const ny = olen > 0 ? oy * oinv : -dy * sinv;

        // Stop at the point of contact and wait to be resolved. The round is
        // deliberately left alive: see the note at the top of this file.
        this.x[i] = hit.x;
        this.y[i] = hit.y;
        this.pending[i] = 1;
        this.pendingCount++;
        hits.push(i, bi, hit.t, hit.x, hit.y, nx, ny);
        continue;
      }

      this.x[i] = x0 + dx;
      this.y[i] = y0 + dy;
      this.ttl[i] -= dt;
      if (this.ttl[i] <= 0) this.kill(i);
    }
  }

  /**
   * Muzzle velocity is added to the firing body's own velocity, so a round
   * fired from a ship under way inherits its motion. Returns the index.
   *
   * The lead a turret needs in order to *hit* something is the aiming problem,
   * not this one; this only makes the round leave the barrel correctly.
   */
  fireFrom(
    bodies: Bodies,
    bodyIndex: number,
    muzzleX: number,
    muzzleY: number,
    muzzleVx: number,
    muzzleVy: number,
    ttl: number,
    mass: number,
    damage: number,
    penetration: number,
    kind: number,
  ): number {
    return this.spawnRaw(
      muzzleX,
      muzzleY,
      bodies.vx[bodyIndex] + muzzleVx,
      bodies.vy[bodyIndex] + muzzleVy,
      ttl,
      mass,
      damage,
      penetration,
      bodyIndex,
      kind,
    );
  }
}
