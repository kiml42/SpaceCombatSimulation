import { describe, expect, it } from 'vitest';
import { compileBlueprint } from '../sim/index.js';
import { CORVETTE } from '../scenarios/blueprints.js';
import { envelopes, holdingThrottles } from '../editor/stats.js';
import { envelopeBearingAt } from '../editor/overlay.js';

describe('the throttles behind a point on the envelope', () => {
  const corvette = compileBlueprint(CORVETTE);

  /** What the throttles push the ship with: force, and torque about the centre of mass. */
  function wrench(throttles: Float64Array): { fx: number; fy: number; torque: number } {
    let fx = 0;
    let fy = 0;
    let torque = 0;
    corvette.engines.forEach((engine, t) => {
      const f = engine.maxThrust * (throttles[t] ?? 0);
      fx += engine.dirX * f;
      fy += engine.dirY * f;
      torque += engine.x * engine.dirY * f - engine.y * engine.dirX * f;
    });
    return { fx, fy, torque };
  }

  it('pushes the way asked, as hard as the holding curve says, without turning', () => {
    const curve = envelopes(corvette, 8);
    for (let i = 0; i < 8; i++) {
      const angle = (2 * Math.PI * i) / 8;
      const { fx, fy, torque } = wrench(holdingThrottles(corvette, angle));
      const force = Math.hypot(fx, fy);
      expect(force / corvette.mass).toBeCloseTo(curve.holding[i]!, 1);
      if (force > 0) {
        expect(Math.abs(Math.atan2(fy, fx) - Math.atan2(Math.sin(angle), Math.cos(angle))) % (2 * Math.PI)).toBeLessThan(0.05);
        expect(Math.abs(torque) / (force * corvette.radius)).toBeLessThan(0.02);
      }
    }
  });

  it('is read off the widget only where the widget is', () => {
    // The rosette sits in the bottom right, 54 px across its radius.
    const cx = 1000 - 54 - 16;
    const cy = 600 - 54 - 16 - 32;
    expect(envelopeBearingAt(1000, 600, cx + 30, cy)).toBeCloseTo(0, 9);
    expect(envelopeBearingAt(1000, 600, cx, cy - 30)).toBeCloseTo(Math.PI / 2, 9);
    expect(envelopeBearingAt(1000, 600, 100, 100)).toBeNull();
  });
});
