import { compileBlueprint } from '../sim/index.js';
import type { Battle } from './types.js';
import { CROSSING, SIDE_WELL, makeBattle } from './battle.js';
import { FRACTAL, GUNSHIP2 } from './blueprints.js';

/** A ship of nested assemblies against a plain gunship. */
export function fractal(seed = 20260905): Battle {
  return makeBattle({ seed, wells: [SIDE_WELL] }, (ships, world) => {
    const a = ships.spawn(world, {
      design: compileBlueprint(FRACTAL),
      ...CROSSING.west,
      team: 0,
    });
    const b = ships.spawn(world, {
      design: compileBlueprint(GUNSHIP2),
      ...CROSSING.east,
      team: 1,
    });

    ships.pushOrder(a, b, 300, 500, 120);
    ships.pushOrder(b, a, 900, 1200, 60);
  });
}
