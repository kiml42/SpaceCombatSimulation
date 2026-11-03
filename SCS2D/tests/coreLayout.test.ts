import { describe, expect, it } from "vitest";
import {
    complexityOf,
    CORE_BATTERY_LEAST,
    CORE_COMPUTING_VOLUME,
    CORE_FUEL_LEAST,
    CORE_GENERATOR_LEAST,
    CORE_HOLD_LEAST,
    coreLayout,
    moduleStats,
    type ModuleSpec,
} from "../sim/modules.js";

const core = (extra: Partial<ModuleSpec> = {}): ModuleSpec => ({ kind: "core", x: 0, y: 0, length: 1, width: 1, ...extra });

/** The stores a core of `interior` m³ holds, in the order they step in. */
const held = (spec: ModuleSpec, interior: number): boolean[] => {
    const layout = coreLayout(spec, interior);
    return [layout.fuel > 0, layout.hold > 0, layout.generator > 0, layout.battery > 0];
};

describe("a core's stores", () => {
    it("are none up to its computing volume, so a core that small is all computing", () => {
        const layout = coreLayout(core(), CORE_COMPUTING_VOLUME);
        expect(layout.computing).toBe(CORE_COMPUTING_VOLUME);
        expect(held(core(), CORE_COMPUTING_VOLUME)).toEqual([false, false, false, false]);
    });

    it("step in one at a time as it grows, fuel, a hold, a generator and a battery, each worth having when it does", () => {
        const seen: string[] = [];
        let last = "";
        for (let interior = 0.4; interior < 40; interior *= 1.01) {
            const now = held(core(), interior);
            const key = now.map((has) => (has ? 1 : 0)).join("");
            if (key !== last) seen.push(key);
            last = key;
            const layout = coreLayout(core(), interior);
            // Never a store smaller than it is worth having.
            if (layout.fuel > 0) expect(layout.fuel).toBeGreaterThanOrEqual(CORE_FUEL_LEAST - 1e-9);
            if (layout.hold > 0) expect(layout.hold).toBeGreaterThanOrEqual(CORE_HOLD_LEAST - 1e-9);
            if (layout.generator > 0) expect(layout.generator).toBeGreaterThanOrEqual(CORE_GENERATOR_LEAST - 1e-9);
            if (layout.battery > 0) expect(layout.battery).toBeGreaterThanOrEqual(CORE_BATTERY_LEAST - 1e-9);
            expect(layout.computing + layout.fuel + layout.hold + layout.generator + layout.battery).toBeCloseTo(interior, 9);
        }
        expect(seen).toEqual(["0000", "1000", "1100", "1110", "1111"]);
    });

    it("are as set when set, however small, and left out at 0", () => {
        const interior = 0.6;
        expect(held(core(), interior)).toEqual([false, false, false, false]);
        expect(held(core({ batteryShare: 1 }), interior)).toEqual([false, false, false, true]);
        const big = 30;
        expect(held(core({ holdShare: 0 }), big)).toEqual([true, false, true, true]);
        // Weights, scaled to fill the room past its computing.
        const layout = coreLayout(core({ fuelShare: 3, holdShare: 1, generatorShare: 0, batteryShare: 0 }), 10);
        expect(layout.fuel / layout.hold).toBeCloseTo(3, 9);
    });

    it("make it simpler by what it leaves out: computing 8, fuel and a hold 1 each, a generator 4 and a battery 2", () => {
        const at = (spec: ModuleSpec): number => moduleStats(spec).complexity;
        expect(at(core({ length: 0.6, width: 0.6 }))).toBe(8);
        expect(at(core({ length: 20, width: 20 }))).toBe(16);
        expect(at(core({ length: 20, width: 20, generatorShare: 0 }))).toBe(12);
        expect(at(core({ length: 20, width: 20, batteryShare: 0, holdShare: 0 }))).toBe(13);
        // Without a layout to go on, a core is reckoned as full.
        expect(complexityOf(core())).toBe(16);
    });
});
