/**
 * Drawing what moves as a camera would photograph it: exposed for one step of
 * the battle, with a shutter that opens and closes over a share of that time.
 *
 * A round is drawn along the line it crossed in that step, relative to the
 * camera, and fades in and out towards either end; a flash is drawn at
 * moments through the step and the moments summed. Presentation only, and
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

/** Where something moving at `(vx, vy)` was `dt` ago, relative to a camera moving at `(cvx, cvy)`. */
export function exposureStart(
  x: number,
  y: number,
  vx: number,
  vy: number,
  cvx: number,
  cvy: number,
  dt: number,
): { x: number; y: number } {
  return { x: x - (vx - cvx) * dt, y: y - (vy - cvy) * dt };
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
