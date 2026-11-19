import { asteroidBlueprint, compileBlueprint, math, NEUTRAL_TEAM } from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import type { Battle } from "./types.js";
import { makeBattle } from "./battle.js";
import { GUNSHIP, TORPEDO_BOAT } from "./blueprints.js";

/** The rock's radius, metres. */
const ROCK_RADIUS = 800;

/**
 * A Torpedo Boat behind a big rock, building torpedoes on its pad, against a
 * Gunship on the far side whose bow gun is made for capital ships. The boat is
 * told to hide behind the rock, so the Gunship has to come round it to shoot,
 * and the torpedoes are built out of its sight and launched already close.
 */
export function torpedoBoat(seed = 20261119): Battle {
    return makeBattle({ seed, projectiles: 512, beams: 16 }, (ships, world) => {
        const rock = asteroidBlueprint(
            "Rock",
            { radius: ROCK_RADIUS, kernel: true, ore: 0.2, ice: 0.2, corners: 12, rings: 3 },
            new Rng(seed),
        );
        const cover = ships.spawn(world, { design: compileBlueprint(rock), x: 0, y: 0, team: NEUTRAL_TEAM });
        const boat = ships.spawn(world, { design: compileBlueprint(TORPEDO_BOAT), x: -ROCK_RADIUS - 80, y: 0, angle: math.PI, team: 0 });
        ships.pushFlee(boat, cover);
        ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 3000, y: 0, angle: math.PI, team: 1 });
    });
}
