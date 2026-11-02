import { describe, expect, it } from "vitest";
import { asteroidBlueprint, compileBlueprint, DAMAGE_ENERGY_PER_KG, NEUTRAL_TEAM, originOf } from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import { makeBattle } from "../scenarios/battle.js";
import { RIVAL_WELLS } from "../scenarios/rivalMines.js";
import { DINKY, REPLICATOR } from "../scenarios/blueprints.js";

/** Wreckage come to rest on rock lodges there, for whoever mines the rock to take apart. */

/**
 * A major, a Dinky dropped onto it from `drop` m out, and, with `miner`, a
 * Replicator of side 0 to anchor there. The Dinky is wrecked, or with `flown`
 * left under control but with its tanks dry, so it lies where it lands; on
 * side `team`, and with `unarmed`, its guns shot out too; facing `angle`.
 */
function scene(miner: boolean, drop = 30, flown = false, team = 1, unarmed = false, angle = 0) {
    return makeBattle({ seed: 1, wells: [RIVAL_WELLS[0]!] }, (ships, world, wells) => {
        const rock = asteroidBlueprint("A", { radius: 250, kernel: true, ore: 0.35, ice: 0.25 }, new Rng(5));
        const a = ships.spawn(world, { design: compileBlueprint(rock), rides: wells[0]!, team: NEUTRAL_TEAM });
        const ab = world.bodies.indexOf(ships.body(a));
        const top = world.bodies.radius[ab]!;
        const dinky = compileBlueprint(DINKY);
        const w = ships.spawn(world, { design: dinky, x: 0, y: top + drop, vx: 0, vy: 0, angle, team });
        const wb = world.bodies.indexOf(ships.body(w));
        const wreck = (m: number): void => ships.damage.absorb(wb, m, dinky.modules[m]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG);
        if (!flown) for (const core of dinky.cores) wreck(core);
        else for (let m = 0; m < dinky.modules.length; m++) ships.fuel.drain(wb, m, ships.fuel.held(wb, m));
        if (unarmed) for (const turret of dinky.turrets) wreck(turret.module);
        const m = miner ? ships.spawn(world, { design: compileBlueprint(REPLICATOR), x: -340, y: 0, angle: 0, team: 0 }) : -1;
        return { a, w, m, dinky };
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

describe("a ship stuck on rock", () => {
    /** Run until the Dinky lodges on the rock, or two minutes pass. */
    const lodge = (run: ReturnType<typeof scene>): void => {
        for (let t = 0; t < 120 * 60 && run.ships.body(run.w) !== run.ships.body(run.a); t++) run.step();
    };

    it("lodges once it has lain still against it, though it is still flown", () => {
        const run = scene(false, 30, true);
        lodge(run);
        expect(run.ships.body(run.w)).toBe(run.ships.body(run.a));
        expect(run.ships.hasControl(run.w)).toBe(true);
        expect(run.world.bodies.pinned[run.world.bodies.indexOf(run.ships.body(run.a))]).toBe(1);
    });

    it("is taken apart by an enemy's robots on the rock, though it could still fight", () => {
        // Nose up, so it comes to rest on its tail rather than grinding its gun on the rock.
        const run = scene(true, 30, true, 1, false, Math.PI / 2);
        /** The Dinky's modules on its body, wherever it now is. */
        const own = (): number[] => {
            const design = run.ships.currentStructure(run.w);
            return design.modules.flatMap((_, m) => (originOf(design, m).design === run.dinky ? [m] : []));
        };
        // Its rounds topped up and its hurts mended, so the Replicator's guns cannot put
        // it out of the fight: only robots taking it apart can.
        const step = (): void => {
            const b = run.world.bodies.indexOf(run.ships.body(run.w));
            for (const m of own()) {
                run.ships.metal.add(b, m, 1e9);
                run.ships.damage.repair(b, m, 1e12);
            }
            run.step();
        };
        for (let t = 0; t < 120 * 60 && run.ships.body(run.w) !== run.ships.body(run.a); t++) step();
        expect(run.ships.body(run.w)).toBe(run.ships.body(run.a));
        const lodged = own().length;
        let fitWhenStarted: boolean | null = null;
        for (let t = 0; t < 900 * 60 && run.ships.isAlive(run.w); t++) {
            const fit = run.ships.hasControl(run.w) && !run.ships.isMissionKilled(run.w);
            step();
            if (fitWhenStarted === null && own().length < lodged) fitWhenStarted = fit;
        }
        expect(run.ships.isMoored(run.m)).toBe(true);
        expect(fitWhenStarted).toBe(true);
    }, 300_000);

    it("is left by a friend's robots while it can fight, and taken once it cannot", () => {
        const armed = scene(true, 30, true, 0);
        lodge(armed);
        for (let t = 0; t < 900 * 60; t++) armed.step();
        expect(armed.ships.isMoored(armed.m)).toBe(true);
        expect(armed.ships.isAlive(armed.w)).toBe(true);

        const spent = scene(true, 30, true, 0, true);
        lodge(spent);
        expect(spent.ships.isMissionKilled(spent.w)).toBe(true);
        for (let t = 0; t < 900 * 60 && spent.ships.isAlive(spent.w); t++) spent.step();
        expect(spent.ships.isAlive(spent.w)).toBe(false);
    }, 600_000);
});
