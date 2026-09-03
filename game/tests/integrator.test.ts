import { describe, expect, it } from 'vitest';
import { wellPotentialEnergy, World } from '../sim/index.js';
import { length } from '../sim/math.js';
import { ORBIT_GM, ORBIT_RADIUS, orbitScenario, orbitWell } from './fixtures/scenarios.js';

/**
 * The integrator is kick-drift-kick leapfrog, chosen because the simulation has
 * gravity wells and orbital behaviour is the thing most likely to expose a bad
 * scheme. These tests are what justify that choice — and what will catch it if
 * someone "simplifies" the step function.
 */

function radiusOf(world: World): number {
  const b = world.bodies;
  return length(b.x[0]!, b.y[0]!);
}

function totalEnergy(world: World): number {
  return world.kineticEnergy() + wellPotentialEnergy(world, [orbitWell()]);
}

/** Orbital period of the fixture's circular orbit. */
const PERIOD = (2 * Math.PI * ORBIT_RADIUS) / Math.sqrt(ORBIT_GM / ORBIT_RADIUS);

describe('leapfrog integrator', () => {
  it('holds a circular orbit over many revolutions', () => {
    const world = orbitScenario();
    const stepsPerOrbit = Math.round(PERIOD / world.dt);
    let minR = Infinity;
    let maxR = 0;

    for (let orbit = 0; orbit < 10; orbit++) {
      world.run(stepsPerOrbit);
      const r = radiusOf(world);
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }

    // A circular orbit must stay circular: no secular drift inward or outward.
    expect(minR).toBeGreaterThan(ORBIT_RADIUS * 0.999);
    expect(maxR).toBeLessThan(ORBIT_RADIUS * 1.001);
  });

  it('conserves total energy to within a bounded oscillation', () => {
    const world = orbitScenario();
    const initial = totalEnergy(world);
    let worst = 0;

    for (let i = 0; i < 20_000; i++) {
      world.run(1);
      const drift = Math.abs((totalEnergy(world) - initial) / initial);
      if (drift > worst) worst = drift;
    }

    // Symplectic integrators oscillate around the true energy rather than
    // drifting away from it. Explicit Euler fails this badly.
    expect(worst).toBeLessThan(1e-4);
  });

  it('returns to its starting point after a whole number of orbits', () => {
    const world = orbitScenario();
    const stepsPerOrbit = Math.round(PERIOD / world.dt);
    world.run(stepsPerOrbit * 5);

    // Apsidal precession would show as angular drift here.
    const b = world.bodies;
    expect(b.x[0]!).toBeGreaterThan(ORBIT_RADIUS * 0.99);
    expect(Math.abs(b.y[0]!)).toBeLessThan(ORBIT_RADIUS * 0.05);
  });

  it('advances a free body in a straight line exactly', () => {
    const world = new World({ dt: 0.5, seed: 1 });
    const id = world.spawn({ x: 0, y: 0, vx: 2, vy: -1, mass: 1, inertia: 1 });
    world.run(100);
    const i = world.bodies.indexOf(id);
    // No forces at all, so this should be exact to floating-point rounding.
    expect(world.bodies.x[i]).toBeCloseTo(100, 9);
    expect(world.bodies.y[i]).toBeCloseTo(-50, 9);
  });

  it('applies constant acceleration at second order', () => {
    // Under constant force, leapfrog is exact for x = 1/2 a t^2.
    const world = new World({ dt: 0.01, seed: 1 });
    const id = world.spawn({ mass: 2, inertia: 1 });
    world.addForceProvider((w) => w.bodies.applyForce(id, 4, 0));
    world.run(1000);

    const t = world.tick * world.dt;
    const a = 4 / 2;
    const i = world.bodies.indexOf(id);
    expect(world.bodies.x[i]).toBeCloseTo(0.5 * a * t * t, 6);
    expect(world.bodies.vx[i]).toBeCloseTo(a * t, 9);
  });

  it('spins a body under constant torque', () => {
    const world = new World({ dt: 0.01, seed: 1 });
    const id = world.spawn({ mass: 1, inertia: 5 });
    world.addForceProvider((w) => w.bodies.applyTorque(id, 10));
    world.run(100);

    const t = world.tick * world.dt;
    const i = world.bodies.indexOf(id);
    expect(world.bodies.angularVel[i]).toBeCloseTo((10 / 5) * t, 9);
  });

  it('leaves immovable bodies alone', () => {
    const world = new World({ dt: 0.1, seed: 1 });
    const id = world.spawn({ x: 5, y: 5, mass: 0, inertia: 0 });
    world.addForceProvider((w) => {
      w.bodies.applyForce(id, 1e6, 1e6);
      w.bodies.applyTorque(id, 1e6);
    });
    world.run(100);
    const i = world.bodies.indexOf(id);
    expect(world.bodies.x[i]).toBe(5);
    expect(world.bodies.y[i]).toBe(5);
    expect(world.bodies.angle[i]).toBe(0);
  });

  it('primes acceleration for bodies spawned mid-run', () => {
    const world = new World({ dt: 0.1, seed: 1 });
    world.addForceProvider((w) => {
      const b = w.bodies;
      for (let i = 0; i < b.highWater; i++) {
        if (b.alive[i] === 0) continue;
        b.fy[i] += -10 * b.mass[i];
      }
    });

    world.run(50);
    const late = world.spawn({ mass: 1, inertia: 1 });
    world.run(1);

    // One step of constant acceleration from rest: y = 1/2 a t^2.
    const i = world.bodies.indexOf(late);
    expect(world.bodies.y[i]).toBeCloseTo(0.5 * -10 * 0.1 * 0.1, 12);
  });

  it('rejects a non-positive timestep', () => {
    expect(() => new World({ dt: 0, seed: 1 })).toThrow();
    expect(() => new World({ dt: -1, seed: 1 })).toThrow();
  });
});
