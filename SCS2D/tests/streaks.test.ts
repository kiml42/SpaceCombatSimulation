import { describe, expect, it } from 'vitest';
import { exposureEnds, flashSamples, MAX_FLASH_SAMPLES, SHUTTER_RAMP, shutterWeight } from '../render/exposure.js';
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
