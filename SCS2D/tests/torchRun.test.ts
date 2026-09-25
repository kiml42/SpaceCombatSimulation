import { describe, expect, it } from 'vitest';
import { compileBlueprint } from '../sim/index.js';
import { GUNSHIP } from '../scenarios/blueprints.js';
import { torchRun } from '../scenarios/torchRun.js';

/**
 * The torch ships' hit and run, as it comes out of doctrine and a bow engine
 * rather than out of any rule for it: each goes in to where its flame burns,
 * is shoved back out by the same flame, and comes in again.
 */
describe('a torch run', () => {
  const battle = torchRun();
  const bodies = battle.world.bodies;
  const { torches, target } = battle;

  const IN = 60;
  const OUT = 120;
  /** Separate passes each torch makes: in under IN metres, then out past OUT. */
  const passes = torches.map(() => 0);
  const inside = torches.map(() => false);
  for (let step = 0; step < 90 * 60; step++) {
    battle.step();
    const g = bodies.indexOf(battle.ships.body(target));
    torches.forEach((t, k) => {
      const a = bodies.indexOf(battle.ships.body(t));
      if (a < 0 || g < 0 || !battle.ships.hasControl(t)) return;
      const distance = Math.hypot(bodies.x[a]! - bodies.x[g]!, bodies.y[a]! - bodies.y[g]!);
      if (!inside[k] && distance < IN) inside[k] = true;
      else if (inside[k] && distance > OUT) {
        inside[k] = false;
        passes[k]!++;
      }
    });
  }

  it('burns the gunship', () => {
    const g = bodies.indexOf(battle.ships.body(target));
    let worst = 1;
    const modules = compileBlueprint(GUNSHIP).modules.length;
    for (let m = 0; m < modules; m++) worst = Math.min(worst, battle.ships.damage.integrity(g, m));
    expect(worst).toBeLessThan(1);
  });

  it('goes in and comes back out, more than once', () => {
    expect(Math.max(...passes)).toBeGreaterThanOrEqual(2);
  });
});
