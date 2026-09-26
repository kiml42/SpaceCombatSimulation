/**
 * How wide a stroke is drawn on screen, and how strongly — the arithmetic
 * behind both.
 *
 * Here rather than in `canvas2d.ts` for the same reason `camera.ts` is its own
 * file: it is arithmetic over numbers with no canvas anywhere in it, and it is
 * far easier to get wrong than to notice. "The beams look too bold" is the
 * only symptom a mistake in here produces, and that is something a person has
 * to be sitting in front of the screen to say.
 */

/** A stroke at its true width, but never thinner than `minPx` on screen. */
export function legibleWidth(physical: number, minPx: number, metresToPx: number): number {
  const floor = minPx / metresToPx;
  return physical > floor ? physical : floor;
}

/**
 * Beam brightness, in watts of power.
 *
 * A beam is drawn at its true width, exactly as a tracer is — the mount fixes
 * how thick it is, and nothing else may. What it says about itself, it says
 * through *opacity*: a point-defence beam is a faint thread and a capital
 * mount's is a solid bar, at the same width they would each be if they were
 * inert.
 *
 * The mapping is logarithmic because the quantity is. The mounts on one hull
 * already span four orders of magnitude of beam power — the beam gunship
 * carries 4e5 J on its outriggers and 1.4e8 J at the bow — and a linear ramp
 * over that range either clips everything above a thousandth of the maximum or
 * leaves everything below it invisible. A decade of power is therefore an
 * equal step of brightness, which is also how the eye reads brightness.
 *
 * `BEAM_DIM_POWER` is where the ramp starts and `BEAM_BRIGHT_POWER` where it
 * reaches full opacity; outside them the beam clamps. `BEAM_MIN_ALPHA` is the
 * floor, because a beam that is being fired is a thing the player must be able
 * to see even when it is the weakest thing on the screen — the alternative is
 * a gun that reads as jammed.
 */
const BEAM_DIM_POWER = 1e5;
const BEAM_BRIGHT_POWER = 1e8;
export const BEAM_MIN_ALPHA = 0.25;
const BEAM_DECADES = Math.log(BEAM_BRIGHT_POWER / BEAM_DIM_POWER);

/**
 * How much of the core's opacity the glow gets. Below 1 so that the halo stays
 * a halo at every power: at parity a full-power beam's glow is as solid as
 * its core and the two stop being distinguishable.
 */
export const BEAM_GLOW_ALPHA = 0.45;

/** Opacity for a beam carrying `power` watts. See the constants above. */
export function beamAlpha(power: number): number {
  if (!(power > BEAM_DIM_POWER)) return BEAM_MIN_ALPHA;
  const t = Math.log(power / BEAM_DIM_POWER) / BEAM_DECADES;
  return t >= 1 ? 1 : BEAM_MIN_ALPHA + (1 - BEAM_MIN_ALPHA) * t;
}

/**
 * Flame opacity at the nozzle, for a flame burning at `intensity` watts per
 * square metre (`plumeIntensity`).
 *
 * Logarithmic for the reason a beam's is: the fleet runs from a capital's
 * main engines at about a kilowatt per square metre to a fighter's thrusters
 * at over a megawatt, and a flame's size already says how far it reaches, so
 * its opacity is free to say how fiercely. `PLUME_MIN_ALPHA` keeps a burning
 * engine visible however gentle its flame.
 */
const PLUME_DIM_INTENSITY = 1e3;
const PLUME_BRIGHT_INTENSITY = 1e6;
export const PLUME_MIN_ALPHA = 0.2;
const PLUME_MAX_ALPHA = 0.95;
const PLUME_DECADES = Math.log(PLUME_BRIGHT_INTENSITY / PLUME_DIM_INTENSITY);

export function plumeAlpha(intensity: number): number {
  if (!(intensity > PLUME_DIM_INTENSITY)) return PLUME_MIN_ALPHA;
  const t = Math.log(intensity / PLUME_DIM_INTENSITY) / PLUME_DECADES;
  return t >= 1 ? PLUME_MAX_ALPHA : PLUME_MIN_ALPHA + (PLUME_MAX_ALPHA - PLUME_MIN_ALPHA) * t;
}

/**
 * How far to dim a beam that the on-screen floor has drawn wider than life.
 *
 * The floors exist so that detail does not vanish when it falls below a pixel,
 * and for a tracer that is the end of it: a round's streak is a few hundred
 * metres, so it shrinks away with the zoom and its share of the picture goes
 * with it. A beam does not shrink. It runs to the edge of the viewport at any
 * zoom, so the floor's extra width is multiplied along a line thousands of
 * pixels long, and a beam that is honestly a fifth of a pixel across arrives as
 * a bold bar over everything else — 8 times wider than life at the range a duel
 * is watched from, 40 to 90 times at a wide field.
 *
 * So the width the floor adds is taken back out of the opacity. Not all of it:
 * conserving the ink exactly would put a corvette's beam at three per cent
 * opacity across a battlefield, which is a different failure. The square root
 * dims it by the same factor the floor widened it by, and `BEAM_FADE_FLOOR`
 * stops the fade before a firing beam becomes a thing the player has to hunt
 * for — the same argument as `BEAM_MIN_ALPHA`, and for the same reason.
 *
 * Above the floor this does nothing at all: a beam drawn at its true width is a
 * beam drawn at its true opacity.
 */
const BEAM_WIDTH_FADE = 0.35;
export const BEAM_FADE_FLOOR = 0.22;

/**
 * The opacity multiplier for a stroke of `physical` metres held up to `minPx`.
 *
 * Paired with `legibleWidth` and taking the same arguments, so the width and
 * the dimming that pays for it cannot drift apart.
 */
export function flooredFade(physical: number, minPx: number, metresToPx: number): number {
  const truePx = physical * metresToPx;
  if (truePx >= minPx) return 1;
  const faded = (truePx / minPx) ** BEAM_WIDTH_FADE;
  return faded > BEAM_FADE_FLOOR ? faded : BEAM_FADE_FLOOR;
}
