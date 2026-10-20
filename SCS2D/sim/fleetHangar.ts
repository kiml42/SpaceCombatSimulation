import { isInstance, settleIds, type Blueprint, type Placement } from './blueprint.js';
import { serialiseBlueprint } from './blueprintFile.js';
import type { Fleet } from './fleet.js';

/**
 * A carrier's fighters in a fleet. In a fleet a pad's fighter is the fleet's
 * design of that name, so a fighter flown from the start and one a carrier
 * builds are one design; a design's own `hangar` is the portable copy, for a
 * carrier on its own. A carrier joining a fleet gives up its hangar: what the
 * fleet lacks is lifted into it, and what the fleet has differently stays
 * behind in the hangar as a clash to be settled (`hangarClashes`).
 */

/** The fighters a blueprint's pads name, in its layout and its assemblies, each once. */
export function padFighterNames(blueprint: Blueprint): string[] {
  const names = new Set<string>();
  const walk = (list: readonly Placement[]): void => {
    for (const p of list) if (!isInstance(p) && p.craft !== undefined) names.add(p.craft);
  };
  walk(blueprint.modules);
  for (const assembly of Object.values(blueprint.assemblies ?? {})) walk(assembly.modules);
  return [...names];
}

/** A design with every fighter its pads name that `designs` has, in its hangar: as it flies in their fleet. */
export function withFleetFighters(blueprint: Blueprint, designs: Readonly<Record<string, Blueprint>>): Blueprint {
  const names = padFighterNames(blueprint).filter((name) => designs[name] !== undefined);
  if (names.length === 0) return blueprint;
  const hangar: Record<string, Blueprint> = { ...blueprint.hangar };
  for (const name of names) hangar[name] = designs[name]!;
  return { ...blueprint, hangar };
}

/** Fleet `fleet`'s design `name`, as it flies there. */
export function fleetBlueprint(fleet: Fleet, name: string): Blueprint {
  return withFleetFighters(fleet.designs[name]!, fleet.designs);
}

/** Whether two blueprints say the same thing, their hangars' fighters in whatever order. */
export function sameBlueprint(a: Blueprint, b: Blueprint): boolean {
  return canonical(a) === canonical(b);
}

function canonical(blueprint: Blueprint): string {
  // Ids settled first: a copy written before placements had them is the same design given them.
  const raw = serialiseBlueprint(settleIds(blueprint));
  const hangar = raw['hangar'] as Record<string, unknown> | undefined;
  if (hangar !== undefined)
    raw['hangar'] = Object.fromEntries(
      Object.keys(hangar)
        .sort()
        .map((k) => [k, hangar[k]]),
    );
  return JSON.stringify(raw);
}

/**
 * The fleet with every design's hangar given up to it: a fighter the fleet
 * lacks lifted in under its name, one it has the same dropped, and one it has
 * differently left in the hangar, a clash. Unchanged where nothing changes.
 */
export function joinHangars(fleet: Fleet): Fleet {
  let designs: Record<string, Blueprint> | null = null;
  const all = (): Record<string, Blueprint> => (designs ??= { ...fleet.designs });
  for (const [name, blueprint] of Object.entries(fleet.designs)) {
    const hangar = blueprint.hangar;
    if (hangar === undefined) continue;
    const kept: Record<string, Blueprint> = {};
    for (const [fighter, copy] of Object.entries(hangar)) {
      const theirs = (designs ?? fleet.designs)[fighter];
      if (theirs === undefined) all()[fighter] = copy;
      else if (!sameBlueprint(theirs, copy)) kept[fighter] = copy;
    }
    const { hangar: _, ...rest } = all()[name]!;
    all()[name] = Object.keys(kept).length > 0 ? { ...rest, hangar: kept } : rest;
  }
  return designs === null ? fleet : { ...fleet, designs };
}

/** Each fighter a design's hangar still holds differently from the fleet's design of that name. */
export function hangarClashes(fleet: Fleet): string[] {
  const out: string[] = [];
  for (const [name, blueprint] of Object.entries(fleet.designs)) {
    for (const fighter of Object.keys(blueprint.hangar ?? {})) {
      if (fleet.designs[fighter] !== undefined) out.push(`${name} carries a ${fighter} that is not the fleet's ${fighter}`);
    }
  }
  return out;
}

/** The designs a fleet's pads name, from the designs `from` reach, and those they reach in turn. */
export function padReached(fleet: Fleet, from: Iterable<string>): Set<string> {
  const reached = new Set<string>(from);
  const queue = [...reached];
  while (queue.length > 0) {
    const blueprint = fleet.designs[queue.pop()!];
    if (blueprint === undefined) continue;
    for (const name of padFighterNames(blueprint)) {
      if (fleet.designs[name] === undefined || reached.has(name)) continue;
      reached.add(name);
      queue.push(name);
    }
  }
  return reached;
}

/** A blueprint with every pad naming fighter `from` naming `to` instead. Unchanged where none does. */
export function renamePadFighter(blueprint: Blueprint, from: string, to: string): Blueprint {
  if (!padFighterNames(blueprint).includes(from)) return blueprint;
  const swap = (list: readonly Placement[]): Placement[] => list.map((p) => (!isInstance(p) && p.craft === from ? { ...p, craft: to } : p));
  const assemblies =
    blueprint.assemblies === undefined
      ? undefined
      : Object.fromEntries(Object.entries(blueprint.assemblies).map(([k, a]) => [k, { ...a, modules: swap(a.modules) }]));
  return { ...blueprint, modules: swap(blueprint.modules), ...(assemblies === undefined ? {} : { assemblies }) };
}
