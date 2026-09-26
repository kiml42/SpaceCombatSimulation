import { describe, expect, it } from 'vitest';
import { serialiseFleet, type Fleet } from '../sim/index.js';
import { DINKY } from '../scenarios/blueprints.js';
import { LINE_OF_BATTLE } from '../scenarios/fleets.js';
import {
  battleSetupProblem,
  customBattle,
  parseBattleSetup,
  serialiseBattleSetup,
  tally,
  winner,
  type BattleSetup,
} from '../scenarios/customBattle.js';

const lone: Fleet = { name: 'Lone', designs: { Dinky: DINKY }, ships: [{ design: 'Dinky', x: 0, y: 0 }] };
const setup: BattleSetup = { fleets: [LINE_OF_BATTLE, lone], range: 1000, closingSpeed: 20, crossingSpeed: -5, seed: 7 };

describe('the battle file', () => {
  it('round-trips a setup', () => {
    const file = serialiseBattleSetup(setup);
    expect(serialiseBattleSetup(parseBattleSetup(JSON.parse(JSON.stringify(file))))).toEqual(file);
  });

  it.each([
    ['one fleet', { fleets: [serialiseFleet(LINE_OF_BATTLE)] }, /at least two/],
    ['no range', { range: 0 }, /range must be greater/],
    ['a fractional seed', { seed: 1.5 }, /whole number/],
  ])('refuses %s', (_what, change, message) => {
    const file = { ...serialiseBattleSetup(setup), ...change };
    expect(battleSetupProblem(file)).toMatch(message);
  });

  it('refuses an unreadable fleet, naming which', () => {
    const file = serialiseBattleSetup(setup);
    (file['fleets'] as unknown[])[1] = { formatVersion: 1, name: 'Broken' };
    expect(battleSetupProblem(file)).toMatch(/^fleets\[1\]/);
  });
});

describe('a custom battle', () => {
  it('starts with every side whole and armed', () => {
    const battle = customBattle(setup);
    expect(battle.start.map((side) => [side.ships, side.armed])).toEqual([
      [5, 5],
      [1, 1],
    ]);
    expect(tally(battle, 2)).toEqual(battle.start);
    expect(winner(battle.start)).toBeNull();
  });

  it('is decided once only one side can still fight', () => {
    const battle = customBattle({ ...setup, closingSpeed: 0, crossingSpeed: 0 });
    let result: number | null = null;
    for (let step = 0; step < 60 * 60 && result === null; step++) {
      battle.step();
      result = winner(tally(battle, 2));
    }
    expect(result).toBe(0);
  });

  it('calls it for nobody when no side can fight on', () => {
    expect(winner([{ team: 0, ships: 1, mass: 1, armed: 0 }, { team: 1, ships: 2, mass: 1, armed: 0 }])).toBe(-1);
    expect(winner([{ team: 0, ships: 1, mass: 1, armed: 1 }, { team: 1, ships: 2, mass: 1, armed: 1 }])).toBeNull();
  });
});
