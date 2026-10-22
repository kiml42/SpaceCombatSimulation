import { compileBlueprint, type MapSettings } from '../sim/index.js';
import type { Battle } from './types.js';
import { CROSSING, makeBattle } from './battle.js';
import { CORVETTE, GUNSHIP } from './blueprints.js';

/** Two majors on an eccentric orbit and a scatter of minors about them. */
export const FIELD: MapSettings = {
  majors: 2,
  majorSize: 300,
  majorSpread: 80,
  minors: 8,
  minorSize: 60,
  minorSpread: 30,
  eccentricity: 0.6,
  surfaceGravity: 0.5,
};

/** The duel's ships in an asteroid field drawn from the seed. */
export function asteroidField(seed = 20260905, map: MapSettings = FIELD): Battle {
  return makeBattle({ seed, map }, (ships, world) => {
    ships.spawn(world, { design: compileBlueprint(CORVETTE), ...CROSSING.west, team: 0 });
    ships.spawn(world, { design: compileBlueprint(GUNSHIP), ...CROSSING.east, team: 1 });
  });
}
