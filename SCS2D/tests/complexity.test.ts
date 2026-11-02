import { describe, expect, it } from "vitest";
import {
    COMPLEXITY_WORK,
    complexityOf,
    engineGeometry,
    isPressureFed,
    moduleStats,
    PRESSURE_FED_EXHAUST,
    type ModuleSpec,
} from "../sim/modules.js";
import { DAMAGE_ENERGY_PER_KG, repairWork } from "../sim/damage.js";
import { buildWork, fittingOf } from "../sim/rebuild.js";

const engine = (length: number, width: number, barrels = 1): ModuleSpec => ({ kind: "engine", x: 0, y: 0, length, width, barrels });

describe("complexity", () => {
    it("rates a core above a turret, a turret above a hull gun, and a tank lowest", () => {
        const at = (kind: ModuleSpec["kind"]): number => complexityOf({ kind, x: 0, y: 0, length: 4, width: 4 });
        expect(at("core")).toBeGreaterThan(at("turret"));
        expect(at("turret")).toBeGreaterThan(at("hullGun"));
        expect(at("hullGun")).toBeGreaterThan(at("tank"));
        expect(at("tank")).toBe(at("structure"));
    });

    it("rises with a sealing lining, and with every nozzle past the first", () => {
        const tank: ModuleSpec = { kind: "tank", x: 0, y: 0, length: 4, width: 4 };
        expect(complexityOf({ ...tank, sealing: 0.02 })).toBeGreaterThan(complexityOf(tank));
        expect(complexityOf(engine(4, 4, 3))).toBe(complexityOf(engine(4, 4)) + 2);
    });

    it("is the same whatever the size, so it swamps a small part and hardly shows on a big one", () => {
        const small = moduleStats(engine(0.1, 0.5));
        const big = moduleStats(engine(4, 6));
        expect(small.complexity).toBe(big.complexity);
        expect(buildWork(small) / DAMAGE_ENERGY_PER_KG).toBeGreaterThan(5);
        expect(buildWork(big) / DAMAGE_ENERGY_PER_KG).toBeLessThan(1.2);
    });

    it("adds up to the module complexity over a whole build, and over mending a break", () => {
        const stats = moduleStats(engine(1, 0.8));
        const kg = stats.structureMass + fittingOf(stats);
        expect(buildWork(stats) * kg).toBeCloseTo(kg * DAMAGE_ENERGY_PER_KG + stats.complexity * COMPLEXITY_WORK, 3);
        const capacity = stats.hitPoints * DAMAGE_ENERGY_PER_KG;
        expect(repairWork(stats) * capacity).toBeCloseTo(capacity + stats.complexity * COMPLEXITY_WORK, 3);
    });

    it("is less for an engine too small for pumps, which is a step worse in exhaust velocity", () => {
        // Either side of the cut-off: the same engine but a little narrower.
        const pumped = engine(0.5, 0.46);
        const fed = engine(0.5, 0.44);
        expect(isPressureFed(engineGeometry(pumped))).toBe(false);
        expect(isPressureFed(engineGeometry(fed))).toBe(true);
        expect(complexityOf(fed)).toBe(1);
        expect(complexityOf(pumped)).toBe(4);
        const a = moduleStats(pumped);
        const b = moduleStats(fed);
        // Thrust goes by the exit's area alone.
        expect(b.thrust / a.thrust).toBeCloseTo((0.44 / 0.46) ** 2, 1);
        expect(b.exhaustVelocity / a.exhaustVelocity).toBeCloseTo(PRESSURE_FED_EXHAUST, 1);
    });
});
