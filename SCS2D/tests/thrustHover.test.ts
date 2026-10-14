import { describe, expect, it } from 'vitest';
import { compileBlueprint } from '../sim/index.js';
import { CORVETTE } from '../scenarios/blueprints.js';
import { envelopes, holdingThrottles } from '../editor/stats.js';
import { envelopeBearingAt, overEnvelope } from '../editor/overlay.js';

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

  it('grows while pointed at, from its corner, and stays grown until the pointer leaves the larger one', () => {
    // At rest the rosette's centre is 70 px in from the right; grown to 160 px, 176.
    const small = { x: 1000 - 54 - 16, y: 600 - 54 - 16 - 32 };
    const large = { x: 1000 - 160 - 16, y: 600 - 160 - 16 - 32 };
    expect(overEnvelope(1000, 600, small.x, small.y)).toBe(true);
    // A point on the large one but off the small one keeps it large, and only then.
    const between = { x: large.x - 100, y: large.y };
    expect(overEnvelope(1000, 600, between.x, between.y, false)).toBe(false);
    expect(overEnvelope(1000, 600, between.x, between.y, true)).toBe(true);
    expect(envelopeBearingAt(1000, 600, large.x + 100, large.y, true)).toBeCloseTo(0, 9);
    // On a canvas too small for it, it grows only as far as there is room:
    // here half of 260 less its margins and caption, 98 px, centred at (186, 114).
    expect(overEnvelope(300, 260, 186, 114 + 97, true)).toBe(true);
    expect(overEnvelope(300, 260, 186, 114 - 99, true)).toBe(false);
  });
});
