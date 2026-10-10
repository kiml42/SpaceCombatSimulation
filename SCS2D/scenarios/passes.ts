import { compileBlueprint, DAMAGE_ENERGY_PER_KG, type Blueprint } from '../sim/index.js';
import type { Battle } from './types.js';
import { makeBattle } from './battle.js';
import { CORVETTE, DINKY, Y_WING } from './blueprints.js';

/**
 * A fighter attacking on the move (`tangentialMin`, `tangentialMax`) at a
 * Corvette whose engines are shot out, so it holds still. Nobody can be hurt,
 * so what this shows is the flying.
 */
function onTheMove(seed: number, fighter: Blueprint): Battle {
  return makeBattle({ seed, projectiles: 512, beams: 64 }, (ships, world) => {
    const corvette = compileBlueprint(CORVETTE);
    const c = ships.spawn(world, { design: corvette, x: 0, y: 0, angle: 0, team: 1 });
    const body = world.bodies.indexOf(ships.body(c));
    corvette.modules.forEach((m, k) => {
      if (m.spec.kind === 'engine') ships.damage.absorb(body, k, m.stats.hitPoints * DAMAGE_ENERGY_PER_KG);
    });
    ships.damage.protect(body);
    ships.spawn(world, { design: compileBlueprint(fighter), x: -2500, y: 300, angle: 0, team: 0, invulnerable: true });
  });
}

/** A Dinky set to attack faster than its thrust can hold a turn at, so it makes passes. */
export function passes(seed = 20261012): Battle {
  const doctrine = compileBlueprint(DINKY).doctrine;
  return onTheMove(seed, { ...DINKY, doctrine: { ...doctrine, approach: { ...doctrine.approach, tangentialMin: PASS_MIN, tangentialMax: PASS_MAX } } });
}

/** The pass speeds the `passes` Dinky is set to, m/s. */
const PASS_MIN = 60;
const PASS_MAX = 100;

/** A Y-wing, fighting from far enough out that it can hold the turn, circles. */
export function circling(seed = 20261012): Battle {
  return onTheMove(seed, Y_WING);
}
