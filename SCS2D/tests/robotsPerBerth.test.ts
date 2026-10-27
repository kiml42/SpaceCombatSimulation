import { describe, expect, it } from "vitest";
import { compileBlueprint, type Blueprint, type Placement } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { SALVAGER } from "../scenarios/blueprints.js";
import { MINE } from "../scenarios/mining.js";
import { give } from "../scenarios/commands.js";
import { NO_TARGET } from "../sim/ships.js";
import type { Battle } from "../scenarios/types.js";

/** A Salvager whose robot bays keep three robots to a berth while moored. */
const crowded = (placement: Placement): Placement =>
    "kind" in placement && placement.kind === "robotBay" ? { ...placement, robotsPerBerth: 3 } : placement;
const SALVAGER_X3: Blueprint = {
    ...SALVAGER,
    modules: SALVAGER.modules.map(crowded),
    assemblies: Object.fromEntries(
        Object.entries(SALVAGER.assemblies ?? {}).map(([k, a]) => [k, { ...a, modules: a.modules.map(crowded) }]),
    ),
};

/** Its berths: robots aboard, at most. */
const BERTHS = compileBlueprint(SALVAGER_X3).modules.reduce((n, m) => n + m.stats.robots, 0);

/** It, alone in the Mining scene's field, set to go mining. */
function field(): Battle & { readonly miner: number } {
    return makeBattle({ seed: 20260905, map: MINE, projectiles: 16, beams: 16 }, (ships, world) => ({
        miner: ships.spawn(world, { design: compileBlueprint(SALVAGER_X3), x: -900, y: 0, angle: 0, team: 0 }),
    }));
}

/** The robots on ship `i`'s body, and how many are out on its rock. */
function crew(run: Battle, i: number): { all: number; away: number } {
    const robots = (run.ships as unknown as { robots: { on(b: number): { away: number }[] | null } }).robots.on(
        run.world.bodies.indexOf(run.ships.body(i)),
    )!;
    return { all: robots.length, away: robots.filter((r) => r.away >= 0).length };
}

describe("a robot bay keeping more robots than it has berths", () => {
    it("keeps them while moored, never more aboard than its berths", () => {
        const run = field();
        const miner = run.miner;
        let most = 0;
        for (let t = 0; t < 240 * 60; t++) {
            run.step();
            if (t % 60 !== 0) continue;
            const { all, away } = crew(run, miner);
            most = Math.max(most, all);
            expect(all - away).toBeLessThanOrEqual(BERTHS);
        }
        expect(run.ships.isMoored(miner)).toBe(true);
        expect(most).toBeGreaterThan(BERTHS);
        expect(most).toBeLessThanOrEqual(3 * BERTHS);
    });

    it("leaves the extra on the rock when it casts off", () => {
        const run = field();
        const miner = run.miner;
        for (let t = 0; t < 240 * 60; t++) run.step();
        const rock = run.ships.parkedCarrier(miner);
        const before = crew(run, miner);
        expect(before.all).toBeGreaterThan(BERTHS);
        (run.ships as unknown as { unpark(...args: unknown[]): void }).unpark(run.world.bodies, miner, run.world.tick);
        run.step();
        run.step();
        expect(crew(run, miner).all).toBeLessThanOrEqual(BERTHS);
        expect(run.ships.strandedOn(rock)).toBe(before.away);
    });

    it("takes the extra apart into its holds when told to go, rather than waiting on them", () => {
        const run = field();
        const miner = run.miner;
        for (let t = 0; t < 240 * 60; t++) run.step();
        expect(crew(run, miner).all).toBeGreaterThan(BERTHS);
        give(run, { kind: "order", ships: [miner], order: { kind: "flee", target: NO_TARGET }, append: false });
        for (let t = 0; t < 180 * 60 && run.ships.isMoored(miner); t++) run.step();
        expect(run.ships.isMoored(miner)).toBe(false);
        expect(crew(run, miner).all).toBeLessThanOrEqual(BERTHS);
    }, 120_000);

    it("goes when sent to scavenge something other than its rock", () => {
        const run = field();
        const miner = run.miner;
        for (let t = 0; t < 240 * 60; t++) run.step();
        const rock = run.ships.parkedCarrier(miner);
        let other = -1;
        for (let i = 0; i < run.ships.count; i++) if (i !== rock && i !== miner && run.ships.isAlive(i)) other = i;
        give(run, { kind: "order", ships: [miner], order: { kind: "scavenge", target: other }, append: false });
        for (let t = 0; t < 180 * 60 && run.ships.isMoored(miner); t++) run.step();
        expect(run.ships.isMoored(miner)).toBe(false);
    }, 120_000);

    it("keeps one to a berth when not moored", () => {
        const run = makeBattle({ seed: 1 }, (ships, world) => ({
            ship: ships.spawn(world, { design: compileBlueprint(SALVAGER_X3), x: 0, y: 0, team: 0 }),
        }));
        for (let t = 0; t < 120 * 60; t++) run.step();
        expect(crew(run, run.ship).all).toBe(BERTHS);
    });
});
