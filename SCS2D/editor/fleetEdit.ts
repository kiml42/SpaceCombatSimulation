import { exactTurn, isGroupUse, serialiseBlueprint, type Blueprint, type Fleet, type FleetEntry } from '../sim/index.js';

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

/**
 * Fly a different design from the same place, facing the same way. The new
 * design is embedded as `addShip` does it, and one nothing flies any more is
 * dropped. A group is not a ship, so a group use is left as it is.
 */
export function swapDesign(fleet: Fleet, paths: readonly EntryPath[], blueprint: Blueprint): Fleet {
  let next = cloneFleet(fleet);
  if (next.designs[blueprint.name] === undefined) {
    next.designs[blueprint.name] = JSON.parse(JSON.stringify(blueprint)) as Blueprint;
  }
  for (const path of paths) {
    next = updateEntry(next, path, (entry) => (isGroupUse(entry) ? entry : { ...entry, design: blueprint.name }));
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

/** `Group`, `Group 2`, … — the first name the fleet has no group by. */
function freeGroupName(fleet: Fleet, stem = 'Group'): string {
  if (fleet.groups?.[stem] === undefined) return stem;
  for (let n = 2; ; n++) if (fleet.groups[`${stem} ${n}`] === undefined) return `${stem} ${n}`;
}

/**
 * Make a group of entries written in one list, placed where they stood: the
 * group's origin at their middle, each written about it. Null unless every
 * path is in the same list. Returns the new group use's path.
 */
export function makeGroup(fleet: Fleet, paths: readonly EntryPath[]): { fleet: Fleet; path: EntryPath } | null {
  if (paths.length === 0) return null;
  const parent = paths[0]!.slice(0, -1);
  if (!paths.every((path) => path.length === parent.length + 1 && isWithin(path, parent))) return null;
  const next = cloneFleet(fleet);
  const list = listOf(next, paths[0]!);
  if (list === null) return null;
  const indices = [...new Set(paths.map((path) => path[path.length - 1]!))].sort((a, b) => a - b);
  const entries = indices.map((index) => list[index]).filter((entry): entry is FleetEntry => entry !== undefined);
  if (entries.length !== indices.length) return null;
  const cx = entries.reduce((sum, entry) => sum + entry.x, 0) / entries.length;
  const cy = entries.reduce((sum, entry) => sum + entry.y, 0) / entries.length;
  const name = freeGroupName(next);
  (next.groups ??= {})[name] = { ships: entries.map((entry) => ({ ...entry, x: entry.x - cx, y: entry.y - cy })) };
  // In place of the first of them, so the rest of the list keeps its order.
  for (let k = indices.length - 1; k > 0; k--) list.splice(indices[k]!, 1);
  list[indices[0]!] = { group: name, x: cx, y: cy };
  return { fleet: next, path: [...parent, indices[0]!] };
}

/**
 * Put a group use's ships and groups back into the list it is in, where they
 * stood — every copy of a repeated use — and drop the group if nothing else
 * uses it. Null unless the path is a group use.
 */
export function dissolveGroup(fleet: Fleet, path: EntryPath): { fleet: Fleet; paths: EntryPath[] } | null {
  const use = entryAt(fleet, path);
  if (use === null || !isGroupUse(use)) return null;
  const group = fleet.groups?.[use.group];
  if (group === undefined) return null;
  const flipped = use.mirror ?? false;
  const out: FleetEntry[] = [];
  let x = use.x;
  let y = use.y;
  let angle = use.angle ?? 0;
  for (let copy = 0; copy < (use.repeat ?? 1); copy++) {
    // As the fleet is expanded: reflect, then turn, then move.
    const [c, s] = exactTurn(angle);
    for (const inner of group.ships) {
      const entry = JSON.parse(JSON.stringify(inner)) as FleetEntry;
      const localY = flipped ? -inner.y : inner.y;
      entry.x = x + inner.x * c - localY * s;
      entry.y = y + inner.x * s + localY * c;
      const turned = foldAngle(angle + (flipped ? -(inner.angle ?? 0) : (inner.angle ?? 0)));
      if (turned === 0) delete entry.angle;
      else entry.angle = turned;
      if (isGroupUse(entry)) {
        // What was reflected by the use it was in is now reflected by itself.
        if (flipped !== (entry.mirror ?? false)) entry.mirror = true;
        else delete entry.mirror;
      } else if (flipped && entry.step !== undefined) {
        // A ship's row was walked in the reflected frame; written unreflected, it walks the mirror of it.
        entry.step = { ...entry.step, y: -entry.step.y, ...(entry.step.angle === undefined ? {} : { angle: -entry.step.angle }) };
      }
      out.push(entry);
    }
    const step = use.step;
    if (step === undefined) continue;
    const [sc, ss] = exactTurn(angle);
    const stepY = flipped ? -step.y : step.y;
    x += step.x * sc - stepY * ss;
    y += step.x * ss + stepY * sc;
    angle = foldAngle(angle + (flipped ? -(step.angle ?? 0) : (step.angle ?? 0)));
  }
  const next = cloneFleet(fleet);
  const list = listOf(next, path)!;
  const at = path[path.length - 1]!;
  list.splice(at, 1, ...out);
  if (groupUses(next, use.group) === 0) delete next.groups![use.group];
  if (next.groups !== undefined && Object.keys(next.groups).length === 0) delete next.groups;
  return { fleet: next, paths: out.map((_, k) => [...path.slice(0, -1), at + k]) };
}

/** Give a group another name, in its definition and every use of it. Null if the name is taken or blank. */
export function renameGroup(fleet: Fleet, from: string, to: string): Fleet | null {
  const name = to.trim();
  if (name === '' || fleet.groups?.[from] === undefined || (name !== from && fleet.groups[name] !== undefined)) return null;
  if (name === from) return fleet;
  const next = cloneFleet(fleet);
  const groups: NonNullable<Fleet['groups']> = {};
  for (const [key, group] of Object.entries(next.groups!)) groups[key === from ? name : key] = group;
  next.groups = groups;
  const repoint = (entries: FleetEntry[]): void => {
    for (const entry of entries) if (isGroupUse(entry) && entry.group === from) entry.group = name;
  };
  repoint(next.ships);
  for (const group of Object.values(groups)) repoint(group.ships);
  return next;
}

function groupUses(fleet: Fleet, name: string): number {
  let count = 0;
  const visit = (entries: readonly FleetEntry[]): void => {
    for (const entry of entries) if (isGroupUse(entry) && entry.group === name) count++;
  };
  visit(fleet.ships);
  for (const group of Object.values(fleet.groups ?? {})) visit(group.ships);
  return count;
}

/** Into (-π, π], as the fleet's own expansion folds a heading. */
function foldAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}
