import { blueprintFaults, expandWithOrigins, type Blueprint } from "./blueprint.js";
import type { Fleet, FleetEntry } from "./fleet.js";
import { padFighterNames, withFleetFighters } from "./fleetHangar.js";

/*
 * Best-effort repair of designs the rules no longer accept: a ship saved, or
 * bred, under rules that have since tightened. Where a design must fly — a
 * skirmish loading — making do with most of a ship beats refusing the lot.
 */

export interface Repaired {
    readonly blueprint: Blueprint;
    /** What was dropped, as sentences; empty when it needed nothing. */
    readonly dropped: readonly string[];
}

/**
 * The layout with placements dropped, one at a time, until it is valid: each
 * time the one a fault names, preferring anything over a core. Null when what
 * is wrong is the layout as a whole, which no dropping fixes.
 *
 * `asFlown` is the blueprint as it is checked: in a fleet, with the fleet's
 * fighters in its hangar.
 */
export function repairBlueprint(blueprint: Blueprint, asFlown: (b: Blueprint) => Blueprint = (b) => b): Repaired | null {
    let current = blueprint;
    const dropped: string[] = [];
    for (;;) {
        const faults = blueprintFaults(asFlown(current));
        if (faults.length === 0) return { blueprint: current, dropped };
        const fault = faults.find((each) => each.modules.length > 0);
        if (fault === undefined || current.modules.length <= 1) return null;
        const { modules, origins } = expandWithOrigins(current);
        const named = [...fault.modules].sort((a, b) => b - a);
        const pick = named.find((i) => modules[i]?.kind !== "core") ?? named[0]!;
        const top = origins[pick]!.path[0]!.index;
        dropped.push(fault.message);
        current = { ...current, modules: current.modules.filter((_, i) => i !== top) };
    }
}

export interface RepairedFleet {
    readonly fleet: Fleet;
    /** What was done to it, as sentences; empty when it needed nothing. */
    readonly repairs: readonly string[];
}

/**
 * Every design in the fleet repaired as `repairBlueprint` does, a carrier's
 * fighters before it, and the ships of any design past repair left out. Each
 * repaired design says what it lost in its notes.
 */
export function repairFleet(fleet: Fleet): RepairedFleet {
    const designs = { ...fleet.designs };
    const repairs: string[] = [];
    const order: string[] = [];
    const seen = new Set<string>();
    const visit = (name: string): void => {
        if (seen.has(name) || designs[name] === undefined) return;
        seen.add(name);
        for (const craft of padFighterNames(designs[name])) visit(craft);
        order.push(name);
    };
    Object.keys(designs).forEach(visit);

    const lost = new Set<string>();
    for (const name of order) {
        const fixed = repairBlueprint(designs[name]!, (b) => withFleetFighters(b, designs));
        if (fixed === null) {
            lost.add(name);
            repairs.push(`${name} could not be repaired, so its ships were left out`);
        } else if (fixed.dropped.length > 0) {
            const what = `Repaired on loading, dropping a part for each of: ${fixed.dropped.join("; ")}.`;
            const notes = fixed.blueprint.notes;
            designs[name] = { ...fixed.blueprint, notes: notes === undefined ? what : `${notes}\n\n${what}` };
            repairs.push(`${name} lost ${fixed.dropped.length} part${fixed.dropped.length === 1 ? "" : "s"} to fit the rules`);
        }
    }
    if (repairs.length === 0) return { fleet, repairs };

    const keep = (entries: readonly FleetEntry[]): FleetEntry[] =>
        entries.filter((entry) => !("design" in entry) || !lost.has(entry.design));
    const groups =
        fleet.groups === undefined
            ? undefined
            : Object.fromEntries(Object.entries(fleet.groups).map(([name, group]) => [name, { ...group, ships: keep(group.ships) }]));
    return {
        fleet: { ...fleet, designs, ships: keep(fleet.ships), ...(groups === undefined ? {} : { groups }) },
        repairs,
    };
}
