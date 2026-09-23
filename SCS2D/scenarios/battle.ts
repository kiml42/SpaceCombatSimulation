import {
  Beams,
  BeamHits,
  Collisions,
  Credit,
  gravityWell,
  Impacts,
  math,
  Projectiles,
  ProjectileHits,
  Ships,
  SpatialGrid,
  World,
  type WellSpec,
} from '../sim/index.js';
import type { Battle } from './types.js';

/**
 * How a scenario is assembled and stepped, in one place.
 *
 * A scenario is interesting for its ships, its geometry and its orders; the
 * stores it needs and the order they are driven in are the same for all of
 * them. The step order is load-bearing — turrets are commanded before the
 * world advances, guns fire after the index is rebuilt — and a scenario with
 * its own copy of it would drift from the one being checksummed without
 * anything failing, so every scenario shares this one.
 */

/** The standing gravity well the ranged battles are fought around.
 *
 * Off to one side rather than between the ships, so nothing passes close
 * enough for the softening to matter and the pull stays a steady bias rather
 * than a slingshot. At the ranges fought there it is about 1.1 m/s² — half a
 * gunship's own acceleration, so it shapes every trajectory without ever
 * leaving a ship unable to resist it.
 */
export const SIDE_WELL: WellSpec = { x: 0, y: -1500, gm: 2.5e6, softening: 200 };

/**
 * Where the two sides of a ranged duel start.
 *
 * Offset across the line of approach as well as along it, so neither ship
 * starts with its bow gun already bearing and both have to manoeuvre. Facing
 * across the engagement, not along it: both have to come round before a gun
 * bears. Their velocity is mostly crossing too, so closing means killing that
 * first — which is what a range band actually asks of a pilot.
 */
export const CROSSING = {
  west: { x: -1800, y: -240, angle: math.HALF_PI, vx: 0, vy: 90 },
  east: { x: 1800, y: 240, angle: -math.HALF_PI, vx: 0, vy: -60 },
} as const;

export interface BattleOptions {
  readonly seed: number;
  readonly dt?: number;
  readonly wells?: readonly WellSpec[];
  /** Rounds and beams in flight at once. */
  readonly projectiles?: number;
  readonly beams?: number;
  /**
   * Whether pilots fly. A scenario about hulls meeting leaves them ballistic,
   * since a ship told nothing burns to kill the very velocity that would carry
   * it into something.
   */
  readonly pilots?: boolean;
}

/**
 * Build a battle: `setup` spawns the ships and issues the orders, and anything
 * it returns is carried on the battle for a caller that needs to know which
 * ship is which.
 */
export function makeBattle<Extra extends object = Record<never, never>>(
  options: BattleOptions,
  setup: (ships: Ships, world: World) => Extra | void,
): Battle & Extra {
  const dt = options.dt ?? 1 / 60;
  const world = new World({ dt, seed: options.seed });

  const wells = options.wells ?? [];
  for (const well of wells) world.addForceProvider(gravityWell(well));

  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());

  const extra = setup(ships, world) ?? ({} as Extra);

  const pilots = options.pilots ?? true;
  const grid = new SpatialGrid(64);
  const projectiles = new Projectiles(options.projectiles ?? 512);
  const beams = new Beams(options.beams ?? 512);
  const hits = new ProjectileHits();
  const beamHits = new BeamHits();
  const impacts = new Impacts();
  const collisions = new Collisions();
  const credit = new Credit();

  const run: Battle & Extra = {
    ...(extra as Extra),
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
    credit,
    totalProjectilesFired: 0,
    totalProjectileHits: 0,
    totalBeamsFired: 0,
    totalBeamHits: 0,
    totalContacts: 0,
    totalSevered: 0,
    totalCulled: 0,

    step(): void {
      if (pilots) ships.command(dt, world, grid);
      world.step();
      // Hulls are solid: what the world's step drove into each other is pushed
      // back apart before anything asks where anything is.
      collisions.step(world.bodies, ships);
      run.totalContacts += collisions.contacts.count;
      impacts.collisions(ships, ships.damage, world.bodies, collisions.contacts);
      grid.rebuild(world.bodies);
      beams.clear();
      beamHits.clear();
      // Filled again by this step's hits, for whatever is scoring the battle.
      credit.clear();
      const fireReport = ships.fire(world, projectiles, beams, grid, beamHits);
      run.totalProjectilesFired += fireReport.projectilesFired;
      run.totalBeamsFired += fireReport.beamsFired;
      // Exhaust burns whatever it is playing on, which is as much a weapon as
      // a gun and answers to the same rebuilt index.
      ships.scorch(world, grid, dt);
      projectiles.step(dt, world.bodies, grid, hits, wells, ships.hulls);
      run.totalProjectileHits += hits.count;
      run.totalBeamHits += beamHits.count;
      // What the hits did. Rounds walk the modules along their path and are
      // killed or sent on their way; beams pour their power into what they are
      // burning through.
      impacts.rounds(ships, ships.damage, world.bodies, projectiles, hits, ships, credit);
      impacts.beams(ships.damage, beams, beamHits, dt, world.bodies, ships, credit);
      run.totalSevered += ships.sever(world, collisions.contacts);
      run.totalCulled += ships.cull(world);
    },
  };

  return run;
}
