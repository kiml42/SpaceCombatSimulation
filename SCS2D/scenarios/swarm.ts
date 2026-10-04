import { compileBlueprint, math } from '../sim/index.js';
import { type Battle } from './types.js';
import { CROSSING, makeBattle } from './battle.js';
import { DINKY, BEAM_GUNSHIP, GUNSHIP } from './blueprints.js';
import { Rng } from '../sim/rng.js';

/**
 * Many dinkies and one gunship closing on each other and opening fire.
 */

export function swarm(seed = 20260905, fighterCount = 20): Battle {
  return makeBattle({ seed }, (ships, world) => {
    const dinky = compileBlueprint(DINKY);
    const beamGunship = compileBlueprint(BEAM_GUNSHIP);
    const gunship = compileBlueprint(GUNSHIP);

    ships.spawn(world, { design: beamGunship, ...CROSSING.east, team: 1 });
    ships.spawn(world, {
      design: gunship,
      x: CROSSING.east.x + 300,
      y: CROSSING.east.y,
      angle: CROSSING.east.angle,
      vx: CROSSING.east.vx,
      vy: CROSSING.east.vy,
      team: 1
    });

    const rng = new Rng(seed);
    const randomRadius = 1000;

    for (let i = 0; i < fighterCount; i++) {
      const angle = rng.nextRange(0, 2 * math.PI);
      const radius = math.sqrt(rng.nextRange(0, 1)) * randomRadius;
      const x = CROSSING.west.x + radius * math.cos(angle);
      const y = CROSSING.west.y + radius * math.sin(angle);
      const dvx = rng.nextRange(-20, 20);
      const dvy = rng.nextRange(-20, 20);

      ships.spawn(world, {
        design: dinky,
        x,
        y,
        angle: rng.nextRange(0, 2 * math.PI),
        vx: dvx,
        vy: CROSSING.west.vy + dvy,
        team: 0,
      });
    }
  });
}
