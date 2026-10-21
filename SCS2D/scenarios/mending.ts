import { compileBlueprint, DAMAGE_ENERGY_PER_KG, settleIds, topId, type Blueprint } from '../sim/index.js';
import type { Battle } from './types.js';
import { makeBattle } from './battle.js';
import { BEAM_CATAMARAN, CATAMARAN } from './blueprints.js';

/** A core at the bow, reaching the stern, a spine of structure, and a robot bay at the stern with a hold and a battery beside it. */
export const MENDER: Blueprint = {
  name: 'Mender',
  modules: [
    { kind: 'core', x: 0, y: 0, length: 3, width: 3, computing: 0.35 },
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

/** A Mender with a fin beside its hold and an engine astern of its bay. */
export const REBUILDER: Blueprint = {
  name: 'Rebuilder',
  modules: [
    ...MENDER.modules,
    { kind: 'structure', x: 23.5, y: 6.5, length: 4, width: 3 },
    { kind: 'engine', x: 25.5, y: 0, angle: 0, length: 1, width: 2, nozzle: 0.5 },
  ],
};

/** The Rebuilder, ids and all, as a refit starts from it. */
const REFIT_FROM: Blueprint = settleIds(REBUILDER);

/**
 * The Rebuilder refitted: its fin a tank of the same size, its engine gone,
 * and a fin of structure beside its battery instead.
 */
export const REFITTED: Blueprint = {
  name: 'Refitted Rebuilder',
  modules: [
    ...REFIT_FROM.modules
      .filter((m) => !('kind' in m) || m.kind !== 'engine')
      .map((m) => ('kind' in m && m.y === 6.5 ? { ...m, kind: 'tank' as const } : m)),
    { id: topId(REFIT_FROM) + 1, kind: 'structure', x: 23.5, y: -6.5, length: 4, width: 3 },
  ],
};

/**
 * A Rebuilder refitted to the Refitted Rebuilder as it sets out (`Ships.refit`):
 * its robots build the new fin first, then take down the engine it no longer
 * has, and refit the old fin in place as the tank.
 */
export function refitting(seed = 20261018): Battle {
  return makeBattle({ seed, pilots: false }, (ships, world) => {
    const a = ships.spawn(world, { design: compileBlueprint(REFIT_FROM), x: 0, y: 0, angle: 0 });
    const problem = ships.refit(world, a, compileBlueprint(REFITTED));
    if (problem !== null) throw new Error(problem);
  });
}

/**
 * A Catamaran refitted to the Beam Catamaran beside a Beam Catamaran refitted
 * to the Catamaran. Each turret is refitted in place, as the retro engine
 * ahead of it would be cut loose were it taken down, and the tank the Beam
 * Catamaran has out of its wing box is kept rather than built again.
 */
export function catamaranRefits(seed = 20261021): Battle {
  return makeBattle({ seed, pilots: false }, (ships, world) => {
    const pairs = [
      [CATAMARAN, BEAM_CATAMARAN, -40],
      [BEAM_CATAMARAN, CATAMARAN, 40],
    ] as const;
    for (const [from, to, x] of pairs) {
      const i = ships.spawn(world, { design: compileBlueprint(from), x, y: 0, angle: 0 });
      const problem = ships.refit(world, i, compileBlueprint(to));
      if (problem !== null) throw new Error(problem);
    }
  });
}
