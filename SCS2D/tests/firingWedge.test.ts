import { describe, expect, it } from 'vitest';
import { capture, math, Snapshot } from '../sim/index.js';
import { duel } from '../scenarios/duel.js';

/** What a battle tells the renderer about where each gun will fire. */

describe('a gun’s firing wedge in battle', () => {
  it('reaches as far as the gun is worth shooting at what it aims at, and holds its barrel when it is ready', () => {
    const battle = duel(20260905);
    const snapshot = new Snapshot();
    let aiming = 0;
    let ready = 0;
    for (let step = 0; step < 900; step++) {
      battle.step();
      capture(snapshot, battle.world, battle.ships, battle.projectiles, battle.beams, battle.wells);
      for (let s = 0; s < snapshot.shipCount; s++) {
        const view = snapshot.ships[s]!;
        for (let t = 0; t < view.turretBearings.length; t++) {
          if (view.turretTriggerReach![t]! <= 0) continue;
          aiming++;
          if (!view.turretReady[t]) continue;
          ready++;
          const off = Math.abs(math.angleDelta(view.turretBearings[t]!, view.turretAim![t]!));
          expect(off).toBeLessThanOrEqual(view.turretTrigger![t]! + 1e-9);
          expect(view.turretFouled![t]).toBe(false);
        }
      }
    }
    expect(aiming).toBeGreaterThan(0);
    expect(ready).toBeGreaterThan(0);
  });
});
