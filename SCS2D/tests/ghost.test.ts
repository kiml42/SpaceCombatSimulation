import { describe, expect, it } from 'vitest';
import { compileBlueprint, NEUTRAL_TEAM, type Blueprint } from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import { CORVETTE } from '../scenarios/blueprints.js';

/**
 * A ghost: a ship that is there to be flown to and nothing else. Nothing runs
 * into it, nothing it stands in front of is sheltered by it, and nothing moves
 * it — which is what lets two ships either side of a goal still fight.
 */

const marker: Blueprint = {
  name: 'Goal',
  modules: [{ kind: 'core', x: 0, y: 0, length: 12, width: 12 }],
};

function scene(ghost: boolean, wells: { x: number; y: number; gm: number }[] = []) {
  return makeBattle({ seed: 1, pilots: false, wells }, (ships, world) => ({
    marker: ships.spawn(world, {
      design: compileBlueprint(marker),
      team: NEUTRAL_TEAM,
      invulnerable: true,
      ghost,
    }),
  }));
}

const where = (battle: ReturnType<typeof scene>, ship: number) => {
  const b = battle.world.bodies.indexOf(battle.ships.body(ship));
  return [battle.world.bodies.x[b]!, battle.world.bodies.y[b]!];
};

describe('a ghost', () => {
  it('is flown through, where a solid marker is run into', () => {
    for (const ghost of [false, true]) {
      const battle = scene(ghost);
      battle.ships.spawn(battle.world, { design: compileBlueprint(CORVETTE), x: -60, y: 0, vx: 30 });
      let contacts = 0;
      for (let i = 0; i < 300; i++) {
        battle.step();
        contacts += battle.collisions.contacts.count;
      }
      if (ghost) {
        expect(contacts).toBe(0);
        expect(where(battle, battle.marker)).toEqual([0, 0]);
      } else {
        expect(contacts).toBeGreaterThan(0);
      }
    }
  });

  it('lets a round through, where a solid marker stops it', () => {
    for (const ghost of [false, true]) {
      const battle = scene(ghost);
      const markerBody = battle.world.bodies.indexOf(battle.ships.body(battle.marker));
      battle.projectiles.spawn({ x: -100, y: 0, vx: 900, vy: 0, width: 0.1, ttl: 1, mass: 1 });
      let struck = 0;
      for (let i = 0; i < 20; i++) {
        battle.step();
        for (let h = 0; h < battle.hits.count; h++) if (battle.hits.body[h] === markerBody) struck++;
      }
      expect(struck).toBe(ghost ? 0 : 1);
    }
  });

  it('is not moved by gravity', () => {
    const battle = scene(true, [{ x: 200, y: 0, gm: 1e7 }]);
    for (let i = 0; i < 120; i++) battle.step();
    expect(where(battle, battle.marker)).toEqual([0, 0]);
  });
});
