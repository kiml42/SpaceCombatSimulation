import { compileBlueprint, math, type Blueprint } from "../sim/index.js";
import type { Battle } from "./types.js";
import { CROSSING, makeBattle } from "./battle.js";
import { BEAM_CORVETTE, CORVETTE, GUNSHIP, RAIL_CORVETTE } from "./blueprints.js";

/** The attackers a Disarm scene can be fought with, by the weapon they carry. */
export const DISARMERS: readonly { readonly name: string; readonly blueprint: Blueprint; readonly count: number }[] = [
    // Two are no match for a Gunship.
    { name: "Corvettes", blueprint: CORVETTE, count: 3 },
    { name: "Beam Corvettes", blueprint: BEAM_CORVETTE, count: 2 },
    { name: "Rail Corvettes", blueprint: RAIL_CORVETTE, count: 2 },
];

/** Where each attacker sets out, as in Duel, and a third behind the first. */
const STARTS = [
    CROSSING.west,
    { x: 2000, y: -740, angle: math.HALF_PI / 2, vx: 0, vy: 90 },
    { ...CROSSING.west, x: CROSSING.west.x - 150, y: CROSSING.west.y - 150 },
];

/**
 * Small ships told to disarm a Gunship rather than destroy it: every mount
 * aims for its guns and minds not to hit its core, engines or plating, as a
 * player wanting a ship to take whole would tell them, and none rams it.
 *
 * What it shows is how cleanly a weapon can take guns off a ship and leave the
 * rest: the Gunship's guns sit among the plating and engines the attackers
 * are sparing, so what they hit besides is the cost of asking.
 */
export function disarm(seed = 20260905, attacker: Blueprint = CORVETTE, count = 3): Battle {
    return makeBattle({ seed }, (ships, world) => {
        const design = compileBlueprint(attacker);
        const attackers = STARTS.slice(0, count).map((start) => ships.spawn(world, { design, ...start, team: 0 }));
        ships.spawn(world, { design: compileBlueprint(GUNSHIP), ...CROSSING.east, team: 1 });
        for (const i of attackers) {
            ships.setDoctrine(i, "ship", "ramRadii", 0);
            for (const part of ["main", "secondary"] as const) {
                ships.setDoctrine(i, part, "gunWeight", 100);
                ships.setDoctrine(i, part, "coreWeight", -100);
                ships.setDoctrine(i, part, "engineWeight", -100);
                ships.setDoctrine(i, part, "structureWeight", -100);
            }
        }
    });
}
