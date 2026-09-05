import { describe, expect, it } from 'vitest';
import {
  compileBlueprint,
  math,
  NO_TARGET,
  ProjectileHits,
  Projectiles,
  Ships,
  SpatialGrid,
  World,
  type ShipDesign,
} from '../sim/index.js';
import { CORVETTE, GUNSHIP } from '../scenarios/blueprints.js';

const DT = 1 / 60;

const corvette = compileBlueprint(CORVETTE);
const gunship = compileBlueprint(GUNSHIP);

interface Rig {
  world: World;
  ships: Ships;
  projectiles: Projectiles;
  hits: ProjectileHits;
  grid: SpatialGrid;
  /** Rounds put in the air over the run, since a store recycles its slots. */
  fired: number;
  step(): void;
}

function rig(): Rig {
  const world = new World({ dt: DT, seed: 4 });
  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());
  const projectiles = new Projectiles(256);
  const hits = new ProjectileHits();
  const grid = new SpatialGrid(64);
  const r: Rig = {
    world,
    ships,
    projectiles,
    hits,
    grid,
    fired: 0,
    step(): void {
      ships.command(DT, world);
      world.step();
      grid.rebuild(world.bodies);
      r.fired += ships.fire(world, projectiles);
      projectiles.step(DT, world.bodies, grid, hits);
      for (let i = 0; i < hits.count; i++) projectiles.kill(hits.projectile[i]!);
    },
  };
  return r;
}

function bodyOf(r: Rig, ship: number): number {
  return r.world.bodies.indexOf(r.ships.body(ship));
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
    r.ships.setOrder(a, enemy, 400, 600, 80);
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
    r.ships.setOrder(a, enemy, 400, 600, 80);

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
    r.ships.setOrder(chaser, quarry, 800, 1000, 150);

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
    r.ships.setOrder(ship, enemy, 2000, 4000, 50);

    for (let i = 0; i < 60 * 60; i++) r.step();

    const bodies = r.world.bodies;
    const b = bodyOf(r, ship);
    const wanted = math.atan2(
      bodies.y[bodyOf(r, enemy)]! - bodies.y[b]!,
      bodies.x[bodyOf(r, enemy)]! - bodies.x[b]!,
    );
    expect(math.abs(math.angleDelta(bodies.angle[b]!, wanted))).toBeLessThan(0.05);
  });

  it('sits still when it has no order', () => {
    const r = rig();
    const ship = r.ships.spawn(r.world, { design: corvette, x: 0, y: 0 });
    expect(r.ships.order(ship).target).toBe(NO_TARGET);

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
    r.ships.setOrder(a, b, range * 0.9, range * 1.1, 20);
    r.ships.setOrder(b, a, range * 0.9, range * 1.1, 20);
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
    r.ships.setOrder(ship, enemy, 1400, 1600, 20);

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

    const cycle = gunship.turrets[0]!.gun.cycleTime;
    const seconds = 30;
    const guns = gunship.turrets.length;
    // Two ships, each with every gun bearing at most all of the time.
    const ceiling = 2 * guns * (seconds / cycle + 1);
    expect(r.fired).toBeGreaterThan(0);
    expect(r.fired).toBeLessThanOrEqual(ceiling);
  });

  it('recoils by exactly the momentum a whole salvo leaves with', () => {
    // Every round in a salvo must leave from the *same* hull velocity. Apply
    // each gun's recoil as it fires and the later rounds inherit a hull the
    // earlier ones already pushed, so the broadside gains momentum invented by
    // the firing order.
    //
    // A gunship with a dead target returns all three mounts to rest, where
    // each reads as on target, so all three fire on the same step — and with
    // the hull motionless the arithmetic is exact rather than approximate: a
    // round created at rest carries no hull momentum away with it.
    const r = rig();
    const ship = r.ships.spawn(r.world, { design: gunship, x: 0, y: 0 });
    const enemy = r.ships.spawn(r.world, { design: corvette, x: 2000, y: 0 });
    r.ships.setOrder(ship, enemy, 1900, 2100, 10);
    r.ships.remove(enemy);

    const bodies = r.world.bodies;
    const b = bodyOf(r, ship);

    r.ships.command(DT, r.world);
    r.grid.rebuild(bodies);
    expect(bodies.vx[b]).toBe(0);
    expect(bodies.angularVel[b]).toBe(0);

    const fired = r.ships.fire(r.world, r.projectiles);
    expect(fired).toBe(3);

    let px = bodies.mass[b]! * bodies.vx[b]!;
    let py = bodies.mass[b]! * bodies.vy[b]!;
    for (let i = 0; i < r.projectiles.highWater; i++) {
      if (r.projectiles.alive[i] === 0) continue;
      px += r.projectiles.mass[i]! * r.projectiles.vx[i]!;
      py += r.projectiles.mass[i]! * r.projectiles.vy[i]!;
    }
    expect(px).toBeCloseTo(0, 6);
    expect(py).toBeCloseTo(0, 6);
  });

  it('launches a round with the tangential velocity of the mount it left', () => {
    // A mount off the centre of mass is travelling sideways whenever its ship
    // is turning. Leave that out and every shot from a turning ship is thrown
    // across the line of fire — a bias in one direction, not scatter.
    const r = rig();
    const spin = 0.2;
    const ship = r.ships.spawn(r.world, {
      design: gunship,
      x: 0,
      y: 0,
      angularVel: spin,
    });
    const enemy = r.ships.spawn(r.world, { design: corvette, x: 2000, y: 0 });
    r.ships.setOrder(ship, enemy, 1900, 2100, 10);
    r.ships.remove(enemy);

    const bodies = r.world.bodies;
    const b = bodyOf(r, ship);
    r.ships.command(DT, r.world);
    r.grid.rebuild(bodies);
    // Before firing: recoil moves the hull, and what a round inherited is the
    // velocity the hull had when it left.
    const hullVx = bodies.vx[b]!;
    const hullVy = bodies.vy[b]!;
    expect(r.ships.fire(r.world, r.projectiles)).toBe(3);

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

      // And that leftover points along the barrel, not across it.
      const alongness = (restX / speed) * (rx / math.length(rx, ry)) +
        (restY / speed) * (ry / math.length(rx, ry));
      expect(alongness).toBeGreaterThan(0.99);
    }
  });
});
