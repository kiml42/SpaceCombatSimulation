import { BARREL_CALIBRES, CALIBRE_FRACTION, type Blueprint } from '../sim/index.js';
import { CORVETTE, DINKY, GUNSHIP } from '../scenarios/blueprints.js';

/**
 * A stock ship with its bow hull gun swapped back for a single-barrel turret,
 * its barrel no longer than the mount, as turrets were built when these tests
 * were written.
 */
function withBowTurret(ship: Blueprint): Blueprint {
  return {
    ...ship,
    modules: ship.modules.map((p) =>
      'kind' in p && p.kind === 'hullGun'
        ? {
            kind: 'turret',
            x: p.x,
            y: p.y,
            angle: p.angle ?? 0,
            length: p.length,
            width: p.width,
            barrels: 1,
            barrelCalibres: Math.min(BARREL_CALIBRES, p.length / (p.width * CALIBRE_FRACTION)),
          }
        : p,
    ),
  };
}

/** For tests of how turrets behave rather than of the ship. */
export const TURRET_CORVETTE: Blueprint = withBowTurret(CORVETTE);
export const TURRET_GUNSHIP: Blueprint = withBowTurret(GUNSHIP);
/**
 * The same ship with every weapon in the main battery, so all of them take an
 * order: for tests that want a whole salvo on one target.
 */
export function allMain(ship: Blueprint): Blueprint {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v === null || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== 'main') out[k] = strip(x);
    return out;
  };
  return strip(ship) as Blueprint;
}
/** A Dinky turrets can see: its gun is the one thing on it in the weapons layer. */
export const TURRET_DINKY: Blueprint = withBowTurret(DINKY);
