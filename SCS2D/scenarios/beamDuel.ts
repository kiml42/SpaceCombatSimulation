import { compileBlueprint, math } from '../sim/index.js';
import type { Battle } from './types.js';
import { CROSSING, SIDE_WELL, makeBattle } from './battle.js';
import { BEAM_CORVETTE, BEAM_GUNSHIP } from './blueprints.js';
import { OrderCancelCondition } from '../sim/ships.js';

/**
 * Beam-armed ships only: two beam corvettes closing on a beam gunship.
 *
 * Every weapon here is a beam, deliberately. The projectile scenarios already
 * cover rounds in flight, and a scenario that mixed the two would let a beam
 * regression hide behind gunnery that still worked — the checksum would move
 * either way and say nothing about which.
 *
 * Otherwise the opening is the duel's: a crossing start (see `CROSSING`) and a
 * well off to one side, so the beams are fought for with the same manoeuvring.
 */
export function beamDuel(seed = 20260905): Battle {
  return makeBattle({ seed, wells: [SIDE_WELL] }, (ships, world) => {
    const corvette = compileBlueprint(BEAM_CORVETTE);
    const gunship = compileBlueprint(BEAM_GUNSHIP);

    ships.spawn(world, { design: corvette, ...CROSSING.west, team: 0 });
    ships.spawn(world, {
      design: corvette,
      x: 2000,
      y: -740,
      angle: math.HALF_PI / 2,
      vx: 0,
      vy: 90,
      team: 0,
    });
   ships.spawn(world, { design: gunship, ...CROSSING.east, team: 1 });
  });
}
