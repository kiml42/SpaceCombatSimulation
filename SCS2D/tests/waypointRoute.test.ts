import { describe, expect, it } from "vitest";
import { compileBlueprint, math, NEUTRAL_TEAM } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { give, parseLog } from "../scenarios/commands.js";
import { CORVETTE } from "../scenarios/blueprints.js";
import { Match } from "../evolution/match.js";

const MARKER = compileBlueprint({ name: "Goal", modules: [{ kind: "core", x: 0, y: 0, length: 12, width: 12 }] });

/** A corvette and three markers on no side, 400 m apart round a corner. */
function route() {
    const corvette = compileBlueprint(CORVETTE);
    return makeBattle({ seed: 5 }, (ships, world) => {
        const marks = [
            [400, 0],
            [400, 400],
            [0, 400],
        ].map(([x, y]) => ships.spawn(world, { design: MARKER, x: x!, y: y!, angle: 0, team: NEUTRAL_TEAM, invulnerable: true }));
        const ship = ships.spawn(world, { design: corvette, x: 0, y: 0, angle: 0, team: 0 });
        return { marks, ship };
    });
}

/** Steps until the head of the ship's orders changes or `most` steps pass; the step it changed on, or -1. */
function untilPassed(battle: ReturnType<typeof route>, most: number): number {
    const head = battle.ships.ordersOf(battle.ship)[0];
    for (let step = 0; step < most; step++) {
        battle.step();
        if (battle.ships.ordersOf(battle.ship)[0] !== head) return step;
    }
    return -1;
}

describe("a route of waypoints", () => {
    it("is flown in turn, each passed on from once reached, and the last held", () => {
        const battle = route();
        for (const mark of battle.marks) battle.ships.pushWaypoint(battle.ship, mark, undefined, undefined, 100);
        const bodies = battle.world.bodies;
        const gap = (mark: number): number => {
            const a = bodies.indexOf(battle.ships.body(battle.ship));
            const b = bodies.indexOf(battle.ships.body(mark));
            return math.distance(bodies.x[a]!, bodies.y[a]!, bodies.x[b]!, bodies.y[b]!);
        };
        for (const mark of battle.marks.slice(0, 2)) {
            expect(battle.ships.ordersOf(battle.ship)[0]!.target).toBe(mark);
            expect(untilPassed(battle, 60 * 60)).toBeGreaterThanOrEqual(0);
            // Passed on from within reach of it, skin to skin.
            expect(gap(mark)).toBeLessThanOrEqual(100 + battle.ships.designs[battle.ship]!.radius + MARKER.radius);
        }
        expect(battle.ships.ordersOf(battle.ship).map((order) => order.target)).toEqual([battle.marks[2]]);
        // The last is held, however long it is sat at.
        for (let step = 0; step < 60 * 40; step++) battle.step();
        expect(battle.ships.ordersOf(battle.ship).map((order) => order.target)).toEqual([battle.marks[2]]);
        expect(gap(battle.marks[2]!)).toBeLessThan(300);
    });

    it("waits out each waypoint's linger before going on", () => {
        const quick = route();
        const slow = route();
        for (const mark of quick.marks) quick.ships.pushWaypoint(quick.ship, mark, undefined, undefined, 100);
        for (const mark of slow.marks) slow.ships.pushWaypoint(slow.ship, mark, undefined, undefined, 100, 5);
        expect(untilPassed(slow, 60 * 60)).toBeGreaterThan(untilPassed(quick, 60 * 60) + 60 * 4);
    });

    it("holds a waypoint with no reach for good, as one given alone", () => {
        const battle = route();
        battle.ships.pushWaypoint(battle.ship, battle.marks[0]!);
        battle.ships.pushWaypoint(battle.ship, battle.marks[1]!, undefined, undefined, 100);
        expect(untilPassed(battle, 60 * 40)).toBe(-1);
    });

    it("is given by command, a reach and a linger kept in the log", () => {
        const battle = route();
        for (const [n, mark] of battle.marks.entries()) {
            give(battle, {
                kind: "order",
                ships: [battle.ship],
                order: { kind: "waypoint", target: mark, reach: 100, linger: 2 },
                append: n > 0,
            });
        }
        expect(battle.ships.ordersOf(battle.ship)).toMatchObject(battle.marks.map((target) => ({ target, reach: 100, linger: 2 })));
        const order = { kind: "waypoint", target: 1, reach: 100, linger: 2 };
        expect(parseLog([{ step: 0, command: { kind: "order", ships: [0], order, append: false } }])).toHaveLength(1);
        expect(() =>
            parseLog([{ step: 0, command: { kind: "order", ships: [0], order: { ...order, reach: -1 }, append: false } }]),
        ).toThrow(/reach/);
        expect(() =>
            parseLog([{ step: 0, command: { kind: "order", ships: [0], order: { kind: "defend", target: 1, reach: 10 }, append: false } }]),
        ).toThrow(/reach/);
    });
});

describe("a race round a course", () => {
    it("starts every ship with the whole course queued, each goal passed on from as it is reached", () => {
        const course = { goals: 3, leg: 300, legSpread: 0, turn: 90, turnSpread: 0 };
        const match = new Match([CORVETTE], { seed: 5, course, goal: { x: 0, y: 0, scale: 500, size: 12, linger: 1, finalLinger: 4 } });
        const { ships, slots, markers } = match.battle;
        expect(ships.ordersOf(slots[0]!)).toMatchObject([
            { target: markers[0], reach: 100, linger: 1 },
            { target: markers[1], reach: 100, linger: 1 },
            { target: markers[2], reach: 100, linger: 4 },
        ]);
        while (!match.done) match.advance();
        expect(match.result().ending).toBe("finished");
        expect(ships.ordersOf(slots[0]!).map((order) => order.target)).toEqual([markers[2]]);
    });
});
