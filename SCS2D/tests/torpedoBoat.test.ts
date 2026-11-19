import { describe, expect, it } from "vitest";
import { torpedoBoat } from "../scenarios/torpedoBoat.js";

describe("the Torpedo Boat scene", () => {
    it("builds torpedoes behind its rock that go for the Gunship, while the Gunship goes for the boat", () => {
        const battle = torpedoBoat();
        const { ships } = battle;
        const boat = 1;
        const gunship = 3;
        const after = new Set<number>();
        for (let s = 0; s < 150 * 60; s++) {
            battle.step();
            expect(ships.doingOf(gunship)).toEqual({ kind: "attack", target: boat });
            for (let i = gunship + 1; i < ships.count; i++) if (ships.chosen[i] === gunship) after.add(i);
        }
        let built = 0;
        for (let i = gunship + 1; i < ships.count; i++) if (ships.launched[i]?.name === "Torpedo") built++;
        expect(built).toBeGreaterThanOrEqual(2);
        expect(after.size).toBeGreaterThanOrEqual(2);
    });
});
