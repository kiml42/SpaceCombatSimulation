import { describe, expect, it } from "vitest";
import { compileBlueprint, footprintOf, type Blueprint } from "../sim/index.js";
import { padCovered } from "../sim/shipBuild.js";
import { makeBattle } from "../scenarios/battle.js";
import { BARE_CORE, DINKY } from "../scenarios/blueprints.js";
import { FACTORY } from "../scenarios/carrier.js";

const fighter = compileBlueprint(DINKY);

/** A Factory, and `other` `at` metres from its first pad's middle along the pad, or far off. */
function scene(at: number | null, other: Blueprint = DINKY) {
    const factory = compileBlueprint(FACTORY);
    const pad = factory.modules.findIndex((m) => m.spec.kind === "pad");
    const deck = factory.modules[pad]!;
    const angle = 0.3;
    const x = deck.x * Math.cos(angle) - deck.y * Math.sin(angle);
    const y = deck.x * Math.sin(angle) + deck.y * Math.cos(angle);
    const along = angle + deck.angle;
    const run = makeBattle({ seed: 1 }, (ships, world) => {
        const c = ships.spawn(world, { design: factory, x: 0, y: 0, angle });
        const ox = at === null ? 5000 : x + at * Math.cos(along);
        const oy = at === null ? 0 : y + at * Math.sin(along);
        ships.spawn(world, { design: compileBlueprint(other), x: ox, y: oy });
        return { c };
    });
    const bodies = run.world.bodies;
    const b = bodies.indexOf(run.ships.bodyIds[run.c]!);
    return () => padCovered(run.ships, bodies, run.c, b, factory, pad, fighter);
}

describe("a pad with something over it", () => {
    it("is clear with nothing near", () => {
        expect(scene(null)()).toBe(false);
    });

    it("is covered by a ship over its middle", () => {
        expect(scene(0)()).toBe(true);
    });

    it("is clear once that ship is past the end of where the fighter would lie", () => {
        const box = footprintOf(fighter);
        const past = (box.maxX - box.minX) / 2 + fighter.radius + 1;
        expect(scene(past)()).toBe(false);
    });

    it("is not held by a ship that has no engines to move off with", () => {
        expect(scene(0, BARE_CORE)()).toBe(false);
    });
});
