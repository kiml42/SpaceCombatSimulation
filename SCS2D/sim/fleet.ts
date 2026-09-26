import { cos, normalizeAngle, PI, sin, TAU } from './math.js';
import type { Blueprint } from './blueprint.js';

/**
 * A fleet: which ships, and where they stand relative to each other.
 *
 * Positions are in the fleet's own frame, +x forward, so the same fleet can be
 * set down anywhere facing anything. Velocity is not part of it — how fast a
 * fleet arrives is the battle's business, not the fleet's.
 *
 * Designs are **embedded**, not referenced: a fleet file is the whole of what
 * it takes to fight it, and editing a ship in the library cannot quietly
 * change a fleet built from it. See DECISIONS.md.
 */
export interface Fleet {
  name: string;
  notes?: string;
  /** By name. Every ship entry names one of these. */
  designs: Record<string, Blueprint>;
  groups?: Record<string, FleetGroup>;
  ships: FleetEntry[];
}

/** A named formation, placed as a unit and flattened away on load. */
export interface FleetGroup {
  ships: FleetEntry[];
  notes?: string;
}

/** What every entry has: where it stands, and how many copies of it stand in a row. */
interface Placed {
  x: number;
  y: number;
  /** Radians here, degrees in the file. */
  angle?: number;
  /** Copies in a row or an arc, one `step` apart. One when absent. */
  repeat?: number;
  /** From each copy to the next, in that copy's own frame, as an assembly's step is. */
  step?: FleetStep;
  notes?: string;
}

export interface FleetStep {
  x: number;
  y: number;
  /** Radians. A turn walks the row round an arc. */
  angle?: number;
}

export interface FleetShip extends Placed {
  design: string;
}

export interface FleetGroupUse extends Placed {
  group: string;
  /** Reflect across the group's own x-axis: positions and headings, not designs. */
  mirror?: boolean;
}

export type FleetEntry = FleetShip | FleetGroupUse;

export function isGroupUse(entry: FleetEntry): entry is FleetGroupUse {
  return 'group' in entry;
}

/** One ship of a flattened fleet, in the fleet's frame. */
export interface PlacedShip {
  design: string;
  x: number;
  y: number;
  angle: number;
  /**
   * Which ship this is, by name rather than position: `Fighter Wing#2/Dinky#1`
   * is the first Dinky in the second Fighter Wing. Counted among siblings of
   * the same name, so adding a Gunship does not rename every Dinky.
   */
  path: string;
  /** Which of the fleet's own `ships` it came from. */
  entry: number;
  /** How it was reached, outermost first; the last step is the ship's own entry. */
  trail: readonly TrailStep[];
}

/** One level of how a flattened ship was reached: which entry, which copy, and where. */
export interface TrailStep {
  /** Into the list this level is written in: the fleet's `ships` or a group's. */
  index: number;
  copy: number;
  /** Where this copy of the entry stands and faces, in the fleet's frame. */
  x: number;
  y: number;
  angle: number;
  /** The frame the entry is written in, which an edit to it must be expressed in. */
  rotation: number;
  mirrored: boolean;
}

export const MAX_GROUP_DEPTH = 8;
export const MAX_FLEET_SHIPS = 512;
export const MAX_FLEET_REPEAT = 64;

/**
 * The fleet as the plain list of ships a battle spawns.
 *
 * Throws on an unknown design or group, a group that contains itself, or a
 * fleet too large to fight. `fleetProblem` asks the same without throwing.
 */
export function expandFleet(fleet: Fleet): PlacedShip[] {
  const out: PlacedShip[] = [];
  place(fleet, fleet.ships, 0, 0, 0, false, [], '', out, []);
  return out;
}

/** What stops a fleet expanding, or null. Unused groups are checked too. */
export function fleetProblem(fleet: Fleet): string | null {
  try {
    expandFleet(fleet);
    for (const group of Object.keys(fleet.groups ?? {})) {
      expandFleet({ ...fleet, ships: [{ group, x: 0, y: 0 }] });
    }
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

function place(
  fleet: Fleet,
  entries: readonly FleetEntry[],
  originX: number,
  originY: number,
  rotation: number,
  mirrored: boolean,
  within: string[],
  prefix: string,
  out: PlacedShip[],
  trail: TrailStep[],
): void {
  const [c, s] = exactTurn(rotation);
  const seen = new Map<string, number>();

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    // Reflect, then turn, then move, as assemblies are placed.
    const localY = mirrored ? -entry.y : entry.y;
    let x = originX + entry.x * c - localY * s;
    let y = originY + entry.x * s + localY * c;
    const own = entry.angle ?? 0;
    let angle = foldAngle(rotation + (mirrored ? -own : own));
    const flipped = isGroupUse(entry) ? mirrored !== (entry.mirror ?? false) : mirrored;
    const name = isGroupUse(entry) ? entry.group : entry.design;

    const copies = entry.repeat ?? 1;
    if (copies > MAX_FLEET_REPEAT) throw new Error(`${fleet.name}: ${name} asks for ${copies} copies, more than ${MAX_FLEET_REPEAT}`);

    for (let copy = 0; copy < copies; copy++) {
      const count = (seen.get(name) ?? 0) + 1;
      seen.set(name, count);
      const path = `${prefix}${name}#${count}`;
      trail.push({ index, copy, x, y, angle, rotation, mirrored });

      if (!isGroupUse(entry)) {
        if (fleet.designs[entry.design] === undefined) {
          throw new Error(`${fleet.name}: no design named ${entry.design}`);
        }
        out.push({ design: entry.design, x, y, angle, path, entry: trail[0]!.index, trail: [...trail] });
        if (out.length > MAX_FLEET_SHIPS) {
          throw new Error(`${fleet.name}: more than ${MAX_FLEET_SHIPS} ships`);
        }
      } else {
        const group = fleet.groups?.[entry.group];
        if (group === undefined) throw new Error(`${fleet.name}: no group named ${entry.group}`);
        if (within.includes(entry.group)) {
          throw new Error(`${fleet.name}: group ${entry.group} contains itself (${[...within, entry.group].join(' → ')})`);
        }
        if (within.length >= MAX_GROUP_DEPTH) {
          throw new Error(`${fleet.name}: groups nested more than ${MAX_GROUP_DEPTH} deep`);
        }
        within.push(entry.group);
        place(fleet, group.ships, x, y, angle, flipped, within, `${path}/`, out, trail);
        within.pop();
      }
      trail.pop();

      const step = entry.step;
      if (step === undefined || copy + 1 >= copies) continue;
      const [sc, ss] = exactTurn(angle);
      const stepY = flipped ? -step.y : step.y;
      const stepAngle = step.angle ?? 0;
      x += step.x * sc - stepY * ss;
      y += step.x * ss + stepY * sc;
      angle = foldAngle(angle + (flipped ? -stepAngle : stepAngle));
    }
  }
}

/**
 * `cos` and `sin`, exact on the axes.
 *
 * `sin(PI)` is 1.2e-16, not 0, which would nudge every ship of a fleet turned
 * to face west off where the same fleet written out by hand stands.
 */
export function exactTurn(angle: number): readonly [number, number] {
  if (angle === 0) return [1, 0];
  if (angle === PI || angle === -PI) return [-1, 0];
  if (angle === PI / 2) return [0, 1];
  if (angle === -PI / 2) return [0, -1];
  return [cos(angle), sin(angle)];
}

function foldAngle(a: number): number {
  let r = normalizeAngle(a);
  if (r <= -PI) r += TAU;
  else if (r > PI) r -= TAU;
  return r === 0 ? 0 : r;
}
