import { compileBlueprint, DAMAGE_ENERGY_PER_KG } from '../sim/index.js';
import type { Battle } from './types.js';
import { makeBattle } from './battle.js';
import { CORVETTE, SCAVENGER } from './blueprints.js';

/** What each scavenger's tank has room for, kg: well past the half full it starts looking at. */
const ROOM = 15_000;

/** What two of the three wrecks have left, kg, so draining one is not enough. */
const DREGS = 4_000;

/**
 * Two Scavengers, low on fuel, among three wrecks after a fight.
 *
 * Each picks the wreck that pays it most fuel for the time it takes, brings
 * its claw in at a walking pace, drinks, and when a wreck runs dry goes on to
 * the next, until it is full (`Ships.pump`, the pilot's `forage`).
 */
export function scavenge(seed = 20261008): Battle {
  return makeBattle({ seed, projectiles: 16, beams: 16 }, (ships, world) => {
    const scavenger = compileBlueprint(SCAVENGER);
    const corvette = compileBlueprint(CORVETTE);
    const fuel = corvette.modules.reduce((sum, m) => sum + m.stats.fuel, 0);

    for (const y of [-150, 150]) {
      const s = ships.spawn(world, { design: scavenger, x: -500, y, angle: 0, team: 0 });
      ships.fuel.vent(world.bodies.indexOf(ships.body(s)), 1, ROOM);
    }

    const wrecks: [number, number, number, boolean][] = [
      [0, 0, 1, true],
      [300, 400, 2.2, false],
      [200, -500, 4, true],
    ];
    for (const [x, y, angle, drained] of wrecks) {
      const w = ships.spawn(world, { design: corvette, x, y, angle, team: 1 });
      const body = world.bodies.indexOf(ships.body(w));
      for (const core of corvette.cores) {
        ships.damage.absorb(body, core, corvette.modules[core]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG * 0.7);
      }
      if (!drained) continue;
      // Spread over its tanks, as a burn would have left it.
      for (let m = 0; m < corvette.modules.length; m++) {
        const share = corvette.modules[m]!.stats.fuel / fuel;
        ships.fuel.vent(body, m, share * (fuel - DREGS));
      }
    }
  });
}
