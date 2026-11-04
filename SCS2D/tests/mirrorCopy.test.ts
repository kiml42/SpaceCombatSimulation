import { describe, expect, it } from "vitest";
import { expandBlueprint, expandWithOrigins, placementAt, type Blueprint, type ModuleSpec } from "../sim/index.js";
import { duplicatePlacement, mirrorInstance, mirrorPlacement } from "../editor/edit.js";

const block = (x: number, y: number, angle = 0): ModuleSpec => ({ kind: "structure", x, y, angle, length: 3, width: 2 });

/** That `after` is `before` and then its reflection across the centreline, module by module. */
function expectReflected(before: readonly ModuleSpec[], after: readonly ModuleSpec[]): void {
    expect(after).toHaveLength(2 * before.length);
    for (let i = 0; i < before.length; i++) {
        const original = after[i]!;
        const mirror = after[before.length + i]!;
        expect(original.x).toBeCloseTo(before[i]!.x, 9);
        expect(original.y).toBeCloseTo(before[i]!.y, 9);
        expect(mirror.x).toBeCloseTo(original.x, 9);
        expect(mirror.y).toBeCloseTo(-original.y, 9);
        // Compared by direction, since a reflected aft facing may come out as -PI rather than PI.
        expect(Math.cos(mirror.angle ?? 0)).toBeCloseTo(Math.cos(original.angle ?? 0), 9);
        expect(Math.sin(mirror.angle ?? 0)).toBeCloseTo(-Math.sin(original.angle ?? 0), 9);
    }
}

describe("a mirrored copy", () => {
    it("of a module is a shared part placed again on the other side of the centreline", () => {
        const ship: Blueprint = { name: "Test", modules: [block(0, 0), block(-4, 3, 2.5)] };
        const mirrored = mirrorPlacement(ship, expandWithOrigins(ship).origins[1]!)!;
        expectReflected(expandBlueprint(ship).slice(1), expandBlueprint(mirrored.blueprint).slice(1));
        expect(Object.keys(mirrored.blueprint.assemblies!)).toHaveLength(1);
        // The module in the new copy, as a duplicate's is, so the panel goes on showing a module.
        expect(placementAt(mirrored.blueprint, mirrored.path)).toMatchObject({ kind: "structure", x: 0, y: 0 });
        expect(placementAt(mirrored.blueprint, mirrored.path.slice(0, 1))).toMatchObject({ y: -3, mirror: true });
    });

    it("of a turned, reflected and repeated assembly lands every copy where reflecting it would", () => {
        const ship: Blueprint = {
            name: "Test",
            modules: [{ use: "Wing", x: 2, y: 5, angle: 0.3, mirror: true, repeat: 3, step: { x: 3, y: 1, angle: 0.1 } }],
            assemblies: { Wing: { modules: [block(0, 0), block(2, 1, -1)] } },
        };
        const mirrored = mirrorInstance(ship, [{ index: 0, copy: 0 }])!;
        expectReflected(expandBlueprint(ship), expandBlueprint(mirrored.blueprint));
        // A reflected instance's reflection is plain again.
        expect(placementAt(mirrored.blueprint, mirrored.path)).not.toHaveProperty("mirror");
    });

    it("of something on the centreline is written at 0, not -0", () => {
        const ship: Blueprint = { name: "Test", modules: [block(4, 0)] };
        const mirrored = mirrorPlacement(ship, expandWithOrigins(ship).origins[0]!)!;
        const placed = placementAt(mirrored.blueprint, mirrored.path.slice(0, 1))!;
        expect(Object.is(placed.y, 0)).toBe(true);
        expect(placed).not.toHaveProperty("angle");
    });

    it("of a module already the whole of a shared part places that part again, not a part inside it", () => {
        const ship: Blueprint = { name: "Test", modules: [block(0, 0), block(-4, 3)] };
        const duplicated = duplicatePlacement(ship, expandWithOrigins(ship).origins[1]!)!.blueprint;
        const mirrored = mirrorPlacement(duplicated, expandWithOrigins(duplicated).origins[1]!)!;
        expect(Object.keys(mirrored.blueprint.assemblies!)).toHaveLength(1);
        expect(expandBlueprint(mirrored.blueprint)).toHaveLength(4);
        expect(expandBlueprint(mirrored.blueprint)[3]!.y).toBeCloseTo(-3, 9);
        expect(placementAt(mirrored.blueprint, mirrored.path)).toMatchObject({ kind: "structure" });
    });

    it("is refused for a path that names nothing", () => {
        const ship: Blueprint = { name: "Test", modules: [block(0, 0)] };
        expect(mirrorInstance(ship, [{ index: 0, copy: 0 }])).toBeNull();
        expect(mirrorInstance(ship, [{ index: 5, copy: 0 }])).toBeNull();
    });
});
