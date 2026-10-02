import { describe, expect, it } from 'vitest';
import { capture, engineGeometry, math, Snapshot, weaponPlumeReach } from '../sim/index.js';
import { duel } from '../scenarios/duel.js';
import { torchRun } from '../scenarios/torchRun.js';
import { nextArcs } from '../render/canvas2d.js';

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

describe('an engine’s firing wedge in battle', () => {
  it('is the weapon engine’s, at its full flame, and lights when the engine burns as a weapon', () => {
    const battle = torchRun();
    const snapshot = new Snapshot();
    let firing = 0;
    for (let step = 0; step < 60 * 60 && firing < 60; step++) {
      battle.step();
      capture(snapshot, battle.world, battle.ships, battle.projectiles, battle.beams, battle.wells);
      for (let s = 0; s < snapshot.shipCount; s++) {
        const view = snapshot.ships[s]!;
        const engines = view.design.engines;
        for (let t = 0; t < engines.length; t++) {
          const reach = view.engineTriggerReach![t]!;
          if (engines[t]!.weapon !== true) {
            expect(reach).toBe(0);
            expect(view.engineFiring![t]).toBe(false);
            continue;
          }
          const spec = view.design.modules[engines[t]!.module!]!.spec;
          expect(reach).toBeLessThanOrEqual(weaponPlumeReach(engineGeometry(spec), engines[t]!.maxThrust) + 1e-9);
          if (!view.engineFiring![t]) continue;
          firing++;
          expect(reach).toBeGreaterThan(0);
          expect(view.throttles[t]).toBeGreaterThan(0);
        }
      }
    }
    expect(firing).toBeGreaterThan(0);
  }, 30_000);
});

describe('the arcs drawn', () => {
  it('cycle from none, to where guns can point, to where they will fire, and back', () => {
    expect(nextArcs('none')).toBe('firing');
    expect(nextArcs('firing')).toBe('trigger');
    expect(nextArcs('trigger')).toBe('none');
  });
});
