import { describe, expect, it } from 'vitest';
import { compileBlueprint } from '../sim/index.js';
import { OrderCancelCondition } from '../sim/ships.js';
import { makeBattle } from '../scenarios/battle.js';
import { CORVETTE } from '../scenarios/blueprints.js';

/** A ram order (`Ships.pushRam`) overrides the rest of a ship's movement doctrine. */

describe('a ram order', () => {
  /** Steps until the rammer first touches a target crossing its bow, or -1. */
  function stepsToContact(ram: boolean): number {
    const corvette = compileBlueprint(CORVETTE);
    const battle = makeBattle({ seed: 4 }, (ships, world) => {
      const target = ships.spawn(world, { design: corvette, x: 0, y: 0, vy: 30, team: 0 });
      const rammer = ships.spawn(world, { design: corvette, x: 300, y: 0, angle: Math.PI, team: 1 });
      ships.clearOrder(rammer);
      ships.clearOrder(target);
      if (ram) ships.pushRam(rammer, target, 40, OrderCancelCondition.None);
      else ships.pushOrder(rammer, target, 0, 0, 40, OrderCancelCondition.None);
    });
    for (let i = 0; i < 60 * 30; i++) {
      battle.step();
      if (battle.collisions.contacts.count > 0) return i;
    }
    return -1;
  }

  it('flies into a moving target rather than braking to arrive alongside it', () => {
    expect(stepsToContact(true)).toBeGreaterThan(0);
  });

  it('hits sooner than an order to close to nothing', () => {
    const band = stepsToContact(false);
    const ram = stepsToContact(true);
    expect(band < 0 || ram < band).toBe(true);
  });
});
