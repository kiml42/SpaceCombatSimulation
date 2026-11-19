import { asteroidBlueprint, compileBlueprint, math, NEUTRAL_TEAM } from "../sim/index.js";
import { OrderCancelCondition } from "../sim/ships.js";
import { Rng } from "../sim/rng.js";
import type { Battle } from "./types.js";
import { makeBattle } from "./battle.js";
import { GUNSHIP, TORPEDO_BOAT } from "./blueprints.js";

/** The rock's radius, metres. */
const ROCK_RADIUS = 800;

/**
 * A Torpedo Boat behind a big rock, building torpedoes on its pad, against a
 * Gunship on the far side whose bow gun is made for capital ships. The Gunship
 * is ordered to attack the boat, so it does not chase the torpedoes instead.
 * The boat is told to hide behind the rock, so the Gunship has to come round
 * it to shoot, and the torpedoes are built out of its sight. It starts where
 * hiding puts it, so it does not burn for there at once.
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
        // Where `hide` holds it: this far from the rock's centre, on the side away from the Gunship.
        const hidden = (rockDesign.radius + boatDesign.radius) * (1 + boatDesign.doctrine.approach.separationRadii);
        const cover = ships.spawn(world, { design: rockDesign, x: 0, y: 0, team: NEUTRAL_TEAM });
        const boat = ships.spawn(world, { design: boatDesign, x: -hidden, y: 0, angle: math.PI, team: 0 });
        ships.pushFlee(boat, cover);
        const gunship = ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 3000, y: 0, angle: math.PI, team: 1 });
        // After the boat, not its torpedoes: its turrets still pick their own targets.
        ships.pushAttack(gunship, boat, OrderCancelCondition.CompletelyDead);
    });
}
