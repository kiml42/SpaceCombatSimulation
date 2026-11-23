import { describe, expect, it } from "vitest";
import type { ModuleSpec } from "../sim/index.js";
import { warheadLines } from "../render/moduleFills.js";

const warhead = (extra: Partial<ModuleSpec>): ModuleSpec => ({ kind: "warhead", length: 2, width: 1, ...extra }) as ModuleSpec;

/** Each line's bearing out from the middle, degrees, and how far out its outer end is. */
function lines(spec: ModuleSpec): { bearing: number; outer: number; inner: number }[] {
    const { ends } = warheadLines(spec);
    const out = [];
    for (let k = 0; k < ends.length; k += 4) {
        out.push({
            bearing: (Math.atan2(ends[k + 1]!, ends[k]!) * 180) / Math.PI,
            outer: Math.hypot(ends[k]!, ends[k + 1]!),
            inner: Math.hypot(ends[k + 2]!, ends[k + 3]!),
        });
    }
    return out;
}

describe("a warhead's fragment lines", () => {
    it("draws a single slug as one line down its centre line", () => {
        const [line, ...rest] = lines(warhead({ fragments: 1 }));
        expect(rest).toHaveLength(0);
        expect(line!.bearing).toBeCloseTo(0);
        expect(line!.outer).toBeGreaterThan(line!.inner);
    });

    it("puts a fan's outer lines at the edges of its spread", () => {
        const fan = lines(warhead({ fragments: 16, spread: (2 * Math.PI) / 3, length: 4, width: 4 }));
        expect(fan).toHaveLength(5);
        expect(fan[0]!.bearing).toBeCloseTo(-60);
        expect(fan[2]!.bearing).toBeCloseTo(0);
        expect(fan[4]!.bearing).toBeCloseTo(60);
    });

    it("draws fewer lines where they would not fit", () => {
        const fan = lines(warhead({ fragments: 16, spread: Math.PI / 3 }));
        expect(fan.length).toBeLessThan(5);
        expect(fan[0]!.bearing).toBeCloseTo(-30);
        expect(fan.at(-1)!.bearing).toBeCloseTo(30);
    });

    it("draws no more lines than fragments", () => {
        expect(lines(warhead({ fragments: 2, spread: Math.PI / 2 })).map((l) => Math.round(l.bearing))).toEqual([-45, 45]);
    });

    it("spokes an all-round burst evenly", () => {
        const ring = lines(warhead({ fragments: 16, spread: 2 * Math.PI }));
        expect(ring).toHaveLength(6);
        expect(ring[1]!.bearing - ring[0]!.bearing).toBeCloseTo(60);
    });

    it("keeps every line, round ends and all, inside the module", () => {
        const spec = warhead({ fragments: 16, spread: 2 * Math.PI, reinforcement: 3 });
        const { width, ends } = warheadLines(spec);
        for (let k = 0; k < ends.length; k += 2) {
            expect(Math.abs(ends[k]!) + width / 2).toBeLessThanOrEqual(spec.length / 2);
            expect(Math.abs(ends[k + 1]!) + width / 2).toBeLessThanOrEqual(spec.width / 2);
        }
    });

    it("keeps neighbouring lines apart, a narrow fan's by narrowing them", () => {
        for (const spread of [Math.PI / 3, Math.PI / 18, 2 * Math.PI]) {
            const { width, ends } = warheadLines(warhead({ fragments: 16, spread, reinforcement: 2 }));
            for (let k = 4; k < ends.length; k += 4) {
                const apart = Math.hypot(ends[k + 2]! - ends[k - 2]!, ends[k + 3]! - ends[k - 1]!);
                expect(apart).toBeGreaterThan(width);
            }
        }
    });

    it("thickens with the casing", () => {
        expect(warheadLines(warhead({ reinforcement: 2 })).width).toBeGreaterThan(warheadLines(warhead({})).width);
    });
});
