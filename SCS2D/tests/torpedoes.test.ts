import { describe, expect, it } from "vitest";
import { compileBlueprint, type Blueprint } from "../sim/index.js";
import { torpedoes } from "../scenarios/torpedoes.js";
import { makeBattle } from "../scenarios/battle.js";
import { CORVETTE, KKV } from "../scenarios/blueprints.js";
import { NO_TARGET } from "../sim/ships.js";

/**
 * A torpedo is a fighter with nothing to shoot and a doctrine that rams: the
 * test of fighters and torpedoes being the same thing.
 */

describe("a torpedo", () => {
    it("is a fighter with no weapons and a ram doctrine", () => {
        const design = compileBlueprint(KKV);
        expect(design.fighter).toBe(true);
        expect(design.turrets).toHaveLength(0);
        expect(design.reach).toBe(0);
        expect(design.doctrine.approach.ramRadii).toBeGreaterThan(0);
    });
});

describe("a salvo of torpedoes", () => {
    it("lands some on the gunship, and loses some to its guns on the way in", () => {
        const count = 12;
        const battle = torpedoes(20260905, count);
        const ships = battle.ships;
        const salvo = Array.from({ length: count }, (_, k) => k + 1);
        const hit = new Set<number>();
        for (let i = 0; i < 3000; i++) {
            battle.step();
            // Landed if it dealt the gunship anything, which a torpedo spent on it as rounds still does, though gone:
            // its wreckage strikes the step after the ram that wrecks it.
            const credit = battle.credit;
            for (let h = 0; h < credit.count; h++) {
                const pilot = ships.attackerOf(credit, h);
                if (salvo.includes(pilot) && ships.pilotAt(credit.victim[h]!) === 0) hit.add(pilot);
            }
        }
        // Downed if it is gone or out of control without ever landing.
        const downed = salvo.filter((t) => !hit.has(t) && (!ships.isAlive(t) || !ships.hasControl(t)));
        expect(hit.size).toBeGreaterThan(0);
        expect(downed.length).toBeGreaterThan(0);
    });
});

describe("a torpedo's last seconds", () => {
    it("take out its drift as it closes, so few that the guns spare fly past", () => {
        let hit = 0;
        let missed = 0;
        // Enough seeds that the margin does not hang on a handful of salvoes.
        for (const seed of [20260905, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
            const battle = torpedoes(seed, 12);
            const ships = battle.ships;
            const reached = new Set<number>();
            for (let i = 0; i < 60 * 60; i++) {
                battle.step();
                const gunship = battle.world.bodies.indexOf(ships.body(0));
                const contacts = battle.collisions.contacts;
                for (let k = 0; k < contacts.count; k++) {
                    const other = contacts.a[k] === gunship ? contacts.b[k]! : contacts.b[k] === gunship ? contacts.a[k]! : -1;
                    const pilot = other < 0 ? -1 : ships.pilotAt(other);
                    // A torpedo, not a piece cut off something else.
                    if (pilot > 0 && pilot <= 12) reached.add(pilot);
                }
                // Or spent on it as rounds, gone by the time its contact is read, but credited.
                for (let h = 0; h < battle.credit.count; h++) {
                    const pilot = ships.attackerOf(battle.credit, h);
                    if (pilot > 0 && pilot <= 12 && battle.credit.victim[h] === gunship) reached.add(pilot);
                }
            }
            hit += reached.size;
            for (let t = 1; t <= 12; t++) if (!reached.has(t) && ships.isAlive(t) && ships.hasControl(t)) missed++;
        }
        // As a share of those the guns spared, so better guns sparing fewer does not move it. Speeding
        // up at where the target was, before drift was taken out, about three in ten of those flew past.
        expect(missed / (hit + missed)).toBeLessThan(0.15);
    });
});

describe("a spent torpedo", () => {
    /** A torpedo with tanks of `fill` and the corvette it would ram, a kilometre off; how many steps it has a target in its first 10 s. */
    const steps = (fill: number): number => {
        const dry: Blueprint = {
            ...KKV,
            modules: KKV.modules.map((m) => ("kind" in m && (m.kind === "tank" || m.kind === "core") ? { ...m, fill } : m)),
        };
        const battle = makeBattle({ seed: 4 }, (ships, world) => {
            ships.spawn(world, { design: compileBlueprint(CORVETTE), x: 0, y: 0, team: 0 });
            ships.spawn(world, { design: compileBlueprint(dry), x: 1000, y: 0, angle: Math.PI, team: 1 });
        });
        let targeted = 0;
        for (let i = 0; i < 600; i++) {
            battle.step();
            if (battle.ships.fightingOf(1) !== NO_TARGET) targeted++;
        }
        return targeted;
    };

    it("gives up looking for a target, having nothing to reach one with", () => {
        expect(steps(1)).toBeGreaterThan(0);
        expect(steps(0)).toBe(0);
    });
});
