import { expandBlueprint, expandFleet, MODULE_KINDS, type Blueprint, type Fleet, type ShipModuleKind } from "../sim/index.js";
import { fleetBlueprint } from "../sim/fleetHangar.js";

/**
 * The tech tree: which module kinds a side must have before it can unlock
 * another, in a skirmish. A side builds only with
 * the kinds it has unlocked, and is offered cards to unlock those it has the
 * prerequisites for.
 */

/** Each kind's prerequisites: every group must be met, a group by any one of its kinds. */
export const PREREQUISITES: Readonly<Record<ShipModuleKind, readonly (readonly ShipModuleKind[])[]>> = {
    core: [],
    structure: [["core"]],
    tank: [["core"]],
    hold: [["core"]],
    generator: [["core"]],
    battery: [["core"], ["generator"]],
    robotBay: [["generator"], ["battery"], ["hold"]],
    engine: [["core"]],
    hullGun: [["core"]],
    hullBeam: [["hullGun"], ["generator", "battery"]],
    turret: [["hullGun"], ["structure"]],
    beamTurret: [["hullBeam"], ["structure", "turret"]],
    plasmaLance: [["tank"], ["battery"], ["hullBeam"], ["engine"]],
    railGun: [["hold"], ["hullGun"], ["battery"]],
    warhead: [["tank"], ["structure"]],
    claw: [["structure"], ["port"]],
    port: [["structure"]],
    pad: [["structure"], ["hold"], ["generator", "battery"]],
    slipway: [["pad"], ["structure"]],
};

/** What a new skirmish starts the player with, unless they choose otherwise. */
export const STARTING_TECH: readonly ShipModuleKind[] = ["core", "engine", "hullGun"];

/** Every kind there is: the tech of a skirmish from before the tree, which locked nothing. */
export const ALL_TECH: readonly ShipModuleKind[] = MODULE_KINDS as readonly ShipModuleKind[];

/** Each kind's name as a player reads it, for its card. */
export const KIND_NAMES: Readonly<Record<ShipModuleKind, string>> = {
    core: "Core",
    structure: "Structure",
    tank: "Tank",
    hold: "Hold",
    generator: "Generator",
    battery: "Battery",
    robotBay: "Robot bay",
    engine: "Engine",
    hullGun: "Hull gun",
    hullBeam: "Hull beam",
    turret: "Turret",
    beamTurret: "Beam turret",
    plasmaLance: "Plasma lance",
    railGun: "Rail gun",
    warhead: "Warhead",
    claw: "Claw",
    port: "Port",
    pad: "Pad",
    slipway: "Slipway",
};

/** Whether `kind` is a module kind a ship can be built of. */
export function isTech(kind: string): kind is ShipModuleKind {
    return Object.hasOwn(PREREQUISITES, kind);
}

/** Whether a side with `unlocked` has everything `kind` needs, whether or not it has `kind` itself. */
export function canUnlock(kind: ShipModuleKind, unlocked: readonly ShipModuleKind[]): boolean {
    return PREREQUISITES[kind].every((group) => group.some((k) => unlocked.includes(k)));
}

/** The kinds a side with `unlocked` could unlock next, in the tree's order. */
export function unlockable(unlocked: readonly ShipModuleKind[]): ShipModuleKind[] {
    return ALL_TECH.filter((kind) => !unlocked.includes(kind) && canUnlock(kind, unlocked));
}

/** `a` and every kind of `b` it lacks, in the tree's order. */
export function joined(a: readonly ShipModuleKind[], b: readonly ShipModuleKind[]): ShipModuleKind[] {
    return ALL_TECH.filter((kind) => a.includes(kind) || b.includes(kind));
}

/** Every kind of module a blueprint is built of, the fighters in its hangar too. */
export function blueprintKinds(blueprint: Blueprint): ShipModuleKind[] {
    const kinds = new Set<string>();
    const add = (b: Blueprint): void => {
        for (const m of expandBlueprint(b)) kinds.add(m.kind);
        for (const craft of Object.values(b.hangar ?? {})) add(craft);
    };
    add(blueprint);
    return ALL_TECH.filter((kind) => kinds.has(kind));
}

/** Every kind of module the ships a fleet fields are built of, their fighters too. */
export function fleetKinds(fleet: Fleet): ShipModuleKind[] {
    const kinds = new Set<ShipModuleKind>();
    for (const name of new Set(expandFleet(fleet).map((ship) => ship.design))) {
        if (fleet.designs[name] === undefined) continue;
        for (const kind of blueprintKinds(fleetBlueprint(fleet, name))) kinds.add(kind);
    }
    return ALL_TECH.filter((kind) => kinds.has(kind));
}

/** The fewest kinds a blueprint can be built with: its own, and the first of each prerequisite group it lacks. */
export function techFor(blueprint: Blueprint): ShipModuleKind[] {
    return blueprintKinds(blueprint).reduce<ShipModuleKind[]>((have, kind) => toggled(have, kind, true), ["core"]);
}

/** The kinds a fleet is built of that `unlocked` does not have, in the tree's order. */
export function lockedIn(fleet: Fleet, unlocked: readonly ShipModuleKind[]): ShipModuleKind[] {
    return fleetKinds(fleet).filter((kind) => !unlocked.includes(kind));
}

/**
 * `kinds` with `kind` added or taken away, kept a set the tree allows: one
 * added brings what it needs (the first of a group where none of it is
 * there), and one taken away takes whatever then lacks what it needs. The
 * core is always kept.
 */
export function toggled(kinds: readonly ShipModuleKind[], kind: ShipModuleKind, on: boolean): ShipModuleKind[] {
    const have = new Set<ShipModuleKind>(kinds);
    have.add("core");
    if (on) {
        const add = (k: ShipModuleKind): void => {
            if (have.has(k)) return;
            have.add(k);
            for (const group of PREREQUISITES[k]) if (!group.some((g) => have.has(g))) add(group[0]!);
        };
        add(kind);
    } else if (kind !== "core") {
        have.delete(kind);
        for (let changed = true; changed;) {
            changed = false;
            for (const k of have) {
                if (k === "core" || canUnlock(k, [...have])) continue;
                have.delete(k);
                changed = true;
            }
        }
    }
    return ALL_TECH.filter((k) => have.has(k));
}

/**
 * Steps between two kinds on the tree, either way along a prerequisite: a
 * kind and what it needs, or what needs it, are one apart.
 */
export const TECH_STEPS: Readonly<Record<ShipModuleKind, Readonly<Record<ShipModuleKind, number>>>> = (() => {
    const near = new Map<ShipModuleKind, Set<ShipModuleKind>>(ALL_TECH.map((kind) => [kind, new Set()]));
    for (const kind of ALL_TECH) {
        for (const group of PREREQUISITES[kind]) {
            for (const needed of group) {
                near.get(kind)!.add(needed);
                near.get(needed)!.add(kind);
            }
        }
    }
    const out: Partial<Record<ShipModuleKind, Record<ShipModuleKind, number>>> = {};
    for (const from of ALL_TECH) {
        const steps = Object.fromEntries(ALL_TECH.map((kind) => [kind, Infinity])) as Record<ShipModuleKind, number>;
        steps[from] = 0;
        let ring = [from];
        for (let d = 1; ring.length > 0; d++) {
            const next: ShipModuleKind[] = [];
            for (const kind of ring) {
                for (const other of near.get(kind)!) {
                    if (steps[other] !== Infinity) continue;
                    steps[other] = d;
                    next.push(other);
                }
            }
            ring = next;
        }
        out[from] = steps;
    }
    return out as Record<ShipModuleKind, Record<ShipModuleKind, number>>;
})();
