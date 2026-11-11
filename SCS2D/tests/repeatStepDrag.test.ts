import { describe, expect, it } from "vitest";
import { expandBlueprint, expandWithOrigins, type Blueprint } from "../sim/index.js";
import { movePlacement, moveRepeatStep, positionHandle } from "../editor/edit.js";

const row = (angle = 0, mirror = false): Blueprint => ({
    name: "Test",
    modules: [
        { kind: "core", x: 0, y: 0, length: 4, width: 4 },
        { use: "Rib", x: 4, y: 0, angle, mirror, repeat: 3, step: { x: 3, y: 0 } },
    ],
    assemblies: { Rib: { modules: [{ kind: "structure", x: 0, y: 0, length: 3, width: 2 }] } },
});

/** The handle a drag on the `copy`th rib takes hold of, as the canvas resolves it. */
const handleOf = (ship: Blueprint, copy: number) => {
    const origins = expandWithOrigins(ship).origins;
    return positionHandle(ship, origins[1 + copy]!).origin;
};

describe("dragging a repeated row's copies", () => {
    for (const [angle, mirror] of [
        [0, false],
        [Math.PI / 2, false],
        [0.7, true],
    ] as const) {
        it(`moves the second copy where it is dragged, and the rest by as much again (${angle}, ${mirror})`, () => {
            const ship = row(angle, mirror);
            const before = expandBlueprint(ship);
            const after = expandBlueprint(moveRepeatStep(ship, handleOf(ship, 1), 1, 2)!);
            expect(after[1]!.x).toBeCloseTo(before[1]!.x, 9);
            expect(after[2]!.x).toBeCloseTo(before[2]!.x + 1, 9);
            expect(after[2]!.y).toBeCloseTo(before[2]!.y + 2, 9);
            expect(after[3]!.x).toBeCloseTo(before[3]!.x + 2, 9);
            expect(after[3]!.y).toBeCloseTo(before[3]!.y + 4, 9);
        });
    }

    it("leaves the first and later copies to move the whole row", () => {
        const ship = row();
        expect(moveRepeatStep(ship, handleOf(ship, 0), 1, 0)).toBeNull();
        expect(moveRepeatStep(ship, handleOf(ship, 2), 1, 0)).toBeNull();
        const moved = expandBlueprint(movePlacement(ship, handleOf(ship, 0), 1, 0)!);
        expect(moved[3]!.x).toBeCloseTo(expandBlueprint(ship)[3]!.x + 1, 9);
    });
});
