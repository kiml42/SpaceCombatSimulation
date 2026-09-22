import { compileBlueprint, math } from '../sim/index.js';
import { type Battle } from './types.js';
import { CROSSING, makeBattle } from './battle.js';
import { DINKY, BEAM_GUNSHIP } from './blueprints.js';
import { Rng } from '../sim/rng.js';
import { OrderCancelCondition } from '../sim/ships.js';

/**
 * Many dinkies and one gunship closing on each other and opening fire.
 */

export function swarm(seed = 20260905, corvetteCount = 20): Battle {
  return makeBattle({ seed }, (ships, world) => {
    const dinky = compileBlueprint(DINKY);
    const gunship = compileBlueprint(BEAM_GUNSHIP);

    const b = ships.spawn(world, { design: gunship, ...CROSSING.east, team: 1 });

    const rng = new Rng(seed);
    const randomRadius = 1000;
    const swarm: number[] = [];

    for (let i = 0; i < corvetteCount; i++) {
      const angle = rng.nextRange(0, 2 * math.PI);
      const radius = math.sqrt(rng.nextRange(0, 1)) * randomRadius;
      const x = CROSSING.west.x + radius * math.cos(angle);
      const y = CROSSING.west.y + radius * math.sin(angle);
      const dvx = rng.nextRange(-20, 20);
      const dvy = rng.nextRange(-20, 20);
      const range = rng.nextRange(30, 100);

      const a = ships.spawn(world, {
        design: dinky,
        x,
        y,
        angle: rng.nextRange(0, 2 * math.PI),
        vx: dvx,
        vy: CROSSING.west.vy + dvy,
        team: 0,
      });
      ships.pushOrder(a, b, range, range * 2, 2000);
      swarm.push(a);
      // The gunship's plan, in two passes over the swarm. First: take the teeth
      // out of every one of them, so the least of the incoming fire stops
      // soonest. Orders are worked through in the order they are given.
      ships.pushOrder(b, a, 50, 2000, 60, OrderCancelCondition.Disarm);
    }

    // Then, in the same order, go back and finish them off.
    for (const a of swarm) {
      ships.pushOrder(b, a, 50, 2000, 60, OrderCancelCondition.CompleteDisable);
    }
  });
}
