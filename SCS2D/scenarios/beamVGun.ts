import { compileBlueprint } from '../sim/index.js';
import type { Battle } from './types.js';
import { CROSSING, SIDE_WELL, makeBattle } from './battle.js';
import { GUNSHIP, BEAM_GUNSHIP } from './blueprints.js';

/** A beam gunship against a gun one, each holding the range its weapons like. */
export function beamVGun(seed = 20260905): Battle {
  return makeBattle({ seed, wells: [SIDE_WELL] }, (ships, world) => {
    const beamGunship = compileBlueprint(BEAM_GUNSHIP);
    const gunship = compileBlueprint(GUNSHIP);

    ships.spawn(world, {
      design: beamGunship,
      ...CROSSING.west,
      vy: 80,
      team: 0,
    });
    ships.spawn(world, {
      design: gunship,
      ...CROSSING.east,
      vx: 10,
      team: 1,
    });
  });
}
