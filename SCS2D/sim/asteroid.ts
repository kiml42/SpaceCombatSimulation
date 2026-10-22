import type { Blueprint } from './blueprint.js';
import { cos, sin, TAU } from './math.js';
import type { ModuleSpec } from './modules.js';
import { KERNEL_MAX_CORNERS, KERNEL_MIN_CORNERS, polygonCentroid, triangleBounds } from './shape.js';

/**
 * Asteroids: hulls built round a kernel rather than flown from a core.
 *
 * A major asteroid's kernel is a solid convex polygon that takes no damage,
 * belongs to no side and carries a well, riding its rail (`ShipSpec.rides`).
 */

/** A kernel with these corners, anywhere round its middle, placed at `x`, `y`. */
export function kernelModule(vertices: readonly number[], x = 0, y = 0): ModuleSpec {
  const middle = { x: 0, y: 0 };
  polygonCentroid(vertices, middle);
  const centred: number[] = [];
  for (let i = 0; i < vertices.length; i += 2) centred.push(vertices[i]! - middle.x, vertices[i + 1]! - middle.y);
  const bounds = triangleBounds(centred);
  return { kind: 'kernel', x, y, length: bounds.length, width: bounds.width, vertices: centred };
}

/**
 * The corners of a kernel `radius` across its middle, one at each of `reach`'s
 * bearings evenly round and that share of `radius` out: a regular polygon when
 * every reach is 1. Whether it comes out convex is the caller's to choose.
 */
export function kernelOutline(radius: number, reach: readonly number[]): number[] {
  if (reach.length < KERNEL_MIN_CORNERS || reach.length > KERNEL_MAX_CORNERS) {
    throw new Error(`a kernel has ${KERNEL_MIN_CORNERS} to ${KERNEL_MAX_CORNERS} corners, got ${reach.length}`);
  }
  const out: number[] = [];
  for (let k = 0; k < reach.length; k++) {
    const bearing = (k * TAU) / reach.length;
    out.push(radius * reach[k]! * cos(bearing), radius * reach[k]! * sin(bearing));
  }
  return out;
}

/** An asteroid that is a kernel and nothing else. */
export function bareKernel(name: string, vertices: readonly number[]): Blueprint {
  return { name, modules: [kernelModule(vertices)] };
}
