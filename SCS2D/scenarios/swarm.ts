import {
  compileBlueprint,
  math,
  ProjectileHits,
  Projectiles,
  Ships,
  SpatialGrid,
  World,
  type WellSpec,
} from '../sim/index.js';
import { type Battle } from './types.js';
import { CORVETTE, GUNSHIP } from './blueprints.js';
import { Rng } from '../sim/rng.js';

/**
 * Many corvettes and one gunship closing on each other and opening fire.
 */

export function swarm(seed = 20260905, corvetteCount = 20): Battle {
  const dt = 1 / 60;
  const world = new World({ dt, seed });

  const wells: WellSpec[] = [];

  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());

  const corvette = compileBlueprint(CORVETTE);
  const gunship = compileBlueprint(GUNSHIP);

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
  const corvettes: number[] = [];

  for (let i = 0; i < corvetteCount; i++) {
    const angle = rng.nextRange(0, 2 * math.PI);
    const radius = math.sqrt(rng.nextRange(0, 1)) * randomRadius;
    const x = -1800 + radius * math.cos(angle);
    const y = -240 + radius * math.sin(angle);
    const dvx = rng.nextRange(-20, 20);
    const dvy = rng.nextRange(-20, 20);

    const a = ships.spawn(world, {
      design: corvette,
      x: x,
      y: y,
      angle: rng.nextRange(0, 2 * math.PI),
      vx: dvx,
      vy: 90 + dvy,
      team: 0,
    });
    ships.setOrder(a, b, 300, 500, 120);

    corvettes.push(a);
  }

  ships.setOrder(b, corvettes[0], 900, 1200, 60);

  const grid = new SpatialGrid(64);
  const projectiles = new Projectiles(512);
  const hits = new ProjectileHits();

  const run: Battle = {
    dt,
    world,
    wells,
    ships,
    projectiles,
    grid,
    hits,
    totalFired: 0,
    totalHits: 0,

    step(): void {
      ships.command(dt, world);
      world.step();
      grid.rebuild(world.bodies);
      run.totalFired += ships.fire(world, projectiles);
      projectiles.step(dt, world.bodies, grid, hits, wells);
      run.totalHits += hits.count;
      // A stop-gap until terminal ballistics and the damage model (§8 step 2),
      // which decide what a hit does: every round penetrates and is absorbed.
      // Impacts have to be resolved by something, or the rounds stay parked at
      // the point of contact for ever.
      for (let i = 0; i < hits.count; i++) projectiles.kill(hits.projectile[i]!);
    },
  };

  return run;
}
