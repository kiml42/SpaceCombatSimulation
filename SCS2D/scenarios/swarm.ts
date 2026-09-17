import {
  compileBlueprint,
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
import { type Battle } from './types.js';
import { DINKY, BEAM_GUNSHIP } from './blueprints.js';
import { Rng } from '../sim/rng.js';

/**
 * Many dinkies and one gunship closing on each other and opening fire.
 */

export function swarm(seed = 20260905, corvetteCount = 20): Battle {
  const dt = 1 / 60;
  const world = new World({ dt, seed });

  const wells: WellSpec[] = [];

  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());

  const dinky = compileBlueprint(DINKY);
  const gunship = compileBlueprint(BEAM_GUNSHIP);

  const b = ships.spawn(world, {
    design: gunship,
    x: 1800,
    y: 240,
    angle: -math.HALF_PI,
    vx: 0,
    vy: -60,
    team: 1,
  });

  const rng = new Rng(seed);
  const randomRadius = 1000;
  const swarm: number[] = [];

  for (let i = 0; i < corvetteCount; i++) {
    const angle = rng.nextRange(0, 2 * math.PI);
    const radius = math.sqrt(rng.nextRange(0, 1)) * randomRadius;
    const x = -1800 + radius * math.cos(angle);
    const y = -240 + radius * math.sin(angle);
    const dvx = rng.nextRange(-20, 20);
    const dvy = rng.nextRange(-20, 20);
    const range = rng.nextRange(30, 100);

    const a = ships.spawn(world, {
      design: dinky,
      x: x,
      y: y,
      angle: rng.nextRange(0, 2 * math.PI),
      vx: dvx,
      vy: 90 + dvy,
      team: 0,
    });
    ships.setOrder(a, b, range, range * 2, 2000);

    swarm.push(a);
  }

  ships.setOrder(b, swarm[0], 50, 2000, 60);

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
      // A stop-gap until terminal ballistics and the damage model (§8 step 2),
      // which decide what a hit does: every round penetrates and is absorbed.
      // Impacts have to be resolved by something, or the rounds stay parked at
      // the point of contact for ever.
      for (let i = 0; i < hits.count; i++) projectiles.kill(hits.projectile[i]!);
    },
  };

  return run;
}
