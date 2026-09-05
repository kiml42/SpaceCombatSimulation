import {
  compileBlueprint,
  math,
  ProjectileHits,
  Projectiles,
  Ships,
  SpatialGrid,
  World,
} from '../sim/index.js';
import { CORVETTE, GUNSHIP } from './blueprints.js';

/**
 * A corvette and a gunship closing on each other and opening fire.
 *
 * **One definition, used by both the golden test and the viewer**, which is
 * the point of it being here rather than in either. The step order below is
 * load-bearing — turrets are commanded before the world advances, guns fire
 * after the index is rebuilt — and a viewer that had its own copy of that
 * order would drift from the one being pinned without anything failing. What
 * is on screen is then not what the checksum covers, which is the worst of
 * both.
 *
 * Two different designs on purpose. A duel between identical ships is
 * symmetric, and a symmetric scenario hides any error that is also symmetric.
 *
 * Plain TypeScript, no DOM and no Node: it has to run in a browser, in a test
 * and in a worker alike.
 */

export interface Duel {
  readonly dt: number;
  readonly world: World;
  readonly ships: Ships;
  readonly projectiles: Projectiles;
  readonly grid: SpatialGrid;
  readonly hits: ProjectileHits;
  /** Cumulative, so a duel that stops shooting or stops hitting is detectable. */
  totalFired: number;
  totalHits: number;
  step(): void;
}

export function duel(seed = 20260905): Duel {
  const dt = 1 / 60;
  const world = new World({ dt, seed });
  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());

  const corvette = compileBlueprint(CORVETTE);
  const gunship = compileBlueprint(GUNSHIP);

  // Offset across the line of approach as well as along it, so neither ship
  // starts with its bow gun already bearing and both have to manoeuvre.
  const a = ships.spawn(world, { design: corvette, x: -1800, y: -240, team: 0 });
  const b = ships.spawn(world, {
    design: gunship,
    x: 1800,
    y: 240,
    angle: math.PI,
    team: 1,
  });

  // The corvette wants to be inside the gunship's reach; the gunship would
  // rather hold it off. Neither gets what it wants, which is the interesting
  // part.
  ships.setOrder(a, b, 300, 500, 120);
  ships.setOrder(b, a, 900, 1200, 60);

  const grid = new SpatialGrid(64);
  const projectiles = new Projectiles(512);
  const hits = new ProjectileHits();

  const run: Duel = {
    dt,
    world,
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
      projectiles.step(dt, world.bodies, grid, hits);
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
