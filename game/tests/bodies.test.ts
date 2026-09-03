import { describe, expect, it } from 'vitest';
import { Bodies, bodyIndex, NO_BODY } from '../sim/bodies.js';

describe('Bodies handles', () => {
  it('never issues handle zero', () => {
    const b = new Bodies(4);
    for (let i = 0; i < 10; i++) {
      expect(b.create()).not.toBe(0);
    }
  });

  it('resolves a live handle', () => {
    const b = new Bodies();
    const id = b.create({ x: 3, y: 4 });
    expect(b.isAlive(id)).toBe(true);
    const i = b.indexOf(id);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(b.x[i]).toBe(3);
    expect(b.y[i]).toBe(4);
  });

  it('detects a stale handle after the slot is recycled', () => {
    const b = new Bodies();
    const first = b.create({ x: 1 });
    const slot = bodyIndex(first);
    b.destroy(first);

    const second = b.create({ x: 2 });
    // The slot is reused, so this is the case a bare index would get wrong.
    expect(bodyIndex(second)).toBe(slot);
    expect(second).not.toBe(first);

    expect(b.isAlive(first)).toBe(false);
    expect(b.indexOf(first)).toBe(-1);
    expect(b.isAlive(second)).toBe(true);
  });

  it('rejects NO_BODY and nonsense handles', () => {
    const b = new Bodies();
    b.create();
    expect(b.indexOf(NO_BODY)).toBe(-1);
    expect(b.indexOf(0)).toBe(-1);
    expect(b.indexOf(1e15)).toBe(-1);
  });

  it('ignores operations on stale handles rather than corrupting state', () => {
    const b = new Bodies();
    const id = b.create({ mass: 10 });
    b.destroy(id);
    expect(() => {
      b.applyForce(id, 1, 1);
      b.applyTorque(id, 1);
      b.setMass(id, 5);
    }).not.toThrow();
  });

  it('tracks counts across create and destroy', () => {
    const b = new Bodies(2);
    expect(b.count).toBe(0);
    const ids = [b.create(), b.create(), b.create()];
    expect(b.count).toBe(3);
    b.destroy(ids[1]!);
    expect(b.count).toBe(2);
    expect(b.isAlive(ids[0]!)).toBe(true);
    expect(b.isAlive(ids[2]!)).toBe(true);
  });

  it('grows without losing existing bodies', () => {
    const b = new Bodies(2);
    const ids: number[] = [];
    for (let i = 0; i < 100; i++) ids.push(b.create({ x: i, mass: i + 1 }));
    expect(b.capacity).toBeGreaterThanOrEqual(100);
    for (let i = 0; i < 100; i++) {
      const idx = b.indexOf(ids[i]!);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(b.x[idx]).toBe(i);
      expect(b.mass[idx]).toBe(i + 1);
    }
  });
});

describe('Bodies mass properties', () => {
  it('treats zero mass as immovable', () => {
    const b = new Bodies();
    const id = b.create({ mass: 0, inertia: 0 });
    const i = b.indexOf(id);
    expect(b.invMass[i]).toBe(0);
    expect(b.invInertia[i]).toBe(0);
  });

  it('inverts mass and inertia', () => {
    const b = new Bodies();
    const id = b.create({ mass: 4, inertia: 8 });
    const i = b.indexOf(id);
    expect(b.invMass[i]).toBe(0.25);
    expect(b.invInertia[i]).toBe(0.125);
  });
});

describe('Bodies force application', () => {
  it('a force through the centre of mass makes no torque', () => {
    const b = new Bodies();
    const id = b.create({ x: 10, y: 20, mass: 1, inertia: 1 });
    b.applyForce(id, 5, -3);
    const i = b.indexOf(id);
    expect(b.fx[i]).toBe(5);
    expect(b.fy[i]).toBe(-3);
    expect(b.torque[i]).toBe(0);
  });

  it('an offset force makes the expected torque', () => {
    const b = new Bodies();
    const id = b.create({ x: 0, y: 0, mass: 1, inertia: 1 });
    // Push +x at a point 2 above the centre: should rotate clockwise (-z).
    b.applyForceAtPoint(id, 1, 0, 0, 2);
    const i = b.indexOf(id);
    expect(b.torque[i]).toBe(-2);
  });

  it('a local force is rotated into the world frame', () => {
    const b = new Bodies();
    // Facing +y (quarter turn), so local +x thrust pushes world +y.
    const id = b.create({ angle: Math.PI / 2, mass: 1, inertia: 1 });
    b.applyLocalForceAtLocalPoint(id, 10, 0, 0, 0);
    const i = b.indexOf(id);
    expect(Math.abs(b.fx[i])).toBeLessThan(1e-12);
    expect(b.fy[i]).toBeCloseTo(10, 12);
    expect(Math.abs(b.torque[i])).toBeLessThan(1e-12);
  });

  it('local torque is frame independent', () => {
    const b = new Bodies();
    const straight = b.create({ angle: 0, mass: 1, inertia: 1 });
    const turned = b.create({ angle: 1.234, mass: 1, inertia: 1 });
    b.applyLocalForceAtLocalPoint(straight, 0, 5, 3, 0);
    b.applyLocalForceAtLocalPoint(turned, 0, 5, 3, 0);
    expect(b.torque[b.indexOf(straight)]).toBeCloseTo(b.torque[b.indexOf(turned)], 12);
  });

  it('accumulates then clears', () => {
    const b = new Bodies();
    const id = b.create({ mass: 1, inertia: 1 });
    b.applyForce(id, 1, 2);
    b.applyForce(id, 3, 4);
    b.applyTorque(id, 7);
    const i = b.indexOf(id);
    expect(b.fx[i]).toBe(4);
    expect(b.fy[i]).toBe(6);
    expect(b.torque[i]).toBe(7);

    b.clearForces();
    expect(b.fx[i]).toBe(0);
    expect(b.fy[i]).toBe(0);
    expect(b.torque[i]).toBe(0);
  });
});
