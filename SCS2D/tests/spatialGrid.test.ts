import { describe, expect, it } from 'vitest';
import { Bodies } from '../sim/bodies.js';
import { Rng } from '../sim/rng.js';
import { IndexBuffer, RayHit, SpatialGrid, segmentCircleT } from '../sim/spatialGrid.js';

/**
 * A spatial index that quietly misses things is the worst kind of bug: the
 * simulation carries on looking plausible while shots pass through hulls.
 *
 * So the important tests here compare the grid against brute force over
 * randomised layouts. The grid is only ever an optimisation of "test
 * everything", and any disagreement is a grid bug by definition.
 */

// ---- brute-force references ----

function bruteCircle(bodies: Bodies, x: number, y: number, r: number): number[] {
  const found: number[] = [];
  for (let i = 0; i < bodies.highWater; i++) {
    if (bodies.alive[i] === 0) continue;
    const dx = bodies.x[i] - x;
    const dy = bodies.y[i] - y;
    const reach = r + bodies.radius[i];
    if (dx * dx + dy * dy <= reach * reach) found.push(i);
  }
  return found;
}

function bruteRay(
  bodies: Bodies,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ignoreBody = -1,
): { bodyIndex: number; t: number } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let bestT = Infinity;
  let bestIndex = -1;
  for (let i = 0; i < bodies.highWater; i++) {
    if (bodies.alive[i] === 0 || i === ignoreBody) continue;
    const t = segmentCircleT(x0, y0, dx, dy, bodies.x[i], bodies.y[i], bodies.radius[i]);
    if (t >= 0 && (t < bestT || (t === bestT && i < bestIndex))) {
      bestT = t;
      bestIndex = i;
    }
  }
  return bestIndex === -1 ? { bodyIndex: -1, t: 0 } : { bodyIndex: bestIndex, t: bestT };
}

function scatter(rng: Rng, count: number, spread: number, maxRadius: number): Bodies {
  const bodies = new Bodies(count + 8);
  for (let i = 0; i < count; i++) {
    bodies.create({
      x: rng.nextRange(-spread, spread),
      y: rng.nextRange(-spread, spread),
      mass: 1,
      inertia: 1,
      radius: rng.nextRange(1, maxRadius),
    });
  }
  return bodies;
}

function sorted(buffer: IndexBuffer): number[] {
  return Array.from(buffer.data.subarray(0, buffer.count)).sort((a, b) => a - b);
}

// ---- construction ----

describe('SpatialGrid construction', () => {
  it('rejects a non-positive or infinite cell size', () => {
    expect(() => new SpatialGrid(0)).toThrow();
    expect(() => new SpatialGrid(-5)).toThrow();
    expect(() => new SpatialGrid(Infinity)).toThrow();
  });

  it('rejects a bucket count that is not a power of two', () => {
    expect(() => new SpatialGrid(10, 1000)).toThrow();
    expect(() => new SpatialGrid(10, 1024)).not.toThrow();
  });

  it('inserts a body into every cell its bounding circle overlaps', () => {
    const bodies = new Bodies();
    // Radius 15 at the origin with cell size 10 spans cells -2..1 on each axis.
    bodies.create({ x: 0, y: 0, radius: 15 });
    const grid = new SpatialGrid(10);
    grid.rebuild(bodies);
    expect(grid.size).toBe(16);
  });

  it('skips dead bodies on rebuild', () => {
    const bodies = new Bodies();
    // Placed at cell centres: a body straddling a boundary occupies four cells,
    // which is correct but makes the count harder to read.
    const a = bodies.create({ x: 25, y: 25, radius: 1 });
    bodies.create({ x: 125, y: 125, radius: 1 });
    const grid = new SpatialGrid(50);
    grid.rebuild(bodies);
    expect(grid.size).toBe(2);

    bodies.destroy(a);
    grid.rebuild(bodies);
    expect(grid.size).toBe(1);
  });

  it('inserts a boundary-straddling body into all four touched cells', () => {
    const bodies = new Bodies();
    bodies.create({ x: 0, y: 0, radius: 1 });
    const grid = new SpatialGrid(50);
    grid.rebuild(bodies);
    expect(grid.size).toBe(4);
  });
});

// ---- circle queries ----

describe('queryCircle', () => {
  it('agrees with brute force over randomised layouts', () => {
    const rng = new Rng(20260903);
    const out = new IndexBuffer();

    for (let trial = 0; trial < 200; trial++) {
      const bodies = scatter(rng, 60, 400, 25);
      const grid = new SpatialGrid(rng.nextRange(5, 120));
      grid.rebuild(bodies);

      const qx = rng.nextRange(-450, 450);
      const qy = rng.nextRange(-450, 450);
      const qr = rng.nextRange(0, 150);

      grid.queryCircle(bodies, qx, qy, qr, out);
      expect(sorted(out)).toEqual(bruteCircle(bodies, qx, qy, qr));
    }
  });

  it('reports a body spanning several cells exactly once', () => {
    const bodies = new Bodies();
    // Radius 40 with cell size 5 puts this body in a great many cells.
    bodies.create({ x: 0, y: 0, radius: 40 });
    const grid = new SpatialGrid(5);
    grid.rebuild(bodies);
    expect(grid.size).toBeGreaterThan(50);

    const out = new IndexBuffer();
    expect(grid.queryCircle(bodies, 0, 0, 60, out)).toBe(1);
  });

  it('gives the same answer for any cell size', () => {
    const rng = new Rng(7);
    const bodies = scatter(rng, 80, 300, 20);
    const out = new IndexBuffer();
    const expected = bruteCircle(bodies, 10, -20, 75);

    for (const cellSize of [1, 3, 17, 50, 200, 1000]) {
      const grid = new SpatialGrid(cellSize);
      grid.rebuild(bodies);
      grid.queryCircle(bodies, 10, -20, 75, out);
      expect(sorted(out)).toEqual(expected);
    }
  });

  it('finds nothing in empty space, and survives an empty grid', () => {
    const out = new IndexBuffer();
    const empty = new Bodies();
    const grid = new SpatialGrid(10);
    grid.rebuild(empty);
    expect(grid.queryCircle(empty, 0, 0, 1000, out)).toBe(0);

    const bodies = new Bodies();
    bodies.create({ x: 0, y: 0, radius: 1 });
    grid.rebuild(bodies);
    expect(grid.queryCircle(bodies, 500, 500, 10, out)).toBe(0);
  });

  it('handles a zero-radius query as a point test', () => {
    const bodies = new Bodies();
    bodies.create({ x: 0, y: 0, radius: 10 });
    const grid = new SpatialGrid(4);
    grid.rebuild(bodies);
    const out = new IndexBuffer();
    expect(grid.queryCircle(bodies, 5, 0, 0, out)).toBe(1);
    expect(grid.queryCircle(bodies, 50, 0, 0, out)).toBe(0);
  });

  it('works far from the origin and across it', () => {
    const bodies = new Bodies();
    bodies.create({ x: -1e6, y: -1e6, radius: 5 });
    bodies.create({ x: 1e6, y: 1e6, radius: 5 });
    const grid = new SpatialGrid(64);
    grid.rebuild(bodies);
    const out = new IndexBuffer();
    expect(grid.queryCircle(bodies, -1e6, -1e6, 10, out)).toBe(1);
    expect(grid.queryCircle(bodies, 0, 0, 10, out)).toBe(0);
  });
});

// ---- raycasts ----

describe('raycast', () => {
  it('agrees with brute force on the nearest hit over randomised layouts', () => {
    const rng = new Rng(4242);
    const hit = new RayHit();

    for (let trial = 0; trial < 400; trial++) {
      const bodies = scatter(rng, 40, 300, 20);
      const grid = new SpatialGrid(rng.nextRange(5, 90));
      grid.rebuild(bodies);

      const x0 = rng.nextRange(-350, 350);
      const y0 = rng.nextRange(-350, 350);
      const x1 = rng.nextRange(-350, 350);
      const y1 = rng.nextRange(-350, 350);

      const found = grid.raycast(bodies, x0, y0, x1, y1, hit);
      const expected = bruteRay(bodies, x0, y0, x1, y1);

      expect(found).toBe(expected.bodyIndex !== -1);
      if (found) {
        expect(hit.bodyIndex).toBe(expected.bodyIndex);
        expect(hit.t).toBeCloseTo(expected.t, 12);
      }
    }
  });

  it('returns the nearest of several bodies along the ray', () => {
    const bodies = new Bodies();
    const far = bodies.create({ x: 300, y: 0, radius: 10 });
    const near = bodies.create({ x: 100, y: 0, radius: 10 });
    bodies.create({ x: 500, y: 0, radius: 10 });
    const grid = new SpatialGrid(25);
    grid.rebuild(bodies);

    const hit = new RayHit();
    expect(grid.raycast(bodies, 0, 0, 600, 0, hit)).toBe(true);
    expect(hit.bodyIndex).toBe(bodies.indexOf(near));
    expect(hit.bodyIndex).not.toBe(bodies.indexOf(far));
    // Enters the near body's circle at x = 90.
    expect(hit.x).toBeCloseTo(90, 9);
    expect(hit.y).toBeCloseTo(0, 9);
    expect(hit.t).toBeCloseTo(90 / 600, 12);
  });

  it('misses when the segment stops short', () => {
    const bodies = new Bodies();
    bodies.create({ x: 100, y: 0, radius: 5 });
    const grid = new SpatialGrid(20);
    grid.rebuild(bodies);

    const hit = new RayHit();
    expect(grid.raycast(bodies, 0, 0, 50, 0, hit)).toBe(false);
    expect(hit.bodyIndex).toBe(-1);
    // One unit further and it connects.
    expect(grid.raycast(bodies, 0, 0, 96, 0, hit)).toBe(true);
  });

  it('misses when the segment passes to one side', () => {
    const bodies = new Bodies();
    bodies.create({ x: 100, y: 0, radius: 5 });
    const grid = new SpatialGrid(20);
    grid.rebuild(bodies);

    const hit = new RayHit();
    expect(grid.raycast(bodies, 0, 6, 200, 6, hit)).toBe(false);
    expect(grid.raycast(bodies, 0, 4, 200, 4, hit)).toBe(true);
  });

  it('reports t = 0 for a segment starting inside a body', () => {
    const bodies = new Bodies();
    const inside = bodies.create({ x: 0, y: 0, radius: 20 });
    const grid = new SpatialGrid(8);
    grid.rebuild(bodies);

    const hit = new RayHit();
    expect(grid.raycast(bodies, 5, 5, 500, 500, hit)).toBe(true);
    expect(hit.bodyIndex).toBe(bodies.indexOf(inside));
    expect(hit.t).toBe(0);
    expect(hit.x).toBe(5);
    expect(hit.y).toBe(5);
  });

  it('skips the ignored body', () => {
    const bodies = new Bodies();
    const shooter = bodies.create({ x: 0, y: 0, radius: 20 });
    const target = bodies.create({ x: 200, y: 0, radius: 10 });
    const grid = new SpatialGrid(30);
    grid.rebuild(bodies);

    const hit = new RayHit();
    // Without the exemption the firing ship's own hull is hit first.
    expect(grid.raycast(bodies, 0, 0, 400, 0, hit)).toBe(true);
    expect(hit.bodyIndex).toBe(bodies.indexOf(shooter));

    expect(grid.raycast(bodies, 0, 0, 400, 0, hit, bodies.indexOf(shooter))).toBe(true);
    expect(hit.bodyIndex).toBe(bodies.indexOf(target));
  });

  it('cannot tunnel through a body however fast the projectile', () => {
    const bodies = new Bodies();
    const wall = bodies.create({ x: 1000, y: 0, radius: 5 });
    const grid = new SpatialGrid(10);
    grid.rebuild(bodies);

    const hit = new RayHit();
    // A step covering 100,000 units — the whole point of casting the segment
    // instead of moving a body and testing where it landed.
    expect(grid.raycast(bodies, 0, 0, 100_000, 0, hit)).toBe(true);
    expect(hit.bodyIndex).toBe(bodies.indexOf(wall));
    expect(hit.x).toBeCloseTo(995, 6);
  });

  it('gives the same answer for any cell size', () => {
    const rng = new Rng(99);
    const bodies = scatter(rng, 50, 250, 15);
    const hit = new RayHit();
    const expected = bruteRay(bodies, -300, -120, 300, 200);

    for (const cellSize of [1, 4, 13, 60, 500, 5000]) {
      const grid = new SpatialGrid(cellSize);
      grid.rebuild(bodies);
      const found = grid.raycast(bodies, -300, -120, 300, 200, hit);
      expect(found).toBe(expected.bodyIndex !== -1);
      if (found) expect(hit.bodyIndex).toBe(expected.bodyIndex);
    }
  });

  it('handles axis-aligned and degenerate segments', () => {
    const bodies = new Bodies();
    bodies.create({ x: 0, y: 50, radius: 5 });
    const grid = new SpatialGrid(16);
    grid.rebuild(bodies);

    const hit = new RayHit();
    expect(grid.raycast(bodies, 0, 0, 0, 100, hit)).toBe(true); // straight up
    expect(grid.raycast(bodies, 0, 100, 0, 0, hit)).toBe(true); // straight down
    expect(grid.raycast(bodies, 0, 0, 0, 0, hit)).toBe(false); // zero length, miss
    expect(grid.raycast(bodies, 0, 50, 0, 50, hit)).toBe(true); // zero length, inside
  });

  it('is repeatable, so successive identical casts agree', () => {
    const rng = new Rng(5);
    const bodies = scatter(rng, 100, 200, 12);
    const grid = new SpatialGrid(20);
    grid.rebuild(bodies);

    const a = new RayHit();
    const b = new RayHit();
    for (let i = 0; i < 50; i++) {
      grid.raycast(bodies, -250, -30, 250, 40, a);
      grid.raycast(bodies, -250, -30, 250, 40, b);
      expect(b.bodyIndex).toBe(a.bodyIndex);
      expect(b.t).toBe(a.t);
    }
  });
});

// ---- the geometry primitive ----

describe('segmentCircleT', () => {
  it('finds the near intersection', () => {
    // From the origin along +x into a circle at x = 10, radius 2.
    expect(segmentCircleT(0, 0, 20, 0, 10, 0, 2)).toBeCloseTo(8 / 20, 12);
  });

  it('returns 0 when the start is inside', () => {
    expect(segmentCircleT(10, 0, 20, 0, 10, 0, 2)).toBe(0);
  });

  it('returns -1 for a miss, a short segment and a zero-length segment', () => {
    expect(segmentCircleT(0, 5, 20, 0, 10, 0, 2)).toBe(-1); // passes above
    expect(segmentCircleT(0, 0, 5, 0, 10, 0, 2)).toBe(-1); // stops short
    expect(segmentCircleT(0, 0, 0, 0, 10, 0, 2)).toBe(-1); // no direction
  });

  it('is exact for a grazing hit at the circle edge', () => {
    // Tangent: the segment just touches the top of the circle.
    expect(segmentCircleT(0, 2, 20, 0, 10, 0, 2)).toBeCloseTo(0.5, 9);
  });

  it('settles a start exactly on the surface by direction, not position', () => {
    // A round deflected off a hull is parked precisely on its surface. Treating
    // that as "inside" would have it strike the same hull again immediately, so
    // the direction of travel has to decide.
    const r = 10;
    // Circle at (100, 0). Start exactly on its near edge, at (90, 0).
    expect(segmentCircleT(90, 0, -100, 0, 100, 0, r)).toBe(-1); // leaving: miss
    expect(segmentCircleT(90, 0, 100, 0, 100, 0, r)).toBe(0); // entering: hit
    // Strictly inside still reports an immediate hit.
    expect(segmentCircleT(95, 0, 100, 0, 100, 0, r)).toBe(0);
  });
});

// ---- buffers ----

describe('IndexBuffer', () => {
  it('grows past its initial capacity without losing entries', () => {
    const buffer = new IndexBuffer(2);
    for (let i = 0; i < 100; i++) buffer.push(i);
    expect(buffer.count).toBe(100);
    for (let i = 0; i < 100; i++) expect(buffer.data[i]).toBe(i);
  });

  it('clear resets the count without reallocating', () => {
    const buffer = new IndexBuffer(8);
    const backing = buffer.data;
    buffer.push(1);
    buffer.clear();
    expect(buffer.count).toBe(0);
    expect(buffer.data).toBe(backing);
  });
});
