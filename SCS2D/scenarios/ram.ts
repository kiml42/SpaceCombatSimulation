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
import type { Battle } from './types.js';
import { CORVETTE, DINKY, GUNSHIP } from './blueprints.js';

/**
 * Hulls hitting each other, and nothing else.
 *
 * No wells, no orders and therefore no shooting: a ship with nothing to fight
 * holds its heading and its fire, so what this pins is the contact solver on
 * its own — where two hulls met, which way the impulse pushed, and how they
 * tumbled afterwards. Everything else a battle does would only make the
 * checksum harder to read.
 *
 * Four ships converge on one that is sitting still, at different speeds and
 * angles, so the run covers the cases that differ: square on the nose, a
 * glancing blow well off the centre of mass, a light ship into a heavy one,
 * and the second-order mess afterwards as tumbling hulls drift back together.
 *
 * **No pilot runs here.** A ship told nothing holds station, which means it
 * burns to kill the very velocity that would carry it into something — so the
 * hulls are left ballistic, and what they do when they meet is the whole of
 * what this scenario says.
 */
export function ram(seed = 20260905): Battle {
  const dt = 1 / 60;
  const world = new World({ dt, seed });
  const wells: WellSpec[] = [];

  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());

  const corvette = compileBlueprint(CORVETTE);
  const gunship = compileBlueprint(GUNSHIP);
  const dinky = compileBlueprint(DINKY);

  // The anvil: adrift, facing along +x, hit by everything else.
  ships.spawn(world, { design: gunship, x: 0, y: 0, team: 0 });

  // Square on the nose, from ahead.
  ships.spawn(world, { design: corvette, x: 900, y: 0, angle: math.PI, vx: -70, team: 1 });

  // A glancing blow across the bow: offset enough to be a lever rather than a
  // shove, which is what sets both of them spinning.
  ships.spawn(world, { design: corvette, x: -700, y: 26, angle: 0, vx: 55, vy: -1, team: 1 });

  // A fighter into the flank at speed, well inside the gunship's length: sixty
  // times lighter, so what happens to it is not what happens to what it hits.
  ships.spawn(world, { design: dinky, x: 12, y: -600, angle: math.HALF_PI, vy: 120, team: 1 });

  const grid = new SpatialGrid(64);
  const projectiles = new Projectiles(64);
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

    step(): void {
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
    },
  };

  return run;
}
