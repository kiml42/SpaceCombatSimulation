import { describe, expect, it } from 'vitest';
import { Bodies } from '../sim/bodies.js';
import { BeamHits, Beams, NO_OWNER } from '../sim/beams.js';
import { SpatialGrid } from '../sim/spatialGrid.js';

/** A world of static bodies plus a rebuilt index, which is all beams need. */
function range(...specs: { x: number; y: number; radius: number }[]) {
  const bodies = new Bodies();
  const ids = specs.map((s) => bodies.create({ ...s, mass: 1, inertia: 1 }));
  const grid = new SpatialGrid(64);
  grid.rebuild(bodies);
  return { bodies, grid, ids, hits: new BeamHits(), beams: new Beams(64) };
}

describe('projection', () => {
  it('travels in a straight line', () => {
    const r = range();
    const p = r.beams.shoot({ startX: 0, startY: 0, endX: 600, endY: -300, width: 0.5 });

    for (let i = 0; i < 60; i++) r.beams.detectHits(r.bodies, r.grid, r.hits);

    // One second of flight.
    expect(r.beams.startX[p]).toBeCloseTo(600, 6);
    expect(r.beams.startY[p]).toBeCloseTo(-300, 6);
    expect(r.beams.alive[p]).toBe(1);
  });

  it('expires when its flight time runs out', () => {
    const r = range();
    const p = r.beams.shoot({ startX: 0, startY: 0, endX: 100, endY: 0, width: 0.5 });
    expect(r.beams.count).toBe(1);

    for (let i = 0; i < 29; i++) r.beams.detectHits(r.bodies, r.grid, r.hits);
    expect(r.beams.alive[p]).toBe(1);

    for (let i = 0; i < 3; i++) r.beams.detectHits(r.bodies, r.grid, r.hits);
    expect(r.beams.alive[p]).toBe(0);
    expect(r.beams.count).toBe(0);
  });

  it('recycles the slots of spent beams', () => {
    const r = range();
    r.beams.shoot({ startX: 0, startY: 0, endX: 1, endY: 0, width: 0.5 });
    r.beams.detectHits(r.bodies, r.grid, r.hits);
    expect(r.beams.count).toBe(0);
    expect(r.beams.highWater).toBe(1);

    // The next beam takes the vacated slot rather than growing the store.
    r.beams.shoot({ startX: 0, startY: 0, endX: 1, endY: 0, width: 0.5 });
    expect(r.beams.highWater).toBe(1);
    expect(r.beams.count).toBe(1);
  });
});

describe('impacts', () => {
  it('reports a hit and leaves the beam pending, not consumed', () => {
    const r = range({ x: 200, y: 0, radius: 20 });
    const p = r.beams.shoot({
      startX: 0,
      startY: 0,
      endX: 600000,
      endY: 0,
      width: 0.5,
      kind: 2,
    });

    let hitStep = -1;
    for (let i = 0; i < 60 && hitStep < 0; i++) {
      r.beams.detectHits(r.bodies, r.grid, r.hits);
      if (r.hits.count > 0) hitStep = i;
    }

    expect(hitStep).toBeGreaterThanOrEqual(0);
    expect(r.hits.count).toBe(1);
    expect(r.hits.beam[0]).toBe(p);
    expect(r.hits.body[0]).toBe(r.bodies.indexOf(r.ids[0]!));

    // Struck the near edge, so the outward normal points back along -startX.
    expect(r.hits.x[0]).toBeCloseTo(180, 6);
    expect(r.hits.nx[0]).toBeCloseTo(-1, 9);
    expect(r.hits.ny[0]).toBeCloseTo(0, 9);

    // Alive and parked at the impact, awaiting resolution.
    expect(r.beams.alive[p]).toBe(1);
    expect(r.beams.pending[p]).toBe(1);
    expect(r.beams.pendingCount).toBe(1);
    expect(r.beams.startX[p]).toBe(r.hits.x[0]);

    // Everything about the beam itself is read from the store rather than
    // copied into the hit record, so there is no second copy to diverge.
    expect(r.beams.kind[p]).toBe(2);
    expect(r.beams.endX[p]).toBe(600);
  });

  it('does not cast a pending beam again, or re-report its impact', () => {
    const r = range({ x: 100, y: 0, radius: 10 });
    const p = r.beams.shoot({ startX: 0, startY: 0, endX: 6000, endY: 0, width: 0.5 });
    r.beams.detectHits(r.bodies, r.grid, r.hits);
    expect(r.hits.count).toBe(1);

    const restingX = r.beams.startX[p];
    for (let i = 0; i < 10; i++) {
      r.beams.detectHits(r.bodies, r.grid, r.hits);
      expect(r.hits.count).toBe(0);
    }
    // Stopped dead, with its flight time not ticking away either.
    expect(r.beams.startX[p]).toBe(restingX);
    expect(r.beams.pendingCount).toBe(1);
  });

  it('resume returns a deflected beam to flight on its new heading', () => {
    const r = range({ x: 100, y: 0, radius: 10 });
    const p = r.beams.shoot({ startX: 0, startY: 0, endX: 6000, endY: 0, width: 0.5 });
    r.beams.detectHits(r.bodies, r.grid, r.hits);
    expect(r.hits.count).toBe(1);

    // Mirror the velocity about the surface normal, as a deflection would.
    const nx = r.hits.nx[0]!;
    const ny = r.hits.ny[0]!;
    const endX = r.beams.endX[p]!;
    const endY = r.beams.endY[p]!;
    const dot = endX * nx + endY * ny;
    r.beams.endX[p] = endX - 2 * dot * nx;
    r.beams.endY[p] = endY - 2 * dot * ny;
    r.beams.resume(p);

    expect(r.beams.pendingCount).toBe(0);
    // Reflected off a face whose normal is -startX, so it now travels -startX.
    expect(r.beams.endX[p]).toBeCloseTo(-6000, 6);

    const before = r.beams.startX[p]!;
    r.beams.detectHits(r.bodies, r.grid, r.hits);
    expect(r.beams.startX[p]!).toBeLessThan(before);
  });

  it('kill clears the pending state', () => {
    const r = range({ x: 100, y: 0, radius: 10 });
    const p = r.beams.shoot({ startX: 0, startY: 0, endX: 6000, endY: 0, width: 0.5 });
    r.beams.detectHits(r.bodies, r.grid, r.hits);
    expect(r.beams.pendingCount).toBe(1);

    r.beams.kill(r.hits.beam[0]!);
    expect(r.beams.pendingCount).toBe(0);
    expect(r.beams.count).toBe(0);
    expect(r.beams.alive[p]).toBe(0);
  });

  it('reports an outward normal for an oblique hit', () => {
    // Arriving from below and to the left of a circle centred on (200, 0), so
    // it strikes the lower-left arc and the outward normal there must point
    // both down and to the left. Entry works out at about (174, -43).
    const r = range({ x: 200, y: 0, radius: 50 });
    r.beams.shoot({ startX: 120, startY: -70, endX: 6000, endY: 3000, width: 0.5 });
    r.beams.detectHits(r.bodies, r.grid, r.hits);

    expect(r.hits.count).toBe(1);
    const nx = r.hits.nx[0]!;
    const ny = r.hits.ny[0]!;
    expect(Math.sqrt(nx * nx + ny * ny)).toBeCloseTo(1, 12);
    expect(nx).toBeLessThan(0);
    expect(ny).toBeLessThan(0);
  });

  it('clears the hit buffer each step', () => {
    const r = range({ x: 100, y: 0, radius: 10 });
    r.beams.shoot({ startX: 0, startY: 0, endX: 6000, endY: 0, width: 0.5 });
    r.beams.detectHits(r.bodies, r.grid, r.hits);
    expect(r.hits.count).toBe(1);
    r.beams.detectHits(r.bodies, r.grid, r.hits);
    expect(r.hits.count).toBe(0);
  });

  it('cannot tunnel through a target however fast the beam', () => {
    // 3,000,000 units per second is 50,000 units in one step, against a target
    // 20 units across. A body moved and then tested would sail straight past.
    const r = range({ x: 10_000, y: 0, radius: 10 });
    r.beams.shoot({ startX: 0, startY: 0, endX: 3_000_000, endY: 0, width: 0.5 });

    r.beams.detectHits(r.bodies, r.grid, r.hits);

    expect(r.hits.count).toBe(1);
    expect(r.hits.x[0]).toBeCloseTo(9990, 3);
  });

  it('passes through the firing ship but not through anyone else', () => {
    const r = range({ x: 0, y: 0, radius: 40 }, { x: 300, y: 0, radius: 20 });
    const shooter = r.bodies.indexOf(r.ids[0]!);
    const target = r.bodies.indexOf(r.ids[1]!);

    // Fired from inside its own hull, slowly enough that it spends several
    // steps still inside the shooter — every one of which must not register.
    r.beams.shoot({ startX: 0, startY: 0, endX: 600, endY: 0, width: 0.5, owner: shooter });

    let count = 0;
    let struck = -1;
    for (let i = 0; i < 120 && count === 0; i++) {
      r.beams.detectHits(r.bodies, r.grid, r.hits);
      count = r.hits.count;
      if (count > 0) struck = r.hits.body[0]!;
    }

    expect(count).toBe(1);
    expect(struck).toBe(target);
    expect(struck).not.toBe(shooter);
  });

  it('hits its own hull when no owner is set', () => {
    const r = range({ x: 0, y: 0, radius: 40 });
    r.beams.shoot({ startX: 0, startY: 0, endX: 6000, endY: 0, width: 0.5, owner: NO_OWNER });
    r.beams.detectHits(r.bodies, r.grid, r.hits);
    expect(r.hits.count).toBe(1);
    expect(r.hits.x[0]).toBe(0);
  });

  it('reports several impacts in beam order', () => {
    const r = range({ x: 100, y: 0, radius: 10 }, { x: 100, y: 200, radius: 10 });
    const a = r.beams.shoot({ startX: 0, startY: 0, endX: 6000, endY: 0, width: 0.5 });
    const b = r.beams.shoot({ startX: 0, startY: 200, endX: 6000, endY: 0, width: 0.5 });

    r.beams.detectHits(r.bodies, r.grid, r.hits);

    expect(r.hits.count).toBe(2);
    expect(r.hits.beam[0]).toBe(a);
    expect(r.hits.beam[1]).toBe(b);
  });

  it('misses cleanly and keeps flying', () => {
    const r = range({ x: 200, y: 500, radius: 10 });
    const p = r.beams.shoot({ startX: 0, startY: 0, endX: 600, endY: 0, width: 0.5 });
    for (let i = 0; i < 60; i++) r.beams.detectHits(r.bodies, r.grid, r.hits);
    expect(r.hits.count).toBe(0);
    expect(r.beams.alive[p]).toBe(1);
    expect(r.beams.pendingCount).toBe(0);
  });

  it('grows the hit buffer past its initial capacity', () => {
    const bodies = new Bodies(64);
    for (let i = 0; i < 40; i++) {
      bodies.create({ x: 100, y: i * 100, radius: 30, mass: 1, inertia: 1 });
    }
    const grid = new SpatialGrid(64);
    grid.rebuild(bodies);

    const beams = new Beams();
    for (let i = 0; i < 40; i++) {
      beams.shoot({ startX: 0, startY: i * 100, endX: 6000, endY: 0, width: 0.5 });
    }
    const hits = new BeamHits(4);
    beams.detectHits(bodies, grid, hits);
    expect(hits.count).toBe(40);
    // Every entry survived the reallocations.
    for (let i = 0; i < 40; i++) expect(hits.body[i]).toBeGreaterThanOrEqual(0);
  });
});

describe('determinism', () => {
  it('two identical runs agree exactly', () => {
    const build = () => {
      const r = range({ x: 400, y: 0, radius: 25 }, { x: 200, y: 300, radius: 25 });
      for (let i = 0; i < 20; i++) {
        r.beams.shoot({
          startX: -300 + i,
          startY: i * 7,
          endX: 500 + i * 3,
          endY: 40 - i,
          width: 0.5
        });
      }
      return r;
    };

    const a = build();
    const b = build();

    for (let step = 0; step < 200; step++) {
      a.beams.detectHits(a.bodies, a.grid, a.hits);
      b.beams.detectHits(b.bodies, b.grid, b.hits);

      expect(b.hits.count).toBe(a.hits.count);
      for (let i = 0; i < a.hits.count; i++) {
        expect(b.hits.beam[i]).toBe(a.hits.beam[i]);
        expect(b.hits.body[i]).toBe(a.hits.body[i]);
        expect(b.hits.x[i]).toBe(a.hits.x[i]);
        expect(b.hits.y[i]).toBe(a.hits.y[i]);
        expect(b.hits.nx[i]).toBe(a.hits.nx[i]);
        expect(b.hits.ny[i]).toBe(a.hits.ny[i]);
      }
      // Resolve identically on both sides so the runs stay in lockstep.
      for (let i = 0; i < a.hits.count; i++) {
        a.beams.kill(a.hits.beam[i]!);
        b.beams.kill(b.hits.beam[i]!);
      }
      for (let i = 0; i < a.beams.highWater; i++) {
        expect(b.beams.startX[i]).toBe(a.beams.startX[i]);
        expect(b.beams.endY[i]).toBe(a.beams.endY[i]);
      }
    }
  });
});

describe('store housekeeping', () => {
  it('kill is idempotent and ignores nonsense indices', () => {
    const r = range();
    const p = r.beams.shoot({ startX: 0, startY: 0, endX: 1, endY: 0, width: 0.5 });
    r.beams.kill(p);
    expect(r.beams.count).toBe(0);
    expect(() => {
      r.beams.kill(p);
      r.beams.kill(-1);
      r.beams.kill(9999);
    }).not.toThrow();
    expect(r.beams.count).toBe(0);
  });

  it('resume ignores rounds that are not pending', () => {
    const r = range();
    const p = r.beams.shoot({ startX: 0, startY: 0, endX: 1, endY: 0, width: 0.5 });
    expect(() => {
      r.beams.resume(p);
      r.beams.resume(-1);
      r.beams.resume(9999);
    }).not.toThrow();
    expect(r.beams.pendingCount).toBe(0);
  });

  it('clear empties the store, pending rounds included', () => {
    const r = range({ x: 100, y: 0, radius: 10 });
    r.beams.shoot({ startX: 0, startY: 0, endX: 6000, endY: 0, width: 0.5 });
    for (let i = 0; i < 9; i++) r.beams.shoot({ startX: i, startY: 900, endX: 1, endY: 0, width: 0.5 });
    r.beams.detectHits(r.bodies, r.grid, r.hits);
    expect(r.beams.pendingCount).toBe(1);

    r.beams.clear();
    expect(r.beams.count).toBe(0);
    expect(r.beams.pendingCount).toBe(0);
    expect(r.beams.highWater).toBe(0);
  });

  it('grows past its initial capacity', () => {
    const beams = new Beams(2);
    for (let i = 0; i < 100; i++) beams.shoot({ startX: i, startY: 0, endX: 1, endY: 0, width: 0.5 });
    expect(beams.count).toBe(100);
    for (let i = 0; i < 100; i++) expect(beams.startX[i]).toBe(i);
  });
});
