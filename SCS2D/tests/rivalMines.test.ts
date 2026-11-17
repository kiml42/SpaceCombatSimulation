import { describe, expect, it } from "vitest";
import { asteroidBlueprint, circularSpeed, compileBlueprint, math, NEUTRAL_TEAM } from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import { makeBattle } from "../scenarios/battle.js";
import { DINKY, REPLICATOR } from "../scenarios/blueprints.js";
import { RIVAL_WELLS, rivalMines } from "../scenarios/rivalMines.js";

describe("rival mines", () => {
    it("starts each outpost clear of every asteroid", () => {
        const run = rivalMines();
        const b = run.world.bodies;
        for (const i of run.miners) {
            const mb = b.indexOf(run.ships.body(i));
            for (const a of run.asteroids) {
                const ab = b.indexOf(run.ships.body(a));
                expect(Math.hypot(b.x[mb]! - b.x[ab]!, b.y[mb]! - b.y[ab]!)).toBeGreaterThan(b.radius[mb]! + b.radius[ab]!);
            }
        }
    });
});

/**
 * A Replicator on a circular orbit 600 m round a major, as Rival Mines sets each side out, with a second major
 * 3,200 m off; both wells held still.
 */
function outpost() {
    const wells = [
        { ...RIVAL_WELLS[0]!, x: 0, y: 0 },
        { ...RIVAL_WELLS[1]!, x: 3200, y: 0 },
    ];
    return makeBattle({ seed: 1, wells }, (ships, world, w) => {
        const rng = new Rng(20261022);
        const shape = { radius: 250, kernel: true, ore: 0.35, ice: 0.25, corners: 10, rings: 3 };
        const majors = w.map((well, k) =>
            ships.spawn(world, {
                design: compileBlueprint(asteroidBlueprint(`Asteroid ${k + 1}`, shape, rng)),
                rides: well,
                team: NEUTRAL_TEAM,
            }),
        );
        const speed = circularSpeed(w[0]!.gm, 600);
        const miner = ships.spawn(world, {
            design: compileBlueprint(REPLICATOR),
            x: -600,
            y: 0,
            vy: -speed,
            angle: -math.HALF_PI,
            team: 0,
        });
        return { majors, miner };
    });
}

type Outpost = ReturnType<typeof outpost>;

/** Whether a copy is being printed on the miner's body. */
function printingCopy(run: Outpost): boolean {
    for (let i = 0; i < run.ships.count; i++) {
        if (run.ships.isAlive(i) && run.ships.isPrinting(i) && run.ships.body(i) === run.ships.body(run.miner)) return true;
    }
    return false;
}

/** Step until the miner is moored and printing a copy, or `seconds` pass. */
function settle(run: Outpost, seconds: number): void {
    for (let t = 0; t < seconds * 60 && !(run.ships.isMoored(run.miner) && printingCopy(run)); t++) run.step();
}

describe("a Replicator set out round a major", () => {
    it("anchors to that major, not the one further off, and builds a copy of itself there", () => {
        const run = outpost();
        settle(run, 240);
        expect(run.ships.isMoored(run.miner)).toBe(true);
        expect(run.ships.parkedCarrier(run.miner)).toBe(run.majors[0]);
        expect(printingCopy(run)).toBe(true);
    });

    it("keeps hold of its rock while it builds, with an enemy fighter in reach", () => {
        const run = outpost();
        settle(run, 240);
        expect(run.ships.isMoored(run.miner)).toBe(true);
        const mb = run.world.bodies.indexOf(run.ships.body(run.miner));
        const x = run.world.bodies.x[mb]!;
        const y = run.world.bodies.y[mb]!;
        run.ships.spawn(run.world, { design: compileBlueprint(DINKY), x: x - 400, y, angle: 0, team: 1 });
        const fired = run.totalProjectilesFired;
        for (let t = 0; t < 60 * 60; t++) {
            run.step();
            expect(run.ships.isMoored(run.miner)).toBe(true);
        }
        // Fought over, not only near.
        expect(run.totalProjectilesFired).toBeGreaterThan(fired);
    }, 120_000);
});
