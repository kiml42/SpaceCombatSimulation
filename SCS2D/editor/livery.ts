import type { Blueprint, Fleet, Livery } from "../sim/index.js";
import { STOCK } from "../render/teams.js";
import { replaceDesign } from "./fleetEdit.js";

/** What the Livery panel starts from when one is first set: the first side's colours, plain. */
export const NEW_LIVERY: Livery = {
    base: STOCK[0]!.ship.hull,
    highlight: STOCK[0]!.ship.trim,
    pattern: "none",
    size: 0.1,
    spacing: 3,
    offset: 0,
    angle: 0,
};

/** `of` wearing `livery`, or none. */
export function withLivery<T extends { livery?: Livery }>(of: T, livery: Livery | undefined): T {
    const next = { ...of };
    if (livery === undefined) delete next.livery;
    else next.livery = livery;
    return next;
}

/**
 * The design as the ship editor opens it from a fleet: wearing the fleet's
 * livery, which is what the editor's Livery panel then edits.
 */
export function wearingFleets(blueprint: Blueprint, fleet: Fleet): Blueprint {
    return withLivery(blueprint, fleet.livery);
}

/**
 * The fleet with design `from` replaced by `blueprint` as the ship editor
 * opened from it left it: the livery it wore goes to the fleet, and the
 * design keeps whatever it had of its own.
 */
export function backToFleet(fleet: Fleet, from: string, blueprint: Blueprint): Fleet {
    const own = fleet.designs[from]?.livery;
    return withLivery(replaceDesign(fleet, from, withLivery(blueprint, own)), blueprint.livery);
}
