import { describe, expect, it } from 'vitest';
import { type Fleet } from '../sim/index.js';
import { DINKY } from '../scenarios/blueprints.js';
import { LINE_OF_BATTLE } from '../scenarios/fleets.js';
import {
  battleSetupProblem,
  customBattle,
  drawnSetup,
  parseBattleSetup,
  serialiseBattleSetup,
  tally,
  winner,
  type BattleSetup,
} from '../scenarios/customBattle.js';

const lone: Fleet = { name: 'Lone', designs: { Dinky: DINKY }, ships: [{ design: 'Dinky', x: 0, y: 0 }] };
const setup: BattleSetup = { fleets: [LINE_OF_BATTLE, lone], range: 1000, closingSpeed: 20, crossingSpeed: -5, rotation: 0, seed: 7 };

describe('the battle file', () => {
  it('round-trips a setup', () => {
    const file = serialiseBattleSetup(setup);
    expect(serialiseBattleSetup(parseBattleSetup(JSON.parse(JSON.stringify(file))))).toEqual(file);
  });

  it('round-trips a rotation, in degrees in the file', () => {
    const file = serialiseBattleSetup({ ...setup, rotation: Math.PI / 2 });
    expect(file['rotation']).toBe(90);
    expect(parseBattleSetup(JSON.parse(JSON.stringify(file))).rotation).toBeCloseTo(Math.PI / 2, 12);
  });

  it('leaves rotation out of a file with none, so older files read the same', () => {
    const file = serialiseBattleSetup(setup);
    expect('rotation' in file).toBe(false);
    expect(parseBattleSetup(file).rotation).toBe(0);
  });

  it.each([
    ['a rotation that is not a number', { rotation: 'left' }, /rotation must be a finite number/],
    ['no fleets', { fleets: [] }, /at least one/],
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
    expect(battle.start.map((side) => [side.ships, side.armed, side.mobile])).toEqual([
      [5, 5, 5],
      [1, 1, 1],
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
    expect(winner([{ team: 0, ships: 1, mass: 1, armed: 0, mobile: 1 }, { team: 1, ships: 2, mass: 1, armed: 0, mobile: 0 }])).toBe(-1);
    expect(winner([{ team: 0, ships: 1, mass: 1, armed: 1, mobile: 1 }, { team: 1, ships: 2, mass: 1, armed: 1, mobile: 1 }])).toBeNull();
  });
});

describe('a battle with a spread', () => {
  const base = { fleets: [LINE_OF_BATTLE], range: 2000, closingSpeed: 10, crossingSpeed: 0, rotation: 0, seed: 1 };
  const spread = { ...base, spread: { range: 500, closingSpeed: 5, rotation: Math.PI / 4 } };

  it('is the battle as set where nothing spreads', () => {
    expect(drawnSetup(base)).toBe(base);
    expect(drawnSetup({ ...base, spread: { range: 0 } })).toEqual({ ...base, spread: { range: 0 } });
  });

  it('draws each figure within its spread, by the seed', () => {
    const ranges = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const drawn = drawnSetup({ ...spread, seed });
      expect(Math.abs(drawn.range - 2000)).toBeLessThanOrEqual(500);
      expect(Math.abs(drawn.closingSpeed - 10)).toBeLessThanOrEqual(5);
      expect(drawn.crossingSpeed).toBe(0);
      expect(Math.abs(drawn.rotation)).toBeLessThanOrEqual(Math.PI / 4);
      expect(drawnSetup({ ...spread, seed })).toEqual(drawn);
      ranges.add(drawn.range);
    }
    expect(ranges.size).toBeGreaterThan(30);
  });

  it('is kept by the battle file, in degrees, and left out where nothing spreads', () => {
    const file = serialiseBattleSetup(spread) as Record<string, unknown>;
    expect(file['spread']).toEqual({ range: 500, closingSpeed: 5, rotation: 45 });
    const back = parseBattleSetup(JSON.parse(JSON.stringify(file)));
    expect(back.spread?.rotation).toBeCloseTo(Math.PI / 4, 12);
    expect(serialiseBattleSetup(back)).toEqual(file);
    expect(serialiseBattleSetup({ ...base, spread: { range: 0 } })['spread']).toBeUndefined();
    expect(battleSetupProblem({ ...file, spread: { range: -1 } })).toMatch(/spread.range must not be negative/);
    expect(battleSetupProblem({ ...file, spread: { size: 1 } })).toMatch(/unknown key size/);
  });
});
