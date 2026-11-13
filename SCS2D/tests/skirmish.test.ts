import { describe, expect, it } from "vitest";
import { fleetBill, fleetDraftHulls, fleetHulls, fleetReach, NEUTRAL_TEAM, type Blueprint, type Fleet } from "../sim/index.js";
import { BARE_CORE, GUNSHIP } from "../scenarios/blueprints.js";
import { LINE_OF_BATTLE } from "../scenarios/fleets.js";
import { customBattle } from "../scenarios/customBattle.js";
import { Activity, QUIET_TIME, TIME_CAP, type Decision } from "../scenarios/decision.js";
import {
    billOfFleet,
    canFight,
    DEFAULT_SKIRMISH_SETTINGS,
    fleetFault,
    inSkirmish,
    lost,
    newSkirmish,
    enemyLimits,
    pick,
    playerLimits,
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
 * who fired, who is disarmed, and which hits landed. Body 2 is an asteroid.
 */
function staged(dt = 1) {
    const fired = [-1, -1];
    const disarmed = [false, false];
    const hits: [number, number][] = [];
    const world = { tick: 0, dt };
    const ships = {
        highWater: 2,
        isAlive: () => true,
        teamOf: (i: number) => (i < 2 ? i : NEUTRAL_TEAM),
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

describe("pricing work in progress", () => {
    it("prices a fleet that would fly as fighting would", () => {
        expect(fleetBill(fleetDraftHulls(LINE_OF_BATTLE))).toEqual(fleetBill(fleetHulls(LINE_OF_BATTLE)));
    });

    it("prices a design that would not fly as it stands, and leaves out a blank one", () => {
        const adrift: Blueprint = {
            ...GUNSHIP,
            name: "Adrift",
            modules: [...GUNSHIP.modules, { kind: "engine", x: 0, y: 200, length: 3, width: 3 }],
        };
        const fleet: Fleet = {
            name: "Building",
            designs: { Adrift: adrift, Blank: { name: "Blank", modules: [] } },
            ships: [
                { design: "Adrift", x: 0, y: 0 },
                { design: "Blank", x: 0, y: 100 },
            ],
        };
        expect(() => fleetHulls(fleet)).toThrow();
        const hulls = fleetDraftHulls(fleet);
        expect(hulls.map((hull) => hull.ship.design)).toEqual(["Adrift"]);
        expect(fleetBill(hulls).metal).toBeGreaterThan(
            fleetBill(fleetHulls({ ...fleet, designs: { Adrift: GUNSHIP }, ships: [{ design: "Adrift", x: 0, y: 0 }] })).metal,
        );
    });
});

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

    it("puts a side out that only grinds against an asteroid while the other fires", () => {
        const battle = staged();
        battle.fired[0] = 1;
        battle.fired[1] = 1;
        for (let t = 1; t <= QUIET_TIME + 1; t++) {
            battle.fired[1] = battle.tick() + 1;
            battle.hits.push([0, 2]);
            const decision = battle.to(t);
            if (decision !== null) {
                expect(decision).toMatchObject({ winner: 1, reason: "quiet" });
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
    it("files a ship made or changed for it under its name", () => {
        const skirmish = newSkirmish(LINE_OF_BATTLE, LINE_OF_BATTLE, 5, undefined, undefined, "Long war");
        expect(inSkirmish(GUNSHIP, skirmish).category).toBe("Long war");
        expect(inSkirmish(GUNSHIP, newSkirmish(LINE_OF_BATTLE, LINE_OF_BATTLE, 5)).category).toBe("Skirmish");
        expect(GUNSHIP.category).toBe("Stock");
    });

    it("takes its budget from the enemy, so the enemy itself fits it", () => {
        // Ships enough for it: the player is held to the limit, however many the enemy fields.
        const settings = { ...DEFAULT_SKIRMISH_SETTINGS, maxShips: fleetHulls(LINE_OF_BATTLE).length };
        const skirmish = newSkirmish(LINE_OF_BATTLE, LINE_OF_BATTLE, 5, settings);
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
        // The enemy keeps the ships and spread it fields, but the player is held to the limits.
        expect(overLimit(newSkirmish(pair, pair, 5, one, budget))).toMatch(/2 ships, more than the 1 allowed/);
        expect(enemyLimits(newSkirmish(pair, pair, 5, one, budget)).maxShips).toBe(2);
        expect(overLimit(newSkirmish(far, far, 5, undefined, budget))).toMatch(/beyond the 500 m allowed/);
        expect(enemyLimits(newSkirmish(far, far, 5, undefined, budget)).radius).toBeGreaterThan(500);
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

    it("draws a hand of cards after three losses in a row, each with a fleet that has not lost the round", () => {
        const start = newSkirmish(gunship, gunship, 5);
        // The same fleet losing again does not count.
        let skirmish = lost(lost(lost(start)));
        expect(skirmish.streak).toBe(1);
        expect(skirmish.hand).toBeUndefined();
        expect(canFight(skirmish)).toBe(true);
        skirmish = lost({ ...skirmish, player: core });
        // Going back to a fleet that has already lost does not count either.
        skirmish = lost({ ...skirmish, player: gunship });
        expect(skirmish.streak).toBe(2);
        skirmish = lost({ ...skirmish, player: lone("Two", GUNSHIP) });
        expect(skirmish.streak).toBe(0);
        expect(skirmish.hand).toHaveLength(3);
        expect(new Set(skirmish.hand).size).toBe(3);
        // Drawn from the round, so the same losses in another order draw the same hand.
        const other = lost({ ...lost({ ...lost({ ...start, player: core }), player: gunship }), player: lone("Two", GUNSHIP) });
        expect(other.hand).toEqual(skirmish.hand);
        // No fighting until one is picked.
        expect(canFight(skirmish)).toBe(false);
        const card = skirmish.hand![1]!;
        const picked = pick(skirmish, card);
        expect(picked.hand).toBeUndefined();
        expect(picked.cards).toEqual([card]);
        expect(picked.picked).toBe(card);
        expect(canFight(picked)).toBe(true);
        // A card not offered is not taken.
        expect(pick(skirmish, "nothing")).toBe(skirmish);
        // The next loss forgets which card was picked; a round won forgets the streak.
        expect(lost(picked).picked).toBeUndefined();
        expect(won(lost(picked)).streak).toBeUndefined();
    });

    it("draws no cards when the settings ask for none", () => {
        const settings = { ...DEFAULT_SKIRMISH_SETTINGS, cardAfter: 0 };
        let skirmish = newSkirmish(gunship, gunship, 5, settings);
        for (const player of [gunship, core, lone("Two", GUNSHIP), lone("Three", GUNSHIP)]) skirmish = lost({ ...skirmish, player });
        expect(skirmish.hand).toBeUndefined();
    });

    it("moves the player's limits by the cards they hold, from where the skirmish started them", () => {
        const skirmish = newSkirmish(gunship, gunship, 5, undefined, { metal: 1000, fuel: 100, build: 50 });
        const held = { ...skirmish, cards: ["metal", "metal", "fuel-for-metal", "ship", "spread"] };
        const limits = playerLimits(held);
        expect(limits.budget.metal).toBeCloseTo(1350);
        expect(limits.budget.fuel).toBeCloseTo(90);
        expect(limits.budget.build).toBeCloseTo(50);
        expect(limits.maxShips).toBe(DEFAULT_SKIRMISH_SETTINGS.maxShips + 1);
        expect(limits.radius).toBe(DEFAULT_SKIRMISH_SETTINGS.radius + 100);
        // Never below half where it started.
        const cut = playerLimits({ ...skirmish, cards: Array<string>(8).fill("metal-for-fuel") });
        expect(cut.budget.metal).toBeCloseTo(500);
    });

    it("holds the enemy to the starting limits moved by its own cards, never below what it has", () => {
        const skirmish = newSkirmish(gunship, gunship, 5, undefined, { metal: 1, fuel: 1, build: 1 });
        const limits = enemyLimits({ ...skirmish, enemyCards: ["ship", "spread"] });
        const bill = billOfFleet(gunship);
        expect(limits.budget).toEqual(bill);
        expect(limits.maxShips).toBe(DEFAULT_SKIRMISH_SETTINGS.maxShips + 1);
        expect(limits.radius).toBe(DEFAULT_SKIRMISH_SETTINGS.radius + 100);
        // The player's cards are theirs alone.
        expect(enemyLimits({ ...skirmish, cards: ["ship"] }).maxShips).toBe(DEFAULT_SKIRMISH_SETTINGS.maxShips);
    });

    it("keeps its cards through a link, and reads a skirmish from before cards", () => {
        const skirmish = {
            ...newSkirmish(gunship, gunship, 5),
            cards: ["metal", "ship"],
            enemyCards: ["fuel"],
            hand: ["build", "spread", "metal"],
            streak: 1,
            losing: ["abc"],
            picked: "ship",
        };
        expect(viaLink(skirmish)).toEqual(skirmish);
        expect(nextRound(skirmish, gunship).cards).toEqual(["metal", "ship"]);
        expect(nextRound(skirmish, gunship).losing).toBeUndefined();
        const file = serialiseSkirmish(newSkirmish(gunship, gunship, 5));
        expect(parseSkirmish({ ...file, multiplier: 2.25 }).enemyCards).toBeUndefined();
        expect(() => parseSkirmish({ ...file, cards: ["nothing"] })).toThrow(/cards/);
    });

    it("refuses a skirmish it cannot read", () => {
        const file = serialiseSkirmish(newSkirmish(gunship, gunship, 1));
        expect(() => parseSkirmish({ ...file, formatVersion: 2 })).toThrow(/formatVersion/);
        expect(() => parseSkirmish({ ...file, round: 0 })).toThrow(/round/);
        expect(() => parseSkirmish({ ...file, budget: { metal: -1, fuel: 0, build: 0 } })).toThrow(/budget\.metal/);
    });
});
