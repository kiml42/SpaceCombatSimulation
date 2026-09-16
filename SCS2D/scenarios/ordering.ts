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
 * What listing a ship's modules in a different order costs, flown two ways.
 *
 * Module order reaches the simulation twice: thrusters are allocated in it and
 * guns fire in it. The three layouts here are the same eighteen modules in the
 * same places, differing only in the list — flat in expansion order (the
 * control, which should track the assembled ship exactly), flat listed kind by
 * kind (the variable), and built from assemblies.
 *
 * `ordering` flies all three at once, from one spot on one order against a
 * mark that is given no order and so neither manoeuvres nor shoots back. That
 * is the one you can watch: the drift is on screen as the range between two
 * ships that started on top of each other. It is also artificial in two ways
 * that stop being possible once hulls collide (DESIGN.md §4) — the stack, and
 * the mark — and `p.hits` means nothing in it, since rounds are absorbed by the
 * first hull they cross with no friendly fire check.
 *
 * `soloOrdering` flies one layout in a battle of its own, so three runs give
 * three ships the identical problem with nothing between them. Nothing about it
 * depends on the ships sharing a world, so it survives collisions, damage and
 * anything else that makes ships interact — and it compares the figures that
 * matter about a battle rather than a distance: final position and velocity,
 * shots fired, hits scored. What it cannot do is show you the answer in one
 * run, which is why both are here.
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

/** All three layouts in one battle, stacked. The scene in the viewer. */
export function ordering(seed = 20260905): OrderingBattle {
  return battle(ORDERINGS.map((_, i) => i), seed);
}

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
