import type { Budget, Fleet, Yard } from "../sim/index.js";
import type { SkirmishSettings } from "../scenarios/skirmish.js";
import { EnemySearch } from "./answer.js";
import { MUTATION_FIELDS } from "./mutationFields.js";

/**
 * Tuning a fleet's doctrine against an enemy that stays as it is: what a
 * skirmish's player can ask for when doctrine is hard to get right by hand
 * (SCS-164). The enemy's answer search with the sides swapped, breeding the
 * player's fleet against the enemy's until a version of it wins the round,
 * and changing nothing a ship would need rebuilt for.
 */

/**
 * The mutation odds that change only doctrine: every chance at zero but the
 * doctrine's, how far a number drifts, and the chance each design is
 * mutated at all.
 */
export const DOCTRINE_ONLY: Readonly<Record<string, number>> = Object.fromEntries(
    MUTATION_FIELDS.filter((field) => field.group !== "doctrine" && field.name !== "magnitude" && field.name !== "fleetDesign").map(
        (field) => [field.name, 0],
    ),
);

/**
 * A search for a version of `player`, its doctrine alone changed, that beats
 * `enemy` on the round's `seed` by the skirmish's margin. Advance it as the
 * enemy's answer is advanced; `progress.found` is the tuned fleet. It never
 * draws a card: the player's limits are theirs to choose.
 */
export function tuneDoctrine(
    player: Fleet,
    enemy: Fleet,
    seed: number,
    settings: SkirmishSettings,
    budget: Budget,
    /** What builds the enemy before the battle, its cards and all. */
    enemyYard?: Yard,
): EnemySearch {
    return new EnemySearch(
        enemy,
        player,
        seed,
        (seed ^ 0x74756e65) >>> 0,
        { ...settings, breeding: { ...settings.breeding, ...DOCTRINE_ONLY }, stretchAfter: Number.MAX_SAFE_INTEGER },
        budget,
        [],
        enemyYard,
    );
}
