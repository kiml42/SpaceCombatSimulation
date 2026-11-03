import { expect, it } from "vitest";
import { compileBlueprint, type Blueprint } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { DINKY } from "../scenarios/blueprints.js";

const CARRIER: Blueprint = {
    name: "Carrier",
    modules: [
        { kind: "core", x: 0, y: 0, length: 6, width: 6 },
        { kind: "tank", x: -13, y: 0, length: 20, width: 10 },
        { kind: "pad", x: 8, y: 0, length: 10, width: 10 },
    ],
};

/** A Dinky low on fuel with engines `lost`, making for a carrier's pad: when it lands, in seconds, and what it hit. */
function landing(lost: readonly number[]): { at: number; contacts: number; turns: [number, number] } {
    const doctrine = compileBlueprint(DINKY).doctrine;
    const fighter = compileBlueprint({ ...DINKY, doctrine: { ...doctrine, approach: { ...doctrine.approach, refuelBelow: 0.5 } } });
    const run = makeBattle({ seed: 3 }, (ships, world) => {
        const c = ships.spawn(world, { design: compileBlueprint(CARRIER), x: 0, y: 0, angle: 0.3, team: 0 });
        const f = ships.spawn(world, { design: fighter, x: -300, y: 200, angle: 0, team: 0 });
        const b = world.bodies.indexOf(ships.body(f));
        for (let m = 0; m < fighter.modules.length; m++) ships.fuel.vent(b, m, ships.fuel.held(b, m) * 0.8);
        for (const m of lost) ships.damage.absorb(b, m, 1e12);
        return { c, f };
    });
    const layout = (run.ships as unknown as { layoutOf(i: number): { maxTorque(sense: number): number } }).layoutOf(run.f);
    let t = 0;
    while (t < 180 * 60 && run.ships.parkedCarrier(run.f) !== run.c) {
        run.step();
        t++;
    }
    return {
        at: run.ships.parkedCarrier(run.f) === run.c ? t / 60 : Infinity,
        contacts: run.totalContacts,
        turns: [layout.maxTorque(1), layout.maxTorque(-1)],
    };
}

it.each([
    ["anticlockwise", [2, 7, 8]],
    ["clockwise", [1, 2, 9]],
])("lands a fighter that can turn only %s, spinning in", (_, lost) => {
    const { at, contacts, turns } = landing(lost);
    expect(turns.filter((t) => t > 0)).toHaveLength(1);
    expect(at).toBeLessThan(120);
    expect(contacts).toBe(0);
});
