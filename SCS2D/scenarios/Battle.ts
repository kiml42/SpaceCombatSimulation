import type { World, WellSpec, Ships, Projectiles, SpatialGrid, ProjectileHits } from '../sim/index.js';

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
