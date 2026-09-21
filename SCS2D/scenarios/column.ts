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
import { BEAM_CORVETTE, CORVETTE, GUNSHIP } from './blueprints.js';

/**
 * Two fleets in **line ahead**, nose to tail along the line they are fighting
 * down — so that every ship but the leader has one of its own in front of its
 * guns.
 *
 * `standoff` is the other formation: two lines abreast, where a fleet's
 * friends are beside it and its guns look out into clear space. That makes it
 * the wrong scenario for asking whether a ship will shoot through its own
 * side, because the question never comes up. This one is the same fleets
 * turned ninety degrees, and nothing else about it is different.
 *
 * Nobody issues an order, as in `standoff`: what the ships do about the
 * friend in the way is a property of the ships.
 *
 * The heavy is at the back of each column, which is the arrangement that
 * costs the most: the gunship's bow gun is the longest-reaching weapon in the
 * fleet and it is the one with the most of its own fleet to see past.
 */
export function column(seed = 20260905): Battle {
  const dt = 1 / 60;
  const world = new World({ dt, seed });
  const wells: WellSpec[] = [];

  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());

  const gunship = compileBlueprint(GUNSHIP);
  const corvette = compileBlueprint(CORVETTE);
  const beamCorvette = compileBlueprint(BEAM_CORVETTE);

  /** Where each column's leader sits: half a kilometre off the middle. */
  const LEAD = 500;
  /**
   * Nose-to-tail spacing.
   *
   * Comfortably more than a hull is long, so this is a formation rather than
   * a collision — and comfortably less than the few hundred metres a gun
   * looks ahead for a friend, so a ship astern really does have its consort
   * in the way rather than merely somewhere ahead of it.
   */
  const INTERVAL = 200;

  const file = [corvette, beamCorvette, corvette, gunship];

  for (let i = 0; i < file.length; i++) {
    const design = file[i]!;
    const back = LEAD + i * INTERVAL;
    ships.spawn(world, { design, x: -back, y: 0, angle: 0, team: 0 });
    ships.spawn(world, { design, x: back, y: 0, angle: math.PI, team: 1 });
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
