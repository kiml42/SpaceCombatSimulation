import { gravityWell, World, type WellSpec } from '../../sim/index.js';

/**
 * Scenarios shared by the determinism tests, the integrator tests and the
 * golden checksum script, so that all three exercise identical setups.
 *
 * These must stay byte-stable. Changing one changes its golden checksum, which
 * is the point — but do it deliberately, and re-derive the constant with
 * `npm run golden` rather than pasting whatever the failure reports.
 */

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

export const SCENARIOS = {
  orbit: { build: () => orbitScenario(), steps: 20_000 },
  tumble: { build: () => tumbleScenario(), steps: 5_000 },
} as const;

export type ScenarioName = keyof typeof SCENARIOS;
