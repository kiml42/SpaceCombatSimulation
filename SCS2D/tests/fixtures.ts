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
            ...(p.main === true ? { main: true } : {}),
          }
        : p,
    ),
  };
}

/** For tests of how turrets behave rather than of the ship. */
export const TURRET_CORVETTE: Blueprint = withBowTurret(CORVETTE);
export const TURRET_GUNSHIP: Blueprint = withBowTurret(GUNSHIP);
/** A Dinky turrets can see: its gun is the one thing on it in the weapons layer. */
export const TURRET_DINKY: Blueprint = withBowTurret(DINKY);
