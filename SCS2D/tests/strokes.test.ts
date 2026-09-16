import { describe, expect, it } from 'vitest';
import {
  beamAlpha,
  BEAM_FADE_FLOOR,
  BEAM_MIN_ALPHA,
  flooredFade,
  legibleWidth,
} from '../render/strokes.js';

/**
 * How a stroke is sized and shaded on screen.
 *
 * Testable at all because none of it touches a canvas, and worth testing
 * because the only symptom of getting it wrong is somebody looking at the
 * screen and saying it seems off. The rules interact: the floor widens a
 * stroke and the fade pays that width back out of the opacity, so each is
 * wrong on its own and they have to be checked against each other.
 */

describe('stroke width', () => {
  it('draws a stroke at its true width once that is wide enough to see', () => {
    // 2 m at 4 px/m is 8 px, well past a 2 px floor.
    expect(legibleWidth(2, 2, 4)).toBe(2);
  });

  it('holds a stroke at the floor once its true width falls below one', () => {
    // 0.1 m at 1 px/m is a tenth of a pixel, which draws as nothing.
    expect(legibleWidth(0.1, 2, 1)).toBe(2);
  });
});

describe('beam brightness', () => {
  it('reads power logarithmically, because the fleet spans decades of it', () => {
    const dim = beamAlpha(1e6);
    const mid = beamAlpha(1e7);
    const bright = beamAlpha(1e8);
    expect(dim).toBeLessThan(mid);
    expect(mid).toBeLessThan(bright);
    // Equal ratios of power are equal steps of brightness, which a linear ramp
    // over four orders of magnitude could not manage.
    expect(mid - dim).toBeCloseTo(bright - mid, 9);
  });

  it('never lets a firing beam vanish, however weak', () => {
    expect(beamAlpha(1)).toBe(BEAM_MIN_ALPHA);
    expect(beamAlpha(0)).toBe(BEAM_MIN_ALPHA);
  });

  it('clamps at full opacity rather than running past it', () => {
    expect(beamAlpha(1e9)).toBe(1);
    expect(beamAlpha(1e30)).toBe(1);
  });
});

describe('paying back the floor', () => {
  it('does nothing at all to a stroke drawn at its true width', () => {
    // The zoomed-in case, which was never the problem: exactly 1, so a beam
    // close up is drawn at exactly the opacity its power earns it.
    expect(flooredFade(2, 2, 4)).toBe(1);
    expect(flooredFade(0.5, 2, 4)).toBe(1);
  });

  it('is exactly 1 at the boundary, so nothing jumps as the zoom crosses it', () => {
    // 0.5 m at 4 px/m is precisely the 2 px floor.
    expect(flooredFade(0.5, 2, 4)).toBe(1);
    expect(legibleWidth(0.5, 2, 4)).toBe(0.5);
  });

  it('dims a stroke further the more the floor has widened it', () => {
    // A beam is only ever floored *because* it has been zoomed away from, so
    // this is the whole mechanism: the wider the lie, the fainter the stroke.
    const near = flooredFade(0.5, 2, 2);
    const far = flooredFade(0.5, 2, 0.5);
    const further = flooredFade(0.5, 2, 0.1);
    expect(near).toBeLessThan(1);
    expect(far).toBeLessThan(near);
    expect(further).toBeLessThan(far);
  });

  it('stops before a beam becomes something to hunt for', () => {
    // The same argument as BEAM_MIN_ALPHA: a weapon that is firing has to
    // read as firing. Conserving the ink exactly would put a light mount at
    // about three per cent opacity across a battlefield.
    expect(flooredFade(0.1, 5, 0.001)).toBe(BEAM_FADE_FLOOR);
    expect(flooredFade(0.4, 2, 0.12)).toBeGreaterThanOrEqual(BEAM_FADE_FLOOR);
  });

  it('leaves a beam dimmer than it was, at the range a duel is watched from', () => {
    // The case that prompted the rule: a 0.4 m aperture on a 1200 px view of a
    // 2 km engagement is a quarter of a pixel across, drawn at 2.
    const scale = 1200 / 2000;
    expect(legibleWidth(0.4, 2, scale)).toBeGreaterThan(0.4);
    expect(flooredFade(0.4, 2, scale)).toBeLessThan(0.55);
  });
});
