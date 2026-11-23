import { describe, expect, it } from "vitest";
import { compileBlueprint, moduleRadius, type Blueprint } from "../sim/index.js";
import { HullPath, modulesAlong } from "../sim/hull.js";
import { aimRadius } from "../sim/modules.js";
import { aimSpot } from "../sim/shipAim.js";
import { BEAM_GUNSHIP, GUNSHIP } from "../scenarios/blueprints.js";

/**
 * A hull weapon meets a round with its block and the barrels or lenses out of
 * it, not the sky between them, so a shot meant for it is aimed at its block
 * and allowed that block's size either side.
 */

/** Whether a line across the hull weapon of kind `kind`, through where it is aimed and through its box's centre, meets it. */
function across(blueprint: Blueprint, kind: string): { spot: boolean; centre: boolean; radius: number; box: number } {
    const design = compileBlueprint(blueprint);
    const k = design.modules.findIndex((m) => m.spec.kind === kind);
    const module = design.modules[k]!;
    const ax = -Math.sin(module.angle) * 100;
    const ay = Math.cos(module.angle) * 100;
    const path = new HullPath();
    const meets = (x: number, y: number): boolean => {
        modulesAlong(design, x - ax, y - ay, x + ax, y + ay, path);
        for (let n = 0; n < path.count; n++) if (path.module[n] === k) return true;
        return false;
    };
    const spot = { x: 0, y: 0 };
    aimSpot(design, k, spot);
    return {
        spot: meets(spot.x, spot.y),
        centre: meets(module.x, module.y),
        radius: aimRadius(module.spec),
        box: moduleRadius(module.spec),
    };
}

describe("aiming at a hull weapon", () => {
    it("aims at a hull beam's block, and allows only its size", () => {
        const { spot, radius, box } = across(BEAM_GUNSHIP, "hullBeam");
        expect(spot).toBe(true);
        expect(radius).toBeLessThan(box);
    });

    it("aims at a hull gun's block, and allows only its size", () => {
        const { spot, radius, box } = across(GUNSHIP, "hullGun");
        expect(spot).toBe(true);
        expect(radius).toBeLessThan(box);
    });
});
