import { describe, expect, it } from 'vitest';
import { clipToStart, exposureEnds, flashSamples, MAX_FLASH_SAMPLES, SHUTTER_RAMP, shutterWeight } from '../render/exposure.js';
import { rgba } from '../render/sprites.js';

/** What moves is drawn as though photographed with a shutter open for one step. */

describe('the shutter', () => {
  it('opens and closes over a share of the exposure, and is fully open between', () => {
    expect(shutterWeight(0)).toBe(0);
    expect(shutterWeight(1)).toBe(0);
    expect(shutterWeight(SHUTTER_RAMP / 2)).toBeCloseTo(0.5, 12);
    expect(shutterWeight(1 - SHUTTER_RAMP / 2)).toBeCloseTo(0.5, 12);
    expect(shutterWeight(0.5)).toBe(1);
  });
});

describe('a tracer streak', () => {
  it('runs half a step either side of now, relative to the camera', () => {
    const ends = exposureEnds(100, 50, 400, 300, 0, 300, 0.5);
    expect(ends.x0).toBeCloseTo(0, 12);
    expect(ends.x1).toBeCloseTo(200, 12);
    expect(ends.y0).toBeCloseTo(50, 12);
    expect(ends.y1).toBeCloseTo(50, 12);
  });

  it('has no length for a round keeping pace with the camera', () => {
    const ends = exposureEnds(100, 50, 400, 300, 400, 300, 0.5);
    expect(ends).toEqual({ x0: 100, y0: 50, x1: 100, y1: 50 });
  });
});

describe('a flash', () => {
  it('is drawn once when it neither moves nor changes size', () => {
    expect(flashSamples(0, 0, 10)).toBe(1);
  });

  it('is drawn at more moments the further it travels against its size', () => {
    expect(flashSamples(40, 0, 10)).toBe(16);
    expect(flashSamples(1e6, 0, 10)).toBe(MAX_FLASH_SAMPLES);
  });
});

describe('a sprite colour', () => {
  it('reads an alpha when it has one', () => {
    expect(rgba('#ffb2a888')).toEqual([255, 178, 168, 136]);
    expect(rgba('#ffe6a8')).toEqual([255, 230, 168, 255]);
  });
});

describe('a streak just out of the barrel', () => {
  it('starts at the muzzle rather than reaching back down the barrel', () => {
    // Fired from the origin at 600 m/s along x and a third of a step old: the
    // open streak reaches back past the muzzle.
    const dt = 1 / 60;
    const x = 600 * (dt / 3);
    const open = exposureEnds(x, 0, 600, 0, 0, 0, dt);
    expect(open.x0).toBeLessThan(0);
    const clipped = clipToStart(open, 0, 0, 600, 0);
    expect(clipped.x0).toBe(0);
    expect(clipped.x1).toBe(open.x1);
  });

  it('is untouched once the round is a full streak clear of the muzzle', () => {
    const open = exposureEnds(100, 0, 600, 0, 0, 0, 1 / 60);
    expect(clipToStart(open, 0, 0, 600, 0)).toBe(open);
  });

  it('is nothing for a round still behind the muzzle, and cut along the round, not the camera', () => {
    const behind = clipToStart({ x0: -10, y0: 0, x1: -2, y1: 0 }, 0, 0, 600, 0);
    expect(behind.x0).toBe(behind.x1);
    // A camera panning fast enough to throw the streak backwards on screen
    // does not move where the round left from.
    const panned = exposureEnds(5, 0, 600, 0, 2000, 0, 1 / 60);
    const cut = clipToStart(panned, 0, 0, 600, 0);
    expect(Math.min(cut.x0, cut.x1)).toBeGreaterThanOrEqual(0);
  });
});
