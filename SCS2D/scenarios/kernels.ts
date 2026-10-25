import { bareKernel, compileBlueprint, kernelOutline, math, NEUTRAL_TEAM, type Rails, type WellSpec } from "../sim/index.js";
import type { Battle } from "./types.js";
import { CROSSING, makeBattle } from "./battle.js";
import { CORVETTE, GUNSHIP } from "./blueprints.js";

/** Two equal wells, a little lighter than the Binary's, each the heart of an asteroid. */
export const KERNEL_WELLS: readonly WellSpec[] = [
    { x: 0, y: 0, gm: 1.5e6, softening: 150 },
    { x: 0, y: 0, gm: 1.5e6, softening: 150 },
];

/** As the Binary's: furthest apart above and below the fight, swinging in through it. */
export const KERNEL_RAILS: Rails = {
    root: { pair: [{ well: 0 }, { well: 1 }], orbit: { a: 2500, e: 0.6, periapsis: -math.HALF_PI, phase: math.PI } },
};

/** Two lumpy kernels, each convex. */
const KERNELS = [kernelOutline(140, [1, 0.9, 1.05, 0.95, 1, 0.85, 1.1, 0.95]), kernelOutline(110, [1, 1.1, 0.9, 1, 0.95, 1.05, 0.9])];

/**
 * The duel's ships between two bare asteroid kernels on an eccentric mutual
 * orbit, each pinned to its well and turning freely: rounds and ships that
 * meet one stop against it, and nothing they do moves it off its rail.
 */
export function kernels(seed = 20260905): Battle & { readonly asteroids: readonly number[] } {
    return makeBattle({ seed, wells: KERNEL_WELLS, rails: KERNEL_RAILS }, (ships, world, wells) => {
        const asteroids = KERNELS.map((outline, k) =>
            ships.spawn(world, {
                design: compileBlueprint(bareKernel(`Kernel ${k + 1}`, outline)),
                rides: wells[k]!,
                team: NEUTRAL_TEAM,
                angularVel: 0.02 * (k === 0 ? 1 : -1),
            }),
        );
        ships.spawn(world, { design: compileBlueprint(CORVETTE), ...CROSSING.west, team: 0 });
        ships.spawn(world, { design: compileBlueprint(GUNSHIP), ...CROSSING.east, team: 1 });
        return { asteroids };
    });
}
