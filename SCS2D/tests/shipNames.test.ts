import { describe, expect, it } from "vitest";
import { compileBlueprint, DAMAGE_ENERGY_PER_KG, Ships, World } from "../sim/index.js";
import { DINKY } from "../scenarios/blueprints.js";
import { teamName } from "../render/teams.js";
import { hooked } from "../scenarios/hooked.js";

describe("a ship's name", () => {
    it("counts each side from one, in the order its ships were put in", () => {
        const world = new World({ dt: 1 / 60, seed: 1 });
        const ships = new Ships();
        const dinky = compileBlueprint(DINKY);
        const order = [0, 1, 0, 0, 1, 2];
        const made = order.map((team, k) => ships.spawn(world, { design: dinky, x: k * 50, y: 0, team }));
        expect(made.map((i) => ships.serialOf(i))).toEqual([1, 1, 2, 3, 2, 1]);
    });

    it("is carried by a piece broken off a ship rather than counted again", () => {
        const run = hooked();
        const { ships } = run;
        const before = new Map<number, number>();
        for (let i = 0; i < ships.highWater; i++) if (ships.isAlive(i)) before.set(i, ships.serialOf(i));
        // Broken a second in, where a shot would: module 18 holds pieces of the second
        // corvette on, which come away.
        for (let s = 0; s < 60; s++) run.step();
        const body = run.world.bodies.indexOf(ships.body(0));
        ships.damage.absorb(body, 18, ships.currentStructure(0).modules[18]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG);
        for (let s = 0; s < 3000 && run.totalSevered === 0; s++) run.step();
        expect(run.totalSevered).toBeGreaterThan(0);
        // Every ship there now, pieces included, carries a number its side was already using.
        const used = new Map<number, Set<number>>();
        for (const [i, serial] of before) {
            const team = ships.teamOf(i);
            if (!used.has(team)) used.set(team, new Set());
            used.get(team)!.add(serial);
        }
        for (let i = 0; i < ships.highWater; i++) {
            if (!ships.isAlive(i) || before.has(i)) continue;
            expect(used.get(ships.teamOf(i))?.has(ships.serialOf(i))).toBe(true);
        }
    });

    it("is the side's colour", () => {
        expect([0, 1, 2, 3, 4].map((team) => teamName(team))).toEqual(["Blue", "Red", "Green", "Magenta", "Blue"]);
        expect(teamName(-1)).toBe("");
    });
});
