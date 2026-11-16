import { describe, expect, it } from "vitest";
import { compileBlueprint, isThick, originOf, shellOf, type ShipDesign } from "../sim/index.js";
import { rebuiltDesign } from "../sim/blueprint.js";
import { CORVETTE } from "../scenarios/blueprints.js";
import { WEAR_LEVELS, wearField, wearLevel, wearSeed, wearShows, wearTransform } from "../render/wear.js";

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

    it("runs on unbroken across a layer, and lies differently on the thick one", () => {
        const corvette = compileBlueprint(CORVETTE);
        // Where texel (u, v) lies in the design's frame, as module i lays it.
        const at = (i: number, u: number, v: number): [number, number] => {
            const t = wearTransform(corvette, i);
            const m = corvette.modules[i]!;
            const x = t.a * u + t.c * v + t.e;
            const y = t.b * u + t.d * v + t.f;
            const c = Math.cos(m.angle);
            const s = Math.sin(m.angle);
            return [m.x + x * c - y * s, m.y + x * s + y * c];
        };
        const thick = corvette.modules.flatMap((m, i) => (isThick(m.spec) ? [i] : []));
        const hull = corvette.modules.flatMap((m, i) => (isThick(m.spec) ? [] : [i]));
        expect(thick.length).toBeGreaterThan(0);
        expect(hull.length).toBeGreaterThan(1);
        for (const layer of [hull, thick]) {
            const [x, y] = at(layer[0]!, 40, 70);
            for (const i of layer) {
                expect(at(i, 40, 70)[0]).toBeCloseTo(x, 6);
                expect(at(i, 40, 70)[1]).toBeCloseTo(y, 6);
            }
        }
        expect(at(thick[0]!, 40, 70)[0]).not.toBeCloseTo(at(hull[0]!, 40, 70)[0], 3);
    });

    it("lies differently on each ship, and the same on a piece of one", () => {
        const corvette = compileBlueprint(CORVETTE);
        const one = wearSeed({ team: 0, serial: 1 });
        const two = wearSeed({ team: 0, serial: 2 });
        const other = wearSeed({ team: 1, serial: 1 });
        expect(new Set([one, two, other]).size).toBe(3);
        const at = (seed: number): number[] => {
            const t = wearTransform(corvette, 0, seed);
            return [t.e, t.f];
        };
        expect(at(one)).not.toEqual(at(two));
        expect(at(one)).not.toEqual(at(other));
        expect(at(wearSeed({ team: 0, serial: 1 }))).toEqual(at(one));
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
