import { describe, expect, it } from "vitest";
import { DEFAULT_DOCTRINE } from "../sim/index.js";
import { sectionEntries, SHIP_SECTIONS, type DoctrineContext, type DoctrineValues } from "../editor/doctrine.js";

/**
 * The ship doctrine the editor offers, against what the ship can use: a setting
 * for a part it has none of is hidden, and nothing is hidden for a ship not known.
 */

// Every setting below past whatever threshold of its own would hide it.
const values: DoctrineValues = {
    targeting: DEFAULT_DOCTRINE.targeting,
    approach: {
        ...DEFAULT_DOCTRINE.approach,
        scavengeFuelBelow: 0.5,
        scavengeMetalBelow: 0.5,
        refuelBelow: 0.3,
        burnWeight: 1,
        ramRadii: 2,
    },
};

/** A ship with nothing but what `parts` says: no gun, port, claw or robots, and not a fighter. */
const ship = (parts: Partial<DoctrineContext> = {}): DoctrineContext => ({
    mass: 1e5,
    radius: 20,
    reach: 0,
    accelFore: 5,
    accelAft: 5,
    brakeHolding: 5,
    brakeTurned: 5,
    guns: 0,
    fighter: false,
    lands: true,
    ports: 0,
    claws: 0,
    robots: 0,
    gives: false,
    ...parts,
});

const shown = (field: string, on: DoctrineContext | null): boolean => {
    const row = sectionEntries(SHIP_SECTIONS).find((e) => e.field === field);
    if (row === undefined) throw new Error(`no row ${field}`);
    return row.shown?.(values, on) ?? true;
};

const SCAVENGING = ["scavengeFuelBelow", "scavengeDanger", "rockWeight", "clawSpeed", "tripWeight"];
const MINING = ["scavengeMetalBelow", "fuelPerMetal"];
const LANDING = ["rearmBelow", "repairBelow", "rechargeBelow"];
const RESERVES = ["fuelReserve", "metalReserve", "chargeReserve"];
const GUNS = ["turnBias", "rangeHold", "ramArmed"];

describe("doctrine a ship cannot use", () => {
    it("is all offered for a ship not known", () => {
        for (const field of [
            ...SCAVENGING,
            ...MINING,
            ...LANDING,
            ...RESERVES,
            ...GUNS,
            "refuelBelow",
            "dockDanger",
            "deliverFuelAbove",
            "sortieRange",
            "repairArmed",
        ]) {
            expect(shown(field, null)).toBe(true);
        }
    });

    it("hides scavenging without a claw, and mining without robots as well", () => {
        for (const field of [...SCAVENGING, ...MINING]) expect(shown(field, ship())).toBe(false);
        for (const field of SCAVENGING) expect(shown(field, ship({ claws: 1 }))).toBe(true);
        for (const field of MINING) expect(shown(field, ship({ claws: 1 }))).toBe(false);
        for (const field of MINING) expect(shown(field, ship({ claws: 1, robots: 1 }))).toBe(true);
    });

    it("hides docking for refuel and delivery without a port, unless it lands on pads", () => {
        for (const field of ["refuelBelow", "dockDanger", "deliverFuelAbove"]) expect(shown(field, ship())).toBe(false);
        for (const field of ["refuelBelow", "dockDanger", "deliverFuelAbove"]) expect(shown(field, ship({ ports: 1 }))).toBe(true);
        // A fighter refuels on a pad, but delivers only through a port.
        expect(shown("refuelBelow", ship({ fighter: true }))).toBe(true);
        expect(shown("dockDanger", ship({ fighter: true }))).toBe(true);
        expect(shown("deliverFuelAbove", ship({ fighter: true }))).toBe(false);
        expect(shown("refuelBelow", ship({ fighter: true, lands: false }))).toBe(false);
    });

    it("keeps landing to rearm, recharge and be mended, and the sortie, to a fighter that lands", () => {
        for (const field of [...LANDING, "sortieRange"]) expect(shown(field, ship())).toBe(false);
        for (const field of [...LANDING, "sortieRange"]) expect(shown(field, ship({ fighter: true }))).toBe(true);
        for (const field of LANDING) expect(shown(field, ship({ fighter: true, lands: false }))).toBe(false);
        // Mended for its guns only with guns to be mended.
        expect(shown("repairArmed", ship({ fighter: true }))).toBe(false);
        expect(shown("repairArmed", ship({ fighter: true, guns: 2 }))).toBe(true);
    });

    it("hides what weighs its main guns from a ship with none", () => {
        for (const field of GUNS) expect(shown(field, ship())).toBe(false);
        for (const field of GUNS) expect(shown(field, ship({ guns: 1 }))).toBe(true);
    });

    it("hides reserves from a ship with nothing to take from its stores or give them to", () => {
        for (const field of RESERVES) expect(shown(field, ship())).toBe(false);
        for (const field of RESERVES) expect(shown(field, ship({ gives: true }))).toBe(true);
    });
});
