import { describe, expect, it } from "vitest";
import { torpedoBoat } from "../scenarios/torpedoBoat.js";

describe("the Torpedo Boat scene", () => {
    it("builds torpedoes behind its rock, and they reach the Gunship", () => {
        const battle = torpedoBoat();
        const { ships } = battle;
        const boat = 1;
        const gunship = 3;
        let hit = false;
        for (let s = 0; s < 150 * 60; s++) {
            battle.step();
            const credit = battle.credit;
            for (let h = 0; h < credit.count; h++) {
                const by = ships.attackerOf(credit, h);
                if (by > gunship && ships.teamOf(by) === 0 && ships.pilotAt(credit.victim[h]!) === gunship) hit = true;
            }
        }
        let built = 0;
        for (let i = gunship + 1; i < ships.count; i++)
            if (ships.teamOf(i) === ships.teamOf(boat) && ships.launched[i]?.name === "Torpedo") built++;
        expect(built).toBeGreaterThanOrEqual(2);
        expect(hit).toBe(true);
    });
});
