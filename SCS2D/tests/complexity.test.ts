import { describe, expect, it } from "vitest";
import {
    COMPLEXITY_WORK,
    complexityOf,
    engineGeometry,
    isPressureFed,
    moduleStats,
    PRESSURE_FED_BLOCK,
    PRESSURE_FED_EXHAUST,
    PRESSURE_FED_FLOW,
    PRESSURE_FED_MASS,
    bellWallArea,
    BELL_MASS_PER_AREA,
    PRESSURE_FED_BELL,
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
        const small = moduleStats(engine(0.3, 0.5));
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

    it("is less for an engine too small for pumps, which is a step worse in thrust and exhaust velocity", () => {
        // Either side of the cut-off: the same engine but a little narrower.
        const pumped = engine(0.5, 0.46);
        const fed = engine(0.5, 0.44);
        expect(isPressureFed(engineGeometry(pumped))).toBe(false);
        expect(isPressureFed(engineGeometry(fed))).toBe(true);
        expect(complexityOf(fed)).toBe(1);
        expect(complexityOf(pumped)).toBe(4);
        const a = moduleStats(pumped);
        const b = moduleStats(fed);
        // Area alone would give the narrower one 0.44² / 0.46² of the thrust.
        expect(b.thrust / a.thrust).toBeCloseTo(PRESSURE_FED_FLOW * (0.44 / 0.46) ** 2, 1);
        expect(b.exhaustVelocity / a.exhaustVelocity).toBeCloseTo(PRESSURE_FED_EXHAUST, 1);
    });

    it("is less for a big engine with too short a block for pumps, which is lighter for it", () => {
        // Wide enough to be pumped by its throat, with a block either side of the cut-off.
        const pumped = engine(0.4, 2);
        const fed = engine(0.2, 2);
        expect(engineGeometry(pumped).machineryLength).toBeGreaterThan(PRESSURE_FED_BLOCK);
        expect(engineGeometry(fed).machineryLength).toBeLessThan(PRESSURE_FED_BLOCK);
        expect(isPressureFed(engineGeometry(pumped))).toBe(false);
        expect(isPressureFed(engineGeometry(fed))).toBe(true);
        expect(complexityOf(fed)).toBe(1);
        // Its machinery, sized by the flow, weighs a share of a pumped one's.
        const a = moduleStats(pumped);
        const b = moduleStats(fed);
        // Less its bell, which weighs by its own sheet rather than by the flow.
        const machinery = (spec: ModuleSpec, stats: typeof a): number => {
            const g = engineGeometry(spec);
            return stats.fittingMass - bellWallArea(g) * BELL_MASS_PER_AREA * (isPressureFed(g) ? PRESSURE_FED_BELL : 1);
        };
        expect(machinery(fed, b) / b.thrust / (machinery(pumped, a) / a.thrust)).toBeLessThan(PRESSURE_FED_MASS * 1.5);
    });
});
