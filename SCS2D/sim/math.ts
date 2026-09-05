/**
 * Deterministic maths.
 *
 * `Math.sin`, `cos`, `tan`, `atan`, `atan2`, `exp`, `pow`, `log` and `hypot` are
 * *implementation-defined* in the ECMAScript specification. V8, SpiderMonkey and
 * JavaScriptCore give different results for them, and V8 has changed its own
 * implementation between versions. Anything computed with them cannot be
 * replayed reliably, which breaks replays, golden tests and async PvP.
 * See DESIGN.md non-negotiable 3.
 *
 * What the spec *does* pin down exactly, and is therefore safe:
 *
 *   `+ - * /`                        IEEE-754, correctly rounded
 *   `Math.sqrt`                      IEEE-754, correctly rounded
 *   `Math.abs` `floor` `ceil` `round` `trunc` `sign` `min` `max` `imul`
 *   `Math.PI` and the other constants (they are values, not computations)
 *
 * Everything below is built from those alone.
 *
 * This module is the *only* place in `sim/` allowed to reference `Math`.
 * Everything else imports from here — see `tests/architecture.test.ts`, which
 * fails the build if that rule is broken.
 *
 * Accuracy is a secondary goal; determinism is the point. The error bounds
 * documented below are far tighter than gameplay needs — a turret aiming error
 * of 1e-11 radians is around 6e-10 degrees.
 */

// --- Safe re-exports -------------------------------------------------------
// So that simulation code never has to touch `Math` directly.

export const abs = Math.abs;
export const floor = Math.floor;
export const ceil = Math.ceil;
export const round = Math.round;
export const trunc = Math.trunc;
export const sign = Math.sign;
export const min = Math.min;
export const max = Math.max;
export const sqrt = Math.sqrt;
export const imul = Math.imul;

// --- Constants -------------------------------------------------------------

export const PI = Math.PI;
export const TAU = 2 * Math.PI;
export const HALF_PI = Math.PI / 2;
export const QUARTER_PI = Math.PI / 4;

/**
 * Cody-Waite split of pi/2: `PIO2_HI + PIO2_LO` represents pi/2 to roughly
 * twice double precision, so that `x - k * pi/2` stays accurate when the
 * subtraction cancels leading digits. These are the classic fdlibm constants.
 */
const PIO2_HI = Math.PI / 2; // 1.5707963267948966
const PIO2_LO = 6.123233995736766e-17; // pi/2 - PIO2_HI

/** tan(pi/8) = sqrt(2) - 1. The atan reduction threshold. */
const TAN_PIO8 = Math.sqrt(2) - 1;

// --- sin / cos -------------------------------------------------------------

/**
 * sin(r) for |r| <= pi/4, by Taylor series to r^15.
 * Truncation error at r = pi/4 is about 5e-17, i.e. below one double ulp of
 * the result.
 */
function sinKernel(r: number): number {
  const z = r * r;
  let p = -1 / 1307674368000; // -1/15!
  p = 1 / 6227020800 + z * p; //  1/13!
  p = -1 / 39916800 + z * p; // -1/11!
  p = 1 / 362880 + z * p; //  1/9!
  p = -1 / 5040 + z * p; // -1/7!
  p = 1 / 120 + z * p; //  1/5!
  p = -1 / 6 + z * p; // -1/3!
  p = 1 + z * p;
  return r * p;
}

/**
 * cos(r) for |r| <= pi/4, by Taylor series to r^16.
 * Truncation error at r = pi/4 is about 2e-18.
 */
function cosKernel(r: number): number {
  const z = r * r;
  let p = 1 / 20922789888000; //  1/16!
  p = -1 / 87178291200 + z * p; // -1/14!
  p = 1 / 479001600 + z * p; //  1/12!
  p = -1 / 3628800 + z * p; // -1/10!
  p = 1 / 40320 + z * p; //  1/8!
  p = -1 / 720 + z * p; // -1/6!
  p = 1 / 24 + z * p; //  1/4!
  p = -1 / 2 + z * p; // -1/2!
  p = 1 + z * p;
  return p;
}

/*
 * Both `sin` and `cos` reduce x to a quadrant k and a remainder r in
 * [-pi/4, pi/4], then pick a kernel by quadrant. The reduction is repeated in
 * each rather than factored out, because factoring it would need either an
 * allocation or module-level mutable state, and neither is acceptable here.
 *
 * `k & 3` gives the right answer for negative k too: -1 & 3 === 3.
 *
 * Accurate for |x| up to about 1e8. Simulation angles are normalised to
 * [-pi, pi) every step, so that is never approached in practice.
 */

export function sin(x: number): number {
  const k = Math.round(x / PIO2_HI);
  const r = x - k * PIO2_HI - k * PIO2_LO;
  switch (k & 3) {
    case 0:
      return sinKernel(r);
    case 1:
      return cosKernel(r);
    case 2:
      return -sinKernel(r);
    default:
      return -cosKernel(r);
  }
}

export function cos(x: number): number {
  const k = Math.round(x / PIO2_HI);
  const r = x - k * PIO2_HI - k * PIO2_LO;
  switch (k & 3) {
    case 0:
      return cosKernel(r);
    case 1:
      return -sinKernel(r);
    case 2:
      return -cosKernel(r);
    default:
      return sinKernel(r);
  }
}

export function tan(x: number): number {
  return sin(x) / cos(x);
}

// --- atan / atan2 ----------------------------------------------------------

/**
 * atan(u) for |u| <= tan(pi/8), by Taylor series to u^31.
 *
 * Truncation error at the interval edge is about 7e-15. Stopping at u^25 gives
 * around 2e-12, which is still far beyond what aiming needs, but the extra
 * three terms cost three multiply-adds and buy nearly three digits.
 */
function atanSeries(u: number): number {
  const z = u * u;
  let p = -1 / 31;
  p = 1 / 29 + z * p;
  p = -1 / 27 + z * p;
  p = 1 / 25 + z * p;
  p = -1 / 23 + z * p;
  p = 1 / 21 + z * p;
  p = -1 / 19 + z * p;
  p = 1 / 17 + z * p;
  p = -1 / 15 + z * p;
  p = 1 / 13 + z * p;
  p = -1 / 11 + z * p;
  p = 1 / 9 + z * p;
  p = -1 / 7 + z * p;
  p = 1 / 5 + z * p;
  p = -1 / 3 + z * p;
  p = 1 + z * p;
  return u * p;
}

/** atan(x) for x in [0, 1]. */
function atanUnit(x: number): number {
  if (x > TAN_PIO8) {
    // atan(x) = pi/4 + atan((x - 1) / (x + 1))
    return QUARTER_PI + atanSeries((x - 1) / (x + 1));
  }
  return atanSeries(x);
}

export function atan(x: number): number {
  if (x < 0) return -atan(-x);
  if (x > 1) return HALF_PI - atanUnit(1 / x);
  return atanUnit(x);
}

/**
 * atan2(y, x), matching IEEE conventions except that the sign of a zero
 * argument is not distinguished (atan2(-0, -1) returns +pi, not -pi). The
 * simulation has no use for signed zero bearings.
 */
export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

// --- Angles ----------------------------------------------------------------

/** Wrap an angle to [-pi, pi). */
export function normalizeAngle(a: number): number {
  const k = Math.round(a / TAU);
  return a - k * TAU;
}

/**
 * The shortest signed rotation from `from` to `to`, in [-pi, pi).
 * This is the quantity a turret or pilot should be driving to zero.
 */
export function angleDelta(from: number, to: number): number {
  return normalizeAngle(to - from);
}

// --- Vector helpers --------------------------------------------------------
// Scalar in, scalar out. There is deliberately no Vec2 type: allocating a
// vector per operation is what makes a JS simulation stutter under GC
// (DESIGN.md non-negotiable 4).

/** Length of (x, y). Never use `Math.hypot` — it is implementation-defined. */
export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function lengthSq(x: number, y: number): number {
  return x * x + y * y;
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

export function distanceSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by;
}

/** The z-component of the 3D cross product of two planar vectors. */
export function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Move `current` toward `target` by at most `maxStep`. Used for rate-limited
 * quantities such as turret slew and throttle ramps.
 */
export function approach(current: number, target: number, maxStep: number): number {
  const d = target - current;
  if (d > maxStep) return current + maxStep;
  if (d < -maxStep) return current - maxStep;
  return target;
}

/**
 * The fastest rate that can still be braked out over `error`, in discrete
 * steps of `accel · dt`.
 *
 * The continuous answer, `sqrt(2·a·|e|)`, is slightly too fast: a step taken at
 * that rate leaves an error the next step cannot brake out of, so the quantity
 * overshoots and hunts. The discrete form below is exactly zero at zero error
 * and strictly positive everywhere else, so every error gets corrected however
 * small — where the obvious fix of subtracting `a·dt/2` from the continuous
 * rate stops correcting below `a·dt²/8` and parks a brisk mount short of where
 * it was asked to be.
 *
 * The `|e|/dt` cap is what stops a single step travelling past the target when
 * the remaining error is smaller than one step of travel.
 *
 * Always positive; the caller applies the sign of the error. Used for turret
 * slew and for a pilot's heading hold, which are the same problem at different
 * scales.
 */
export function brakingRate(error: number, accel: number, dt: number): number {
  const magnitude = abs(error);
  const half = 0.5 * accel * dt;
  const braking = sqrt(2 * accel * magnitude + half * half) - half;
  const landing = dt > 0 ? magnitude / dt : 0;
  return braking < landing ? braking : landing;
}
