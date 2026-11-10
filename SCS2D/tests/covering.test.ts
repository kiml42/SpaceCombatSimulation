import { describe, expect, it } from "vitest";
import { compileBlueprint, DAMAGE_ENERGY_PER_KG, math } from "../sim/index.js";
import { capture, Snapshot } from "../sim/snapshot.js";
import { makeBattle } from "../scenarios/battle.js";
import { CORVETTE, GUNSHIP } from "../scenarios/blueprints.js";
import { beamCarrier } from "../scenarios/beamCarrier.js";
import * as shipOrders from "../sim/shipOrders.js";

/**
 * Two corvettes, which escort each other, with a gunship in their reach: they
 * stay together and fight it from there, rather than leaving to go after it.
 */
function guarded(): ReturnType<typeof makeBattle> {
    const corvette = compileBlueprint(CORVETTE);
    return makeBattle({ seed: 1, projectiles: 512 }, (ships, world) => {
        ships.spawn(world, { design: corvette, x: 0, y: -100, angle: 0, team: 0 });
        ships.spawn(world, { design: corvette, x: 0, y: 100, angle: 0, team: 0 });
        ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 1500, y: 0, angle: math.PI, team: 1 });
    });
}

/** What a ship is escorting, carried to the picture so a selected ship's framing can take it in. */
describe("what a ship is escorting", () => {
    it("is a friend’s body, and -1 for a ship with no friend to stay with", () => {
        const battle = guarded();
        for (let s = 0; s < 60; s++) battle.step();
        const view = capture(new Snapshot(), battle.world, battle.ships, battle.projectiles, battle.beams);
        const ships = view.ships.slice(0, view.shipCount);
        const corvettes = ships.filter((ship) => ship.currentStructure.name === "Corvette");
        expect(corvettes).toHaveLength(2);
        expect(corvettes[0]!.covering).toBe(corvettes[1]!.body);
        expect(corvettes[1]!.covering).toBe(corvettes[0]!.body);
        expect(ships.find((ship) => ship.currentStructure.name === "Gunship")!.covering).toBe(-1);
    });

    it("is -1 for a ship whose cores are out, whatever it was covering", () => {
        const battle = guarded();
        for (let s = 0; s < 60; s++) battle.step();
        const { ships, world } = battle;
        const corvette = [0, 1, 2].find((i) => ships.currentStructure(i).name === "Corvette" && ships.coveringOf(i) >= 0)!;
        expect(corvette).toBeDefined();
        const body = world.bodies.indexOf(ships.body(corvette));
        for (const core of ships.currentStructure(corvette).cores) {
            ships.damage.absorb(body, core, ships.currentStructure(corvette).modules[core]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG);
        }
        expect(ships.hasControl(corvette)).toBe(false);
        expect(ships.coveringOf(corvette)).toBe(-1);
    });
});

/** Beam Carrier's fighters escort, and go home to their pads to recharge. */
describe("a ship on its way to a pad", () => {
    it("escorts nothing, and its view and its flight agree on that", { timeout: 60_000 }, () => {
        const run = beamCarrier();
        const { ships } = run;
        let landing = 0;
        for (let s = 0; s < 300 * 60 && landing < 600; s++) {
            run.step();
            for (let f = 0; f < ships.alive.length; f++) {
                if (ships.alive[f] !== 1) continue;
                // First, as flight asks it: it may decide on a ram as it goes.
                const order = shipOrders.effectiveOrder(ships, f);
                expect(shipOrders.escorting(ships, f)).toBe(shipOrders.escorts(order));
                if (order?.land !== true) continue;
                landing++;
                expect(ships.coveringOf(f)).toBe(-1);
            }
        }
        expect(landing).toBeGreaterThan(0);
    });
});
