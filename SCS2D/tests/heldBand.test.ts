import { describe, expect, it } from "vitest";
import { capture, Snapshot } from "../sim/snapshot.js";
import { duel } from "../scenarios/duel.js";

/** The band a ship is holding against what it fights, carried to the picture for the selected ship. */
describe("the band a ship is holding", () => {
    it("is in the snapshot for a ship fighting by its doctrine, and matches its order", () => {
        const battle = duel();
        for (let s = 0; s < 120; s++) battle.step();
        const view = capture(new Snapshot(), battle.world, battle.ships, battle.projectiles, battle.beams);
        let seen = 0;
        for (let k = 0; k < view.shipCount; k++) {
            const ship = view.ships[k]!;
            if ((ship.fighting ?? -1) < 0) continue;
            seen++;
            expect(ship.fightingMax).toBeGreaterThan(0);
            expect(ship.fightingMin).toBeLessThanOrEqual(ship.fightingMax!);
        }
        expect(seen).toBeGreaterThan(0);
    });

    it("is left out for a ship told to ram", () => {
        const battle = duel();
        battle.step();
        const { ships } = battle;
        const target = ships.fightingOf(0);
        expect(target).toBeGreaterThanOrEqual(0);
        ships.clearOrder(0);
        ships.pushRam(0, target, 20);
        expect(ships.heldOrder(0)).toBeUndefined();
        ships.clearOrder(0);
        ships.pushOrder(0, target, 300, 500, 20);
        expect(ships.heldOrder(0)).toMatchObject({ minRange: 300, maxRange: 500 });
        // A snapshot taken after one with a band drops it once there is none.
        const snapshot = new Snapshot();
        capture(snapshot, battle.world, ships, battle.projectiles, battle.beams);
        ships.clearOrder(0);
        ships.pushRam(0, target, 20);
        capture(snapshot, battle.world, ships, battle.projectiles, battle.beams);
        const own = snapshot.ships.slice(0, snapshot.shipCount).find((view) => view.body === battle.world.bodies.indexOf(ships.body(0)))!;
        expect(own.fightingMax).toBeUndefined();
    });
});
