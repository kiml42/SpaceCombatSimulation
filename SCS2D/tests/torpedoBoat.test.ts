import { describe, expect, it } from "vitest";
import { torpedoBoat } from "../scenarios/torpedoBoat.js";

describe("the Torpedo Boat scene", () => {
    it("hides the boat behind its rock by doctrine, and builds torpedoes there that go for the Gunship, which goes for the boat", () => {
        const battle = torpedoBoat();
        const { ships } = battle;
        const rock = 0;
        const boat = 1;
        const gunship = 3;
        const after = new Set<number>();
        for (let s = 0; s < 150 * 60; s++) {
            battle.step();
            expect(ships.doingOf(gunship)).toEqual({ kind: "attack", target: boat });
            // From its first look round, which a ship is given a moment to take.
            if (s >= 60) expect(ships.doingOf(boat)).toEqual({ kind: "hide", target: rock });
            for (let i = gunship + 1; i < ships.count; i++) if (ships.chosen[i] === gunship) after.add(i);
        }
        let built = 0;
        for (let i = gunship + 1; i < ships.count; i++) if (ships.launched[i]?.name === "Torpedo") built++;
        expect(built).toBeGreaterThanOrEqual(2);
        expect(after.size).toBeGreaterThanOrEqual(2);
    });
});
