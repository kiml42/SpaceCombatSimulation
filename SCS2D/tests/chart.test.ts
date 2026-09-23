import { describe, expect, it } from 'vitest';
import { indexAt, xOf, type ChartLayout } from '../render/chart.js';

/**
 * Reading a pointer back off the chart.
 *
 * Arithmetic rather than drawing, and unit-tested for the reason
 * `render/camera.ts` is: what it decides is which generation somebody is
 * pointing at, and being one out is a mistake that looks like nothing at all
 * until somebody trusts the number.
 */

const PLOT: ChartLayout = { x: 46, y: 8, width: 400, height: 170, count: 11 };

describe('pointing at the chart', () => {
  it('puts the ends of the plot at the ends of the run', () => {
    expect(xOf(PLOT, 0)).toEqual(46);
    expect(xOf(PLOT, 10)).toEqual(446);
    expect(indexAt(PLOT, 46)).toEqual(0);
    expect(indexAt(PLOT, 446)).toEqual(10);
  });

  it('gives every position between two points to the nearer', () => {
    // A long run puts its points closer together than a pointer can be aimed,
    // so what somebody means is the generation *about* there.
    // Points are forty pixels apart here, so nineteen either side of one is
    // still nearer to it than to its neighbour — probed inside the plot only,
    // since off the end of it there is nothing to point at.
    for (let i = 0; i < PLOT.count; i++) {
      const x = xOf(PLOT, i);
      if (i > 0) expect(indexAt(PLOT, x - 19), `just before ${i}`).toEqual(i);
      if (i < PLOT.count - 1) expect(indexAt(PLOT, x + 19), `just after ${i}`).toEqual(i);
    }
    // Halfway lands on one of the two, and never between them.
    const between = indexAt(PLOT, (xOf(PLOT, 3) + xOf(PLOT, 4)) / 2);
    expect(between === 3 || between === 4).toBe(true);
  });

  it('is nothing at all when the pointer is off the plot', () => {
    expect(indexAt(PLOT, 0)).toBeNull();
    expect(indexAt(PLOT, 600)).toBeNull();
    // A little slack at each end, so pointing at the first point is not a
    // pixel-perfect exercise.
    expect(indexAt(PLOT, 42)).toEqual(0);
  });

  it('has nothing to point at before anything has been fought', () => {
    expect(indexAt({ ...PLOT, count: 0 }, 200)).toBeNull();
  });

  it('puts one lone generation in the middle, and points at it from anywhere', () => {
    const lone: ChartLayout = { ...PLOT, count: 1 };
    expect(xOf(lone, 0)).toEqual(246);
    expect(indexAt(lone, 100)).toEqual(0);
  });
});
