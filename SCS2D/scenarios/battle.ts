import {
  Beams,
  compileBlueprint,
  NEUTRAL_TEAM,
  BeamHits,
  castableBeamLength,
  MAX_BEAM_LENGTH,
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
  generateMap,
  hasAsteroids,
  Railway,
  type Clearing,
  type ForceProvider,
  type MapSettings,
  type Rails,
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
/**
 * The index's cell size for every battle, metres.
 *
 * Named here rather than written into the call because a beam's length has to
 * stay inside what a grid of this size will cast, and the check below is only
 * honest if both numbers come from one place.
 */
const CELL_SIZE = 64;

// A beam longer than the index will cast is cut short without a word — a
// weapon that silently stops working at range, which is the hardest kind of
// bug to see from a battle. Checked once here, where the cell size is chosen,
// rather than per shot.
if (MAX_BEAM_LENGTH > castableBeamLength(CELL_SIZE)) {
  throw new Error(
    `a ${MAX_BEAM_LENGTH} m beam cannot be cast through ${CELL_SIZE} m cells: ` +
      `the index gives up at ${castableBeamLength(CELL_SIZE).toFixed(0)} m`,
  );
}

export const CROSSING = {
  west: { x: -1800, y: -240, angle: math.HALF_PI, vx: 0, vy: 90 },
  east: { x: 1800, y: 240, angle: -math.HALF_PI, vx: 0, vy: -60 },
} as const;

export interface BattleOptions {
  readonly seed: number;
  readonly dt?: number;
  readonly wells?: readonly WellSpec[];
  /** How the wells move, by their index in `wells`; without it they stay put. */
  readonly rails?: Rails;
  /**
   * Asteroids to fight among, drawn from the seed once `setup` has placed the
   * ships, and kept clear of them. Its majors' wells join `wells`.
   */
  readonly map?: MapSettings;
  /** The seed the map is drawn from, where it is not the battle's: so battles on several seeds share one place. */
  readonly mapSeed?: number;
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

/** Seconds of a ship's starting speed the map keeps clear for. */
const MAP_LOOK_AHEAD = 10;

/** A force provider put in its place before it is known: the map's rails, drawn after the ships. */
class Later {
  provider: ForceProvider | null = null;

  applyForces(world: World): void {
    const p = this.provider;
    if (p === null) return;
    if (typeof p === 'function') p(world);
    else p.applyForces(world);
  }
}

/**
 * Build a battle: `setup` spawns the ships and issues the orders, and anything
 * it returns is carried on the battle for a caller that needs to know which
 * ship is which. It is handed the battle's own wells, for a hull to ride.
 */
export function makeBattle<Extra extends object = Record<never, never>>(
  options: BattleOptions,
  setup: (ships: Ships, world: World, wells: readonly WellSpec[]) => Extra | void,
): Battle & Extra {
  const dt = options.dt ?? 1 / 60;
  const world = new World({ dt, seed: options.seed });

  // Copied, since rails move them and a scenario's wells may be shared constants.
  const wells = (options.wells ?? []).map((well) => ({ ...well }));
  // First, so every other provider finds the wells where they are.
  if (options.rails !== undefined) world.addForceProvider(new Railway(options.rails, wells));
  // Where the map's rails go, once it is drawn: still before the ships, which ride them.
  const mapRails = hasAsteroids(options.map) ? new Later() : null;
  if (mapRails !== null) world.addForceProvider(mapRails);
  for (const well of wells) world.addForceProvider(gravityWell(well));

  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());

  const extra = setup(ships, world, wells) ?? ({} as Extra);
  if (mapRails !== null) {
    const clear: Clearing[] = [];
    const bodies = world.bodies;
    for (let i = 0; i < ships.count; i++) {
      if (!ships.isAlive(i)) continue;
      const b = bodies.indexOf(ships.body(i));
      // Wide enough for where it goes in the seconds the map looks ahead.
      const speed = math.sqrt(bodies.vx[b]! * bodies.vx[b]! + bodies.vy[b]! * bodies.vy[b]!);
      clear.push({ x: bodies.x[b]!, y: bodies.y[b]!, radius: bodies.radius[b]! + speed * MAP_LOOK_AHEAD });
    }
    const map = generateMap(options.map!, options.mapSeed ?? options.seed, clear);
    if (map.rails !== undefined) mapRails.provider = new Railway(map.rails, map.wells);
    const first = wells.length;
    for (const well of map.wells) {
      wells.push(well);
      world.addForceProvider(gravityWell(well));
    }
    for (const rock of map.asteroids) {
      ships.spawn(world, {
        design: compileBlueprint(rock.blueprint),
        x: rock.x,
        y: rock.y,
        vx: rock.vx,
        vy: rock.vy,
        angle: rock.angle,
        angularVel: rock.angularVel,
        team: NEUTRAL_TEAM,
        name: rock.blueprint.name,
        ...(rock.rides === undefined ? {} : { rides: wells[first + rock.rides]! }),
      });
    }
  }

  const pilots = options.pilots ?? true;
  const grid = new SpatialGrid(CELL_SIZE);
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
    totalWelded: 0,
    totalCulled: 0,

    step(): void {
      // What changes is read through `this`, so a copy of the battle steps its own (`clone.ts`).
      const { credit, impacts, ships, world, collisions, grid, beams, beamHits, projectiles, hits } = this;
      // Filled by this step's collisions and hits, for whatever is scoring the battle.
      credit.clear();
      if (!impacts.log.watched) impacts.log.clear();
      if (pilots) ships.command(dt, world, grid);
      else ships.generate(dt, world);
      world.step();
      // Hulls are solid: what the world's step drove into each other is pushed
      // back apart before anything asks where anything is.
      collisions.step(world.bodies, ships);
      this.totalContacts += collisions.contacts.count;
      impacts.collisions(ships, ships.damage, world.bodies, collisions.contacts, credit);
      // A slow contact onto torn metal hooks the two into one, once the crush
      // has decided what is torn.
      this.totalWelded += ships.weld(world, collisions.contacts);
      // What claws hold is pumped aboard, what pads hold is filled, and a dock
      // done with it lets go; then fighters settled onto pads are taken aboard.
      ships.pump(world);
      ships.land(world);
      // Free pads short of the fighters they keep lay down the next one's core.
      ships.build(world);
      // Robots crawl out to what needs mending and mend it.
      ships.tend(world);
      grid.rebuild(world.bodies);
      beams.clear();
      beamHits.clear();
      const fireReport = ships.fire(world, projectiles, beams, grid, beamHits, impacts.log);
      this.totalProjectilesFired += fireReport.projectilesFired;
      this.totalBeamsFired += fireReport.beamsFired;
      // Exhaust burns whatever it is playing on, which is as much a weapon as
      // a gun and answers to the same rebuilt index.
      ships.scorch(world, grid, dt);
      projectiles.step(dt, world.bodies, grid, hits, wells, ships.hulls, world.rng);
      impacts.bursts(projectiles);
      this.totalBeamHits += beamHits.count;
      // What the hits did. Rounds walk the modules along their path, a step's
      // travel at a time, and are killed or sent on their way; beams pour their power into what they are
      // burning through.
      impacts.rounds(ships, ships.damage, world.bodies, projectiles, hits, ships, credit, dt, grid, ships.hulls, world.rng);
      // After, so that a round going on from one hull into the next counts.
      this.totalProjectileHits += hits.count;
      impacts.beams(ships.damage, beams, beamHits, dt, world.bodies, ships, credit);
      this.totalSevered += ships.sever(world, collisions.contacts);
      this.totalCulled += ships.cull(world);
    },
  };

  return run;
}
