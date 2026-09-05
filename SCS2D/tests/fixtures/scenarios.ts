import {
  checksumProjectiles,
  checksumWorld,
  compileBlueprint,
  gravityWell,
  math,
  ProjectileHits,
  Projectiles,
  Ships,
  SpatialGrid,
  World,
  type WellSpec,
} from '../../sim/index.js';
import { CORVETTE, GUNSHIP } from '../../scenarios/blueprints.js';

/**
 * Scenarios shared by the determinism tests, the integrator tests and the
 * golden checksum script, so that all three exercise identical setups.
 *
 * These must stay byte-stable. Changing one changes its golden checksum, which
 * is the point — but do it deliberately, and re-derive the constant with
 * `npm run golden` rather than pasting whatever the failure reports.
 *
 * A scenario is a `step`/`checksum` pair rather than a bare `World`, because
 * some of them drive more than a world: `gunnery` also owns a spatial index and
 * a projectile store, and the order those are advanced in is part of what the
 * scenario is pinning.
 */

export interface ScenarioRun {
  step(): void;
  checksum(): number;
  /** For the report in `npm run golden`. */
  describe(): string;
}

export interface Scenario {
  readonly steps: number;
  build(): ScenarioRun;
}

// ---- orbit ----

export const ORBIT_GM = 1e6;
export const ORBIT_RADIUS = 1000;
export const ORBIT_DT = 0.1;

export function orbitWell(): WellSpec {
  return { x: 0, y: 0, gm: ORBIT_GM };
}

/**
 * One body on a circular orbit about a fixed well. The sharpest test of the
 * integrator: a decaying or precessing orbit shows up within a few hundred
 * steps.
 */
export function orbitScenario(seed = 1): World {
  const world = new World({ dt: ORBIT_DT, seed });
  const speed = Math.sqrt(ORBIT_GM / ORBIT_RADIUS);
  world.spawn({
    x: ORBIT_RADIUS,
    y: 0,
    vx: 0,
    vy: speed,
    mass: 1,
    inertia: 1,
    radius: 5,
  });
  world.addForceProvider(gravityWell(orbitWell()));
  return world;
}

// ---- tumble ----

/**
 * A handful of bodies given randomised body-frame thrust at randomised
 * body-frame mount points, under gravity. Exercises rotation, off-centre force
 * application, the RNG and the body store together — so its checksum moves if
 * any of them changes.
 */
export function tumbleScenario(seed = 12345): World {
  const world = new World({ dt: 1 / 60, seed });

  const count = 8;
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(
      world.spawn({
        x: world.rng.nextRange(-500, 500),
        y: world.rng.nextRange(-500, 500),
        vx: world.rng.nextRange(-10, 10),
        vy: world.rng.nextRange(-10, 10),
        angle: world.rng.nextRange(-3, 3),
        angularVel: world.rng.nextRange(-0.5, 0.5),
        mass: world.rng.nextRange(50, 200),
        inertia: world.rng.nextRange(500, 2000),
        radius: 10,
      }),
    );
  }

  // A fixed thruster layout per body, decided once from the seeded stream so
  // that the forces are reproducible without consuming randomness per step.
  const thrust = ids.map(() => ({
    fx: world.rng.nextRange(-2000, 2000),
    fy: world.rng.nextRange(-500, 500),
    px: world.rng.nextRange(-8, 8),
    py: world.rng.nextRange(-8, 8),
  }));

  world.addForceProvider((w) => {
    for (let i = 0; i < ids.length; i++) {
      const t = thrust[i]!;
      w.bodies.applyLocalForceAtLocalPoint(ids[i]!, t.fx, t.fy, t.px, t.py);
    }
  });
  world.addForceProvider(gravityWell({ x: 0, y: 0, gm: 5e5, softening: 50 }));

  return world;
}

// ---- gunnery ----

export interface GunneryRun extends ScenarioRun {
  readonly world: World;
  readonly projectiles: Projectiles;
  readonly hits: ProjectileHits;
  /** Cumulative impacts, so a scenario that stops hitting is detectable. */
  totalHits: number;
}

/**
 * Drifting targets under fire from fixed batteries, with gravity bending the
 * rounds. Pins the whole ballistic chain at once: body motion, index rebuild,
 * swept-segment casting, impact reporting, expiry and slot recycling.
 *
 * The batteries are immovable bodies so that recoil does not enter into it —
 * what is being pinned here is gunnery, not thruster response.
 */
export function gunneryScenario(seed = 777): GunneryRun {
  const dt = 1 / 60;
  const world = new World({ dt, seed });
  const wells: WellSpec[] = [{ x: 0, y: 0, gm: 2e6, softening: 100 }];
  world.addForceProvider(gravityWell(wells[0]!));

  // Drifting targets.
  const targets: number[] = [];
  for (let i = 0; i < 6; i++) {
    targets.push(
      world.spawn({
        x: world.rng.nextRange(400, 900),
        y: world.rng.nextRange(-600, 600),
        vx: world.rng.nextRange(-20, 20),
        vy: world.rng.nextRange(-20, 20),
        mass: world.rng.nextRange(100, 400),
        inertia: 1000,
        radius: world.rng.nextRange(15, 45),
      }),
    );
  }

  // Immovable batteries.
  const batteries: number[] = [];
  for (let i = 0; i < 3; i++) {
    batteries.push(
      world.spawn({
        x: -800,
        y: -400 + i * 400,
        mass: 0,
        inertia: 0,
        radius: 30,
      }),
    );
  }

  const grid = new SpatialGrid(64);
  const projectiles = new Projectiles(512);
  const hits = new ProjectileHits();

  const run: GunneryRun = {
    world,
    projectiles,
    hits,
    totalHits: 0,

    step(): void {
      world.step();
      grid.rebuild(world.bodies);

      // Every battery fires every fourth step, aimed at where a target is now
      // — deliberately without lead, so some rounds miss and expire.
      if (world.tick % 4 === 0) {
        for (let b = 0; b < batteries.length; b++) {
          const bi = world.bodies.indexOf(batteries[b]!);
          const ti = world.bodies.indexOf(targets[(world.tick + b) % targets.length]!);
          if (bi < 0 || ti < 0) continue;
          const dx = world.bodies.x[ti] - world.bodies.x[bi];
          const dy = world.bodies.y[ti] - world.bodies.y[bi];
          const len = Math.sqrt(dx * dx + dy * dy);
          const speed = 900;
          projectiles.fireFrom(
            world.bodies,
            bi,
            world.bodies.x[bi] + (dx / len) * 35,
            world.bodies.y[bi] + (dy / len) * 35,
            (dx / len) * speed,
            (dy / len) * speed,
            3,
            5,
            10,
            2,
            1,
          );
        }
      }

      projectiles.step(dt, world.bodies, grid, hits, wells);
      run.totalHits += hits.count;

      // Stands in for terminal ballistics: every round penetrates and is
      // absorbed. Impacts have to be resolved or the rounds stay parked at the
      // point of contact indefinitely, which is part of what this scenario pins.
      for (let i = 0; i < hits.count; i++) projectiles.kill(hits.projectile[i]!);
    },

    checksum(): number {
      return checksumProjectiles(projectiles, checksumWorld(world));
    },

    describe(): string {
      return (
        `bodies=${world.bodies.count} inFlight=${projectiles.count} ` +
        `pending=${projectiles.pendingCount} hits=${run.totalHits}`
      );
    },
  };

  return run;
}

// ---- duel ----

export interface DuelRun extends ScenarioRun {
  readonly world: World;
  readonly ships: Ships;
  readonly projectiles: Projectiles;
  /** Cumulative, so a duel that stops shooting or stops hitting is detectable. */
  totalFired: number;
  totalHits: number;
}

/**
 * A corvette and a gunship closing on each other and opening fire.
 *
 * This is what pins thruster allocation and turrets together. Unit tests check
 * a subsystem in isolation and so cannot catch two of them drifting apart; a
 * duel drives every number a blueprint derives — mass and inertia, the thruster
 * matrix, traverse rates, firing arcs, gun ballistics — through the same loop
 * the game uses, so its checksum moves if any of them does.
 *
 * Two different designs on purpose. A duel between identical ships is
 * symmetric, and a symmetric scenario hides any error that is also symmetric.
 */
export function duelScenario(seed = 20260905): DuelRun {
  const dt = 1 / 60;
  const world = new World({ dt, seed });
  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());

  const corvette = compileBlueprint(CORVETTE);
  const gunship = compileBlueprint(GUNSHIP);

  // Offset across the line of approach as well as along it, so neither ship
  // starts with its bow gun already bearing and both have to manoeuvre.
  const a = ships.spawn(world, { design: corvette, x: -1800, y: -240, team: 0 });
  const b = ships.spawn(world, {
    design: gunship,
    x: 1800,
    y: 240,
    angle: math.PI,
    team: 1,
  });

  // The corvette wants to be inside the gunship's reach; the gunship would
  // rather hold it off. Neither gets what it wants, which is the interesting
  // part.
  ships.setOrder(a, b, 300, 500, 120);
  ships.setOrder(b, a, 900, 1200, 60);

  const grid = new SpatialGrid(64);
  const projectiles = new Projectiles(512);
  const hits = new ProjectileHits();

  const run: DuelRun = {
    world,
    ships,
    projectiles,
    totalFired: 0,
    totalHits: 0,

    step(): void {
      ships.command(dt, world);
      world.step();
      grid.rebuild(world.bodies);
      run.totalFired += ships.fire(world, projectiles);
      projectiles.step(dt, world.bodies, grid, hits);
      run.totalHits += hits.count;
      // Stands in for terminal ballistics, as in `gunnery`: every round
      // penetrates and is absorbed. Impacts have to be resolved or the rounds
      // stay parked at the point of contact for ever.
      for (let i = 0; i < hits.count; i++) projectiles.kill(hits.projectile[i]!);
    },

    checksum(): number {
      return checksumProjectiles(projectiles, checksumWorld(world));
    },

    describe(): string {
      return (
        `ships=${ships.count} inFlight=${projectiles.count} ` +
        `fired=${run.totalFired} hits=${run.totalHits}`
      );
    },
  };

  return run;
}

// ---- registry ----

function worldScenario(build: () => World, steps: number): Scenario {
  return {
    steps,
    build: () => {
      const world = build();
      return {
        step: () => world.step(),
        checksum: () => checksumWorld(world),
        describe: () => `bodies=${world.bodies.count}`,
      };
    },
  };
}

export const SCENARIOS = {
  orbit: worldScenario(() => orbitScenario(), 20_000),
  tumble: worldScenario(() => tumbleScenario(), 5_000),
  gunnery: { steps: 3_000, build: () => gunneryScenario() },
  duel: { steps: 3_000, build: () => duelScenario() },
} satisfies Record<string, Scenario>;

export type ScenarioName = keyof typeof SCENARIOS;
