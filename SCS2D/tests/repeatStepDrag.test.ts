import { describe, expect, it } from "vitest";
import { expandBlueprint, type Blueprint, type ModulePath } from "../sim/index.js";
import { instancePose, shiftRepeatStep, turnRepeatStep } from "../editor/edit.js";

const row = (angle = 0, mirror = false, repeat = 3): Blueprint => ({
    name: "Test",
    modules: [
        { kind: "core", x: 0, y: 0, length: 4, width: 4 },
        { use: "Rib", x: 4, y: 0, angle, mirror, repeat, step: { x: 3, y: 0 } },
    ],
    assemblies: { Rib: { modules: [{ kind: "structure", x: 0, y: 0, length: 3, width: 2 }] } },
});

const RIB: ModulePath = [{ index: 1, copy: 0, into: "assembly", assembly: "Rib" }];
/** The drawn pose of the `copy`th rib. */
const poseOf = (ship: Blueprint, copy: number) => {
    const path: ModulePath = [{ ...RIB[0]!, copy }];
    return instancePose(ship, path, [...path, { index: 0, copy: 0 }])!;
};

const CASES = [
    [0, false],
    [Math.PI / 2, false],
    [0.7, true],
] as const;

describe("a repeated row's step, set from its second copy", () => {
    for (const [angle, mirror] of CASES) {
        it(`moves the second copy where it is dragged, and the rest by as much again (${angle}, ${mirror})`, () => {
            const ship = row(angle, mirror);
            const before = expandBlueprint(ship);
            const after = expandBlueprint(shiftRepeatStep(ship, RIB, poseOf(ship, 0), 1, 2)!);
            expect(after[1]!.x).toBeCloseTo(before[1]!.x, 9);
            expect(after[2]!.x).toBeCloseTo(before[2]!.x + 1, 9);
            expect(after[2]!.y).toBeCloseTo(before[2]!.y + 2, 9);
            expect(after[3]!.x).toBeCloseTo(before[3]!.x + 2, 9);
            expect(after[3]!.y).toBeCloseTo(before[3]!.y + 4, 9);
        });

        it(`turns the second copy to the bearing asked, in place, and the next round the arc (${angle}, ${mirror})`, () => {
            const ship = row(angle, mirror);
            const first = poseOf(ship, 0);
            const bearing = first.rotation + 0.4;
            const turned = turnRepeatStep(ship, RIB, first, bearing)!;
            const second = poseOf(turned, 1);
            expect(second.x).toBeCloseTo(poseOf(ship, 1).x, 9);
            expect(second.y).toBeCloseTo(poseOf(ship, 1).y, 9);
            expect(Math.cos(second.rotation - bearing)).toBeCloseTo(1, 9);
            expect(Math.cos(poseOf(turned, 2).rotation - (bearing + 0.4))).toBeCloseTo(1, 9);
        });
    }

    it("leaves a placement that does not repeat alone", () => {
        const ship = row(0, false, 1);
        expect(shiftRepeatStep(ship, RIB, poseOf(ship, 0), 1, 0)).toBeNull();
        expect(turnRepeatStep(ship, RIB, poseOf(ship, 0), 1)).toBeNull();
    });

    it("drops a turn back to none", () => {
        const ship = row();
        const turned = turnRepeatStep(ship, RIB, poseOf(ship, 0), poseOf(ship, 0).rotation)!;
        expect(turned.modules[1]).toMatchObject({ step: { x: 3, y: 0 } });
        expect((turned.modules[1] as { step: { angle?: number } }).step.angle).toBeUndefined();
    });
});
