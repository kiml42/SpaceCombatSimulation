import { describe, expect, it } from 'vitest';
import { fleetBill, fleetHulls, serialiseFleet, shipFleet } from '../sim/index.js';
import { fleetFits } from '../evolution/fleetMutate.js';
import { CORVETTE, GUNSHIP } from '../scenarios/blueprints.js';
import { customBattle } from '../scenarios/customBattle.js';
import { Activity, type Decision } from '../scenarios/decision.js';
import { roundBattle } from '../scenarios/skirmish.js';
import { EnemySearch } from '../evolution/answer.js';

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
  it('starts from an enemy the player beat on the seed it was won on', () => {
    expect(decide().winner).toBe(0);
  });

  it('finds an enemy that beats the player on that seed, to the skirmish decision', { timeout: 120_000 }, () => {
    // A mirror the player won is the quickest to answer: a Gunship is a long way past a Corvette.
    expect(decide(corvette, corvette, MIRROR_WON).winner).toBe(0);
    const answering = new EnemySearch(corvette, corvette, MIRROR_WON, 11);
    for (let slice = 0; slice < 200 && !answering.advance(5000); slice++);
    const found = answering.progress.found;
    expect(found).not.toBeNull();
    expect(decide(corvette, found!, MIRROR_WON).winner).toBe(1);
  });

  it('is decided by its seed', { timeout: 120_000 }, () => {
    // A fixed amount of work rather than a whole search, so the test costs the same on any seed.
    const run = (): EnemySearch => {
      const going = new EnemySearch(gunship, corvette, WON, 3);
      going.advance(15_000);
      return going;
    };
    const a = run().progress;
    const b = run().progress;
    expect(a.generation).toBeGreaterThan(0);
    expect(b.generation).toBe(a.generation);
    expect(serialiseFleet(b.best.enemy)).toEqual(serialiseFleet(a.best.enemy));
    expect(b.best.margin).toBe(a.best.margin);
  });

  it('reports each generation as it finishes', () => {
    const running = new EnemySearch(gunship, corvette, WON, 5);
    expect(running.progress.generation).toBe(0);
    while (running.progress.generation === 0 && !running.advance(1000));
    expect(running.progress.generation).toBeGreaterThanOrEqual(1);
    expect(running.progress.seeds).toBe(3);
  });
});

describe('how far an answer may grow', () => {
  it('to half as much again as the enemy, and one ship more', () => {
    const running = new EnemySearch(gunship, corvette, WON, 5);
    const bill = fleetBill(fleetHulls(corvette));
    expect(running.limits.budget.metal).toBeCloseTo(bill.metal * 1.5);
    expect(running.limits.budget.build).toBeCloseTo(bill.build * 1.5);
    expect(running.limits.maxShips).toBe(2);
  });

  it('to no more ships than the skirmish allows, unless it had more', () => {
    expect(new EnemySearch(gunship, corvette, WON, 5, { maxShips: 1 }).limits.maxShips).toBe(1);
    expect(new EnemySearch(gunship, corvette, WON, 5, { maxShips: 0 }).limits.maxShips).toBe(1);
  });

  it('keeps every enemy it breeds within that', () => {
    const running = new EnemySearch(gunship, corvette, WON, 5, { stretchAfter: 1000 });
    for (let i = 0; i < 3 && !running.advance(5_000); i++) {
      const best = running.progress.found ?? running.progress.best.enemy;
      expect(fleetFits(best, { ...running.limits, radius: Infinity })).toBe(true);
    }
  });

  it('stretches by as much again after long enough without an answer', () => {
    const running = new EnemySearch(gunship, corvette, WON, 5, { stretchAfter: 1 });
    expect(running.progress.stretch).toBe(1);
    while (running.progress.generation < 2 && !running.advance(1000));
    if (running.progress.found !== null) return;
    expect(running.progress.stretch).toBe(3);
    const bill = fleetBill(fleetHulls(corvette));
    expect(running.limits.budget.metal).toBeCloseTo(bill.metal * 1.5 * 1.5 * 1.5);
    expect(running.limits.maxShips).toBe(4);
  });
});

describe('how the enemy is bred', () => {
  it('breeds by the mutation odds it is given', () => {
    // Only moves: every mutant keeps the enemy's designs and its ships.
    const only = { opDesign: 0, opAdd: 0, opRemove: 0, opFork: 0, opMerge: 0, opSwap: 0, opMove: 1 };
    const search = new EnemySearch(gunship, corvette, MIRROR_WON, 4, { mutants: 3, seeds: 1, duration: 20, breeding: only });
    while (search.progress.generation < 1 && !search.advance(2000));
    const best = search.progress.best.enemy;
    expect(best.designs).toEqual(corvette.designs);
    expect(best.ships).toHaveLength(corvette.ships.length);
  });
});
