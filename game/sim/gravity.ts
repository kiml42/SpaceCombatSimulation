import type { BodyId } from './bodies.js';
import { sqrt } from './math.js';
import type { ForceProvider, World } from './world.js';

/**
 * Gravity wells.
 *
 * Present in the foundation for two reasons: they are in scope for the game
 * (planets, black holes, wells that shape a battlefield), and a two-body orbit
 * is the sharpest available test of the integrator — an orbit that decays or
 * precesses is visible within a few hundred steps.
 */

export interface WellSpec {
  x: number;
  y: number;
  /** Standard gravitational parameter, G*M. */
  gm: number;
  /**
   * Plummer softening length. Caps the acceleration near the centre so a body
   * passing exactly through a well does not produce an infinity. Zero gives
   * true inverse-square.
   */
  softening?: number;
  /** A body exempt from this well, typically the one representing it. */
  exempt?: BodyId;
}

/**
 * A force provider for a well at a fixed point. Fixed rather than attached to
 * a body because a planet is not meaningfully perturbed by a frigate, and
 * pinning it keeps the well's own motion out of the reproducibility surface.
 */
export function gravityWell(spec: WellSpec): ForceProvider {
  const { x: wx, y: wy, gm } = spec;
  const soft2 = (spec.softening ?? 0) * (spec.softening ?? 0);
  const exempt = spec.exempt;

  return (world: World): void => {
    const b = world.bodies;
    const exemptIndex = exempt === undefined ? -1 : b.indexOf(exempt);
    for (let i = 0; i < b.highWater; i++) {
      if (b.alive[i] === 0 || i === exemptIndex) continue;
      const m = b.mass[i];
      if (m <= 0) continue;

      const dx = wx - b.x[i];
      const dy = wy - b.y[i];
      const r2 = dx * dx + dy * dy + soft2;
      if (r2 <= 0) continue;

      // |a| = gm / r^2, direction (dx, dy) / r, so a = gm * d / r^3.
      const r = sqrt(r2);
      const scale = (gm * m) / (r2 * r);
      b.fx[i] += dx * scale;
      b.fy[i] += dy * scale;
    }
  };
}

/**
 * Gravitational potential energy of every live body in a set of wells.
 * Diagnostic: total energy should stay bounded under leapfrog, and the
 * integrator tests assert exactly that.
 */
export function wellPotentialEnergy(world: World, wells: readonly WellSpec[]): number {
  const b = world.bodies;
  let u = 0;
  for (let i = 0; i < b.highWater; i++) {
    if (b.alive[i] === 0) continue;
    const m = b.mass[i];
    if (m <= 0) continue;
    for (let w = 0; w < wells.length; w++) {
      const well = wells[w]!;
      if (well.exempt !== undefined && b.indexOf(well.exempt) === i) continue;
      const dx = well.x - b.x[i];
      const dy = well.y - b.y[i];
      const soft = well.softening ?? 0;
      const r = sqrt(dx * dx + dy * dy + soft * soft);
      if (r > 0) u -= (well.gm * m) / r;
    }
  }
  return u;
}
