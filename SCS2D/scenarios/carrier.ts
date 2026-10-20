import { compileBlueprint, joints, type Blueprint } from '../sim/index.js';
import type { Battle } from './types.js';
import { makeBattle } from './battle.js';
import { BARE_CORE, DINKY } from './blueprints.js';

/** A core and a great tank between two pads, with no engine: a filling station. */
export const TENDER: Blueprint = {
  name: 'Tender',
  modules: [
    { kind: 'core', x: 0, y: 0, length: 6, width: 6 },
    { kind: 'tank', x: 0, y: 0 - 13, length: 6, width: 20 },
    { kind: 'pad', x: 13, y: 0, length: 20, width: 20 },
    { kind: 'pad', x: -13, y: 0, length: 20, width: 20 },
  ],
};

/** A Tender with a hold opposite its tank, so its pads have metal to build with. */
export const WORKSHOP: Blueprint = {
  name: 'Workshop',
  modules: [...TENDER.modules, { kind: 'hold', x: 0, y: 13, length: 6, width: 20 }],
};

/**
 * Two Dinkies low on fuel, and a Workshop with two pads. Each has lost an
 * outrigger engine, one either side; each lands to be filled, and its pad
 * builds back what it lost, walls first, before letting it go (`Ships.pump`).
 */
export function padRebuild(seed = 20261013): Battle {
  return makeBattle({ seed, projectiles: 64, beams: 16 }, (ships, world) => {
    const workshop = compileBlueprint(WORKSHOP);
    const base = compileBlueprint(DINKY).doctrine;
    const dinky = compileBlueprint({ ...DINKY, doctrine: { ...base, approach: { ...base.approach, refuelBelow: 0.5 } } });
    const all = joints(dinky);
    const ends = (m: number): number => all.filter((j) => j.a === m || j.b === m).length;
    // The engines at the ends of its outriggers, which nothing else hangs from.
    const outriggers = dinky.modules.map((m, k) => (m.spec.kind === 'engine' && ends(k) === 1 ? k : -1)).filter((k) => k >= 0);
    ships.spawn(world, { design: workshop, x: 0, y: 0, angle: 0.2 });
    for (const [x, y, lost] of [
      [-400, 250, outriggers.slice(0, 1)],
      [300, 350, outriggers.slice(1, 2)],
    ] as const) {
      const f = ships.spawn(world, { design: dinky, x, y, angle: 0 });
      const b = world.bodies.indexOf(ships.body(f));
      for (let m = 0; m < dinky.modules.length; m++) ships.fuel.vent(b, m, ships.fuel.held(b, m) * 0.6);
      // Cut away, to drift where they were while the fighter flies off.
      for (let k = 0; k < all.length; k++) {
        if (lost.includes(all[k]!.a) || lost.includes(all[k]!.b)) ships.damage.cutWeld(b, k, all[k]!.width * 2);
      }
    }
  });
}

/** A Workshop whose bow pad keeps three Dinkies, setting out with none. */
export const FACTORY: Blueprint = {
  name: 'Factory',
  modules: [
    ...TENDER.modules.slice(0, 2),
    { kind: 'pad', x: 13, y: 0, length: 20, width: 20, craft: DINKY.name, keep: 3 },
    ...WORKSHOP.modules.slice(3),
  ],
  hangar: { [DINKY.name]: DINKY },
};

/**
 * A Factory and an unarmed hulk to shoot at. The Factory's bow pad lays down a
 * Dinky's core and builds the rest round it, fills it and lets it go, three
 * times over, one at a time (`Ships.build`).
 */
export function factory(seed = 20261017): Battle {
  return makeBattle({ seed, projectiles: 64, beams: 16 }, (ships, world) => {
    ships.spawn(world, { design: compileBlueprint(FACTORY), x: 0, y: 0, angle: 0.2 });
    ships.spawn(world, { design: compileBlueprint(BARE_CORE), x: 600, y: 200, team: 1 });
  });
}
