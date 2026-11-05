import { describe, expect, it } from "vitest";
import { compileBlueprint, type WellSpec } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { cloneBattle } from "../scenarios/clone.js";
import { Debris, DEBRIS_LONGEST, DEBRIS_MOST_LIFE, MOST_DEBRIS } from "../sim/debris.js";

/** A plate 20 m long and 4 m wide across x = 0, with a core behind it: a wall to bounce off. */
const WALL = compileBlueprint({
    name: "Wall",
    modules: [
        { kind: "structure", x: 0, y: 0, angle: Math.PI / 2, length: 20, width: 4 },
        { kind: "core", x: 3, y: 0, length: 2, width: 2 },
    ],
});

/** A battle with the wall in it, standing still, and nobody flying. */
const walled = () =>
    makeBattle({ seed: 1, pilots: false }, (ships, world) => {
        ships.spawn(world, { design: WALL, x: 0, y: 0, angle: 0, team: 0 });
    });

describe("lingering debris", () => {
    it("is made only while a viewer is watching, as many bits as the mass calls for, none too big to pass for a module", () => {
        const debris = new Debris();
        debris.emit(0, 0, 0, 0, 0, 500, 2);
        expect(debris.count).toBe(0);
        debris.watched = true;
        debris.emit(0, 0, 0, 0, 0, 25, 2);
        expect(debris.count).toBe(1);
        debris.emit(0, 0, 0, 0, 0, 1e6, 2);
        expect(debris.count).toBeGreaterThan(1);
        expect(debris.count).toBeLessThan(30);
        for (let i = 0; i < debris.count; i++) expect(debris.size[i]).toBeLessThanOrEqual(DEBRIS_LONGEST * 1.4);
    });

    it("takes the oldest's place once there is no more room", () => {
        const debris = new Debris();
        debris.watched = true;
        while (debris.count < MOST_DEBRIS) debris.emit(0, 0, 0, 0, 0, 1e6, 2);
        const battle = walled();
        debris.step(1, battle.world.bodies, battle.grid, battle.ships.hulls, []);
        debris.emit(0, 0, 0, 0, 0, 25, 2);
        expect(debris.count).toBeLessThanOrEqual(MOST_DEBRIS);
    });

    it("bounces off a hull rather than passing through it, and flies on away from it", () => {
        const battle = walled();
        battle.grid.rebuild(battle.world.bodies);
        const debris = battle.ships.debris;
        debris.watched = true;
        // Coming in from -x at 40 m/s, a few metres off the plate's face.
        debris.emit(-10, 0, 40, 0, 0, 25, 0);
        let leastX = Infinity;
        let mostX = -Infinity;
        for (let s = 0; s < 120; s++) {
            debris.step(1 / 60, battle.world.bodies, battle.grid, battle.ships.hulls, []);
            leastX = Math.min(leastX, debris.x[0]!);
            mostX = Math.max(mostX, debris.x[0]!);
        }
        // Never past the plate's near face at x = -2, and heading back the way it came.
        expect(mostX).toBeLessThan(-2 + 0.2);
        expect(debris.vx[0]).toBeLessThan(0);
        expect(debris.vx[0]).toBeGreaterThan(-40);
        expect(leastX).toBeLessThan(-9);
    });

    it("curves towards a well", () => {
        const debris = new Debris();
        debris.watched = true;
        debris.emit(1000, 0, 0, 0, 0, 25, 0);
        const battle = walled();
        const well: WellSpec = { x: 0, y: 0, gm: 1e7 };
        const before = debris.x[0]!;
        for (let s = 0; s < 60; s++) debris.step(1 / 60, battle.world.bodies, battle.grid, battle.ships.hulls, [well]);
        expect(debris.vx[0]).toBeLessThan(0);
        expect(debris.x[0]).toBeLessThan(before);
    });

    it("fades and is gone by the end of its life", () => {
        const debris = new Debris();
        debris.watched = true;
        debris.emit(0, 0, 0, 0, 0, 1000, 2);
        const battle = walled();
        expect(debris.fade(0)).toBe(1);
        for (let s = 0; s <= DEBRIS_MOST_LIFE; s++) debris.step(1, battle.world.bodies, battle.grid, battle.ships.hulls, []);
        expect(debris.count).toBe(0);
    });

    it("is carried in a copy of the battle, which goes on as the original does", () => {
        const battle = walled();
        battle.impacts.log.watched = true;
        battle.ships.debris.watched = true;
        battle.ships.debris.emit(-10, 0, 40, 5, 1, 400, 2);
        battle.step();
        const copy = cloneBattle(battle);
        for (let s = 0; s < 90; s++) {
            battle.step();
            copy.step();
        }
        const a = battle.ships.debris;
        const b = copy.ships.debris;
        expect(b.count).toBe(a.count);
        expect(Array.from(b.x.subarray(0, b.count))).toEqual(Array.from(a.x.subarray(0, a.count)));
        expect(Array.from(b.y.subarray(0, b.count))).toEqual(Array.from(a.y.subarray(0, a.count)));
    });
});
