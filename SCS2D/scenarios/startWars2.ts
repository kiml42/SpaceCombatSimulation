import { type Battle } from './types.js';
import { fleetBattle } from './fleetBattle.js';
import { REBEL_FLEET, IMPERIAL_FLEET } from './fleets.js';

export function starWars2(seed = 20260905): Battle {
  return fleetBattle([REBEL_FLEET, IMPERIAL_FLEET], { seed, projectiles: 256, beams: 64, range: 5000 });
}
