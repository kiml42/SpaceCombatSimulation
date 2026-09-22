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

    const distantCorvette = ships.spawn(world, { design: corvette, ...CROSSING.west, team: 0 });
    const closeCorvette = ships.spawn(world, {
      design: corvette,
      x: 2000,
      y: -740,
      angle: math.HALF_PI / 2,
      vx: 0,
      vy: 90,
      team: 0,
    });
    const b = ships.spawn(world, { design: gunship, ...CROSSING.east, team: 1 });

    // Both corvettes go for the gunship, the near one first and the far one
    // arriving later, so the gunship is fighting one and then two.
    ships.pushOrder(closeCorvette, b, 300, 500, 120);
    ships.pushOrder(distantCorvette, b, 300, 500, 120);

    // The gunship holds the nearer of them off at a range its own mounts like.
    ships.pushOrder(b, closeCorvette, 900, 1200, 60, OrderCancelCondition.Disarm);
    ships.pushOrder(b, distantCorvette, 900, 1200, 60, OrderCancelCondition.CompleteDisable);
    ships.pushOrder(b, closeCorvette, 900, 1200, 60, OrderCancelCondition.CompleteDisable);
  });
}
