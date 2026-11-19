import { describe, expect, it } from "vitest";
import { torpedoBoat } from "../scenarios/torpedoBoat.js";

describe("the Torpedo Boat scene", () => {
    it("hides the boat behind its rock, and builds torpedoes there that go for the Gunship, which goes for the boat, all by doctrine", () => {
        const battle = torpedoBoat();
        const { ships } = battle;
        const rock = 0;
        const boat = 1;
        const gunship = 3;
        // The one docked on its pad from the start, and whatever the pad builds.
        const torpedoes = (): number[] => {
            const all: number[] = [];
            for (let i = 0; i < ships.count; i++) if (ships.teamOf(i) === ships.teamOf(boat) && i !== boat) all.push(i);
            return all;
        };
        const built = new Set<number>();
        const after = new Set<number>();
        for (let s = 0; s < 150 * 60; s++) {
            battle.step();
            // From each ship's first look round, which it is given a moment to take.
            if (s >= 60) {
                expect(ships.doingOf(gunship)).toEqual({ kind: "attack", target: boat });
                expect(ships.doingOf(boat)).toEqual({ kind: "hide", target: rock });
            }
            for (const t of torpedoes()) {
                built.add(t);
                if (ships.chosen[t] === gunship) after.add(t);
            }
        }
        expect(built.size).toBeGreaterThanOrEqual(3);
        expect(after.size).toBeGreaterThanOrEqual(2);
    });
});
