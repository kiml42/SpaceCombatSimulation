import { compileBlueprint, DEFAULT_DOCTRINE, math } from '../sim/index.js';
import { type Battle } from './types.js';
import { makeBattle } from './battle.js';
import { CATAMARAN, CORVETTE } from './blueprints.js';

/**
 * A ship cut in half, and both halves flying on.
 *
 * The Catamaran is two hulls joined by four sections of thin structure, with a
 * core in each hull. A gunship is sent down the middle of it at ramming speed
 * and takes the bridge out in the first few seconds — and because each half
 * keeps a working core, what the split leaves is two ships rather than one
 * ship and a wreck.
 *
 * The corvette off the port bow is what proves it. Nothing is told to fight
 * it: each half picks it up on its own doctrine, closes to its own band and
 * opens fire, which a hulk cannot do and a piece with a working core can.
 *
 * The one order in the scenario is the ram, because a gunship flying its own
 * doctrine would stand off at a kilometre and shoot rather than go through
 * anything.
 */
export function split(seed = 20260905): Battle {
  return makeBattle({ seed, projectiles: 256, beams: 64 }, (ships, world) => {
    // Held to its guns rather than turning to burn clear: the scenario is the
    // cut, and a target that backs away takes the ram off its bridge.
    const doctrine = CATAMARAN.doctrine ?? DEFAULT_DOCTRINE;
    const catamaran = compileBlueprint({
      ...CATAMARAN,
      doctrine: { ...doctrine, approach: { ...doctrine.approach, burnWeight: 0 } },
    });
    const corvette = compileBlueprint(CORVETTE);

    const target = ships.spawn(world, { design: catamaran, x: 0, y: 0, angle: 0, team: 0 });

    // Down the centreline at the bridge rather than at either hull, close enough
    // that it arrives in the first few seconds. A ram flies in without braking,
    // so thirty metres a second is what it hits at: much slower and the bridge
    // holds, much faster and the ram takes both hulls to pieces instead of
    // taking them apart.
    const rammer = ships.spawn(world, {
      design: corvette,
      x: 220,
      y: 0,
      angle: math.PI,
      vx: -30,
      team: 1,
    });
    ships.pushRam(rammer, target, 30);

    // Far enough off that it arrives after the ram rather than during it.
    ships.spawn(world, { design: corvette, x: -1800, y: 1300, angle: 0, team: 1 });
  });
}
