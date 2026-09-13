import type { Bodies } from './bodies.js';
import { sqrt } from './math.js';
import { RayHit, type SpatialGrid } from './spatialGrid.js';
import { NO_OWNER } from './projectiles.js';

/**
 * Beams: lasers, particle beams anything else that's considered to go from its
 * emitter to the target instantaneously.
 *
 * Hits are *reported*, not applied.
 */

export interface BeamSpec {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  width: number;
  /**
   * A body *index* the beam passes through — the firing ship, normally, so a
   * turret does not shoot its own hull. - temporary until we set up the two layer world model.
   */
  owner?: number;
  /** Caller-defined classification (laser, particle beam, and so on). Uninterpreted here. */
  kind?: number;
}

/**
 * Impacts from one step, in projectile order. Reused between steps so that
 * reporting hits allocates nothing.
 */
export class BeamHits {
  /** Index of the beam, which is still alive and pending resolution. */
  beam: Int32Array;
  /** Body index struck. */
  body: Int32Array;
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
    this.beam = new Int32Array(capacity);
    this.body = new Int32Array(capacity);
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.nx = new Float64Array(capacity);
    this.ny = new Float64Array(capacity);
  }

  clear(): void {
    this.count = 0;
  }

  private grow(): void {
    const size = this.beam.length * 2;
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
    this.beam = i32(this.beam);
    this.body = i32(this.body);
    this.x = f64(this.x);
    this.y = f64(this.y);
    this.nx = f64(this.nx);
    this.ny = f64(this.ny);
  }

  /** Append an impact. Called by `Projectiles.step`. */
  push(
    beam: number,
    body: number,
    x: number,
    y: number,
    nx: number,
    ny: number,
  ): void {
    if (this.count === this.beam.length) this.grow();
    const i = this.count++;
    this.beam[i] = beam;
    this.body[i] = body;
    this.x[i] = x;
    this.y[i] = y;
    this.nx[i] = nx;
    this.ny[i] = ny;
  }
}

export class Beams {
  startX!: Float64Array;
  startY!: Float64Array;
  endX!: Float64Array;
  endY!: Float64Array;
  width!: Float64Array;
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
    this.startX = f64(this.startX);
    this.startY = f64(this.startY);
    this.endX = f64(this.endX);
    this.endY = f64(this.endY);
    this.width = f64(this.width);
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
   * Create a beam for the current step, allocating nothing. Returns its index.
   *
   * The long argument list is deliberate: firing is frequent enough that the
   * gunnery code should not have to build an options object per shot.
   */
  shootRaw(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    width: number,
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

    this.startX[i] = startX;
    this.startY[i] = startY;
    this.endX[i] = endX;
    this.endY[i] = endY;
    this.width[i] = width;
    this.owner[i] = owner;
    this.kind[i] = kind;
    this.alive[i] = 1;
    this.pending[i] = 0;
    this.count++;
    return i;
  }

  /** `spawnRaw` with named fields and defaults, for setup code and tests. */
  shoot(spec: BeamSpec): number {
    return this.shootRaw(
      spec.startX,
      spec.startY,
      spec.endX,
      spec.endY,
      spec.width,
      spec.owner ?? NO_OWNER,
      spec.kind ?? 0,
    );
  }

  /**
   * Remove a beam from the world — it penetrated, embedded, detonated or expired.
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
   * Return a pending beam to flight, after a reflection has rewritten its
   * direction. The beam resumes from the impact point immediately.
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
   * Detect hits.
   */
  detectHits(
    bodies: Bodies,
    grid: SpatialGrid,
    hits: BeamHits,
  ): void {
    hits.clear();
    const hit = this.hit;

    for (let i = 0; i < this.highWater; i++) {
      if (this.alive[i] === 0 || this.pending[i] === 1) continue;

      const startX = this.startX[i];
      const startY = this.startY[i];
      const endX = this.endX[i];
      const endY = this.endY[i];

      if (grid.raycast(bodies, startX, startY, endX, endY, hit, this.owner[i])) {
        // Outward surface normal. Exact for a bounding circle; a polygon narrow
        // phase would supply the struck edge's normal instead.
        const bi = hit.bodyIndex;
        const ox = hit.x - bodies.x[bi];
        const oy = hit.y - bodies.y[bi];
        const dx = endX - startX;
        const dy = endY - startY;
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
        this.endX[i] = hit.x;
        this.endY[i] = hit.y;
        this.pending[i] = 1;
        this.pendingCount++;
        hits.push(i, bi, hit.x, hit.y, nx, ny);
        continue;
      }

      // this.kill(i);
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
    muzzleDirectionX: number,
    muzzleDirectionY: number,
    width: number,
    kind: number,
  ): number {
    // TODO make a sensible constant for the length of a beam.
    return this.shootRaw(
      muzzleX,
      muzzleY,
      muzzleX + muzzleDirectionX * 1000000000,
      muzzleY + muzzleDirectionY * 1000000000,
      width,
      bodyIndex,
      kind,
    );
  }
}
