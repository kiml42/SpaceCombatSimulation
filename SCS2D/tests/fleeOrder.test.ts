import { describe, expect, it } from "vitest";
import { compileBlueprint, type Blueprint } from "../sim/index.js";
import { NO_TARGET } from "../sim/ships.js";
import { makeBattle } from "../scenarios/battle.js";
import { CORVETTE, TANKER } from "../scenarios/blueprints.js";
import { give, parseLog } from "../scenarios/commands.js";
import type { Battle } from "../scenarios/types.js";
import { QUARRY } from "./fixtures/quarry.js";

/** Ships told to run away, or to hide behind a friend (ROADMAP.md §8 step 14, slice 3). */

/** A gun on a core, going nowhere: something to run from that does not give chase. */
const FORT = compileBlueprint({
    name: "Fort",
    modules: [
        { kind: "core", x: 0, y: 0, length: 6, width: 6 },
        { kind: "turret", x: 5, y: 0, length: 4, width: 4, barrels: 1 },
    ],
} satisfies Blueprint);
const corvette = compileBlueprint(CORVETTE);

type Run = Battle;
const where = (run: Run, i: number): { x: number; y: number; v: number } => {
    const b = run.world.bodies.indexOf(run.ships.body(i));
    const bodies = run.world.bodies;
    return { x: bodies.x[b]!, y: bodies.y[b]!, v: Math.hypot(bodies.vx[b]!, bodies.vy[b]!) };
};
const apart = (run: Run, i: number, j: number): number => {
    const a = where(run, i);
    const b = where(run, j);
    return Math.hypot(a.x - b.x, a.y - b.y);
};
const steps = (run: Run, seconds: number): void => {
    for (let s = 0; s < seconds * 60; s++) run.step();
};

describe("a ship told to flee", () => {
    it("runs from every armed enemy until clear of its reach, then eases off, and the order stands", () => {
        const run = makeBattle({ seed: 3 }, (ships, world) => ({
            c: ships.spawn(world, { design: corvette, x: 0, y: 0, angle: 0 }),
            f: ships.spawn(world, { design: FORT, x: 400, y: 0, team: 1 }),
            q: ships.spawn(world, { design: QUARRY, x: 0, y: -600, team: 1 }),
        }));
        give(run, { kind: "order", ships: [run.c], order: { kind: "flee", target: NO_TARGET }, append: false });
        steps(run, 20);
        // Away from the fort; the unarmed quarry is nothing to run from.
        expect(where(run, run.c).x).toBeLessThan(-500);
        expect(Math.abs(where(run, run.c).y)).toBeLessThan(100);
        steps(run, 100);
        const clear = (FORT.reach + corvette.radius) * corvette.doctrine.approach.fleeMargin;
        expect(apart(run, run.c, run.f)).toBeGreaterThan(clear);
        expect(where(run, run.c).v).toBeLessThan(1);
        expect(run.ships.orderCount(run.c)).toBe(1);
    });

    it("runs from the enemy named alone", () => {
        const run = makeBattle({ seed: 3 }, (ships, world) => ({
            c: ships.spawn(world, { design: corvette, x: 0, y: 0, angle: 0 }),
            f: ships.spawn(world, { design: FORT, x: 400, y: 0, team: 1 }),
            g: ships.spawn(world, { design: FORT, x: 0, y: 400, team: 1 }),
        }));
        give(run, { kind: "order", ships: [run.c], order: { kind: "flee", target: run.f }, append: false });
        expect(run.ships.doingOf(run.c)).toEqual({ kind: "flee", target: run.f });
        steps(run, 15);
        const at = where(run, run.c);
        expect(at.x).toBeLessThan(-300);
        expect(Math.abs(at.y)).toBeLessThan(0.2 * Math.abs(at.x));
    });

    it("hides behind a friend, on its side away from the enemy", () => {
        const tanker = compileBlueprint(TANKER);
        const run = makeBattle({ seed: 3 }, (ships, world) => ({
            t: ships.spawn(world, { design: tanker, x: 0, y: 0, angle: 0 }),
            c: ships.spawn(world, { design: corvette, x: 0, y: 300, angle: 0 }),
            f: ships.spawn(world, { design: FORT, x: 900, y: 0, team: 1 }),
        }));
        give(run, { kind: "order", ships: [run.c], order: { kind: "flee", target: run.t }, append: false });
        expect(run.ships.doingOf(run.c)).toEqual({ kind: "hide", target: run.t });
        steps(run, 60);
        const t = where(run, run.t);
        const c = where(run, run.c);
        // Behind it from the fort, and near.
        expect(c.x).toBeLessThan(t.x);
        expect(Math.abs(c.y - t.y)).toBeLessThan(0.5 * (t.x - c.x));
        const off = (corvette.radius + tanker.radius) * (1 + corvette.doctrine.approach.separationRadii);
        expect(apart(run, run.c, run.t)).toBeLessThan(off * 1.3);
        expect(run.ships.orderCount(run.c)).toBe(1);
    });

    it("replaces the queue, and is refused against an enemy that cannot hurt it", () => {
        const run = makeBattle({ seed: 3 }, (ships, world) => ({
            c: ships.spawn(world, { design: corvette, x: 0, y: 0 }),
            f: ships.spawn(world, { design: FORT, x: 400, y: 0, team: 1 }),
            q: ships.spawn(world, { design: QUARRY, x: 0, y: -600, team: 1 }),
        }));
        give(run, { kind: "order", ships: [run.c], order: { kind: "attack", target: run.f, cancelOn: 5 }, append: false });
        give(run, { kind: "order", ships: [run.c], order: { kind: "flee", target: run.q }, append: true });
        expect(run.ships.orderCount(run.c)).toBe(1);
        expect(run.ships.ordersOf(run.c)[0]!.flee).toBeUndefined();
        give(run, { kind: "order", ships: [run.c], order: { kind: "flee", target: NO_TARGET }, append: true });
        expect(run.ships.orderCount(run.c)).toBe(1);
        expect(run.ships.ordersOf(run.c)[0]!.flee).toBe(true);
        give(run, { kind: "stop", ships: [run.c] });
        expect(run.ships.orderCount(run.c)).toBe(0);
    });

    it("reads back from a log, with a target or with none", () => {
        const log = [
            { step: 1, command: { kind: "order", ships: [0], order: { kind: "flee", target: -1 }, append: false } },
            { step: 2, command: { kind: "order", ships: [0], order: { kind: "flee", target: 1 }, append: false } },
        ];
        expect(parseLog(log)).toEqual(log);
    });
});
