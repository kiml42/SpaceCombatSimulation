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
import { BEAM_CORVETTE, CORVETTE, DINKY, GUNSHIP } from './blueprints.js';

/**
 * Two fleets inside each other's reach, and **not one order between them**.
 *
 * Every other scenario is a script: something spawns the ships and then tells
 * each of them what to do. This one tells them nothing, which makes it the
 * only scenario whose outcome is a property of the *ships* rather than of the
 * script — and therefore the only honest way to see what a fleet does when
 * nobody is flying it.
 *
 * What they do is fight, and every part of how they fight comes out of the
 * doctrine each craft carries in its blueprint: what it picks on, how close
 * it wants to be, and when it changes its mind. Nothing here issues an order,
 * so a change to a doctrine shows up in this scenario and nowhere else can it
 * be seen so plainly.
 *
 * The distance they start at is chosen to say something: well inside the
 * range at which they can hurt each other, so what makes this a battle is the
 * doctrine rather than the geometry.
 */
export function standoff(seed = 20260905): Battle {
  const dt = 1 / 60;
  const world = new World({ dt, seed });
  const wells: WellSpec[] = [];

  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());

  const gunship = compileBlueprint(GUNSHIP);
  const corvette = compileBlueprint(CORVETTE);
  const beamCorvette = compileBlueprint(BEAM_CORVETTE);
  const dinky = compileBlueprint(DINKY);

  // A kilometre apart and facing each other, which is under two seconds of
  // flight for the guns these ships carry: comfortably a fight, if anyone
  // decides to have one.
  const REACH = 500;

  // A line of battle each, with the capital in the middle, a beam ship and a
  // gun ship on the wings, and a pair of fighters ahead of them — enough of a
  // mix that a doctrine will have something to disagree about.
  const line = [
    { design: gunship, y: 0 },
    { design: corvette, y: 260 },
    { design: beamCorvette, y: -260 },
    { design: dinky, y: 120 },
    { design: dinky, y: -120 },
  ];

  for (const craft of line) {
    ships.spawn(world, { design: craft.design, x: -REACH, y: craft.y, angle: 0, team: 0 });
    ships.spawn(world, { design: craft.design, x: REACH, y: -craft.y, angle: math.PI, team: 1 });
  }

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
