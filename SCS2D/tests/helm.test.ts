import { describe, expect, it } from "vitest";
import { compileBlueprint, Ships, World, type Blueprint } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { DINKY, REPLICATOR } from "../scenarios/blueprints.js";
import { burnGain, pushBearing, spinWay, steerHeading, STEER_HOLD_SPEED } from "../sim/helm.js";
import type { EngineLayout } from "../sim/engines.js";

/** A Dinky's engine layout with its modules `lost` shot away. */
function layoutLosing(blueprint: Blueprint, lost: readonly number[]): EngineLayout {
    const design = compileBlueprint(blueprint);
    const world = new World({ dt: 1 / 60, seed: 1 });
    const ships = new Ships();
    const f = ships.spawn(world, { design, x: 0, y: 0, team: 0 });
    const b = world.bodies.indexOf(ships.body(f));
    for (const m of lost) ships.damage.absorb(b, m, ships.damage.capacityLeft(b, m));
    return (ships as unknown as { layoutOf(i: number): EngineLayout }).layoutOf(f);
}

describe("the helm", () => {
    it("pushes by its mains while they push hardest, and by what pushes hardest once they are gone", () => {
        expect(pushBearing(layoutLosing(DINKY, []), 0)).toBe(0);
        expect(Math.abs(pushBearing(layoutLosing(DINKY, [4]), 0))).toBeCloseTo(Math.PI / 2, 6);
    });

    it("holds a heading on a whole layout, and spins on one that turns one way, or whose push turns it", () => {
        const whole = layoutLosing(DINKY, []);
        expect(spinWay(whole, pushBearing(whole, 0))).toBe(0);
        const oneWay = layoutLosing(DINKY, [2, 7, 8]);
        expect(spinWay(oneWay, pushBearing(oneWay, 0))).toBe(1);
        const raider = REPLICATOR.hangar!["Dinky Raider"]!;
        const turning = layoutLosing(raider, [4, 6]);
        expect(turning.maxTorque(1) > 0 && turning.maxTorque(-1) > 0).toBe(true);
        expect(spinWay(turning, pushBearing(turning, 0))).not.toBe(0);
    });

    it("turns its push onto a change bigger than its slack, and rests on its heading for a smaller one", () => {
        expect(steerHeading(STEER_HOLD_SPEED + 1, 0, Math.PI, 0.3, 0, STEER_HOLD_SPEED, false)).toBe(0);
        expect(steerHeading(STEER_HOLD_SPEED - 1, 0, Math.PI, 0.3, 0, STEER_HOLD_SPEED, false)).toBe(0.3);
        // With a heading of its own it lets other engines make the small change; with none, it turns rather than push the wrong way.
        expect(steerHeading(STEER_HOLD_SPEED - 1, 0, Math.PI, Math.PI, 0, STEER_HOLD_SPEED, true)).toBe(0);
        // A pilot that has to arrive gently gives less slack.
        expect(steerHeading(2, 0, Math.PI, 0.3, 0, 1, false)).toBe(0);
    });

    it("says what turning its push buys over holding its heading, by what it has left, and nothing when there is nothing to turn for", () => {
        const design = compileBlueprint(DINKY);
        const whole = layoutLosing(DINKY, []);
        const mass = design.mass;
        const inertia = 1000;
        // Wanting to go the way it faces, turning buys nothing; the way it does not, a great deal.
        expect(burnGain(whole, mass, inertia, 0, 50, 0, 2, 0)).toBe(0);
        expect(burnGain(whole, mass, inertia, Math.PI, 50, 0, 2, 0)).toBeGreaterThan(0.5);
        // No change wanted, or no push left to turn.
        expect(burnGain(whole, mass, inertia, 0, 0, 0, 2, 0)).toBe(-1);
        // Its mains gone, nothing pushes it ahead: turning what pushes hardest onto ahead is worth it.
        const mainless = layoutLosing(DINKY, [4]);
        expect(burnGain(mainless, mass, inertia, 0, 50, 0, 2, pushBearing(mainless, 0))).toBeGreaterThan(0.5);
    });
});

/** A gun on a core, going nowhere: something to run from that does not give chase. */
const FORT = compileBlueprint({
    name: "Fort",
    modules: [
        { kind: "core", x: 0, y: 0, length: 6, width: 6 },
        { kind: "turret", x: 5, y: 0, length: 4, width: 4, barrels: 1 },
    ],
} satisfies Blueprint);

describe("a crippled fighter fleeing", () => {
    // The Dinky Raider's modules: 2, 7 and 8 leave it turning one way; 4 is its main.
    it.each([[[2, 7, 8]], [[4]]])("gets away by the same helm a landing does, having lost %j", (lost) => {
        const raider = compileBlueprint(REPLICATOR.hangar!["Dinky Raider"]!);
        const run = makeBattle({ seed: 3 }, (ships, world) => {
            const fort = ships.spawn(world, { design: FORT, x: 0, y: 0, team: 1 });
            const f = ships.spawn(world, { design: raider, x: 150, y: 0, angle: Math.PI / 2, team: 0 });
            const b = world.bodies.indexOf(ships.body(f));
            for (const m of lost) ships.damage.absorb(b, m, ships.damage.capacityLeft(b, m));
            ships.pushFlee(f, fort);
            return { fort, f };
        });
        for (let t = 0; t < 60 * 60; t++) run.step();
        const b = run.world.bodies;
        const a = b.indexOf(run.ships.body(run.f));
        const c = b.indexOf(run.ships.body(run.fort));
        // Before the helm, each got about 400 m in this time.
        expect(Math.hypot(b.x[a]! - b.x[c]!, b.y[a]! - b.y[c]!)).toBeGreaterThan(1000);
    });
});
