/**
 * Drawing what moves as a camera would photograph it: exposed for one step of
 * the battle, with a shutter that opens and closes over a share of that time.
 *
 * The step is centred on the moment drawn. A round is drawn along the line it
 * crosses in it, relative to the camera, and fades in and out towards either
 * end; a flash is drawn at moments through it and the moments summed. Presentation only, and
 * DOM-free so it can be tested like the camera.
 */

/** The share of the exposure the shutter spends opening, and again closing. */
export const SHUTTER_RAMP = 0.25;

/** How open the shutter is a fraction `u` of the way through the exposure. */
export function shutterWeight(u: number): number {
  if (!(u > 0) || !(u < 1)) return 0;
  const edge = u < 0.5 ? u : 1 - u;
  return edge >= SHUTTER_RAMP ? 1 : edge / SHUTTER_RAMP;
}

/**
 * Where something at `(x, y)` moving at `(vx, vy)` is at the opening and the
 * closing of an exposure of `dt` centred on now, relative to a camera moving
 * at `(cvx, cvy)`. Centred, so things that were together at one moment are
 * drawn together: fragments' streaks cross where their shell burst.
 */
export function exposureEnds(
  x: number,
  y: number,
  vx: number,
  vy: number,
  cvx: number,
  cvy: number,
  dt: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const hx = (vx - cvx) * dt * 0.5;
  const hy = (vy - cvy) * dt * 0.5;
  return { x0: x - hx, y0: y - hy, x1: x + hx, y1: y + hy };
}

/** The most moments a flash is drawn at in one exposure. */
export const MAX_FLASH_SAMPLES = 64;

/**
 * How many moments to draw a flash at: close enough that a hard-edged core
 * does not band, given how far it travels and how much it grows or shrinks on
 * screen.
 */
export function flashSamples(travelPx: number, growthPx: number, radiusPx: number): number {
  const spread = Math.max(Math.abs(travelPx), 2 * Math.abs(growthPx));
  const n = Math.ceil(spread / Math.max(radiusPx * 0.25, 1));
  return Math.min(MAX_FLASH_SAMPLES, Math.max(1, n));
}
