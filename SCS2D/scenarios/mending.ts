import { compileBlueprint, DAMAGE_ENERGY_PER_KG, type Blueprint } from '../sim/index.js';
import type { Battle } from './types.js';
import { makeBattle } from './battle.js';

/** A core at the bow, a spine of structure, and a robot bay at the stern with a hold and a battery beside it. */
export const MENDER: Blueprint = {
  name: 'Mender',
  modules: [
    { kind: 'core', x: 0, y: 0, length: 3, width: 3 },
    { kind: 'structure', x: 4, y: 0, length: 5, width: 3 },
    { kind: 'structure', x: 9, y: 0, length: 5, width: 3 },
    { kind: 'structure', x: 14, y: 0, length: 5, width: 3 },
    { kind: 'structure', x: 19, y: 0, length: 5, width: 3 },
    { kind: 'robotBay', x: 23.5, y: 0, length: 4, width: 4 },
    { kind: 'hold', x: 23.5, y: 3.5, length: 4, width: 3 },
    { kind: 'battery', x: 23.5, y: -3.5, length: 4, width: 3 },
  ],
};

/**
 * A battered Mender drifting alone while its robots mend it (`Ships.tend`):
 * every module but its bay hit, the core lightly and the spine harder, none
 * so hard it is ragged, which would cut the bay off from command.
 */
export function mending(seed = 20261013): Battle {
  return makeBattle({ seed, pilots: false }, (ships, world) => {
    const mender = compileBlueprint(MENDER);
    const a = ships.spawn(world, { design: mender, x: 0, y: 0, angle: 0, vx: 1, angularVel: 0.01 });
    const body = world.bodies.indexOf(ships.body(a));
    for (let m = 0; m < mender.modules.length; m++) {
      const module = mender.modules[m]!;
      if (module.spec.kind === 'robotBay') continue;
      const spent = module.spec.kind === 'core' ? 0.3 : 0.4 + 0.1 * (m % 3);
      ships.damage.absorb(body, m, module.stats.hitPoints * DAMAGE_ENERGY_PER_KG * spent);
    }
  });
}
