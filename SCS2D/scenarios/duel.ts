import { compileBlueprint, math } from '../sim/index.js';
import type { Battle } from './types.js';
import { CROSSING, SIDE_WELL, makeBattle } from './battle.js';
import { CORVETTE, GUNSHIP } from './blueprints.js';
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
    const gunship = compileBlueprint(GUNSHIP);

    ships.spawn(world, { design: corvette, ...CROSSING.west, team: 0 });
    ships.spawn(world, {
      design: corvette,
      x: 2000,
      y: -740,
      angle: math.HALF_PI / 2,
      vx: 0,
      vy: 90,
      team: 0,
    });
    ships.spawn(world, { design: gunship, ...CROSSING.east, team: 1 });

    // no orders given, rely on the doctrine.
  });
}
