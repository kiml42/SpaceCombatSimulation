import { asteroidBlueprint, compileBlueprint, NEUTRAL_TEAM } from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import type { Battle } from "./types.js";
import { makeBattle } from "./battle.js";
import { STAR_DESTROYER } from "./blueprints.js";

/** How fast the Star Destroyer drifts at the rock, m/s. */
export const CRASH_SPEED = 25;

/**
 * A Star Destroyer drifting bow first into a major asteroid, nobody at the
 * helm: its bow takes far more in one step than holds it together, so it is
 * shattered into debris rather than dented, and the hull behind breaks up.
 */
export function crash(seed = 20260905, speed = CRASH_SPEED): Battle {
    return makeBattle({ seed, pilots: false }, (ships, world) => {
        const rock = asteroidBlueprint("Rock", { radius: 600, kernel: true, ore: 0.3, ice: 0.2, corners: 12, rings: 3 }, new Rng(seed));
        ships.spawn(world, { design: compileBlueprint(rock), x: 2000, y: 0, team: NEUTRAL_TEAM });
        ships.spawn(world, { design: compileBlueprint(STAR_DESTROYER), x: 0, y: 0, vx: speed, team: 1 });
    });
}
