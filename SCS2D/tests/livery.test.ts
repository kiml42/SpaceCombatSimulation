import { describe, expect, it } from "vitest";
import {
    blueprintFileProblem,
    fleetFileProblem,
    fleetWarnings,
    parseBlueprint,
    parseFleet,
    serialiseBlueprint,
    serialiseFleet,
    shipFleet,
    type Livery,
} from "../sim/index.js";
import { DINKY, GUNSHIP } from "../scenarios/blueprints.js";
import { fleetBattle } from "../scenarios/fleetBattle.js";
import { colourDistance, colourName, liveryPalette, sidesOf, STOCK, TOO_ALIKE, teamColour, teamName } from "../render/teams.js";

const LIVERY = { base: "#d4a017", highlight: "#202020", pattern: "stripes", size: 0.2, spacing: 0.5, offset: 0.25, angle: 30 };

function livery(base: string): Livery {
    return { base, highlight: "#ffffff", pattern: "none", size: 0.1, spacing: 0.3, offset: 0, angle: 0 };
}

const fleetFile = (extra: Record<string, unknown>): Record<string, unknown> => ({
    formatVersion: 1,
    name: "Test",
    designs: { Dinky: serialiseBlueprint(DINKY) },
    ships: [{ design: "Dinky", x: 0, y: 0 }],
    ...extra,
});

describe("a livery in a file", () => {
    it("round-trips on a fleet and on a blueprint", () => {
        const fleet = fleetFile({ livery: LIVERY });
        expect(serialiseFleet(parseFleet(fleet))).toEqual(fleet);
        const blueprint = { ...serialiseBlueprint(GUNSHIP), livery: LIVERY };
        expect(serialiseBlueprint(parseBlueprint(blueprint))).toEqual(blueprint);
    });

    it("fills in a pattern left out, and keeps a key it does not read", () => {
        const fleet = parseFleet(fleetFile({ livery: { base: "#D4A017", highlight: "#202020", shine: 1 } }));
        expect(fleet.livery).toMatchObject({ base: "#d4a017", pattern: "none", angle: 0 });
        expect(serialiseFleet(fleet)["livery"]).toMatchObject({ shine: 1 });
        expect(fleetWarnings(fleet)).toEqual(["livery has a key the game does not read, kept as written: shine"]);
    });

    it("refuses a colour that is not #rrggbb, an unknown pattern and a size of nothing", () => {
        expect(fleetFileProblem(fleetFile({ livery: { base: "red", highlight: "#000000" } }))).toMatch(/base must be a colour/);
        expect(fleetFileProblem(fleetFile({ livery: { ...LIVERY, pattern: "plaid" } }))).toMatch(/pattern must be one of/);
        expect(blueprintFileProblem({ ...serialiseBlueprint(GUNSHIP), livery: { ...LIVERY, size: 0 } })).toMatch(/size must be above zero/);
    });

    it("is worn by a ship flying alone, through the fleet it is put in", () => {
        expect(shipFleet({ ...GUNSHIP, livery: livery("#d4a017") }).livery?.base).toBe("#d4a017");
        expect(shipFleet(GUNSHIP).livery).toBeUndefined();
    });

    it("is carried by a battle, one per side", () => {
        const fleet = { ...shipFleet(DINKY), livery: livery("#d4a017") };
        const battle = fleetBattle([fleet, shipFleet(DINKY)], { seed: 1, range: 500 });
        expect(battle.liveries).toEqual([fleet.livery, undefined]);
    });
});

describe("a side's colours from its livery", () => {
    it("are the stock sides' with no liveries", () => {
        expect(sidesOf(undefined)).toBe(STOCK);
        expect(sidesOf([undefined, undefined])).toEqual(STOCK.slice(0, 2));
    });

    it("take hull from the base, a lighter trim and a darker pivot", () => {
        const palette = liveryPalette(livery("#d4a017"));
        expect(palette.hull).toBe("#d4a017");
        const luma = (hex: string): number => [1, 3, 5].reduce((sum, k) => sum + parseInt(hex.slice(k, k + 2), 16), 0);
        expect(luma(palette.trim)).toBeGreaterThan(luma(palette.hull));
        expect(luma(palette.pivot)).toBeLessThan(luma(palette.hull));
    });

    it("are named by the nearest named colour", () => {
        const sides = sidesOf([livery("#e0c040")]);
        expect(teamName(0, sides)).toBe("Yellow");
        expect(teamColour(0, sides)).toBe("#e0c040");
        expect(colourName("#5b8dd6")).toBe("Blue");
    });

    it("give way to an earlier side too like them, never the other way", () => {
        // A red livery first: the second side, with none, would be stock red, so takes the next stock colour.
        const sides = sidesOf([livery("#d65b5b"), undefined]);
        expect(sides[0]!.ship.hull).toBe("#d65b5b");
        expect(sides[1]).toBe(STOCK[2]);
        // Two near the same: the later wears stock colours unlike the first.
        const alike = sidesOf([livery("#d4a017"), livery("#d8a41b")]);
        expect(alike[0]!.ship.hull).toBe("#d4a017");
        expect(alike[1]).toBe(STOCK[1]);
    });

    it("keeps the stock sides further apart than too alike", () => {
        for (const a of STOCK)
            for (const b of STOCK) if (a !== b) expect(colourDistance(a.ship.hull, b.ship.hull)).toBeGreaterThan(TOO_ALIKE);
    });
});
