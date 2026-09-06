import type { World, WellSpec, Ships, Projectiles, SpatialGrid, ProjectileHits } from '../sim/index.js';

/**
 * The shapes every scenario in this directory implements. No scenario of its
 * own lives here — which is why the file is named for what it holds rather
 * than for a battle, since `battle.ts` would sooner or later collide with an
 * actual battle.
 */

/**
 * A scenario, ready to run: the simulation it is composed of, and one step of
 * it.
 *
 * The value of a shared shape is that nothing driving a scenario has to know
 * which one it has. The viewer switches between them, and the golden fixtures
 * wrap them, both through this alone — so a new scenario is picked up by both
 * without either being touched.
 *
 * `step` carries the load-bearing part. Turrets are commanded before the world
 * advances and guns fire after the index is rebuilt, and a caller that had its
 * own copy of that order would drift from the one being checksummed without
 * anything failing. Implement it once per scenario and hand it over.
 */
export interface Battle {
  readonly dt: number;
  readonly world: World;
  /** Wells acting on the battle. Rounds curve through them as the ships do. */
  readonly wells: readonly WellSpec[];
  readonly ships: Ships;
  readonly projectiles: Projectiles;
  readonly grid: SpatialGrid;
  readonly hits: ProjectileHits;
  /** Cumulative, so a duel that stops shooting or stops hitting is detectable. */
  totalFired: number;
  totalHits: number;
  step(): void;
}
