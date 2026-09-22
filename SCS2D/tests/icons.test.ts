import { describe, expect, it } from 'vitest';
import {
  iconAlpha,
  ICON_FADE_FULL_PX,
  ICON_FADE_START_PX,
  ICON_MAX_ALPHA,
  ICON_OUTLINE,
} from '../render/icons.js';

/**
 * The ship icon's fade and shape.
 *
 * Testable at all because none of it touches a canvas, and worth testing
 * because both failures are silent: an icon that never fades out covers the
 * hulls it is meant to stand in for, and one that never fades in leaves the
 * small ships it exists for exactly as lost as before.
 */

describe('icon fade', () => {
  it('draws nothing while the hull is large enough to read', () => {
    expect(iconAlpha(ICON_FADE_START_PX)).toBe(0);
    expect(iconAlpha(400)).toBe(0);
  });

  it('is fully up once the hull is too small to make out', () => {
    expect(iconAlpha(ICON_FADE_FULL_PX)).toBe(ICON_MAX_ALPHA);
    expect(iconAlpha(1)).toBe(ICON_MAX_ALPHA);
    expect(iconAlpha(0)).toBe(ICON_MAX_ALPHA);
  });

  it('comes up steadily between the two, so nothing pops', () => {
    const half = (ICON_FADE_START_PX + ICON_FADE_FULL_PX) / 2;
    expect(iconAlpha(half)).toBeCloseTo(ICON_MAX_ALPHA / 2, 9);
    // Monotonic: every step out from the start is at least as solid as the last.
    let previous = 0;
    for (let px = ICON_FADE_START_PX; px >= 0; px -= 1) {
      const alpha = iconAlpha(px);
      expect(alpha).toBeGreaterThanOrEqual(previous);
      previous = alpha;
    }
  });

  it('turns on for a small ship at a zoom where a large one keeps its hull', () => {
    // Two radii an order of magnitude apart at the same scale: the fighter is
    // an icon, the capital ship is still a ship.
    const scale = 0.5;
    expect(iconAlpha(5 * 2 * scale)).toBe(ICON_MAX_ALPHA);
    expect(iconAlpha(60 * 2 * scale)).toBe(0);
  });
});

describe('the arrowhead', () => {
  it('points along +x, and only one end of it does', () => {
    const xs = ICON_OUTLINE.map(([x]) => x);
    const nose = Math.max(...xs);
    expect(xs.filter((x) => x === nose)).toHaveLength(1);
    // The nose is on the centreline; nothing else reaches that far forward.
    expect(ICON_OUTLINE.find(([x]) => x === nose)![1]).toBe(0);
  });

  it('is symmetric about the centreline, so it reads as facing rather than turning', () => {
    const ys = ICON_OUTLINE.map(([, y]) => y);
    expect(ys.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9);
    for (const [x, y] of ICON_OUTLINE) {
      expect(ICON_OUTLINE.some(([ox, oy]) => ox === x && oy === -y)).toBe(true);
    }
  });

  it('is notched at the tail, which is what makes the nose unambiguous', () => {
    // The point on the centreline behind the nose sits forward of the barbs,
    // so the trailing edge is concave rather than a straight base.
    const tail = ICON_OUTLINE.filter(([, y]) => y === 0).map(([x]) => x).sort((a, b) => a - b)[0]!;
    const barb = Math.min(...ICON_OUTLINE.map(([x]) => x));
    expect(tail).toBeGreaterThan(barb);
  });

  it('is one unit long, so a caller scales by the size it wants on screen', () => {
    const xs = ICON_OUTLINE.map(([x]) => x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 9);
  });
});
