import { describe, expect, it } from "vitest";
import { capture, compileBlueprint, math, NEUTRAL_TEAM, Snapshot } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { give } from "../scenarios/commands.js";
import { CORVETTE, GUNSHIP } from "../scenarios/blueprints.js";
import { Match } from "../evolution/match.js";

const MARKER = compileBlueprint({ name: "Goal", modules: [{ kind: "core", x: 0, y: 0, length: 12, width: 12 }] });

/** A ship told to make for a marker on no side two kilometres off, past an enemy. */
function race() {
    const corvette = compileBlueprint(CORVETTE);
    const gunship = compileBlueprint(GUNSHIP);
    return makeBattle({ seed: 5, projectiles: 1024 }, (ships, world) => {
        const marker = ships.spawn(world, { design: MARKER, x: 2000, y: 0, angle: 0, team: NEUTRAL_TEAM, invulnerable: true });
        const racer = ships.spawn(world, { design: corvette, x: 0, y: 0, angle: 0, team: 0 });
        const enemy = ships.spawn(world, { design: gunship, x: 600, y: -400, angle: 0, team: 1 });
        ships.pushWaypoint(racer, marker);
        return { marker, racer, enemy };
    });
}

describe("a waypoint order", () => {
    it("goes to its marker, fighting what doctrine picks on the way", () => {
        const battle = race();
        const bodies = battle.world.bodies;
        const at = (ship: number) => bodies.indexOf(battle.ships.body(ship));
        let fought = false;
        let closest = Infinity;
        for (let step = 0; step < 60 * 90; step++) {
            battle.step();
            if (!battle.ships.isAlive(battle.racer)) break;
            if (battle.ships.fightingOf(battle.racer) === battle.enemy) fought = true;
            expect(battle.ships.fightingOf(battle.racer)).not.toBe(battle.marker);
            const m = at(battle.marker);
            const r = at(battle.racer);
            closest = Math.min(closest, math.distance(bodies.x[m]!, bodies.y[m]!, bodies.x[r]!, bodies.y[r]!));
        }
        expect(fought).toBe(true);
        expect(battle.ships.orderCount(battle.racer)).toBe(1);
        // Its escort band on a marker a dozen metres across, not two kilometres.
        expect(closest).toBeLessThan(300);
    });

    it("is drawn as a waypoint, and stands for its fight as an attack", () => {
        const battle = race();
        battle.step();
        const snapshot = capture(new Snapshot(), battle.world, battle.ships, battle.projectiles, battle.beams);
        const view = snapshot.ships.slice(0, snapshot.shipCount).find((ship) => ship.ship === battle.racer)!;
        expect(view.orders?.map((o) => o.kind)).toEqual(["waypoint"]);
        expect(battle.ships.doingOf(battle.racer)?.kind ?? "attack").toBe("attack");
    });

    it("is given by command to anything on any side, with a distance and speed", () => {
        const battle = race();
        battle.ships.clearOrder(battle.racer);
        give(battle, {
            kind: "order",
            ships: [battle.racer],
            order: { kind: "waypoint", target: battle.enemy, distance: 50 },
            append: false,
        });
        expect(battle.ships.ordersOf(battle.racer)).toMatchObject([{ target: battle.enemy, waypoint: true, distance: 50 }]);
        give(battle, { kind: "order", ships: [battle.racer], order: { kind: "waypoint", target: battle.racer }, append: true });
        expect(battle.ships.orderCount(battle.racer)).toBe(1);
    });
});

describe("a race", () => {
    it("tells every ship to make for the goal, where the goal counts", () => {
        const match = new Match([CORVETTE, GUNSHIP], { seed: 3 });
        const { ships, slots, marker } = match.battle;
        for (const ship of slots) expect(ships.ordersOf(ship)).toMatchObject([{ target: marker, waypoint: true }]);
        const fight = new Match([CORVETTE, GUNSHIP], {
            seed: 3,
            weights: { survival: 1, functional: 1, damage: 1, disabling: 1, race: 0 },
        });
        for (const ship of fight.battle.slots) expect(fight.battle.ships.orderCount(ship)).toBe(0);
    });
});
