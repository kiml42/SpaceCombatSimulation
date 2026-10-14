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
function fight(a: Fleet, b: Fleet, until: number): { decision: Decision | null; time: number } {
  const battle = customBattle({ fleets: [a, b], range: 1000, closingSpeed: 0, crossingSpeed: 0, rotation: 0, seed: 3 });
  const activity = new Activity(2);
  let decision: Decision | null = null;
  while (decision === null && battle.world.tick * battle.dt < until) {
    battle.step();
    decision = activity.observe(battle);
  }
  return { decision, time: battle.world.tick * battle.dt };
}

describe('deciding a skirmish battle', () => {
  it('gives it to the side still firing once the other has been quiet for 30 s', () => {
    const { decision } = fight(gunship, core, TIME_CAP);
    expect(decision?.winner).toBe(0);
    expect(decision?.reason).toBe('quiet');
    expect(decision!.time).toBeGreaterThanOrEqual(QUIET_TIME);
  });

  it('decides nothing before 30 s, however quiet', () => {
    expect(fight(core, core, QUIET_TIME - 1).decision).toBeNull();
  });

  it('calls a battle nobody fights in a draw at the time cap', { timeout: 120_000 }, () => {
    const { decision } = fight(core, core, TIME_CAP + 1);
    expect(decision).toEqual({ winner: -1, reason: 'time', time: expect.closeTo(TIME_CAP, 1) });
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
    expect(next.budget).toEqual(billOfFleet(LINE_OF_BATTLE));
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
