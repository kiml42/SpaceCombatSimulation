import { describe, expect, it } from "vitest";
import { compileBlueprint, DEFAULT_DOCTRINE, type Blueprint } from "../sim/index.js";
import { torpedoes } from "../scenarios/torpedoes.js";
import { makeBattle } from "../scenarios/battle.js";
import { CORVETTE, TORPEDO } from "../scenarios/blueprints.js";
import { NO_TARGET } from "../sim/ships.js";

/**
 * A torpedo is a fighter with nothing to shoot and a doctrine that rams: the
 * test of fighters and torpedoes being the same thing.
 */

describe("a torpedo", () => {
    it("is a fighter with no weapons and a ram doctrine", () => {
        const design = compileBlueprint(TORPEDO);
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
        const downed = new Set<number>();
        for (let i = 0; i < 3000; i++) {
            battle.step();
            const contacts = battle.collisions.contacts;
            for (let k = 0; k < contacts.count; k++) {
                for (const body of [contacts.a[k]!, contacts.b[k]!]) {
                    const pilot = ships.pilotAt(body);
                    if (salvo.includes(pilot) && !downed.has(pilot)) hit.add(pilot);
                }
            }
            for (const t of salvo) if (!hit.has(t) && (!ships.isAlive(t) || !ships.hasControl(t))) downed.add(t);
        }
        expect(hit.size).toBeGreaterThan(0);
        expect(downed.size).toBeGreaterThan(0);
    });
});

describe("a torpedo's last seconds", () => {
    /** Over five salvoes, how many torpedoes reach the gunship, and how many are still flying having missed it. */
    const salvoes = (ramSettle: number): { hit: number; missed: number } => {
        const torpedo: Blueprint = {
            ...TORPEDO,
            doctrine: {
                targeting: { ...DEFAULT_DOCTRINE.targeting, ...TORPEDO.doctrine?.targeting },
                approach: { ...DEFAULT_DOCTRINE.approach, ...TORPEDO.doctrine?.approach, ramSettle },
            },
        };
        let hit = 0;
        let missed = 0;
        for (const seed of [20260905, 1, 2, 3, 4]) {
            const battle = torpedoes(seed, 12, undefined, torpedo);
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
            }
            hit += reached.size;
            for (let t = 1; t <= 12; t++) if (!reached.has(t) && ships.isAlive(t) && ships.hasControl(t)) missed++;
        }
        return { hit, missed };
    };

    it("are spent cancelling its drift rather than closing faster, so fewer that the guns spare miss", () => {
        const lining = salvoes(compileBlueprint(TORPEDO).doctrine.approach.ramSettle);
        const flatOut = salvoes(0);
        expect(lining.missed).toBeLessThan(flatOut.missed);
        expect(lining.hit).toBeGreaterThan(flatOut.hit);
    });
});

describe("a spent torpedo", () => {
    /** A torpedo with tanks of `fill` and the corvette it would ram, a kilometre off; how many steps it has a target in its first 10 s. */
    const steps = (fill: number): number => {
        const dry: Blueprint = {
            ...TORPEDO,
            modules: TORPEDO.modules.map((m) => ("kind" in m && (m.kind === "tank" || m.kind === "core") ? { ...m, fill } : m)),
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
