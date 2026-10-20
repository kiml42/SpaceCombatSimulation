import { describe, expect, it } from 'vitest';
import { insetFor, insetsFor, separate, type InsetShip } from '../render/inset.js';

const W = 1000;
const H = 600;
/** A metre a pixel, so a window is 2.86 times its ship's radius across within its bounds. */
const SETTINGS = { zoom: 1, least: 60, most: 200, margin: 10, smallest: 24 };
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

  it('is sized by its ship, at one zoom for all, so two ships shown are to scale', () => {
    const gunship = insetFor(ship(2000, 0, 50), CAMERA, W, H, SETTINGS)!;
    const corvette = insetFor(ship(2000, 0, 25), CAMERA, W, H, SETTINGS)!;
    expect(gunship.camera).toMatchObject({ x: 2000, y: 0, scale: SETTINGS.zoom });
    expect(corvette.camera.scale).toBe(SETTINGS.zoom);
    expect(corvette.size).toBeCloseTo(gunship.size / 2);
    // The hull fills most of the window but not all of it.
    expect(2 * 50 * gunship.camera.scale).toBeLessThan(gunship.size);
    expect(2 * 50 * gunship.camera.scale).toBeGreaterThan(gunship.size / 2);
  });

  it('is held to its bounds, zoomed to fit a ship too small or too big for them', () => {
    const speck = insetFor(ship(2000, 0, 2), CAMERA, W, H, SETTINGS)!;
    const capital = insetFor(ship(2000, 0, 500), CAMERA, W, H, SETTINGS)!;
    expect(speck.size).toBe(SETTINGS.least);
    expect(speck.camera.scale).toBeGreaterThan(SETTINGS.zoom);
    expect(capital.size).toBe(SETTINGS.most);
    expect(capital.camera.scale).toBeLessThan(SETTINGS.zoom);
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
