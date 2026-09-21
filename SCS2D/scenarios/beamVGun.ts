import {
  Collisions,
  Impacts,
  compileBlueprint,
  gravityWell,
  math,
  ProjectileHits,
  Projectiles,
  BeamHits,
  Beams,
  Ships,
  SpatialGrid,
  World,
  type WellSpec,
} from '../sim/index.js';
import type { Battle } from './types.js';
import { GUNSHIP, BEAM_GUNSHIP } from './blueprints.js';

export function beamVGun(seed = 20260905): Battle {
  const dt = 1 / 60;
  const world = new World({ dt, seed });

  // Off to one side rather than between the ships, so nothing passes close
  // enough for the softening to matter and the pull stays a steady bias rather
  // than a slingshot. At the ranges fought here it is about 1.1 m/s² — half
  // the gunship's own acceleration, so it shapes every trajectory without ever
  // leaving a ship unable to resist it.
  const wells: WellSpec[] = [{ x: 0, y: -1500, gm: 2.5e6, softening: 200 }];
  for (const well of wells) world.addForceProvider(gravityWell(well));

  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());

  const beamGunship = compileBlueprint(BEAM_GUNSHIP);
  const gunship = compileBlueprint(GUNSHIP);

  // Offset across the line of approach as well as along it, so neither ship
  // starts with its bow gun already bearing and both have to manoeuvre.
  // Facing across the engagement, not along it: both have to come round before
  // a gun bears. Their velocity is mostly crossing too, so closing means
  // killing that first — which is what a range band actually asks of a pilot.
  const beamy = ships.spawn(world, {
    design: beamGunship,
    x: -1800,
    y: -240,
    angle: math.HALF_PI,
    vx: 0,
    vy: 80,
    team: 0,
  });
  const gunny = ships.spawn(world, {
    design: gunship,
    x: 1800,
    y: 240,
    angle: -math.HALF_PI,
    vx: 10,
    vy: -60,
    team: 1,
  });

  ships.pushOrder(beamy, gunny, 1500, 2500, 80);
  ships.pushOrder(gunny, beamy, 300, 500, 200);

  const grid = new SpatialGrid(64);
  const projectiles = new Projectiles(512);
  const beams = new Beams(512);
  const hits = new ProjectileHits();
  const beamHits = new BeamHits();
  const impacts = new Impacts();
  const collisions = new Collisions();

  const run: Battle = {
    dt,
    world,
    wells,
    ships,
    projectiles,
    beams,
    grid,
    hits,
    beamHits,
    impacts,
    collisions,
    totalProjectilesFired: 0,
    totalProjectileHits: 0,
    totalBeamsFired: 0,
    totalBeamHits: 0,
    totalContacts: 0,
    totalSevered: 0,

    step(): void {
      ships.command(dt, world);
      world.step();
      // Hulls are solid: what the world's step drove into each other is pushed
      // back apart before anything asks where anything is.
      collisions.step(world.bodies, ships);
      run.totalContacts += collisions.contacts.count;
      grid.rebuild(world.bodies);
      beams.clear();
      beamHits.clear();
      const fireReport = ships.fire(world, projectiles, beams, grid, beamHits);
      run.totalProjectilesFired += fireReport.projectilesFired;
      run.totalBeamsFired += fireReport.beamsFired;
      projectiles.step(dt, world.bodies, grid, hits, wells, ships.hulls);
      run.totalProjectileHits += hits.count;
      run.totalBeamHits += beamHits.count;
      // What the hits did. Rounds walk the modules along their path and are
      // killed or sent on their way; beams pour their power into what they are
      // burning through.
      impacts.rounds(ships, ships.damage, world.bodies, projectiles, hits, ships);
      impacts.beams(ships.damage, beams, beamHits, dt, world.bodies, ships);
      run.totalSevered += ships.sever(world, collisions.contacts);
    },
  };

  return run;
}
