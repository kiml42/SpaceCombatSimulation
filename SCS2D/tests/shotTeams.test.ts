import { describe, expect, it } from 'vitest';
import { capture, Snapshot } from '../sim/snapshot.js';
import type { Battle } from '../scenarios/types.js';
import { beamVGun } from '../scenarios/beamVGun.js';
import { duel } from '../scenarios/duel.js';

/**
 * Which side fired each round and beam, which the picture carries so the
 * renderer can colour them by side.
 */

/** Fight, checking every picture's sides, and count the shots that had one. */
function checked(battle: Battle, steps: number): { rounds: number; beams: number } {
  const out = new Snapshot();
  let rounds = 0;
  let beams = 0;
  for (let step = 0; step < steps; step++) {
    battle.step();
    capture(out, battle.world, battle.ships, battle.projectiles, battle.beams);
    const teamOf = (body: number): number => {
      for (let s = 0; s < out.shipCount; s++) if (out.ships[s]!.body === body) return out.ships[s]!.team;
      return -1;
    };
    let p = 0;
    for (let i = 0; i < battle.projectiles.highWater; i++) {
      if (battle.projectiles.alive[i] === 0) continue;
      expect(out.projectileTeam[p++]).toBe(teamOf(battle.projectiles.owner[i]!));
      if (out.projectileTeam[p - 1]! >= 0) rounds++;
    }
    let b = 0;
    for (let i = 0; i < battle.beams.highWater; i++) {
      if (battle.beams.alive[i] === 0) continue;
      expect(out.beamTeam[b++]).toBe(teamOf(battle.beams.owner[i]!));
      if (out.beamTeam[b - 1]! >= 0) beams++;
    }
  }
  return { rounds, beams };
}

describe('the side a shot is drawn as', () => {
  it('is the side of the ship that fired a round', () => {
    expect(checked(duel(), 1500).rounds).toBeGreaterThan(0);
  });

  it('is the side of the ship that fired a beam', () => {
    expect(checked(beamVGun(), 1500).beams).toBeGreaterThan(0);
  });
});
