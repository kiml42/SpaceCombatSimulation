import { compileBlueprint, math } from '../sim/index.js';
import { type Battle } from './types.js';
import { makeBattle } from './battle.js';
import { BEAM_CORVETTE, CORVETTE, GUNSHIP } from './blueprints.js';

/**
 * Two fleets in **line ahead**, nose to tail along the line they are fighting
 * down — so that every ship but the leader has one of its own in front of its
 * guns.
 *
 * `standoff` is the other formation: two lines abreast, where a fleet's
 * friends are beside it and its guns look out into clear space. That makes it
 * the wrong scenario for asking whether a ship will shoot through its own
 * side, because the question never comes up. This one is the same fleets
 * turned ninety degrees, and nothing else about it is different.
 *
 * Nobody issues an order, as in `standoff`: what the ships do about the
 * friend in the way is a property of the ships.
 *
 * The heavy is at the back of each column, which is the arrangement that
 * costs the most: the gunship's bow gun is the longest-reaching weapon in the
 * fleet and it is the one with the most of its own fleet to see past.
 */
export function column(seed = 20260905): Battle {
  return makeBattle({ seed, projectiles: 256, beams: 64 }, (ships, world) => {
    const gunship = compileBlueprint(GUNSHIP);
    const corvette = compileBlueprint(CORVETTE);
    const beamCorvette = compileBlueprint(BEAM_CORVETTE);

    /** Where each column's leader sits: half a kilometre off the middle. */
    const LEAD = 500;
    /**
     * Nose-to-tail spacing.
     *
     * Comfortably more than a hull is long, so this is a formation rather than
     * a collision — and comfortably less than the few hundred metres a gun
     * looks ahead for a friend, so a ship astern really does have its consort
     * in the way rather than merely somewhere ahead of it.
     */
    const INTERVAL = 200;

    const file = [corvette, beamCorvette, corvette, gunship];

    for (let i = 0; i < file.length; i++) {
      const design = file[i]!;
      const back = LEAD + i * INTERVAL;
      ships.spawn(world, { design, x: -back, y: 0, angle: 0, team: 0 });
      ships.spawn(world, { design, x: back, y: 0, angle: math.PI, team: 1 });
    }
  });
}
