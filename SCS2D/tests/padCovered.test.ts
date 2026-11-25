import { describe, expect, it } from "vitest";
import { compileBlueprint } from "../sim/index.js";
import { padCovered } from "../sim/shipBuild.js";
import { makeBattle } from "../scenarios/battle.js";
import { BARE_CORE, DINKY } from "../scenarios/blueprints.js";
import { FACTORY } from "../scenarios/carrier.js";

/** A Factory, and a bare core `at` metres from its first pad's middle along the pad, or far off. */
function scene(at: number | null) {
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
        ships.spawn(world, { design: compileBlueprint(BARE_CORE), x: ox, y: oy });
        return { c };
    });
    const bodies = run.world.bodies;
    const b = bodies.indexOf(run.ships.bodyIds[run.c]!);
    return () => padCovered(run.ships, bodies, run.c, b, factory, pad, compileBlueprint(DINKY));
}

describe("a pad with something over it", () => {
    it("is clear with nothing near", () => {
        expect(scene(null)()).toBe(false);
    });

    it("is covered by a ship over its middle", () => {
        expect(scene(0)()).toBe(true);
    });

    it("is clear once that ship is well off its end", () => {
        expect(scene(60)()).toBe(false);
    });
});
