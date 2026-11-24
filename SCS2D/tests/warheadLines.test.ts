import { describe, expect, it } from "vitest";
import { WARHEAD_BACKBLAST_SPREAD, type ModuleSpec } from "../sim/index.js";
import { warheadLines } from "../render/moduleFills.js";

const warhead = (extra: Partial<ModuleSpec>): ModuleSpec => ({ kind: "warhead", length: 2, width: 1, ...extra }) as ModuleSpec;

/** Each line's bearing out from the middle, degrees in (-180, 180], and its width. */
function lines(spec: ModuleSpec): { bearing: number; width: number }[] {
    const { ends, widths } = warheadLines(spec);
    const out = [];
    for (let k = 0; k < ends.length; k += 4) {
        out.push({ bearing: Math.round((Math.atan2(ends[k + 1]!, ends[k]!) * 180) / Math.PI), width: widths[k / 4]! });
    }
    return out;
}

const bearings = (spec: ModuleSpec): number[] =>
    lines(spec)
        .map((l) => l.bearing)
        .sort((a, b) => a - b);

describe("a warhead's fragment lines", () => {
    it("draws a slug down its centre line, its back plate behind, and lighter sides", () => {
        const slug = lines(warhead({ fragments: 1 }));
        const ahead = slug.find((l) => l.bearing === 0)!;
        expect(ahead).toBeDefined();
        const edge = 180 - (WARHEAD_BACKBLAST_SPREAD * 90) / Math.PI;
        expect(slug.some((l) => Math.abs(l.bearing) === edge)).toBe(true);
        const sides = slug.filter((l) => Math.abs(l.bearing) > 0 && Math.abs(l.bearing) < edge);
        expect(sides.length).toBeGreaterThan(0);
        for (const side of sides) expect(side.width).toBeLessThan(ahead.width);
    });

    it("draws a spray's arc both ways, its outer lines at its edges, and lighter sides", () => {
        const spray = lines(warhead({ fragments: 16, spread: (2 * Math.PI) / 3, length: 4, width: 4 }));
        const all = spray.map((l) => l.bearing);
        for (const b of [-60, 0, 60, 120, 180, -120]) expect(all).toContain(b);
        const arc = spray.find((l) => l.bearing === 0)!.width;
        for (const side of spray.filter((l) => Math.abs(l.bearing) > 60 && Math.abs(l.bearing) < 120)) expect(side.width).toBeLessThan(arc);
    });

    it("draws fewer lines in an arc where they would not fit", () => {
        const ahead = bearings(warhead({ fragments: 16, spread: Math.PI / 3 })).filter((b) => Math.abs(b) <= 30);
        expect(ahead.length).toBeLessThan(5);
        expect(ahead[0]).toBe(-30);
        expect(ahead.at(-1)).toBe(30);
    });

    it("draws no more lines in an arc than fragments", () => {
        expect(bearings(warhead({ fragments: 2, spread: Math.PI / 2 })).filter((b) => Math.abs(b) <= 45)).toEqual([-45, 45]);
    });

    it("spokes a spray whose arcs meet evenly", () => {
        const ring = bearings(warhead({ fragments: 16, spread: Math.PI }));
        expect(ring).toHaveLength(6);
        expect(ring[1]! - ring[0]!).toBe(60);
    });

    it("keeps every line, round ends and all, inside the module", () => {
        for (const extra of [{ fragments: 16, spread: 2 * Math.PI }, { fragments: 1 }, { fragments: 16 }]) {
            const spec = warhead({ ...extra, reinforcement: 3 });
            const { widths, ends } = warheadLines(spec);
            for (let k = 0; k < ends.length; k += 2) {
                const half = widths[Math.floor(k / 4)]! / 2;
                expect(Math.abs(ends[k]!) + half).toBeLessThanOrEqual(spec.length / 2 + 1e-9);
                expect(Math.abs(ends[k + 1]!) + half).toBeLessThanOrEqual(spec.width / 2 + 1e-9);
            }
        }
    });

    it("keeps neighbouring lines apart", () => {
        for (const extra of [{ spread: Math.PI / 3 }, { spread: Math.PI / 18 }, { spread: 2 * Math.PI }, { fragments: 1 }]) {
            const { widths, ends } = warheadLines(warhead({ fragments: 16, ...extra, reinforcement: 2 }));
            const n = ends.length / 4;
            for (let i = 0; i < n; i++)
                for (let j = i + 1; j < n; j++) {
                    const apart = Math.hypot(ends[4 * i + 2]! - ends[4 * j + 2]!, ends[4 * i + 3]! - ends[4 * j + 3]!);
                    expect(apart).toBeGreaterThan((widths[i]! + widths[j]!) / 2);
                }
        }
    });

    it("thickens with the casing", () => {
        const widest = (spec: ModuleSpec): number => Math.max(...warheadLines(spec).widths);
        expect(widest(warhead({ fragments: 1, reinforcement: 2 }))).toBeGreaterThan(widest(warhead({ fragments: 1 })));
    });
});
