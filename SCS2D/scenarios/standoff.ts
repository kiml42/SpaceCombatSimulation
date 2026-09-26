import { type Battle } from './types.js';
import { fleetBattle } from './fleetBattle.js';
import { LINE_OF_BATTLE } from './fleets.js';

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
  // A kilometre apart, which is under two seconds of flight for the guns these
  // ships carry: comfortably a fight, if anyone decides to have one.
  return fleetBattle([LINE_OF_BATTLE, LINE_OF_BATTLE], { seed, projectiles: 256, beams: 64, range: 1000 });
}
