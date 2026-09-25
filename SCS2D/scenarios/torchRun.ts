import { compileBlueprint, math } from '../sim/index.js';
import { type Battle } from './types.js';
import { makeBattle } from './battle.js';
import { GUNSHIP, TORCH } from './blueprints.js';

/**
 * A pack of torch ships against a gunship: engines used as weapons.
 *
 * A torch's weapon is the big engine on its bow, pointed forwards. Nothing
 * here gives an order — what they do comes from their doctrine, which closes
 * fast to within their own flame's reach of something large and sits there.
 * The rest follows from the engine facing the wrong way: the same burn that
 * scorches the gunship brakes the torch's approach, then holds it off and
 * pushes it back out of reach, and it closes again. Hit and run, without any
 * rule saying so.
 *
 * Six rather than one because a gunship's main gun kills a craft this size
 * with a single round: a pack is what gets some of them in.
 */
export function torchRun(seed = 20260905): Battle & { readonly torches: readonly number[]; readonly target: number } {
  return makeBattle({ seed, projectiles: 1024, beams: 64 }, (ships, world) => {
    const torch = compileBlueprint(TORCH);
    const gunship = compileBlueprint(GUNSHIP);

    const torches: number[] = [];
    const DISTANCE = 800;
    for (let k = 0; k < 6; k++) {
      // An arc across the gunship's bow, each pointed at it.
      const bearing = math.PI + (k - 2.5) * 0.25;
      torches.push(
        ships.spawn(world, {
          design: torch,
          x: math.cos(bearing) * DISTANCE,
          y: math.sin(bearing) * DISTANCE,
          angle: bearing + math.PI,
          team: 0,
        }),
      );
    }
    const target = ships.spawn(world, { design: gunship, x: 0, y: 0, angle: math.PI, team: 1 });
    return { torches, target };
  });
}
