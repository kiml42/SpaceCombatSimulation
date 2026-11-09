import { describe, expect, it } from "vitest";
import { capture, Snapshot } from "../sim/snapshot.js";
import { asteroidField } from "../scenarios/asteroidField.js";
import { makeBattle } from "../scenarios/battle.js";
import { BEAM_CARRIER, DINKY } from "../scenarios/blueprints.js";
import { compileBlueprint } from "../sim/index.js";

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

    it("is only as big as the part of it a fighter can hit", () => {
        // A fighter flies over a carrier's deck, so keeps clear of what stands up from it, not of its whole hull.
        const carrier = compileBlueprint(BEAM_CARRIER);
        const dinky = compileBlueprint(DINKY);
        expect(carrier.raisedRadius).toBeLessThan(carrier.radius);
        const battle = makeBattle({ seed: 1 }, (ships, world) => {
            ships.spawn(world, { design: carrier, x: 0, y: 0, angle: 0, team: 0 });
            const fighter = ships.spawn(world, { design: dinky, x: -150, y: 0, angle: 0, team: 0 });
            world.bodies.vx[world.bodies.indexOf(ships.body(fighter))] = 40;
            return { fighter };
        });
        battle.step();
        const { ships, fighter } = battle;
        expect(ships.dodgingOf(fighter)).toBe(0);
        const room = ships.dodgingRoom[fighter]!;
        const separation = ships.doctrines[fighter]!.approach.separationRadii;
        expect(room).toBeCloseTo((carrier.raisedRadius + dinky.radius) * (1 + separation));
        // Round what stands up, wherever on the hull that is, not round the hull's middle:
        // the carrier as it was spawned, at the origin and unturned, when the fighter decided.
        expect(ships.dodgingX[fighter]).toBeCloseTo(carrier.raisedX, 6);
        expect(ships.dodgingY[fighter]).toBeCloseTo(carrier.raisedY, 6);
        expect(ships.dodgingTouch[fighter]).toBeCloseTo(carrier.raisedRadius + dinky.radius);
    });

    it("rings a hull's raised parts by a circle of their own, off its middle where they are", () => {
        // A long hull with one turret at its bow: the circle is round the turret, not the hull.
        const design = compileBlueprint({
            name: "Bow turret",
            modules: [
                { kind: "core", x: 0, y: 0, length: 6, width: 6 },
                { kind: "structure", x: 30, y: 0, length: 54, width: 6 },
                { kind: "turret", x: 59, y: 0, length: 4, width: 4 },
            ],
        });
        expect(design.raisedRadius).toBeGreaterThan(0);
        expect(design.raisedRadius).toBeLessThan(design.radius / 4);
        expect(design.raisedX).toBeGreaterThan(design.radius / 2);
    });
});
