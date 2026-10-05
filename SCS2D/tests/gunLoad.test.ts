import { describe, expect, it } from 'vitest';
import { capture, Snapshot } from '../sim/index.js';
import { duel } from '../scenarios/duel.js';
import { beamVGun } from '../scenarios/beamVGun.js';

/** What a battle tells the renderer about how loaded each gun is. */

describe('a gun’s load in battle', () => {
  it('fills while a gun reloads, and is full when it is not', () => {
    const battle = duel(20260905);
    const snapshot = new Snapshot();
    const last = new Map<string, number>();
    let reloads = 0;
    for (let step = 0; step < 900; step++) {
      battle.step();
      capture(snapshot, battle.world, battle.ships, battle.projectiles, battle.beams, battle.wells);
      for (let s = 0; s < snapshot.shipCount; s++) {
        const view = snapshot.ships[s]!;
        for (let t = 0; t < view.turretLoad!.length; t++) {
          const key = `${view.body}:${t}`;
          const load = view.turretLoad![t]!;
          const was = last.get(key) ?? 1;
          expect(load).toBeGreaterThanOrEqual(0);
          expect(load).toBeLessThanOrEqual(1);
          // A gun that finishes loading and fires again within a step starts
          // its next reload without ever showing full.
          if (!view.turretReloading![t]) expect(load).toBe(1);
          else if (load < was) reloads++;
          last.set(key, load);
        }
      }
    }
    expect(reloads).toBeGreaterThan(0);
  });

  it('empties while a beam fires', () => {
    const battle = beamVGun();
    const snapshot = new Snapshot();
    let firing = 0;
    for (let step = 0; step < 1500; step++) {
      battle.step();
      capture(snapshot, battle.world, battle.ships, battle.projectiles, battle.beams, battle.wells);
      const view = snapshot.ships[0]!;
      for (let t = 0; t < view.turretLoad!.length; t++) {
        if (!view.turretReloading![t] && view.turretLoad![t]! < 1) firing++;
      }
    }
    expect(firing).toBeGreaterThan(0);
  });
});
