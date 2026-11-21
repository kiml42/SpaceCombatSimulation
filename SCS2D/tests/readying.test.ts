import { describe, expect, it } from "vitest";
import {
    affords,
    billOf,
    buildOrder,
    compileBlueprint,
    FULLY_READY,
    readied,
    readyDeadline,
    readyingTime,
    schedule,
    Ships,
    shotFuel,
    World,
    YARD_POWER,
    type ShipDesign,
} from "../sim/index.js";
import { CORVETTE, DINKY, RAIL_CORVETTE } from "../scenarios/blueprints.js";

/** Readying a fleet in the time its build leaves before the battle (DECISIONS.md, 2026-11-21). */

const corvette = compileBlueprint(CORVETTE);
const rail = compileBlueprint(RAIL_CORVETTE);
const dinky = compileBlueprint(DINKY);

const generation = (design: ShipDesign): number => design.modules.reduce((sum, m) => sum + m.stats.generation, 0);
const batteries = (design: ShipDesign): number => design.modules.reduce((sum, m) => sum + m.stats.charge, 0);
const sum = (values: ArrayLike<number>): number => Array.from(values).reduce((a, b) => a + b, 0);

describe("a ship readied", () => {
    it("with no deadline sets out loaded, charged and stocked", () => {
        const ready = readied(rail, FULLY_READY);
        expect(Array.from(ready.reload)).toEqual(rail.turrets.map(() => 0));
        expect(Array.from(ready.bank)).toEqual(rail.turrets.map((t) => t.gun.bankEnergy));
        expect(sum(ready.charge)).toBeCloseTo(batteries(rail), 0);
        expect(sum(ready.primed)).toBe(0);
    });

    it("with no time at all sets out with nothing loaded or charged, its first rounds' fuel in hand", () => {
        const ready = readied(corvette, { spare: 0, yard: 0 });
        corvette.turrets.forEach((t, k) => {
            expect(ready.reload[k]).toBeCloseTo(t.gun.cycleTime, 9);
            expect(ready.primed[k]).toBeCloseTo(shotFuel(t.gun), 9);
        });
        expect(sum(ready.charge)).toBe(0);
        expect(sum(ready.robots)).toBe(0);
    });

    it("charges a rail gun's bank no faster than its generators make it", () => {
        const spare = 5;
        const ready = readied(rail, { spare, yard: 0 });
        const t = rail.turrets.findIndex((m) => m.gun.bankEnergy > 0);
        expect(ready.bank[t]).toBeGreaterThan(0);
        expect(ready.bank[t]).toBeLessThanOrEqual(generation(rail) * spare * (1 + 1e-9));
        expect(ready.bank[t]).toBeLessThan(rail.turrets[t]!.gun.bankEnergy);
    });

    it("charges its batteries last, from what its guns and robots leave", () => {
        const ready = readied(rail, { spare: readyingTime(rail), yard: 0 });
        expect(sum(ready.charge)).toBeLessThan(batteries(rail) / 2);
        const t = rail.turrets.findIndex((m) => m.gun.bankEnergy > 0);
        expect(ready.bank[t]).toBeCloseTo(rail.turrets[t]!.gun.bankEnergy, 0);
    });

    it("has the yard fill the share of its batteries' room it is given", () => {
        const none = sum(readied(corvette, { spare: 0, yard: 0 }).charge);
        const half = sum(readied(corvette, { spare: 0, yard: 0.5 }).charge);
        expect(none).toBe(0);
        expect(half).toBeCloseTo(batteries(corvette) / 2, 0);
    });
});

describe("a yard", () => {
    it("builds the slowest to ready first", () => {
        const { order } = buildOrder([dinky, rail, corvette], 1);
        expect(order[0]).toBe(1);
        expect(readyingTime(rail)).toBeGreaterThan(readyingTime(corvette));
    });

    it("leaves each ship the deadline less when it is finished, its robots sharing the work", () => {
        const fleet = [corvette, corvette];
        const work = 2 * billOf(corvette).build;
        const one = schedule(fleet, { deadline: work, robots: 1 });
        // The last built has nothing left; the first, the time the last took.
        expect(one.map((r) => r.spare)).toEqual([billOf(corvette).build, 0]);
        // With nothing left over, the yard charges nothing.
        expect(one[0]!.yard).toBe(0);
        const two = schedule(fleet, { deadline: work, robots: 2 });
        expect(two[1]!.spare).toBeCloseTo(work / 2, 6);
        expect(two[0]!.yard).toBe(1);
    });

    it("charges batteries at its robots' power for the time they are not building", () => {
        const work = billOf(corvette).build;
        const left = 100;
        const [ready] = schedule([corvette], { deadline: work + left, robots: 1 });
        const room = batteries(corvette) - sum(readied(corvette, { spare: left, yard: 0 }).charge);
        expect(ready!.yard).toBeCloseTo(Math.min(1, (YARD_POWER * left) / room), 9);
    });

    it("gives a fleet time enough to ready everything it can, and no more than it needs", () => {
        const fleet = [corvette, rail, dinky];
        const deadline = readyDeadline(fleet);
        const work = fleet.reduce((sum, d) => sum + billOf(d).build, 0);
        expect(deadline).toBeGreaterThan(work);
        const full = (at: number): boolean =>
            schedule(fleet, { deadline: at, robots: 1 }).every((ready, i) => {
                const got = readied(fleet[i]!, ready);
                const best = readied(fleet[i]!, FULLY_READY);
                return sum(got.charge) >= sum(best.charge) * (1 - 1e-6) && Array.from(got.reload).every((r) => r < 1e-6);
            });
        expect(full(deadline)).toBe(true);
        expect(full(deadline - 1)).toBe(false);
    });

    it("can afford the work of as many robots as it has", () => {
        const bill = billOf(corvette);
        const budget = { metal: Infinity, fuel: Infinity, build: bill.build / 2 };
        expect(affords(budget, bill)).toBe(false);
        expect(affords(budget, bill, 2)).toBe(true);
    });
});

describe("a ship set out readied", () => {
    it("starts its guns reloading and its batteries and robots as far as it got", () => {
        const world = new World({ dt: 1 / 60, seed: 1 });
        const ships = new Ships();
        const i = ships.spawn(world, { design: corvette, ready: { spare: 0, yard: 0 } });
        const b = world.bodies.indexOf(ships.body(i));
        corvette.turrets.forEach((t, k) => {
            expect(ships.isReloading(i, k)).toBe(true);
            expect(ships.isLoaded(b, t)).toBe(true);
        });
        for (let m = 0; m < corvette.modules.length; m++) expect(ships.power.held(b, m)).toBe(0);
        for (const robot of ships.robots.on(b) ?? []) expect(robot.charge).toBe(0);
        // Its holds full beneath the rounds the budget loaded.
        expect(ships.metal.spentMass(b)).toBeLessThan(0);
    });

    it("draws the rest of a first reload's fuel from what the budget paid, not its tanks", () => {
        const world = new World({ dt: 1 / 60, seed: 1 });
        const ships = new Ships();
        const i = ships.spawn(world, { design: corvette, ready: { spare: 0, yard: 1 } });
        const b = world.bodies.indexOf(ships.body(i));
        const before = ships.fuel.spentMass(b);
        for (let k = 0; k < 600 && ships.isReloading(i, 0); k++) ships.command(1 / 60, world);
        expect(ships.isReloading(i, 0)).toBe(false);
        expect(ships.fuel.spentMass(b)).toBeCloseTo(before, 6);
    });
});
