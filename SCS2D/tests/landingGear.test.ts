import { describe, expect, it } from "vitest";
import {
    compileBlueprint,
    DEFAULT_DOCTRINE,
    LANDING_GEAR_COMPLEXITY,
    parseBlueprint,
    serialiseBlueprint,
    type Blueprint,
} from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import { makeBattle } from "../scenarios/battle.js";
import { WORKSHOP } from "../scenarios/carrier.js";
import { CORVETTE, DINKY, KKV } from "../scenarios/blueprints.js";
import { sectionEntries, SHIP_SECTIONS, type DoctrineContext } from "../editor/doctrine.js";
import { mutate } from "../evolution/mutate.js";

/** `blueprint` with every core's landing gear taken off. */
function withoutGear(blueprint: Blueprint): Blueprint {
    return { ...blueprint, modules: blueprint.modules.map((m) => ("kind" in m && m.kind === "core" ? { ...m, landingGear: false } : m)) };
}

const coreComplexity = (blueprint: Blueprint): number => {
    const design = compileBlueprint(blueprint);
    return design.cores.reduce((sum, core) => sum + design.modules[core]!.stats.complexity, 0);
};

describe("landing gear", () => {
    it("makes a fighter's core simpler to build when taken off", () => {
        expect(coreComplexity(withoutGear(DINKY))).toBe(coreComplexity(DINKY) - LANDING_GEAR_COMPLEXITY);
    });

    it("is a fighter's alone: any other ship's core costs what it did without it", () => {
        expect(CORVETTE.fighter).not.toBe(true);
        expect(coreComplexity(withoutGear(CORVETTE))).toBe(coreComplexity(CORVETTE));
    });

    it("is written to a file only when taken off, and read back", () => {
        const file = JSON.stringify(serialiseBlueprint(withoutGear(DINKY)));
        expect(file).toContain('"landingGear":false');
        expect(JSON.stringify(serialiseBlueprint(DINKY))).not.toContain("landingGear");
        expect(coreComplexity(parseBlueprint(JSON.parse(file)))).toBe(coreComplexity(withoutGear(DINKY)));
    });

    it("is off on the stock KKV, which never comes back to a pad", () => {
        const design = compileBlueprint(KKV);
        expect(design.cores.every((core) => design.modules[core]!.spec.landingGear === false)).toBe(true);
    });

    it("lets a fighter short of fuel land on a friend's pad, and without it, it never does", () => {
        const landsWithin = (fighter: Blueprint): boolean => {
            const base = compileBlueprint(fighter).doctrine;
            const thirsty = compileBlueprint({ ...fighter, doctrine: { ...base, approach: { ...base.approach, refuelBelow: 0.5 } } });
            const run = makeBattle({ seed: 3 }, (ships, world) => {
                ships.spawn(world, { design: compileBlueprint(WORKSHOP), x: 0, y: 0 });
                const f = ships.spawn(world, { design: thirsty, x: 300, y: 200, angle: 0 });
                const b = world.bodies.indexOf(ships.body(f));
                for (let m = 0; m < thirsty.modules.length; m++) ships.fuel.vent(b, m, ships.fuel.held(b, m) * 0.7);
                return { f };
            });
            for (let t = 0; t < 90 * 60; t++) {
                run.step();
                if (run.ships.parkedOn[run.f]! >= 0) return true;
            }
            return false;
        };
        expect(landsWithin(DINKY)).toBe(true);
        expect(landsWithin(withoutGear(DINKY))).toBe(false);
    });

    it("hides the doctrine for coming back to a pad from a fighter that cannot", () => {
        const values = { targeting: DEFAULT_DOCTRINE.targeting, approach: { ...DEFAULT_DOCTRINE.approach, refuelBelow: 0.3 } };
        const ship = (lands: boolean): DoctrineContext => ({
            mass: 1000,
            radius: 5,
            reach: 500,
            accelFore: 10,
            accelAft: 10,
            brakeHolding: 10,
            brakeTurned: 10,
            guns: 1,
            fighter: true,
            lands,
        });
        for (const field of ["refuelBelow", "rechargeBelow", "rearmBelow", "repairBelow", "repairArmed", "dockDanger"]) {
            const row = sectionEntries(SHIP_SECTIONS).find((e) => e.field === field)!;
            expect(row.shown?.(values, ship(true)) ?? true).toBe(true);
            expect(row.shown?.(values, ship(false))).toBe(false);
        }
        // What lets a craft leave the pad it was built on stays.
        const launch = sectionEntries(SHIP_SECTIONS).find((e) => e.field === "launchFuel")!;
        expect(launch.shown?.(values, ship(false)) ?? true).toBe(true);
    });

    it("is something evolution takes off a fighter's core, and puts back", () => {
        const rng = new Rng(7);
        const edits: string[] = [];
        let held = DINKY;
        for (let i = 0; i < 400 && !edits.some((e) => e.includes("put back")); i++) {
            const child = mutate(held, rng);
            edits.push(...child.edits);
            held = child.blueprint;
        }
        expect(edits.some((e) => e.includes("landing gear taken off"))).toBe(true);
        expect(edits.some((e) => e.includes("landing gear put back"))).toBe(true);
    });
});
