import { describe, expect, it } from "vitest";
import { compileBlueprint, type WellSpec } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { cloneBattle } from "../scenarios/clone.js";
import { Debris, DEBRIS_HOT, DEBRIS_LONGEST, DEBRIS_MOST_LIFE, MOST_DEBRIS, UNPAINTED } from "../sim/debris.js";

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

/** A box `2 hl` by `2 hw` centred on `(x, y)`, as an outline. */
function box(x: number, y: number, hl: number, hw: number): number[] {
    return [x + hl, y - hw, x + hl, y + hw, x - hl, y + hw, x - hl, y - hw];
}

/** The most a bit drifts off at, m/s, when nothing throws it. */
const DEBRIS_KICK_MOST = 3;

describe("lingering debris", () => {
    it("is made only while a viewer is watching, more bits the bigger the piece, covering a share of it", () => {
        const debris = new Debris();
        debris.emit(box(0, 0, 2, 2), 4, 0, 0, 0, 0, 0);
        expect(debris.count).toBe(0);
        debris.watched = true;
        debris.emit(box(0, 0, 1, 1), 4, 0, 0, 0, 0, 0);
        const small = debris.count;
        expect(small).toBeGreaterThan(0);
        debris.clear();
        // A capital ship's plate, 70 m by 30.
        debris.emit(box(0, 0, 35, 15), 4, 0, 0, 0, 0, 0);
        expect(debris.count).toBeGreaterThan(small * 5);
        let covered = 0;
        for (let i = 0; i < debris.count; i++) {
            expect(debris.size[i]).toBeLessThanOrEqual(DEBRIS_LONGEST);
            expect(Math.abs(debris.x[i]!)).toBeLessThanOrEqual(35);
            expect(Math.abs(debris.y[i]!)).toBeLessThanOrEqual(15);
            covered += debris.size[i]! ** 2;
        }
        // Enough metal to read as the plate it was, not a handful of confetti.
        expect(covered).toBeGreaterThan(2100);
    });

    it("comes from inside the outline it broke from, a triangle as much as a box", () => {
        const debris = new Debris();
        debris.watched = true;
        // A capital ship's bow: 80 m long, 30 m across at its base.
        debris.emit([40, 0, -40, 15, -40, -15], 3, 0, 0, 0, 0, 0);
        expect(debris.count).toBeGreaterThan(50);
        for (let i = 0; i < debris.count; i++) {
            const x = debris.x[i]!;
            const y = debris.y[i]!;
            expect(x).toBeGreaterThanOrEqual(-40);
            // Narrowing to the point: as wide as the triangle is there.
            expect(Math.abs(y)).toBeLessThanOrEqual((15 * (40 - x)) / 80 + 1e-9);
        }
    });

    it("glows as it cools only when born in a blast, and carries the paint it was given", () => {
        const debris = new Debris();
        debris.watched = true;
        debris.emit(box(0, 0, 2, 2), 4, 0, 0, 0, 0, 0, 1, true);
        const blown = debris.count;
        debris.emit(box(0, 0, 2, 2), 4, 0, 0, 0, 0, 0);
        expect(debris.heat(0)).toBe(1);
        expect(debris.heat(blown)).toBe(0);
        expect(debris.paint[0]).toBe(1);
        expect(debris.paint[blown]).toBe(UNPAINTED);
        const battle = walled();
        debris.step(DEBRIS_HOT / 2, battle.world.bodies, battle.grid, battle.ships.hulls, []);
        expect(debris.heat(0)).toBeCloseTo(0.5, 9);
        debris.step(DEBRIS_HOT, battle.world.bodies, battle.grid, battle.ships.hulls, []);
        expect(debris.heat(0)).toBe(0);
    });

    it("is thrown by the blow that blew it apart, along its line, from near it and towards it from far off", () => {
        const debris = new Debris();
        debris.watched = true;
        // A plate 80 m by 30 struck on its +x end, driving in along -x, hard enough to shatter it.
        const mass = 1e6;
        debris.emit(box(0, 0, 40, 15), 4, 0, 0, 0, 0, 0, UNPAINTED, true, 3 * 1000 * mass, mass, 40, 0, -1, 0);
        let along = 0;
        let across = 0;
        let near = 0;
        let nearCount = 0;
        let far = 0;
        let farCount = 0;
        for (let i = 0; i < debris.count; i++) {
            const vx = debris.vx[i]!;
            along += Math.abs(vx);
            across += Math.abs(debris.vy[i]!);
            if (debris.x[i]! > 20) {
                near += vx;
                nearCount++;
            } else if (debris.x[i]! < -20) {
                far += vx;
                farCount++;
            }
        }
        // Thrown well past the drift a bit is given anyway, and more along the line than across it.
        expect(Math.hypot(along, across) / debris.count).toBeGreaterThan(3 * DEBRIS_KICK_MOST);
        expect(along).toBeGreaterThan(1.5 * across);
        // Near the impact, away from it (-x); at the far end, towards it (+x).
        expect(near / nearCount).toBeLessThan(-2);
        expect(far / farCount).toBeGreaterThan(2);
    });

    it("takes the oldest's place once there is no more room", () => {
        const debris = new Debris();
        debris.watched = true;
        while (debris.count < MOST_DEBRIS) debris.emit(box(0, 0, 2, 2), 4, 0, 0, 0, 0, 0);
        const battle = walled();
        debris.step(1, battle.world.bodies, battle.grid, battle.ships.hulls, []);
        debris.emit(box(0, 0, 2, 2), 4, 0, 0, 0, 0, 0);
        expect(debris.count).toBeLessThanOrEqual(MOST_DEBRIS);
    });

    it("bounces off a hull rather than passing through it, and flies on away from it", () => {
        const battle = walled();
        battle.grid.rebuild(battle.world.bodies);
        const debris = battle.ships.debris;
        debris.watched = true;
        // Coming in from -x at 40 m/s, a few metres off the plate's face.
        debris.emit(box(-10, 0, 0.05, 0.05), 4, 40, 0, 0, -10, 0);
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
        debris.emit(box(1000, 0, 0.05, 0.05), 4, 0, 0, 0, 1000, 0);
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
        debris.emit(box(0, 0, 2, 2), 4, 0, 0, 0, 0, 0);
        const battle = walled();
        expect(debris.fade(0)).toBe(1);
        for (let s = 0; s <= DEBRIS_MOST_LIFE; s++) debris.step(1, battle.world.bodies, battle.grid, battle.ships.hulls, []);
        expect(debris.count).toBe(0);
    });

    it("is carried in a copy of the battle, which goes on as the original does", () => {
        const battle = walled();
        battle.impacts.log.watched = true;
        battle.ships.debris.watched = true;
        battle.ships.debris.emit(box(-10, 0, 2, 2), 4, 40, 5, 1, -10, 0);
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
