import { describe, expect, it } from 'vitest';
import {
  isWeaponMount,
  compileBlueprint,
  math,
  ProjectileHits,
  Projectiles,
  Beams,
  Ships,
  SpatialGrid,
  World,
  type ShipDesign,
  BeamHits,
} from '../sim/index.js';
import { CORVETTE, GUNSHIP, BEAM_GUNSHIP, DINKY } from '../scenarios/blueprints.js';
import { OrderCancelCondition } from '../sim/ships.js';
import { DAMAGE_ENERGY_PER_KG } from '../sim/damage.js';

const DT = 1 / 60;

const corvette = compileBlueprint(CORVETTE);
const gunship = compileBlueprint(GUNSHIP);
const beamGunship = compileBlueprint(BEAM_GUNSHIP);
const dinky = compileBlueprint(DINKY);

interface Rig {
  world: World;
  ships: Ships;
  projectiles: Projectiles;
  beams: Beams;
  hits: ProjectileHits;
  beamHits: BeamHits;
  grid: SpatialGrid;
  /** Rounds put in the air over the run, since a store recycles its slots. */
  fired: number;
  /** Beams lit over the run, counted once per trigger pull rather than per step. */
  beamsFired: number;
  step(): void;
}

function rig(): Rig {
  const world = new World({ dt: DT, seed: 4 });
  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());
  const projectiles = new Projectiles(256);
  const beams = new Beams(256);
  const hits = new ProjectileHits();
  const beamHits = new BeamHits();
  const grid = new SpatialGrid(64);
  const r: Rig = {
    world,
    ships,
    projectiles,
    beams,
    hits,
    beamHits,
    grid,
    fired: 0,
    beamsFired: 0,
    step(): void {
      ships.command(DT, world);
      world.step();
      grid.rebuild(world.bodies);
      beams.clear();
      beamHits.clear();
      const fireReport = ships.fire(world, projectiles, beams, grid, beamHits);
      r.fired += fireReport.projectilesFired;
      r.beamsFired += fireReport.beamsFired;
      projectiles.step(DT, world.bodies, grid, hits);
      for (let i = 0; i < hits.count; i++) projectiles.kill(hits.projectile[i]!);
    },
  };
  return r;
}

function bodyOf(r: Rig, ship: number): number {
  return r.world.bodies.indexOf(r.ships.body(ship));
}

/**
 * Slew every mount onto what it is fighting, leaving the hull exactly where it
 * was spawned.
 *
 * `command` trains turrets and works out a wrench; only `world.step` acts on
 * that wrench, so a ship trained this way has not moved a millimetre — which
 * is what lets the gunnery arithmetic below be exact rather than approximate.
 */
function train(r: Rig, seconds = 30): void {
  const steps = Math.ceil(seconds / DT);
  for (let i = 0; i < steps; i++) r.ships.command(DT, r.world);
  r.grid.rebuild(r.world.bodies);
}

describe('spawning', () => {
  it('takes mass, inertia and radius from the design rather than the caller', () => {
    const r = rig();
    const s = r.ships.spawn(r.world, { design: corvette, x: 10, y: -4 });
    const b = bodyOf(r, s);

    expect(r.world.bodies.mass[b]).toBe(corvette.mass);
    expect(r.world.bodies.inertia[b]).toBe(corvette.inertia);
    expect(r.world.bodies.radius[b]).toBe(corvette.radius);
    expect(r.world.bodies.x[b]).toBe(10);
  });

  it('adds one turret per gun mount in the design', () => {
    const r = rig();
    r.ships.spawn(r.world, { design: corvette });
    r.ships.spawn(r.world, { design: gunship });

    expect(r.ships.turrets.count).toBe(corvette.turrets.length + gunship.turrets.length);
    expect(gunship.turrets.length).toBe(3);
  });

  it('gives each ship its own throttles, so two off one design do not share', () => {
    const r = rig();
    const a = r.ships.spawn(r.world, { design: corvette, x: -2000 });
    const b = r.ships.spawn(r.world, { design: corvette, x: 2000 });
    const enemy = r.ships.spawn(r.world, { design: gunship, x: 0 });

    // Only one of them is told to go anywhere.
    r.ships.pushOrder(a, enemy, 400, 600, 80);
    for (let i = 0; i < 30; i++) r.step();

    let movedA = 0;
    let movedB = 0;
    for (let t = 0; t < corvette.thrusters.length; t++) {
      movedA += r.ships.throttleOf(a, t);
      movedB += r.ships.throttleOf(b, t);
    }
    expect(movedA).toBeGreaterThan(0);
    expect(movedB).toBe(0);
  });

  it('removing a ship removes its turrets', () => {
    const r = rig();
    const s = r.ships.spawn(r.world, { design: gunship });
    expect(r.ships.turrets.count).toBe(3);
    r.ships.remove(s);
    expect(r.ships.turrets.count).toBe(0);
    expect(r.ships.isAlive(s)).toBe(false);
  });
});

describe('the force provider', () => {
  it('is idempotent, so the world priming twice does not double the thrust', () => {
    const r = rig();
    const a = r.ships.spawn(r.world, { design: corvette, x: -3000 });
    const enemy = r.ships.spawn(r.world, { design: gunship, x: 0 });
    r.ships.pushOrder(a, enemy, 400, 600, 80);

    r.ships.command(DT, r.world);
    const bodies = r.world.bodies;
    const b = bodyOf(r, a);

    const provider = r.ships.forceProvider();
    bodies.clearForces();
    provider(r.world);
    const onceX = bodies.fx[b]!;
    const onceY = bodies.fy[b]!;

    bodies.clearForces();
    provider(r.world);
    provider(r.world);
    // Twice through a cleared buffer is exactly twice: what makes the double
    // evaluation safe is that the world clears first, not that the provider
    // refuses to add again.
    expect(bodies.fx[b]).toBeCloseTo(onceX * 2, 6);

    bodies.clearForces();
    provider(r.world);
    expect(bodies.fx[b]).toBeCloseTo(onceX, 12);
    expect(bodies.fy[b]).toBeCloseTo(onceY, 12);
  });
});

describe('the pilot', () => {
  it('closes to the ordered range band and holds there', () => {
    const r = rig();
    const chaser = r.ships.spawn(r.world, { design: corvette, x: -4000, y: 0 });
    const quarry = r.ships.spawn(r.world, { design: gunship, x: 0, y: 0 });
    r.ships.pushOrder(chaser, quarry, 800, 1000, 150);

    const range = (): number => {
      const bodies = r.world.bodies;
      const a = bodyOf(r, chaser);
      const b = bodyOf(r, quarry);
      return math.distance(bodies.x[a]!, bodies.y[a]!, bodies.x[b]!, bodies.y[b]!);
    };

    expect(range()).toBeCloseTo(4000, 6);
    for (let i = 0; i < 60 * 120; i++) r.step();

    // Inside the band, with a tolerance for the velocity loop's standing error
    // rather than an exact landing.
    expect(range()).toBeGreaterThan(600);
    expect(range()).toBeLessThan(1200);
  });

  it('turns to face its target', () => {
    const r = rig();
    const ship = r.ships.spawn(r.world, { design: corvette, x: 0, y: 0, angle: math.PI });
    const enemy = r.ships.spawn(r.world, { design: gunship, x: 3000, y: 0 });
    r.ships.pushOrder(ship, enemy, 2000, 4000, 50);

    for (let i = 0; i < 60 * 60; i++) r.step();

    const bodies = r.world.bodies;
    const b = bodyOf(r, ship);
    const wanted = math.atan2(
      bodies.y[bodyOf(r, enemy)]! - bodies.y[b]!,
      bodies.x[bodyOf(r, enemy)]! - bodies.x[b]!,
    );
    expect(math.abs(math.angleDelta(bodies.angle[b]!, wanted))).toBeLessThan(0.05);
  });

  it('fights its orders in the order they were given', () => {
    // A queue, not a stack: a list of orders is a plan, so the ship works
    // through it from the front. It turns to the first target, and only takes
    // up the second once it is finished with the first.
    const r = rig();
    const ship = r.ships.spawn(r.world, { design: gunship, x: 0, y: 0, angle: math.PI });
    const first = r.ships.spawn(r.world, { design: dinky, x: 3000, y: 0 });
    const second = r.ships.spawn(r.world, { design: dinky, x: -3000, y: 0 });
    r.ships.pushOrder(ship, first, 2000, 4000, 50);
    r.ships.pushOrder(ship, second, 2000, 4000, 50);

    const bodies = r.world.bodies;
    const b = bodyOf(r, ship);
    const bearingTo = (other: number): number =>
      math.atan2(bodies.y[bodyOf(r, other)]! - bodies.y[b]!, bodies.x[bodyOf(r, other)]! - bodies.x[b]!);

    for (let i = 0; i < 60 * 60; i++) r.step();

    expect(r.ships.getCurrentOrder(ship)?.target).toBe(first);
    expect(math.abs(math.angleDelta(bodies.angle[b]!, bearingTo(first)))).toBeLessThan(0.05);

    // The first is gone: the ship takes up the order behind it without being
    // told anything new.
    r.ships.remove(first);
    for (let i = 0; i < 60 * 60; i++) r.step();

    expect(r.ships.getCurrentOrder(ship)?.target).toBe(second);
    expect(math.abs(math.angleDelta(bodies.angle[b]!, bearingTo(second)))).toBeLessThan(0.05);
    expect(r.ships.orderCount(ship)).toBe(1);
  });

  it('sits still when it has no order', () => {
    const r = rig();
    const ship = r.ships.spawn(r.world, { design: corvette, x: 0, y: 0 });
    expect(r.ships.getCurrentOrder(ship)).toBe(undefined);

    for (let i = 0; i < 600; i++) r.step();

    const bodies = r.world.bodies;
    const b = bodyOf(r, ship);
    expect(math.length(bodies.vx[b]!, bodies.vy[b]!)).toBeLessThan(1e-9);
  });
});

describe('gunnery', () => {
  function duel(design: ShipDesign, range: number): Rig {
    const r = rig();
    const a = r.ships.spawn(r.world, { design, x: -range / 2, team: 0 });
    const b = r.ships.spawn(r.world, { design, x: range / 2, angle: math.PI, team: 1 });
    r.ships.pushOrder(a, b, range * 0.9, range * 1.1, 20);
    r.ships.pushOrder(b, a, range * 0.9, range * 1.1, 20);
    return r;
  }

  it('holds fire until its guns have trained round', () => {
    const r = rig();
    // The enemy is dead astern, so no mount starts bearing on it. A turret
    // that happens to rest on its target is ready immediately and *should*
    // fire on the first step — which is why this puts the target where none
    // of them do.
    const ship = r.ships.spawn(r.world, { design: gunship, x: 0, angle: 0 });
    const enemy = r.ships.spawn(r.world, { design: gunship, x: -1500, angle: math.PI });
    r.ships.pushOrder(ship, enemy, 1400, 1600, 20);

    r.step();
    expect(r.fired).toBe(0);

    // A gunship is sluggish: coming round onto something astern and settling
    // enough for a mount to read as on target takes it something like a
    // quarter of a minute.
    for (let i = 0; i < 60 * 30; i++) r.step();
    expect(r.fired).toBeGreaterThan(0);
  });

  it('respects the gun cycle time rather than firing every step', () => {
    const r = duel(gunship, 1200);
    for (let i = 0; i < 60 * 30; i++) r.step();

    const seconds = 30;
    // Two ships, each with every gun bearing at most all of the time.
    let ceiling = 0;
    for (const t of gunship.turrets) {
      ceiling += 2 * (seconds / t.gun.cycleTime + 1);
    }
    expect(r.fired).toBeGreaterThan(0);
    expect(r.fired).toBeLessThanOrEqual(ceiling);
  });

  it('recoils by exactly the momentum a whole salvo leaves with', () => {
    // Every round in a salvo must leave from the *same* hull velocity. Apply
    // each gun's recoil as it fires and the later rounds inherit a hull the
    // earlier ones already pushed, so the broadside gains momentum invented by
    // the firing order.
    //
    // A gunship with a target dead ahead trains all three mounts onto it, so
    // all three fire on the same step — and with the hull motionless the
    // arithmetic is exact rather than approximate: a round created at rest
    // carries no hull momentum away with it.
    const r = rig();
    const ship = r.ships.spawn(r.world, { design: gunship, x: 0, y: 0 });
    const enemy = r.ships.spawn(r.world, { design: corvette, x: 2000, y: 0 });
    r.ships.pushOrder(ship, enemy, 1900, 2100, 10, OrderCancelCondition.None);

    const bodies = r.world.bodies;
    const b = bodyOf(r, ship);

    train(r);
    expect(bodies.vx[b]).toBe(0);
    expect(bodies.angularVel[b]).toBe(0);

    const fired = r.ships.fire(r.world, r.projectiles, r.beams, r.grid, r.beamHits);
    expect(fired.projectilesFired).toBe(3);

    let px = bodies.mass[b]! * bodies.vx[b]!;
    let py = bodies.mass[b]! * bodies.vy[b]!;
    for (let i = 0; i < r.projectiles.highWater; i++) {
      if (r.projectiles.alive[i] === 0) continue;
      px += r.projectiles.mass[i]! * r.projectiles.vx[i]!;
      py += r.projectiles.mass[i]! * r.projectiles.vy[i]!;
    }
    // TODO the test implies the momentum should be non-zero after because of teh recoil of the shots, but it asserts that the momentum is zero.
    expect(px).toBeCloseTo(0, 6);
    expect(py).toBeCloseTo(0, 6);
  });

  it('launches a round with the tangential velocity of the mount it left', () => {
    // A mount off the centre of mass is travelling sideways whenever its ship
    // is turning. Leave that out and every shot from a turning ship is thrown
    // across the line of fire — a bias in one direction, not scatter.
    const r = rig();
    const spin = 0.2;
    const ship = r.ships.spawn(r.world, { design: gunship, x: 0, y: 0 });
    const enemy = r.ships.spawn(r.world, { design: corvette, x: 2000, y: 0 });
    r.ships.pushOrder(ship, enemy, 1900, 2100, 10, OrderCancelCondition.None);

    const bodies = r.world.bodies;
    const b = bodyOf(r, ship);
    // Trained first and set spinning afterwards: a mount holding a world
    // bearing on a turning hull is never quite still, and this test is about
    // what a round leaves with rather than about how well a turret tracks.
    train(r);
    bodies.angularVel[b] = spin;
    // Before firing: recoil moves the hull, and what a round inherited is the
    // velocity the hull had when it left.
    const hullVx = bodies.vx[b]!;
    const hullVy = bodies.vy[b]!;
    expect(r.ships.fire(r.world, r.projectiles, r.beams, r.grid, r.beamHits).projectilesFired).toBe(3);

    for (let i = 0; i < r.projectiles.highWater; i++) {
      if (r.projectiles.alive[i] === 0) continue;

      // Where the round started, relative to the centre of mass. It has
      // travelled no distance yet, so its spawn point is its muzzle.
      const rx = r.projectiles.x[i]! - bodies.x[b]!;
      const ry = r.projectiles.y[i]! - bodies.y[b]!;
      const tangentialX = -spin * ry;
      const tangentialY = spin * rx;

      // Strip the hull's linear velocity and the mount's tangential velocity;
      // what is left must be the muzzle velocity, straight along the barrel.
      const restX = r.projectiles.vx[i]! - hullVx - tangentialX;
      const restY = r.projectiles.vy[i]! - hullVy - tangentialY;
      const speed = math.length(restX, restY);

      // Every gun on this design shares a calibre-derived muzzle speed only
      // per mount, so check against the mount that matches.
      const speeds = gunship.turrets.map((t) => t.gun.muzzleSpeed);
      const nearest = speeds.reduce((a, c) =>
        math.abs(c - speed) < math.abs(a - speed) ? c : a,
      );
      expect(speed).toBeCloseTo(nearest, 6);

      // And that leftover points along a barrel. Note that it is the *barrel*
      // bearing and not the direction out from the centre of mass: a beam
      // mount's muzzle is offset from the axis it fires along, so the two only
      // agree when the centre of mass happens to sit on that axis, and any
      // change to a module's mass moves it off.
      const bearings = gunship.turrets.map((_, t) => {
        const ti = r.ships.turretIndexOf(0, t);
        return bodies.angle[b]! + r.ships.turrets.bearing[ti]!;
      });
      const alongness = bearings.reduce(
        (best, bearing) =>
          math.max(best, (restX / speed) * math.cos(bearing) + (restY / speed) * math.sin(bearing)),
        -1,
      );
      expect(alongness).toBeCloseTo(1, 9);
    }
  });

  it('cycles through barrels sequentially with transverse offsets', () => {
    const twin = compileBlueprint({
      name: 'Twin',
      modules: [
        { kind: 'core', x: 0, y: 0, length: 10, width: 4 },
        { kind: 'turret', x: 8, y: 0, length: 6, width: 4, barrels: 2 },
      ],
    });
    const r = rig();
    const ship = r.ships.spawn(r.world, { design: twin, x: 0, y: 0 });
    const enemy = r.ships.spawn(r.world, { design: corvette, x: 2000, y: 0 });
    r.ships.pushOrder(ship, enemy, 1900, 2100, 10, OrderCancelCondition.None);

    // Fire 1st round (barrel 0): should be at -0.5 * spacing in y
    train(r);
    expect(r.ships.fire(r.world, r.projectiles, r.beams, r.grid, r.beamHits).projectilesFired).toBe(1);
    const spacing = twin.turrets[0]!.gun.barrelSpacing;
    expect(spacing).toBeGreaterThan(0);
    const y0 = r.projectiles.y[0]!;
    expect(y0).toBeCloseTo(-0.5 * spacing, 6);

    // The first shot's recoil set the hull moving and, fired from a barrel
    // off the axis, turning — and a mount tracking from a moving hull leads
    // its target and counter-rotates, which puts the barrel a fraction off
    // the axis by the second shot. Stopped again, because this is a test
    // about which barrel fires and not about gunnery.
    const hull = bodyOf(r, ship);
    r.world.bodies.vx[hull] = 0;
    r.world.bodies.vy[hull] = 0;
    r.world.bodies.angularVel[hull] = 0;

    // Advance cooldown until next shot can fire
    const cycle = twin.turrets[0]!.gun.cycleTime;
    const stepsToReload = Math.ceil(cycle / DT) + 1;
    for (let s = 0; s < stepsToReload; s++) {
      r.ships.command(DT, r.world);
      r.grid.rebuild(r.world.bodies);
    }
    // Fire 2nd round (barrel 1): should be at +0.5 * spacing in y
    expect(r.ships.fire(r.world, r.projectiles, r.beams, r.grid, r.beamHits).projectilesFired).toBe(1);
    const y1 = r.projectiles.y[1]!;
    expect(y1).toBeCloseTo(+0.5 * spacing, 6);
  });
});

describe('beam gunnery', () => {
  function duel(design: ShipDesign, range: number): Rig {
    const r = rig();
    const a = r.ships.spawn(r.world, { design, x: -range / 2, team: 0 });
    const b = r.ships.spawn(r.world, { design, x: range / 2, angle: math.PI, team: 1 });
    r.ships.pushOrder(a, b, range * 0.9, range * 1.1, 20);
    r.ships.pushOrder(b, a, range * 0.9, range * 1.1, 20);
    return r;
  }

  it('holds fire until its guns have trained round', () => {
    const r = rig();
    // The enemy is dead astern, so no mount starts bearing on it. A turret
    // that happens to rest on its target is ready immediately and *should*
    // fire on the first step — which is why this puts the target where none
    // of them do.
    const ship = r.ships.spawn(r.world, { design: beamGunship, x: 0, angle: 0 });
    const enemy = r.ships.spawn(r.world, { design: beamGunship, x: -1500, angle: math.PI });
    r.ships.pushOrder(ship, enemy, 1400, 1600, 20);

    r.step();
    expect(r.beamsFired).toBe(0);

    // A gunship is sluggish: coming round onto something astern and settling
    // enough for a mount to read as on target takes it something like a
    // quarter of a minute.
    for (let i = 0; i < 60 * 30; i++) r.step();
    expect(r.beamsFired).toBeGreaterThan(0);
  });

  it('respects the gun cycle time rather than firing every step', () => {
    const r = duel(beamGunship, 1200);
    for (let i = 0; i < 60 * 30; i++) r.step();

    const seconds = 30;
    // Two ships, each with every gun bearing at most all of the time.
    let ceiling = 0;
    for (const t of beamGunship.turrets) {
      ceiling += 2 * (seconds / t.gun.cycleTime + 1);
    }
    expect(r.beamsFired).toBeGreaterThan(0);
    expect(r.beamsFired).toBeLessThanOrEqual(ceiling);
  });

  it('recoils is zero', () => {
    // Every round in a salvo must leave from the *same* hull velocity. Apply
    // each gun's recoil as it fires and the later rounds inherit a hull the
    // earlier ones already pushed, so the broadside gains momentum invented by
    // the firing order.
    //
    // A gunship with a target dead ahead trains all three mounts onto it, so
    // all three fire on the same step — and with the hull motionless the
    // arithmetic is exact rather than approximate: a round created at rest
    // carries no hull momentum away with it.
    const r = rig();
    const ship = r.ships.spawn(r.world, { design: beamGunship, x: 0, y: 0 });
    const enemy = r.ships.spawn(r.world, { design: corvette, x: 2000, y: 0 });
    r.ships.pushOrder(ship, enemy, 1900, 2100, 10, OrderCancelCondition.None);

    const bodies = r.world.bodies;
    const b = bodyOf(r, ship);

    train(r);
    expect(bodies.vx[b]).toBe(0);
    expect(bodies.angularVel[b]).toBe(0);

    const fired = r.ships.fire(r.world, r.projectiles, r.beams, r.grid, r.beamHits);
    expect(fired.beamsFired).toBe(3);

    let px = bodies.mass[b]! * bodies.vx[b]!;
    let py = bodies.mass[b]! * bodies.vy[b]!;

    expect(px).toBe(0);
    expect(py).toBe(0);
  });

  it('cycles through barrels sequentially with transverse offsets', () => {
    const twin = compileBlueprint({
      name: 'Twin',
      modules: [
        { kind: 'core', x: 0, y: 0, length: 10, width: 4 },
        { kind: 'beamTurret', x: 8, y: 0, length: 6, width: 4, barrels: 2 },
      ],
    });
    const r = rig();
    const ship = r.ships.spawn(r.world, { design: twin, x: 0, y: 0 });
    const enemy = r.ships.spawn(r.world, { design: corvette, x: 2000, y: 0 });
    r.ships.pushOrder(ship, enemy, 1900, 2100, 10, OrderCancelCondition.None);

    // Fire 1st round (barrel 0): should be at -0.5 * spacing in y
    train(r);
    expect(r.ships.fire(r.world, r.projectiles, r.beams, r.grid, r.beamHits).beamsFired).toBe(1);
    const spacing = twin.turrets[0]!.gun.barrelSpacing;
    expect(spacing).toBeGreaterThan(0);
    const y0 = r.beams.startY[0]!;
    expect(y0).toBeCloseTo(-0.5 * spacing, 6);
    const gun = twin.turrets[0]!.gun;

    // advance time until the beam turns off again
    let timeSinceTrigger = 0;
    while (r.beams.count > 0 && timeSinceTrigger < 100 * gun.beamOnTime) {
      advanceTime();
      // only counts on the first frame it starts firing
      expect(r.ships.fire(r.world, r.projectiles, r.beams, r.grid, r.beamHits).beamsFired).toBe(0);
      timeSinceTrigger += DT;
    }
    // A fixed step can only resolve a dwell to within one step of itself, and
    // the dwell is no longer a whole number of them. So: the first step at or
    // after the dwell, and never a step later than that — the latter is the
    // failure TIMER_SETTLE exists to prevent.
    expect(timeSinceTrigger).toBeGreaterThanOrEqual(gun.beamOnTime);
    expect(timeSinceTrigger).toBeLessThan(gun.beamOnTime + DT);

    // Advance cooldown until next shot can fire
    let timeSpentReloading = 0;
    let mostRecentFiredCount = -1;
    do {
      advanceTime();
      // beam count should be 0 until the beam is turned on by the fire step.
      expect(r.beams.count).toBe(0);
      mostRecentFiredCount = r.ships.fire(r.world, r.projectiles, r.beams, r.grid, r.beamHits).beamsFired;
      timeSpentReloading += DT;
    }
    while (mostRecentFiredCount == 0 && timeSpentReloading < 100 * gun.cycleTime)

    // The same one-step resolution, and the same guard against a second one.
    expect(timeSpentReloading).toBeGreaterThanOrEqual(gun.cycleTime);
    expect(timeSpentReloading).toBeLessThan(gun.cycleTime + DT);
    expect(mostRecentFiredCount).toBe(1);
    expect(r.beams.count).toBe(1);

    // Fire 2nd beam (barrel 1): should be at +0.5 * spacing in y
    const y1 = r.beams.startY[0]!;
    expect(y1).toBeCloseTo(+0.5 * spacing, 6);

    function advanceTime() {
      r.beams.clear(); // beams are cleared every time step
      r.ships.command(DT, r.world);
      r.grid.rebuild(r.world.bodies);
    }
  });

  it('Keeps firing for the expected duration even when the target is lost', () => {
    const ship1 = compileBlueprint({
      name: 'Ship1',
      modules: [
        { kind: 'core', x: 0, y: 0, length: 10, width: 4 },
        { kind: 'beamTurret', x: 8, y: 0, length: 6, width: 4 },
      ],
    });
    const r = rig();
    const ship = r.ships.spawn(r.world, { design: ship1, x: 0, y: 0 });
    const enemy = r.ships.spawn(r.world, { design: corvette, x: 2000, y: 0 });
    r.ships.pushOrder(ship, enemy, 1900, 2100, 10, OrderCancelCondition.CompletelyDead);

    // Open fire on a target that is still there: a ship does not shoot at
    // something it has been told is gone, which is what the rest of this is
    // about not applying to a burst already committed.
    r.ships.command(DT, r.world);
    r.grid.rebuild(r.world.bodies);
    expect(r.ships.fire(r.world, r.projectiles, r.beams, r.grid, r.beamHits).beamsFired).toBe(1);

    // Now the ship's started firing, delete the target
    const enemyBody = r.ships.body(enemy);  // grab the BodyId before removing
    r.ships.remove(enemy);                  // the ship
    r.world.destroy(enemyBody);             // the body itself
    r.ships.clearOrder(ship);               // also cancel the order

    const gun = ship1.turrets[0]!.gun;

    // advance time until the beam turns off again
    let timeSinceTrigger = 0;
    while (r.beams.count > 0 && timeSinceTrigger < 100 * gun.beamOnTime) {
      advanceTime();
      // only counts on the first frame it starts firing
      expect(r.ships.fire(r.world, r.projectiles, r.beams, r.grid, r.beamHits).beamsFired).toBe(0);
      timeSinceTrigger += DT;
    }
    // A fixed step can only resolve a dwell to within one step of itself, and
    // the dwell is no longer a whole number of them. So: the first step at or
    // after the dwell, and never a step later than that — the latter is the
    // failure TIMER_SETTLE exists to prevent.
    expect(timeSinceTrigger).toBeGreaterThanOrEqual(gun.beamOnTime);
    expect(timeSinceTrigger).toBeLessThan(gun.beamOnTime + DT);
    expect(r.beams.count).toBe(0);

    // Wait for a while to make sure the ship doesn't fire again (proof that it knows the target really is gone)
    const waitDuration = 60;
    const steps = waitDuration / DT;

    // make sure it doesn't shoot again as there's nothing to shoot at now.
    for (var i = 0; i < steps; i++) {
      advanceTime();
      // beam count should be 0
      expect(r.ships.fire(r.world, r.projectiles, r.beams, r.grid, r.beamHits).beamsFired).toBe(0);
      expect(r.beams.count).toBe(0);
    }

    function advanceTime() {
      r.beams.clear(); // beams are cleared every time step
      r.ships.command(DT, r.world);
      r.grid.rebuild(r.world.bodies);
    }
  });
});

describe('a queue of orders', () => {
  /** Wreck every module of one kind on a ship, as a battering would. */
  /**
   * Shoot out everything on a ship that does one job: its engines, or its
   * weapons whatever kind of mount they are on. A ship whose guns are let
   * into its hull is disarmed by losing those, and asking for `turret` by
   * name would quietly disarm nothing at all.
   */
  function wreck(r: Rig, ship: number, what: 'thruster' | 'guns'): void {
    const design = r.ships.design(ship);
    const body = r.world.bodies.indexOf(r.ships.body(ship));
    for (let m = 0; m < design.modules.length; m++) {
      const module = design.modules[m]!;
      const hit = what === 'thruster'
        ? module.spec.kind === 'thruster'
        : isWeaponMount(module.spec.kind);
      if (!hit) continue;
      r.ships.damage.absorb(body, m, module.stats.hitPoints * DAMAGE_ENERGY_PER_KG);
    }
  }

  /** A ship with two orders, and the two marks they name. */
  function squadron(first: OrderCancelCondition, second = OrderCancelCondition.CompleteDisable) {
    const r = rig();
    const ship = r.ships.spawn(r.world, { design: gunship, x: 0, y: 0 });
    const a = r.ships.spawn(r.world, { design: dinky, x: 3000, y: 0, team: 1 });
    const b = r.ships.spawn(r.world, { design: dinky, x: -3000, y: 0, team: 1 });
    r.ships.pushOrder(ship, a, 2000, 4000, 50, first);
    r.ships.pushOrder(ship, b, 2000, 4000, 50, second);
    return { r, ship, a, b };
  }

  it('finishes with a target when its condition is met, and not before', () => {
    const { r, ship, a, b } = squadron(OrderCancelCondition.Disarm);
    r.ships.command(DT, r.world);
    expect(r.ships.getCurrentOrder(ship)?.target).toBe(a);

    // Engines gone is not what this order was after.
    wreck(r, a, 'thruster');
    r.ships.command(DT, r.world);
    expect(r.ships.getCurrentOrder(ship)?.target).toBe(a);

    // Its guns are, so the ship is done with it.
    wreck(r, a, 'guns');
    r.ships.command(DT, r.world);
    expect(r.ships.getCurrentOrder(ship)?.target).toBe(b);
  });

  it('wants both halves of a mission kill before it leaves one alone', () => {
    const { r, ship, a, b } = squadron(OrderCancelCondition.CompleteDisable);
    wreck(r, a, 'guns');
    r.ships.command(DT, r.world);
    expect(r.ships.getCurrentOrder(ship)?.target).toBe(a);

    wreck(r, a, 'thruster');
    r.ships.command(DT, r.world);
    expect(r.ships.getCurrentOrder(ship)?.target).toBe(b);
  });

  it('is finished with either half when told either will do', () => {
    const { r, ship, a, b } = squadron(OrderCancelCondition.DisarmOrNoEngines);
    wreck(r, a, 'thruster');
    r.ships.command(DT, r.world);
    expect(r.ships.getCurrentOrder(ship)?.target).toBe(b);
  });

  it('holds a station-keeping order whatever becomes of the target', () => {
    // `None` is the one condition that survives the target being gone
    // altogether: an escort keeps station on the wreck it was escorting.
    const { r, ship, a } = squadron(OrderCancelCondition.None);
    wreck(r, a, 'guns');
    wreck(r, a, 'thruster');
    r.ships.command(DT, r.world);
    expect(r.ships.getCurrentOrder(ship)?.target).toBe(a);

    r.ships.remove(a);
    r.ships.command(DT, r.world);
    expect(r.ships.getCurrentOrder(ship)?.target).toBe(a);
  });

  it('drops any other order once its target is gone', () => {
    const { r, ship, a, b } = squadron(OrderCancelCondition.CompletelyDead);
    r.ships.remove(a);
    r.ships.command(DT, r.world);
    expect(r.ships.getCurrentOrder(ship)?.target).toBe(b);
  });

  it('drops an order whose target died while it waited its turn', () => {
    // Somebody else got there first. Leaving it in the queue would send this
    // ship off to fight a wreck once it finished with the target in front.
    const { r, ship, a, b } = squadron(
      OrderCancelCondition.CompleteDisable,
      OrderCancelCondition.CompleteDisable,
    );
    expect(r.ships.orderCount(ship)).toBe(2);

    r.ships.remove(b);
    r.ships.command(DT, r.world);
    expect(r.ships.orderCount(ship)).toBe(1);
    expect(r.ships.getCurrentOrder(ship)?.target).toBe(a);
  });

  it('holds its heading and its fire with nothing left to do', () => {
    const { r, ship, a, b } = squadron(OrderCancelCondition.CompletelyDead);
    r.ships.remove(a);
    r.ships.remove(b);
    for (let i = 0; i < 120; i++) r.step();

    expect(r.ships.getCurrentOrder(ship)).toBeUndefined();
    expect(r.ships.orderCount(ship)).toBe(0);
    expect(r.fired).toBe(0);
    // Still flying, just not told anything: a ship with no order is not a hulk.
    expect(r.ships.isDisabled(ship)).toBe(false);
  });

  it('takes the whole queue away when the orders are cleared', () => {
    const { r, ship } = squadron(OrderCancelCondition.CompleteDisable);
    expect(r.ships.orderCount(ship)).toBe(2);
    r.ships.clearOrder(ship);
    expect(r.ships.orderCount(ship)).toBe(0);
    expect(r.ships.getCurrentOrder(ship)).toBeUndefined();
  });
});
