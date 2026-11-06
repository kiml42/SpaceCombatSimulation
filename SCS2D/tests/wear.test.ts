import { describe, expect, it } from "vitest";
import { compileBlueprint, originOf, shellOf, type ShipDesign } from "../sim/index.js";
import { rebuiltDesign } from "../sim/blueprint.js";
import { CORVETTE } from "../scenarios/blueprints.js";
import { WEAR_LEVELS, wearField, wearLevel, wearShows, wearTransform } from "../render/wear.js";

describe("wear", () => {
    it("shows none on a whole module and all of it on a destroyed one", () => {
        expect(wearLevel(1)).toBe(0);
        expect(wearLevel(0.999)).toBe(1);
        expect(wearLevel(0.5)).toBe(WEAR_LEVELS / 2);
        expect(wearLevel(0)).toBe(WEAR_LEVELS);
        expect(wearLevel(-1)).toBe(WEAR_LEVELS);
    });

    it("spreads as damage rises, most of a tile by the time a module is destroyed", () => {
        const field = wearField();
        const shown = (level: number): number => field.filter((t) => t.threshold < level / WEAR_LEVELS).length;
        for (let level = 1; level < WEAR_LEVELS; level++) expect(shown(level + 1)).toBeGreaterThanOrEqual(shown(level));
        expect(shown(1)).toBeGreaterThan(0);
        expect(shown(WEAR_LEVELS / 4)).toBeLessThan(field.length / 2);
        expect(shown(WEAR_LEVELS)).toBeGreaterThan(field.length * 0.8);
    });

    it("lies differently on each module", () => {
        const corvette = compileBlueprint(CORVETTE);
        const a = wearTransform(corvette, 0);
        const b = wearTransform(corvette, 1);
        expect([a.e, a.f]).not.toEqual([b.e, b.f]);
        expect(wearTransform(corvette, 0)).toEqual(a);
    });

    it("stays where it was on a module part taken down", () => {
        const corvette = compileBlueprint(CORVETTE);
        const m = 0;
        const k = 1;
        const whole = corvette.modules[m]!;
        const share = 0.4;
        const part = shellOf(whole.spec, whole.stats, 0, share);
        const shelled = rebuiltDesign(corvette, m, part.spec, part.stats, originOf(corvette, m), { share, face: 0 });
        // Where a texel lies in the design's frame, from module k, which is unchanged.
        const fromK = (design: ShipDesign, u: number, v: number): [number, number] => {
            const t = wearTransform(design, m);
            const at = design.modules[m]!;
            const x = t.a * u + t.c * v + t.e;
            const y = t.b * u + t.d * v + t.f;
            const c = Math.cos(at.angle);
            const s = Math.sin(at.angle);
            return [at.x + x * c - y * s - design.modules[k]!.x, at.y + x * s + y * c - design.modules[k]!.y];
        };
        expect(shelled.modules[m]!.x).not.toBeCloseTo(whole.x, 3);
        for (const [u, v] of [
            [0, 0],
            [50, 20],
        ] as const) {
            const [wx, wy] = fromK(corvette, u, v);
            const [sx, sy] = fromK(shelled, u, v);
            expect(sx).toBeCloseTo(wx, 6);
            expect(sy).toBeCloseTo(wy, 6);
        }
    });

    it("is left out where it would be under a pixel", () => {
        expect(wearShows(20, 50)).toBe(true);
        expect(wearShows(20, 0.5)).toBe(false);
    });
});
