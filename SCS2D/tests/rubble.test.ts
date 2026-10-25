import { describe, expect, it } from "vitest";
import { asteroidBlueprint, compileBlueprint, majorWell, NEUTRAL_TEAM } from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import { makeBattle } from "../scenarios/battle.js";
import { SALVAGER } from "../scenarios/blueprints.js";

const minor = (seed: number) =>
    compileBlueprint(asteroidBlueprint(`Rock ${seed}`, { radius: 40, kernel: false, ore: 0.3, ice: 0.3 }, new Rng(seed)));

/** Two minors closing on each other at `speed` m/s apiece. */
function pair(speed: number) {
    return makeBattle({ seed: 1 }, (ships, world) => ({
        a: ships.spawn(world, { design: minor(1), x: -100, y: 0, vx: speed, vy: 0, team: NEUTRAL_TEAM }),
        b: ships.spawn(world, { design: minor(2), x: 100, y: 0, vx: -speed, vy: 0, team: NEUTRAL_TEAM }),
    }));
}

describe("rock meeting rock", () => {
    it("sticks when the two touch slowly, and they go on as one body", () => {
        const run = pair(1);
        for (let t = 0; t < 120 * 60; t++) run.step();
        expect(run.ships.body(run.a)).toBe(run.ships.body(run.b));
    });

    it("bounces when they meet fast", () => {
        const run = pair(30);
        for (let t = 0; t < 20 * 60; t++) run.step();
        expect(run.ships.body(run.a)).not.toBe(run.ships.body(run.b));
    });

    it("takes a minor onto a major, which keeps riding its rail", () => {
        const run = makeBattle({ seed: 1, wells: [majorWell(150, 0.0005)] }, (ships, world, wells) => {
            const major = ships.spawn(world, {
                design: compileBlueprint(asteroidBlueprint("Major", { radius: 150, kernel: true, ore: 0.3, ice: 0.3 }, new Rng(3))),
                rides: wells[0]!,
                team: NEUTRAL_TEAM,
            });
            return { major, rock: ships.spawn(world, { design: minor(4), x: 260, y: 0, vx: -1, vy: 0, team: NEUTRAL_TEAM }) };
        });
        for (let t = 0; t < 120 * 60; t++) run.step();
        const b = run.world.bodies;
        expect(run.ships.body(run.rock)).toBe(run.ships.body(run.major));
        expect(b.pinned[b.indexOf(run.ships.body(run.major))]).toBe(1);
    });

    it("keeps what is moored to a minor where it is when the minor joins a major", () => {
        const run = makeBattle({ seed: 1, wells: [majorWell(150, 0.0005)] }, (ships, world, wells) => {
            const major = ships.spawn(world, {
                design: compileBlueprint(asteroidBlueprint("Major", { radius: 150, kernel: true, ore: 0.3, ice: 0.3 }, new Rng(3))),
                rides: wells[0]!,
                team: NEUTRAL_TEAM,
            });
            const rock = ships.spawn(world, { design: minor(4), x: 260, y: 0, vx: -1, vy: 0, team: NEUTRAL_TEAM });
            const miner = ships.spawn(world, { design: compileBlueprint(SALVAGER), x: 330, y: 0, vx: -1, vy: 0, angle: Math.PI, team: 0 });
            return { major, rock, miner };
        });
        const b = run.world.bodies;
        const at = () => b.indexOf(run.ships.body(run.miner));
        // Moored by hand on the minor's far side, where it would have gripped it, so only the weld is tested.
        const claw = run.ships.currentStructure(run.miner).modules.findIndex((m) => m.spec.kind === "claw");
        (run.ships as unknown as { moor(...args: unknown[]): void }).moor(b, run.miner, run.rock, claw, 300, 0);
        let x = b.x[at()]!;
        let y = b.y[at()]!;
        let jump = 0;
        for (let t = 0; t < 120 * 60; t++) {
            run.step();
            jump = Math.max(jump, Math.hypot(b.x[at()]! - x, b.y[at()]! - y));
            x = b.x[at()]!;
            y = b.y[at()]!;
        }
        expect(run.ships.body(run.rock)).toBe(run.ships.body(run.major));
        expect(run.ships.isMoored(run.miner)).toBe(true);
        // Never further in a step than it was moving.
        expect(jump).toBeLessThan(0.1);
    });
});
