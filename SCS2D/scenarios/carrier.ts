import { compileBlueprint, type Blueprint } from '../sim/index.js';
import type { Battle } from './types.js';
import { makeBattle } from './battle.js';
import { DINKY } from './blueprints.js';

/** A core and a great tank between two pads, with no engine: a filling station. */
export const TENDER: Blueprint = {
  name: 'Tender',
  modules: [
    { kind: 'core', x: 0, y: 0, length: 6, width: 6 },
    { kind: 'tank', x: 0, y: 0 - 13, length: 6, width: 20 },
    { kind: 'pad', x: 13, y: 0, length: 20, width: 20 },
    { kind: 'pad', x: -13, y: 0, length: 20, width: 20 },
  ],
};

/** How much of each Dinky's fuel is gone, so all three want filling. */
const SPENT = 0.8;

/**
 * Three Dinkies, low on fuel, and a Tender with two pads.
 *
 * Each makes for the free pad its doctrine scores best, settles onto it from
 * the weapons layer, is filled from the Tender's tank and lifts off; the third
 * waits its turn for a pad to come free (`Ships.land`, `Ships.pump`).
 */
export function carrier(seed = 20261008): Battle {
  return makeBattle({ seed, projectiles: 64, beams: 16 }, (ships, world) => {
    const tender = compileBlueprint(TENDER);
    const base = compileBlueprint(DINKY).doctrine;
    const dinky = compileBlueprint({ ...DINKY, doctrine: { ...base, approach: { ...base.approach, refuelBelow: 0.5 } } });
    ships.spawn(world, { design: tender, x: 0, y: 0, angle: 0.2 });
    for (const [x, y] of [[-400, 250], [-450, -100], [300, 350]] as const) {
      const f = ships.spawn(world, { design: dinky, x, y, angle: 0 });
      const b = world.bodies.indexOf(ships.body(f));
      for (let m = 0; m < dinky.modules.length; m++) ships.fuel.vent(b, m, ships.fuel.held(b, m) * SPENT);
    }
  });
}
