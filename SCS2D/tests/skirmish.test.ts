import { describe, expect, it } from "vitest";
import { fleetHulls, fleetReach, type Blueprint, type Fleet } from "../sim/index.js";
import { BARE_CORE, GUNSHIP } from "../scenarios/blueprints.js";
import { LINE_OF_BATTLE } from "../scenarios/fleets.js";
import { customBattle } from "../scenarios/customBattle.js";
import { Activity, QUIET_TIME, TIME_CAP, type Decision } from "../scenarios/decision.js";
import {
    billOfFleet,
    canFight,
    DEFAULT_SKIRMISH_SETTINGS,
    fleetFault,
    lost,
    newSkirmish,
    multiplierOf,
    nextMultiplier,
    startingMultiplier,
    roundBattle,
    overLimit,
    nextRound,
    parseSkirmish,
    roundSetup,
    serialiseSkirmish,
    skirmishFileName,
    type Skirmish,
    settingsOf,
    won,
} from "../scenarios/skirmish.js";
import { handedSkirmish, skirmishRoute } from "../editor/handoff.js";

/** A skirmish carried in the skirmish route's address, and read back. */
const viaLink = (skirmish: Skirmish) => {
    const route = skirmishRoute(skirmish);
    return handedSkirmish(new URLSearchParams(route.slice(route.indexOf("?"))));
};

const lone = (name: string, design: typeof GUNSHIP): Fleet => ({
    name,
    designs: { [design.name]: design },
    ships: [{ design: design.name, x: 0, y: 0 }],
});
const gunship = lone("Gunship", GUNSHIP);
const core = lone("Core", BARE_CORE);
const empty: Fleet = { name: "Mine", designs: {}, ships: [] };

/** Fight two fleets until the rule decides, or `until` seconds pass. */
function fight(a: Fleet, b: Fleet, until: number, range = 1000, cap = TIME_CAP): { decision: Decision | null; time: number } {
    const battle = customBattle({ fleets: [a, b], range, closingSpeed: 0, crossingSpeed: 0, rotation: 0, seed: 3 });
    const activity = new Activity(2, cap);
    let decision: Decision | null = null;
    while (decision === null && battle.world.tick * battle.dt < until) {
        battle.step();
        decision = activity.observe(battle);
    }
    return { decision, time: battle.world.tick * battle.dt };
}

/**
 * Two ships, one a side, as the rule sees them, driven by hand: each step says
 * who fired, who is disarmed, and which hits landed.
 */
function staged(dt = 1) {
    const fired = [-1, -1];
    const disarmed = [false, false];
    const hits: [number, number][] = [];
    const world = { tick: 0, dt };
    const ships = {
        highWater: 2,
        isAlive: () => true,
        teamOf: (i: number) => i,
        hasControl: () => true,
        isRamming: () => false,
        isDisarmed: (i: number) => disarmed[i]!,
        lastFired: (i: number) => fired[i]!,
        pilotAt: (body: number) => body,
        canBuildArmed: () => false,
        lastBuilt: () => -1,
    };
    const credit = {
        get count() {
            return hits.length;
        },
        get attacker() {
            return Int32Array.from(hits.map((h) => h[0]));
        },
        get victim() {
            return Int32Array.from(hits.map((h) => h[1]));
        },
        get attackerModule() {
            return new Int32Array(hits.length).fill(-1);
        },
        get module() {
            return new Int32Array(hits.length).fill(-1);
        },
    };
    const activity = new Activity(2);
    return {
        fired,
        disarmed,
        hits,
        /** Advance to `time`, observing each step; what was decided. */
        to(time: number): Decision | null {
            let decision: Decision | null = null;
            while (world.tick * dt < time) {
                world.tick++;
                decision = activity.observe({ ships: ships as never, world, credit: credit as never });
                hits.length = 0;
            }
            return decision;
        },
        tick: () => world.tick,
    };
}

describe("deciding a skirmish battle", () => {
    it("gives it to the armed side at once against one with nothing to fight with", () => {
        const { decision } = fight(gunship, core, TIME_CAP);
        expect(decision?.winner).toBe(0);
        expect(decision!.reason).toBe("disarmed");
        expect(decision!.time).toBeLessThan(1);
    });

    it("calls two unarmed sides a draw at once", () => {
        expect(fight(core, core, 10).decision).toMatchObject({ winner: -1, reason: "disarmed" });
    });

    it("decides nothing while both armed sides are quiet, until the time cap", () => {
        // Too far apart to fire at all in the time.
        expect(fight(gunship, gunship, QUIET_TIME + 5, 200_000).decision).toBeNull();
        const { decision } = fight(gunship, gunship, 60, 200_000, 40);
        expect(decision).toEqual({ winner: -1, reason: "time", time: expect.closeTo(40, 1) });
    });

    it("does not put out a side that has not fired yet, when the other first fires after 30 s", () => {
        // Slow ships, short range, far apart: the enemy is first in range, at 40 s.
        const battle = staged();
        battle.fired[1] = 40;
        expect(battle.to(41)).toBeNull();
        // Both have fired: now going quiet counts.
        battle.fired[0] = 45;
        expect(battle.to(46)).toBeNull();
        for (let t = 47; t <= 45 + QUIET_TIME + 1; t++) {
            battle.fired[1] = battle.tick() + 1;
            const decision = battle.to(t);
            if (decision !== null) {
                expect(decision.winner).toBe(1);
                expect(decision.time).toBeGreaterThanOrEqual(45 + QUIET_TIME);
                return;
            }
        }
        throw new Error("never decided");
    });

    it("puts a side out once it has been quiet for 30 s while the other fires", () => {
        const battle = staged();
        // Both fire once at the start, then only side 1 keeps on.
        battle.fired[0] = 1;
        battle.fired[1] = 1;
        expect(battle.to(QUIET_TIME - 1)).toBeNull();
        for (let t = 1; t <= QUIET_TIME + 1; t++) {
            battle.fired[1] = battle.tick() + 1;
            const decision = battle.to(t);
            if (decision !== null) {
                expect(decision.winner).toBe(1);
                expect(decision.reason).toBe("quiet");
                return;
            }
        }
        throw new Error("never decided");
    });

    it("gives it to the side whose slow round lands, not to the one it disables", () => {
        const battle = staged();
        // A fires its last round at once; B fires at 20 s; A's round lands at 25 s
        // and disarms B, by which time A has been quiet for 25 s.
        battle.fired[0] = 1;
        expect(battle.to(19)).toBeNull();
        battle.fired[1] = 20;
        expect(battle.to(24)).toBeNull();
        battle.hits.push([0, 1]);
        battle.disarmed[1] = true;
        expect(battle.to(25)).toEqual({ winner: 0, reason: "disarmed", time: 25 });
    });

    it("counts a hit landing as firing", () => {
        const quiet = staged();
        quiet.fired[0] = 1;
        quiet.fired[1] = 20;
        expect(quiet.to(40)?.winner).toBe(1);

        // The same, but A's round lands at 25 s without disarming B: A is still in it.
        const hit = staged();
        hit.fired[0] = 1;
        hit.fired[1] = 20;
        expect(hit.to(24)).toBeNull();
        hit.hits.push([0, 1]);
        expect(hit.to(40)).toBeNull();
    });
});

describe("the skirmish", () => {
    it("takes its budget from the enemy, so the enemy itself fits it", () => {
        const skirmish = newSkirmish(LINE_OF_BATTLE, LINE_OF_BATTLE, 5);
        expect(skirmish.budget).toEqual(billOfFleet(LINE_OF_BATTLE));
        expect(canFight(skirmish)).toBe(true);
    });

    it("takes a budget it is given instead", () => {
        const budget = { metal: 1e9, fuel: 1e9, build: 1e9 };
        const skirmish = newSkirmish(core, gunship, 5, undefined, budget);
        expect(skirmish.budget).toEqual(budget);
        expect(canFight(skirmish)).toBe(true);
    });

    it("will not fight with more ships, or a wider spread, than its settings allow", () => {
        const budget = { metal: 1e9, fuel: 1e9, build: 1e9 };
        const pair: Fleet = {
            ...gunship,
            ships: [
                { design: GUNSHIP.name, x: 0, y: -100 },
                { design: GUNSHIP.name, x: 0, y: 100 },
            ],
        };
        const one = { ...DEFAULT_SKIRMISH_SETTINGS, maxShips: 1 };
        expect(overLimit(newSkirmish(core, pair, 5, one, budget))).toMatch(/2 ships, more than the 1 allowed/);
        expect(canFight(newSkirmish(core, pair, 5, one, budget))).toBe(false);
        expect(canFight(newSkirmish(core, pair, 5, undefined, budget))).toBe(true);
        const far: Fleet = { ...gunship, ships: [{ design: GUNSHIP.name, x: 1000, y: 0 }] };
        expect(overLimit(newSkirmish(core, far, 5, undefined, budget))).toMatch(/beyond the 500 m allowed/);
        expect(canFight(newSkirmish(core, far, 5, { ...DEFAULT_SKIRMISH_SETTINGS, radius: 2000 }, budget))).toBe(true);
        // Never less than the enemy fields.
        expect(overLimit(newSkirmish(pair, pair, 5, one, budget))).toBeNull();
        expect(overLimit(newSkirmish(far, far, 5, undefined, budget))).toBeNull();
    });

    it("will not fight with nothing, or over budget", () => {
        expect(canFight(newSkirmish(gunship, empty, 5))).toBe(false);
        expect(canFight(newSkirmish(core, gunship, 5))).toBe(false);
    });

    it("names a design that would not fly, rather than throw pricing it", () => {
        // A gunship with a module standing off on its own.
        const adrift: Blueprint = {
            ...GUNSHIP,
            name: "Adrift",
            modules: [...GUNSHIP.modules, { kind: "engine", x: 0, y: 200, length: 3, width: 3 }],
        };
        const broken = lone("Broken", adrift);
        expect(fleetFault(broken)).toMatch(/Adrift: .*touches nothing/);
        expect(canFight(newSkirmish(gunship, broken, 5))).toBe(false);
        expect(fleetFault(gunship)).toBeNull();
        // One it carries but does not fly is not its problem.
        const carried: Fleet = { ...gunship, designs: { ...gunship.designs, Adrift: adrift } };
        expect(fleetFault(carried)).toBeNull();
        expect(billOfFleet(carried)).toEqual(billOfFleet(gunship));
    });

    it("starts the fleets far enough apart that their hulls are clear", () => {
        const setup = roundSetup(newSkirmish(LINE_OF_BATTLE, LINE_OF_BATTLE, 5));
        const reach = fleetReach(fleetHulls(LINE_OF_BATTLE));
        expect(setup.range).toBeGreaterThan(2 * reach);
        expect(setup.fleets[0]).toBe(LINE_OF_BATTLE);
        expect(setup.seed).toBe(5);
    });

    it("fights a lost round again on the same seed, and the next on the seed its answer won on", () => {
        const skirmish = newSkirmish(gunship, gunship, 5);
        const again = lost(skirmish);
        expect(again.seed).toBe(5);
        expect(again.tries).toBe(1);
        const next = nextRound({ ...again, won: 9 }, LINE_OF_BATTLE);
        expect(next.round).toBe(2);
        expect(next.tries).toBe(0);
        expect(next.seed).toBe(9);
        // The budget is the player's: the enemy's answer is not held to it.
        expect(next.budget).toEqual(skirmish.budget);
        expect(next.enemy).toBe(LINE_OF_BATTLE);
    });

    it("picks the next round a new seed once this one is won, and fights it on that", () => {
        const skirmish = won(newSkirmish(gunship, gunship, 5));
        expect(skirmish.won).toBeDefined();
        expect(skirmish.won).not.toBe(5);
        expect(parseSkirmish(JSON.parse(JSON.stringify(serialiseSkirmish(skirmish)))).won).toBe(skirmish.won);
        const next = nextRound(skirmish, gunship);
        expect(next.won).toBeUndefined();
        expect(next.seed).toBe(skirmish.won);
    });

    it("round-trips, an empty fleet and all, through a link", () => {
        const skirmish = newSkirmish(LINE_OF_BATTLE, empty, 9);
        const back = viaLink(skirmish);
        expect(back && serialiseSkirmish(back)).toEqual(serialiseSkirmish(skirmish));
        expect(handedSkirmish(new URLSearchParams("fleet=x"))).toBeNull();
    });

    it("keeps its name, and names its file for it", () => {
        const named = newSkirmish(gunship, gunship, 5, undefined, undefined, "  Sam's rematch ");
        expect(named.name).toBe("Sam's rematch");
        expect(parseSkirmish(JSON.parse(JSON.stringify(serialiseSkirmish(named)))).name).toBe("Sam's rematch");
        expect(skirmishFileName({ ...named, round: 3 })).toBe("Sam-s-rematch-round-3.skirmish.json");
        const unnamed = newSkirmish(gunship, gunship, 5, undefined, undefined, " ");
        expect(unnamed.name).toBeUndefined();
        expect("name" in serialiseSkirmish(unnamed)).toBe(false);
        expect(skirmishFileName(unnamed)).toBe("skirmish-round-1.skirmish.json");
        expect(skirmishFileName(null)).toBe("skirmish.skirmish.json");
        expect(() => parseSkirmish({ ...serialiseSkirmish(unnamed), name: 4 })).toThrow(/name/);
    });

    it("keeps the settings it is played under, and reads one saved without them as the defaults", () => {
        const settings = { ...DEFAULT_SKIRMISH_SETTINGS, quietTime: 45, gap: 4000, closingSpeed: -10, breeding: { kindTank: 7 } };
        const skirmish = newSkirmish(gunship, gunship, 5, settings);
        const back = viaLink(skirmish)!;
        expect(settingsOf(back)).toEqual(settings);
        expect(settingsOf(newSkirmish(gunship, gunship, 5))).toEqual(DEFAULT_SKIRMISH_SETTINGS);
        // Settings saved before answers had a margin keep none.
        const { answerMargin: _, ...older } = settings;
        expect(settingsOf(parseSkirmish({ ...serialiseSkirmish(skirmish), settings: older })).answerMargin).toBe(0);
        // The round is set out by them.
        const near = roundSetup(back);
        const nearer = roundSetup(newSkirmish(gunship, gunship, 5, { ...settings, gap: 3000 }));
        expect(near.range - nearer.range).toBeCloseTo(1000, 6);
        expect(near.closingSpeed).toBe(-10);
        const file = serialiseSkirmish(skirmish);
        expect(() => parseSkirmish({ ...file, settings: { quietTime: -1 } })).toThrow(/quietTime/);
        expect(() => parseSkirmish({ ...file, settings: { breeding: { kindTank: "lots" } } })).toThrow(/breeding\.kindTank/);
    });

    it("draws each round's gap and speeds from their spreads, the same every time on the same seed", () => {
        const settings = { ...DEFAULT_SKIRMISH_SETTINGS, gap: 3000, gapSpread: 2000, closingSpread: 20, crossingSpread: 20 };
        const rounds = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => roundBattle(gunship, gunship, seed, settings));
        const ranges = rounds.map((round) => round.range);
        const reach = 2 * fleetReach(fleetHulls(gunship));
        for (const range of ranges) expect(range - reach).toBeGreaterThanOrEqual(1000 - 1e-9);
        for (const range of ranges) expect(range - reach).toBeLessThanOrEqual(5000 + 1e-9);
        expect(Math.max(...ranges) - Math.min(...ranges)).toBeGreaterThan(1000);
        expect(new Set(rounds.map((round) => round.closingSpeed)).size).toBe(8);
        expect(roundBattle(gunship, gunship, 3, settings)).toEqual(rounds[2]);
        // No spread holds them.
        const held = [1, 2, 3].map((seed) => roundBattle(gunship, gunship, seed, { ...settings, gapSpread: 0 }).range);
        expect(new Set(held).size).toBe(1);
    });

    it("steps the enemy's budget multiplier onto a neat number first, then by whole steps", () => {
        expect(nextMultiplier(1, 0.1)).toBe(1.1);
        expect(nextMultiplier(1.325, 0.1)).toBe(1.4);
        expect(nextMultiplier(1.4, 0.1)).toBe(1.5);
        expect(nextMultiplier(1.1, 0.1)).toBe(1.2);
        expect(nextMultiplier(2.9, 0.1)).toBe(3);
        expect(nextMultiplier(1.3, 0.25)).toBe(1.5);
        // No step, no growth.
        expect(nextMultiplier(1.325, 0)).toBe(1.325);
    });

    it("counts an enemy that costs more than the player's budget as that much bigger", () => {
        const budget = { metal: 100, fuel: 100, build: 100 };
        expect(startingMultiplier(1, budget, { metal: 132.5, fuel: 50, build: 90 })).toBeCloseTo(1.325);
        expect(startingMultiplier(2, budget, { metal: 132.5, fuel: 50, build: 90 })).toBe(2);
        // A currency the player has none of is left out.
        expect(startingMultiplier(1, { ...budget, fuel: 0 }, { metal: 50, fuel: 10, build: 50 })).toBe(1);
    });

    it("keeps the enemy's budget multiplier, 1 where not said, and refuses a nonsensical one", () => {
        const skirmish = newSkirmish(gunship, gunship, 5);
        expect(multiplierOf(skirmish)).toBe(1);
        const grown = { ...skirmish, multiplier: 2.25 };
        expect(multiplierOf(viaLink(grown)!)).toBe(2.25);
        // It carries on into the next round.
        expect(multiplierOf(nextRound(grown, gunship))).toBe(2.25);
        expect(() => parseSkirmish({ ...serialiseSkirmish(skirmish), multiplier: 0 })).toThrow(/multiplier/);
    });

    it("refuses a skirmish it cannot read", () => {
        const file = serialiseSkirmish(newSkirmish(gunship, gunship, 1));
        expect(() => parseSkirmish({ ...file, formatVersion: 2 })).toThrow(/formatVersion/);
        expect(() => parseSkirmish({ ...file, round: 0 })).toThrow(/round/);
        expect(() => parseSkirmish({ ...file, budget: { metal: -1, fuel: 0, build: 0 } })).toThrow(/budget\.metal/);
    });
});
