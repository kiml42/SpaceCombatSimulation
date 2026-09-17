import { describe, expect, it } from 'vitest';
import { Bodies } from '../sim/bodies.js';
import { ProjectileHits, Projectiles } from '../sim/projectiles.js';
import { SpatialGrid } from '../sim/spatialGrid.js';
import { Hulls, type HullDesigns } from '../sim/hull.js';
import { compileBlueprint, math, type ShipDesign } from '../sim/index.js';
import { CORVETTE } from '../scenarios/blueprints.js';

/**
 * Shots landing on a ship's hull rather than on the circle drawn round it.
 *
 * The circle reaches the furthest module, so for a ship longer than it is wide
 * most of it is empty space. What these pin is the difference: a round aimed at
 * that empty space carries on, a round aimed at the ship stops on a module's
 * face, and what it stopped on is reported.
 */

const DT = 1 / 60;

/** A lookup of one design per body index, which is all the narrow phase asks. */
function hullsOf(designs: (ShipDesign | null)[]): Hulls {
  const table: HullDesigns = { designOf: (body) => designs[body] ?? null };
  return new Hulls(table);
}

function world(design: ShipDesign, x: number, y: number, angle = 0) {
  const bodies = new Bodies();
  bodies.create({ x, y, angle, mass: design.mass, inertia: design.inertia, radius: design.radius });
  const grid = new SpatialGrid(64);
  grid.rebuild(bodies);
  return {
    bodies,
    grid,
    hulls: hullsOf([design]),
    hits: new ProjectileHits(),
    projectiles: new Projectiles(16),
  };
}

/** Fire one round and step until it hits or runs out, reporting the impact. */
function fire(
  r: ReturnType<typeof world>,
  x: number,
  y: number,
  vx: number,
  vy: number,
  hulls: Hulls | undefined,
  steps = 120,
): { hit: boolean; x: number; y: number; nx: number; ny: number; module: number } {
  const i = r.projectiles.spawn({ x, y, vx, vy, width: 0.1, ttl: 10 });
  for (let step = 0; step < steps; step++) {
    r.projectiles.step(DT, r.bodies, r.grid, r.hits, undefined, hulls);
    if (r.hits.count > 0) {
      return {
        hit: true,
        x: r.hits.x[0]!,
        y: r.hits.y[0]!,
        nx: r.hits.nx[0]!,
        ny: r.hits.ny[0]!,
        module: r.hits.module[0]!,
      };
    }
    if (r.projectiles.alive[i] === 0) break;
  }
  return { hit: false, x: 0, y: 0, nx: 0, ny: 0, module: -1 };
}

describe('shots landing on the hull', () => {
  const corvette = compileBlueprint(CORVETTE);

  it('passes through the empty part of the bounding circle', () => {
    // Abeam of the ship at a range inside its circle but well clear of every
    // module: the circle reaches the bow, and there is nothing out here.
    const clear = corvette.radius * 0.8;
    const r = world(corvette, 0, 0);
    const across = fire(r, -600, clear, 900, 0, r.hulls);
    expect(across.hit).toBe(false);

    // The same shot against the circle alone stops in the vacuum beside it,
    // which is what this replaces.
    const c = world(corvette, 0, 0);
    expect(fire(c, -600, clear, 900, 0, undefined).hit).toBe(true);
  });

  it('stops on a module, not on the circle drawn round the ship', () => {
    const r = world(corvette, 0, 0);
    const bow = fire(r, -600, 0, 900, 0, r.hulls);
    expect(bow.hit).toBe(true);
    // Inside the circle, which the round would have stopped at before.
    expect(Math.hypot(bow.x, bow.y)).toBeLessThan(corvette.radius);
    // And on the surface of the module it names, not inside it.
    const struck = corvette.modules[bow.module]!;
    const dx = bow.x - struck.x;
    const dy = bow.y - struck.y;
    const along = Math.abs(dx * Math.cos(struck.angle) + dy * Math.sin(struck.angle));
    const across = Math.abs(-dx * Math.sin(struck.angle) + dy * Math.cos(struck.angle));
    expect(along).toBeLessThanOrEqual(struck.spec.length / 2 + 1e-9);
    expect(across).toBeLessThanOrEqual(struck.spec.width / 2 + 1e-9);
  });

  it('reports the face it was met by, in the world frame', () => {
    // Head-on from astern: the face met points aft, whichever way the ship is
    // turned, so turning the ship turns the normal with it.
    const straight = world(corvette, 0, 0);
    const aft = fire(straight, -600, 0, 900, 0, straight.hulls);
    expect(aft.nx).toBeCloseTo(-1, 9);
    expect(aft.ny).toBeCloseTo(0, 9);

    const turned = world(corvette, 0, 0, math.HALF_PI);
    const below = fire(turned, 0, -600, 0, 900, turned.hulls);
    expect(below.hit).toBe(true);
    expect(below.nx).toBeCloseTo(0, 9);
    expect(below.ny).toBeCloseTo(-1, 9);
  });

  it('names a module of the design it struck', () => {
    const r = world(corvette, 0, 0);
    const shot = fire(r, -600, 0, 900, 0, r.hulls);
    expect(shot.module).toBeGreaterThanOrEqual(0);
    expect(shot.module).toBeLessThan(corvette.modules.length);
  });

  it('carries on to the ship behind the one it missed', () => {
    // The near ship is crossed through its empty space, so the round must
    // reach the far one rather than stopping at the near one's circle.
    const bodies = new Bodies();
    const clear = corvette.radius * 0.8;
    bodies.create({ x: 0, y: 0, mass: 1, inertia: 1, radius: corvette.radius });
    bodies.create({ x: 900, y: clear, mass: 1, inertia: 1, radius: corvette.radius });
    const grid = new SpatialGrid(64);
    grid.rebuild(bodies);
    const r = {
      bodies,
      grid,
      hulls: hullsOf([corvette, corvette]),
      hits: new ProjectileHits(),
      projectiles: new Projectiles(16),
    };
    const shot = fire(r, -600, clear, 900, 0, r.hulls, 300);
    expect(shot.hit).toBe(true);
    expect(shot.x).toBeGreaterThan(600);
  });

  it('keeps the circle for a body that has no hull', () => {
    // Debris, a race goal, a target drone in a test: a body with no design is
    // a mass with a radius, and the circle is the whole of its shape.
    const bodies = new Bodies();
    bodies.create({ x: 0, y: 0, mass: 1, inertia: 1, radius: 40 });
    const grid = new SpatialGrid(64);
    grid.rebuild(bodies);
    const r = {
      bodies,
      grid,
      hulls: hullsOf([null]),
      hits: new ProjectileHits(),
      projectiles: new Projectiles(16),
    };
    const shot = fire(r, -600, 20, 900, 0, r.hulls);
    expect(shot.hit).toBe(true);
    expect(Math.hypot(shot.x, shot.y)).toBeCloseTo(40, 6);
    // Nothing to name: the circle is not a module.
    expect(shot.module).toBe(-1);
  });
});
