import { compileBlueprint, math } from "../sim/index.js";
import type { Battle } from "./types.js";
import { CROSSING, SIDE_WELL, makeBattle } from "./battle.js";
import { RAIL_CORVETTE, RAIL_GUNSHIP } from "./blueprints.js";

/**
 * The duel with rail guns: two Rail Corvettes against a Rail Gunship, the
 * Corvette and the Gunship each with its bow gun a rail gun.
 *
 * Otherwise the duel's opening, so the two can be watched side by side.
 */
export function railDuel(seed = 20260905): Battle {
    return makeBattle({ seed, wells: [SIDE_WELL] }, (ships, world) => {
        const corvette = compileBlueprint(RAIL_CORVETTE);
        const gunship = compileBlueprint(RAIL_GUNSHIP);

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
