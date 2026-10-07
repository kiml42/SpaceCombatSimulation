import { describe, expect, it } from 'vitest';
import { capture, Snapshot } from '../sim/snapshot.js';
import { duel } from '../scenarios/duel.js';

describe('what a ship in the picture is fighting', () => {
  it('is the body of the ship it has taken on, on another side', () => {
    const battle = duel();
    for (let s = 0; s < 120; s++) battle.step();
    const { ships, world } = battle;
    const out = capture(new Snapshot(), world, ships, battle.projectiles, battle.beams);
    let fighting = 0;
    for (let i = 0; i < ships.highWater; i++) {
      if (!ships.isAlive(i)) continue;
      const view = out.ships.slice(0, out.shipCount).find((v) => v.body === world.bodies.indexOf(ships.body(i)))!;
      const target = ships.fightingOf(i);
      if (target < 0) {
        expect(view.fighting).toBe(-1);
        continue;
      }
      fighting++;
      expect(view.fighting).toBe(world.bodies.indexOf(ships.body(target)));
      expect(ships.teamOf(target)).not.toBe(ships.teamOf(i));
    }
    expect(fighting).toBeGreaterThan(0);
  });
});
