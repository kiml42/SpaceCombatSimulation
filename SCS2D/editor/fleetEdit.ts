import { isGroupUse, math, serialiseBlueprint, type Blueprint, type Fleet, type FleetEntry } from '../sim/index.js';

/**
 * Edits to a fleet, as pure functions from one fleet to the next — the fleet
 * editor's counterpart to `edit.ts`. Indices are into the fleet's own `ships`,
 * the things a player places; a group is moved as one.
 */

const { cos, sin } = math;

export function cloneFleet(fleet: Fleet): Fleet {
  return JSON.parse(JSON.stringify(fleet)) as Fleet;
}

export function emptyFleet(name: string): Fleet {
  return { name, designs: {}, ships: [] };
}

/**
 * Place a ship of this design, embedding a copy of it if the fleet has none of
 * that name. One it already carries is used as it is: a library copy that has
 * moved on is offered as a refresh, not slipped in.
 */
export function addShip(fleet: Fleet, blueprint: Blueprint, x: number, y: number): Fleet {
  const next = cloneFleet(fleet);
  if (next.designs[blueprint.name] === undefined) {
    next.designs[blueprint.name] = JSON.parse(JSON.stringify(blueprint)) as Blueprint;
  }
  next.ships.push({ design: blueprint.name, x, y });
  return next;
}

export function moveEntries(fleet: Fleet, indices: readonly number[], dx: number, dy: number): Fleet {
  const next = cloneFleet(fleet);
  for (const i of indices) {
    const entry = next.ships[i];
    if (entry === undefined) continue;
    entry.x += dx;
    entry.y += dy;
  }
  return next;
}

export function updateEntry(fleet: Fleet, index: number, change: (entry: FleetEntry) => FleetEntry): Fleet {
  const next = cloneFleet(fleet);
  const entry = next.ships[index];
  if (entry !== undefined) next.ships[index] = change(entry);
  return next;
}

/** Copies placed at an offset, appended in order. */
export function duplicateEntries(fleet: Fleet, indices: readonly number[], dx: number, dy: number): Fleet {
  const next = cloneFleet(fleet);
  for (const i of indices) {
    const entry = fleet.ships[i];
    if (entry === undefined) continue;
    const copy = JSON.parse(JSON.stringify(entry)) as FleetEntry;
    copy.x += dx;
    copy.y += dy;
    next.ships.push(copy);
  }
  return next;
}

/** Remove entries, and any design nothing flies any more. */
export function deleteEntries(fleet: Fleet, indices: readonly number[]): Fleet {
  const next = cloneFleet(fleet);
  next.ships = next.ships.filter((_, i) => !indices.includes(i));
  return pruneDesigns(next);
}

export interface RepeatStep {
  x: number;
  y: number;
  /** Radians. A turn walks the row round an arc. */
  angle: number;
}

/**
 * Lay an entry out as a row or an arc of `count`, each copy stepped from the
 * one before in that copy's own frame, as a repeated assembly is. Written out
 * as plain entries: the format has no repeat of its own.
 */
export function repeatEntry(fleet: Fleet, index: number, count: number, step: RepeatStep): Fleet {
  const first = fleet.ships[index];
  if (first === undefined || count < 2) return fleet;
  const next = cloneFleet(fleet);
  let x = first.x;
  let y = first.y;
  let angle = first.angle ?? 0;
  const mirrored = isGroupUse(first) && first.mirror === true;
  for (let k = 1; k < count; k++) {
    const c = cos(angle);
    const s = sin(angle);
    const stepY = mirrored ? -step.y : step.y;
    x += step.x * c - stepY * s;
    y += step.x * s + stepY * c;
    angle = foldAngle(angle + step.angle);
    const copy = JSON.parse(JSON.stringify(first)) as FleetEntry;
    copy.x = x;
    copy.y = y;
    if (angle !== 0 || first.angle !== undefined) copy.angle = angle;
    next.ships.push(copy);
  }
  return next;
}

/** Replace the embedded copy of a design with this one. */
export function refreshDesign(fleet: Fleet, blueprint: Blueprint): Fleet {
  const next = cloneFleet(fleet);
  next.designs[blueprint.name] = JSON.parse(JSON.stringify(blueprint)) as Blueprint;
  return next;
}

/** Whether the embedded copy differs from another, by what a file would say. */
export function differs(a: Blueprint, b: Blueprint): boolean {
  return JSON.stringify(serialiseBlueprint(a)) !== JSON.stringify(serialiseBlueprint(b));
}

function pruneDesigns(fleet: Fleet): Fleet {
  const used = new Set<string>();
  const visit = (entries: readonly FleetEntry[]): void => {
    for (const entry of entries) if (!isGroupUse(entry)) used.add(entry.design);
  };
  visit(fleet.ships);
  for (const group of Object.values(fleet.groups ?? {})) visit(group.ships);
  for (const name of Object.keys(fleet.designs)) if (!used.has(name)) delete fleet.designs[name];
  return fleet;
}

function foldAngle(a: number): number {
  let r = math.normalizeAngle(a);
  if (r <= -math.PI) r += math.TAU;
  else if (r > math.PI) r -= math.TAU;
  return r === 0 ? 0 : r;
}
