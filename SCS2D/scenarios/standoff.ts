import { compileBlueprint, math } from '../sim/index.js';
import { type Battle } from './types.js';
import { makeBattle } from './battle.js';
import { BEAM_CORVETTE, CORVETTE, DINKY, GUNSHIP } from './blueprints.js';

/**
 * Two fleets inside each other's reach, and **not one order between them**.
 *
 * Every other scenario is a script: something spawns the ships and then tells
 * each of them what to do. This one tells them nothing, which makes it the
 * only scenario whose outcome is a property of the *ships* rather than of the
 * script — and therefore the only honest way to see what a fleet does when
 * nobody is flying it.
 *
 * What they do is fight, and every part of how they fight comes out of the
 * doctrine each craft carries in its blueprint: what it picks on, how close
 * it wants to be, and when it changes its mind. Nothing here issues an order,
 * so a change to a doctrine shows up in this scenario and nowhere else can it
 * be seen so plainly.
 *
 * The distance they start at is chosen to say something: well inside the
 * range at which they can hurt each other, so what makes this a battle is the
 * doctrine rather than the geometry.
 */
export function standoff(seed = 20260905): Battle {
  return makeBattle({ seed, projectiles: 256, beams: 64 }, (ships, world) => {
    const gunship = compileBlueprint(GUNSHIP);
    const corvette = compileBlueprint(CORVETTE);
    const beamCorvette = compileBlueprint(BEAM_CORVETTE);
    const dinky = compileBlueprint(DINKY);

    // A kilometre apart and facing each other, which is under two seconds of
    // flight for the guns these ships carry: comfortably a fight, if anyone
    // decides to have one.
    const REACH = 500;

    // A line of battle each, with the capital in the middle, a beam ship and a
    // gun ship on the wings, and a pair of fighters ahead of them — enough of a
    // mix that a doctrine will have something to disagree about.
    const line = [
      { design: gunship, y: 0 },
      { design: corvette, y: 260 },
      { design: beamCorvette, y: -260 },
      { design: dinky, y: 120 },
      { design: dinky, y: -120 },
    ];

    for (const craft of line) {
      ships.spawn(world, { design: craft.design, x: -REACH, y: craft.y, angle: 0, team: 0 });
      ships.spawn(world, { design: craft.design, x: REACH, y: -craft.y, angle: math.PI, team: 1 });
    }
  });
}
