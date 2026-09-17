import {
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
import { FRACTAL, GUNSHIP2 } from './blueprints.js';

export function fractal(seed = 20260905): Battle {
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

  const fractal = compileBlueprint(FRACTAL);
  const gunship = compileBlueprint(GUNSHIP2);

  const distantCorvette = ships.spawn(world, {
    design: fractal,
    x: -1800,
    y: -240,
    angle: math.HALF_PI,
    vx: 0,
    vy: 90,
    team: 0,
  });
  const b = ships.spawn(world, {
    design: gunship,
    x: 1800,
    y: 240,
    angle: -math.HALF_PI,
    vx: 0,
    vy: -60,
    team: 1,
  });

  ships.setOrder(distantCorvette, b, 300, 500, 120);
  ships.setOrder(b, distantCorvette, 900, 1200, 60);

  const grid = new SpatialGrid(64);
  const projectiles = new Projectiles(512);
  const beams = new Beams(512);
  const hits = new ProjectileHits();
  const beamHits = new BeamHits();
  const impacts = new Impacts();

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
    totalProjectilesFired: 0,
    totalProjectileHits: 0,
    totalBeamsFired: 0,
    totalBeamHits: 0,

    step(): void {
      ships.command(dt, world);
      world.step();
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
      impacts.rounds(ships, ships.damage, world.bodies, projectiles, hits);
      impacts.beams(ships.damage, beams, beamHits, dt);
    },
  };

  return run;
}
