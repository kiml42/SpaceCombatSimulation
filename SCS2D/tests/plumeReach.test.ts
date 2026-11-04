import { describe, expect, it } from "vitest";
import { compileBlueprint, engineGeometry, nozzleReach, type ShipView } from "../sim/index.js";
import { CORVETTE } from "../scenarios/blueprints.js";
import { plumeReach } from "../render/canvas2d.js";

/** How far a ship's plumes reach, so one whose hull is out of view still draws a plume reaching into it. */
describe("how far a ship's plumes reach", () => {
    const design = compileBlueprint(CORVETTE);
    const ship = (throttle: number): ShipView =>
        ({ currentStructure: design, throttles: design.engines.map(() => throttle) }) as unknown as ShipView;

    it("is nothing with every engine cold, and its longest plume's reach at full", () => {
        expect(plumeReach(ship(0))).toBe(0);
        let longest = 0;
        let t = 0;
        for (const m of design.modules) {
            if (m.spec.kind !== "engine") continue;
            longest = Math.max(longest, nozzleReach(engineGeometry(m.spec), design.engines[t++]!.maxThrust));
        }
        expect(longest).toBeGreaterThan(design.radius);
        expect(plumeReach(ship(1))).toBe(longest);
    });
});
