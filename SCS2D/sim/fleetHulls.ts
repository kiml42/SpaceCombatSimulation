import { compileBlueprint, expandBlueprint, modulesOverlap, type ShipDesign } from './blueprint.js';
import { expandFleet, type Fleet, type PlacedShip } from './fleet.js';
import { cos, sin, sqrt } from './math.js';
import type { ModuleSpec } from './modules.js';

/**
 * A fleet as the hulls it puts on the field: each ship's design, where its
 * centre stands and its modules in the fleet's frame. What mass, reach and
 * overlap are measured on, for the editor and for breeding alike.
 */

export interface FleetHull {
  readonly ship: PlacedShip;
  readonly design: ShipDesign;
  /** The design's modules, turned and moved to where this ship stands. */
  readonly modules: readonly ModuleSpec[];
}

/** Every ship of a fleet, compiled. Throws if any design is not a ship. */
export function fleetHulls(fleet: Fleet): FleetHull[] {
  const compiled = new Map<string, { design: ShipDesign; modules: ModuleSpec[] }>();
  for (const [name, blueprint] of Object.entries(fleet.designs)) {
    compiled.set(name, { design: compileBlueprint(blueprint), modules: expandBlueprint(blueprint) });
  }
  return expandFleet(fleet).map((ship) => {
    const { design, modules } = compiled.get(ship.design)!;
    return { ship, design, modules: placeModules(modules, ship) };
  });
}

/** A design's modules, turned and moved to where this ship stands. */
export function placeModules(modules: readonly ModuleSpec[], ship: PlacedShip): ModuleSpec[] {
  const c = cos(ship.angle);
  const s = sin(ship.angle);
  return modules.map((m) => ({
    ...m,
    x: ship.x + m.x * c - m.y * s,
    y: ship.y + m.x * s + m.y * c,
    angle: (m.angle ?? 0) + ship.angle,
  }));
}

/** Where a ship's centre of mass stands in the fleet's frame. */
export function centreOf(ship: PlacedShip, design: ShipDesign): { x: number; y: number } {
  const c = cos(ship.angle);
  const s = sin(ship.angle);
  return {
    x: ship.x + design.centreOfMassX * c - design.centreOfMassY * s,
    y: ship.y + design.centreOfMassX * s + design.centreOfMassY * c,
  };
}

/** Whether two placed hulls run into each other: bounding circles first, then module by module. */
export function hullsOverlap(
  a: PlacedShip,
  da: ShipDesign,
  ma: readonly ModuleSpec[],
  b: PlacedShip,
  db: ShipDesign,
  mb: readonly ModuleSpec[],
): boolean {
  const ca = centreOf(a, da);
  const cb = centreOf(b, db);
  const dx = ca.x - cb.x;
  const dy = ca.y - cb.y;
  if (sqrt(dx * dx + dy * dy) >= da.radius + db.radius) return false;
  for (const x of ma) for (const y of mb) if (modulesOverlap(x, y)) return true;
  return false;
}

/** The first pair of ships whose hulls overlap, or null. */
export function firstOverlap(hulls: readonly FleetHull[]): readonly [number, number] | null {
  for (let i = 0; i < hulls.length; i++) {
    for (let k = i + 1; k < hulls.length; k++) {
      const a = hulls[i]!;
      const b = hulls[k]!;
      if (hullsOverlap(a.ship, a.design, a.modules, b.ship, b.design, b.modules)) return [i, k];
    }
  }
  return null;
}

/** Total dry mass, kg. */
export function fleetMass(hulls: readonly FleetHull[]): number {
  let mass = 0;
  for (const hull of hulls) mass += hull.design.mass;
  return mass;
}

/** How far from the fleet's origin its furthest hull reaches, metres. */
export function fleetReach(hulls: readonly FleetHull[]): number {
  let reach = 0;
  for (const { ship, design } of hulls) {
    const centre = centreOf(ship, design);
    const out = sqrt(centre.x * centre.x + centre.y * centre.y) + design.radius;
    if (out > reach) reach = out;
  }
  return reach;
}
