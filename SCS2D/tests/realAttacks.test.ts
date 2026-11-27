import { describe, expect, it } from "vitest";
import { Activity, type Decision } from "../scenarios/decision.js";

interface Hit {
    readonly at: number;
    readonly attacker: number;
    readonly victim: number;
    /** A collision, rather than fire. */
    readonly collision?: boolean;
}

/**
 * Two armed ships that cannot reach each other, side 0 and side 1, plus a
 * wreck of side 1's (ship 2) with no control. Each ship fires at the times
 * given, and the hits given land; the battle is watched until `until`.
 */
function battle(fires: readonly (readonly number[])[], hits: readonly Hit[], until = 200): Decision | null {
    const dt = 1;
    const world = { tick: 0, dt };
    const now = (): number => world.tick * dt;
    const lastFired = (i: number): number => {
        const times = (fires[i] ?? []).filter((t) => t <= now());
        return times.length === 0 ? -1 : times.at(-1)! / dt;
    };
    const ships = {
        highWater: 3,
        isAlive: () => true,
        teamOf: (i: number) => (i === 2 ? 1 : i),
        hasControl: (i: number) => i !== 2,
        isRamming: () => false,
        hasNoEngines: () => true,
        canShoot: (i: number) => i !== 2,
        lastFired,
        pilotAt: (body: number) => body,
        attackerOf: (credit: { attacker: Int32Array }, h: number) => credit.attacker[h]!,
        canBuildArmed: () => false,
        lastBuilt: () => -1,
        ramTarget: () => -1,
        distanceBetween: () => 5000,
        nearestEnemy: () => 5000,
    };
    const activity = new Activity(2);
    let decision: Decision | null = null;
    while (now() < until && decision === null) {
        world.tick++;
        const landing = hits.filter((hit) => hit.at === now());
        const credit = {
            count: landing.length,
            attacker: Int32Array.from(landing.map((hit) => hit.attacker)),
            attackerModule: Int32Array.from(landing.map((hit) => (hit.collision === true ? 0 : -1))),
            attackerShip: Int32Array.from(landing.map(() => -1)),
            victim: Int32Array.from(landing.map((hit) => hit.victim)),
            module: Int32Array.from(landing.map(() => 0)),
        };
        decision = activity.observe({ ships: ships as never, world, credit: credit as never });
    }
    return decision;
}

describe("what counts as fighting", () => {
    it("is not wreckage drifting into the other side", () => {
        // Side 0 fired last, at 20; side 1's wreck bumping it at 40 does not keep side 1 in the fight.
        expect(
            battle(
                [
                    [1, 20],
                    [1, 10],
                ],
                [{ at: 40, attacker: 2, victim: 0, collision: true }],
            ),
        ).toMatchObject({
            winner: 0,
            reason: "quiet",
            time: 40,
        });
    });

    it("is not hitting a wreck", () => {
        // Side 0 last fired at 25: its shot landing on side 1's wreck at 50 does not keep it in it past 55.
        expect(
            battle(
                [
                    [1, 25],
                    [1, 30],
                ],
                [{ at: 50, attacker: 0, victim: 2 }],
            ),
        ).toMatchObject({ winner: 1, reason: "quiet", time: 55 });
    });

    it("is a hit on the other side's ship under control", () => {
        expect(
            battle(
                [
                    [1, 25],
                    [1, 30],
                ],
                [{ at: 50, attacker: 0, victim: 1 }],
            ),
        ).toMatchObject({ winner: 0, reason: "quiet", time: 60 });
    });
});

describe("going quiet", () => {
    it("puts out the side that went quiet first", () => {
        expect(
            battle(
                [
                    [1, 21],
                    [1, 20],
                ],
                [],
            ),
        ).toMatchObject({ winner: 0, reason: "quiet", time: 50 });
    });

    it("is a draw for sides that last fought on the same step, rather than waiting for the time cap", () => {
        expect(
            battle(
                [
                    [1, 20],
                    [1, 20],
                ],
                [],
            ),
        ).toMatchObject({ winner: -1, reason: "quiet", time: 50 });
    });
});
