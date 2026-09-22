import {
  Collisions,
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
  type ShipDesign,
} from '../sim/index.js';
import { type Battle } from './types.js';
import { STAR_DESTROYER, TIE, X_WING, GHOST } from './blueprints.js';
import { Rng } from '../sim/rng.js';

/**
 * A fleet action with nobody flying it.
 *
 * Every craft in it carries its own doctrine and nothing issues an order:
 * the fighters go for each other's guns and engines, the freighters take
 * whatever is nearest, the Star Destroyer's batteries work down from the
 * biggest thing on the board, and its close-in beams fight their own battle
 * against whatever has got inside them. What the battle does is therefore a
 * property of four blueprints rather than of this file.
 */

export function starWars(seed = 20260905, tieFighterCount = 8, xWingCount = 30): Battle {
  const dt = 1 / 60;
  const world = new World({ dt, seed });

  const wells: WellSpec[] = [];

  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());

  const xWingBlueprint = compileBlueprint(X_WING);
  const ghostBlueprint = compileBlueprint(GHOST);

  const tieBlueprint = compileBlueprint(TIE);
  const isdBlueprint = compileBlueprint(STAR_DESTROYER);

  const rng = new Rng(seed);
  const randomRadius = 1000;


  spawnMany(1, rng, randomRadius, ships, world, isdBlueprint, 10_000, 0, 0);
  spawnMany(tieFighterCount, rng, randomRadius, ships, world, tieBlueprint, 1200, 0, 0);

  spawnMany(xWingCount, rng, randomRadius, ships, world, xWingBlueprint, -2400, 0, 1);
  spawnMany(2, rng, randomRadius, ships, world, ghostBlueprint, -4000, 0, 1);

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
    totalCulled: 0,

    step(): void {
      ships.command(dt, world);
      world.step();
      // Hulls are solid: what the world's step drove into each other is pushed
      // back apart before anything asks where anything is.
      collisions.step(world.bodies, ships);
      run.totalContacts += collisions.contacts.count;
      impacts.collisions(ships, ships.damage, world.bodies, collisions.contacts);
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
      run.totalCulled += ships.cull(world);
    },
  };

  return run;
}

function spawnMany(count: number,
  rng: Rng,
  randomRadius: number,
  ships: Ships,
  world: World,
  blueprint: ShipDesign,
  xStart: number,
  yStart: number,
  team: number): number[] {
  const shipIndices = [];
  for (let i = 0; i < count; i++) {
    const angle = rng.nextRange(0, 2 * math.PI);
    const radius = math.sqrt(rng.nextRange(0, 1)) * randomRadius;
    const x = xStart + radius * math.cos(angle);
    const y = yStart + radius * math.sin(angle);
    let vx = rng.nextRange(20, 50);
    if (xStart > 0) {
      vx = -vx;
    }
    const vy = rng.nextRange(-20, 20);

    const a = ships.spawn(world, {
      design: blueprint,
      x: x,
      y: y,
      angle: xStart > 0 ? math.PI : 0,
      vx: vx,
      vy: 90 + vy,
      team: team,
    });
    shipIndices.push(a);
  }
  return shipIndices;
}
