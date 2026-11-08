import { compileBlueprint, math } from "../sim/index.js";
import type { Battle } from "./types.js";
import { SIDE_WELL, makeBattle } from "./battle.js";
import { LANCE_CORVETTE, LANCE_GUNSHIP } from "./blueprints.js";

/**
 * The duel with plasma lances: two Lance Corvettes, which charge only once
 * they are on target, against a Lance Gunship kept charged and ready.
 *
 * Head on and at rest, 1.2 km apart, rather than the duel's crossing: a lance
 * is aimed by its hull and fights only up close, so it is set going toward its
 * fight rather than past it.
 */
export function lanceDuel(seed = 20260905): Battle {
    return makeBattle({ seed, wells: [SIDE_WELL] }, (ships, world) => {
        const corvette = compileBlueprint(LANCE_CORVETTE);
        const gunship = compileBlueprint(LANCE_GUNSHIP);

        ships.spawn(world, { design: corvette, x: -600, y: -80, angle: 0, team: 0 });
        ships.spawn(world, { design: corvette, x: -600, y: 80, angle: 0, team: 0 });
        ships.spawn(world, { design: gunship, x: 600, y: 0, angle: math.PI, team: 1 });
    });
}
