import type { Bodies } from './bodies.js';
import { sqrt } from './math.js';
import { RayHit, type SpatialGrid, MAX_CELLS_PER_RAY } from './spatialGrid.js';
import { NO_OWNER } from './projectiles.js';
import { HULL_LAYER, WEAPONS_LAYER, type Hulls } from './hull.js';

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
 * Sixty kilometres is twice as far as a round carries — `ROUND_FLIGHT_TIME`
 * at the muzzle velocities these guns reach — so a beam is never the weapon
 * that runs out of range first, which is the property worth having: a beam
 * that stopped short of where shells were still arriving would look broken
 * rather than balanced. It costs about 1,300 cells a cast at 64 m cells, and
 * measured that is a few microseconds.
 *
 * **It must stay inside what the index will actually cast**, and the margin is
 * smaller than the naive arithmetic suggests. `SpatialGrid` gives up after
 * `MAX_CELLS_PER_RAY` cells, and a segment crosses `(|cos a| + |sin a|)/cell`
 * of them per metre — up to √2 times as many as a length-over-cell-size sum
 * says, at 45°. So the true ceiling is `MAX_CELLS_PER_RAY * cellSize / √2`,
 * which at 64 m cells is about 185 km rather than 262. A beam past that is
 * *silently* cut short: the cast stops and reports a miss, with nothing said.
 *
 * `castableBeamLength` computes it from a grid's own cell size, since the cell
 * size belongs to the grid rather than to this module.
 */
export const MAX_BEAM_LENGTH = 60_000;

/**
 * Longest beam the index can cast through a grid of this cell size, metres.
 *
 * Divided by √2 because the worst case is what matters: a beam fired at 45°
 * crosses that many times more cells per metre than one along an axis, and a
 * limit that held only for axis-aligned fire would be no limit at all.
 */
export function castableBeamLength(cellSize: number): number {
  return (MAX_CELLS_PER_RAY * cellSize) / sqrt(2);
}

export interface BeamSpec {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  width: number;
  power: number;
  /**
   * The body *index* that fired it. Passed through entirely unless
   * `fromModule` says which part of it fired, in which case only that part is.
   */
  owner?: number;
  /** The module of `owner` it was fired from, or -1. */
  fromModule?: number;
  /** Fired in the weapons layer, so it meets only weapons-layer modules. */
  weaponsLayer?: boolean;
  /** The layers it is in, as a `HULL_LAYER` / `WEAPONS_LAYER` mask. Overrides `weaponsLayer`. */
  layers?: number;
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
  fromModule!: Int32Array;
  /** The layers it is in, as a `HULL_LAYER` / `WEAPONS_LAYER` mask. */
  layers!: Uint8Array;
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
    this.fromModule = i32(this.fromModule);
    const layer = new Uint8Array(capacity);
    if (this.layers) layer.set(this.layers);
    this.layers = layer;
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
    fromModule = -1,
    layers = HULL_LAYER,
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
    this.fromModule[i] = fromModule;
    this.layers[i] = layers;
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
      spec.fromModule ?? -1,
      spec.layers ?? (spec.weaponsLayer === true ? WEAPONS_LAYER : HULL_LAYER),
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

    // A beam that knows which part fired it may land on the rest of its own
    // ship; one that does not passes through all of it.
    const from = this.fromModule[i]!;
    const owner = this.owner[i]!;
    hulls?.castFrom(this.layers[i]!, owner, from);
    const found = grid.raycast(bodies, startX, startY, endX, endY, hit, from >= 0 ? -1 : owner, hulls);
    if (!found) hulls?.reset();
    if (found) {
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
      hulls?.reset();
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
    fromModule = -1,
    layers = HULL_LAYER,
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
      fromModule,
      layers,
    );
  }
}
