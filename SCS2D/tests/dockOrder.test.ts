import { describe, expect, it } from "vitest";
import { compileBlueprint, type Blueprint, type ShipDesign } from "../sim/index.js";
import { NO_TARGET } from "../sim/ships.js";
import { makeBattle } from "../scenarios/battle.js";
import { DINKY, GUNSHIP, TANKER } from "../scenarios/blueprints.js";
import { give, parseLog } from "../scenarios/commands.js";
import { PICKET } from "../scenarios/tanker.js";
import { ANY_RANGE, QUARRY } from "./fixtures/quarry.js";

/** Ships told to dock with a friend and take on all it can give (ROADMAP.md §8 step 14, slice 2). */

/** A Picket whose doctrine never docks of its own accord. */
function picketOf(refuelBelow = 0): ShipDesign {
    return compileBlueprint({ ...PICKET, doctrine: { ...PICKET.doctrine!, approach: { ...PICKET.doctrine!.approach, refuelBelow } } });
}

function portScene(friendTeam = 0, spent = 0.2, drained = 0.5) {
    return makeBattle({ seed: 3 }, (ships, world) => {
        const t = ships.spawn(world, { design: compileBlueprint(TANKER), x: 0, y: 0, angle: 0.4, team: friendTeam });
        const picket = picketOf();
        const p = ships.spawn(world, { design: picket, x: -200, y: 150, angle: 0 });
        const g = ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 300, y: -300, angle: 0 });
        const b = world.bodies.indexOf(ships.body(p));
        for (let m = 0; m < picket.modules.length; m++) {
            ships.fuel.vent(b, m, ships.fuel.held(b, m) * spent);
            ships.metal.drain(b, m, ships.metal.held(b, m) * drained);
        }
        return { t, p, g };
    });
}

type Run = ReturnType<typeof portScene>;
const docked = (run: Run): boolean => run.ships.body(run.t) === run.ships.body(run.p);
const bodyOf = (run: Run, i: number): number => run.world.bodies.indexOf(run.ships.body(i));
function runUntil(run: Run, done: () => boolean, seconds: number): void {
    for (let s = 0; s < seconds * 60 && !done(); s++) run.step();
}

describe("a ship told to dock", () => {
    it("goes to the friend it was sent to though it is nearly full, takes on fuel and metal, and the order ends", () => {
        const run = portScene();
        give(run, { kind: "order", ships: [run.p], order: { kind: "dock", target: run.t }, append: false });
        expect(run.ships.errandOf(run.p)).toBe("dock");
        runUntil(run, () => docked(run), 120);
        expect(docked(run)).toBe(true);
        runUntil(run, () => !docked(run), 400);
        expect(docked(run)).toBe(false);
        const b = bodyOf(run, run.p);
        const core = run.ships.currentStructure(run.p).cores[0]!;
        expect(run.ships.fuel.pieceRoom(b, core)).toBeCloseTo(0, 3);
        expect(run.ships.metal.pieceRoom(b, core)).toBeCloseTo(0, 3);
        run.step();
        expect(run.ships.orderCount(run.p)).toBe(0);
    });

    it("with no target, goes where its doctrine would, and the line points there", () => {
        const run = portScene();
        give(run, { kind: "order", ships: [run.p], order: { kind: "dock", target: NO_TARGET }, append: false });
        run.step();
        expect(run.ships.errandTarget(run.p)).toBe(run.t);
        runUntil(run, () => docked(run), 120);
        expect(docked(run)).toBe(true);
    });

    it("then carries on to the next order in its queue", () => {
        const run = portScene(0, 0.2, 0);
        give(run, { kind: "order", ships: [run.p], order: { kind: "dock", target: run.t }, append: false });
        give(run, { kind: "order", ships: [run.p], order: { kind: "defend", target: run.g }, append: true });
        expect(run.ships.orderCount(run.p)).toBe(2);
        runUntil(run, () => docked(run), 120);
        runUntil(run, () => !docked(run), 400);
        run.step();
        expect(run.ships.orderCount(run.p)).toBe(1);
        expect(run.ships.ordersOf(run.p)[0]!.defend).toBe(true);
    });

    it("ends at once with nothing to take on", () => {
        const run = portScene(0, 0, 0);
        give(run, { kind: "order", ships: [run.p], order: { kind: "dock", target: run.t }, append: false });
        run.step();
        expect(run.ships.orderCount(run.p)).toBe(0);
    });

    it("is passed over for an enemy, or a friend with no dock it could mate with", () => {
        const enemy = portScene(1);
        give(enemy, { kind: "order", ships: [enemy.p], order: { kind: "dock", target: enemy.t }, append: false });
        expect(enemy.ships.orderCount(enemy.p)).toBe(0);
        const portless = portScene();
        give(portless, { kind: "order", ships: [portless.p], order: { kind: "dock", target: portless.g }, append: false });
        expect(portless.ships.orderCount(portless.p)).toBe(0);
    });

    it("is handed back to doctrine by Stop", () => {
        const run = portScene();
        give(run, { kind: "order", ships: [run.p], order: { kind: "dock", target: run.t }, append: false });
        runUntil(run, () => docked(run), 120);
        give(run, { kind: "stop", ships: [run.p] });
        runUntil(run, () => !docked(run), 5);
        expect(docked(run)).toBe(false);
    });
});

describe("a fighter told to dock", () => {
    function carrier(): ShipDesign {
        const blueprint: Blueprint = {
            name: "Carrier",
            modules: [
                { kind: "core", x: 0, y: 0, length: 6, width: 6 },
                { kind: "tank", x: -13, y: 0, length: 20, width: 10 },
                { kind: "pad", x: 13, y: 0, length: 20, width: 20 },
            ],
        };
        return compileBlueprint(blueprint);
    }
    const fighter = (): ShipDesign => {
        const doctrine = compileBlueprint(DINKY).doctrine;
        // Its doctrine would never land for metal or fuel.
        return compileBlueprint({
            ...DINKY,
            doctrine: { ...doctrine, approach: { ...doctrine.approach, rearmBelow: -1, refuelBelow: 0, sortieRange: ANY_RANGE } },
        });
    };

    it("lands on the friend's pad and lifts off topped up", () => {
        const run = makeBattle({ seed: 3 }, (ships, world) => {
            const c = ships.spawn(world, { design: carrier(), x: 0, y: 0, angle: 0.3, team: 0 });
            const f = ships.spawn(world, { design: fighter(), x: -300, y: 200, angle: 0 });
            const b = world.bodies.indexOf(ships.body(f));
            const design = ships.currentStructure(f);
            for (let m = 0; m < design.modules.length; m++) ships.metal.drain(b, m, ships.metal.held(b, m) * 0.3);
            ships.spawn(world, { design: QUARRY, x: 0, y: 5000, team: 1 });
            return { c, f };
        });
        give(run, { kind: "order", ships: [run.f], order: { kind: "dock", target: run.c }, append: false });
        const aboard = (): boolean => run.ships.parkedCarrier(run.f) === run.c;
        for (let s = 0; s < 60 * 60 && !aboard(); s++) run.step();
        expect(aboard()).toBe(true);
        for (let s = 0; s < 30 * 60 && aboard(); s++) run.step();
        run.step();
        const b = run.world.bodies.indexOf(run.ships.body(run.f));
        expect(run.ships.metal.pieceRoom(b, run.ships.currentStructure(run.f).cores[0]!)).toBeCloseTo(0, 3);
        expect(run.ships.orderCount(run.f)).toBe(0);
    });
});

describe("a logged dock", () => {
    it("reads back with a target or with none", () => {
        const log = [
            { step: 3, command: { kind: "order", ships: [1], order: { kind: "dock", target: 0 }, append: false } },
            { step: 4, command: { kind: "order", ships: [1], order: { kind: "dock", target: -1 }, append: true } },
        ];
        expect(parseLog(log)).toEqual(log);
        expect(() =>
            parseLog([{ step: 1, command: { kind: "order", ships: [1], order: { kind: "attack", target: -1 }, append: false } }]),
        ).toThrow();
    });
});
