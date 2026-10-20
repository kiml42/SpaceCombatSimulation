import { describe, expect, it } from 'vitest';
import { checksumWorld } from '../sim/checksum.js';
import { OrderCancelCondition } from '../sim/ships.js';
import { duel } from '../scenarios/duel.js';
import { give, parseLog, type Command } from '../scenarios/commands.js';
import { Rewind } from '../scenarios/rewind.js';

/** In the duel, ships 0 and 1 are one side and ship 2 the other. */
const RAM: Command = { kind: 'order', ships: [0], order: { kind: 'ram', target: 2 }, append: false };
const ATTACK: Command = {
  kind: 'order',
  ships: [2],
  order: { kind: 'attack', target: 0, cancelOn: OrderCancelCondition.CompletelyDead },
  append: false,
};

/** The duel stepped to `to`, given each command at its step. */
const fought = (to: number, given: readonly { step: number; command: Command }[]): number => {
  const battle = duel();
  for (let step = 0; step < to; step++) {
    for (const entry of given) if (entry.step === step) give(battle, entry.command);
    battle.step();
  }
  return checksumWorld(battle.world);
};

describe('orders as logged commands', () => {
  it('play as if given to the battle directly, and change it', () => {
    const rewind = new Rewind(duel());
    rewind.seek(100);
    rewind.issue(RAM);
    rewind.seek(400);
    expect(checksumWorld(rewind.battle.world)).toBe(fought(400, [{ step: 100, command: RAM }]));
    expect(checksumWorld(rewind.battle.world)).not.toBe(fought(400, []));
  });

  it('are given again when a rewind steps back through them', () => {
    const rewind = new Rewind(duel());
    rewind.seek(100);
    rewind.issue(RAM);
    rewind.seek(400);
    const straight = checksumWorld(rewind.battle.world);
    rewind.seek(40);
    rewind.seek(400);
    expect(checksumWorld(rewind.battle.world)).toBe(straight);
    // And landing exactly on the step it was given at.
    rewind.seek(100);
    expect(rewind.battle.ships.orderCount(0)).toBe(1);
  });

  it('throw away everything after a new one given in the past', () => {
    const rewind = new Rewind(duel());
    rewind.seek(200);
    rewind.issue(RAM);
    rewind.seek(400);
    rewind.seek(60);
    rewind.issue(ATTACK);
    expect(rewind.reached).toBe(60);
    expect(rewind.orders).toEqual([{ step: 60, command: ATTACK }]);
    rewind.seek(400);
    expect(checksumWorld(rewind.battle.world)).toBe(fought(400, [{ step: 60, command: ATTACK }]));
  });

  it('carry into a battle built afresh, as a link carries them', () => {
    const rewind = new Rewind(duel());
    rewind.issue(ATTACK);
    rewind.seek(150);
    rewind.issue(RAM);
    rewind.seek(400);
    const carried = new Rewind(duel(), undefined, parseLog(JSON.parse(JSON.stringify(rewind.orders))));
    carried.seek(400);
    expect(checksumWorld(carried.battle.world)).toBe(checksumWorld(rewind.battle.world));
  });

  it('refuse a log they cannot read', () => {
    expect(() => parseLog([{ step: 3, command: { kind: 'order', ships: [0], order: { kind: 'fly' } } }])).toThrow();
    expect(() => parseLog([{ step: -1, command: { kind: 'stop', ships: [0] } }])).toThrow();
    expect(parseLog([{ step: 3, command: { kind: 'stop', ships: [0] } }])).toHaveLength(1);
  });

  it('pass over an order that makes no sense for a ship, and stop clears the rest', () => {
    const battle = duel();
    give(battle, { kind: 'order', ships: [0, 1, 2], order: { kind: 'defend', target: 0 }, append: false });
    // Ship 0 cannot defend itself, and ship 2 will not defend an enemy.
    expect([0, 1, 2].map((i) => battle.ships.orderCount(i))).toEqual([0, 1, 0]);
    give(battle, { kind: 'order', ships: [1], order: { kind: 'attack', target: 0, cancelOn: OrderCancelCondition.CompletelyDead }, append: false });
    expect(battle.ships.orderCount(1)).toBe(1);
    give(battle, ATTACK);
    give(battle, { ...ATTACK, append: true } as Command);
    expect(battle.ships.orderCount(2)).toBe(2);
    give(battle, ATTACK);
    expect(battle.ships.orderCount(2)).toBe(1);
    give(battle, { kind: 'stop', ships: [2] });
    expect(battle.ships.orderCount(2)).toBe(0);
  });
});
