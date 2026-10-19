import { describe, expect, it } from 'vitest';
import { describeRange, insetAt, insetFor, insetsFor, separate, type InsetShip } from '../render/inset.js';

const W = 1000;
const H = 600;
const SETTINGS = { size: 160, margin: 10, smallest: 24 };
/** A view centred on the origin at 1 px a metre. */
const CAMERA = { x: 0, y: 0, scale: 1 };

function ship(x: number, y: number, radius: number, body = 1): InsetShip {
  return { body, x, y, vx: 0, vy: 0, radius };
}

describe('a close-up window', () => {
  it('is not wanted for a ship on screen and large enough to read', () => {
    expect(insetFor(ship(0, 0, 20), CAMERA, W, H, SETTINGS)).toBeNull();
  });

  it('covers a ship on screen that is too small, centred on it', () => {
    const inset = insetFor(ship(100, 50, 5), CAMERA, W, H, SETTINGS)!;
    // 100 m right and 50 m up of the centre, y down on screen.
    expect(inset.x + inset.size / 2).toBeCloseTo(600);
    expect(inset.y + inset.size / 2).toBeCloseTo(250);
    expect(inset.toward).toBeNull();
  });

  it('stays on screen when the small ship is near an edge', () => {
    const inset = insetFor(ship(495, 0, 5), CAMERA, W, H, SETTINGS)!;
    expect(inset.x + inset.size).toBeCloseTo(W - SETTINGS.margin);
  });

  it('goes against the edge a ship is beyond, at its height, and points at it', () => {
    const inset = insetFor(ship(2000, 100, 50), CAMERA, W, H, SETTINGS)!;
    expect(inset.x + inset.size).toBeCloseTo(W - SETTINGS.margin);
    expect(inset.y + inset.size / 2).toBeCloseTo(200);
    expect(inset.toward).toBeCloseTo(0, 1);
  });

  it('goes into the corner for a ship off two edges', () => {
    const inset = insetFor(ship(-5000, -5000, 50), CAMERA, W, H, SETTINGS)!;
    expect(inset.x).toBeCloseTo(SETTINGS.margin);
    expect(inset.y + inset.size).toBeCloseTo(H - SETTINGS.margin);
  });

  it('is drawn with a camera on its ship, zoomed to the ship', () => {
    const big = insetFor(ship(2000, 0, 50), CAMERA, W, H, SETTINGS)!;
    const small = insetFor(ship(2000, 0, 5), CAMERA, W, H, SETTINGS)!;
    expect(big.camera).toMatchObject({ x: 2000, y: 0 });
    expect(small.camera.scale).toBeCloseTo(big.camera.scale * 10);
    // The hull fills most of the window but not all of it.
    expect(2 * 50 * big.camera.scale).toBeLessThan(SETTINGS.size);
    expect(2 * 50 * big.camera.scale).toBeGreaterThan(SETTINGS.size / 2);
  });
});

describe('two close-up windows', () => {
  it('are kept apart when their ships are close', () => {
    const [a, b] = insetsFor([ship(2000, 0, 50, 1), ship(2000, 20, 50, 2)], CAMERA, W, H, SETTINGS);
    expect(a!.body).toBe(1);
    expect(b!.body).toBe(2);
    const apart = a!.y + a!.size + SETTINGS.margin <= b!.y || b!.y + b!.size + SETTINGS.margin <= a!.y || a!.x + a!.size + SETTINGS.margin <= b!.x || b!.x + b!.size + SETTINGS.margin <= a!.x;
    expect(apart).toBe(true);
    // Both still on screen.
    for (const inset of [a!, b!]) {
      expect(inset.x).toBeGreaterThanOrEqual(0);
      expect(inset.y).toBeGreaterThanOrEqual(0);
      expect(inset.x + inset.size).toBeLessThanOrEqual(W);
      expect(inset.y + inset.size).toBeLessThanOrEqual(H);
    }
  });

  it('are left alone when they do not overlap', () => {
    const fixed = { x: 10, y: 10, size: 100 };
    const moving = { x: 500, y: 10, size: 100 };
    separate(fixed, moving, W, H, 10);
    expect(moving).toEqual({ x: 500, y: 10, size: 100 });
  });

  it('are only made for the ships that need one', () => {
    const insets = insetsFor([ship(0, 0, 20, 1), ship(3000, 0, 20, 2)], CAMERA, W, H, SETTINGS);
    expect(insets.map((inset) => inset.body)).toEqual([2]);
  });
});

describe('reading a close-up', () => {
  it('finds the window under a point, the last placed on top', () => {
    const insets = insetsFor([ship(2000, 0, 50, 1), ship(-2000, 0, 50, 2)], CAMERA, W, H, SETTINGS);
    const right = insets.find((inset) => inset.body === 1)!;
    expect(insetAt(insets, right.x + 5, right.y + 5)).toBe(1);
    expect(insetAt(insets, W / 2, H / 2)).toBe(-1);
  });

  it('gives a range in metres, then kilometres', () => {
    expect(describeRange(640.4)).toBe('640 m');
    expect(describeRange(1234)).toBe('1.23 km');
    expect(describeRange(45678)).toBe('45.7 km');
  });
});
