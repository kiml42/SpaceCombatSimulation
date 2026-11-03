import { expect, it } from "vitest";
import { compileBlueprint, type Blueprint } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { BARE_CORE, DINKY } from "../scenarios/blueprints.js";

/** A pad on one side and a slipway on the other, with the metal and charge to build on it. */
const YARD: Blueprint = {
    name: "Yard",
    modules: [
        { kind: "core", x: 0, y: 0, length: 6, width: 6 },
        { kind: "tank", x: -13, y: 0, length: 20, width: 10 },
        { kind: "hold", x: 0, y: 6, length: 6, width: 6, fill: 1 },
        { kind: "generator", x: 0, y: -6, length: 6, width: 6 },
        { kind: "pad", x: 8, y: 0, length: 10, width: 10 },
        { kind: "slipway", x: 0, y: 11, angle: Math.PI / 2, length: 4, width: 6, craft: BARE_CORE.name, keep: 1 },
    ],
    hangar: { [BARE_CORE.name]: BARE_CORE },
};

it("lands a fighter to refill on a carrier with a copy on its slipway, rather than shying from it", () => {
    const doctrine = compileBlueprint(DINKY).doctrine;
    const fighter = compileBlueprint({ ...DINKY, doctrine: { ...doctrine, approach: { ...doctrine.approach, refuelBelow: 0.5 } } });
    const run = makeBattle({ seed: 3 }, (ships, world) => {
        const c = ships.spawn(world, { design: compileBlueprint(YARD), x: 0, y: 0, angle: 0.3, team: 0 });
        const f = ships.spawn(world, { design: fighter, x: -300, y: 200, angle: 0, team: 0 });
        const b = world.bodies.indexOf(ships.body(f));
        for (let m = 0; m < fighter.modules.length; m++) ships.fuel.vent(b, m, ships.fuel.held(b, m) * 0.7);
        return { c, f };
    });
    const printing = () =>
        Array.from({ length: run.ships.highWater }, (_, i) => i).some((i) => run.ships.isAlive(i) && run.ships.isPrinting(i));
    let sawCopy = false;
    let t = 0;
    for (; t < 120 * 60 && run.ships.parkedCarrier(run.f) !== run.c; t++) {
        run.step();
        sawCopy ||= printing();
    }
    expect(sawCopy).toBe(true);
    expect(printing()).toBe(true);
    expect(run.ships.parkedCarrier(run.f)).toBe(run.c);
});
