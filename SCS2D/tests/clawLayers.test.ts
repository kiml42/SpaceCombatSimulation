import { describe, expect, it } from "vitest";
import { compileBlueprint, DAMAGE_ENERGY_PER_KG, type Blueprint, type ShipDesign } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { CORVETTE, DINKY } from "../scenarios/blueprints.js";
import { BREAKER } from "../scenarios/salvage.js";

/** A claw goes only for what it could close on: a thin one never for a fighter, which flies above the deck. */

/** The scrapyard's salvager with an engine and a tank, thirsty for fuel and metal alike. */
function salvager(): ShipDesign {
    const blueprint: Blueprint = {
        ...BREAKER,
        modules: [
            ...BREAKER.modules,
            { kind: "tank", x: -7.5, y: 0, length: 4, width: 4, fill: 0.1 },
            { kind: "engine", x: -9.5, y: 0, angle: Math.PI, length: 3, width: 4 },
        ],
    };
    const doctrine = compileBlueprint(blueprint).doctrine;
    return compileBlueprint({
        ...blueprint,
        doctrine: { ...doctrine, approach: { ...doctrine.approach, scavengeFuelBelow: 1, scavengeMetalBelow: 1 } },
    });
}

/** The salvager, and a hulk of `wreck` with its cores shot out 100 m off. */
function scene(wreck: ShipDesign): ReturnType<typeof makeBattle<{ s: number; w: number }>> {
    return makeBattle({ seed: 7 }, (ships, world) => {
        const s = ships.spawn(world, { design: salvager(), x: 0, y: 0, angle: 0, team: 0 });
        const w = ships.spawn(world, { design: wreck, x: 100, y: 20, angle: 2, team: 1 });
        const body = world.bodies.indexOf(ships.body(w));
        for (const core of wreck.cores) ships.damage.absorb(body, core, wreck.modules[core]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG);
        return { s, w };
    });
}

/** What the salvager is making for after `seconds`. */
function goingFor(wreck: ShipDesign, seconds: number): number {
    const run = scene(wreck);
    for (let s = 0; s < seconds * 60; s++) run.step();
    return (run.ships as unknown as { salvaging: number[] }).salvaging[run.s]!;
}

describe("a thin claw", () => {
    it("goes for a hulk it shares the hull layer with", () => {
        expect(goingFor(compileBlueprint(CORVETTE), 10)).toBe(1);
    });

    it("never goes for a fighter, which flies above the deck", () => {
        const dinky = compileBlueprint(DINKY);
        expect(dinky.fighter).toBe(true);
        expect(goingFor(dinky, 10)).toBe(-1);
    });
});
