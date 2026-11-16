import { describe, expect, it } from "vitest";
import { wellPull } from "../sim/index.js";
import { ORBITING_VARIANTS, orbiting, type Orbiting } from "../scenarios/orbiting.js";
import { SCENARIO_TIMEOUT } from "./fixtures/scenarios.js";

/** Seconds to settle in, then seconds it is watched coasting for. */
const SETTLE = 120;
const COAST = 30;
/**
 * How far off a circle an orbit may be: its speed round off the circular speed, and its height's spread, as
 * shares. The spread allows for stepping out, a little at a time, from ships going round the other way.
 */
const CIRCULAR = 0.05;
const SPREAD = 0.1;
/**
 * The share of its fuel a ship may burn over `COAST` and still be coasting, and the share of the fleet that
 * must be. Hovering, the median Dinky burns about 9%; coasting, none, and the busiest dodger 8%.
 */
const COAST_BURN = 0.01;
const COASTING = 0.5;

function fuelOf(battle: Orbiting, s: number): number {
    const b = battle.world.bodies.indexOf(battle.ships.body(s));
    let fuel = 0;
    for (let m = 0; m < battle.ships.designs[s]!.modules.length; m++) fuel += battle.ships.fuel.held(b, m);
    return fuel;
}

// The 200 Dinkies are for watching; these two are enough to show it.
describe.each(ORBITING_VARIANTS.slice(0, 2))("Orbiting: $name", (variant) => {
    it(
        "puts every ship into a circular orbit, and most coast there",
        () => {
            const battle = orbiting(undefined, variant);
            const b = battle.world.bodies;
            const well = battle.wells[0]!;
            for (let t = 0; t < SETTLE / battle.dt; t++) battle.step();

            const fleet = battle.fleet;
            const before = fleet.map((s) => fuelOf(battle, s));
            const low = fleet.map(() => Infinity);
            const high = fleet.map(() => 0);
            const speed = fleet.map(() => 0);
            const steps = Math.round(COAST / battle.dt);
            for (let t = 0; t < steps; t++) {
                battle.step();
                fleet.forEach((s, k) => {
                    const sb = b.indexOf(battle.ships.body(s));
                    if (sb < 0) return;
                    const x = b.x[sb]! - well.x;
                    const y = b.y[sb]! - well.y;
                    const r = Math.sqrt(x * x + y * y);
                    low[k] = Math.min(low[k]!, r);
                    high[k] = Math.max(high[k]!, r);
                    const circular = Math.sqrt(wellPull(well, b.x[sb]!, b.y[sb]!)) * r;
                    speed[k]! += Math.abs(x * b.vy[sb]! - y * b.vx[sb]!) / r / circular / steps;
                });
            }

            const rockRadius = b.radius[b.indexOf(battle.ships.body(battle.rock))]!;
            fleet.forEach((s, k) => {
                expect(battle.ships.alive[s], `ship ${k} alive`).toBe(1);
                expect(low[k], `ship ${k} clear of the rock`).toBeGreaterThan(rockRadius);
                expect((high[k]! - low[k]!) / low[k]!, `ship ${k} holding its height`).toBeLessThan(SPREAD);
                expect(Math.abs(speed[k]! - 1), `ship ${k} at orbital speed`).toBeLessThan(CIRCULAR);
            });
            // Coasting, not hovering, which burns all the time. Keeping clear of one going round the other way burns a little.
            const coasting = fleet.filter((s, k) => fuelOf(battle, s) >= before[k]! * (1 - COAST_BURN)).length;
            expect(coasting / fleet.length).toBeGreaterThanOrEqual(COASTING);
            expect(battle.totalContacts).toBe(0);
        },
        SCENARIO_TIMEOUT,
    );
});
