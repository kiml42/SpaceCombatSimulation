import { asteroidBlueprint, compileBlueprint, hidingDistance, math, NEUTRAL_TEAM } from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import type { Battle } from "./types.js";
import { makeBattle } from "./battle.js";
import { GUNSHIP, TORPEDO_BOAT } from "./blueprints.js";

/** The rock's radius, metres. */
const ROCK_RADIUS = 800;

/**
 * A Torpedo Boat behind a big rock, building torpedoes on its pad, against a
 * Gunship on the far side whose bow gun is made for capital ships. Its doctrine
 * would sooner fight the boat than the torpedoes on size, and counts the boat
 * being behind the rock against it by only its own small `sightWeight`.
 * The boat has no gun, so its doctrine has it hide behind the rock, and the
 * Gunship has to come round it to shoot; the torpedoes are built out of its
 * sight. It starts where hiding puts it, so it does not burn for there at once.
 */
export function torpedoBoat(seed = 20260905): Battle {
    return makeBattle({ seed, projectiles: 512, beams: 16 }, (ships, world) => {
        const rock = asteroidBlueprint(
            "Rock",
            { radius: ROCK_RADIUS, kernel: true, ore: 0.2, ice: 0.2, corners: 12, rings: 3 },
            new Rng(seed),
        );
        const rockDesign = compileBlueprint(rock);
        const boatDesign = compileBlueprint(TORPEDO_BOAT);
        // Where hiding holds it, on the side away from the Gunship.
        const hidden = hidingDistance(boatDesign.radius, rockDesign.radius, boatDesign.doctrine.approach.separationRadii);
        ships.spawn(world, { design: rockDesign, x: 0, y: 0, team: NEUTRAL_TEAM });
        ships.spawn(world, { design: boatDesign, x: -hidden, y: 0, angle: math.PI, team: 0 });
        ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 3000, y: 0, angle: math.PI, team: 1 });
    });
}
