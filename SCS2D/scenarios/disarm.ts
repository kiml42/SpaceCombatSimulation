import { compileBlueprint, math, type Blueprint } from "../sim/index.js";
import type { Battle } from "./types.js";
import { CROSSING, makeBattle } from "./battle.js";
import { BEAM_CORVETTE, CORVETTE, GUNSHIP, RAIL_CORVETTE } from "./blueprints.js";

/** The attackers a Disarm scene can be fought with, by the weapon they carry. */
export const DISARMERS: readonly { readonly name: string; readonly blueprint: Blueprint }[] = [
    { name: "Corvettes", blueprint: CORVETTE },
    { name: "Beam Corvettes", blueprint: BEAM_CORVETTE },
    { name: "Rail Corvettes", blueprint: RAIL_CORVETTE },
];

/**
 * Two small ships told to disarm a Gunship rather than destroy it: every mount
 * aims for its guns and minds not to hit its core, engines or plating, as a
 * player wanting a ship to take whole would tell them.
 *
 * What it shows is how cleanly a weapon can take guns off a ship and leave the
 * rest: the Gunship's guns sit among the plating and engines the attackers
 * are sparing, so what they hit besides is the cost of asking.
 */
export function disarm(seed = 20260905, attacker: Blueprint = CORVETTE): Battle {
    return makeBattle({ seed }, (ships, world) => {
        const design = compileBlueprint(attacker);
        const attackers = [
            ships.spawn(world, { design, ...CROSSING.west, team: 0 }),
            ships.spawn(world, { design, x: 2000, y: -740, angle: math.HALF_PI / 2, vx: 0, vy: 90, team: 0 }),
        ];
        ships.spawn(world, { design: compileBlueprint(GUNSHIP), ...CROSSING.east, team: 1 });
        for (const i of attackers) {
            for (const part of ["main", "secondary"] as const) {
                ships.setDoctrine(i, part, "gunWeight", 100);
                ships.setDoctrine(i, part, "coreWeight", -100);
                ships.setDoctrine(i, part, "engineWeight", -100);
                ships.setDoctrine(i, part, "structureWeight", -100);
            }
        }
    });
}
