import { describe, expect, it } from 'vitest';
import { capture, Snapshot } from '../sim/index.js';
import { duel } from '../scenarios/duel.js';

/** Steps of the duel, one at a time, until `count` says something was logged. */
function stepUntilLogged(battle: ReturnType<typeof duel>, count: () => number): void {
  for (let i = 0; i < 60 * 60 && count() === 0; i++) battle.step();
  expect(count()).toBeGreaterThan(0);
}

describe('the impact log', () => {
  it('holds only the last step’s impacts while nothing drains it', () => {
    const battle = duel();
    const log = battle.impacts.log;
    stepUntilLogged(battle, () => log.count);
    // A later step that logs nothing leaves it empty, rather than carrying the hit along.
    let quiet = 0;
    for (let i = 0; i < 600 && quiet < 1; i++) {
      battle.step();
      if (log.count === 0) quiet++;
    }
    expect(quiet).toBe(1);
  });

  it('keeps every step’s impacts between captures once a viewer drains it', () => {
    const battle = duel();
    const log = battle.impacts.log;
    const snapshot = new Snapshot();
    const take = () =>
      capture(snapshot, battle.world, battle.ships, battle.projectiles, battle.beams, battle.wells, log);
    take();
    stepUntilLogged(battle, () => log.count);
    const logged = log.count;
    // A step with nothing new keeps what an earlier step logged for the next frame.
    battle.step();
    expect(log.count).toBeGreaterThanOrEqual(logged);
    take();
    expect(snapshot.impactCount).toBeGreaterThanOrEqual(logged);
    expect(log.count).toBe(0);
  });
});
