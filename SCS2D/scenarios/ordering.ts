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
 * Three identical gunships, flying the same orders from the same spot, to
 * measure what listing their modules in a different order costs.
 *
 * A blueprint's module order is not inert. Thrusters are allocated in the
 * order they are listed, and so a demand two engines could satisfy between
 * them is met by whichever comes first; guns fire in the order they are
 * listed, and a salvo's rounds leave in that order carrying the recoil of the
 * ones before them. Neither is wrong, but both mean two ships that are the
 * same shape can fly differently — and grouping parts into an assembly moves
 * them in the list without moving them on the hull. This scenario is how much
 * that is worth, in metres.
 *
 * The three are the same eighteen modules at the same places, differing only
 * in the list:
 *
 * - **Flat Gunship** — no assemblies, listed in the order the Gunship's
 *   assemblies expand to. The control: it should track the third exactly.
 * - **Flat Gunship (kinds together)** — no assemblies, listed kind by kind.
 *   The variable: same ship, different list.
 * - **Gunship** — the same layout built out of assemblies.
 *
 * Identical is meant strictly: same position, same heading, same velocity,
 * same order against the same target. Nothing in the opening conditions can
 * account for a difference, so anything that appears is the ordering.
 *
 * Two things about it are deliberately artificial, and both stop being
 * possible once hulls collide (DESIGN.md §4):
 *
 * - The three start *on top of each other*, which is the only way to give them
 *   identical opening conditions.
 * - The target does not shoot back and is given no order, so it neither
 *   manoeuvres nor returns fire. It is a mark to shoot at rather than an
 *   opponent: a fight it took part in would answer all three ships
 *   differently, and the difference being measured would be buried in it.
 *
 * **What replaces it when hulls become solid:** three *pairs* of ships, each
 * pair fighting its own battle far enough from the others to be undisturbed,
 * one pair per module ordering. What is compared then is not a distance — two
 * real fights will not stay on top of each other — but the high-level figures
 * over a long run: final position and velocity, shots fired, hits scored. The
 * question stays the same and the tolerance changes: identical to the metre
 * here, indistinguishable as a battle there.
 *
 * Rounds are absorbed by the first hull they cross and there is no friendly
 * fire check, so ships stacked in a line eat each other's shots. That costs
 * the hit counts their meaning here and nothing else — a hit does no damage
 * and imparts no impulse yet — but it is why this scenario's `p.hits` should
 * not be read as gunnery.
 *
 * The viewer's readout reports the range between the first two ships, which in
 * this scenario is the divergence between the two flat orders: 0 while they
 * agree, and growing from the moment they stop.
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

  // The same well the other battles fight around, so their trajectories are
  // comparable. It cannot itself separate the three: gravity depends on where
  // a ship is, and all three start in the same place.
  const wells: WellSpec[] = [{ x: 0, y: -1500, gm: 2.5e6, softening: 200 }];
  for (const well of wells) world.addForceProvider(gravityWell(well));

  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());

  const designs = [
    { name: 'flat, expansion order', design: compileBlueprint(FLAT_GUNSHIP) },
    { name: 'flat, kinds together', design: compileBlueprint(FLAT_GUNSHIP_GROUPED) },
    { name: 'assemblies', design: compileBlueprint(GUNSHIP) },
  ];

  // Facing across the engagement with a crossing velocity, as the duel does:
  // each has to come round before a gun bears and kill the crossing before it
  // can hold a range band. A ship flying straight down a bearing barely uses
  // its manoeuvring thrusters, and thruster allocation is half of what is
  // being measured.
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

  // A corvette rather than another gunship: something that is plainly not one
  // of the three, so the stack is never in doubt on screen.
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
  // target neither trains its guns nor shoots, and its pilot has no station to
  // keep, so it coasts through the well on whatever it started with.
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
