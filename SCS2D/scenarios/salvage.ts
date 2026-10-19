import { compileBlueprint, DAMAGE_ENERGY_PER_KG, math, type Blueprint } from '../sim/index.js';
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

/** What each leech's tank has room for, kg: enough to drain for a while, and then let go full. */
const ROOM = 2000;

/**
 * Two leeches drifting bow first into two wrecked corvettes, to drink what is
 * left in their tanks (`Ships.weld`, `Ships.pump`).
 *
 * One wreck has been torn open everywhere, so its leech's claw takes for
 * certain; the other is sound bar its cores, so whether the claw takes is a
 * roll. A leech that takes pumps until its tanks are full and lets go.
 */
export function salvage(seed = 20261008): Battle {
  return makeBattle({ seed, projectiles: 16, beams: 16 }, (ships, world) => {
    const leech = compileBlueprint(LEECH);
    const corvette = compileBlueprint(CORVETTE);
    const gap = leech.radius + corvette.radius + 1;

    for (const [row, torn] of [[0, true], [200, false]] as const) {
      const sucker = ships.spawn(world, { design: leech, x: -gap / 2, y: row, angle: 0, vx: 1.5, team: 0 });
      const wreck = ships.spawn(world, { design: corvette, x: gap / 2, y: row, angle: math.PI, vx: -1.5, team: 1 });
      const own = world.bodies.indexOf(ships.body(sucker));
      ships.fuel.vent(own, 1, ROOM);
      const body = world.bodies.indexOf(ships.body(wreck));
      for (let m = 0; m < corvette.modules.length; m++) {
        const module = corvette.modules[m]!;
        const spent = module.spec.kind === 'core' ? 0.7 : torn ? 0.9 : 0;
        ships.damage.absorb(body, m, module.stats.hitPoints * DAMAGE_ENERGY_PER_KG * spent);
      }
    }
  });
}

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
 * Two salvagers drifting bow first into wrecks, whose robots cross onto them
 * and take them apart into metal in the salvager's hold, from the far end in
 * (`Ships.tend`): a dead leech, gone in a couple of minutes, and a dead
 * corvette, which fills the hold.
 */
export function scrapyard(seed = 20261013): Battle {
  return makeBattle({ seed, projectiles: 16, beams: 16 }, (ships, world) => {
    const salvager = compileBlueprint(BREAKER);
    for (const [row, wreck] of [
      [0, compileBlueprint(LEECH)],
      [200, compileBlueprint(CORVETTE)],
    ] as const) {
      const gap = salvager.radius + wreck.radius + 1;
      ships.spawn(world, { design: salvager, x: -gap / 2, y: row, angle: 0, vx: 0.6, team: 0 });
      const hulk = ships.spawn(world, { design: wreck, x: gap / 2, y: row, angle: math.PI, vx: -0.6, team: 1 });
      const body = world.bodies.indexOf(ships.body(hulk));
      for (let m = 0; m < wreck.modules.length; m++) {
        const module = wreck.modules[m]!;
        const spent = module.spec.kind === 'core' ? 1 : 0.9;
        ships.damage.absorb(body, m, module.stats.hitPoints * DAMAGE_ENERGY_PER_KG * spent);
      }
    }
  });
}

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
