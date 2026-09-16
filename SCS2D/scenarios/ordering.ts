import {
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
 * Three identical gunships, flying the same order from the same spot, to
 * measure what listing their modules in a different order costs.
 *
 * Module order reaches the simulation twice: thrusters are allocated in it and
 * guns fire in it. The three ships are the same eighteen modules in the same
 * places, differing only in the list — flat in expansion order (the control,
 * which should track the assembled ship exactly), flat listed kind by kind
 * (the variable), and built from assemblies. Same position, heading, velocity
 * and order, so any difference that appears is the ordering.
 *
 * Deliberately artificial, and both parts stop being possible once hulls
 * collide (DESIGN.md §4): the three start on top of each other, which is the
 * only way to give them identical opening conditions, and the target is given
 * no order, so it neither manoeuvres nor shoots back. What replaces it then is
 * three *pairs* of ships fighting far enough apart to be undisturbed, one pair
 * per ordering, compared on the figures a long run produces — final position
 * and velocity, shots fired, hits — rather than on a distance.
 *
 * `p.hits` means nothing here: rounds are absorbed by the first hull they
 * cross and there is no friendly fire check, so stacked ships eat each other's
 * shots. The viewer's readout reports the range between the first two ships,
 * which here is the drift between the two flat orders.
 */
export interface OrderingBattle extends Battle {
  /** The three ships under test, with the difference each one represents. */
  readonly contenders: readonly { readonly name: string; readonly ship: number }[];
  /** The mark they are all shooting at. */
  readonly target: number;
}

export function ordering(seed = 20260905): OrderingBattle {
  const dt = 1 / 60;
  const world = new World({ dt, seed });

  // The same well the other battles fight around. It cannot itself separate
  // the three, since all three start in the same place.
  const wells: WellSpec[] = [{ x: 0, y: -1500, gm: 2.5e6, softening: 200 }];
  for (const well of wells) world.addForceProvider(gravityWell(well));

  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());

  const designs = [
    { name: 'flat, expansion order', design: compileBlueprint(FLAT_GUNSHIP) },
    { name: 'flat, kinds together', design: compileBlueprint(FLAT_GUNSHIP_GROUPED) },
    { name: 'assemblies', design: compileBlueprint(GUNSHIP) },
  ];

  // Facing across the engagement with a crossing velocity, as the duel does.
  // A ship flying straight down a bearing barely uses its manoeuvring
  // thrusters, and thruster allocation is half of what is being measured.
  const contenders = designs.map((entry) => ({
    name: entry.name,
    ship: ships.spawn(world, {
      design: entry.design,
      x: -1800,
      y: -240,
      angle: math.HALF_PI,
      vx: 0,
      vy: 90,
      team: 0,
    }),
  }));

  // A corvette rather than another gunship, so the stack of three is never in
  // doubt on screen.
  const target = ships.spawn(world, {
    design: compileBlueprint(CORVETTE),
    x: 1800,
    y: 240,
    angle: -math.HALF_PI,
    vx: 0,
    vy: -60,
    team: 1,
  });

  // No order for the target, which is what makes it hold fire: a ship with no
  // target neither trains its guns nor shoots, and keeps no station.
  for (const contender of contenders) ships.setOrder(contender.ship, target, 300, 500, 120);

  const grid = new SpatialGrid(64);
  const projectiles = new Projectiles(512);
  const beams = new Beams(512);
  const hits = new ProjectileHits();
  const beamHits = new BeamHits();

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
    contenders,
    target,
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
      projectiles.step(dt, world.bodies, grid, hits, wells);
      run.totalProjectileHits += hits.count;
      run.totalBeamHits += beamHits.count;
      // A stop-gap until terminal ballistics and the damage model (§8 step 2),
      // which decide what a hit does: every round penetrates and is absorbed.
      // Impacts have to be resolved by something, or the rounds stay parked at
      // the point of contact for ever.
      for (let i = 0; i < hits.count; i++) projectiles.kill(hits.projectile[i]!);
    },
  };

  return run;
}

/** How far apart a pair of the contenders has drifted, in metres. */
export function separation(run: OrderingBattle, a: number, b: number): number {
  const bodies = run.world.bodies;
  const ia = bodies.indexOf(run.ships.body(run.contenders[a]!.ship));
  const ib = bodies.indexOf(run.ships.body(run.contenders[b]!.ship));
  if (ia < 0 || ib < 0) return 0;
  return math.distance(bodies.x[ia]!, bodies.y[ia]!, bodies.x[ib]!, bodies.y[ib]!);
}

/** The widest gap between any two of them: the headline number. */
export function spread(run: OrderingBattle): number {
  let worst = 0;
  for (let a = 0; a < run.contenders.length; a++) {
    for (let b = a + 1; b < run.contenders.length; b++) {
      const gap = separation(run, a, b);
      if (gap > worst) worst = gap;
    }
  }
  return worst;
}
