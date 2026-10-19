import { compileBlueprint, DAMAGE_ENERGY_PER_KG, type Blueprint } from '../sim/index.js';
import type { Battle } from './types.js';
import { makeBattle } from './battle.js';
import { CORVETTE, SALVAGER } from './blueprints.js';

/** A core, a tank behind it and a claw on its bow, with no engine: it goes where it is sent. */
export const LEECH: Blueprint = {
  name: 'Leech',
  modules: [
    { kind: 'core', x: 0, y: 0, length: 3, width: 3 },
    { kind: 'tank', x: -3.5, y: 0, length: 4, width: 3 },
    { kind: 'claw', x: 2.5, y: 0, angle: 0, length: 2, width: 2 },
  ],
};

/**
 * A core with a claw on its bow, a robot bay, an empty hold and a generator
 * to keep its robots charged, and no engine: a salvager that goes where it is sent.
 */
export const BREAKER: Blueprint = {
  name: 'Breaker',
  modules: [
    { kind: 'core', x: 0, y: 0, length: 3, width: 3 },
    { kind: 'claw', x: 2.5, y: 0, angle: 0, length: 2, width: 2 },
    { kind: 'robotBay', x: -3.5, y: 0, length: 4, width: 4 },
    { kind: 'hold', x: -3.5, y: 4, length: 4, width: 4, fill: 0 },
    { kind: 'generator', x: -3.5, y: -3.5, length: 3, width: 3 },
  ],
};

/**
 * A Salvager, sent out empty, and two dead hulks some way off: a leech and a
 * corvette. It flies to the one that pays most for the time, grips it, and
 * holds on while its robots take it apart into its hold; then goes for the
 * next, until the hold is full (`scavengeMetalBelow`).
 */
export function salvageRun(seed = 20261019): Battle {
  return makeBattle({ seed, projectiles: 16, beams: 16 }, (ships, world) => {
    ships.spawn(world, { design: compileBlueprint(SALVAGER), x: 0, y: 0, angle: 0, team: 0 });
    for (const [x, y, wreck] of [
      [250, 60, compileBlueprint(LEECH)],
      [420, -80, compileBlueprint(CORVETTE)],
    ] as const) {
      const hulk = ships.spawn(world, { design: wreck, x, y, angle: 2, team: 1 });
      const body = world.bodies.indexOf(ships.body(hulk));
      for (let m = 0; m < wreck.modules.length; m++) {
        const module = wreck.modules[m]!;
        if (module.spec.kind === 'core') ships.damage.absorb(body, m, module.stats.hitPoints * DAMAGE_ENERGY_PER_KG);
      }
    }
  });
}
