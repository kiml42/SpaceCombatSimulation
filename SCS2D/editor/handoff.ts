import { parseFleet, serialiseFleet, shipFleet, type Fleet } from "../sim/index.js";
import { parseSkirmish, serialiseSkirmish, type Skirmish } from "../scenarios/skirmish.js";

/**
 * Handing what one screen holds to another: a ship or fleet to a battle, a
 * fleet's design to the ship editor and back, a skirmish's fleet to the fleet
 * editor. Each is a route of the app, carrying what it hands over in its
 * search, so a reload or a link opens the same thing.
 */

const param = (value: unknown): string => encodeURIComponent(JSON.stringify(value));

/** The app's battle route, carrying this fleet as its first side. */
export function battleRoute(fleet: Fleet): string {
    return `/battle?fleet=${param(serialiseFleet(fleet))}`;
}

export { shipFleet };

/** A fleet's design opened in the ship editor, with what is needed to go back to the fleet. */
export interface DesignInFleet {
    fleet: Fleet;
    /** The design being edited, by its name in the fleet. */
    design: string;
    /** The skirmish the fleet is the player's in, if it is. */
    skirmish?: Skirmish;
}

/** The ship route, opening a design of this fleet. */
export function designRoute(handed: DesignInFleet): string {
    const value = {
        fleet: serialiseFleet(handed.fleet),
        design: handed.design,
        ...(handed.skirmish === undefined ? {} : { skirmish: serialiseSkirmish(handed.skirmish) }),
    };
    return `/ship?design=${param(value)}`;
}

/** The fleet design the ship route's address carries, or null. Throws on one that is there but unreadable. */
export function handedDesign(search: URLSearchParams): DesignInFleet | null {
    const text = search.get("design");
    if (text === null) return null;
    const value = JSON.parse(text) as Record<string, unknown>;
    const fleet = parseFleet(value["fleet"]);
    const design = value["design"];
    if (typeof design !== "string" || fleet.designs[design] === undefined) {
        throw new Error(`the fleet has no design called ${JSON.stringify(design)}`);
    }
    return {
        fleet,
        design,
        ...(value["skirmish"] === undefined ? {} : { skirmish: parseSkirmish(value["skirmish"]) }),
    };
}

/** The fleet route, opening this fleet: as the skirmish's, if it is in one. */
export function fleetRoute(fleet: Fleet, skirmish?: Skirmish): string {
    return skirmish === undefined
        ? `/fleet?fleet=${param(serialiseFleet(fleet))}`
        : `/fleet?skirmish=${param(serialiseSkirmish({ ...skirmish, player: fleet }))}`;
}

/** What the fleet route's address hands it: a fleet, alone or as a skirmish's. Throws on one it cannot read. */
export function handedToFleet(search: URLSearchParams): { fleet: Fleet; skirmish: Skirmish | null } | null {
    const skirmish = search.get("skirmish");
    if (skirmish !== null) {
        const read = parseSkirmish(JSON.parse(skirmish));
        return { fleet: read.player, skirmish: read };
    }
    const fleet = search.get("fleet");
    return fleet === null ? null : { fleet: parseFleet(JSON.parse(fleet)), skirmish: null };
}

/** The skirmish route, carrying a skirmish to take up: one handed back by an editor, or a test's. */
export function skirmishRoute(skirmish: Skirmish): string {
    return `/skirmish?skirmish=${param(serialiseSkirmish(skirmish))}`;
}

/** The skirmish the skirmish route's address carries, or null. Throws on one it cannot read. */
export function handedSkirmish(search: URLSearchParams): Skirmish | null {
    const text = search.get("skirmish");
    return text === null ? null : parseSkirmish(JSON.parse(text));
}
