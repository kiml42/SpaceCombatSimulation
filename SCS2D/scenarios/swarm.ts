import {
  Impacts,
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
    ships.pushOrder(a, b, range, range * 2, 2000);

    ships.pushOrder(b, a, 50, 2000, 60);
  }


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
      impacts.beams(ships.damage, beams, beamHits, dt, world.bodies);
    },
  };

  return run;
}
