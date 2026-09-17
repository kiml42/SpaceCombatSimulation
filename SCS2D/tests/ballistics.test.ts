import { describe, expect, it } from 'vitest';
import {
  DE_MARRE_K,
  RICOCHET_ANGLE,
  Terminal,
  deflected,
  incidenceAngle,
  strike,
} from '../sim/ballistics.js';
import { math } from '../sim/index.js';

/**
 * What happens where a round meets a plate.
 *
 * The law is de Marre and its exponents are not ours, so most of these check
 * that the arithmetic *is* the law — the limit velocity it gives, the energy
 * split either side of that limit, and obliquity as line-of-sight thickness.
 * The rest check the three outcomes are reachable and that nothing leaves with
 * more than it arrived with.
 */

/** The thickness this round perforates square-on, from the law, by hand. */
function limitThickness(mass: number, calibre: number, speed: number): number {
  return Math.pow((speed * Math.sqrt(mass)) / (DE_MARRE_K * Math.pow(calibre, 0.75)), 1 / 0.7);
}

/** The corvette's main gun: a 160 mm round of 90 kg at 560 m/s. */
const ROUND = { mass: 90, calibre: 0.16, speed: 560 } as const;
const hit = (thickness: number, incidence = 0, round = ROUND) =>
  strike(round.mass, round.calibre, round.speed, thickness, incidence);

describe('terminal ballistics', () => {
  it('perforates under the limit thickness and embeds over it', () => {
    const limit = limitThickness(ROUND.mass, ROUND.calibre, ROUND.speed);
    expect(limit).toBeGreaterThan(0.1);
    expect(hit(limit * 0.99).outcome).toBe(Terminal.Perforate);
    expect(hit(limit * 1.01).outcome).toBe(Terminal.Embed);
  });

  it('spends exactly the energy of a round arriving at the limit', () => {
    // What makes the limit a limit: everything above it comes out the far
    // side, and the plate takes the rest whatever the round was carrying.
    const thickness = 0.05;
    const slow = strike(ROUND.mass, ROUND.calibre, 400, thickness, 0);
    const fast = strike(ROUND.mass, ROUND.calibre, 900, thickness, 0);
    expect(slow.outcome).toBe(Terminal.Perforate);
    expect(fast.outcome).toBe(Terminal.Perforate);
    expect(fast.energy).toBeCloseTo(slow.energy, 6);

    const residual = Math.sqrt(900 * 900 - (2 * fast.energy) / ROUND.mass);
    expect(fast.residualSpeed).toBeCloseTo(residual, 9);
  });

  it('never lets a round leave with more than it arrived with', () => {
    for (const thickness of [0, 0.01, 0.05, 0.12, 0.3, 1]) {
      for (const incidence of [0, 0.5, 1, 1.3, math.HALF_PI]) {
        const result = hit(thickness, incidence);
        const arrived = 0.5 * ROUND.mass * ROUND.speed * ROUND.speed;
        const left = 0.5 * ROUND.mass * result.residualSpeed * result.residualSpeed;
        expect(result.residualSpeed).toBeLessThanOrEqual(ROUND.speed + 1e-9);
        expect(result.energy).toBeGreaterThanOrEqual(0);
        expect(left + result.energy).toBeLessThanOrEqual(arrived + 1e-6);
      }
    }
  });

  it('takes a plate met at an angle as thicker, by one over the cosine', () => {
    // The whole of the obliquity model: 60° off the normal is twice the
    // thickness, so a plate half what the round can beat stops it there.
    const limit = limitThickness(ROUND.mass, ROUND.calibre, ROUND.speed);
    const thickness = limit * 0.6;
    expect(hit(thickness, 0).outcome).toBe(Terminal.Perforate);
    expect(hit(thickness, math.PI / 3).outcome).not.toBe(Terminal.Perforate);

    // And the residual through a slanted plate is the residual through the
    // thicker plate it amounts to.
    const slanted = hit(0.02, math.PI / 3);
    const square = hit(0.04, 0);
    expect(slanted.residualSpeed).toBeCloseTo(square.residualSpeed, 6);
  });

  it('skids off a plate it could not beat, once the angle is steep enough', () => {
    const stopping = 0.4;
    expect(hit(stopping, RICOCHET_ANGLE - 0.01).outcome).toBe(Terminal.Embed);
    const skid = hit(stopping, RICOCHET_ANGLE + 0.01);
    expect(skid.outcome).toBe(Terminal.Deflect);
    // It leaves with the part of its motion that was along the face.
    expect(skid.residualSpeed).toBeCloseTo(Math.sin(RICOCHET_ANGLE + 0.01) * ROUND.speed, 6);
  });

  it('goes through however oblique the plate, given the speed for it', () => {
    // Why a heavy gun does not care about sloped armour the way a light one
    // does: the angle is thickness, not a dice roll.
    expect(hit(0.01, RICOCHET_ANGLE + 0.2).outcome).toBe(Terminal.Perforate);
  });

  it('rewards a heavy round for its calibre, which is what the law says', () => {
    // Same energy, same speed, different shape: penetration goes as
    // m^0.5 / d^0.75, so the dense slug beats the fat light one.
    const speed = 700;
    const slug = limitThickness(40, 0.1, speed);
    const fat = limitThickness(40, 0.2, speed);
    expect(slug).toBeGreaterThan(fat * 1.5);
  });

  it('answers for a plate that is not there, and for one met edge-on', () => {
    const through = hit(0);
    expect(through.outcome).toBe(Terminal.Perforate);
    expect(through.residualSpeed).toBe(ROUND.speed);
    expect(through.energy).toBe(0);

    // Along the face is a skid rather than infinite armour, which is what the
    // division by the cosine would otherwise produce.
    const along = hit(1, math.HALF_PI);
    expect(along.outcome).toBe(Terminal.Deflect);
    expect(along.residualSpeed).toBe(ROUND.speed);
  });

  it('gets harder to beat as the plate gets thicker, without a step', () => {
    let previous = Infinity;
    for (let thickness = 0.001; thickness < 0.12; thickness += 0.001) {
      const { residualSpeed } = hit(thickness);
      expect(residualSpeed).toBeLessThanOrEqual(previous);
      previous = residualSpeed;
    }
  });
});

describe('the geometry a strike is decided from', () => {
  it('measures incidence from the normal, either side of it', () => {
    expect(incidenceAngle(1, 0, -1, 0)).toBeCloseTo(0, 12);
    expect(incidenceAngle(0, 1, -1, 0)).toBeCloseTo(math.HALF_PI, 12);
    // Unit vectors, as it documents: the caller normalises a velocity before
    // asking, and an unnormalised direction gives a smaller angle silently.
    const up = incidenceAngle(Math.SQRT1_2, Math.SQRT1_2, -1, 0);
    const down = incidenceAngle(Math.SQRT1_2, -Math.SQRT1_2, -1, 0);
    expect(up).toBeCloseTo(down, 12);
    expect(up).toBeCloseTo(math.PI / 4, 6);
  });

  it('never returns a NaN for a direction a shade off unit length', () => {
    // A dot product a hair over one is what rounding hands this, and an
    // arccos of it would be a NaN that reaches the projectile arrays.
    expect(Number.isNaN(incidenceAngle(1 + 1e-16, 0, -1, 0))).toBe(false);
  });

  it('mirrors a deflected round about the normal, keeping it unit length', () => {
    const away = deflected(1, 0, -1, 0);
    expect(away.x).toBeCloseTo(-1, 12);
    expect(away.y).toBeCloseTo(0, 12);

    const glance = deflected(Math.SQRT1_2, -Math.SQRT1_2, 0, 1);
    expect(Math.hypot(glance.x, glance.y)).toBeCloseTo(1, 12);
    expect(glance.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(glance.y).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('leaves a round travelling along the surface alone', () => {
    const along = deflected(1, 0, 0, 1);
    expect(along.x).toBeCloseTo(1, 12);
    expect(along.y).toBeCloseTo(0, 12);
  });
});
