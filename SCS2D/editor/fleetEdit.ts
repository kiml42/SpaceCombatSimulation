import { isGroupUse, serialiseBlueprint, type Blueprint, type Fleet, type FleetEntry } from '../sim/index.js';

/**
 * Edits to a fleet, as pure functions from one fleet to the next — the fleet
 * editor's counterpart to `edit.ts`. Indices are into the fleet's own `ships`,
 * the things a player places; a group is moved as one.
 */

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

/**
 * Where an entry is written: indices from the fleet's own `ships` down through
 * the groups it is in. The last names the entry; the ones before, the group
 * uses that lead to it.
 */
export type EntryPath = readonly number[];

export function samePath(a: EntryPath, b: EntryPath): boolean {
  return a.length === b.length && a.every((index, i) => index === b[i]);
}

/** Whether `inner` is `outer` or written somewhere inside it. */
export function isWithin(inner: EntryPath, outer: EntryPath): boolean {
  return outer.length <= inner.length && outer.every((index, i) => index === inner[i]);
}

/** The list a path's last index is into, in the fleet given, or null. */
function listOf(fleet: Fleet, path: EntryPath): FleetEntry[] | null {
  let list = fleet.ships;
  for (let depth = 0; depth < path.length - 1; depth++) {
    const entry = list[path[depth]!];
    if (entry === undefined || !isGroupUse(entry)) return null;
    const group = fleet.groups?.[entry.group];
    if (group === undefined) return null;
    list = group.ships;
  }
  return list;
}

export function entryAt(fleet: Fleet, path: EntryPath): FleetEntry | null {
  if (path.length === 0) return null;
  return listOf(fleet, path)?.[path[path.length - 1]!] ?? null;
}

/**
 * Change one entry. An entry inside a group is the group's, so every use of
 * that group changes with it, as a shared part does in a ship.
 */
export function updateEntry(fleet: Fleet, path: EntryPath, change: (entry: FleetEntry) => FleetEntry): Fleet {
  const next = cloneFleet(fleet);
  const list = listOf(next, path);
  const index = path[path.length - 1]!;
  if (list !== null && list[index] !== undefined) list[index] = change(list[index]);
  return next;
}

/** Move entries, each by a displacement already in the frame it is written in. */
export function moveEntries(fleet: Fleet, moves: readonly { path: EntryPath; dx: number; dy: number }[]): Fleet {
  let next = fleet;
  for (const { path, dx, dy } of moves) next = updateEntry(next, path, (e) => ({ ...e, x: e.x + dx, y: e.y + dy }));
  return next;
}

/** A copy of each entry beside it in its own list, offset in that list's frame. Returns the copies' paths too. */
export function duplicateEntries(
  fleet: Fleet,
  paths: readonly EntryPath[],
  dx: number,
  dy: number,
): { fleet: Fleet; paths: EntryPath[] } {
  const next = cloneFleet(fleet);
  const out: EntryPath[] = [];
  for (const path of paths) {
    const list = listOf(next, path);
    const entry = entryAt(fleet, path);
    if (list === null || entry === null) continue;
    const copy = JSON.parse(JSON.stringify(entry)) as FleetEntry;
    copy.x += dx;
    copy.y += dy;
    list.push(copy);
    out.push([...path.slice(0, -1), list.length - 1]);
  }
  return { fleet: next, paths: out };
}

/** Remove entries, and any design nothing flies any more. */
export function deleteEntries(fleet: Fleet, paths: readonly EntryPath[]): Fleet {
  const next = cloneFleet(fleet);
  // Latest first, so an earlier removal cannot shift a later index.
  const ordered = [...paths].sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return b[i]! - a[i]!;
    return b.length - a.length;
  });
  for (const path of ordered) {
    const list = listOf(next, path);
    if (list !== null) list.splice(path[path.length - 1]!, 1);
  }
  return pruneDesigns(next);
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
