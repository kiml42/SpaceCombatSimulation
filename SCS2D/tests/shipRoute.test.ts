import { describe, expect, it } from "vitest";
import { asteroidBlueprint, compileBlueprint, math, NEUTRAL_TEAM } from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import { makeBattle } from "../scenarios/battle.js";
import { GUNSHIP } from "../scenarios/blueprints.js";
import { cornerOf } from "../sim/shipRoute.js";

/** A minor rock, `radius` across, with nothing pulling. */
function rock(radius: number): ReturnType<typeof compileBlueprint> {
    return compileBlueprint(asteroidBlueprint("Rock", { radius, kernel: false, ore: 0.1, ice: 0.1 }, new Rng(2)));
}

describe("a route round what is in the way", () => {
    it("goes by a corner beside a rock between a ship and its target, clear of it", () => {
        const stone = rock(200);
        const run = makeBattle({ seed: 1 }, (ships, world) => {
            const r = ships.spawn(world, { design: stone, x: 0, y: 30, team: NEUTRAL_TEAM });
            const ship = ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: -2000, y: 0, angle: 0, team: 0 });
            ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 2000, y: 0, angle: math.PI, team: 1 });
            return { r, ship };
        });
        // Past choosing what to fight, which comes first.
        for (let t = 0; t < 3; t++) run.step();
        const at = { x: 0, y: 0, vx: 0, vy: 0, radius: 0 };
        expect(run.ships.routeVia[run.ship]).toBe(run.r);
        expect(cornerOf(run.ships, run.world.bodies, run.ship, at)).toBe(true);
        // Beside the rock, round the side it is offset away from, and further off it than its radius.
        expect(Math.abs(at.x)).toBeLessThan(stone.radius);
        expect(at.y).toBeLessThan(-stone.radius);
    });

    it("plans round a wall of rocks, never through the gap between two that touch", () => {
        const stone = rock(150);
        const run = makeBattle({ seed: 1 }, (ships, world) => {
            const a = ships.spawn(world, { design: stone, x: 0, y: -150, team: NEUTRAL_TEAM });
            const b = ships.spawn(world, { design: stone, x: 0, y: 150, team: NEUTRAL_TEAM });
            const ship = ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: -2000, y: 0, angle: 0, team: 0 });
            ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 2000, y: 0, angle: math.PI, team: 1 });
            return { a, b, ship };
        });
        // Past choosing what to fight, which comes first.
        for (let t = 0; t < 3; t++) run.step();
        const at = { x: 0, y: 0, vx: 0, vy: 0, radius: 0 };
        expect(cornerOf(run.ships, run.world.bodies, run.ship, at)).toBe(true);
        // Outside both: round the far side of one or the other, not between them.
        expect(Math.abs(at.y)).toBeGreaterThan(150 + stone.radius);
    });

    it("goes straight for a target beside a rock, inside the clearance it keeps from it", () => {
        const stone = rock(200);
        const run = makeBattle({ seed: 1 }, (ships, world) => {
            ships.spawn(world, { design: stone, x: 0, y: 0, team: NEUTRAL_TEAM });
            const ship = ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 0, y: -4000, angle: math.HALF_PI, team: 0 });
            ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 0, y: -300, angle: -math.HALF_PI, team: 1 });
            return { ship };
        });
        // Past choosing what to fight, which comes first.
        for (let t = 0; t < 3; t++) run.step();
        const at = { x: 0, y: 0, vx: 0, vy: 0, radius: 0 };
        // Not round the rock's side to come at it, which planning on the whole of its clearance asked.
        expect(cornerOf(run.ships, run.world.bodies, run.ship, at)).toBe(false);
    });
});
