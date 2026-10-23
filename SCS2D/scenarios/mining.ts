import { compileBlueprint, math, type MapSettings } from '../sim/index.js';
import type { Battle } from './types.js';
import { makeBattle } from './battle.js';
import { SALVAGER } from './blueprints.js';

/** One major with a scatter of minors about it, rich in both ore and ice. */
export const MINE: MapSettings = { majors: 1, majorSize: 250, minors: 4, minorSize: 50, metal: 0.4, fuel: 0.3 };

/**
 * Two Salvagers, empty, among asteroids and nothing else: each picks the rock
 * that pays most for the time, grips it, and its robots mine it into the hold
 * and the tanks.
 */
export function mining(seed = 20260905, map: MapSettings = MINE): Battle & { readonly miners: readonly number[] } {
  return makeBattle({ seed, map, projectiles: 16, beams: 16 }, (ships, world) => {
    const design = compileBlueprint(SALVAGER);
    const miners = [
      ships.spawn(world, { design, x: -900, y: 0, angle: 0, team: 0 }),
      ships.spawn(world, { design, x: 900, y: 0, angle: math.PI, team: 0 }),
    ];
    return { miners };
  });
}
