import type { World, WellSpec, Ships, Projectiles, SpatialGrid, ProjectileHits } from '../sim/index.js';

/**
 * A corvette and a gunship closing on each other and opening fire.
 *
 * **One definition, used by both the golden test and the viewer**, which is
 * the point of it being here rather than in either. The step order below is
 * load-bearing — turrets are commanded before the world advances, guns fire
 * after the index is rebuilt — and a viewer that had its own copy of that
 * order would drift from the one being pinned without anything failing. What
 * is on screen is then not what the checksum covers, which is the worst of
 * both.
 *
 * Two different designs on purpose. A duel between identical ships is
 * symmetric, and a symmetric scenario hides any error that is also symmetric.
 *
 * The opening conditions are chosen to *exercise* things rather than to be
 * tidy. Both ships start facing across the engagement rather than at each
 * other, so each has to turn before it can shoot; both carry velocity that is
 * mostly across the closing line, so holding a range band means cancelling it
 * rather than flying straight down the bearing; and a gravity well sits off to
 * one side, bending both the ships and their rounds. A head-on duel between
 * two ships at rest in empty space exercises almost none of that, and flatters
 * the gunnery besides — every shot hits when nothing is crossing.
 *
 * Plain TypeScript, no DOM and no Node: it has to run in a browser, in a test
 * and in a worker alike.
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
