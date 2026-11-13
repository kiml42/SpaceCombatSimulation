import { describe, expect, it } from "vitest";
import { expandFleet, math, type Fleet, type FleetEntry } from "../sim/index.js";
import { DINKY } from "../scenarios/blueprints.js";
import { withCopies } from "../editor/fleetEdit.js";

/** A fleet of one entry, as the editor holds it. */
function fleetOf(entry: FleetEntry): Fleet {
    return {
        name: "Copies",
        designs: { Dinky: DINKY },
        groups: { Pair: { ships: [{ design: "Dinky", x: 0, y: 0 }] } },
        ships: [entry],
    };
}

/** Where the copies stand on average, as the battle lays them out. */
function middle(entry: FleetEntry): { x: number; y: number } {
    const ships = expandFleet(fleetOf(entry));
    return {
        x: ships.reduce((sum, ship) => sum + ship.x, 0) / ships.length,
        y: ships.reduce((sum, ship) => sum + ship.y, 0) / ships.length,
    };
}

const step = { x: 0, y: 10 };

describe("changing an entry's copies", () => {
    it("puts one either side going from one to three", () => {
        const three = withCopies({ design: "Dinky", x: 50, y: 20 }, 3, step);
        expect(expandFleet(fleetOf(three)).map((ship) => ship.y)).toEqual([10, 20, 30]);
        expect(three.repeat).toBe(3);
    });

    it("moves the first back by half a step going from one to two", () => {
        const two = withCopies({ design: "Dinky", x: 50, y: 20 }, 2, step);
        expect(expandFleet(fleetOf(two)).map((ship) => ship.y)).toEqual([15, 25]);
    });

    it("comes back to the middle going down to one, without a repeat", () => {
        const one = withCopies({ design: "Dinky", x: 50, y: 10, repeat: 3, step }, 1, step);
        expect(one).toMatchObject({ x: 50, y: 20 });
        expect(one.repeat).toBeUndefined();
    });

    // Turned, mirrored and curved rows are each laid out differently; the middle stays put for all of them.
    const shapes: readonly [string, FleetEntry, FleetEntry["step"]][] = [
        ["turned", { design: "Dinky", x: 5, y: -7, angle: math.PI / 3 }, { x: 4, y: 12 }],
        ["a mirrored group", { group: "Pair", x: -3, y: 8, angle: 0.4, mirror: true }, { x: 6, y: 15 }],
        ["an arc", { design: "Dinky", x: 0, y: 0, angle: 0.2 }, { x: 0, y: 20, angle: 0.3 }],
    ];
    for (const [name, entry, along] of shapes) {
        it(`keeps the middle of ${name} row where it was`, () => {
            const before = withCopies(entry, 2, along!);
            for (const copies of [1, 3, 4, 7]) {
                const after = withCopies(before, copies, along!);
                expect(middle(after).x).toBeCloseTo(middle(before).x, 9);
                expect(middle(after).y).toBeCloseTo(middle(before).y, 9);
            }
        });
    }
});
