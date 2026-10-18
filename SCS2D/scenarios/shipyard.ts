import { compileBlueprint, type Blueprint } from '../sim/index.js';
import type { Battle } from './types.js';
import { makeBattle } from './battle.js';
import { BARE_CORE, SCAVENGER } from './blueprints.js';

/**
 * A core with a slipway on its bow that keeps one Scavenger, setting out with
 * none: holds for the metal it is built of, and generators and batteries for
 * the charge building takes.
 */
export const SHIPYARD: Blueprint = {
  name: 'Shipyard',
  modules: [
    { kind: 'core', x: 0, y: 0, length: 6, width: 6 },
    { kind: 'slipway', x: 5, y: 0, angle: 0, length: 4, width: 6, craft: SCAVENGER.name, keep: 1 },
    { kind: 'hold', x: -6, y: 0, length: 6, width: 6 },
    { kind: 'generator', x: 0, y: 5, length: 6, width: 4 },
    { kind: 'generator', x: 0, y: -5, length: 6, width: 4 },
    { kind: 'battery', x: -6, y: 5, length: 6, width: 4 },
    { kind: 'battery', x: -6, y: -5, length: 6, width: 4 },
  ],
  hangar: { [SCAVENGER.name]: SCAVENGER },
};

/**
 * A Shipyard and an unarmed hulk. The Shipyard's slipway builds a Scavenger
 * bow first out of its face, a slice at a time, pushing what it has built out
 * as it goes; fits it out, fills it and lets it go (`Ships.build`).
 */
export function shipyard(seed = 20261018): Battle {
  return makeBattle({ seed, projectiles: 64, beams: 16 }, (ships, world) => {
    ships.spawn(world, { design: compileBlueprint(SHIPYARD), x: 0, y: 0, angle: 0.2 });
    ships.spawn(world, { design: compileBlueprint(BARE_CORE), x: 600, y: 200, team: 1 });
  });
}
