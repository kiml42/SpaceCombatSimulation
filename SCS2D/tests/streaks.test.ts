import { describe, expect, it } from 'vitest';
import { Snapshot } from '../sim/index.js';
import { draw } from '../render/canvas2d.js';
import type { Camera } from '../render/camera.js';

/** A context that does nothing but keep the tracer's last stroke. */
function recorder(): { ctx: CanvasRenderingContext2D; tracer: () => number[] } {
  let path: number[] = [];
  let tracer: number[] = [];
  const target: Record<string, unknown> = {
    moveTo: (x: number, y: number) => (path = [x, y]),
    lineTo: (x: number, y: number) => path.push(x, y),
    stroke: () => {
      if (target['strokeStyle'] === '#ffe6a8') tracer = path;
    },
  };
  const ctx = new Proxy(target, {
    get: (t, key: string) => (key in t ? t[key] : () => ({ addColorStop: () => {} })),
    set: (t, key: string, value) => ((t[key] = value), true),
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, tracer: () => tracer };
}

function oneRound(vx: number, vy: number): Snapshot {
  const snapshot = new Snapshot();
  snapshot.projectileX = new Float64Array([0]);
  snapshot.projectileY = new Float64Array([0]);
  snapshot.projectileVx = new Float64Array([vx]);
  snapshot.projectileVy = new Float64Array([vy]);
  snapshot.projectileWidth = new Float64Array([0.5]);
  snapshot.projectileInside = new Uint8Array([0]);
  snapshot.projectileCount = 1;
  return snapshot;
}

describe('a tracer streak', () => {
  it('trails the way the round crosses the screen, not the world', () => {
    const { ctx, tracer } = recorder();
    const camera: Camera = { x: 0, y: 0, scale: 1, vx: 0, vy: 300 };
    draw(ctx, oneRound(400, 300), camera, 100, 100);
    const [x0, y0, x1, y1] = tracer();
    expect(y1! - y0!).toBeCloseTo(0, 9);
    expect(x1! - x0!).toBeLessThan(0);
  });

  it('is a dot for a round keeping pace with the camera', () => {
    const { ctx, tracer } = recorder();
    const camera: Camera = { x: 0, y: 0, scale: 1, vx: 400, vy: 300 };
    draw(ctx, oneRound(400, 300), camera, 100, 100);
    const [x0, y0, x1, y1] = tracer();
    expect(x1).toBeCloseTo(x0!, 9);
    expect(y1).toBeCloseTo(y0!, 9);
  });
});
