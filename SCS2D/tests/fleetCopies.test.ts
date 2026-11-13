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
        ["a mirrored group", { group: "Pair", x: -3, y: 8, angle: 0.4, mirror: true }, { x: 6, y: 15, angle: 0.25 }],
        ["an arc", { design: "Dinky", x: 0, y: 0, angle: 0.2 }, { x: 0, y: 20, angle: 0.3 }],
    ];
    for (const [name, entry, along] of shapes) {
        it(`stands the middle of ${name} row where the entry is, and the rest alike either side`, () => {
            for (const copies of [3, 5, 7]) {
                const ships = expandFleet(fleetOf(withCopies(entry, copies, along)));
                const middle = ships[(copies - 1) / 2]!;
                expect(middle.x).toBeCloseTo(entry.x, 9);
                expect(middle.y).toBeCloseTo(entry.y, 9);
                expect(middle.angle).toBeCloseTo(entry.angle ?? 0, 9);
            }
            // As far out, and turned as much, the other way.
            const turn = ("mirror" in entry && entry.mirror === true ? -1 : 1) * (along.angle ?? 0);
            const from = (each: { x: number; y: number }): number => math.sqrt((each.x - entry.x) ** 2 + (each.y - entry.y) ** 2);
            for (const copies of [2, 4, 5]) {
                const ships = expandFleet(fleetOf(withCopies(entry, copies, along)));
                ships.forEach((ship, copy) => {
                    expect(from(ship)).toBeCloseTo(from(ships[copies - 1 - copy]!), 9);
                    expect(ship.angle).toBeCloseTo((entry.angle ?? 0) + (copy - (copies - 1) / 2) * turn, 9);
                });
            }
        });
    }
});

describe("a row that comes round in a full turn", () => {
    it("rings a centre ahead of the entry, bows in, when it steps sideways", () => {
        const ring = withCopies({ design: "Dinky", x: 0, y: 0 }, 12, { x: 0, y: 12, angle: -math.PI / 6 });
        const ships = expandFleet(fleetOf(ring));
        // A twelve-sided ring with sides of 12 m.
        const radius = 12 / (2 * math.sin(math.PI / 12));
        for (const ship of ships) {
            expect(math.sqrt((ship.x - radius) ** 2 + ship.y ** 2)).toBeCloseTo(radius, 9);
            expect(math.cos(math.atan2(-ship.y, radius - ship.x) - ship.angle)).toBeCloseTo(1, 9);
        }
        expect(new Set(ships.map((ship) => `${ship.x.toFixed(6)},${ship.y.toFixed(6)}`)).size).toBe(12);
    });
});
