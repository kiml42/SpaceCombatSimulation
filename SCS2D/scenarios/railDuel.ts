import { compileBlueprint, math } from "../sim/index.js";
import type { Battle } from "./types.js";
import { CROSSING, SIDE_WELL, makeBattle } from "./battle.js";
import { GUNSHIP, RAIL_CORVETTE } from "./blueprints.js";

/**
 * The duel with rail guns: two Rail Corvettes, the Corvette with its bow gun a
 * rail gun, against the Gunship's powder guns.
 *
 * Otherwise the duel's opening, so the two can be watched side by side: what a
 * faster round on power does against the same ship from the same start.
 */
export function railDuel(seed = 20260905): Battle {
    return makeBattle({ seed, wells: [SIDE_WELL] }, (ships, world) => {
        const corvette = compileBlueprint(RAIL_CORVETTE);
        const gunship = compileBlueprint(GUNSHIP);

        ships.spawn(world, { design: corvette, ...CROSSING.west, team: 0 });
        ships.spawn(world, {
            design: corvette,
            x: 2000,
            y: -740,
            angle: math.HALF_PI / 2,
            vx: 0,
            vy: 90,
            team: 0,
        });
        ships.spawn(world, { design: gunship, ...CROSSING.east, team: 1 });
    });
}
