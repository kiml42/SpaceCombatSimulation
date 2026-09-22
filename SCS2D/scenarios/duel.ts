import { compileBlueprint, math } from '../sim/index.js';
import type { Battle } from './types.js';
import { CROSSING, SIDE_WELL, makeBattle } from './battle.js';
import { CORVETTE, DAMAGED_CORVETTE, GUNSHIP } from './blueprints.js';
import { OrderCancelCondition } from '../sim/ships.js';

/**
 * A corvette and a gunship closing on each other and opening fire.
 *
 * **One definition, used by both the golden test and the viewer**, which is
 * the point of it being here rather than in either.
 *
 * Two different designs on purpose. A duel between identical ships is
 * symmetric, and a symmetric scenario hides any error that is also symmetric.
 *
 * The opening conditions are chosen to *exercise* things rather than to be
 * tidy: a crossing start (see `CROSSING`) and a gravity well off to one side,
 * bending both the ships and their rounds. A head-on duel between two ships at
 * rest in empty space exercises almost none of that, and flatters the gunnery
 * besides — every shot hits when nothing is crossing.
 *
 * Plain TypeScript, no DOM and no Node: it has to run in a browser, in a test
 * and in a worker alike.
 */
export function duel(seed = 20260905): Battle {
  return makeBattle({ seed, wells: [SIDE_WELL] }, (ships, world) => {
    const corvette = compileBlueprint(CORVETTE);
    const damagedCorvette = compileBlueprint(DAMAGED_CORVETTE);
    const gunship = compileBlueprint(GUNSHIP);

    const distantCorvette = ships.spawn(world, { design: corvette, ...CROSSING.west, team: 0 });
    const closeCorvette = ships.spawn(world, {
      design: damagedCorvette,
      x: 2000,
      y: -740,
      angle: math.HALF_PI / 2,
      vx: 0,
      vy: 90,
      team: 0,
    });
    const b = ships.spawn(world, { design: gunship, ...CROSSING.east, team: 1 });

    // The corvettes want to be inside the gunship's reach; the gunship would
    // rather hold it off. Neither gets what it wants, which is the interesting
    // part.

    // the gunship starts off attacking the closer corvette.
    ships.pushOrder(closeCorvette, b, 300, 500, 120);

    // this one starts far away and comes in later to help.
    ships.pushOrder(distantCorvette, b, 300, 500, 120);

    // The gunship has a plan rather than a target, worked through in order:
    // silence the corvette already on it, deal with the one coming to help,
    // then come back and finish the first off.
    ships.pushOrder(b, closeCorvette, 900, 1200, 60, OrderCancelCondition.Disarm);
    ships.pushOrder(b, distantCorvette, 900, 1200, 60, OrderCancelCondition.CompleteDisable);
    ships.pushOrder(b, closeCorvette, 900, 1200, 60, OrderCancelCondition.CompleteDisable);
  });
}
