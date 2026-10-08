import { compileBlueprint, math } from '../sim/index.js';
import { type Battle } from './types.js';
import { makeBattle } from './battle.js';
import { BROADSIDE, CORVETTE } from './blueprints.js';

/**
 * A Broadside against a corvette: a ship whose main guns do not point the way
 * it flies.
 *
 * The Broadside's engines push it bow first and its three main guns train
 * only over its port beam, so it has to turn its side to the corvette to
 * fight. They start bow to bow, out of reach; nothing gives an order.
 */
export function broadside(seed = 20260905): Battle & { readonly broadside: number; readonly enemy: number } {
  return makeBattle({ seed }, (ships, world) => {
    const broadside = ships.spawn(world, { design: compileBlueprint(BROADSIDE), x: 0, y: 0, angle: 0, team: 0 });
    const enemy = ships.spawn(world, {
      design: compileBlueprint(CORVETTE),
      x: 3000,
      y: 0,
      angle: math.PI,
      team: 1,
    });
    return { broadside, enemy };
  });
}
