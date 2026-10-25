import { describe, expect, it } from "vitest";
import {
    CONTROL_REACH,
    CORE_COMPUTING_SHARE,
    Ships,
    World,
    blueprintProblems,
    compileBlueprint,
    controlRadius,
    inReachDesign,
    moduleStats,
    type Blueprint,
    type ModuleSpec,
} from "../sim/index.js";

/**
 * A core reaches only so far: a module that needs one works only while a
 * working core's circle touches its block (ROADMAP.md §12).
 */

function core(x: number, y: number, size: number, computing?: number): ModuleSpec {
    return { kind: "core", x, y, length: size, width: size, ...(computing === undefined ? {} : { computing }) };
}

/** A core, a spine running aft from it `length` long, and a turret on the far end. */
function longShip(length: number, extra: ModuleSpec[] = []): Blueprint {
    return {
        name: "Long",
        modules: [
            core(0, 0, 2),
            { kind: "structure", x: -1 - length / 2, y: 0, length, width: 2 },
            { kind: "turret", x: -1 - length + 1, y: 2, length: 2, width: 2 },
            ...extra,
        ],
    };
}

const TURRET = 2;

describe("how far a core reaches", () => {
    it("grows with its computing, but ever more slowly", () => {
        expect(controlRadius(1)).toBeCloseTo(CONTROL_REACH);
        // Ten times the computing, about twice the reach.
        expect(controlRadius(10)).toBeCloseTo(2 * CONTROL_REACH, 0);
        expect(controlRadius(0)).toBe(0);
    });

    it("is all computing in a small core, and a share of a big one", () => {
        const small = moduleStats(core(0, 0, 0.6));
        expect(small.controlRadius).toBeCloseTo(controlRadius(small.interior));
        const big = moduleStats(core(0, 0, 8));
        expect(big.controlRadius).toBeCloseTo(controlRadius(CORE_COMPUTING_SHARE * big.interior));
        // More computing reaches further, and leaves less room for stores.
        const thinking = moduleStats(core(0, 0, 8, 0.5));
        expect(thinking.controlRadius).toBeGreaterThan(big.controlRadius);
        expect(thinking.fuel).toBeLessThan(big.fuel);
    });
});

describe("what a core reaches", () => {
    it("leaves out a module beyond every core, and anything that needs none", () => {
        const near = compileBlueprint(longShip(4));
        const far = compileBlueprint(longShip(30));
        expect(blueprintProblems(longShip(30))).toEqual([]);
        expect(near.coveredBy![TURRET]).toEqual([0]);
        expect(far.coveredBy![TURRET]).toEqual([]);
        // The spine needs no core to be a spine.
        expect(far.coveredBy![1]).toBeNull();
    });

    it("counts a second core near the far end", () => {
        const design = compileBlueprint(longShip(30, [core(-31 + 1, -2, 2)]));
        expect(design.coveredBy![TURRET]).toEqual([3]);
    });

    it("flies without what is out of reach", () => {
        const far = compileBlueprint(longShip(30));
        expect(far.turrets).toHaveLength(1);
        expect(inReachDesign(far).turrets).toHaveLength(0);
        const near = compileBlueprint(longShip(4));
        expect(inReachDesign(near)).toBe(near);
    });
});

describe("in a battle", () => {
    function spawn(blueprint: Blueprint): { ships: Ships; ship: number; body: number } {
        const world = new World({ dt: 1 / 60, seed: 1 });
        const ships = new Ships();
        const ship = ships.spawn(world, { design: compileBlueprint(blueprint), x: 0, y: 0, team: 0 });
        return { ships, ship, body: world.bodies.indexOf(ships.body(ship)) };
    }

    it("a gun out of reach does not work, though the ship is under control", () => {
        const far = spawn(longShip(30));
        expect(far.ships.hasControl(far.ship)).toBe(true);
        expect(far.ships.isTurretDisabled(far.ship, 0)).toBe(true);
        const near = spawn(longShip(4));
        expect(near.ships.isTurretDisabled(near.ship, 0)).toBe(false);
    });

    it("a gun goes dark when the only core reaching it is shot out", () => {
        const s = spawn(longShip(30, [core(-31 + 1, -2, 2)]));
        expect(s.ships.isTurretDisabled(s.ship, 0)).toBe(false);
        s.ships.damage.absorb(s.body, 3, 1e12);
        expect(s.ships.hasControl(s.ship)).toBe(true);
        expect(s.ships.isTurretDisabled(s.ship, 0)).toBe(true);
    });
});
