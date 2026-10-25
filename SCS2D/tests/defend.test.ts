import { describe, expect, it } from "vitest";
import { compileBlueprint, math } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { CORVETTE, GUNSHIP } from "../scenarios/blueprints.js";

/** A friend under attack, a ship told to defend it, and an enemy nearer the defender that is not attacking the friend. */
function defended() {
    const corvette = compileBlueprint(CORVETTE);
    const gunship = compileBlueprint(GUNSHIP);
    return makeBattle({ seed: 5, projectiles: 1024 }, (ships, world) => {
        const friend = ships.spawn(world, { design: corvette, x: 0, y: 0, angle: 0, team: 0 });
        const defender = ships.spawn(world, { design: gunship, x: 0, y: -300, angle: 0, team: 0 });
        const attacker = ships.spawn(world, { design: corvette, x: 2000, y: 0, angle: math.PI, team: 1 });
        const decoy = ships.spawn(world, { design: gunship, x: -900, y: -600, angle: 0, team: 1 });
        ships.pushAttack(attacker, friend);
        ships.pushAttack(decoy, defender);
        ships.pushDefend(defender, friend);
        return { friend, defender, attacker, decoy };
    });
}

describe("an order to defend", () => {
    it("fights what is attacking its charge, not the nearer enemy that is not", () => {
        const battle = defended();
        let fought = 0;
        let wrong = 0;
        for (let step = 0; step < 900; step++) {
            battle.step();
            if (step < 60 || !battle.ships.isAlive(battle.attacker)) continue;
            const target = battle.ships.fightingOf(battle.defender);
            if (target === battle.attacker) fought++;
            else wrong++;
            expect(target).not.toBe(battle.friend);
        }
        expect(fought).toBeGreaterThan(0);
        expect(wrong).toBe(0);
    });

    it("stays with its charge rather than giving chase", () => {
        const battle = defended();
        const bodies = battle.world.bodies;
        const at = (ship: number) => bodies.indexOf(battle.ships.body(ship));
        let furthest = 0;
        for (let step = 0; step < 900; step++) {
            battle.step();
            if (!battle.ships.isAlive(battle.friend) || !battle.ships.isAlive(battle.defender)) break;
            const f = at(battle.friend);
            const d = at(battle.defender);
            if (step > 300) furthest = Math.max(furthest, math.distance(bodies.x[f]!, bodies.y[f]!, bodies.x[d]!, bodies.y[d]!));
        }
        expect(furthest).toBeGreaterThan(0);
        // Its escort band, not the attacker's two kilometres.
        expect(furthest).toBeLessThan(700);
    });

    it("ends when its charge is gone", () => {
        const battle = defended();
        battle.step();
        expect(battle.ships.orderCount(battle.defender)).toBe(1);
        // Gone as `cull` takes a ship: the ship, then its body.
        const body = battle.ships.body(battle.friend);
        battle.ships.remove(battle.friend);
        battle.world.destroy(body);
        battle.step();
        expect(battle.ships.orderCount(battle.defender)).toBe(0);
    });

    it("drops one order by its place in the queue", () => {
        const battle = defended();
        battle.ships.pushAttack(battle.defender, battle.attacker);
        battle.ships.dropOrder(battle.defender, 0);
        expect(battle.ships.ordersOf(battle.defender).map((o) => o.target)).toEqual([battle.attacker]);
    });
});
