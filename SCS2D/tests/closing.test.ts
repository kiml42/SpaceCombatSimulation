import { describe, expect, it } from "vitest";
import { Activity, Closing, type Decision } from "../scenarios/decision.js";

/** Feed one ship's distances through a fresh tracker; whether each step counted as closing. */
function closes(distances: readonly number[], fresh: readonly number[] = []): boolean[] {
    const closing = new Closing();
    return distances.map((d, step) => closing.update(0, 1, d, step === 0 || fresh.includes(step)));
}

describe("closing on a target", () => {
    it("counts each step that comes closer than it has been", () => {
        expect(closes([100, 90, 80, 70])).toEqual([false, true, true, true]);
    });

    it("does not count circling at one range, or drifting in by less than a metre", () => {
        expect(closes([100, 100, 100.5, 99.5, 100])).toEqual([false, false, false, false, false]);
    });

    it("follows a ship out from a fresh start until it turns back", () => {
        // Started moving away: closer than its furthest counts, not only closer than its start.
        expect(closes([100, 110, 120, 115, 110])).toEqual([false, false, false, true, true]);
    });

    it("holds a ship to its best, once it has turned, until it lands a hit", () => {
        // Thrown clear by its own ram: without the hit it must beat ten metres again.
        expect(closes([30, 10, 20, 30, 25])).toEqual([false, true, false, false, false]);
        expect(closes([30, 10, 20, 30, 25], [1])).toEqual([false, false, false, false, true]);
    });

    it("starts again on a new target", () => {
        const closing = new Closing();
        closing.update(0, 1, 100, true);
        expect(closing.update(0, 1, 50, false)).toBe(true);
        expect(closing.update(0, 2, 80, false)).toBe(false);
        expect(closing.update(0, 2, 70, false)).toBe(true);
    });
});

/**
 * Side 0 rams side 1, its distance each step given by `distance(time)`; both
 * fire once at the start, so going quiet counts, and side 1 never again. Its
 * fuel runs out at `dry`, if given.
 */
function ram(distance: (time: number) => number, until: number, dry = Infinity): Decision | null {
    const dt = 1;
    const world = { tick: 0, dt };
    const ships = {
        highWater: 2,
        isAlive: () => true,
        teamOf: (i: number) => i,
        hasControl: () => true,
        isRamming: (i: number) => i === 0,
        hasNoEngines: (i: number) => i === 0 && world.tick * dt >= dry,
        isDisarmed: (i: number) => i === 0,
        lastFired: () => 1,
        pilotAt: (body: number) => body,
        canBuildArmed: () => false,
        lastBuilt: () => -1,
        ramTarget: (i: number) => (i === 0 ? 1 : -1),
        distanceBetween: () => distance(world.tick * dt),
        nearestEnemy: () => distance(world.tick * dt),
    };
    const credit = {
        count: 0,
        attacker: new Int32Array(0),
        attackerModule: new Int32Array(0),
        victim: new Int32Array(0),
        module: new Int32Array(0),
    };
    const activity = new Activity(2);
    let decision: Decision | null = null;
    while (world.tick * dt < until && decision === null) {
        world.tick++;
        decision = activity.observe({ ships: ships as never, world, credit: credit as never });
    }
    return decision;
}

describe("ramming as the skirmish rule sees it", () => {
    it("keeps a rammer, and the side it closes on, in the fight while it closes", () => {
        // Waiting for a rammer to come into reach is not giving up: neither side has gone quiet.
        expect(ram((t) => 1000 - 10 * t, 60)).toBeNull();
    });

    it("lets a rammer that circles instead go quiet", () => {
        expect(ram(() => 200, 60)).toBeNull();
    });

    it("counts a rammer out of fuel as out of it, however it drifts on in", () => {
        // Its only weapon spent at 10 s, so the side is left with nothing.
        expect(ram((t) => 1000 - 10 * t, 60, 10)).toMatchObject({ winner: 1, reason: "disarmed", time: 10 });
    });
});
