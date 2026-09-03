import type { Bodies } from './bodies.js';
import { abs, floor, imul, sqrt } from './math.js';

/**
 * A uniform-grid spatial index over body bounding circles.
 *
 * **This exists for queries, not for collision pairing.** At a few hundred
 * bodies, testing every body against every other is cheaper than building an
 * index to avoid it — a few thousand bounding-circle comparisons. What is
 * expensive is the other direction: thousands of projectiles, turrets and
 * effects each asking a question about a small region of space every step:
 *
 *   - what does this projectile's swept segment hit first?      `raycast`
 *   - can this turret see that target?                          `raycast`
 *   - what is inside this blast radius, or this sensor range?    `queryCircle`
 *
 * Multiply a few hundred bodies by a few thousand queries and the naive answer
 * is tens of millions of tests a step. The grid turns each query into a walk
 * over the handful of cells it actually touches.
 *
 * A uniform grid rather than a tree because every body moves every step, so the
 * index is rebuilt from scratch each time: a grid rebuilds in one linear pass
 * with no hierarchy to rebalance. It is also trivially reproducible — cell
 * traversal is plain ascending order, which matters when golden checksums
 * depend on damage being applied in the same sequence everywhere.
 *
 * The grid is a *broad* phase: it tests bounding circles only, and reports
 * candidates. Exact hull geometry belongs to the narrow phase.
 *
 * Cell size should be roughly the diameter of the larger bodies, or the typical
 * query radius, whichever is greater. Much smaller and big bodies are inserted
 * into many cells; much larger and each query walks bodies it cannot possibly
 * touch.
 */

/** A growable list of body indices, reused across queries to avoid allocating. */
export class IndexBuffer {
  data: Int32Array;
  count = 0;

  constructor(capacity = 64) {
    this.data = new Int32Array(capacity);
  }

  clear(): void {
    this.count = 0;
  }

  push(value: number): void {
    if (this.count === this.data.length) {
      const grown = new Int32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.count++] = value;
  }
}

/** The result of a `raycast`, filled in place so casting allocates nothing. */
export class RayHit {
  /** Body index, or -1 for a miss. Note: an index, not a `BodyId` handle. */
  bodyIndex = -1;
  /** Position along the segment, 0 at the start and 1 at the end. */
  t = 0;
  /** The impact point. */
  x = 0;
  y = 0;

  clear(): void {
    this.bodyIndex = -1;
    this.t = 0;
    this.x = 0;
    this.y = 0;
  }
}

/**
 * Guards against a pathological cast — a segment thousands of cells long — from
 * stalling a step. A ray this long is a bug in the caller, not a case to serve.
 */
const MAX_CELLS_PER_RAY = 4096;

/** Odd primes for the cell hash. Any large odd values with no shared factors do. */
const HASH_X = 73856093;
const HASH_Y = 19349663;

export class SpatialGrid {
  readonly cellSize: number;
  private readonly invCellSize: number;

  /** Hash table: bucket -> index of the first entry, or -1. */
  private cellHeads: Int32Array;
  private readonly bucketMask: number;

  /** Entries. One per (body, overlapped cell) pair, so a body may appear many times. */
  private entryNext: Int32Array;
  private entryBody: Int32Array;
  private entryCx: Int32Array;
  private entryCy: Int32Array;
  private entryCount = 0;

  /**
   * Per-body marker used to report a body once per query even when it spans
   * several of the cells that query touches.
   */
  private stamp: Int32Array;
  private stampId = 0;

  /**
   * Nearest-hit accumulator for the cast in progress. Instance fields rather
   * than closure variables because a closure per cast would allocate, and
   * casting is the most frequent thing the simulation does. Written and read
   * within one synchronous `raycast`, so there is nothing to interleave with.
   */
  private rayBestT = Infinity;
  private rayBestIndex = -1;

  constructor(cellSize: number, bucketCount = 4096, entryCapacity = 1024) {
    if (!(cellSize > 0) || cellSize === Infinity) {
      throw new Error(`SpatialGrid: cellSize must be finite and positive, got ${cellSize}`);
    }
    if (bucketCount < 1 || (bucketCount & (bucketCount - 1)) !== 0) {
      throw new Error(`SpatialGrid: bucketCount must be a power of two, got ${bucketCount}`);
    }
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.cellHeads = new Int32Array(bucketCount).fill(-1);
    this.bucketMask = bucketCount - 1;
    this.entryNext = new Int32Array(entryCapacity);
    this.entryBody = new Int32Array(entryCapacity);
    this.entryCx = new Int32Array(entryCapacity);
    this.entryCy = new Int32Array(entryCapacity);
    this.stamp = new Int32Array(256);
  }

  /** Entries currently indexed. Diagnostic: a body spanning n cells contributes n. */
  get size(): number {
    return this.entryCount;
  }

  private bucketOf(cx: number, cy: number): number {
    return ((imul(cx, HASH_X) ^ imul(cy, HASH_Y)) >>> 0) & this.bucketMask;
  }

  private insert(body: number, cx: number, cy: number): void {
    if (this.entryCount === this.entryBody.length) {
      const grown = this.entryBody.length * 2;
      const nextBody = new Int32Array(grown);
      const nextNext = new Int32Array(grown);
      const nextCx = new Int32Array(grown);
      const nextCy = new Int32Array(grown);
      nextBody.set(this.entryBody);
      nextNext.set(this.entryNext);
      nextCx.set(this.entryCx);
      nextCy.set(this.entryCy);
      this.entryBody = nextBody;
      this.entryNext = nextNext;
      this.entryCx = nextCx;
      this.entryCy = nextCy;
    }
    const e = this.entryCount++;
    this.entryBody[e] = body;
    this.entryCx[e] = cx;
    this.entryCy[e] = cy;
    const bucket = this.bucketOf(cx, cy);
    this.entryNext[e] = this.cellHeads[bucket];
    this.cellHeads[bucket] = e;
  }

  /**
   * Discard the index and rebuild it from every live body's bounding circle.
   * Call once per step, after positions have been advanced.
   */
  rebuild(bodies: Bodies): void {
    this.cellHeads.fill(-1);
    this.entryCount = 0;

    if (this.stamp.length < bodies.highWater) {
      this.stamp = new Int32Array(bodies.highWater * 2);
      this.stampId = 0;
    }

    const inv = this.invCellSize;
    for (let i = 0; i < bodies.highWater; i++) {
      if (bodies.alive[i] === 0) continue;
      const r = bodies.radius[i];
      const x = bodies.x[i];
      const y = bodies.y[i];
      const cx0 = floor((x - r) * inv);
      const cx1 = floor((x + r) * inv);
      const cy0 = floor((y - r) * inv);
      const cy1 = floor((y + r) * inv);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          this.insert(i, cx, cy);
        }
      }
    }
  }

  /**
   * Start a query. Bumps the per-body marker, resetting it when the counter
   * would overflow a signed 32-bit integer — which a long session can reach at
   * a few thousand queries a step.
   */
  private beginQuery(): number {
    if (this.stampId >= 0x7fffffff) {
      this.stamp.fill(0);
      this.stampId = 0;
    }
    return ++this.stampId;
  }

  /**
   * Collect every live body whose bounding circle overlaps the circle
   * (`x`, `y`, `r`) into `out`, and return how many there were.
   *
   * Order is deterministic but arbitrary — neither sorted by distance nor by
   * index. Anything order-sensitive (applying blast damage, say) either needs
   * to be commutative or must sort first.
   */
  queryCircle(bodies: Bodies, x: number, y: number, r: number, out: IndexBuffer): number {
    out.clear();
    const stampId = this.beginQuery();
    const inv = this.invCellSize;

    const cx0 = floor((x - r) * inv);
    const cx1 = floor((x + r) * inv);
    const cy0 = floor((y - r) * inv);
    const cy1 = floor((y + r) * inv);

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        let e = this.cellHeads[this.bucketOf(cx, cy)];
        while (e !== -1) {
          // The bucket may hold entries from other cells that hash the same.
          if (this.entryCx[e] === cx && this.entryCy[e] === cy) {
            const bi = this.entryBody[e];
            if (this.stamp[bi] !== stampId) {
              this.stamp[bi] = stampId;
              const dx = bodies.x[bi] - x;
              const dy = bodies.y[bi] - y;
              const reach = r + bodies.radius[bi];
              if (dx * dx + dy * dy <= reach * reach) out.push(bi);
            }
          }
          e = this.entryNext[e];
        }
      }
    }
    return out.count;
  }

  /**
   * Find the first body whose bounding circle the segment from (`x0`, `y0`) to
   * (`x1`, `y1`) enters, filling `hit` and returning true.
   *
   * This is how a projectile moves: rather than stepping a body forward and
   * hoping it did not pass through its target, the whole step is one segment,
   * so tunnelling is not possible (DESIGN.md §4).
   *
   * A segment beginning inside a body reports that body at `t = 0`, which is
   * what a shell spawned inside a hull should do.
   *
   * `ignoreBody` skips one body index — the firing ship, normally.
   *
   * Ties go to the lower body index, so two bodies at exactly the same range
   * resolve the same way everywhere.
   */
  raycast(
    bodies: Bodies,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    hit: RayHit,
    ignoreBody = -1,
  ): boolean {
    hit.clear();

    const dx = x1 - x0;
    const dy = y1 - y0;
    const stampId = this.beginQuery();
    const inv = this.invCellSize;

    this.rayBestT = Infinity;
    this.rayBestIndex = -1;

    let cx = floor(x0 * inv);
    let cy = floor(y0 * inv);

    if (dx === 0 && dy === 0) {
      // Degenerate: a point query against one cell.
      this.testRayCell(bodies, cx, cy, x0, y0, dx, dy, ignoreBody, stampId);
    } else {
      const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
      const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
      const tDeltaX = dx !== 0 ? abs(this.cellSize / dx) : Infinity;
      const tDeltaY = dy !== 0 ? abs(this.cellSize / dy) : Infinity;
      const boundaryX = (stepX > 0 ? cx + 1 : cx) * this.cellSize;
      const boundaryY = (stepY > 0 ? cy + 1 : cy) * this.cellSize;
      let tMaxX = dx !== 0 ? (boundaryX - x0) / dx : Infinity;
      let tMaxY = dy !== 0 ? (boundaryY - y0) / dy : Infinity;

      // Amanatides & Woo grid traversal: visit cells in the order the segment
      // enters them, so the first hit found is the nearest one.
      for (let visited = 0; visited < MAX_CELLS_PER_RAY; visited++) {
        this.testRayCell(bodies, cx, cy, x0, y0, dx, dy, ignoreBody, stampId);

        // Distance at which the segment leaves this cell.
        const tExit = tMaxX < tMaxY ? tMaxX : tMaxY;
        if (tExit > 1) break;
        // Nothing beyond here can be nearer than a hit already found: a body
        // intersecting the segment earlier is registered in an earlier cell.
        if (tExit > this.rayBestT) break;

        if (tMaxX < tMaxY) {
          cx += stepX;
          tMaxX += tDeltaX;
        } else {
          cy += stepY;
          tMaxY += tDeltaY;
        }
      }
    }

    const bestT = this.rayBestT;
    const bestIndex = this.rayBestIndex;
    if (bestIndex === -1 || bestT > 1) return false;

    hit.bodyIndex = bestIndex;
    hit.t = bestT;
    hit.x = x0 + dx * bestT;
    hit.y = y0 + dy * bestT;
    return true;
  }

  /** Test one cell's occupants against the cast in progress. */
  private testRayCell(
    bodies: Bodies,
    cx: number,
    cy: number,
    x0: number,
    y0: number,
    dx: number,
    dy: number,
    ignoreBody: number,
    stampId: number,
  ): void {
    let e = this.cellHeads[this.bucketOf(cx, cy)];
    while (e !== -1) {
      // The bucket may hold entries from other cells that hash the same.
      if (this.entryCx[e] === cx && this.entryCy[e] === cy) {
        const bi = this.entryBody[e];
        if (bi !== ignoreBody && this.stamp[bi] !== stampId) {
          this.stamp[bi] = stampId;
          const t = segmentCircleT(x0, y0, dx, dy, bodies.x[bi], bodies.y[bi], bodies.radius[bi]);
          if (t >= 0 && (t < this.rayBestT || (t === this.rayBestT && bi < this.rayBestIndex))) {
            this.rayBestT = t;
            this.rayBestIndex = bi;
          }
        }
      }
      e = this.entryNext[e];
    }
  }
}

/**
 * Where the segment (`x0`,`y0`) + t·(`dx`,`dy`) first meets the circle at
 * (`cx`,`cy`) with radius `r`, as a t in [0, 1]. Returns -1 for no meeting.
 *
 * Exported for the tests' brute-force reference implementation.
 */
export function segmentCircleT(
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  r: number,
): number {
  const fx = x0 - cx;
  const fy = y0 - cy;
  const c = fx * fx + fy * fy - r * r;
  // Starting inside counts as an immediate hit.
  if (c <= 0) return 0;

  const a = dx * dx + dy * dy;
  if (a === 0) return -1;

  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;

  const t = (-b - sqrt(disc)) / (2 * a);
  if (t < 0 || t > 1) return -1;
  return t;
}
