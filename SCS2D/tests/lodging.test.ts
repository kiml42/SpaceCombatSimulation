import { describe, expect, it } from "vitest";
import { asteroidBlueprint, compileBlueprint, DAMAGE_ENERGY_PER_KG, NEUTRAL_TEAM } from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import { makeBattle } from "../scenarios/battle.js";
import { RIVAL_WELLS } from "../scenarios/rivalMines.js";
import { DINKY, REPLICATOR } from "../scenarios/blueprints.js";

/** Wreckage come to rest on rock lodges there, for whoever mines the rock to take apart. */

/** A major, a wrecked Dinky dropped onto it from `drop` m out, and, with `miner`, a Replicator to anchor there. */
function scene(miner: boolean, drop = 30) {
    return makeBattle({ seed: 1, wells: [RIVAL_WELLS[0]!] }, (ships, world, wells) => {
        const rock = asteroidBlueprint("A", { radius: 250, kernel: true, ore: 0.35, ice: 0.25 }, new Rng(5));
        const a = ships.spawn(world, { design: compileBlueprint(rock), rides: wells[0]!, team: NEUTRAL_TEAM });
        const ab = world.bodies.indexOf(ships.body(a));
        const top = world.bodies.radius[ab]!;
        const dinky = compileBlueprint(DINKY);
        const w = ships.spawn(world, { design: dinky, x: 0, y: top + drop, vx: 0, vy: 0, team: 1 });
        const wb = world.bodies.indexOf(ships.body(w));
        for (const core of dinky.cores) ships.damage.absorb(wb, core, dinky.modules[core]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG);
        const m = miner ? ships.spawn(world, { design: compileBlueprint(REPLICATOR), x: -340, y: 0, angle: 0, team: 0 }) : -1;
        return { a, w, m };
    });
}

describe("wreckage on rock", () => {
    it("lodges on a major once it has come to rest there, rather than lying on it", () => {
        const run = scene(false);
        expect(run.ships.hasControl(run.w)).toBe(false);
        for (let t = 0; t < 120 * 60 && run.ships.body(run.w) !== run.ships.body(run.a); t++) run.step();
        expect(run.ships.body(run.w)).toBe(run.ships.body(run.a));
        // The rock keeps its body and its rail.
        expect(run.world.bodies.pinned[run.world.bodies.indexOf(run.ships.body(run.a))]).toBe(1);
    });

    it("is taken apart by the robots of a ship moored to the rock", () => {
        const run = scene(true);
        const rockModules = () => run.ships.currentStructure(run.a).modules.length;
        for (let t = 0; t < 120 * 60 && run.ships.body(run.w) !== run.ships.body(run.a); t++) run.step();
        const lodged = rockModules();
        for (let t = 0; t < 900 * 60 && run.ships.isAlive(run.w); t++) run.step();
        expect(run.ships.isMoored(run.m)).toBe(true);
        expect(run.ships.isAlive(run.w)).toBe(false);
        expect(rockModules()).toBeLessThan(lodged);
    }, 300_000);
});
