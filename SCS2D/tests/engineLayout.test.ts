import { describe, expect, it } from "vitest";
import { compileBlueprint, isPressureFed, engineGeometry, type Blueprint } from "../sim/index.js";
import { mountsOf } from "../render/bevels.js";
import { engineLayout } from "../render/engineLayout.js";
import { moduleFills, type Fill } from "../render/moduleFills.js";
import { shipColours } from "../render/teams.js";

/** A core with an engine `length` by `width` against its aft face. */
const withEngine = (length: number, width: number, barrels = 1, ...more: Blueprint["modules"]): Blueprint => ({
    name: "Engine",
    modules: [
        ...more,
        { kind: "core", x: 0, y: 0, length: 2, width: 2 },
        // Placed by its forward face, thrusting +x.
        { kind: "engine", x: -1, y: 0, angle: Math.PI, length, width, barrels },
    ],
});

const engineOf = (blueprint: Blueprint) => {
    const design = compileBlueprint(blueprint);
    const m = design.modules.findIndex((module) => module.spec.kind === "engine");
    return { design, m, spec: design.modules[m]!.spec };
};

describe("engine layout", () => {
    it("gives a pumped engine a pump on the hull's side of its chamber", () => {
        const { spec } = engineOf(withEngine(3, 3));
        expect(isPressureFed(engineGeometry(spec))).toBe(false);
        const layout = engineLayout(spec);
        expect(layout.pumpAft).toBeLessThan(layout.front);
        expect(layout.pumpAft).toBeGreaterThan(layout.aft);
        // A sphere, wider than the throat it feeds.
        expect(layout.fore - layout.aft).toBeCloseTo(2 * layout.radius, 9);
        expect(2 * layout.radius).toBeGreaterThan(engineGeometry(spec).throatWidth);
    });

    it("gives a pressure-fed engine no pump, its chamber taking the block", () => {
        const { spec } = engineOf(withEngine(0.4, 0.2));
        expect(isPressureFed(engineGeometry(spec))).toBe(true);
        const layout = engineLayout(spec);
        expect(layout.pumpAft).toBe(layout.front);
        expect(layout.fore).toBe(layout.front);
        // Longer than it is wide: a capsule.
        expect(layout.fore - layout.aft).toBeGreaterThan(2 * layout.radius);
    });

    it("gives each nozzle a chamber of its own, fed by one pump", () => {
        const { spec } = engineOf(withEngine(2, 6, 3));
        const layout = engineLayout(spec);
        expect(layout.centres).toHaveLength(3);
        const fills: Fill[] = [];
        moduleFills(spec, "#888", shipColours(0), 1, fills);
        // Three bells, three chambers, one pump.
        expect(fills).toHaveLength(7);
    });

    it("bands a pumped engine's pump with its livery, and a pressure-fed engine not at all", () => {
        const colours = { ...shipColours(0), highlight: "#ff0000" };
        const fills: Fill[] = [];
        const pumped = engineOf(withEngine(3, 3)).spec;
        moduleFills(pumped, "#888", colours, 1, fills);
        const band = fills.filter((f) => f.colour === "#ff0000");
        expect(band).toHaveLength(1);
        for (let v = 0; v < band[0]!.points.length; v += 2)
            expect(band[0]!.points[v]!).toBeGreaterThanOrEqual(engineLayout(pumped).pumpAft);
        moduleFills(engineOf(withEngine(0.4, 0.2)).spec, "#888", colours, 1, fills);
        expect(fills.some((f) => f.colour === "#ff0000")).toBe(false);
    });
});

describe("engine mounts", () => {
    it("holds a pressure-fed engine's chamber to the hull it is built against, at that face alone", () => {
        const { design, m, spec } = engineOf(withEngine(0.4, 0.2));
        const layout = engineLayout(spec);
        const { polygons } = mountsOf(design, m);
        expect(polygons.length).toBeGreaterThan(0);
        for (const points of polygons) {
            for (let v = 0; v < points.length; v += 2) {
                expect(points[v]!).toBeGreaterThanOrEqual(layout.fore - layout.radius - 1e-9);
                expect(points[v]!).toBeLessThanOrEqual(layout.front + 1e-9);
            }
        }
    });

    it("needs none on a pumped engine whose pump meets the hull", () => {
        const { design, m } = engineOf(withEngine(3, 2));
        expect(mountsOf(design, m).polygons).toEqual([]);
    });

    it("holds a chamber to whatever stands beside it", () => {
        /** Mounts wholly to one side of the engine's axis: on a side face, not its forward one. */
        const sideMounts = (blueprint: Blueprint): number => {
            const { design, m } = engineOf(blueprint);
            const ys = (points: readonly number[]) => points.filter((_, v) => v % 2 === 1);
            return mountsOf(design, m).polygons.filter((p) => ys(p).every((y) => y >= -1e-9) || ys(p).every((y) => y <= 1e-9)).length;
        };
        expect(sideMounts(withEngine(0.4, 0.2))).toBe(0);
        // A plate along one side of the engine, as long as its block.
        expect(sideMounts(withEngine(0.4, 0.2, 1, { kind: "structure", x: -1.2, y: 0.2, length: 0.4, width: 0.2 }))).toBeGreaterThan(0);
    });
});
