import { expect, it } from "vitest";
import { compileBlueprint, type Blueprint } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { DINKY } from "../scenarios/blueprints.js";

const CARRIER: Blueprint = {
    name: "Carrier",
    modules: [
        { kind: "core", x: 0, y: 0, length: 6, width: 6 },
        { kind: "tank", x: -13, y: 0, length: 20, width: 10 },
        { kind: "hold", x: 0, y: 6, length: 6, width: 6, fill: 1 },
        { kind: "generator", x: 0, y: -6, length: 6, width: 6 },
        { kind: "pad", x: 8, y: 0, length: 10, width: 10 },
    ],
};

/**
 * A Dinky full of fuel with its gun shot away, by a carrier, with nothing to fight: whether it lands, and is mended there.
 * Its gun is half its mass, so `repairBelow` would send it too, and is off; so
 * is `refuelBelow`, since it burns its fuel down loitering for want of a target.
 */
function disarmed(repairArmed: number): { landed: boolean; mended: boolean } {
    const doctrine = compileBlueprint(DINKY).doctrine;
    const fighter = compileBlueprint({
        ...DINKY,
        doctrine: { ...doctrine, approach: { ...doctrine.approach, repairArmed, repairBelow: 0, refuelBelow: 0 } },
    });
    const gun = fighter.modules.findIndex((m) => m.spec.kind === "hullGun");
    const run = makeBattle({ seed: 3 }, (ships, world) => {
        const c = ships.spawn(world, { design: compileBlueprint(CARRIER), x: 0, y: 0, angle: 0.3, team: 0 });
        const f = ships.spawn(world, { design: fighter, x: -300, y: 200, angle: 0, team: 0 });
        const b = world.bodies.indexOf(ships.body(f));
        ships.damage.absorb(b, gun, ships.damage.capacityLeft(b, gun));
        return { c, f };
    });
    let landed = false;
    for (let t = 0; t < 120 * 60 && !(landed && !run.ships.isTurretDisabled(run.f, 0)); t++) {
        run.step();
        landed ||= run.ships.parkedCarrier(run.f) === run.c;
    }
    return { landed, mended: landed && !run.ships.isTurretDisabled(run.f, 0) };
}

it("sends a fighter whose guns are out back to a pad to be mended, by its doctrine's repairArmed", () => {
    expect(disarmed(0)).toEqual({ landed: true, mended: true });
    expect(disarmed(-1).landed).toBe(false);
});
