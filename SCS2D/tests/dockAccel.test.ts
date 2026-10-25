import { describe, expect, it } from "vitest";
import { compileBlueprint, type Blueprint } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { DINKY } from "../scenarios/blueprints.js";
import { ANY_RANGE, QUARRY } from "./fixtures/quarry.js";

/** A fighter landing on a carrier that is speeding up matches how it speeds up, not only how it moves. */

const CARRIER: Blueprint = {
    name: "Carrier",
    modules: [
        { kind: "core", x: 0, y: 0, length: 6, width: 6 },
        { kind: "tank", x: -13, y: 0, length: 20, width: 10 },
        { kind: "pad", x: 13, y: 0, length: 20, width: 20 },
    ],
};

/** A Dinky low on fuel, and the carrier pushed along at `accel` m/s² every step, as if under thrust. */
function landing(accel: number): { landed: boolean; seconds: number } {
    const doctrine = compileBlueprint(DINKY).doctrine;
    const dinky = compileBlueprint({
        ...DINKY,
        doctrine: { ...doctrine, approach: { ...doctrine.approach, refuelBelow: 0.5, sortieRange: ANY_RANGE } },
    });
    const run = makeBattle({ seed: 3 }, (ships, world) => {
        const c = ships.spawn(world, { design: compileBlueprint(CARRIER), x: 0, y: 0, angle: 0 });
        const f = ships.spawn(world, { design: dinky, x: -300, y: 200, angle: 0 });
        const b = world.bodies.indexOf(ships.body(f));
        for (let m = 0; m < dinky.modules.length; m++) ships.fuel.vent(b, m, ships.fuel.held(b, m) * 0.8);
        ships.spawn(world, { design: QUARRY, x: 0, y: 50_000, team: 1 });
        return { c, f };
    });
    const bodies = run.world.bodies;
    let s = 0;
    for (; s < 120 * 60 && run.ships.parkedCarrier(run.f) !== run.c; s++) {
        run.step();
        const cb = bodies.indexOf(run.ships.body(run.c));
        // Only while it is flying free: once it is down, the two move as one.
        if (run.ships.parkedCarrier(run.f) !== run.c) bodies.vx[cb] = bodies.vx[cb]! + accel * run.dt;
    }
    return { landed: run.ships.parkedCarrier(run.f) === run.c, seconds: s / 60 };
}

describe("a fighter landing on an accelerating carrier", () => {
    it("keeps up with it and lands", () => {
        const { landed } = landing(2);
        expect(landed).toBe(true);
    });

    it("lands on one that is not speeding up just as it did", () => {
        expect(landing(0).landed).toBe(true);
    });
});
