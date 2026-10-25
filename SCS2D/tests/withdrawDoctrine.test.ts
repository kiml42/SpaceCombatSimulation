import { describe, expect, it } from "vitest";
import { compileBlueprint, type Blueprint, type ShipDesign } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { CORVETTE, TANKER } from "../scenarios/blueprints.js";
import type { Battle } from "../scenarios/types.js";

/** Ships whose doctrine has them hide or flee without being told (ROADMAP.md §8 step 14, slice 3). */

/** A gun on a core, going nowhere: something to keep clear of that does not give chase. */
const FORT = compileBlueprint({
    name: "Fort",
    modules: [
        { kind: "core", x: 0, y: 0, length: 6, width: 6 },
        { kind: "turret", x: 5, y: 0, length: 4, width: 4, barrels: 1 },
    ],
} satisfies Blueprint);

function withApproach(blueprint: Blueprint, changes: Record<string, number>): ShipDesign {
    const doctrine = compileBlueprint(blueprint).doctrine;
    return compileBlueprint({ ...blueprint, doctrine: { ...doctrine, approach: { ...doctrine.approach, ...changes } } });
}

const where = (run: Battle, i: number): { x: number; y: number } => {
    const b = run.world.bodies.indexOf(run.ships.body(i));
    return { x: run.world.bodies.x[b]!, y: run.world.bodies.y[b]! };
};
const apart = (run: Battle, i: number, j: number): number => {
    const a = where(run, i);
    const b = where(run, j);
    return Math.hypot(a.x - b.x, a.y - b.y);
};
const steps = (run: Battle, seconds: number): void => {
    for (let s = 0; s < seconds * 60; s++) run.step();
};

describe("a ship with nothing to fight or work with", () => {
    it("keeps clear of armed enemies without being told", () => {
        const tanker = withApproach(TANKER, { hideRange: 0 });
        const run = makeBattle({ seed: 3 }, (ships, world) => ({
            t: ships.spawn(world, { design: tanker, x: 0, y: 0 }),
            f: ships.spawn(world, { design: FORT, x: 500, y: 0, team: 1 }),
        }));
        steps(run, 1);
        expect(run.ships.isWithdrawing(run.t)).toBe(true);
        steps(run, 90);
        expect(apart(run, run.t, run.f)).toBeGreaterThan((FORT.reach + tanker.radius) * tanker.doctrine.approach.fleeMargin);
    });

    it("hides behind a big enough friend near it rather than fleeing", () => {
        const tanker = compileBlueprint(TANKER);
        const big = compileBlueprint(CORVETTE);
        const run = makeBattle({ seed: 3 }, (ships, world) => ({
            t: ships.spawn(world, { design: tanker, x: 0, y: 150 }),
            c: ships.spawn(world, { design: big, x: 0, y: 0, angle: 0 }),
            f: ships.spawn(world, { design: FORT, x: 1500, y: 0, team: 1 }),
        }));
        expect(big.radius).toBeGreaterThan(tanker.radius * tanker.doctrine.approach.hideSize);
        steps(run, 1);
        expect(run.ships.doingOf(run.t)).toEqual({ kind: "hide", target: run.c });
    });
});

describe("a ship that has lost its guns", () => {
    function crippled(fleeArmed: number) {
        const corvette = withApproach(CORVETTE, { fleeArmed, hideRange: 0 });
        const run = makeBattle({ seed: 3 }, (ships, world) => ({
            c: ships.spawn(world, { design: corvette, x: 0, y: 0 }),
            f: ships.spawn(world, { design: FORT, x: 800, y: 0, team: 1 }),
        }));
        const b = run.world.bodies.indexOf(run.ships.body(run.c));
        for (const mount of corvette.turrets) {
            if (mount.main) run.ships.damage.absorb(b, mount.module, run.ships.damage.capacityLeft(b, mount.module) * 0.98);
        }
        return run;
    }

    it("withdraws at its fleeArmed, and fights on with the default", () => {
        const told = crippled(0);
        steps(told, 2);
        expect(told.ships.isDisarmed(told.c)).toBe(true);
        expect(told.ships.isWithdrawing(told.c)).toBe(true);
        const fights = crippled(-1);
        steps(fights, 2);
        expect(fights.ships.isWithdrawing(fights.c)).toBe(false);
    });
});
