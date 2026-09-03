/**
 * The simulation.
 *
 * This module and everything under it is pure: no DOM, no Node APIs, no
 * renderer types, no timers, no wall clock. It runs unchanged in a browser
 * worker and in Node, which is what keeps the host swappable and evolution
 * fast (DESIGN.md non-negotiable 1, enforced by sim/tsconfig.json and
 * tests/architecture.test.ts).
 *
 * The contract with the outside world is commands in, snapshots out. Nothing
 * reaches across the boundary in either direction.
 */

export * as math from './math.js';
export { Rng, type RngState } from './rng.js';
export {
  Bodies,
  NO_BODY,
  bodyIndex,
  bodyGeneration,
  type BodyId,
  type BodySpec,
} from './bodies.js';
export { World, type ForceProvider, type WorldOptions } from './world.js';
export { gravityWell, wellPotentialEnergy, type WellSpec } from './gravity.js';
export { SpatialGrid, IndexBuffer, RayHit, segmentCircleT } from './spatialGrid.js';
export { checksumWorld, formatChecksum } from './checksum.js';
