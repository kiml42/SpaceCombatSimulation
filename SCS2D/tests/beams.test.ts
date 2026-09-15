import { describe, expect, it } from 'vitest';
import { Bodies } from '../sim/bodies.js';
import { BeamHits, Beams, MAX_BEAM_LENGTH } from '../sim/beams.js';
import { NO_OWNER } from '../sim/projectiles.js';
import { SpatialGrid } from '../sim/spatialGrid.js';

/**
 * Beams: what they strike, and what firing one does to the store.
 *
 * The difference from a projectile is the whole of what is worth pinning here,
 * and it is easy to lose. A round is a *point that moves*: its stored vector is
 * a velocity, it advances every step, and it ages out. A beam is a *segment
 * that exists*: `start` and `end` are both positions, nothing moves it, and it
 * arrives the instant it is fired. Tests written for the one are silently wrong
 * about the other — an assertion that the origin creeps forward passes against
 * a round and asserts nothing at all against a beam.
 *
 * Casting happens inside `shoot`, so a beam has already struck whatever it is
 * going to strike by the time the call returns. There is no separate step to
 * advance and nothing in flight between one step and the next.
 *
 * Two things are deliberately not pinned. **What a hit does** belongs to the
 * damage model, and this layer only reports. **What `power` means** is a
 * scaling-law question the mount answers, so it is carried through and never
 * interpreted.
 */

/** Static bodies plus a rebuilt index, which is all a cast needs. */
function range(...specs: { x: number; y: number; radius: number }[]) {
  const bodies = new Bodies();
  const ids = specs.map((s) => bodies.create({ ...s, mass: 1, inertia: 1 }));
  const grid = new SpatialGrid(64);
  grid.rebuild(bodies);
  return { bodies, grid, ids, hits: new BeamHits(), beams: new Beams(64) };
}

type Rig = ReturnType<typeof range>;

/** A beam along +x from the origin, since most of these only vary the target. */
function eastward(r: Rig, reach: number, over: Record<string, number> = {}) {
  return r.beams.shoot(
    { startX: 0, startY: 0, endX: reach, endY: 0, width: 0.5, power: 1000, ...over },
    r.bodies,
    r.grid,
    r.hits,
  );
}

describe('what a beam reaches', () => {
  it('is a segment between two positions, and nothing moves it', () => {
    // The property everything else here depends on. A round stores a velocity
    // and is advanced; a beam stores where it ends and is not.
    const r = range();
    const p = eastward(r, 600, { endY: -300 });

    expect(r.beams.startX[p]).toBe(0);
    expect(r.beams.startY[p]).toBe(0);
    expect(r.beams.endX[p]).toBe(600);
    expect(r.beams.endY[p]).toBe(-300);
    expect(r.beams.alive[p]).toBe(1);
  });

  it('has already struck by the time firing returns', () => {
    // No step to advance and nothing in flight: the hit is reported by `shoot`
    // itself, which is what makes a beam instantaneous rather than very fast.
    const r = range({ x: 200, y: 0, radius: 20 });

    eastward(r, 600);

    expect(r.hits.count).toBe(1);
  });

  it('is truncated at what it strikes, and keeps its origin', () => {
    // Truncation is how the renderer knows where to stop drawing, so it is the
    // store rather than the hit record that has to carry it.
    const r = range({ x: 200, y: 0, radius: 20 });
    const p = eastward(r, 600);

    expect(r.hits.x[0]).toBeCloseTo(180, 9);
    expect(r.beams.endX[p]).toBe(r.hits.x[0]);
    expect(r.beams.endY[p]).toBe(r.hits.y[0]);
    // The muzzle does not move up to the impact: a drawn beam has to span the
    // whole distance, and a reflection needs to know where it came from.
    expect(r.beams.startX[p]).toBe(0);
    expect(r.beams.startY[p]).toBe(0);
  });

  it('strikes the nearest body along it, not the first one indexed', () => {
    // Spawned far-then-near, so anything reporting in creation order rather
    // than in distance order fails here.
    const r = range({ x: 400, y: 0, radius: 20 }, { x: 200, y: 0, radius: 20 });

    eastward(r, 900);

    expect(r.hits.count).toBe(1);
    expect(r.hits.body[0]).toBe(r.bodies.indexOf(r.ids[1]!));
    expect(r.hits.x[0]).toBeCloseTo(180, 9);
  });

  it('does not reach a body past its far end', () => {
    // A beam's reach is its endpoint and nothing else. Without this it would be
    // an infinite ray however short it was drawn.
    const r = range({ x: 500, y: 0, radius: 20 });

    eastward(r, 300);

    expect(r.hits.count).toBe(0);
  });

  it('does not strike a body behind its origin', () => {
    const r = range({ x: -300, y: 0, radius: 20 });

    eastward(r, 600);

    expect(r.hits.count).toBe(0);
  });

  it('passes through the ship that fired it, and strikes the next one along', () => {
    // A mount sits inside its own hull's bounding circle, so without the owner
    // skip every beam would stop dead at the muzzle.
    const r = range({ x: 0, y: 0, radius: 40 }, { x: 300, y: 0, radius: 20 });
    const shooter = r.bodies.indexOf(r.ids[0]!);

    eastward(r, 600, { owner: shooter });

    expect(r.hits.count).toBe(1);
    expect(r.hits.body[0]).toBe(r.bodies.indexOf(r.ids[1]!));
  });

  it('strikes the hull it starts inside when it has no owner', () => {
    const r = range({ x: 0, y: 0, radius: 40 });

    eastward(r, 600, { owner: NO_OWNER });

    expect(r.hits.count).toBe(1);
    expect(r.hits.x[0]).toBe(0);
  });

  it("carries its mount's figures through untouched", () => {
    // Width and power are the mount's to decide and this layer's only to
    // report, so they are read back off the store rather than copied into the
    // hit record, leaving no second copy to diverge.
    const r = range({ x: 200, y: 0, radius: 20 });

    const p = eastward(r, 600, { width: 1.25, power: 4.2e7, kind: 2 });

    expect(r.beams.width[p]).toBe(1.25);
    expect(r.beams.power[p]).toBe(4.2e7);
    expect(r.beams.kind[p]).toBe(2);
  });

  it('reaches as far as a mount fires it', () => {
    // `fireFrom` takes a unit heading and lays the beam out to MAX_BEAM_LENGTH,
    // so a target inside that is struck and one beyond it is not. Anything that
    // reintroduces a second length scale breaks one of the two.
    const near = range({ x: MAX_BEAM_LENGTH * 0.5, y: 0, radius: 20 });
    near.beams.fireFrom(NO_OWNER, 0, 0, 1, 0, 0.5, 1000, 0, near.bodies, near.grid, near.hits);
    expect(near.hits.count).toBe(1);

    const far = range({ x: MAX_BEAM_LENGTH * 1.5, y: 0, radius: 20 });
    far.beams.fireFrom(NO_OWNER, 0, 0, 1, 0, 0.5, 1000, 0, far.bodies, far.grid, far.hits);
    expect(far.hits.count).toBe(0);
  });
});

describe('the normal a hit reports', () => {
  it('opposes a head-on beam', () => {
    const r = range({ x: 200, y: 0, radius: 20 });

    eastward(r, 600);

    expect(r.hits.nx[0]).toBeCloseTo(-1, 9);
    expect(r.hits.ny[0]).toBeCloseTo(0, 9);
  });

  it('points outward from the struck arc for an oblique beam', () => {
    // Arriving from below and to the left of a circle centred on (200, 0), so
    // it strikes the lower-left arc and the outward normal there must point
    // both down and to the left. Entry works out at about (174, -43).
    const r = range({ x: 200, y: 0, radius: 50 });

    r.beams.shoot(
      { startX: 120, startY: -70, endX: 600, endY: 170, width: 0.5, power: 1000 },
      r.bodies,
      r.grid,
      r.hits,
    );

    expect(r.hits.count).toBe(1);
    const nx = r.hits.nx[0]!;
    const ny = r.hits.ny[0]!;
    expect(nx).toBeLessThan(0);
    expect(ny).toBeLessThan(0);
    expect(Math.sqrt(nx * nx + ny * ny)).toBeCloseTo(1, 12);
  });

  it('is a unit vector wherever round the body it lands', () => {
    // Incidence angle decides whether an oblique hit skids off armour, so a
    // normal that is merely approximately unit length is a quiet error in every
    // such sum.
    for (const angle of [0.3, 1.1, 2.4, -0.7, -2.9]) {
      const r = range({ x: 300, y: 0, radius: 40 });
      const fromX = 300 + Math.cos(angle) * 900;
      const fromY = Math.sin(angle) * 900;

      r.beams.shoot(
        { startX: fromX, startY: fromY, endX: 300, endY: 0, width: 0.5, power: 1000 },
        r.bodies,
        r.grid,
        r.hits,
      );

      expect(r.hits.count, `${angle} rad`).toBe(1);
      const nx = r.hits.nx[0]!;
      const ny = r.hits.ny[0]!;
      expect(Math.sqrt(nx * nx + ny * ny), `${angle} rad`).toBeCloseTo(1, 12);
      // Outward, so it points back towards where the beam came from.
      expect(nx * (fromX - 300) + ny * fromY, `${angle} rad`).toBeGreaterThan(0);
    }
  });

  it('opposes travel when a beam starts exactly at a body centre', () => {
    // Degenerate: there is no outward direction from the centre, so the only
    // defensible answer is to face the way the beam came.
    const r = range({ x: 0, y: 0, radius: 40 });

    r.beams.shoot(
      { startX: 0, startY: 0, endX: 0, endY: 600, width: 0.5, power: 1000, owner: NO_OWNER },
      r.bodies,
      r.grid,
      r.hits,
    );

    expect(r.hits.count).toBe(1);
    expect(r.hits.nx[0]).toBeCloseTo(0, 9);
    expect(r.hits.ny[0]).toBeCloseTo(-1, 9);
  });
});

describe('reporting hits', () => {
  it('leaves a struck beam alive and pending, not consumed', () => {
    // What a hit *does* is the damage model's, and it cannot decide that if the
    // beam has already been thrown away.
    const r = range({ x: 200, y: 0, radius: 20 });

    const p = eastward(r, 600);

    expect(r.beams.alive[p]).toBe(1);
    expect(r.beams.pending[p]).toBe(1);
    expect(r.beams.pendingCount).toBe(1);
  });

  it('leaves a beam that hit nothing unpending', () => {
    const r = range({ x: 200, y: 500, radius: 20 });

    const p = eastward(r, 600);

    expect(r.beams.alive[p]).toBe(1);
    expect(r.beams.pending[p]).toBe(0);
    expect(r.beams.pendingCount).toBe(0);
  });

  it("accumulates a step's hits in the order the beams were fired", () => {
    // The order damage lands in is part of what the golden checksums pin, so it
    // has to come from the firing order and not from the grid's traversal.
    const r = range({ x: 200, y: 0, radius: 20 }, { x: 200, y: 300, radius: 20 });

    const a = eastward(r, 600);
    const b = r.beams.shoot(
      { startX: 0, startY: 300, endX: 600, endY: 300, width: 0.5, power: 1000 },
      r.bodies,
      r.grid,
      r.hits,
    );

    expect(r.hits.count).toBe(2);
    expect(r.hits.beam[0]).toBe(a);
    expect(r.hits.beam[1]).toBe(b);
  });

  it('leaves clearing the hit buffer to whoever reads it', () => {
    // Firing appends, so a caller that forgets to clear reports every earlier
    // step's hits again. The scenarios clear it alongside the beam store; this
    // pins that the store does not quietly do it for them.
    const r = range({ x: 200, y: 0, radius: 20 });

    eastward(r, 600);
    eastward(r, 600);

    expect(r.hits.count).toBe(2);
    r.hits.clear();
    expect(r.hits.count).toBe(0);
  });

  it('grows the hit buffer past its capacity without losing an entry', () => {
    const bodies = new Bodies(64);
    const ids = [];
    for (let i = 0; i < 40; i++) {
      ids.push(bodies.create({ x: 200, y: i * 100, radius: 30, mass: 1, inertia: 1 }));
    }
    const grid = new SpatialGrid(64);
    grid.rebuild(bodies);
    const beams = new Beams();
    const hits = new BeamHits(4);

    for (let i = 0; i < 40; i++) {
      beams.shoot(
        { startX: 0, startY: i * 100, endX: 600, endY: i * 100, width: 0.5, power: 1000 },
        bodies,
        grid,
        hits,
      );
    }

    expect(hits.count).toBe(40);
    for (let i = 0; i < 40; i++) {
      expect(hits.body[i], `hit ${i}`).toBe(bodies.indexOf(ids[i]!));
      expect(hits.x[i], `hit ${i}`).toBeCloseTo(170, 9);
    }
  });
});

describe('the store', () => {
  it('reuses the slot of a killed beam rather than growing', () => {
    const r = range();
    const a = eastward(r, 600);
    r.beams.kill(a);
    expect(r.beams.count).toBe(0);

    const b = eastward(r, 600);

    expect(b).toBe(a);
    expect(r.beams.highWater).toBe(1);
    expect(r.beams.count).toBe(1);
  });

  it("kill releases a pending beam's claim as well as its slot", () => {
    const r = range({ x: 200, y: 0, radius: 20 });
    const p = eastward(r, 600);
    expect(r.beams.pendingCount).toBe(1);

    r.beams.kill(p);

    expect(r.beams.pendingCount).toBe(0);
    expect(r.beams.count).toBe(0);
    expect(r.beams.alive[p]).toBe(0);
  });

  it('empties completely on clear, pending beams included', () => {
    // Firing clears the store every step, so this runs far more often than any
    // other path through it: a count left behind here leaks once per step.
    const r = range({ x: 200, y: 0, radius: 20 });
    eastward(r, 600);
    for (let i = 0; i < 9; i++) {
      r.beams.shoot(
        { startX: i, startY: 900, endX: i, endY: 1500, width: 0.5, power: 1000 },
        r.bodies,
        r.grid,
        r.hits,
      );
    }
    expect(r.beams.pendingCount).toBe(1);

    r.beams.clear();

    expect(r.beams.count).toBe(0);
    expect(r.beams.pendingCount).toBe(0);
    expect(r.beams.highWater).toBe(0);
  });

  it('survives being cleared and refilled every step', () => {
    // The firing loop's actual usage. Slot reuse and the free list have to
    // agree over many cycles, or the store creeps upward for ever.
    const r = range({ x: 200, y: 0, radius: 20 });

    for (let step = 0; step < 50; step++) {
      r.beams.clear();
      r.hits.clear();
      for (let b = 0; b < 4; b++) {
        r.beams.shoot(
          { startX: 0, startY: b, endX: 600, endY: b, width: 0.5, power: 1000 },
          r.bodies,
          r.grid,
          r.hits,
        );
      }
    }

    expect(r.beams.count).toBe(4);
    expect(r.beams.highWater).toBe(4);
    expect(r.hits.count).toBe(4);
  });

  it('keeps every field distinct when it grows', () => {
    // Regression: the resize copied `width` into the power column, so the first
    // regrow past the initial capacity replaced every live beam's output with
    // its thickness — invisible until a battle ran long enough to need the
    // space.
    const r = range();
    const beams = new Beams(2);

    for (let i = 0; i < 100; i++) {
      beams.shoot(
        {
          startX: i,
          startY: i + 1000,
          endX: i + 2000,
          endY: i + 3000,
          width: 0.25,
          power: 1e6 + i,
          owner: i,
          kind: i % 3,
        },
        r.bodies,
        r.grid,
        r.hits,
      );
    }

    expect(beams.count).toBe(100);
    for (let i = 0; i < 100; i++) {
      expect(beams.startX[i], `beam ${i}`).toBe(i);
      expect(beams.startY[i], `beam ${i}`).toBe(i + 1000);
      expect(beams.endX[i], `beam ${i}`).toBe(i + 2000);
      expect(beams.endY[i], `beam ${i}`).toBe(i + 3000);
      expect(beams.width[i], `beam ${i}`).toBe(0.25);
      expect(beams.power[i], `beam ${i}`).toBe(1e6 + i);
      expect(beams.owner[i], `beam ${i}`).toBe(i);
      expect(beams.kind[i], `beam ${i}`).toBe(i % 3);
    }
  });

  it('ignores nonsense indices rather than corrupting its counts', () => {
    const r = range();
    const p = eastward(r, 600);
    r.beams.kill(p);

    expect(() => {
      r.beams.kill(p);
      r.beams.kill(-1);
      r.beams.kill(9999);
    }).not.toThrow();
    expect(r.beams.count).toBe(0);
    expect(r.beams.pendingCount).toBe(0);
  });
});

describe('determinism', () => {
  it('two identical runs agree exactly', () => {
    // Bit-for-bit, not approximately: the golden checksums are only worth
    // anything if every quantity feeding them is reproducible.
    const build = () => range({ x: 400, y: 0, radius: 25 }, { x: 200, y: 300, radius: 25 });
    const a = build();
    const b = build();

    for (let step = 0; step < 50; step++) {
      for (const r of [a, b]) {
        r.beams.clear();
        r.hits.clear();
        // A rake across both bodies, so some beams connect and some pass by:
        // ordering is only pinned if there is an order to get wrong.
        for (let i = 0; i < 20; i++) {
          r.beams.shoot(
            {
              startX: -300,
              startY: i * 20 - 40,
              endX: 700,
              endY: i * 20 - 40,
              width: 0.5,
              power: 1e5 + i,
            },
            r.bodies,
            r.grid,
            r.hits,
          );
        }
      }

      expect(a.hits.count).toBeGreaterThan(0);
      expect(b.hits.count).toBe(a.hits.count);
      for (let i = 0; i < a.hits.count; i++) {
        expect(b.hits.beam[i]).toBe(a.hits.beam[i]);
        expect(b.hits.body[i]).toBe(a.hits.body[i]);
        expect(b.hits.x[i]).toBe(a.hits.x[i]);
        expect(b.hits.y[i]).toBe(a.hits.y[i]);
        expect(b.hits.nx[i]).toBe(a.hits.nx[i]);
        expect(b.hits.ny[i]).toBe(a.hits.ny[i]);
      }
      for (let i = 0; i < a.beams.highWater; i++) {
        expect(b.beams.endX[i]).toBe(a.beams.endX[i]);
        expect(b.beams.endY[i]).toBe(a.beams.endY[i]);
      }
    }
  });
});
