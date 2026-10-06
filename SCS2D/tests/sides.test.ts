import { describe, expect, it } from 'vitest';
import { Match, runMatch } from '../evolution/match.js';
import { CORVETTE, DINKY, GUNSHIP } from '../scenarios/blueprints.js';

/** Entrants given sides: allies on each, starting together, scored against the other. */

/** A match in which, every step, entrant 0 is credited with a huge hit on entrant 1. */
function withFriendlyFire(teams: number[] | null): Match {
  const match = new Match([GUNSHIP, GUNSHIP, GUNSHIP], { seed: 1, duration: 1 }, teams);
  const { battle } = match;
  const bodyOf = (k: number): number => battle.world.bodies.indexOf(battle.ships.body(battle.slots[k]!));
  const [a, b] = [battle.owners.indexOf(0), battle.owners.indexOf(1)];
  const step = battle.step.bind(battle);
  battle.step = () => {
    step();
    battle.credit.push(bodyOf(a), bodyOf(b), 1e15);
  };
  return match;
}

describe('a match between sides', () => {
  it('puts each side on its own team, clustered on the left and the right', () => {
    const match = new Match([CORVETTE, DINKY, CORVETTE, DINKY], { seed: 2, goal: null }, [0, 0, 0, 1]);
    const { ships, slots, owners, world } = match.battle;
    const side = [0, 0, 0, 1];
    slots.forEach((slot, k) => {
      expect(ships.teamOf(slot)).toBe(side[owners[k]!]);
      const body = world.bodies.indexOf(ships.body(slot));
      const x = world.bodies.x[body]!;
      const y = world.bodies.y[body]!;
      // Side A left, side B right, each within its 45° spread.
      expect(Math.sign(x)).toBe(side[owners[k]!] === 0 ? -1 : 1);
      expect(Math.abs(y / x)).toBeLessThanOrEqual(Math.tan(Math.PI / 8) + 1e-9);
    });
  });

  it('pays nothing for hitting one of its own side', () => {
    const free = withFriendlyFire(null);
    while (!free.done) free.advance();
    expect(free.result().scores[0]!.damage).toBe(0.5);

    const together = withFriendlyFire([0, 0, 1]);
    while (!together.done) together.advance();
    const [shooter] = together.result().scores;
    expect(shooter!.damage).toBe(0);
    expect(shooter!.disabling).toBe(0);
  });

  it('is decided once one side is left fighting, not one entrant', () => {
    const weights = { survival: 1, functional: 1, damage: 1, disabling: 1, race: 0 };
    const result = runMatch([GUNSHIP, GUNSHIP, GUNSHIP], { seed: 4, weights, goal: null }, [0, 0, 1]);
    expect(result.ending).toBe('decided');
    // Both of side A are still fighting: in a free-for-all they would not be done.
    expect(result.scores[0]!.survival).toBeGreaterThan(0);
    expect(result.scores[1]!.survival).toBeGreaterThan(0);
    expect(result.scores).toHaveLength(3);
  });

  it('is the same match as before without sides', () => {
    expect(runMatch([GUNSHIP, DINKY], { seed: 3 }, null)).toEqual(runMatch([GUNSHIP, DINKY], { seed: 3 }));
  });
});
