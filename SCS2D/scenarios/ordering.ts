import {
  Collisions,
  Impacts,
  compileBlueprint,
  gravityWell,
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
import { CORVETTE, FLAT_GUNSHIP, FLAT_GUNSHIP_GROUPED, GUNSHIP } from './blueprints.js';

/**
 * What listing a ship's modules in a different order costs, flown two ways.
 *
 * Module order reaches the simulation twice: thrusters are allocated in it and
 * guns fire in it. The three layouts here are the same eighteen modules in the
 * same places, differing only in the list — flat in expansion order (the
 * control, which should track the assembled ship exactly), flat listed kind by
 * kind (the variable), and built from assemblies.
 *
 * `soloOrdering` flies one layout in a battle of its own against a mark that
 * is given no order, and so neither manoeuvres nor shoots back. Three runs
 * give three ships the identical problem with nothing between them, and what
 * is compared is the figures that matter about a battle rather than a distance:
 * final position and velocity, shots fired, hits scored.
 *
 * **There was a stacked scene, and the damage model took it.** All three flew
 * from one spot so the drift could be read straight off the range between two
 * ships that had started on top of each other — which was only honest while a
 * hit did nothing, because they also ate each other's rounds. Now that a hit
 * damages what it lands on, three ships in a line are three different problems
 * and a mark under three ships' fire is not the mark one of them faces. The
 * comparison moved to where it always had to go, which is this one.
 */
export interface OrderingBattle extends Battle {
  /** The ships under test, with the ordering each one represents. */
  readonly contenders: readonly { readonly name: string; readonly ship: number }[];
  /** The mark they are shooting at. */
  readonly target: number;
}

/**
 * The layouts under test, in the order the contenders are reported: the
 * control, the variable, and the assembled ship the control is a copy of.
 */
export const ORDERINGS = [
  { name: 'flat, expansion order', blueprint: FLAT_GUNSHIP },
  { name: 'flat, kinds together', blueprint: FLAT_GUNSHIP_GROUPED },
  { name: 'assemblies', blueprint: GUNSHIP },
] as const;

/**
 * One layout in a battle of its own, so three runs can be compared without the
 * ships ever sharing a world.
 */
export function soloOrdering(which: number, seed = 20260905): OrderingBattle {
  const entry = ORDERINGS[which];
  if (entry === undefined) throw new Error(`no ordering ${which}`);
  return battle([which], seed);
}

function battle(which: readonly number[], seed: number): OrderingBattle {
  const dt = 1 / 60;
  const world = new World({ dt, seed });

  // The same well the other battles fight around. It cannot itself separate
  // the contenders, since they all start in the same place.
  const wells: WellSpec[] = [{ x: 0, y: -1500, gm: 2.5e6, softening: 200 }];
  for (const well of wells) world.addForceProvider(gravityWell(well));

  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());

  // Facing across the engagement with a crossing velocity, as the duel does.
  // A ship flying straight down a bearing barely uses its manoeuvring
  // thrusters, and thruster allocation is half of what is being measured.
  const contenders = which.map((i) => ({
    name: ORDERINGS[i]!.name,
    ship: ships.spawn(world, {
      design: compileBlueprint(ORDERINGS[i]!.blueprint),
      x: -1800,
      y: -240,
      angle: math.HALF_PI,
      vx: 0,
      vy: 90,
      team: 0,
    }),
  }));

  // A corvette rather than another gunship, so a contender is never mistaken
  // for the mark on screen.
  const target = ships.spawn(world, {
    design: compileBlueprint(CORVETTE),
    x: 1800,
    y: 240,
    angle: -math.HALF_PI,
    vx: 0,
    vy: -60,
    team: 1,
  });

  // No order for the mark, which is what makes it hold fire: a ship with no
  // target neither trains its guns nor shoots, and keeps no station.
  for (const contender of contenders) ships.pushOrder(contender.ship, target, 300, 500, 120);

  const grid = new SpatialGrid(64);
  const projectiles = new Projectiles(512);
  const beams = new Beams(512);
  const hits = new ProjectileHits();
  const beamHits = new BeamHits();
  const impacts = new Impacts();
  const collisions = new Collisions();

  const run: OrderingBattle = {
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
    contenders,
    target,
    totalProjectilesFired: 0,
    totalProjectileHits: 0,
    totalBeamsFired: 0,
    totalBeamHits: 0,
    totalContacts: 0,
    totalSevered: 0,

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
    },
  };

  return run;
}
