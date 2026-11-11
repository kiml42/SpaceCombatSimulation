import { describe, expect, it } from "vitest";
import { capture, Snapshot, type ShipView } from "../sim/snapshot.js";
import type { Battle } from "../scenarios/types.js";
import { crippledLanding } from "../scenarios/crippledLanding.js";
import { scavenge } from "../scenarios/scavenge.js";
import { tanker } from "../scenarios/tanker.js";
import { duel } from "../scenarios/duel.js";
import { torpedoes } from "../scenarios/torpedoes.js";
import { beamCarrier } from "../scenarios/beamCarrier.js";

/** Every ship as the picture sees it at each step, until `seen` says enough. */
function watch(battle: Battle, steps: number, seen: (ship: ShipView, view: Snapshot) => boolean): boolean {
    const view = new Snapshot();
    for (let s = 0; s < steps; s++) {
        battle.step();
        capture(view, battle.world, battle.ships, battle.projectiles, battle.beams);
        for (const ship of view.ships.slice(0, view.shipCount)) if (seen(ship, view)) return true;
    }
    return false;
}

const near = (x: number, y: number, ship: ShipView | undefined, within: number): boolean =>
    ship !== undefined && Math.hypot(x - ship.x, y - ship.y) <= within;

/** Where a ship is flying to, carried to the picture for a selected ship's line. */
describe("where a ship is flying to", () => {
    it("is the pad, for a fighter landing", () => {
        const battle = crippledLanding();
        const carriers = new Set(battle.carriers.map((c) => battle.world.bodies.indexOf(battle.ships.body(c))));
        const seen = watch(battle, 120, (ship, view) => {
            const carrier = view.ships.slice(0, view.shipCount).find((s) => carriers.has(s.body) && s.body === ship.doingTo);
            return ship.destX !== undefined && near(ship.destX, ship.destY!, carrier, carrier!.currentStructure.radius);
        });
        expect(seen).toBe(true);
    });

    it("is first where a pad's way in starts, for a fighter that has to go round its carrier to it", () => {
        expect(watch(beamCarrier(), 15000, (ship) => ship.doing === "dock" && ship.viaX !== undefined && ship.destX !== undefined)).toBe(
            true,
        );
    });

    it("is where on a wreck a scavenger means to take hold", () => {
        expect(watch(scavenge(), 1200, (ship) => ship.destX !== undefined)).toBe(true);
    });

    it("is the port it docks with, for a ship docking", () => {
        expect(watch(tanker(), 1200, (ship) => ship.destX !== undefined)).toBe(true);
    });

    it("is the middle of what is left of its target, for a ship ramming", () => {
        expect(watch(torpedoes(), 300, (ship) => ship.doing === "ram" && ship.destX !== undefined)).toBe(true);
    });

    it("is nowhere in particular for a ship fighting", () => {
        expect(watch(duel(), 600, (ship) => ship.viaX !== undefined || ship.destX !== undefined)).toBe(false);
    });

    it("shows a corner round what is in the way only while it makes for it", () => {
        // Fighters going round the Beam Carrier's superstructure to land, and landed.
        const battle = beamCarrier();
        let cornered = false;
        const parkedWithCorner = watch(battle, 60 * 70, (ship) => {
            cornered ||= ship.routeX !== undefined;
            // With what it goes round, the corner outside it.
            if (ship.routeX !== undefined) {
                expect(ship.routeAroundR).toBeGreaterThan(0);
                expect(Math.hypot(ship.routeX - ship.routeAroundX!, ship.routeY! - ship.routeAroundY!)).toBeGreaterThan(ship.routeAroundR!);
            }
            return ship.routeX !== undefined && ship.ship !== undefined && battle.ships.parkedCarrier(ship.ship) >= 0;
        });
        expect(cornered).toBe(true);
        expect(parkedWithCorner).toBe(false);
    }, 120_000);
});
