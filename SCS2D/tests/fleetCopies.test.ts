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

const step = { x: 0, y: 10 };

describe("changing an entry's copies", () => {
    it("puts one either side going from one to three, and leaves the entry where it was", () => {
        const three = withCopies({ design: "Dinky", x: 50, y: 20 }, 3, step);
        expect(expandFleet(fleetOf(three)).map((ship) => ship.y)).toEqual([10, 20, 30]);
        expect(three).toMatchObject({ x: 50, y: 20, repeat: 3 });
    });

    it("stands two half a step either side", () => {
        const two = withCopies({ design: "Dinky", x: 50, y: 20 }, 2, step);
        expect(expandFleet(fleetOf(two)).map((ship) => ship.y)).toEqual([15, 25]);
    });

    it("comes back to one where the entry stands, without a repeat", () => {
        const one = withCopies({ design: "Dinky", x: 50, y: 20, repeat: 3, step }, 1, step);
        expect(one).toMatchObject({ x: 50, y: 20 });
        expect(one.repeat).toBeUndefined();
    });

    // Turned, mirrored and curved rows are each laid out differently; each is laid out round the entry.
    const shapes: readonly [string, FleetEntry, NonNullable<FleetEntry["step"]>][] = [
        ["turned", { design: "Dinky", x: 5, y: -7, angle: math.PI / 3 }, { x: 4, y: 12 }],
        ["a mirrored group", { group: "Pair", x: -3, y: 8, angle: 0.4, mirror: true }, { x: 6, y: 15 }],
        ["an arc", { design: "Dinky", x: 0, y: 0, angle: 0.2 }, { x: 0, y: 20, angle: 0.3 }],
    ];
    for (const [name, entry, along] of shapes) {
        it(`stands the middle of ${name} row where the entry is, and the rest in step either side`, () => {
            for (const copies of [3, 5, 7]) {
                const ships = expandFleet(fleetOf(withCopies(entry, copies, along)));
                const middle = ships[(copies - 1) / 2]!;
                expect(middle.x).toBeCloseTo(entry.x, 9);
                expect(middle.y).toBeCloseTo(entry.y, 9);
                expect(middle.angle).toBeCloseTo(entry.angle ?? 0, 9);
            }
            // An even row's middle two stand a step apart, as far either side of the entry.
            for (const copies of [2, 4]) {
                const ships = expandFleet(fleetOf(withCopies(entry, copies, along)));
                const a = ships[copies / 2 - 1]!;
                const b = ships[copies / 2]!;
                const from = (ship: { x: number; y: number }): number => math.sqrt((ship.x - entry.x) ** 2 + (ship.y - entry.y) ** 2);
                expect(from(a)).toBeCloseTo(from(b), 9);
                expect(math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)).toBeCloseTo(math.sqrt(along.x ** 2 + along.y ** 2), 9);
                expect((a.angle + b.angle) / 2).toBeCloseTo(entry.angle ?? 0, 9);
            }
        });
    }
});
