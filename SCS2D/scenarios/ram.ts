import { compileBlueprint, math } from '../sim/index.js';
import type { Battle } from './types.js';
import { makeBattle } from './battle.js';
import { CORVETTE, DINKY, GUNSHIP } from './blueprints.js';

/**
 * Hulls hitting each other, and nothing else.
 *
 * No wells, no orders and therefore no shooting: a ship with nothing to fight
 * holds its heading and its fire, so what this pins is the contact solver on
 * its own — where two hulls met, which way the impulse pushed, and how they
 * tumbled afterwards. Everything else a battle does would only make the
 * checksum harder to read.
 *
 * Four ships converge on one that is sitting still, at different speeds and
 * angles, so the run covers the cases that differ: square on the nose, a
 * glancing blow well off the centre of mass, a light ship into a heavy one,
 * and the second-order mess afterwards as tumbling hulls drift back together.
 *
 * **No pilot runs here.** A ship told nothing holds station, which means it
 * burns to kill the very velocity that would carry it into something — so the
 * hulls are left ballistic, and what they do when they meet is the whole of
 * what this scenario says.
 */
export function ram(seed = 20260905): Battle {
  return makeBattle({ seed, pilots: false, projectiles: 64, beams: 64 }, (ships, world) => {
    const corvette = compileBlueprint(CORVETTE);
    const gunship = compileBlueprint(GUNSHIP);
    const dinky = compileBlueprint(DINKY);

    // The anvil: adrift, facing along +x, hit by everything else.
    ships.spawn(world, { design: gunship, x: 0, y: 0, team: 0 });

    // Square on the nose, from ahead.
    ships.spawn(world, { design: corvette, x: 900, y: 0, angle: math.PI, vx: -70, team: 1 });

    // A glancing blow across the bow: offset enough to be a lever rather than a
    // shove, which is what sets both of them spinning.
    ships.spawn(world, { design: corvette, x: -700, y: 26, angle: 0, vx: 55, vy: -1, team: 1 });

    // A fighter into the flank at speed, well inside the gunship's length: sixty
    // times lighter, so what happens to it is not what happens to what it hits.
    ships.spawn(world, { design: dinky, x: 12, y: -600, angle: math.HALF_PI, vy: 120, team: 1 });
  });
}
