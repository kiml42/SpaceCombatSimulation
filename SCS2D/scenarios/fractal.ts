import {
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
    totalFired: 0,
    totalHits: 0,

    step(): void {
      ships.command(dt, world);
      world.step();
      grid.rebuild(world.bodies);
      run.totalFired += ships.fire(world, projectiles, beams);
      projectiles.step(dt, world.bodies, grid, hits, wells);
      beams.detectHits(world.bodies, grid, beamHits);
      run.totalHits += hits.count + beamHits.count;
      // A stop-gap until terminal ballistics and the damage model (§8 step 2),
      // which decide what a hit does: every round penetrates and is absorbed.
      // Impacts have to be resolved by something, or the rounds stay parked at
      // the point of contact for ever.
      for (let i = 0; i < hits.count; i++) projectiles.kill(hits.projectile[i]!);
    },
  };

  return run;
}
