import { describe, expect, it } from 'vitest';
import { Bodies } from '../sim/bodies.js';
import { angleDelta, PI } from '../sim/math.js';
import { FiringSolution, interceptTime, Turrets } from '../sim/turrets.js';

const DT = 1 / 60;

function ship(angle = 0, vx = 0, vy = 0) {
  const bodies = new Bodies();
  const id = bodies.create({ x: 0, y: 0, vx, vy, angle, mass: 1000, inertia: 50_000, radius: 20 });
  return { bodies, id, index: bodies.indexOf(id) };
}

/**
 * Slew until the turret is on target *and stopped*, returning the steps taken.
 *
 * Both conditions matter: `onTarget` goes true within a milliradian, at which
 * point the turret is still traversing at a few hundredths of a radian per
 * second. Settled means it has come to rest there.
 */
function settle(turrets: Turrets, bodies: Bodies, i: number, limit = 4000): number {
  for (let step = 0; step < limit; step++) {
    turrets.step(DT, bodies);
    if (turrets.onTarget[i] === 1 && turrets.rate[i] === 0) return step + 1;
  }
  throw new Error('turret never settled');
}

describe('slewing', () => {
  it('reaches a commanded bearing without overshooting', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    const t = turrets.add({ owner: index, x: 5, y: 0, maxRate: 2, maxAccel: 4 });

    turrets.commandWorldBearing(bodies, t, 1.2);

    // Watch the whole approach: the bearing must never pass the target.
    let maxOvershoot = 0;
    for (let step = 0; step < 4000; step++) {
      turrets.step(DT, bodies);
      const remaining = angleDelta(turrets.bearing[t]!, 1.2);
      if (remaining < -1e-9) maxOvershoot = Math.max(maxOvershoot, -remaining);
      if (turrets.onTarget[t] === 1 && turrets.rate[t] === 0) break;
    }

    expect(turrets.onTarget[t]).toBe(1);
    expect(Math.abs(angleDelta(turrets.bearing[t]!, 1.2))).toBeLessThan(0.001);
    // Braking half a step early means no overshoot at all, rather than the
    // small overshoot a continuous braking limit leaves once time is discrete.
    expect(maxOvershoot).toBeLessThan(1e-9);
    // And it comes to rest rather than hunting around the target.
    expect(turrets.rate[t]).toBe(0);
  });

  it('honours its rate limit', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    const t = turrets.add({ owner: index, x: 0, y: 0, maxRate: 1, maxAccel: 100 });

    turrets.commandWorldBearing(bodies, t, 3);

    let peak = 0;
    for (let step = 0; step < 500; step++) {
      turrets.step(DT, bodies);
      peak = Math.max(peak, Math.abs(turrets.rate[t]!));
    }
    expect(peak).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('honours its acceleration limit', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    const t = turrets.add({ owner: index, x: 0, y: 0, maxRate: 100, maxAccel: 2 });

    turrets.commandWorldBearing(bodies, t, 3);

    let previous = turrets.rate[t]!;
    for (let step = 0; step < 200; step++) {
      turrets.step(DT, bodies);
      const change = Math.abs(turrets.rate[t]! - previous);
      expect(change).toBeLessThanOrEqual(2 * DT + 1e-9);
      previous = turrets.rate[t]!;
    }
  });

  it('takes the short way round', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    // Sitting just past +pi, commanded to just short of −pi: two hundredths of
    // a radian apart the short way, and nearly a full turn the long way. The
    // old jointed turrets locked up on exactly this.
    const t = turrets.add({ owner: index, x: 0, y: 0, restBearing: 3.13, maxRate: 1, maxAccel: 2 });
    turrets.commandWorldBearing(bodies, t, -3.13);

    const steps = settle(turrets, bodies, t);
    // The short way is ~0.023 rad; the long way would take far longer.
    expect(steps).toBeLessThan(30);
  });

  it('is faster with a higher acceleration limit', () => {
    const slow = ship();
    const fast = ship();
    const a = new Turrets();
    const b = new Turrets();
    const ta = a.add({ owner: slow.index, x: 0, y: 0, maxRate: 10, maxAccel: 1 });
    const tb = b.add({ owner: fast.index, x: 0, y: 0, maxRate: 10, maxAccel: 16 });
    a.commandWorldBearing(slow.bodies, ta, 2);
    b.commandWorldBearing(fast.bodies, tb, 2);

    expect(settle(b, fast.bodies, tb)).toBeLessThan(settle(a, slow.bodies, ta));
  });

  it('tracks a moving command without drifting', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    const t = turrets.add({ owner: index, x: 0, y: 0, maxRate: 5, maxAccel: 50 });

    let worst = 0;
    for (let step = 0; step < 600; step++) {
      // A bearing sweeping steadily, well inside the rate limit.
      turrets.commandWorldBearing(bodies, t, step * 0.01);
      turrets.step(DT, bodies);
      if (step > 100) {
        worst = Math.max(worst, Math.abs(angleDelta(turrets.bearing[t]!, turrets.commanded[t]!)));
      }
    }
    // Lag is bounded and small; it does not accumulate.
    expect(worst).toBeLessThan(0.05);
  });
});

describe('pointing tolerance', () => {
  it('widens for a mount whose acceleration outruns the timestep', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    const gentle = turrets.add({ owner: index, x: 0, y: 0, maxRate: 5, maxAccel: 1 });
    const brisk = turrets.add({ owner: index, x: 0, y: 0, maxRate: 5, maxAccel: 400 });

    turrets.step(DT, bodies);

    // A gentle mount is limited by the floor; a violent one by its own
    // discretisation. Claiming the floor for both would leave the brisk turret
    // parked just outside tolerance, never reporting ready, and never firing.
    expect(turrets.tolerance[gentle]!).toBeCloseTo(0.001, 12);
    expect(turrets.tolerance[brisk]!).toBeGreaterThan(0.001);
    expect(turrets.tolerance[brisk]!).toBeCloseTo(400 / (4 * 60 * 60), 12);
  });

  it('still settles and reports ready however brisk the mount', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    for (const maxAccel of [0.5, 2, 20, 200, 2000]) {
      const t = turrets.add({ owner: index, x: 0, y: 0, maxRate: 20, maxAccel });
      turrets.commandWorldBearing(bodies, t, 1.1);
      settle(turrets, bodies, t);
      expect(turrets.onTarget[t]).toBe(1);
      expect(turrets.readyToFire(t)).toBe(true);
      turrets.remove(t);
    }
  });
});

describe('traverse arcs', () => {
  it('clamps a command outside the arc and reports it blocked', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    const t = turrets.add({
      owner: index,
      x: 0,
      y: 0,
      restBearing: 0,
      arc: 0.5,
      maxRate: 5,
      maxAccel: 50,
    });

    turrets.commandWorldBearing(bodies, t, 2);
    expect(turrets.blocked[t]).toBe(1);
    expect(turrets.commanded[t]).toBeCloseTo(0.5, 9);

    settle(turrets, bodies, t);
    // On target, but still not allowed to shoot: both flags matter.
    expect(turrets.onTarget[t]).toBe(1);
    expect(turrets.readyToFire(t)).toBe(false);
  });

  it('accepts a command inside the arc', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    const t = turrets.add({ owner: index, x: 0, y: 0, arc: 0.5, maxRate: 5, maxAccel: 50 });

    turrets.commandWorldBearing(bodies, t, 0.3);
    expect(turrets.blocked[t]).toBe(0);
    settle(turrets, bodies, t);
    expect(turrets.readyToFire(t)).toBe(true);
  });

  it('measures the arc from the rest bearing, not from dead ahead', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    // A broadside mount: rest abeam, half a radian either side.
    const t = turrets.add({
      owner: index,
      x: 0,
      y: 5,
      restBearing: PI / 2,
      arc: 0.5,
      maxRate: 5,
      maxAccel: 50,
    });

    turrets.commandWorldBearing(bodies, t, PI / 2 + 0.4);
    expect(turrets.blocked[t]).toBe(0);
    turrets.commandWorldBearing(bodies, t, 0);
    expect(turrets.blocked[t]).toBe(1);
    expect(turrets.commanded[t]).toBeCloseTo(PI / 2 - 0.5, 9);
  });

  it('traverses fully when the arc is a half turn or more', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    const t = turrets.add({ owner: index, x: 0, y: 0, arc: PI, maxRate: 5, maxAccel: 50 });
    for (const bearing of [0, 1, 3, -3, PI, -PI / 2]) {
      turrets.commandWorldBearing(bodies, t, bearing);
      expect(turrets.blocked[t]).toBe(0);
    }
  });

  it('follows the hull, so the arc is body-relative', () => {
    const { bodies, index } = ship(PI / 2);
    const turrets = new Turrets();
    const t = turrets.add({ owner: index, x: 0, y: 0, arc: 0.3, maxRate: 5, maxAccel: 50 });

    // The ship faces +y, so dead ahead in world terms is pi/2.
    turrets.commandWorldBearing(bodies, t, PI / 2);
    expect(turrets.blocked[t]).toBe(0);
    turrets.commandWorldBearing(bodies, t, 0);
    expect(turrets.blocked[t]).toBe(1);
  });
});

describe('reaction on the hull', () => {
  it('yaws the ship the other way as the turret accelerates', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    const t = turrets.add({
      owner: index,
      x: 0,
      y: 0,
      maxRate: 2,
      maxAccel: 4,
      inertia: 2000,
    });

    turrets.commandWorldBearing(bodies, t, 1);
    bodies.clearForces();
    turrets.step(DT, bodies);

    // Turret accelerating anticlockwise pushes the hull clockwise.
    expect(turrets.rate[t]!).toBeGreaterThan(0);
    expect(bodies.torque[index]!).toBeLessThan(0);
    // Magnitude is I·β̈.
    expect(bodies.torque[index]!).toBeCloseTo(-2000 * (turrets.rate[t]! / DT), 6);
  });

  it('applies none when the turret has no inertia', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    const t = turrets.add({ owner: index, x: 0, y: 0, maxRate: 2, maxAccel: 4 });
    turrets.commandWorldBearing(bodies, t, 1);
    bodies.clearForces();
    turrets.step(DT, bodies);
    expect(bodies.torque[index]).toBe(0);
  });

  it('applies none while holding a steady rate', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    const t = turrets.add({
      owner: index,
      x: 0,
      y: 0,
      maxRate: 0.5,
      maxAccel: 100,
      inertia: 500,
    });
    turrets.commandWorldBearing(bodies, t, 3);
    // Spin up, then check a mid-slew step at constant rate.
    for (let i = 0; i < 10; i++) turrets.step(DT, bodies);
    bodies.clearForces();
    turrets.step(DT, bodies);
    expect(Math.abs(bodies.torque[index]!)).toBeLessThan(1e-9);
  });
});

describe('lead', () => {
  it('needs no lead for a stationary target', () => {
    expect(interceptTime(100, 0, 0, 0, 500)).toBeCloseTo(0.2, 12);
  });

  it('leads a crossing target', () => {
    // Target 100 away, crossing at 100 m/s, shot at 500 m/s.
    const t = interceptTime(100, 0, 0, 100, 500);
    expect(t).toBeGreaterThan(0.2);
    // The shot and the target must arrive at the same place.
    const px = 100;
    const py = 100 * t;
    expect(Math.sqrt(px * px + py * py)).toBeCloseTo(500 * t, 6);
  });

  it('refuses a target running away faster than the shot', () => {
    expect(interceptTime(100, 0, 600, 0, 500)).toBe(-1);
  });

  it('catches a target closing head-on', () => {
    const t = interceptTime(1000, 0, -200, 0, 500);
    expect(t).toBeGreaterThan(0);
    expect(1000 - 200 * t).toBeCloseTo(500 * t, 6);
  });

  it('returns zero for a target already on top of the shooter', () => {
    expect(interceptTime(0, 0, 50, 0, 500)).toBe(0);
  });

  it('aims ahead of a moving target', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    const t = turrets.add({
      owner: index,
      x: 0,
      y: 0,
      maxRate: 10,
      maxAccel: 100,
      muzzleSpeed: 500,
    });

    // Target dead ahead at 300, crossing in +y.
    const flight = turrets.aimAt(bodies, t, 300, 0, 0, 200);
    expect(flight).toBeGreaterThan(0);
    // So the turret must point above dead ahead.
    expect(turrets.commanded[t]!).toBeGreaterThan(0.1);

    // And firing along that bearing does intercept.
    settle(turrets, bodies, t);
    const solution = new FiringSolution();
    turrets.firingSolution(bodies, t, solution);
    const hitX = solution.dirX * 500 * flight;
    const hitY = solution.dirY * 500 * flight;
    // Within the turret's own pointing tolerance: a milliradian at this range
    // is about 0.4 m, so that is the accuracy the mount can promise.
    expect(Math.abs(hitX - 300)).toBeLessThan(0.5);
    expect(Math.abs(hitY - 200 * flight)).toBeLessThan(0.5);
  });

  it('aims at the present position when the target cannot be caught', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    const t = turrets.add({
      owner: index,
      x: 0,
      y: 0,
      maxRate: 10,
      maxAccel: 100,
      muzzleSpeed: 100,
    });

    const flight = turrets.aimAt(bodies, t, 0, 500, 0, 4000);
    expect(flight).toBe(-1);
    // Still tracking, at the target as it is now: straight up.
    expect(turrets.commanded[t]!).toBeCloseTo(PI / 2, 6);
  });

  it('accounts for the firing ship own motion', () => {
    // A ship moving with the target needs no lead at all.
    const moving = ship(0, 0, 200);
    const turrets = new Turrets();
    const t = turrets.add({
      owner: moving.index,
      x: 0,
      y: 0,
      maxRate: 10,
      maxAccel: 100,
      muzzleSpeed: 500,
    });
    turrets.aimAt(moving.bodies, t, 300, 0, 0, 200);
    expect(Math.abs(turrets.commanded[t]!)).toBeLessThan(1e-9);
  });
});

describe('firing solution', () => {
  it('places the muzzle along the barrel from the mount', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    const t = turrets.add({
      owner: index,
      x: 10,
      y: 0,
      maxRate: 5,
      maxAccel: 50,
      muzzleOffset: 3,
    });

    const solution = new FiringSolution();
    turrets.firingSolution(bodies, t, solution);
    // Mount at (10, 0), barrel along +x, muzzle 3 further out.
    expect(solution.x).toBeCloseTo(13, 9);
    expect(solution.y).toBeCloseTo(0, 9);
    expect(solution.dirX).toBeCloseTo(1, 9);
    expect(solution.dirY).toBeCloseTo(0, 9);
  });

  it('rotates the mount with the hull', () => {
    const { bodies, index } = ship(PI / 2);
    const turrets = new Turrets();
    const t = turrets.add({ owner: index, x: 10, y: 0, maxRate: 5, maxAccel: 50 });

    const solution = new FiringSolution();
    turrets.firingSolution(bodies, t, solution);
    // The ship faces +y, so a mount 10 forward sits at (0, 10).
    expect(solution.x).toBeCloseTo(0, 9);
    expect(solution.y).toBeCloseTo(10, 9);
    expect(solution.bearing).toBeCloseTo(PI / 2, 9);
  });
});

describe('store housekeeping', () => {
  it('starts on target and at rest', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    const t = turrets.add({ owner: index, x: 0, y: 0, restBearing: 0.7, maxRate: 1, maxAccel: 1 });
    expect(turrets.bearing[t]).toBeCloseTo(0.7, 12);
    expect(turrets.onTarget[t]).toBe(1);
    expect(turrets.readyToFire(t)).toBe(true);
    void bodies;
  });

  it('returns to rest on command', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    const t = turrets.add({ owner: index, x: 0, y: 0, maxRate: 5, maxAccel: 50 });
    turrets.commandWorldBearing(bodies, t, 1.5);
    settle(turrets, bodies, t);
    turrets.returnToRest(t);
    settle(turrets, bodies, t);
    // Against the mount's own tolerance, not a fixed figure: a turret this
    // brisk cannot point more finely than its discretisation allows.
    expect(Math.abs(turrets.bearing[t]!)).toBeLessThanOrEqual(turrets.tolerance[t]!);
    expect(turrets.onTarget[t]).toBe(1);
  });

  it('recycles removed slots and grows when needed', () => {
    const { index } = ship();
    const turrets = new Turrets(2);
    const a = turrets.add({ owner: index, x: 0, y: 0, maxRate: 1, maxAccel: 1 });
    turrets.add({ owner: index, x: 0, y: 0, maxRate: 1, maxAccel: 1 });
    expect(turrets.count).toBe(2);

    turrets.remove(a);
    expect(turrets.count).toBe(1);
    turrets.add({ owner: index, x: 0, y: 0, maxRate: 1, maxAccel: 1 });
    expect(turrets.highWater).toBe(2);

    for (let i = 0; i < 50; i++) turrets.add({ owner: index, x: 0, y: 0, maxRate: 1, maxAccel: 1 });
    expect(turrets.count).toBe(52);
  });

  it('skips removed turrets when stepping', () => {
    const { bodies, index } = ship();
    const turrets = new Turrets();
    const t = turrets.add({ owner: index, x: 0, y: 0, maxRate: 5, maxAccel: 50, inertia: 100 });
    turrets.commandWorldBearing(bodies, t, 2);
    turrets.remove(t);
    bodies.clearForces();
    turrets.step(DT, bodies);
    expect(bodies.torque[index]).toBe(0);
    expect(turrets.readyToFire(t)).toBe(false);
  });
});
