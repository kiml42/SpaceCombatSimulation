import { describe, expect, it } from 'vitest';
import { Bodies } from '../sim/bodies.js';
import {
  DAMAGE_ENERGY_PER_KG,
  Damage,
  DamageEffect,
  HullPath,
  Terminal,
  BeamHits,
  Beams,
  Impacts,
  ProjectileHits,
  Snapshot,
  capture,
  Projectiles,
  Ships,
  SpatialGrid,
  World,
  compileBlueprint,
  resolveRound,
  type ShipDesign,
} from '../sim/index.js';
import { CORVETTE } from '../scenarios/blueprints.js';

/**
 * What a hit does to the ship it landed on.
 *
 * Terminal ballistics decides what happens at each plate and is tested on its
 * own; what is here is the ship's half — which modules a round spends itself
 * on, what that costs them, and what a module with nothing left stops doing.
 */

const corvette: ShipDesign = compileBlueprint(CORVETTE);

/** One ship at the origin, facing +x, with a damage record. */
function ship(angle = 0): { bodies: Bodies; damage: Damage; path: HullPath } {
  const bodies = new Bodies();
  bodies.create({ x: 0, y: 0, angle, mass: corvette.mass, inertia: corvette.inertia, radius: corvette.radius });
  const damage = new Damage();
  damage.register(0, corvette);
  return { bodies, damage, path: new HullPath() };
}

/** Fire one round along +x into the ship's nose, from the impact point. */
function shoot(
  r: ReturnType<typeof ship>,
  mass = 90,
  calibre = 0.16,
  speed = 560,
  y = 0,
) {
  // Where a round travelling +x meets the hull: the narrow phase would find
  // this, and starting outside the ship gets the same answer.
  return resolveRound(corvette, r.damage, r.bodies, 0, r.path, -corvette.radius * 2, y, 1, 0, mass, calibre, speed);
}

describe('spending a round on a ship', () => {
  it('puts energy into every module it crosses', () => {
    const r = ship();
    const outcome = shoot(r);
    expect(outcome.crossed).toBeGreaterThan(0);
    expect(outcome.energy).toBeGreaterThan(0);

    let damaged = 0;
    for (let m = 0; m < corvette.modules.length; m++) {
      if (r.damage.integrity(0, m) < 1) damaged++;
    }
    expect(damaged).toBe(outcome.crossed);
  });

  it('overpenetrates a light hull, leaving most of what it had', () => {
    // The honest answer, and the reason a shell has a fuse: a heavy round
    // through thin armour spends a little at each plate and carries the rest
    // out the far side.
    const r = ship();
    const arrived = 0.5 * 90 * 560 * 560;
    const outcome = shoot(r);
    expect(outcome.outcome).toBe(Terminal.Perforate);
    expect(outcome.speed).toBeGreaterThan(0);
    expect(outcome.energy).toBeLessThan(arrived * 0.5);
  });

  it('stops where it runs out, and gives that module everything left', () => {
    // A slow round against the same armour: it gets into the first module and
    // no further, and what it had goes there.
    const r = ship();
    const outcome = shoot(r, 90, 0.16, 120);
    expect(outcome.outcome).toBe(Terminal.Embed);
    expect(outcome.speed).toBe(0);
    expect(outcome.crossed).toBe(1);
    expect(outcome.energy).toBeCloseTo(0.5 * 90 * 120 * 120, 6);
  });

  it('wrecks a module once it has taken all it can', () => {
    const r = ship();
    const first = shoot(r, 90, 0.16, 120);
    const module = corvette.modules.findIndex((_, m) => r.damage.integrity(0, m) < 1);
    expect(module).toBeGreaterThanOrEqual(0);

    const capacity = corvette.modules[module]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG;
    expect(first.energy).toBeLessThan(capacity);

    // Keep shooting it until there is nothing left to hurt.
    for (let i = 0; i < 200 && !r.damage.spent(0, module); i++) shoot(r, 90, 0.16, 120);
    expect(r.damage.spent(0, module)).toBe(true);
    expect(r.damage.integrity(0, module)).toBe(0);
    // Matter is conserved: it is still in the layout, still in the way.
    expect(corvette.modules[module]).toBeDefined();
  });

  it('is turned with the ship, so a beam hit is a hit wherever it is pointing', () => {
    // The same shot against a ship turned a quarter turn meets the same hull,
    // because the cast is taken in the ship's own frame.
    const straight = ship();
    const turned = ship(Math.PI / 2);
    const a = shoot(straight);
    const b = resolveRound(
      corvette, turned.damage, turned.bodies, 0, turned.path,
      0, -corvette.radius * 2, 0, 1, 90, 0.16, 560,
    );
    expect(b.crossed).toBe(a.crossed);
    expect(b.energy).toBeCloseTo(a.energy, 6);
  });
});

describe('what damage takes away', () => {
  it('leaves a module alone until something hits it', () => {
    const r = ship();
    for (let m = 0; m < corvette.modules.length; m++) {
      expect(r.damage.integrity(0, m)).toBe(1);
      expect(r.damage.remaining(0, m, DamageEffect.Thrust)).toBe(1);
      expect(r.damage.remaining(0, m, DamageEffect.FireRate)).toBe(1);
    }
  });

  it('stops an engine before the module is spent, and a gun later still', () => {
    // An engine's plumbing gives out with a third of the engine left; a gun is
    // a simpler thing and keeps going longer. Neither stops absorbing damage
    // when it stops working.
    const r = ship();
    const thruster = corvette.modules.findIndex((m) => m.spec.kind === 'thruster');
    const turret = corvette.modules.findIndex((m) => m.spec.kind === 'turret');
    const capacity = (m: number) => corvette.modules[m]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG;

    r.damage.absorb(0, thruster, capacity(thruster) * 0.5);
    r.damage.absorb(0, turret, capacity(turret) * 0.5);
    expect(r.damage.remaining(0, thruster, DamageEffect.Thrust)).toBeLessThan(1);
    expect(r.damage.remaining(0, thruster, DamageEffect.Thrust)).toBeGreaterThan(0);

    r.damage.absorb(0, thruster, capacity(thruster) * 0.25);
    expect(r.damage.remaining(0, thruster, DamageEffect.Thrust)).toBe(0);
    expect(r.damage.spent(0, thruster)).toBe(false);

    // A gun with a fifth of itself left still fires, where an engine gave out
    // at a third: 0.3 against 0.15.
    r.damage.absorb(0, turret, capacity(turret) * 0.3);
    expect(r.damage.remaining(0, turret, DamageEffect.FireRate)).toBeGreaterThan(0);
    r.damage.absorb(0, turret, capacity(turret) * 0.1);
    expect(r.damage.remaining(0, turret, DamageEffect.FireRate)).toBe(0);
  });

  it('gives structure nothing to lose but its matter', () => {
    const r = ship();
    const hull = corvette.modules.findIndex((m) => m.spec.kind === 'structure');
    r.damage.absorb(0, hull, corvette.modules[hull]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG * 2);
    expect(r.damage.spent(0, hull)).toBe(true);
    // No response of its own: a wrecked girder is a girder.
    expect(r.damage.remaining(0, hull, DamageEffect.Thrust)).toBe(1);
  });

  it('counts a version up, so what is derived from damage knows to rebuild', () => {
    const r = ship();
    const before = r.damage.version(0);
    r.damage.absorb(0, 0, 1);
    expect(r.damage.version(0)).toBeGreaterThan(before);
    // Nothing absorbed, nothing changed.
    const after = r.damage.version(0);
    r.damage.absorb(0, 0, 0);
    expect(r.damage.version(0)).toBe(after);
  });
});

describe('a damaged ship flies and shoots worse', () => {
  /** One ship in a world, with an order to hold station on a mark. */
  function fleet() {
    const world = new World({ dt: 1 / 60, seed: 7 });
    const ships = new Ships();
    world.addForceProvider(ships.forceProvider());
    const ship = ships.spawn(world, { design: corvette, x: 0, y: 0, team: 0 });
    const mark = ships.spawn(world, { design: corvette, x: 2000, y: 0, team: 1 });
    ships.pushOrder(ship, mark, 300, 500, 120);
    return { world, ships, ship, mark, body: world.bodies.indexOf(ships.body(ship)) };
  }

  /** Wreck every module of one kind, as a battering would. */
  function wreck(f: ReturnType<typeof fleet>, kind: string): void {
    for (let m = 0; m < corvette.modules.length; m++) {
      if (corvette.modules[m]!.spec.kind !== kind) continue;
      f.ships.damage.absorb(f.body, m, corvette.modules[m]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG);
    }
  }

  it('pushes less hard with its engines wrecked', () => {
    const healthy = fleet();
    const hurt = fleet();
    wreck(hurt, 'thruster');

    for (let i = 0; i < 120; i++) {
      healthy.ships.command(1 / 60, healthy.world);
      healthy.world.step();
      hurt.ships.command(1 / 60, hurt.world);
      hurt.world.step();
    }

    const moved = (f: ReturnType<typeof fleet>): number =>
      Math.hypot(f.world.bodies.vx[f.body]!, f.world.bodies.vy[f.body]!);
    expect(moved(healthy)).toBeGreaterThan(0);
    // Not merely slower: with every engine gone it has nothing to push with.
    expect(moved(hurt)).toBe(0);
  });

  it('is a hulk once it can neither move nor shoot', () => {
    const f = fleet();
    expect(f.ships.isDisabled(f.ship)).toBe(false);
    wreck(f, 'thruster');
    expect(f.ships.isDisabled(f.ship)).toBe(false);
    wreck(f, 'turret');
    expect(f.ships.isDisabled(f.ship)).toBe(true);
    // Still in the world, still a ship, still in the way (§4).
    expect(f.ships.isAlive(f.ship)).toBe(true);
    expect(f.world.bodies.indexOf(f.ships.body(f.ship))).toBeGreaterThanOrEqual(0);
  });

  it('fires slower with a battered mount than with a fresh one', () => {
    const healthy = fleet();
    const hurt = fleet();
    const turret = corvette.modules.findIndex((m) => m.spec.kind === 'turret');
    // Half spent: past the point where the response starts biting.
    hurt.ships.damage.absorb(
      hurt.body,
      turret,
      corvette.modules[turret]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG * 0.5,
    );

    const salvo = (f: ReturnType<typeof fleet>): number => {
      const projectiles = new Projectiles(64);
      const beams = new Beams(8);
      const beamHits = new BeamHits();
      const grid = new SpatialGrid(64);
      let fired = 0;
      for (let i = 0; i < 600; i++) {
        f.ships.command(1 / 60, f.world);
        f.world.step();
        grid.rebuild(f.world.bodies);
        fired += f.ships.fire(f.world, projectiles, beams, grid, beamHits).projectilesFired;
      }
      return fired;
    };

    const fresh = salvo(healthy);
    const battered = salvo(hurt);
    expect(fresh).toBeGreaterThan(0);
    expect(battered).toBeLessThan(fresh);
  });
});

describe('what a hit logs to be drawn', () => {
  it('records where it landed on the hull, not only where that was in the world', () => {
    // A flash belongs to the ship it went off against: a hull doing two
    // hundred metres a second would otherwise leave its own hits behind.
    const world = new World({ dt: 1 / 60, seed: 3 });
    const ships = new Ships();
    world.addForceProvider(ships.forceProvider());
    const ship = ships.spawn(world, { design: corvette, x: 500, y: -200, angle: Math.PI / 2, team: 0 });
    const bodies = world.bodies;
    const body = bodies.indexOf(ships.body(ship));

    const impacts = new Impacts();
    const projectiles = new Projectiles(8);
    const hits = new ProjectileHits();
    const grid = new SpatialGrid(64);
    grid.rebuild(bodies);
    projectiles.spawn({ x: 500 - corvette.radius * 2, y: -200, vx: 900, vy: 0, width: 0.16, ttl: 5, mass: 90 });
    for (let i = 0; i < 60 && hits.count === 0; i++) {
      projectiles.step(1 / 60, bodies, grid, hits, undefined, ships.hulls);
      if (hits.count > 0) impacts.rounds(ships, ships.damage, bodies, projectiles, hits);
    }

    expect(impacts.log.count).toBe(1);
    expect(impacts.log.body[0]).toBe(body);
    // The offset is in the ship's frame, so putting it back through the ship's
    // pose returns the world point the hit happened at.
    const angle = bodies.angle[body]!;
    const x = bodies.x[body]! + impacts.log.localX[0]! * Math.cos(angle) - impacts.log.localY[0]! * Math.sin(angle);
    const y = bodies.y[body]! + impacts.log.localX[0]! * Math.sin(angle) + impacts.log.localY[0]! * Math.cos(angle);
    expect(x).toBeCloseTo(impacts.log.x[0]!, 9);
    expect(y).toBeCloseTo(impacts.log.y[0]!, 9);
  });

  it('shoves the ship by the momentum the round left in it', () => {
    // A round is a lump of metal arriving at speed, so what it gives up it
    // gives to the hull. It is also what can tear a piece off, and a blow
    // that moved nothing could not.
    const world = new World({ dt: 1 / 60, seed: 4 });
    const ships = new Ships();
    const ship = ships.spawn(world, { design: corvette, x: 0, y: 0, team: 0 });
    const bodies = world.bodies;
    const body = bodies.indexOf(ships.body(ship));

    const impacts = new Impacts();
    const projectiles = new Projectiles(8);
    const hits = new ProjectileHits();
    const grid = new SpatialGrid(64);
    grid.rebuild(bodies);
    const mass = 90;
    const speed = 900;
    projectiles.spawn({ x: -corvette.radius * 2, y: 0, vx: speed, vy: 0, width: 0.16, ttl: 5, mass });
    for (let i = 0; i < 60 && hits.count === 0; i++) {
      projectiles.step(1 / 60, bodies, grid, hits, undefined, ships.hulls);
      if (hits.count > 0) impacts.rounds(ships, ships.damage, bodies, projectiles, hits, ships);
    }
    expect(hits.count).toBe(1);

    // Whatever the round kept, the ship took the rest — head on, so all of it
    // is along the round's own heading.
    const left = projectiles.alive[0] === 1 ? projectiles.vx[0]! : 0;
    expect(bodies.vx[body]).toBeCloseTo((mass * (speed - left)) / corvette.mass, 9);
    expect(bodies.vx[body]!).toBeGreaterThan(0);
  });
});

describe('what the picture is told about damage', () => {
  it('reports a wrecked mount as one that cannot shoot', () => {
    // The renderer draws a firing arc as a promise that a gun may shoot there,
    // and has no business guessing at the cutout that decides it. So the
    // snapshot carries the same answer the gunnery acts on.
    const world = new World({ dt: 1 / 60, seed: 11 });
    const ships = new Ships();
    world.addForceProvider(ships.forceProvider());
    const ship = ships.spawn(world, { design: corvette, x: 0, y: 0, team: 0 });
    const body = world.bodies.indexOf(ships.body(ship));

    const projectiles = new Projectiles(4);
    const beams = new Beams(4);
    const before = capture(new Snapshot(), world, ships, projectiles, beams);
    expect(before.ships[0]!.turretDisabled).toEqual(corvette.turrets.map(() => false));
    expect(before.ships[0]!.isDisabled).toBe(false);

    // Wreck the mount the first turret is built on.
    const module = corvette.turrets[0]!.module;
    ships.damage.absorb(body, module, corvette.modules[module]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG);

    const after = capture(new Snapshot(), world, ships, projectiles, beams);
    expect(after.ships[0]!.turretDisabled[0]).toBe(true);
    expect(ships.isTurretDisabled(ship, 0)).toBe(true);
    // The module is still drawn, and still stops shells: it is wreckage, not
    // an absence (§4).
    expect(after.ships[0]!.integrity[module]).toBe(0);
    expect(after.ships[0]!.design.modules[module]).toBeDefined();
  });
});
