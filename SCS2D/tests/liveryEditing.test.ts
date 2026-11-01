import { describe, expect, it } from "vitest";
import type { Livery } from "../sim/index.js";
import { LINE_OF_BATTLE } from "../scenarios/fleets.js";
import { DINKY, GUNSHIP } from "../scenarios/blueprints.js";
import { addShip, differs, emptyFleet } from "../editor/fleetEdit.js";
import { backToFleet, wearingFleets } from "../editor/livery.js";

const GOLD: Livery = {
    base: "#d4a017",
    highlight: "#202020",
    pattern: "stripes",
    size: 0.2,
    spacing: 2.5,
    offset: 0,
    angle: 0,
    chevron: 0.5,
    points: 0,
};
const TEAL: Livery = { ...GOLD, base: "#2a8a85" };

describe("a livery edited in the ship editor opened from a fleet", () => {
    it("is the fleet's, and goes back to the fleet rather than the design", () => {
        const fleet = { ...LINE_OF_BATTLE, livery: GOLD };
        const own = { ...fleet.designs["Dinky"]!, livery: TEAL };
        const withOwn = { ...fleet, designs: { ...fleet.designs, Dinky: own } };

        const opened = wearingFleets(own, withOwn);
        expect(opened.livery).toEqual(GOLD);

        const back = backToFleet(withOwn, "Dinky", { ...opened, livery: { ...GOLD, base: "#c02020" } });
        expect(back.livery?.base).toBe("#c02020");
        expect(back.designs["Dinky"]!.livery).toEqual(TEAL);
    });

    it("takes the fleet's away when set back to side colours", () => {
        const fleet = { ...LINE_OF_BATTLE, livery: GOLD };
        const { livery: _, ...plain } = wearingFleets(fleet.designs["Dinky"]!, fleet);
        expect(backToFleet(fleet, "Dinky", plain).livery).toBeUndefined();
    });
});

describe("a fleet's livery from its ships", () => {
    it("is taken from the first ship put in an empty fleet that has none", () => {
        const first = addShip(emptyFleet("New"), { ...GUNSHIP, livery: GOLD }, 0, 0);
        expect(first.livery).toEqual(GOLD);
        expect(addShip(first, { ...DINKY, livery: TEAL }, 10, 0).livery).toEqual(GOLD);
    });

    it("is never taken after the first ship, nor over the fleet's own", () => {
        const plain = addShip(emptyFleet("New"), GUNSHIP, 0, 0);
        expect(addShip(plain, { ...DINKY, livery: TEAL }, 10, 0).livery).toBeUndefined();
        expect(addShip({ ...emptyFleet("New"), livery: GOLD }, { ...DINKY, livery: TEAL }, 0, 0).livery).toEqual(GOLD);
    });

    it("does not make a design differ from its library copy", () => {
        expect(differs({ ...GUNSHIP, livery: GOLD }, GUNSHIP)).toBe(false);
        expect(differs({ ...GUNSHIP, notes: "changed" }, GUNSHIP)).toBe(true);
    });
});
