import { describe, expect, it } from "vitest";
import { fleetBill, fleetHulls, serialiseFleet, shipFleet } from "../sim/index.js";
import { fleetFits } from "../evolution/fleetMutate.js";
import { CORVETTE, GUNSHIP } from "../scenarios/blueprints.js";
import { customBattle, tally } from "../scenarios/customBattle.js";
import { Activity, type Decision } from "../scenarios/decision.js";
import { DEFAULT_SKIRMISH_SETTINGS, roundBattle } from "../scenarios/skirmish.js";
import { damageDealt, damageScale, drillBattle, EnemySearch } from "../evolution/answer.js";

const gunship = shipFleet(GUNSHIP);
const corvette = shipFleet(CORVETTE);
/** A seed the Gunship beats the Corvette on, from where a round sets them out. */
const WON = 7;
/** A seed the player's Corvette beats the same Corvette on. */
const MIRROR_WON = 25;

function decide(player = gunship, enemy = corvette, seed = WON): Decision {
    const battle = customBattle(roundBattle(player, enemy, seed));
    const activity = new Activity(2);
    let decision: Decision | null = null;
    while (decision === null) {
        battle.step();
        decision = activity.observe(battle);
    }
    return decision;
}

describe("the skirmish enemy's answer", () => {
    it("starts from an enemy the player beat on the seed it was won on", () => {
        expect(decide().winner).toBe(0);
    });

    it("finds an enemy that beats the player on that seed, to the skirmish decision", { timeout: 120_000 }, () => {
        // A mirror the player won is the quickest to answer: a Gunship is a long way past a Corvette.
        expect(decide(corvette, corvette, MIRROR_WON).winner).toBe(0);
        const answering = new EnemySearch(corvette, corvette, MIRROR_WON, 11);
        for (let slice = 0; slice < 200 && !answering.advance(5000); slice++);
        const found = answering.progress.found;
        expect(found).not.toBeNull();
        expect(decide(corvette, found!, MIRROR_WON).winner).toBe(1);
    });

    it("wins the round by its margin, or is no answer", { timeout: 120_000 }, () => {
        // Finishing more than all of itself ahead of the player cannot be done.
        const answering = new EnemySearch(corvette, corvette, MIRROR_WON, 11, { answerMargin: 1.01 });
        for (let slice = 0; slice < 40 && !answering.advance(5000); slice++);
        expect(answering.progress.found).toBeNull();
        // The answer found by default finishes the round at least that far ahead.
        const found = new EnemySearch(corvette, corvette, MIRROR_WON, 11);
        for (let slice = 0; slice < 200 && !found.advance(5000); slice++);
        const battle = customBattle(roundBattle(corvette, found.progress.found!, MIRROR_WON));
        const activity = new Activity(2);
        while (activity.observe(battle) === null) battle.step();
        const now = tally(battle, 2);
        const share = (side: 0 | 1): number => now[side]!.mass / battle.start[side]!.mass;
        expect(share(1) - share(0)).toBeGreaterThanOrEqual(DEFAULT_SKIRMISH_SETTINGS.answerMargin);
    });

    it("is decided by its seed", { timeout: 120_000 }, () => {
        // A fixed amount of work rather than a whole search, so the test costs the same on any seed.
        const run = (): EnemySearch => {
            const going = new EnemySearch(gunship, corvette, WON, 3);
            going.advance(80_000);
            return going;
        };
        const a = run().progress;
        const b = run().progress;
        expect(a.generation).toBeGreaterThan(0);
        expect(b.generation).toBe(a.generation);
        expect(serialiseFleet(b.best.enemy)).toEqual(serialiseFleet(a.best.enemy));
        expect(b.best.margin).toBe(a.best.margin);
    });

    it("answers with the first enemy that truly wins the round, and counts no other as winning it", { timeout: 120_000 }, () => {
        // Every enemy ahead on the round when its match ran out is checked to the decision before the
        // generation is reported, so one reported as winning the round is the answer.
        const running = new EnemySearch(gunship, corvette, WON, 5);
        let seen = 0;
        for (let slice = 0; slice < 100 && !running.advance(2000); slice++) {
            const now = running.progress;
            if (now.generation === seen) continue;
            seen = now.generation;
            expect(now.best.onRound).toBe(false);
        }
        const found = running.progress.found;
        if (found !== null) {
            expect(running.progress.best.enemy).toBe(found);
            expect(running.progress.best.onRound).toBe(true);
            expect(decide(gunship, found).winner).toBe(1);
        }
    });

    it(
        "names the enemy leading a generation once it has fought all its matches, and the best once the generation is done",
        { timeout: 120_000 },
        () => {
            const running = new EnemySearch(gunship, corvette, WON, 5);
            expect(running.leader).toBeNull();
            let led = null;
            // A step at a time, so every match's end is seen before what follows it.
            while (!running.advance(1) && running.progress.generation === 0) {
                const leader = running.leader;
                // Never one part-way through its matches: who leads only changes for a better one.
                if (led !== null) expect(leader).not.toBeNull();
                if (led !== null && leader !== led)
                    expect(leader!.wins * 1e9 + leader!.margin).toBeGreaterThan(led.wins * 1e9 + led.margin);
                led = leader ?? led;
            }
            expect(led).not.toBeNull();
            // The leader at the generation's end was its best.
            expect(led!.enemy).toBe(running.progress.best.enemy);
            // A new generation has fought nothing yet.
            if (running.progress.found === null) expect(running.leader).toBeNull();
        },
    );

    it("reports each generation as it finishes", () => {
        const running = new EnemySearch(gunship, corvette, WON, 5);
        expect(running.progress.generation).toBe(0);
        while (running.progress.generation === 0 && !running.advance(1000));
        expect(running.progress.generation).toBeGreaterThanOrEqual(1);
        expect(running.progress.seeds).toBe(3);
    });
});

describe("how far an answer may grow", () => {
    it("to the player's budget times the multiplier, and the skirmish's ship limit", () => {
        const budget = { metal: 1_000_000, fuel: 200_000, build: 50_000 };
        const running = new EnemySearch(gunship, corvette, WON, 5, { maxShips: 7 }, budget, 2);
        expect(running.limits.budget).toEqual({ metal: 2_000_000, fuel: 400_000, build: 100_000 });
        expect(running.limits.maxShips).toBe(7);
        expect(running.progress.multiplier).toBe(2);
    });

    it("never to less than the enemy it answers already has", () => {
        const bill = fleetBill(fleetHulls(corvette));
        const running = new EnemySearch(gunship, corvette, WON, 5, { maxShips: 0 }, { metal: 1, fuel: 1, build: 1 });
        for (const key of ["metal", "fuel", "build"] as const)
            expect(running.limits.budget[key]).toBeGreaterThanOrEqual(bill[key] * (1 - 1e-12));
        expect(running.limits.maxShips).toBe(1);
        // Without the player's budget, the enemy's own cost at 1×.
        expect(new EnemySearch(gunship, corvette, WON, 5).limits.budget).toEqual(bill);
    });

    it("keeps every enemy it breeds within that", () => {
        const running = new EnemySearch(gunship, corvette, WON, 5, { stretchAfter: 1000 });
        for (let i = 0; i < 3 && !running.advance(5_000); i++) {
            const best = running.progress.found ?? running.progress.best.enemy;
            expect(fleetFits(best, { ...running.limits, radius: Infinity })).toBe(true);
        }
    });

    it("steps its budget up after long enough without an answer, from where it is told", () => {
        const budget = { metal: 1_000_000, fuel: 200_000, build: 50_000 };
        const running = new EnemySearch(gunship, corvette, WON, 5, { stretchAfter: 1, budgetStep: 0.1 }, budget, 2);
        while (running.progress.generation < 2 && !running.advance(1000));
        if (running.progress.found !== null) return;
        expect(running.progress.multiplier).toBe(2.2);
        expect(running.limits.budget.metal).toBeCloseTo(budget.metal * 2.2);
    });

    it("starts no lower than the enemy needs to afford itself", () => {
        const bill = fleetBill(fleetHulls(corvette));
        const budget = { metal: bill.metal / 1.325, fuel: bill.fuel, build: bill.build };
        expect(new EnemySearch(gunship, corvette, WON, 5, {}, budget).progress.multiplier).toBeCloseTo(1.325);
    });
});

describe("how the enemy is bred", () => {
    it("breeds by the mutation odds it is given", () => {
        // Only moves: every mutant keeps the enemy's designs and its ships.
        const only = { fleetDesign: 0, fleetChange: 0, fleetMove: 1 };
        const search = new EnemySearch(gunship, corvette, MIRROR_WON, 4, { mutants: 3, seeds: 1, duration: 20, breeding: only });
        while (search.progress.generation < 1 && !search.advance(2000));
        const best = search.progress.best.enemy;
        expect(best.designs).toEqual(corvette.designs);
        expect(best.ships).toHaveLength(corvette.ships.length);
    });
});

describe("the drills an enemy fights", () => {
    const run = (battle: ReturnType<typeof drillBattle>, seconds: number): void => {
        for (let t = 0; t < seconds / battle.dt; t++) battle.step();
    };

    it("makes the enemy invincible against the fully armed player", { timeout: 120_000 }, () => {
        // The Gunship beats the Corvette on WON, so it hurts it there unless it cannot.
        const battle = drillBattle({ kind: "shielded", seed: WON }, gunship, corvette, DEFAULT_SKIRMISH_SETTINGS);
        run(battle, 120);
        const [player, enemy] = tally(battle, 2);
        expect(enemy!.mass).toBeCloseTo(battle.start[1]!.mass, 6);
        expect(enemy!.armed).toBe(battle.start[1]!.armed);
        // While the Gunship, which wins there for real, is the one hurt.
        expect(player!.mass).toBeLessThan(battle.start[0]!.mass);
    });

    it("sets the enemy against a bare core it can destroy", { timeout: 120_000 }, () => {
        const battle = drillBattle({ kind: "bareCore", seed: 3 }, corvette, gunship, DEFAULT_SKIRMISH_SETTINGS);
        expect(battle.start[0]!.armed).toBe(0);
        run(battle, 180);
        expect(tally(battle, 2)[0]!.ships).toBe(0);
    });

    it("only adds to an enemy score, never to its wins", { timeout: 120_000 }, () => {
        const going = new EnemySearch(gunship, corvette, WON, 4, { seeds: 1, bareCoreDrills: 1, shieldedDrills: 1 });
        while (going.progress.generation === 0 && !going.advance(5000));
        expect(going.progress.best.wins).toBeLessThanOrEqual(1);
    });
});

describe("the damage an enemy does", () => {
    // Bodies 0 and 1 are the player's and the enemy's ships; module 0 is structure, module 1 a gun.
    const hits = (list: [attacker: number, victim: number, module: number, energy: number][]) =>
        ({
            ships: {
                pilotAt: (body: number) => body,
                teamOf: (ship: number) => ship,
                damage: { kindAt: (_body: number, module: number) => (module === 0 ? "structure" : "hullGun") },
            },
            credit: {
                count: list.length,
                attacker: list.map((h) => h[0]),
                victim: list.map((h) => h[1]),
                module: list.map((h) => h[2]),
                attackerModule: list.map(() => -1),
                energy: list.map((h) => h[3]),
            },
        }) as never;

    it("counts only the enemy's hits on the player, a working part three times bare structure", () => {
        expect(damageDealt(hits([[1, 0, 0, 100]]))).toBe(100);
        expect(damageDealt(hits([[1, 0, 1, 100]]))).toBe(300);
        // The player's own hits, and the enemy's on itself, are not the enemy's damage.
        expect(
            damageDealt(
                hits([
                    [0, 1, 1, 100],
                    [1, 1, 1, 100],
                ]),
            ),
        ).toBe(0);
    });

    it("scores on a log scale, so a few hits count and each tenfold more counts as much again", () => {
        expect(damageScale(0)).toBe(0);
        expect(damageScale(1)).toBeCloseTo(1, 12);
        expect(damageScale(3e-7)).toBeGreaterThan(0.01);
        const step = damageScale(1e-3) - damageScale(1e-4);
        expect(damageScale(1e-2) - damageScale(1e-3)).toBeCloseTo(step, 2);
    });

    it("is done in a real fight the enemy loses", { timeout: 120_000 }, () => {
        const battle = customBattle(roundBattle(gunship, corvette, WON));
        let dealt = 0;
        for (let t = 0; t < 120 / battle.dt; t++) {
            battle.step();
            dealt += damageDealt(battle);
        }
        expect(dealt).toBeGreaterThan(0);
    });
});
