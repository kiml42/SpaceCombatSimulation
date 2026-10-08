import { describe, expect, it } from 'vitest';
import { compileBlueprint, DEFAULT_DOCTRINE, type Blueprint, type Doctrine } from '../sim/index.js';
import { OrderCancelCondition } from '../sim/ships.js';
import { makeBattle } from '../scenarios/battle.js';
import { BARE_CORE, BROADSIDE } from '../scenarios/blueprints.js';

/** `blueprint` with its approach doctrine changed by `approach`. */
function withApproach(blueprint: Blueprint, approach: Partial<Doctrine['approach']>): Blueprint {
  const doctrine = blueprint.doctrine ?? DEFAULT_DOCTRINE;
  return { ...blueprint, doctrine: { ...doctrine, approach: { ...doctrine.approach, ...approach } } };
}

/**
 * A Broadside settled in its band, holding its guns on, with a core coming up
 * from astern to pass 10 m off at 13 s: where it is, x and y, at `seconds`.
 */
function sidestep(approach: Partial<Doctrine['approach']>, seconds: number): { x: number; y: number } {
  const run = makeBattle({ seed: 4 }, (ships, world) => {
    const design = compileBlueprint(withApproach(BROADSIDE, { burnWeight: 0, ...approach }));
    const mine = ships.spawn(world, { design, x: 0, y: 0, angle: Math.PI / 2, team: 0 });
    const them = ships.spawn(world, { design: compileBlueprint(BARE_CORE), x: 500, y: 0, team: 1 });
    ships.spawn(world, { design: compileBlueprint(BARE_CORE), x: 10, y: -1300, vy: 100, team: 0 });
    ships.clearOrder(mine);
    ships.pushOrder(mine, them, 300, 600, 150, OrderCancelCondition.None);
    return { mine, them };
  });
  for (let s = 0; s < seconds * 60; s++) run.step();
  const b = run.world.bodies.indexOf(run.ships.body(run.mine));
  return { x: run.world.bodies.x[b]!, y: run.world.bodies.y[b]! };
}

describe("a pilot's own doctrine", () => {
  it('corrects its velocity as quickly as its response time says', () => {
    const speed = (responseTime: number): number => {
      const run = makeBattle({ seed: 4 }, (ships, world) => {
        const design = compileBlueprint(withApproach(BROADSIDE, { burnWeight: 0, responseTime }));
        const mine = ships.spawn(world, { design, x: 0, y: 0, team: 0 });
        const them = ships.spawn(world, { design: compileBlueprint(BARE_CORE), x: 3000, y: 0, team: 1 });
        ships.clearOrder(mine);
        ships.pushOrder(mine, them, 300, 500, 10, OrderCancelCondition.None);
        return { mine, them };
      });
      for (let s = 0; s < 60; s++) run.step();
      const b = run.world.bodies.indexOf(run.ships.body(run.mine));
      return Math.hypot(run.world.bodies.vx[b]!, run.world.bodies.vy[b]!);
    };
    expect(speed(1)).toBeGreaterThan(speed(4) * 1.5);
  });

  it('starts to dodge only within the time it looks ahead', () => {
    // Two seconds before the pass: looking six seconds ahead it is already
    // moving off its spot, looking one it has not started.
    const far = sidestep({ avoidHorizon: 6 }, 11);
    const near = sidestep({ avoidHorizon: 1 }, 11);
    expect(Math.hypot(far.x, far.y)).toBeGreaterThan(Math.hypot(near.x, near.y) + 1);
  });

  it('dodges further the faster it asks to go', () => {
    const hard = sidestep({ dodgeSpeed: 120 }, 15);
    const soft = sidestep({ dodgeSpeed: 20 }, 15);
    expect(Math.hypot(hard.x, hard.y)).toBeGreaterThan(Math.hypot(soft.x, soft.y) + 1);
  });
});
