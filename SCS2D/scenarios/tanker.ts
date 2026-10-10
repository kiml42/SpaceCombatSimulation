import { compileBlueprint, DEFAULT_DOCTRINE, math, type Blueprint } from '../sim/index.js';
import type { Battle } from './types.js';
import { makeBattle } from './battle.js';
import { TANKER } from './blueprints.js';

/**
 * A small ship with a docking port on its port side, thrusters on every face
 * to bring it alongside, and doctrine that goes to a Tanker below half full.
 */
export const PICKET: Blueprint = {
  name: 'Picket',
  doctrine: { ...DEFAULT_DOCTRINE, approach: { ...DEFAULT_DOCTRINE.approach, approachSpeed: 20, dockBelow: 0.5 } },
  modules: [
    { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
    { kind: 'tank', x: -4, y: 0, length: 4, width: 4 },
    { kind: 'port', x: -0.5, y: 2.5, angle: math.PI / 2, length: 1, width: 2 },
    { kind: 'engine', x: -6, y: 0, angle: math.PI, length: 2, width: 2 },
    { kind: 'engine', x: 2, y: 1.25, angle: 0, length: 1, width: 1 },
    { kind: 'engine', x: 2, y: -1.25, angle: 0, length: 1, width: 1 },
    { kind: 'engine', x: -4, y: 2, angle: math.PI / 2, length: 1, width: 1.5 },
    { kind: 'engine', x: -4, y: -2, angle: -math.PI / 2, length: 1, width: 1.5 },
    { kind: 'engine', x: 0, y: -2, angle: -math.PI / 2, length: 1, width: 1.5 },
    { kind: 'engine', x: 1.5, y: 2, angle: math.PI / 2, length: 1, width: 0.8 },
  ],
};

/** How much of each Picket's fuel is gone. */
const SPENT = 0.8;

/**
 * A Tanker and two Pickets low on fuel. Each Picket picks a port, the two
 * spreading across the Tanker's beams, comes to a point off it, lines up and
 * closes the last stretch slowly; the two ports mate, and the Tanker fills it
 * while the smaller of the pair idles (`Ships.weld`, `Ships.pump`).
 */
export function tanker(seed = 20261009): Battle {
  return makeBattle({ seed, projectiles: 16, beams: 16 }, (ships, world) => {
    ships.spawn(world, { design: compileBlueprint(TANKER), x: 0, y: 0, angle: 0.4 });
    const picket = compileBlueprint(PICKET);
    for (const [x, y] of [[-200, 150], [150, -250]] as const) {
      const p = ships.spawn(world, { design: picket, x, y, angle: 0 });
      const b = world.bodies.indexOf(ships.body(p));
      for (let m = 0; m < picket.modules.length; m++) ships.fuel.vent(b, m, ships.fuel.held(b, m) * SPENT);
    }
  });
}
