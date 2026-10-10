import { compileBlueprint, DAMAGE_ENERGY_PER_KG, math } from '../sim/index.js';
import type { Battle } from './types.js';
import { makeBattle } from './battle.js';
import { BEAM_CARRIER, CORVETTE, TIE } from './blueprints.js';

/** How many TIEs come at it. */
const RAIDERS = 8;

/**
 * A Beam Carrier, short of fuel, against a wave of TIEs, with two wrecks behind it.
 *
 * It sets out with its tender docked port to port and a Dinky Beam on each of
 * its eight pads. The carrier is below its own `dockBelow`, so it has no fuel
 * to spare its tender, and the tender casts off to drink from the wrecks with
 * its claw. The fighters launch charged, fight the TIEs on their batteries,
 * and come back to the pads to recharge once they are down to half.
 */
export function beamCarrier(seed = 20261011): Battle {
  return makeBattle({ seed, projectiles: 1024, beams: 256 }, (ships, world) => {
    ships.spawn(world, { design: compileBlueprint(BEAM_CARRIER), x: 0, y: 0, angle: 0, team: 0 });
    // Wrecks: Corvettes whose cores are shot out, drifting behind the carrier.
    const corvette = compileBlueprint(CORVETTE);
    for (const [x, y] of [[-700, -300], [-850, 150]] as const) {
      const w = ships.spawn(world, { design: corvette, x, y, angle: 1, team: 1 });
      const b = world.bodies.indexOf(ships.body(w));
      for (const core of corvette.cores) ships.damage.absorb(b, core, corvette.modules[core]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG * 0.7);
    }
    const tie = compileBlueprint(TIE);
    for (let k = 0; k < RAIDERS; k++) {
      ships.spawn(world, { design: tie, x: 3000 + 150 * k, y: (k - (RAIDERS - 1) / 2) * 400, angle: math.PI, team: 1 });
    }
  });
}
