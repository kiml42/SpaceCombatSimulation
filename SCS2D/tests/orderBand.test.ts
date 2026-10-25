import { describe, expect, it } from "vitest";
import { compileBlueprint, type Blueprint } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { CORVETTE, TANKER } from "../scenarios/blueprints.js";
import { give, parseLog } from "../scenarios/commands.js";
import type { Battle } from "../scenarios/types.js";

/** How far off and how fast an order holds, told rather than doctrine's (ROADMAP.md §8 step 14, slice 4). */

/** A gun on a core, going nowhere. */
const FORT = compileBlueprint({
    name: "Fort",
    modules: [
        { kind: "core", x: 0, y: 0, length: 6, width: 6 },
        { kind: "turret", x: 5, y: 0, length: 4, width: 4, barrels: 1 },
    ],
} satisfies Blueprint);
const corvette = compileBlueprint(CORVETTE);

function scene() {
    return makeBattle({ seed: 3 }, (ships, world) => ({
        c: ships.spawn(world, { design: corvette, x: 0, y: 0, angle: 0 }),
        f: ships.spawn(world, { design: FORT, x: 1200, y: 0, team: 1 }),
        t: ships.spawn(world, { design: compileBlueprint(TANKER), x: -200, y: 200, angle: 0 }),
    }));
}
const apart = (run: Battle, i: number, j: number): number => {
    const a = run.world.bodies.indexOf(run.ships.body(i));
    const b = run.world.bodies.indexOf(run.ships.body(j));
    const bodies = run.world.bodies;
    return Math.hypot(bodies.x[a]! - bodies.x[b]!, bodies.y[a]! - bodies.y[b]!);
};

describe("an attack told how far off to hold", () => {
    it("holds there, off the target’s skin, and closes at the speed told", () => {
        const run = scene();
        give(run, {
            kind: "order",
            ships: [run.c],
            order: { kind: "attack", target: run.f, cancelOn: 1, distance: 300, speed: 25 },
            append: false,
        });
        run.step();
        const held = run.ships.heldOrder(run.c)!;
        const tolerance = corvette.doctrine.approach.tolerance;
        expect(held.minRange).toBeCloseTo((FORT.radius + 300) * (1 - tolerance), 6);
        expect(held.maxRange).toBeCloseTo((FORT.radius + 300) * (1 + tolerance), 6);
        expect(held.approachSpeed).toBe(25);
        for (let s = 0; s < 120 * 60; s++) run.step();
        expect(apart(run, run.c, run.f)).toBeGreaterThan(held.minRange * 0.9);
        expect(apart(run, run.c, run.f)).toBeLessThan(held.maxRange * 1.1);
    });

    it("left untold, follows its doctrine as it is changed; told, keeps to what it was told", () => {
        const run = scene();
        give(run, { kind: "order", ships: [run.c], order: { kind: "attack", target: run.f, cancelOn: 1 }, append: false });
        run.step();
        const before = run.ships.heldOrder(run.c)!.maxRange;
        give(run, { kind: "doctrine", ships: [run.c], part: "ship", field: "standoff", value: 0.1 });
        give(run, { kind: "doctrine", ships: [run.c], part: "ship", field: "approachSpeed", value: 33 });
        run.step();
        expect(run.ships.heldOrder(run.c)!.maxRange).toBeLessThan(before);
        expect(run.ships.heldOrder(run.c)!.approachSpeed).toBe(33);

        give(run, { kind: "order", ships: [run.c], order: { kind: "attack", target: run.f, cancelOn: 1, distance: 500 }, append: false });
        run.step();
        const told = run.ships.heldOrder(run.c)!.maxRange;
        give(run, { kind: "doctrine", ships: [run.c], part: "ship", field: "standoff", value: 0.05 });
        run.step();
        expect(run.ships.heldOrder(run.c)!.maxRange).toBe(told);
    });
});

describe("a defence or ram told how to hold", () => {
    it("keeps the station told off its friend, and rams at the speed told", () => {
        const run = scene();
        give(run, { kind: "order", ships: [run.c], order: { kind: "defend", target: run.t, distance: 80, speed: 20 }, append: false });
        run.step();
        expect(run.ships.coverBandOf(run.c, run.t)).toBeCloseTo(corvette.radius + run.ships.currentStructure(run.t).radius + 80, 6);
        give(run, { kind: "order", ships: [run.c], order: { kind: "ram", target: run.f, speed: 15 }, append: false });
        expect(run.ships.ordersOf(run.c)[0]!.approachSpeed).toBe(15);
    });
});

describe("a logged order with a distance or speed", () => {
    it("reads back, and is refused one it cannot have", () => {
        const log = [
            {
                step: 1,
                command: {
                    kind: "order",
                    ships: [0],
                    order: { kind: "attack", target: 1, cancelOn: 5, distance: 0, speed: 40 },
                    append: false,
                },
            },
            { step: 2, command: { kind: "order", ships: [0], order: { kind: "defend", target: 2, distance: 100 }, append: false } },
            { step: 3, command: { kind: "order", ships: [0], order: { kind: "ram", target: 1, speed: 10 }, append: false } },
        ];
        expect(parseLog(log)).toEqual(log);
        const bad = (order: Record<string, unknown>) => () =>
            parseLog([{ step: 1, command: { kind: "order", ships: [0], order, append: false } }]);
        expect(bad({ kind: "attack", target: 1, cancelOn: 5, distance: -1 })).toThrow();
        expect(bad({ kind: "attack", target: 1, cancelOn: 5, speed: 0 })).toThrow();
        expect(bad({ kind: "ram", target: 1, distance: 50 })).toThrow();
        expect(bad({ kind: "dock", target: 1, speed: 50 })).toThrow();
    });
});
