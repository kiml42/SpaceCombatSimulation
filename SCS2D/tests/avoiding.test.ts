import { describe, expect, it } from "vitest";
import { capture, Snapshot } from "../sim/snapshot.js";
import { asteroidField } from "../scenarios/asteroidField.js";

/** What a ship is keeping clear of, carried to the picture for a selected ship's red ring. */
describe("what a ship is avoiding", () => {
    it("is another body, with the room it wants from it", () => {
        // Among rocks, something is kept clear of before long.
        const battle = asteroidField();
        let seen = false;
        const view = new Snapshot();
        for (let s = 0; s < 1200 && !seen; s++) {
            battle.step();
            capture(view, battle.world, battle.ships, battle.projectiles, battle.beams);
            for (const ship of view.ships.slice(0, view.shipCount)) {
                if (ship.avoiding === undefined) continue;
                expect(ship.avoiding).not.toBe(ship.body);
                expect(ship.avoidRoom).toBeGreaterThan(ship.currentStructure.radius);
                seen = true;
            }
        }
        expect(seen).toBe(true);
    });
});
