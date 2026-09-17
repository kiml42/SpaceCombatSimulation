import type { Bodies } from './bodies.js';
import { sqrt } from './math.js';
import { RayHit, type SpatialGrid, MAX_CELLS_PER_RAY } from './spatialGrid.js';
import { NO_OWNER } from './projectiles.js';
import type { Hulls } from './hull.js';

/**
 * Beams: lasers, particle beams, and anything else taken to go from its
 * emitter to its target instantaneously.
 *
 * Hits are *reported*, not applied.
 *
 * A beam is a segment rather than a moving point, which is the whole of what
 * separates this from `Projectiles`: `start` and `end` are both positions,
 * nothing advances between steps, and a beam has already struck whatever it is
 * going to strike by the time `shoot` returns.
 */

/**
 * How far a beam is drawn out from its muzzle, metres.
 *
 * A beam has no natural range. Nothing slows it, and until intensity falls off
 * with distance nothing weakens it either — so this is a culling distance and
 * not a rule about how far a laser shoots, the same kind of quantity as a
 * round's flight time. It wants to sit comfortably past any engagement range
 * and no further: every metre is grid cells a cast walks through before it can
 * report a miss, and a missing beam pays for all of them.
 *
 * Ten kilometres is about five times the longest range the shipped scenarios
 * fight at, and costs about 156 cells a cast.
 *
 * It must also stay inside what the index will actually cast. `SpatialGrid`
 * gives up after `MAX_CELLS_PER_RAY` cells, so a beam longer than
 * `MAX_CELLS_PER_RAY * cellSize` is silently cut short — at the 64 m cells the
 * scenarios use that limit is 262 km, which this is comfortably within. The
 * cell size is the grid's rather than this module's, so the relationship is
 * documented and asserted at the call site rather than computed here.
 */
export const MAX_BEAM_LENGTH = 10_000;

/** Longest beam the index can cast through a grid of this cell size, metres. */
export function castableBeamLength(cellSize: number): number {
  return MAX_CELLS_PER_RAY * cellSize;
}

export interface BeamSpec {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  width: number;
  power: number;
  /**
   * A body *index* the beam passes through — the firing ship, normally, so a
   * turret does not shoot its own hull. - temporary until we set up the two layer world model.
   */
  owner?: number;
  /** Caller-defined classification (laser, particle beam, and so on). Uninterpreted here. */
  kind?: number;
}

/**
 * Impacts from one step, in the order the beams were fired. Reused between
 * steps so that reporting hits allocates nothing.
 *
 * Whoever reads it clears it: firing appends, so a caller that forgets reports
 * every earlier step's hits again.
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
   * The face of the module struck when a hull was cast against; the circle's
   * own normal for a body with no hull to cast against.
   */
  nx: Float64Array;
  ny: Float64Array;
  /**
   * Index into the struck ship's `design.modules`, or -1 where the hit was
   * against a bounding circle and no module is known.
   */
  module: Int32Array;
  count = 0;

  constructor(capacity = 256) {
    this.beam = new Int32Array(capacity);
    this.body = new Int32Array(capacity);
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.nx = new Float64Array(capacity);
    this.ny = new Float64Array(capacity);
    this.module = new Int32Array(capacity);
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
    this.module = i32(this.module);
  }

  /** Append an impact. Called as each beam is cast. */
  push(
    beam: number,
    body: number,
    x: number,
    y: number,
    nx: number,
    ny: number,
    module = -1,
  ): void {
    if (this.count === this.beam.length) this.grow();
    const i = this.count++;
    this.beam[i] = beam;
    this.body[i] = body;
    this.x[i] = x;
    this.y[i] = y;
    this.nx[i] = nx;
    this.ny[i] = ny;
    this.module[i] = module;
  }
}

export class Beams {
  startX!: Float64Array;
  startY!: Float64Array;
  endX!: Float64Array;
  endY!: Float64Array;
  width!: Float64Array;
  power!: Float64Array;
  owner!: Int32Array;
  kind!: Int32Array;
  alive!: Uint8Array;
  /**
   * Set on impact. A struck beam is truncated at the point of contact and is
   * left alive, because what a hit *does* belongs to the damage model and it
   * cannot decide that about a beam already thrown away.
   */
  pending!: Uint8Array;

  capacity = 0;
  /** Beams present this step, including those awaiting resolution. */
  count = 0;
  /** Beams stopped at an impact, awaiting resolution. */
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
    this.power = f64(this.power);
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
  private shootRaw(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    width: number,
    power: number,
    owner: number,
    kind: number,
    bodies: Bodies,
    grid: SpatialGrid,
    hits: BeamHits,
    hulls?: Hulls,
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
    this.power[i] = power;
    this.owner[i] = owner;
    this.kind[i] = kind;
    this.alive[i] = 1;
    this.pending[i] = 0;
    this.count++;

    this.detectHits(i, bodies, grid, hits, hulls)

    return i;
  }

  /** `shootRaw` with named fields and defaults, for setup code and tests. */
  shoot(
    spec: BeamSpec,
    bodies: Bodies,
    grid: SpatialGrid,
    hits: BeamHits,
    hulls?: Hulls,
  ): number {
    return this.shootRaw(
      spec.startX,
      spec.startY,
      spec.endX,
      spec.endY,
      spec.width,
      spec.power,
      spec.owner ?? NO_OWNER,
      spec.kind ?? 0,
      bodies,
      grid,
      hits,
      hulls,
    );
  }

  /** Remove a beam. Safe to call on an already-dead slot. */
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

  /** Remove every beam. */
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
  private detectHits(
    i: number,
    bodies: Bodies,
    grid: SpatialGrid,
    hits: BeamHits,
    hulls?: Hulls,
  ): void {
    const hit = this.hit;
    if (this.alive[i] === 0 || this.pending[i] === 1) return;

    const startX = this.startX[i];
    const startY = this.startY[i];
    const endX = this.endX[i];
    const endY = this.endY[i];

    if (grid.raycast(bodies, startX, startY, endX, endY, hit, this.owner[i], hulls)) {
      const bi = hit.bodyIndex;
      const dx = endX - startX;
      const dy = endY - startY;
      let module = -1;
      let nx = 0;
      let ny = 0;
      // The face of the module met, where there was a hull to meet. A body
      // with no design keeps the circle's own normal.
      if (hulls !== undefined && hulls.describe(bodies, bi, startX, startY, dx, dy)) {
        module = hulls.module;
        nx = hulls.nx;
        ny = hulls.ny;
      }
      if (nx === 0 && ny === 0) {
        const ox = hit.x - bodies.x[bi];
        const oy = hit.y - bodies.y[bi];
        const olen = sqrt(ox * ox + oy * oy);
        // A beam starting exactly at a body's centre has no meaningful outward
        // normal; oppose its travel, which is the only defensible answer.
        const oinv = olen > 0 ? 1 / olen : 0;
        const seglen = sqrt(dx * dx + dy * dy);
        const sinv = seglen > 0 ? 1 / seglen : 0;
        nx = olen > 0 ? ox * oinv : -dx * sinv;
        ny = olen > 0 ? oy * oinv : -dy * sinv;
      }

      // Stop at the point of contact and wait to be resolved. The beam is
      // deliberately left alive, for the damage model to read.
      this.endX[i] = hit.x;
      this.endY[i] = hit.y;
      this.pending[i] = 1;
      this.pendingCount++;
      hits.push(i, bi, hit.x, hit.y, nx, ny, module);

      // Reflection will make this a loop rather than a single cast, and the
      // trap waiting there is recorded in ROADMAP.md §12: a deflected beam
      // resumes *on* the surface it bounced off, so any new heading that does
      // not lead away from that body's centre strikes it again at zero
      // distance and the beam sticks.
    }
  }

  /**
   * Fire a beam from a muzzle along a heading, out to `MAX_BEAM_LENGTH`.
   * Returns the index.
   *
   * Unlike a round, a beam inherits nothing from the firing ship's motion:
   * there is no flight time for that motion to act over. Where to *point* is
   * the aiming problem and not this one.
   *
   * `muzzleDirectionX` and `muzzleDirectionY` must be a unit vector.
   */
  fireFrom(
    bodyIndex: number,
    muzzleX: number,
    muzzleY: number,
    muzzleDirectionX: number,
    muzzleDirectionY: number,
    width: number,
    power: number,
    kind: number,
    bodies: Bodies,
    grid: SpatialGrid,
    hits: BeamHits,
    hulls?: Hulls,
  ): number {
    return this.shootRaw(
      muzzleX,
      muzzleY,
      muzzleX + muzzleDirectionX * MAX_BEAM_LENGTH,
      muzzleY + muzzleDirectionY * MAX_BEAM_LENGTH,
      width,
      power,
      bodyIndex,
      kind,
      bodies,
      grid,
      hits,
      hulls,
    );
  }
}
