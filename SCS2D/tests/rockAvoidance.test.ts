import { expect, it } from "vitest";
import { asteroidBlueprint, compileBlueprint, math, NEUTRAL_TEAM } from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import { makeBattle } from "../scenarios/battle.js";
import { RIVAL_WELLS } from "../scenarios/rivalMines.js";
import { DINKY, GUNSHIP } from "../scenarios/blueprints.js";

it("keeps a fighter off a rock between it and its target, timed by when it would touch the rock, not pass its middle", () => {
    const run = makeBattle({ seed: 1, wells: [RIVAL_WELLS[0]!] }, (ships, world, wells) => {
        const rock = asteroidBlueprint("A", { radius: 250, kernel: true, ore: 0.35, ice: 0.25 }, new Rng(5));
        ships.spawn(world, { design: compileBlueprint(rock), rides: wells[0]!, team: NEUTRAL_TEAM });
        const fighter = ships.spawn(world, { design: compileBlueprint(DINKY), x: -300, y: 0, angle: 0, team: 0 });
        ships.spawn(world, { design: compileBlueprint(DINKY), x: 900, y: 0, angle: Math.PI, team: 1 });
        return { fighter };
    });
    const b = run.world.bodies;
    const c = run.collisions.contacts;
    for (let t = 0; t < 30 * 60; t++) {
        run.step();
        const fb = b.indexOf(run.ships.body(run.fighter));
        for (let k = 0; k < c.count; k++) expect(c.a[k] === fb || c.b[k] === fb).toBe(false);
    }
});

/** A minor rock at the origin, with nothing pulling. */
function rock(): ReturnType<typeof compileBlueprint> {
    return compileBlueprint(asteroidBlueprint("Rock", { radius: 200, kernel: false, ore: 0.1, ice: 0.1 }, new Rng(2)));
}

it("turns a heavy ship's mains to clear a rock dead ahead, starting in time to make it", () => {
    const run = makeBattle({ seed: 1 }, (ships, world) => {
        ships.spawn(world, { design: rock(), x: 0, y: 0, team: NEUTRAL_TEAM });
        return { ship: ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: -2000, y: 0, angle: 0, vx: 80, team: 0 }) };
    });
    const b = run.world.bodies;
    const c = run.collisions.contacts;
    for (let t = 0; t < 40 * 60; t++) {
        run.step();
        const sb = b.indexOf(run.ships.body(run.ship));
        for (let k = 0; k < c.count; k++) expect(c.a[k] === sb || c.b[k] === sb).toBe(false);
    }
});

it("holds fire on a target behind a rock, however far past the muzzle the rock is", () => {
    const duel = (between: boolean): number => {
        const run = makeBattle({ seed: 1 }, (ships, world) => {
            if (between) ships.spawn(world, { design: rock(), x: 0, y: 0, team: NEUTRAL_TEAM });
            ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: -700, y: 0, angle: 0, team: 0 });
            ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 700, y: 0, angle: math.PI, team: 1 });
        });
        for (let t = 0; t < 10 * 60; t++) run.step();
        return run.totalProjectilesFired;
    };
    expect(duel(false)).toBeGreaterThan(0);
    expect(duel(true)).toBe(0);
});
