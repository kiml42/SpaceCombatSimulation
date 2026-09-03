import { describe, expect, it } from 'vitest';
import { Bodies } from '../sim/bodies.js';
import { ProjectileHits, Projectiles, NO_OWNER } from '../sim/projectiles.js';
import { SpatialGrid } from '../sim/spatialGrid.js';
import type { WellSpec } from '../sim/gravity.js';

const DT = 1 / 60;

/** A world of static bodies plus a rebuilt index, which is all ballistics needs. */
function range(...specs: { x: number; y: number; radius: number }[]) {
  const bodies = new Bodies();
  const ids = specs.map((s) => bodies.create({ ...s, mass: 1, inertia: 1 }));
  const grid = new SpatialGrid(64);
  grid.rebuild(bodies);
  return { bodies, grid, ids, hits: new ProjectileHits(), projectiles: new Projectiles(64) };
}

describe('flight', () => {
  it('travels in a straight line at constant velocity', () => {
    const r = range();
    const p = r.projectiles.spawn({ x: 0, y: 0, vx: 600, vy: -300, ttl: 10 });

    for (let i = 0; i < 60; i++) r.projectiles.step(DT, r.bodies, r.grid, r.hits);

    // One second of flight.
    expect(r.projectiles.x[p]).toBeCloseTo(600, 6);
    expect(r.projectiles.y[p]).toBeCloseTo(-300, 6);
    expect(r.projectiles.alive[p]).toBe(1);
  });

  it('expires when its flight time runs out', () => {
    const r = range();
    const p = r.projectiles.spawn({ x: 0, y: 0, vx: 100, vy: 0, ttl: 0.5 });
    expect(r.projectiles.count).toBe(1);

    for (let i = 0; i < 29; i++) r.projectiles.step(DT, r.bodies, r.grid, r.hits);
    expect(r.projectiles.alive[p]).toBe(1);

    for (let i = 0; i < 3; i++) r.projectiles.step(DT, r.bodies, r.grid, r.hits);
    expect(r.projectiles.alive[p]).toBe(0);
    expect(r.projectiles.count).toBe(0);
  });

  it('recycles the slots of spent rounds', () => {
    const r = range();
    r.projectiles.spawn({ x: 0, y: 0, vx: 1, vy: 0, ttl: DT });
    r.projectiles.step(DT, r.bodies, r.grid, r.hits);
    expect(r.projectiles.count).toBe(0);
    expect(r.projectiles.highWater).toBe(1);

    // The next round takes the vacated slot rather than growing the store.
    r.projectiles.spawn({ x: 0, y: 0, vx: 1, vy: 0, ttl: 1 });
    expect(r.projectiles.highWater).toBe(1);
    expect(r.projectiles.count).toBe(1);
  });

  it('inherits the firing body velocity', () => {
    const bodies = new Bodies();
    const ship = bodies.create({ x: 0, y: 0, vx: 50, vy: 10, mass: 1, inertia: 1, radius: 5 });
    const projectiles = new Projectiles();
    const p = projectiles.fireFrom(bodies, bodies.indexOf(ship), 10, 0, 800, 0, 3, 5, 10, 1, 0);

    expect(projectiles.vx[p]).toBe(850);
    expect(projectiles.vy[p]).toBe(10);
    expect(projectiles.mass[p]).toBe(5);
    expect(projectiles.owner[p]).toBe(bodies.indexOf(ship));
  });

  it('defaults to unit mass rather than none', () => {
    // A massless round would impart no momentum, which is a silently wrong
    // default rather than an obviously wrong one.
    const r = range();
    const p = r.projectiles.spawn({ x: 0, y: 0, vx: 1, vy: 0, ttl: 1 });
    expect(r.projectiles.mass[p]).toBe(1);
  });
});

describe('impacts', () => {
  it('reports a hit and leaves the round pending, not consumed', () => {
    const r = range({ x: 200, y: 0, radius: 20 });
    const p = r.projectiles.spawn({
      x: 0,
      y: 0,
      vx: 600,
      vy: 0,
      ttl: 5,
      mass: 4,
      damage: 7,
      penetration: 3,
      kind: 2,
    });

    let hitStep = -1;
    for (let i = 0; i < 60 && hitStep < 0; i++) {
      r.projectiles.step(DT, r.bodies, r.grid, r.hits);
      if (r.hits.count > 0) hitStep = i;
    }

    expect(hitStep).toBeGreaterThanOrEqual(0);
    expect(r.hits.count).toBe(1);
    expect(r.hits.projectile[0]).toBe(p);
    expect(r.hits.body[0]).toBe(r.bodies.indexOf(r.ids[0]!));

    // Struck the near edge, so the outward normal points back along -x.
    expect(r.hits.x[0]).toBeCloseTo(180, 6);
    expect(r.hits.nx[0]).toBeCloseTo(-1, 9);
    expect(r.hits.ny[0]).toBeCloseTo(0, 9);
    expect(r.hits.t[0]).toBeGreaterThanOrEqual(0);
    expect(r.hits.t[0]).toBeLessThanOrEqual(1);

    // Alive and parked at the impact, awaiting resolution.
    expect(r.projectiles.alive[p]).toBe(1);
    expect(r.projectiles.pending[p]).toBe(1);
    expect(r.projectiles.pendingCount).toBe(1);
    expect(r.projectiles.x[p]).toBe(r.hits.x[0]);

    // Everything about the round itself is read from the store rather than
    // copied into the hit record, so there is no second copy to diverge.
    expect(r.projectiles.mass[p]).toBe(4);
    expect(r.projectiles.damage[p]).toBe(7);
    expect(r.projectiles.penetration[p]).toBe(3);
    expect(r.projectiles.kind[p]).toBe(2);
    expect(r.projectiles.vx[p]).toBe(600);
  });

  it('does not cast a pending round again, or re-report its impact', () => {
    const r = range({ x: 100, y: 0, radius: 10 });
    const p = r.projectiles.spawn({ x: 0, y: 0, vx: 6000, vy: 0, ttl: 5 });
    r.projectiles.step(DT, r.bodies, r.grid, r.hits);
    expect(r.hits.count).toBe(1);

    const restingX = r.projectiles.x[p];
    const restingTtl = r.projectiles.ttl[p];
    for (let i = 0; i < 10; i++) {
      r.projectiles.step(DT, r.bodies, r.grid, r.hits);
      expect(r.hits.count).toBe(0);
    }
    // Stopped dead, with its flight time not ticking away either.
    expect(r.projectiles.x[p]).toBe(restingX);
    expect(r.projectiles.ttl[p]).toBe(restingTtl);
    expect(r.projectiles.pendingCount).toBe(1);
  });

  it('resume returns a deflected round to flight on its new heading', () => {
    const r = range({ x: 100, y: 0, radius: 10 });
    const p = r.projectiles.spawn({ x: 0, y: 0, vx: 6000, vy: 0, ttl: 5 });
    r.projectiles.step(DT, r.bodies, r.grid, r.hits);
    expect(r.hits.count).toBe(1);

    // Mirror the velocity about the surface normal, as a deflection would.
    const nx = r.hits.nx[0]!;
    const ny = r.hits.ny[0]!;
    const vx = r.projectiles.vx[p]!;
    const vy = r.projectiles.vy[p]!;
    const dot = vx * nx + vy * ny;
    r.projectiles.vx[p] = vx - 2 * dot * nx;
    r.projectiles.vy[p] = vy - 2 * dot * ny;
    r.projectiles.resume(p);

    expect(r.projectiles.pendingCount).toBe(0);
    // Reflected off a face whose normal is -x, so it now travels -x.
    expect(r.projectiles.vx[p]).toBeCloseTo(-6000, 6);

    const before = r.projectiles.x[p]!;
    r.projectiles.step(DT, r.bodies, r.grid, r.hits);
    expect(r.projectiles.x[p]!).toBeLessThan(before);
  });

  it('kill clears the pending state', () => {
    const r = range({ x: 100, y: 0, radius: 10 });
    const p = r.projectiles.spawn({ x: 0, y: 0, vx: 6000, vy: 0, ttl: 5 });
    r.projectiles.step(DT, r.bodies, r.grid, r.hits);
    expect(r.projectiles.pendingCount).toBe(1);

    r.projectiles.kill(r.hits.projectile[0]!);
    expect(r.projectiles.pendingCount).toBe(0);
    expect(r.projectiles.count).toBe(0);
    expect(r.projectiles.alive[p]).toBe(0);
  });

  it('reports an outward normal for an oblique hit', () => {
    // Arriving from below and to the left of a circle centred on (200, 0), so
    // it strikes the lower-left arc and the outward normal there must point
    // both down and to the left. Entry works out at about (174, -43).
    const r = range({ x: 200, y: 0, radius: 50 });
    r.projectiles.spawn({ x: 120, y: -70, vx: 6000, vy: 3000, ttl: 5 });
    r.projectiles.step(DT, r.bodies, r.grid, r.hits);

    expect(r.hits.count).toBe(1);
    const nx = r.hits.nx[0]!;
    const ny = r.hits.ny[0]!;
    expect(Math.sqrt(nx * nx + ny * ny)).toBeCloseTo(1, 12);
    expect(nx).toBeLessThan(0);
    expect(ny).toBeLessThan(0);
  });

  it('clears the hit buffer each step', () => {
    const r = range({ x: 100, y: 0, radius: 10 });
    r.projectiles.spawn({ x: 0, y: 0, vx: 6000, vy: 0, ttl: 5 });
    r.projectiles.step(DT, r.bodies, r.grid, r.hits);
    expect(r.hits.count).toBe(1);
    r.projectiles.step(DT, r.bodies, r.grid, r.hits);
    expect(r.hits.count).toBe(0);
  });

  it('cannot tunnel through a target however fast the round', () => {
    // 3,000,000 units per second is 50,000 units in one step, against a target
    // 20 units across. A body moved and then tested would sail straight past.
    const r = range({ x: 10_000, y: 0, radius: 10 });
    r.projectiles.spawn({ x: 0, y: 0, vx: 3_000_000, vy: 0, ttl: 5 });

    r.projectiles.step(DT, r.bodies, r.grid, r.hits);

    expect(r.hits.count).toBe(1);
    expect(r.hits.x[0]).toBeCloseTo(9990, 3);
  });

  it('passes through the firing ship but not through anyone else', () => {
    const r = range({ x: 0, y: 0, radius: 40 }, { x: 300, y: 0, radius: 20 });
    const shooter = r.bodies.indexOf(r.ids[0]!);
    const target = r.bodies.indexOf(r.ids[1]!);

    // Fired from inside its own hull, slowly enough that it spends several
    // steps still inside the shooter — every one of which must not register.
    r.projectiles.spawn({ x: 0, y: 0, vx: 600, vy: 0, ttl: 5, owner: shooter });

    let count = 0;
    let struck = -1;
    for (let i = 0; i < 120 && count === 0; i++) {
      r.projectiles.step(DT, r.bodies, r.grid, r.hits);
      count = r.hits.count;
      if (count > 0) struck = r.hits.body[0]!;
    }

    expect(count).toBe(1);
    expect(struck).toBe(target);
    expect(struck).not.toBe(shooter);
  });

  it('hits its own hull when no owner is set', () => {
    const r = range({ x: 0, y: 0, radius: 40 });
    r.projectiles.spawn({ x: 0, y: 0, vx: 6000, vy: 0, ttl: 5, owner: NO_OWNER });
    r.projectiles.step(DT, r.bodies, r.grid, r.hits);
    expect(r.hits.count).toBe(1);
    expect(r.hits.x[0]).toBe(0);
  });

  it('reports several impacts in projectile order', () => {
    const r = range({ x: 100, y: 0, radius: 10 }, { x: 100, y: 200, radius: 10 });
    const a = r.projectiles.spawn({ x: 0, y: 0, vx: 6000, vy: 0, ttl: 5 });
    const b = r.projectiles.spawn({ x: 0, y: 200, vx: 6000, vy: 0, ttl: 5 });

    r.projectiles.step(DT, r.bodies, r.grid, r.hits);

    expect(r.hits.count).toBe(2);
    expect(r.hits.projectile[0]).toBe(a);
    expect(r.hits.projectile[1]).toBe(b);
  });

  it('misses cleanly and keeps flying', () => {
    const r = range({ x: 200, y: 500, radius: 10 });
    const p = r.projectiles.spawn({ x: 0, y: 0, vx: 600, vy: 0, ttl: 5 });
    for (let i = 0; i < 60; i++) r.projectiles.step(DT, r.bodies, r.grid, r.hits);
    expect(r.hits.count).toBe(0);
    expect(r.projectiles.alive[p]).toBe(1);
    expect(r.projectiles.pendingCount).toBe(0);
  });

  it('grows the hit buffer past its initial capacity', () => {
    const bodies = new Bodies(64);
    for (let i = 0; i < 40; i++) {
      bodies.create({ x: 100, y: i * 100, radius: 30, mass: 1, inertia: 1 });
    }
    const grid = new SpatialGrid(64);
    grid.rebuild(bodies);

    const projectiles = new Projectiles();
    for (let i = 0; i < 40; i++) {
      projectiles.spawn({ x: 0, y: i * 100, vx: 6000, vy: 0, ttl: 5 });
    }
    const hits = new ProjectileHits(4);
    projectiles.step(DT, bodies, grid, hits);
    expect(hits.count).toBe(40);
    // Every entry survived the reallocations.
    for (let i = 0; i < 40; i++) expect(hits.body[i]).toBeGreaterThanOrEqual(0);
  });
});

describe('gravity', () => {
  const well: WellSpec[] = [{ x: 0, y: -1000, gm: 5e6, softening: 10 }];

  it('curves a round towards a well', () => {
    const r = range();
    const straight = r.projectiles.spawn({ x: -500, y: 0, vx: 400, vy: 0, ttl: 10 });
    for (let i = 0; i < 120; i++) r.projectiles.step(DT, r.bodies, r.grid, r.hits);
    const withoutGravity = r.projectiles.y[straight];

    const g = range();
    const curved = g.projectiles.spawn({ x: -500, y: 0, vx: 400, vy: 0, ttl: 10 });
    for (let i = 0; i < 120; i++) g.projectiles.step(DT, g.bodies, g.grid, g.hits, well);
    const withGravity = g.projectiles.y[curved];

    expect(withoutGravity).toBeCloseTo(0, 9);
    // Pulled towards the well, which sits below.
    expect(withGravity).toBeLessThan(-1);
  });

  it('leaves rounds straight when given no wells', () => {
    const r = range();
    const p = r.projectiles.spawn({ x: 0, y: 0, vx: 0, vy: 500, ttl: 10 });
    for (let i = 0; i < 60; i++) r.projectiles.step(DT, r.bodies, r.grid, r.hits, []);
    expect(r.projectiles.x[p]).toBeCloseTo(0, 9);
    expect(r.projectiles.y[p]).toBeCloseTo(500, 6);
  });
});

describe('determinism', () => {
  it('two identical runs agree exactly', () => {
    const build = () => {
      const r = range({ x: 400, y: 0, radius: 25 }, { x: 200, y: 300, radius: 25 });
      for (let i = 0; i < 20; i++) {
        r.projectiles.spawn({
          x: -300 + i,
          y: i * 7,
          vx: 500 + i * 3,
          vy: 40 - i,
          ttl: 4,
          mass: 1 + i * 0.5,
          damage: i,
        });
      }
      return r;
    };

    const a = build();
    const b = build();
    const wells: WellSpec[] = [{ x: 0, y: 0, gm: 1e6, softening: 50 }];

    for (let step = 0; step < 200; step++) {
      a.projectiles.step(DT, a.bodies, a.grid, a.hits, wells);
      b.projectiles.step(DT, b.bodies, b.grid, b.hits, wells);

      expect(b.hits.count).toBe(a.hits.count);
      for (let i = 0; i < a.hits.count; i++) {
        expect(b.hits.projectile[i]).toBe(a.hits.projectile[i]);
        expect(b.hits.body[i]).toBe(a.hits.body[i]);
        expect(b.hits.t[i]).toBe(a.hits.t[i]);
        expect(b.hits.x[i]).toBe(a.hits.x[i]);
        expect(b.hits.y[i]).toBe(a.hits.y[i]);
        expect(b.hits.nx[i]).toBe(a.hits.nx[i]);
        expect(b.hits.ny[i]).toBe(a.hits.ny[i]);
      }
      // Resolve identically on both sides so the runs stay in lockstep.
      for (let i = 0; i < a.hits.count; i++) {
        a.projectiles.kill(a.hits.projectile[i]!);
        b.projectiles.kill(b.hits.projectile[i]!);
      }
      for (let i = 0; i < a.projectiles.highWater; i++) {
        expect(b.projectiles.x[i]).toBe(a.projectiles.x[i]);
        expect(b.projectiles.vy[i]).toBe(a.projectiles.vy[i]);
      }
    }
  });
});

describe('store housekeeping', () => {
  it('kill is idempotent and ignores nonsense indices', () => {
    const r = range();
    const p = r.projectiles.spawn({ x: 0, y: 0, vx: 1, vy: 0, ttl: 1 });
    r.projectiles.kill(p);
    expect(r.projectiles.count).toBe(0);
    expect(() => {
      r.projectiles.kill(p);
      r.projectiles.kill(-1);
      r.projectiles.kill(9999);
    }).not.toThrow();
    expect(r.projectiles.count).toBe(0);
  });

  it('resume ignores rounds that are not pending', () => {
    const r = range();
    const p = r.projectiles.spawn({ x: 0, y: 0, vx: 1, vy: 0, ttl: 1 });
    expect(() => {
      r.projectiles.resume(p);
      r.projectiles.resume(-1);
      r.projectiles.resume(9999);
    }).not.toThrow();
    expect(r.projectiles.pendingCount).toBe(0);
  });

  it('clear empties the store, pending rounds included', () => {
    const r = range({ x: 100, y: 0, radius: 10 });
    r.projectiles.spawn({ x: 0, y: 0, vx: 6000, vy: 0, ttl: 5 });
    for (let i = 0; i < 9; i++) r.projectiles.spawn({ x: i, y: 900, vx: 1, vy: 0, ttl: 1 });
    r.projectiles.step(DT, r.bodies, r.grid, r.hits);
    expect(r.projectiles.pendingCount).toBe(1);

    r.projectiles.clear();
    expect(r.projectiles.count).toBe(0);
    expect(r.projectiles.pendingCount).toBe(0);
    expect(r.projectiles.highWater).toBe(0);
  });

  it('grows past its initial capacity', () => {
    const projectiles = new Projectiles(2);
    for (let i = 0; i < 100; i++) projectiles.spawn({ x: i, y: 0, vx: 1, vy: 0, ttl: 1 });
    expect(projectiles.count).toBe(100);
    for (let i = 0; i < 100; i++) expect(projectiles.x[i]).toBe(i);
  });
});
