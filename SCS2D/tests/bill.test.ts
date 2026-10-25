import { describe, expect, it } from "vitest";
import {
    billOf,
    budgetMass,
    compileBlueprint,
    COMPLEXITY_WORK,
    DAMAGE_ENERGY_PER_KG,
    ROBOT_REPAIR_RATE,
    type Blueprint,
} from "../sim/index.js";
import { CORVETTE, DINKY } from "../scenarios/blueprints.js";

/** What a design costs a budget: metal, fuel and the time to build it (ROADMAP.md §8 step 8). */

/** A core, a tank, a hold and a battery, each as full as asked. */
function depot(tank = 1, hold = 1, battery = 1): Blueprint {
    return {
        name: "Depot",
        modules: [
            { kind: "core", x: 0, y: 0, length: 4, width: 4 },
            { kind: "tank", x: -4, y: 0, length: 4, width: 4, fill: tank },
            { kind: "hold", x: 4, y: 0, length: 4, width: 4, fill: hold },
            { kind: "battery", x: 0, y: 4, length: 4, width: 4, fill: battery },
        ],
    };
}

describe("a bill", () => {
    it("splits what a ship sets out weighing into metal and fuel", () => {
        for (const blueprint of [CORVETTE, DINKY, depot(0.3, 0.6)]) {
            const design = compileBlueprint(blueprint);
            const bill = billOf(design);
            expect(bill.metal + bill.fuel).toBeCloseTo(budgetMass(design), 6);
            expect(bill.fuel).toBeGreaterThan(0);
        }
    });

    it("counts fuel and metal only as full as they start, and charge not at all", () => {
        const full = billOf(compileBlueprint(depot()));
        const tank = compileBlueprint(depot()).modules[1]!.stats.fuel;
        const hold = compileBlueprint(depot()).modules[2]!.stats.metal;
        const part = billOf(compileBlueprint(depot(0.25, 0.5)));
        expect(full.fuel - part.fuel).toBeCloseTo(tank * 0.75, 6);
        expect(full.metal - part.metal).toBeCloseTo(hold * 0.5, 6);
        expect(billOf(compileBlueprint(depot(1, 1, 0)))).toEqual(full);
    });

    it("times every module as one robot would build it", () => {
        const design = compileBlueprint(depot());
        let work = 0;
        // No robot bay, so every kilogram of fittings is built.
        for (const { stats } of design.modules) {
            const kg = stats.structureMass + stats.fittingMass;
            work += kg * DAMAGE_ENERGY_PER_KG + stats.complexity * COMPLEXITY_WORK;
        }
        expect(billOf(design).build).toBeCloseTo(work / ROBOT_REPAIR_RATE, 6);
    });

    it("includes the fighters a carrier sets out with", () => {
        const blueprint: Blueprint = {
            name: "Carrier",
            modules: [
                { kind: "core", x: 0, y: 0, length: 6, width: 6 },
                { kind: "pad", x: 13, y: 0, length: 20, width: 20, craft: "Dinky", docked: true },
            ],
            hangar: { Dinky: DINKY },
        };
        const bare = billOf(
            compileBlueprint({
                ...blueprint,
                modules: blueprint.modules.map((m) => ({ ...m, docked: undefined })) as Blueprint["modules"],
            }),
        );
        const dinky = billOf(compileBlueprint(DINKY));
        const laden = billOf(compileBlueprint(blueprint));
        expect(laden.metal).toBeCloseTo(bare.metal + dinky.metal, 6);
        expect(laden.fuel).toBeCloseTo(bare.fuel + dinky.fuel, 6);
        expect(laden.build).toBeCloseTo(bare.build + dinky.build, 6);
    });
});
