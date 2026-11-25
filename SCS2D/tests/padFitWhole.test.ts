import { describe, expect, it } from "vitest";
import { compileBlueprint } from "../sim/index.js";
import { couldDockAt } from "../sim/shipOrders.js";
import { makeBattle } from "../scenarios/battle.js";
import { DINKY } from "../scenarios/blueprints.js";
import { FACTORY } from "../scenarios/carrier.js";

/** A Factory with no fighters, and a Dinky beside it. */
function scene() {
    return makeBattle({ seed: 1 }, (ships, world) => {
        const empty = { ...FACTORY, modules: FACTORY.modules.map((m) => ("kind" in m && m.kind === "pad" ? { ...m, keep: 0 } : m)) };
        const c = ships.spawn(world, { design: compileBlueprint(empty), x: 0, y: 0 });
        const f = ships.spawn(world, { design: compileBlueprint(DINKY), x: 200, y: 0 });
        return { c, f };
    });
}

describe("whether a fighter fits a pad", () => {
    it("fits one its design fits", () => {
        const run = scene();
        expect(couldDockAt(run.ships, run.f, run.c)).toBe(true);
    });

    it("goes by the design it is built to, not what damage has left of it", () => {
        const run = scene();
        // As though damage had cut it down from something far bigger, which its robots will build back.
        run.ships.launched[run.f] = compileBlueprint(FACTORY);
        expect(couldDockAt(run.ships, run.f, run.c)).toBe(false);
    });
});
