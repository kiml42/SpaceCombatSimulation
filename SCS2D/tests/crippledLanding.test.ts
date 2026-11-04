import { describe, expect, it } from "vitest";
import { compileBlueprint, type Blueprint } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { DINKY, REPLICATOR } from "../scenarios/blueprints.js";

/**
 * Fighters deliberately crippled, each making for a carrier's pad low on fuel:
 * the kinds of damage a fighter used to be left hanging by its carrier with.
 */

/** A carrier with a pad as big as `pad` long and wide, and fuel, metal and charge to give. */
function carrier(length: number, width: number): Blueprint {
    return {
        name: "Carrier",
        modules: [
            { kind: "core", x: 0, y: 0, length: 6, width: 6 },
            { kind: "tank", x: -13, y: 0, length: 20, width: 10 },
            { kind: "hold", x: 0, y: 6, length: 6, width: 6, fill: 1 },
            { kind: "generator", x: 0, y: -6, length: 6, width: 6 },
            { kind: "pad", x: 3 + length / 2, y: 0, length, width },
        ],
    };
}

/** `fighter` with its modules `lost` shot away and most of its fuel gone, 360 m off a carrier: when it lands, in seconds, what it hit, and how it can turn. */
function landing(fighter: Blueprint, pad: Blueprint, lost: readonly number[]): { at: number; contacts: number; turns: [number, number] } {
    const doctrine = compileBlueprint(fighter).doctrine;
    // Low enough on fuel to go, and not sent by how whole it is, which would muddle what is being tested.
    const design = compileBlueprint({
        ...fighter,
        doctrine: { ...doctrine, approach: { ...doctrine.approach, refuelBelow: 0.5, repairBelow: 0 } },
    });
    const run = makeBattle({ seed: 3 }, (ships, world) => {
        const c = ships.spawn(world, { design: compileBlueprint(pad), x: 0, y: 0, angle: 0.3, team: 0 });
        const f = ships.spawn(world, { design, x: -300, y: 200, angle: 0, team: 0 });
        const b = world.bodies.indexOf(ships.body(f));
        for (let m = 0; m < design.modules.length; m++) ships.fuel.vent(b, m, ships.fuel.held(b, m) * 0.7);
        for (const m of lost) ships.damage.absorb(b, m, ships.damage.capacityLeft(b, m));
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

describe("a Dinky that can turn only one way", () => {
    // Its Side thrusters and their opposite numbers: losing these leaves its turn one way only.
    it.each([
        ["anticlockwise", [2, 7, 8]],
        ["clockwise", [1, 2, 9]],
    ])("lands spinning, turning only %s", (_, lost) => {
        const { at, contacts, turns } = landing(DINKY, carrier(10, 10), lost);
        expect(turns.filter((t) => t > 0)).toHaveLength(1);
        expect(at).toBeLessThan(120);
        expect(contacts).toBe(0);
    });
});

describe("a Dinky Raider", () => {
    // Its modules: 1, 3, 7, 9 thrusters pushing it sideways, 2 and 8 pushing it back,
    // 4 its main, 6 its gun (half its mass, at the nose), 10 its hold.
    const RAIDER = REPLICATOR.hangar!["Dinky Raider"]!;
    const PAD = carrier(8.674634452, 7);

    it.each([[[1, 8]], [[3, 7]]])("lands with its turn one way far weaker than the other, spinning in, having lost %j", (lost) => {
        const { at, contacts, turns } = landing(RAIDER, PAD, lost);
        expect(Math.min(...turns) / Math.max(...turns)).toBeLessThan(0.5);
        expect(Math.min(...turns)).toBeGreaterThan(0);
        expect(at).toBeLessThan(120);
        expect(contacts).toBe(0);
    });

    it.each([[[4]], [[2, 4]]])("lands on its thrusters once its main is gone, having lost %j", (lost) => {
        const { at, contacts } = landing(RAIDER, PAD, lost);
        expect(at).toBeLessThan(150);
        expect(contacts).toBe(0);
    });

    it.each([[[4, 6]], [[4, 8, 10]]])("lands spinning on thrusters that cannot push its way without turning it, having lost %j", (lost) => {
        const { at, contacts } = landing(RAIDER, PAD, lost);
        expect(at).toBeLessThan(150);
        expect(contacts).toBe(0);
    });

    it.each([[[4, 7, 10]], [[1, 4, 10]]])(
        "lands on its thrusters turning one way, though every push adds to its spin, having lost %j",
        (lost) => {
            const { at, contacts, turns } = landing(RAIDER, PAD, lost);
            expect(turns.filter((t) => t > 0)).toHaveLength(1);
            expect(at).toBeLessThan(170);
            expect(contacts).toBe(0);
        },
    );
});
