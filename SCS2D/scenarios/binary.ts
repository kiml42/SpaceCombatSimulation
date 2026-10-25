import { compileBlueprint, math, type Rails, type WellSpec } from "../sim/index.js";
import type { Battle } from "./types.js";
import { CROSSING, makeBattle } from "./battle.js";
import { CORVETTE, GUNSHIP } from "./blueprints.js";

/** Two equal wells, softened as the standing side well is. */
export const BINARY_WELLS: readonly WellSpec[] = [
    { x: 0, y: 0, gm: 3e6, softening: 200 },
    { x: 0, y: 0, gm: 3e6, softening: 200 },
];

/**
 * Their orbit: 1,000 m apart at closest and 4,000 m at furthest, round in about
 * 320 s. They start at their furthest, above and below the fight, and swing in
 * through it as it is fought.
 */
export const BINARY_RAILS: Rails = {
    root: { pair: [{ well: 0 }, { well: 1 }], orbit: { a: 2500, e: 0.6, periapsis: -math.HALF_PI, phase: math.PI } },
};

/**
 * The duel's ships, crossing between two wells on an eccentric mutual orbit:
 * slow while they are far apart, fast as they pass each other, so the pull on
 * every ship and round changes through the fight.
 */
export function binary(seed = 20260905): Battle {
    return makeBattle({ seed, wells: BINARY_WELLS, rails: BINARY_RAILS }, (ships, world) => {
        ships.spawn(world, { design: compileBlueprint(CORVETTE), ...CROSSING.west, team: 0 });
        ships.spawn(world, { design: compileBlueprint(GUNSHIP), ...CROSSING.east, team: 1 });
    });
}
