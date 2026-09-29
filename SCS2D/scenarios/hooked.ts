import { compileBlueprint, DAMAGE_ENERGY_PER_KG, math, RAGGED_INTEGRITY } from '../sim/index.js';
import type { Battle } from './types.js';
import { makeBattle } from './battle.js';
import { CORVETTE, GUNSHIP } from './blueprints.js';

/**
 * Two ships hooked together, each trying to fight somebody else.
 *
 * A corvette of each side, main engines torn open, back into each other slowly
 * enough to hook, so they become one body flown by both (`Ships.weld`). Each
 * faces an enemy gunship on its own side, so each drives the pair towards a
 * different fight on what engines it has left: they pull against each other
 * until something tears them apart or one of them stops flying.
 */
export function hooked(seed = 20260929): Battle {
  return makeBattle({ seed, projectiles: 256, beams: 64 }, (ships, world) => {
    const corvette = compileBlueprint(CORVETTE);
    const gunship = compileBlueprint(GUNSHIP);
    const tail = corvette.modules.reduce((least, m) => math.min(least, m.x - m.spec.length / 2), Infinity);
    const stern = corvette.modules.findIndex((m) => m.x - m.spec.length / 2 === tail);
    // Sterns just touching, so they hook before either pilot can pull away.
    const gap = -2 * tail - 0.01;

    const pair = [
      ships.spawn(world, { design: corvette, x: -gap / 2, y: 0, angle: math.PI, vx: 0.5, team: 0 }),
      ships.spawn(world, { design: corvette, x: gap / 2, y: 0.5, angle: 0, vx: -0.5, team: 1 }),
    ];
    for (const ship of pair) {
      const body = world.bodies.indexOf(ships.body(ship));
      const stats = corvette.modules[stern]!.stats;
      ships.damage.absorb(body, stern, stats.hitPoints * DAMAGE_ENERGY_PER_KG * (1 - RAGGED_INTEGRITY * 0.5));
    }

    // Each corvette's enemy is ahead of it, and so on the far side of the other.
    ships.spawn(world, { design: gunship, x: -1800, y: 1200, team: 1 });
    ships.spawn(world, { design: gunship, x: 1800, y: -400, team: 0 });
  });
}
