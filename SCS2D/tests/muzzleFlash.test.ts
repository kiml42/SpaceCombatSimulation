import { describe, expect, it } from 'vitest';
import { IMPACT_MUZZLE } from '../sim/index.js';
import { duel } from '../scenarios/duel.js';

describe('a gun firing', () => {
  it('logs a muzzle flash on a hull for every round', () => {
    const battle = duel();
    const log = battle.impacts.log;
    let muzzles = 0;
    for (let step = 0; step < 60 * 30; step++) {
      battle.step();
      for (let i = 0; i < log.count; i++) {
        if (log.kind[i] !== IMPACT_MUZZLE) continue;
        muzzles++;
        expect(log.body[i]).toBeGreaterThanOrEqual(0);
        expect(log.energy[i]).toBeGreaterThan(0);
      }
      log.clear();
    }
    expect(battle.totalProjectilesFired).toBeGreaterThan(0);
    expect(muzzles).toBe(battle.totalProjectilesFired);
  });
});
