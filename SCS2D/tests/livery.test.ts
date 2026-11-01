import { describe, expect, it } from "vitest";
import {
    blueprintWarnings,
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
import { withLivery } from "../editor/livery.js";
import { moduleFills, type Fill } from "../render/moduleFills.js";
import { patternColour, patternTransform, TILE, tileKey } from "../render/livery.js";
import { fleetBattle } from "../scenarios/fleetBattle.js";
import {
    colourDistance,
    colourName,
    liveryMarker,
    liveryPalette,
    markerOf,
    sidesOf,
    STOCK,
    TOO_ALIKE,
    teamColour,
    teamName,
} from "../render/teams.js";

const LIVERY = {
    base: "#d4a017",
    highlight: "#202020",
    pattern: "stripes",
    size: 0.2,
    spacing: 2.5,
    offset: 0.25,
    angle: 30,
    chevron: 45,
    points: 0,
};

function livery(base: string): Livery {
    return { base, highlight: "#ffffff", pattern: "none", size: 0.1, spacing: 3, offset: 0, angle: 0, chevron: 0.5, points: 0 };
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

    it("reads every part it can, warning of each it cannot and wearing its default instead", () => {
        const raw = fleetFile({ livery: { ...LIVERY, spacing: 0.12, pattern: "plaid" } });
        expect(fleetFileProblem(raw)).toBeNull();
        const fleet = parseFleet(raw);
        expect(fleet.livery).toMatchObject({ base: "#d4a017", highlight: "#202020", size: 0.2, spacing: 3, pattern: "none" });
        const warnings = fleetWarnings(fleet);
        expect(warnings).toHaveLength(2);
        expect(warnings.join()).toMatch(/pattern must be one of .*"plaid"/);
        expect(warnings.join()).toMatch(/spacing must be at least one stripe width, got 0.12; 3 is worn instead/);
        const ship = parseBlueprint({ ...serialiseBlueprint(GUNSHIP), livery: { base: "red", highlight: "#000000", size: 0 } });
        expect(ship.livery).toMatchObject({ base: "#5b8dd6", highlight: "#000000", size: 0.1 });
        expect(blueprintWarnings(ship).join()).toMatch(/base must be a colour.*size must be above zero/);
    });

    it("reads chevrons, warning of an arm bent past lying along the stripes", () => {
        const fleet = parseFleet(fleetFile({ livery: { ...LIVERY, pattern: "chevrons", chevron: 30, points: 8 } }));
        expect(fleet.livery).toMatchObject({ pattern: "chevrons", points: 8 });
        expect(fleet.livery!.chevron).toBeCloseTo(Math.PI / 6, 12);
        const bent = parseFleet(fleetFile({ livery: { ...LIVERY, pattern: "chevrons", chevron: 80 } }));
        expect(fleetWarnings(bent).join()).toMatch(/chevron must be from 0 to 75 degrees, got 80; 45 is worn instead/);
        // Older files, written before chevrons, read with a chevron's defaults.
        const { chevron: _c, points: _p, ...older } = LIVERY;
        expect(parseFleet(fleetFile({ livery: older })).livery).toMatchObject({ points: 0 });
    });

    it("tiles a zigzag one period of its points tall, and a single chevron a hull's width", () => {
        const zigzag = { ...livery("#d4a017"), pattern: "chevrons" as const, size: 0.1, spacing: 3, points: 8, chevron: Math.PI / 4 };
        expect(tileKey(zigzag, "#fff")).toBe("chevrons 48x128 90 #fff");
        expect(tileKey({ ...zigzag, points: 0 }, "#fff")).toBe("chevrons 48x320 90 #fff");
        // In half degrees of bend; thinner stripes reach further, up to a limit.
        expect(tileKey({ ...zigzag, points: 0, size: 0.001 }, "#fff")).toBe("chevrons 48x4096 90 #fff");
    });

    it("lets spots touch, but keeps stripes apart", () => {
        expect(parseFleet(fleetFile({ livery: { ...LIVERY, pattern: "spots", spacing: 1 } })).livery?.problems).toBeUndefined();
        expect(tileKey({ ...livery("#d4a017"), pattern: "spots", spacing: 1 }, "#fff")).toBe(`spots ${TILE} #fff`);
        expect(tileKey({ ...livery("#d4a017"), pattern: "stripes", spacing: 1 }, "#fff")).toBe(`stripes ${TILE - 1} #fff`);
    });

    it("keeps one that is not even an object as written, warning of it", () => {
        const raw = fleetFile({ livery: "gold" });
        const fleet = parseFleet(raw);
        expect(fleet.livery).toBeUndefined();
        expect(fleetWarnings(fleet).join()).toMatch(/livery must be an object/);
        expect(serialiseFleet(fleet)).toEqual(raw);
    });

    it("replaces one it could not read once another is set, or side colours chosen", () => {
        const fleet = parseFleet(fleetFile({ livery: "gold" }));
        expect(serialiseFleet(withLivery(fleet, livery("#d4a017")))["livery"]).toMatchObject({ base: "#d4a017" });
        expect(serialiseFleet(withLivery(fleet, undefined))["livery"]).toBeUndefined();
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

    it("tells two grey hulls apart by their markers, and never draws a live side's arrows grey", () => {
        // The Imperial and Rebel fleets: a cool grey with a slate highlight, and a warm grey with a red one.
        const imperial = { ...livery("#a6b1bf"), highlight: "#5c6076" };
        const rebel = { ...livery("#9d948e"), highlight: "#c96d63" };
        expect(colourDistance(imperial.base, rebel.base)).toBeLessThan(TOO_ALIKE);
        const sides = sidesOf([imperial, rebel]);
        expect(sides[0]!.livery).toBe(imperial);
        expect(sides[1]!.livery).toBe(rebel);
        // The imperial grey has a blue to it, made vivid; the rebel grey has none, so its red highlight is used.
        expect(teamName(0, sides)).toBe("Blue");
        expect(teamName(1, sides)).toBe("Red");
        for (const side of sides) {
            for (const colours of [side.ship, side.fighter]) {
                const [r, g, b] = [1, 3, 5].map((k) => parseInt(markerOf(colours).hull.slice(k, k + 2), 16));
                expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!)).toBeGreaterThan(60);
            }
        }
        // Hulls still wear the base.
        expect(sides[0]!.ship.hull).toBe("#a6b1bf");
        expect(teamColour(0, sides)).toBe(liveryMarker(imperial));
        // Both greys, highlight and all: the base itself.
        expect(liveryMarker({ ...livery("#808080"), highlight: "#c0c0c0" })).toBe("#808080");
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
            spacing: 3,
            offset: 0.25,
            angle: 0.5,
            chevron: 0,
            points: 0,
        };
        const period = livery.spacing * livery.size * design.radius;
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

    it("is the highlight on every tone of the hull, but never on engines or hull mounts", () => {
        const palette = { ...liveryPalette(livery("#2a6a8a")), highlight: "#f0c040" };
        for (const tone of [palette.hull, palette.trim, palette.pivot]) {
            expect(patternColour("structure", tone, palette)).toBe("#f0c040");
            expect(patternColour("core", tone, palette)).toBe("#f0c040");
            expect(patternColour("engine", tone, palette)).toBeNull();
            expect(patternColour("hullGun", tone, palette)).toBeNull();
        }
        expect(patternColour("structure", "#123456", palette)).toBeNull();
        expect(patternColour("structure", STOCK[0]!.ship.hull, STOCK[0]!.ship)).toBeNull();
    });
});
