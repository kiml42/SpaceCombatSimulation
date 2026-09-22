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
} from '../sim/index.js';
import { type Battle } from './types.js';
import { CATAMARAN, CORVETTE } from './blueprints.js';

/**
 * A ship cut in half, and both halves flying on.
 *
 * The Catamaran is two hulls joined by four sections of thin structure, with a
 * core in each hull. A gunship is sent down the middle of it at ramming speed
 * and takes the bridge out in the first few seconds — and because each half
 * keeps a working core, what the split leaves is two ships rather than one
 * ship and a wreck.
 *
 * The corvette off the port bow is what proves it. Nothing is told to fight
 * it: each half picks it up on its own doctrine, closes to its own band and
 * opens fire, which a hulk cannot do and a piece with somebody aboard can.
 *
 * The one order in the scenario is the ram, because a gunship flying its own
 * doctrine would stand off at a kilometre and shoot rather than go through
 * anything.
 */
export function split(seed = 20260905): Battle {
  const dt = 1 / 60;
  const world = new World({ dt, seed });
  const wells: WellSpec[] = [];

  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());

  const catamaran = compileBlueprint(CATAMARAN);
  const corvette = compileBlueprint(CORVETTE);

  const target = ships.spawn(world, { design: catamaran, x: 0, y: 0, angle: 0, team: 0 });

  // Down the centreline at the bridge rather than at either hull, close enough
  // that it arrives in the first few seconds. A band of zero range is an order
  // to arrive rather than to shoot, and sixty metres a second is chosen: much
  // slower and the bridge holds, much faster and the ram takes both hulls to
  // pieces instead of taking them apart.
  const rammer = ships.spawn(world, {
    design: corvette,
    x: 220,
    y: 0,
    angle: math.PI,
    vx: -60,
    team: 1,
  });
  ships.pushOrder(rammer, target, 0, 0, 60);

  // Far enough off that it arrives after the ram rather than during it.
  ships.spawn(world, { design: corvette, x: -1800, y: 1300, angle: 0, team: 1 });

  const grid = new SpatialGrid(64);
  const projectiles = new Projectiles(256);
  const beams = new Beams(64);
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
      impacts.rounds(ships, ships.damage, world.bodies, projectiles, hits, ships);
      impacts.beams(ships.damage, beams, beamHits, dt, world.bodies, ships);
      run.totalSevered += ships.sever(world, collisions.contacts);
      run.totalCulled += ships.cull(world);
    },
  };

  return run;
}
