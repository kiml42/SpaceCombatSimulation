import { compileBlueprint, math, type Blueprint } from '../sim/index.js';
import { type Battle } from './types.js';
import { CROSSING, makeBattle } from './battle.js';
import { BEAM_GUNSHIP, TORPEDO } from './blueprints.js';
import { Rng } from '../sim/rng.js';

/**
 * A salvo of torpedoes against a gunship.
 *
 * A torpedo is a fighter with no weapons and a doctrine that rams from any
 * range, so nothing here is ordered: each picks the gunship and commits to
 * hitting it. The beam gunship's turrets reach the weapons layer the torpedoes
 * fly in, and across seeds shoot down about half the salvo before it arrives.
 */
/** How far off the gunship the salvo is launched, metres. */
const LAUNCH_RANGE = 1500;

export function torpedoes(seed = 20260905, count = 12, target: Blueprint = BEAM_GUNSHIP): Battle {
  return makeBattle({ seed }, (ships, world) => {
    const torpedo = compileBlueprint(TORPEDO);
    ships.spawn(world, { design: compileBlueprint(target), ...CROSSING.east, team: 1 });

    const rng = new Rng(seed);
    const randomRadius = 400;
    // Launched together from a point this far off the gunship's beam, moving with it.
    const launchX = CROSSING.east.x - LAUNCH_RANGE;
    for (let i = 0; i < count; i++) {
      const angle = rng.nextRange(0, 2 * math.PI);
      const radius = math.sqrt(rng.nextRange(0, 1)) * randomRadius;
      ships.spawn(world, {
        design: torpedo,
        x: launchX + radius * math.cos(angle),
        y: CROSSING.east.y + radius * math.sin(angle),
        angle: 0,
        vx: CROSSING.east.vx + rng.nextRange(-10, 10),
        vy: CROSSING.east.vy + rng.nextRange(-10, 10),
        team: 0,
      });
    }
  });
}
