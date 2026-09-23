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
export { gravityWell, wellPull, wellPotentialEnergy, type WellSpec } from './gravity.js';
export { SpatialGrid, IndexBuffer, RayHit, segmentCircleT, type RayNarrowPhase } from './spatialGrid.js';
export {
  Projectiles,
  ProjectileHits,
  NO_OWNER,
  type ProjectileSpec,
} from './projectiles.js';
export {
  Beams,
  BeamHits,
  type BeamSpec,
} from './beams.js';
export {
  ThrusterLayout,
  Allocation,
  applyAllocation,
  shortfall,
  type ThrusterSpec,
} from './thrusters.js';
export {
  DECK_HEIGHT,
  gunStats,
  beamGunStats,
  moduleCentre,
  moduleProblem,
  moduleStats,
  traverseAccel,
  traverseRate,
  TRAVERSE_SPINUP_TIME,
  type GunStats,
  type ModuleKind,
  type ModuleSpec,
  type ModuleStats,
} from './modules.js';
export { HullPath, Hulls, modulesAlong, type HullDesigns } from './hull.js';
export {
  PLUME_POWER_PER_NEWTON,
  PLUME_THRUST_PER_AREA,
  Plumes,
  WEAPON_PLUME_SHARE,
  plumeReach,
} from './exhaust.js';
export {
  DEFAULT_DOCTRINE,
  APPROACH_FIELDS,
  DOCTRINE_FIELDS,
  TARGETING_FIELDS,
  doctrineProblem,
  resolveTargeting,
  serialiseDoctrine,
  serialiseTargeting,
  targetingProblem,
  toDoctrine,
  type Approach,
  type Doctrine,
  type Targeting,
} from './doctrine.js';
export {
  Choice,
  look,
  score,
  type Candidate,
} from './targeting.js';
export {
  JOINT_IMPULSE_PER_AREA,
  cuts,
  components,
  joints,
  type Cut,
  type Joint,
} from './connectivity.js';
export {
  Collisions,
  Contacts,
  RESTITUTION,
  findContacts,
  resolveContacts,
} from './collision.js';
export {
  ATTACHMENT_TOLERANCE,
  assemblyProblem,
  blueprintFaults,
  blueprintProblem,
  blueprintProblems,
  compileBlueprint,
  compileDraft,
  expandBlueprint,
  expandWithOrigins,
  firingArc,
  MAX_EXPANDED_MODULES,
  MAX_REPEAT,
  isInstance,
  modulesOverlap,
  placementAt,
  samePlacement,
  subDesign,
  type Assembly,
  type AssemblyInstance,
  type AssemblyStep,
  type Blueprint,
  type BlueprintFault,
  type Expansion,
  type Frame,
  type ModuleOrigin,
  type ModulePath,
  type PathStep,
  type Placement,
  type DesignModule,
  type DesignTurret,
  type ShipDesign,
} from './blueprint.js';
export {
  BLUEPRINT_FORMAT_VERSION,
  blueprintFileProblem,
  degreesToRadians,
  parseBlueprint,
  radiansToDegrees,
  serialiseBlueprint,
} from './blueprintFile.js';
export {
  Turrets,
  FiringSolution,
  interceptTime,
  type TurretSpec,
} from './turrets.js';
export {
  Ships,
  NO_TARGET,
  type Order,
  type ShipSpec,
} from './ships.js';
export { capture, Snapshot, type ShipView } from './snapshot.js';
export {
  DE_MARRE_K,
  RICOCHET_ANGLE,
  Terminal,
  deflected,
  incidenceAngle,
  strike,
  type Strike,
} from './ballistics.js';
export {
  DAMAGE_ENERGY_PER_KG,
  DAMAGE_RESPONSES,
  Damage,
  DamageEffect,
  IMPACT_BEAM,
  IMPACT_COLLISION,
  IMPACT_ROUND,
  ImpactLog,
  Impacts,
  resolveCollision,
  resolveRound,
  type DamageResponse,
  type RoundOutcome,
  type Shocked,
} from './damage.js';
export {
  checksumWorld,
  checksumProjectiles,
  checksumBeams,
  checksumDamage,
  formatChecksum,
} from './checksum.js';
