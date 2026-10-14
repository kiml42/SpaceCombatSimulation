import { describe, expect, it } from 'vitest';
import { fleetHulls, fleetReach, type Fleet } from '../sim/index.js';
import { BARE_CORE, GUNSHIP } from '../scenarios/blueprints.js';
import { LINE_OF_BATTLE } from '../scenarios/fleets.js';
import { customBattle } from '../scenarios/customBattle.js';
import { Activity, QUIET_TIME, TIME_CAP, type Decision } from '../scenarios/decision.js';
import {
  billOfFleet,
  canFight,
  handedSkirmish,
  lost,
  newSkirmish,
  nextRound,
  parseSkirmish,
  roundSetup,
  serialiseSkirmish,
  skirmishFragment,
  won,
} from '../scenarios/skirmish.js';

const lone = (name: string, design: typeof GUNSHIP): Fleet => ({
  name,
  designs: { [design.name]: design },
  ships: [{ design: design.name, x: 0, y: 0 }],
});
const gunship = lone('Gunship', GUNSHIP);
const core = lone('Core', BARE_CORE);
const empty: Fleet = { name: 'Mine', designs: {}, ships: [] };

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

describe('deciding a skirmish battle', () => {
  it('gives it to the armed side at once against one with nothing to fight with', () => {
    const { decision } = fight(gunship, core, TIME_CAP);
    expect(decision?.winner).toBe(0);
    expect(decision!.time).toBeLessThan(1);
  });

  it('calls two unarmed sides a draw at once', () => {
    expect(fight(core, core, 10).decision?.winner).toBe(-1);
  });

  it('decides nothing while both armed sides are quiet, until the time cap', () => {
    // Too far apart to fire at all in the time.
    expect(fight(gunship, gunship, QUIET_TIME + 5, 200_000).decision).toBeNull();
    const { decision } = fight(gunship, gunship, 60, 200_000, 40);
    expect(decision).toEqual({ winner: -1, reason: 'time', time: expect.closeTo(40, 1) });
  });

  it('puts a side out once it has been quiet for 30 s while the other fires', () => {
    const battle = staged();
    battle.fired[0] = 0;
    expect(battle.to(QUIET_TIME - 1)).toBeNull();
    for (let t = 1; t <= QUIET_TIME + 1; t++) {
      battle.fired[1] = battle.tick() + 1;
      const decision = battle.to(t);
      if (decision !== null) {
        expect(decision.winner).toBe(1);
        return;
      }
    }
    throw new Error('never decided');
  });

  it('gives it to the side whose slow round lands, not to the one it disables', () => {
    const battle = staged();
    // A fires its last round at once; B fires at 20 s; A's round lands at 25 s
    // and disarms B, by which time A has been quiet for 25 s.
    battle.fired[0] = 1;
    expect(battle.to(19)).toBeNull();
    battle.fired[1] = 20;
    expect(battle.to(24)).toBeNull();
    battle.hits.push([0, 1]);
    battle.disarmed[1] = true;
    expect(battle.to(25)).toEqual({ winner: 0, reason: 'quiet', time: 25 });
  });

  it('counts a hit landing as firing', () => {
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

describe('the skirmish', () => {
  it('takes its budget from the enemy, so the enemy itself fits it', () => {
    const skirmish = newSkirmish(LINE_OF_BATTLE, LINE_OF_BATTLE, 5);
    expect(skirmish.budget).toEqual(billOfFleet(LINE_OF_BATTLE));
    expect(canFight(skirmish)).toBe(true);
  });

  it('will not fight with nothing, or over budget', () => {
    expect(canFight(newSkirmish(gunship, empty, 5))).toBe(false);
    expect(canFight(newSkirmish(core, gunship, 5))).toBe(false);
  });

  it('starts the fleets far enough apart that their hulls are clear', () => {
    const setup = roundSetup(newSkirmish(LINE_OF_BATTLE, LINE_OF_BATTLE, 5));
    const reach = fleetReach(fleetHulls(LINE_OF_BATTLE));
    expect(setup.range).toBeGreaterThan(2 * reach);
    expect(setup.fleets[0]).toBe(LINE_OF_BATTLE);
    expect(setup.seed).toBe(5);
  });

  it('fights a lost round again on the same seed, and the next on a new one', () => {
    const skirmish = newSkirmish(gunship, gunship, 5);
    const again = lost(skirmish);
    expect(again.seed).toBe(5);
    expect(again.tries).toBe(1);
    const next = nextRound(again, LINE_OF_BATTLE);
    expect(next.round).toBe(2);
    expect(next.tries).toBe(0);
    expect(next.seed).not.toBe(5);
    // The budget is the player's: the enemy's answer is not held to it.
    expect(next.budget).toEqual(skirmish.budget);
    expect(next.enemy).toBe(LINE_OF_BATTLE);
  });

  it('remembers the seed a round was won on until the next round', () => {
    const skirmish = won(newSkirmish(gunship, gunship, 5));
    expect(skirmish.won).toBe(5);
    expect(parseSkirmish(JSON.parse(JSON.stringify(serialiseSkirmish(skirmish)))).won).toBe(5);
    expect(nextRound(skirmish, gunship).won).toBeUndefined();
  });

  it('round-trips, an empty fleet and all, through a link fragment', () => {
    const skirmish = newSkirmish(LINE_OF_BATTLE, empty, 9);
    const back = handedSkirmish(skirmishFragment(skirmish));
    expect(back && serialiseSkirmish(back)).toEqual(serialiseSkirmish(skirmish));
    expect(handedSkirmish('#fleet=x')).toBeNull();
  });

  it('refuses a skirmish it cannot read', () => {
    const file = serialiseSkirmish(newSkirmish(gunship, gunship, 1));
    expect(() => parseSkirmish({ ...file, formatVersion: 2 })).toThrow(/formatVersion/);
    expect(() => parseSkirmish({ ...file, round: 0 })).toThrow(/round/);
    expect(() => parseSkirmish({ ...file, budget: { metal: -1, fuel: 0, build: 0 } })).toThrow(/budget\.metal/);
  });
});
