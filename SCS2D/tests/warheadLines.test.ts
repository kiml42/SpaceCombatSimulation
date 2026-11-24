import { describe, expect, it } from "vitest";
import { WARHEAD_BACKBLAST_SPREAD, warheadBurst, type ModuleSpec, type ModuleStats } from "../sim/index.js";
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
        for (const b of [-60, 60, 120, -120]) expect(all).toContain(b);
        const arc = spray.find((l) => l.bearing === 60)!.width;
        for (const side of spray.filter((l) => Math.abs(l.bearing) > 60 && Math.abs(l.bearing) < 120)) expect(side.width).toBeLessThan(arc);
    });

    it("draws fewer lines in an arc where they would not fit", () => {
        const ahead = bearings(warhead({ fragments: 16, spread: Math.PI / 3 })).filter((b) => Math.abs(b) <= 30);
        expect(ahead.length).toBeLessThan(10);
        expect(ahead[0]).toBe(-30);
        expect(ahead.at(-1)).toBe(30);
    });

    it("draws no more lines in an arc than fragments", () => {
        expect(bearings(warhead({ fragments: 2, spread: Math.PI / 2 })).filter((b) => Math.abs(b) <= 45)).toEqual([-45, 45]);
    });

    it("spokes a spray whose arcs meet evenly", () => {
        const ring = bearings(warhead({ fragments: 16, spread: Math.PI }));
        expect(ring).toHaveLength(12);
        expect(ring[1]! - ring[0]!).toBe(30);
    });

    it("is symmetrical as the blast is: a spray about its axis and end to end, a slug about its axis", () => {
        const mirrored = (spec: ModuleSpec, turn: (b: number) => number): void => {
            const { ends } = warheadLines(spec);
            const at = (x: number, y: number): string => `${(x + 0).toFixed(5)},${(y + 0).toFixed(5)}`.replace(/-0\.00000/g, "0.00000");
            const all = new Set<string>();
            for (let k = 0; k < ends.length; k += 4) all.add(at(ends[k]!, ends[k + 1]!));
            for (let k = 0; k < ends.length; k += 4) {
                const r = Math.hypot(ends[k]!, ends[k + 1]!);
                const b = turn(Math.atan2(ends[k + 1]!, ends[k]!));
                expect(all.has(at(r * Math.cos(b) + 0, r * Math.sin(b) + 0))).toBe(true);
            }
        };
        for (const spread of [Math.PI / 3, Math.PI / 2]) {
            const spray = warhead({ fragments: 16, spread, length: 1, width: 1 });
            mirrored(spray, (b) => -b);
            mirrored(spray, (b) => b + Math.PI);
        }
        mirrored(warhead({ fragments: 1, length: 1, width: 1 }), (b) => -b);
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

    it("draws each as long as its fragments are fast, whatever room the box has that way", () => {
        const spec = warhead({ fragments: 16, spread: Math.PI / 3, length: 2, width: 1 });
        const burst = warheadBurst(spec, { structureMass: 1, fuel: 1 } as ModuleStats, 1, 1);
        const { ends } = warheadLines(spec);
        const span = (k: number): number => Math.hypot(ends[k]! - ends[k + 2]!, ends[k + 1]! - ends[k + 3]!);
        const along = (k: number): number => (Math.atan2(ends[k + 1]!, ends[k]!) * 180) / Math.PI;
        const arcs: number[] = [];
        for (let k = 0; k < ends.length; k += 4) if (Math.abs(along(k)) <= 30.001 || Math.abs(along(k)) >= 149.999) arcs.push(span(k));
        for (const a of arcs) expect(a).toBeCloseTo(arcs[0]!, 9);
        for (let k = 0; k < ends.length; k += 4) expect(span(k)).toBeLessThanOrEqual(arcs[0]! + 1e-9);
        expect(burst.sideSpeed).toBeGreaterThan(0);
    });

    it("draws a slug's slug short and thick, and its jet long and thin in front of it", () => {
        const { ends, widths } = warheadLines(warhead({ fragments: 1 }));
        const ahead: { inner: number; outer: number; width: number }[] = [];
        for (let k = 0; k < ends.length; k += 4)
            if (Math.abs(ends[k + 1]!) < 1e-9 && ends[k]! > 0) ahead.push({ outer: ends[k]!, inner: ends[k + 2]!, width: widths[k / 4]! });
        expect(ahead).toHaveLength(2);
        const [slug, jet] = ahead.sort((p, q) => p.inner - q.inner);
        expect(jet!.inner - jet!.width / 2).toBeGreaterThan(slug!.outer + slug!.width / 2);
        expect(jet!.outer - jet!.inner).toBeGreaterThan(slug!.outer - slug!.inner);
        expect(jet!.width).toBeLessThan(slug!.width);
        expect(Math.max(...widths)).toBe(slug!.width);
    });

    it("thickens with the casing", () => {
        const widest = (spec: ModuleSpec): number => Math.max(...warheadLines(spec).widths);
        expect(widest(warhead({ fragments: 1, reinforcement: 2 }))).toBeGreaterThan(widest(warhead({ fragments: 1 })));
    });
});
