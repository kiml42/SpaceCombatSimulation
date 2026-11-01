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
    compileBlueprint,
    type Livery,
} from "../sim/index.js";
import { CORVETTE, DINKY, GUNSHIP } from "../scenarios/blueprints.js";
import { moduleFills, type Fill } from "../render/moduleFills.js";
import { patternColour, patternTransform, TILE } from "../render/livery.js";
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

describe("a livery's pattern", () => {
    it("falls on every module in the frame of the design it was built in", () => {
        const design = compileBlueprint(CORVETTE);
        const livery: Livery = {
            base: "#2a6a8a",
            highlight: "#f0c040",
            pattern: "stripes",
            size: 0.1,
            spacing: 0.3,
            offset: 0.25,
            angle: 0.5,
        };
        const period = livery.spacing * design.radius;
        // A tile pixel's place in the design, worked out directly.
        const u = 13;
        const v = 41;
        const s = period / TILE;
        const along = s * u + livery.offset * period;
        const across = s * v;
        const expected = [along * Math.cos(0.5) - across * Math.sin(0.5), along * Math.sin(0.5) + across * Math.cos(0.5)];
        for (let m = 0; m < design.modules.length; m++) {
            const t = patternTransform(livery, design, m);
            const lx = t.a * u + t.c * v + t.e;
            const ly = t.b * u + t.d * v + t.f;
            const module = design.modules[m]!;
            const x = module.x + lx * Math.cos(module.angle) - ly * Math.sin(module.angle);
            const y = module.y + lx * Math.sin(module.angle) + ly * Math.cos(module.angle);
            expect(x).toBeCloseTo(expected[0]!, 9);
            expect(y).toBeCloseTo(expected[1]!, 9);
        }
    });

    it("is drawn in the highlight, which picks out an engine's band only where a livery gives one", () => {
        const engine = compileBlueprint(CORVETTE).modules.find((m) => m.spec.kind === "engine")!.spec;
        const out: Fill[] = [];
        moduleFills(engine, "#000000", liveryPalette(livery("#2a6a8a")), 1, out);
        expect(out.some((fill) => fill.colour === "#ffffff")).toBe(true);
        moduleFills(engine, "#000000", STOCK[0]!.ship, 1, out);
        // The block and its bells only, the bells grey whatever the side.
        expect(new Set(out.map((fill) => fill.colour))).toEqual(new Set(["#000000", "#4a4a4a"]));
        expect(sidesOf([livery("#2a6a8a")])[0]!.fighter.highlight).toBeDefined();
    });

    it("is tinted on each tone as the tone is from the base", () => {
        const palette = liveryPalette(livery("#2a6a8a"));
        expect(patternColour(palette.hull, palette)).toBe("#ffffff");
        expect(patternColour(palette.trim, palette)).toBe("#ffffff");
        expect(patternColour(palette.pivot, palette)).toBe("#808080");
        expect(patternColour("#123456", palette)).toBeNull();
        expect(patternColour(STOCK[0]!.ship.hull, STOCK[0]!.ship)).toBeNull();
    });
});
