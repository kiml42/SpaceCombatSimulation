import { describe, expect, it } from 'vitest';
import { IMPERIAL_FLEET, REBEL_FLEET } from '../scenarios/fleets.js';
import { battleFragment, linkedBattle } from '../scenarios/battleLink.js';
import { DEFAULT_SETUP, serialiseBattleSetup, type BattleSetup } from '../scenarios/customBattle.js';
import type { Logged } from '../scenarios/commands.js';
import { OrderCancelCondition } from '../sim/ships.js';

const setup: BattleSetup = { ...DEFAULT_SETUP, fleets: [IMPERIAL_FLEET, REBEL_FLEET], seed: 1234, rotation: 0.5 };

describe('a battle carried in a link', () => {
  it('comes back as the battle it was', async () => {
    const back = await linkedBattle(await battleFragment(setup));
    expect(back).not.toBeNull();
    expect(serialiseBattleSetup(back!.setup)).toEqual(serialiseBattleSetup(setup));
    expect(back!.orders).toEqual([]);
  });

  it('carries the orders given in it', async () => {
    const orders: Logged[] = [
      {
        step: 0,
        command: {
          kind: 'order',
          ships: [0, 1],
          order: { kind: 'attack', target: 5, cancelOn: OrderCancelCondition.CompleteDisable },
          append: false,
        },
      },
      { step: 120, command: { kind: 'stop', ships: [1] } },
    ];
    const back = await linkedBattle(await battleFragment(setup, orders));
    expect(back!.orders).toEqual(orders);
  });

  it('is a third the size of the file it carries, in characters a link keeps as they are', async () => {
    const fragment = await battleFragment(setup);
    expect(fragment).toMatch(/^#battle=[\w-]+$/);
    expect(fragment.length).toBeLessThan(JSON.stringify(serialiseBattleSetup(setup)).length / 2);
  });

  it('is nothing for a link that carries no battle, and an error for one it cannot read', async () => {
    expect(await linkedBattle('')).toBeNull();
    expect(await linkedBattle('#fleet=%7B%7D')).toBeNull();
    await expect(linkedBattle('#battle=not-a-battle')).rejects.toThrow();
  });
});
