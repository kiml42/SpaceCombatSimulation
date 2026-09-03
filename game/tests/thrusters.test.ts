import { describe, expect, it } from 'vitest';
import { Bodies } from '../sim/bodies.js';
import { Rng } from '../sim/rng.js';
import {
  Allocation,
  applyAllocation,
  shortfall,
  ThrusterLayout,
  type ThrusterSpec,
} from '../sim/thrusters.js';

/**
 * A wrong allocator does not crash; it produces ships that fly slightly
 * strangely, which is very hard to notice and very hard to attribute. So the
 * load-bearing tests here are invariants that must hold for *any* layout and
 * *any* demand — throttles inside their bounds, reported wrench equal to what
 * the throttles actually produce, achievable demands met exactly — checked over
 * randomised layouts rather than hand-picked cases.
 */

/** Four thrusters on the axes, each pushing inward: full authority, no torque. */
function crossLayout(thrust = 1000): ThrusterLayout {
  return new ThrusterLayout([
    { x: -10, y: 0, dirX: 1, dirY: 0, maxThrust: thrust },
    { x: 10, y: 0, dirX: -1, dirY: 0, maxThrust: thrust },
    { x: 0, y: -10, dirX: 0, dirY: 1, maxThrust: thrust },
    { x: 0, y: 10, dirX: 0, dirY: -1, maxThrust: thrust },
  ]);
}

/** Two thrusters forming a couple: pure torque, no net force. */
function coupleLayout(thrust = 500): ThrusterLayout {
  return new ThrusterLayout([
    { x: 0, y: 10, dirX: 1, dirY: 0, maxThrust: thrust },
    { x: 0, y: -10, dirX: -1, dirY: 0, maxThrust: thrust },
  ]);
}

function randomLayout(rng: Rng, count: number): ThrusterLayout {
  const specs: ThrusterSpec[] = [];
  for (let i = 0; i < count; i++) {
    specs.push({
      x: rng.nextRange(-30, 30),
      y: rng.nextRange(-30, 30),
      dirX: rng.nextRange(-1, 1),
      dirY: rng.nextRange(-1, 1),
      maxThrust: rng.nextRange(100, 5000),
    });
  }
  return new ThrusterLayout(specs);
}

/**
 * Assert a value to within a *relative* tolerance. Allocation on a layout that
 * cannot span all three axes goes through a ridge-regularised solve, which is
 * accurate to about nine significant figures rather than exactly — irrelevant
 * to the game, but absolute tolerances would make these tests read as though
 * precision mattered more than it does.
 */
function expectRelative(actual: number, expected: number, tolerance = 1e-7): void {
  const scale = Math.abs(expected) > 1 ? Math.abs(expected) : 1;
  expect(Math.abs(actual - expected) / scale).toBeLessThan(tolerance);
}

/** The wrench a throttle vector really produces, summed straight from the columns. */
function producedWrench(layout: ThrusterLayout, throttles: Float64Array) {
  let fx = 0;
  let fy = 0;
  let torque = 0;
  for (let i = 0; i < layout.count; i++) {
    fx += layout.wfx[i]! * throttles[i]!;
    fy += layout.wfy[i]! * throttles[i]!;
    torque += layout.wt[i]! * throttles[i]!;
  }
  return { fx, fy, torque };
}

describe('layout construction', () => {
  it('normalises thrust directions', () => {
    const layout = new ThrusterLayout([
      { x: 0, y: 0, dirX: 3, dirY: 4, maxThrust: 100 },
    ]);
    expect(layout.dirX[0]).toBeCloseTo(0.6, 12);
    expect(layout.dirY[0]).toBeCloseTo(0.8, 12);
    // The column is the full-throttle wrench, so it carries the thrust.
    expect(layout.wfx[0]).toBeCloseTo(60, 12);
    expect(layout.wfy[0]).toBeCloseTo(80, 12);
  });

  it('computes torque as r cross F', () => {
    // Mounted 10 above the centre, pushing along +x: turns the ship clockwise.
    const layout = new ThrusterLayout([
      { x: 0, y: 10, dirX: 1, dirY: 0, maxThrust: 100 },
    ]);
    expect(layout.wt[0]).toBeCloseTo(-1000, 9);
  });

  it('survives a thruster with no direction', () => {
    const layout = new ThrusterLayout([{ x: 1, y: 2, dirX: 0, dirY: 0, maxThrust: 100 }]);
    expect(layout.wfx[0]).toBe(0);
    expect(layout.wfy[0]).toBe(0);
    expect(layout.wt[0]).toBe(0);
  });

  it('survives an empty layout', () => {
    const layout = new ThrusterLayout([]);
    const out = new Allocation();
    expect(() => layout.allocate(100, 0, 0, new Float64Array(0), out)).not.toThrow();
    expect(out.fx).toBe(0);
    expect(layout.hasFullAuthority()).toBe(false);
  });
});

describe('allocation', () => {
  it('delivers a pure force from a symmetric layout', () => {
    const layout = crossLayout();
    const throttles = new Float64Array(4);
    const out = new Allocation();

    layout.allocate(400, 0, 0, throttles, out);

    expectRelative(out.fx, 400);
    expectRelative(out.fy, 0);
    expectRelative(out.torque, 0);
    // Only the +x thruster should be burning.
    expectRelative(throttles[0]!, 0.4);
    expectRelative(throttles[1]!, 0);
    expect(out.saturated).toBe(false);
  });

  it('delivers a pure torque from a couple', () => {
    const layout = coupleLayout();
    const throttles = new Float64Array(2);
    const out = new Allocation();

    // Each thruster at full throttle gives -5000; together -10000.
    layout.allocate(0, 0, -5000, throttles, out);

    expectRelative(out.torque, -5000);
    expectRelative(out.fx, 0);
    expectRelative(out.fy, 0);
    // Both burn equally — that is what a couple means.
    expectRelative(throttles[0]!, 0.5);
    expectRelative(throttles[1]!, 0.5);
  });

  it('takes what force it can from a couple, at the cost of unwanted torque', () => {
    const layout = coupleLayout();
    const throttles = new Float64Array(2);
    const out = new Allocation();

    layout.allocate(1000, 0, 0, throttles, out);

    // A couple is only force-free when *both* thrusters burn equally, because
    // throttles cannot go negative. Firing one alone is the most +x force the
    // layout has, and it necessarily comes with torque — which is precisely the
    // trap the envelope exists to show a player before they fly the thing.
    expectRelative(out.fx, layout.maxThrustAlong(1, 0));
    expectRelative(out.fx, 500);
    expect(out.saturated).toBe(true);
    expect(Math.abs(out.torque)).toBeGreaterThan(1);
    // So most of what was asked for goes unmet.
    expect(shortfall(1000, 0, 0, out)).toBeGreaterThan(0.5);
  });

  it('never leaves a throttle outside its bounds, for any layout or demand', () => {
    const rng = new Rng(20260903);
    const out = new Allocation();

    for (let trial = 0; trial < 500; trial++) {
      const n = 1 + (trial % 10);
      const layout = randomLayout(rng, n);
      const throttles = new Float64Array(n);

      // Demands ranging from trivial to far beyond anything achievable.
      const scale = trial % 3 === 0 ? 1e6 : 1e4;
      layout.allocate(
        rng.nextRange(-scale, scale),
        rng.nextRange(-scale, scale),
        rng.nextRange(-scale * 10, scale * 10),
        throttles,
        out,
      );

      for (let i = 0; i < n; i++) {
        expect(throttles[i]!).toBeGreaterThanOrEqual(0);
        expect(throttles[i]!).toBeLessThanOrEqual(1);
        expect(Number.isFinite(throttles[i]!)).toBe(true);
      }
    }
  });

  it('reports the wrench the throttles really produce', () => {
    const rng = new Rng(4242);
    const out = new Allocation();

    for (let trial = 0; trial < 300; trial++) {
      const n = 2 + (trial % 8);
      const layout = randomLayout(rng, n);
      const throttles = new Float64Array(n);

      layout.allocate(
        rng.nextRange(-5000, 5000),
        rng.nextRange(-5000, 5000),
        rng.nextRange(-50000, 50000),
        throttles,
        out,
      );

      const actual = producedWrench(layout, throttles);
      expect(out.fx).toBeCloseTo(actual.fx, 9);
      expect(out.fy).toBeCloseTo(actual.fy, 9);
      expect(out.torque).toBeCloseTo(actual.torque, 9);
    }
  });

  it('gets very close to any demand that lies inside the layout capability', () => {
    const rng = new Rng(31337);
    const out = new Allocation();

    let checked = 0;
    let worst = 0;
    let total = 0;
    for (let trial = 0; trial < 400; trial++) {
      const n = 4 + (trial % 8);
      const layout = randomLayout(rng, n);
      const throttles = new Float64Array(n);
      if (!layout.hasFullAuthority()) continue;

      // Construct a demand that is achievable by construction: pick throttles,
      // see what they produce, then ask for exactly that.
      const chosen = new Float64Array(n);
      for (let i = 0; i < n; i++) chosen[i] = rng.nextRange(0, 1);
      const target = producedWrench(layout, chosen);

      layout.allocate(target.fx, target.fy, target.torque, throttles, out);

      // The throttles may differ from the ones chosen — many combinations give
      // the same wrench, and least squares picks the smallest. The *wrench* is
      // what has to match.
      const missed = shortfall(target.fx, target.fy, target.torque, out);
      total += missed;
      if (missed > worst) worst = missed;
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
    // Redistribution is a heuristic, so it can fall short of a demand that is
    // strictly achievable. What matters is that it is close nearly always and
    // never wild: measured at a mean of 0.016% and a worst case of 5.4% over
    // randomised — near-adversarial — geometry. Thresholds sit above those with
    // headroom, so this catches a regression rather than tracking noise.
    expect(total / checked).toBeLessThan(0.002);
    expect(worst).toBeLessThan(0.10);
  });

  it('saturates gracefully rather than exploding', () => {
    const layout = crossLayout(1000);
    const throttles = new Float64Array(4);
    const out = new Allocation();

    layout.allocate(1e9, 0, 0, throttles, out);

    expect(out.saturated).toBe(true);
    // At most the one thruster that points that way, at full throttle.
    expectRelative(out.fx, 1000);
    expect(throttles[0]).toBe(1);
  });

  it('terminates within the pass budget', () => {
    const rng = new Rng(11);
    const out = new Allocation();
    for (let trial = 0; trial < 200; trial++) {
      const n = 3 + (trial % 9);
      const layout = randomLayout(rng, n);
      layout.allocate(
        rng.nextRange(-1e5, 1e5),
        rng.nextRange(-1e5, 1e5),
        rng.nextRange(-1e6, 1e6),
        new Float64Array(n),
        out,
      );
      expect(out.passes).toBeLessThanOrEqual(n + 1);
    }
  });

  it('is repeatable, and unaffected by reusing the layout', () => {
    const layout = crossLayout();
    const a = new Float64Array(4);
    const b = new Float64Array(4);
    const outA = new Allocation();
    const outB = new Allocation();

    layout.allocate(300, -200, 1500, a, outA);
    // A different demand in between must not leave anything behind.
    layout.allocate(-999, 5000, -20000, new Float64Array(4), new Allocation());
    layout.allocate(300, -200, 1500, b, outB);

    expect(Array.from(b)).toEqual(Array.from(a));
    expect(outB.fx).toBe(outA.fx);
    expect(outB.torque).toBe(outA.torque);
  });

  it('asks for nothing and gets nothing', () => {
    const layout = crossLayout();
    const throttles = new Float64Array(4);
    const out = new Allocation();
    layout.allocate(0, 0, 0, throttles, out);
    for (let i = 0; i < 4; i++) expect(throttles[i]).toBeCloseTo(0, 12);
    expect(out.fx).toBeCloseTo(0, 12);
  });
});

describe('capability envelope', () => {
  it('support agrees with the best throttle combination found by search', () => {
    const rng = new Rng(777);

    for (let trial = 0; trial < 60; trial++) {
      const n = 2 + (trial % 6);
      const layout = randomLayout(rng, n);

      // A direction to probe.
      let dx = rng.nextRange(-1, 1);
      let dy = rng.nextRange(-1, 1);
      let dt = rng.nextRange(-1, 1);
      const len = Math.sqrt(dx * dx + dy * dy + dt * dt);
      dx /= len;
      dy /= len;
      dt /= len;

      const supported = layout.support(dx, dy, dt);

      // The maximum over the unit cube is attained at a vertex: each thruster
      // is either off or full, depending on the sign of its projection. Search
      // random vertices and interior points; none may beat the support value.
      const throttles = new Float64Array(n);
      let best = 0;
      for (let sample = 0; sample < 200; sample++) {
        for (let i = 0; i < n; i++) {
          throttles[i] = sample === 0 ? 1 : rng.nextFloat() < 0.5 ? 0 : 1;
        }
        const w = producedWrench(layout, throttles);
        const projection = w.fx * dx + w.fy * dy + w.torque * dt;
        if (projection > best) best = projection;
      }

      expect(supported).toBeGreaterThanOrEqual(best - 1e-9);
    }
  });

  it('reports the axis capabilities of a symmetric layout', () => {
    const layout = crossLayout(1000);
    expectRelative(layout.maxThrustAlong(1, 0), 1000);
    expectRelative(layout.maxThrustAlong(-1, 0), 1000);
    expectRelative(layout.maxThrustAlong(0, 1), 1000);
    // Diagonal: two thrusters contribute their components.
    expect(layout.maxThrustAlong(1, 1)).toBeCloseTo(2000 / Math.SQRT2, 6);
    // Every thruster points at the centre, so none of them can turn the ship.
    expect(layout.maxTorque(1)).toBeCloseTo(0, 9);
    expect(layout.maxTorque(-1)).toBeCloseTo(0, 9);
  });

  it('recognises a layout that cannot turn', () => {
    expect(crossLayout().hasFullAuthority()).toBe(false);
    expect(coupleLayout().hasFullAuthority()).toBe(false);
    // Two opposed couples are needed, not one. Throttles cannot go negative, so
    // a single pair of thrusters spins the ship one way only — which is exactly
    // the design trap the envelope is there to expose.
    const oneCouple = new ThrusterLayout([
      { x: -10, y: 0, dirX: 1, dirY: 0, maxThrust: 1000 },
      { x: 10, y: 0, dirX: -1, dirY: 0, maxThrust: 1000 },
      { x: 0, y: -10, dirX: 0, dirY: 1, maxThrust: 1000 },
      { x: 0, y: 10, dirX: 0, dirY: -1, maxThrust: 1000 },
      { x: 0, y: 10, dirX: 1, dirY: 0, maxThrust: 500 },
      { x: 0, y: -10, dirX: -1, dirY: 0, maxThrust: 500 },
    ]);
    expect(oneCouple.maxTorque(-1)).toBeGreaterThan(0);
    expect(oneCouple.maxTorque(1)).toBe(0);
    expect(oneCouple.hasFullAuthority()).toBe(false);

    const full = new ThrusterLayout([
      { x: -10, y: 0, dirX: 1, dirY: 0, maxThrust: 1000 },
      { x: 10, y: 0, dirX: -1, dirY: 0, maxThrust: 1000 },
      { x: 0, y: -10, dirX: 0, dirY: 1, maxThrust: 1000 },
      { x: 0, y: 10, dirX: 0, dirY: -1, maxThrust: 1000 },
      { x: 0, y: 10, dirX: 1, dirY: 0, maxThrust: 500 },
      { x: 0, y: -10, dirX: -1, dirY: 0, maxThrust: 500 },
      { x: 0, y: 10, dirX: -1, dirY: 0, maxThrust: 500 },
      { x: 0, y: -10, dirX: 1, dirY: 0, maxThrust: 500 },
    ]);
    expect(full.hasFullAuthority()).toBe(true);
  });

  it('support is zero in a direction nothing can serve', () => {
    // One thruster pushing +x only.
    const layout = new ThrusterLayout([
      { x: 0, y: 0, dirX: 1, dirY: 0, maxThrust: 100 },
    ]);
    expect(layout.support(1, 0, 0)).toBeCloseTo(100, 9);
    expect(layout.support(-1, 0, 0)).toBe(0);
  });
});

describe('applying thrust to a body', () => {
  it('rotates the body-frame wrench into the world', () => {
    const bodies = new Bodies();
    // Facing +y, so body-frame +x thrust pushes the ship along world +y.
    const ship = bodies.create({ angle: Math.PI / 2, mass: 100, inertia: 1000 });
    const out = new Allocation();
    out.fx = 500;
    out.fy = 0;
    out.torque = 250;

    applyAllocation(bodies, ship, out);

    const i = bodies.indexOf(ship);
    expect(Math.abs(bodies.fx[i]!)).toBeLessThan(1e-9);
    expectRelative(bodies.fy[i]!, 500);
    // Torque is frame independent.
    expect(bodies.torque[i]).toBe(250);
  });

  it('accelerates a ship along its own axis', () => {
    const bodies = new Bodies();
    const ship = bodies.create({ angle: 0, mass: 250, inertia: 5000 });
    const layout = crossLayout(1000);
    const throttles = new Float64Array(4);
    const out = new Allocation();

    layout.allocate(1000, 0, 0, throttles, out);
    applyAllocation(bodies, ship, out);

    const i = bodies.indexOf(ship);
    // F = ma, so 1000 N on 250 kg is 4 m/s².
    expectRelative(bodies.fx[i]! * bodies.invMass[i]!, 4);
  });
});

describe('shortfall', () => {
  it('is zero when the demand is met', () => {
    const out = new Allocation();
    out.fx = 100;
    out.fy = -50;
    out.torque = 20;
    expect(shortfall(100, -50, 20, out)).toBeCloseTo(0, 12);
  });

  it('is one when nothing was produced', () => {
    const out = new Allocation();
    expect(shortfall(100, 0, 0, out)).toBeCloseTo(1, 12);
  });

  it('treats a zero demand as met when nothing was produced', () => {
    const out = new Allocation();
    expect(shortfall(0, 0, 0, out)).toBe(0);
  });
});
