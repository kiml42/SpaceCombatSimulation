import { compileBlueprint } from '../sim/index.js';
import type { Battle } from './types.js';
import { makeBattle } from './battle.js';
import { BARE_CORE, DINKY } from './blueprints.js';
import { TENDER } from './carrier.js';

/** Rounds each Dinky has left as it sets out. */
const ROUNDS = 6;

/**
 * Three Dinkies with a few rounds left each, a Tender behind them and an
 * unarmed hulk to shoot at.
 *
 * Each fires itself dry, breaks off for a free pad on the Tender, takes on
 * metal and fuel together, and goes back to the fight (`Ships.pump`).
 */
export function rearm(seed = 20261010): Battle {
  return makeBattle({ seed, projectiles: 128, beams: 16 }, (ships, world) => {
    const tender = compileBlueprint(TENDER);
    const dinky = compileBlueprint(DINKY);
    const round = dinky.turrets.find((t) => t.gun.roundMass > 0)!.gun.roundMass;
    ships.spawn(world, { design: tender, x: 0, y: 0, angle: 0.2 });
    ships.spawn(world, { design: compileBlueprint(BARE_CORE), x: 320, y: 40, team: 1 });
    for (const [x, y] of [[150, 200], [100, -150], [200, 0]] as const) {
      const f = ships.spawn(world, { design: dinky, x, y, angle: 0 });
      const b = world.bodies.indexOf(ships.body(f));
      ships.metal.drain(b, dinky.cores[0]!, ships.metal.left(b) - ROUNDS * round);
    }
  });
}
