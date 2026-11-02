import { describe, expect, it } from "vitest";
import { compileBlueprint } from "../sim/index.js";
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

    it("is left out where it would be under a pixel", () => {
        expect(wearShows(20, 50)).toBe(true);
        expect(wearShows(20, 0.5)).toBe(false);
    });
});
