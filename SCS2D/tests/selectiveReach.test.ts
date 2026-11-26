import { describe, expect, it } from "vitest";
import { reachAt } from "../sim/shipAim.js";
import { disarm } from "../scenarios/disarm.js";
import { duel } from "../scenarios/duel.js";
import { RAIL_CORVETTE } from "../scenarios/blueprints.js";

describe("how far a ship fights from", () => {
    it("is as far as its guns fire at the part they are aimed at, where they mind what they hit", () => {
        // Two Rail Corvettes told to break a Gunship's guns and spare the rest; the Gunship is ship 2.
        const run = disarm(1, RAIL_CORVETTE, 2);
        for (let s = 0; s < 120; s++) run.step();
        const reach = reachAt(run.ships, 0, 2);
        expect(reach).toBeGreaterThan(0);
        expect(reach).toBeLessThan(run.ships.currentStructure(0).reach);
    });

    it("is its design's reach where its guns will hit anything", () => {
        const run = duel();
        for (let s = 0; s < 120; s++) run.step();
        expect(reachAt(run.ships, 0, 1)).toBe(run.ships.currentStructure(0).reach);
    });
});
