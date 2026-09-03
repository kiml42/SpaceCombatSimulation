import type { Bodies, BodyId } from './bodies.js';
import { sqrt } from './math.js';

/**
 * Thruster allocation: turning a desired body-frame wrench into throttles.
 *
 * A ship asks for a force and a torque — "push me this way while turning me
 * that way" — and this decides how hard each thruster burns to deliver it.
 * Formally, given thrusters at fixed mount points with fixed directions, find
 * throttles `u` in [0, 1] with
 *
 *     Σ uᵢ Tᵢ dᵢ        = (Fx, Fy)          the force asked for
 *     Σ uᵢ Tᵢ (rᵢ × dᵢ) = τ                 the torque asked for
 *
 * Three constraint equations, because the simulation is planar. In three
 * dimensions it would be six, with an inertia tensor that changes as modules
 * are shot away, and attitude expressed as a quaternion. That difference is one
 * of the reasons the game is planar at all (DESIGN.md §3), and it is why the
 * old Unity prototype stalled here: it drove jointed thrusters through a
 * physics solver with gains found by a genetic algorithm, and got the huge
 * torques and damping forces that approach guarantees.
 *
 * **The geometry is fixed per blueprint, so the expensive part is precomputed
 * once.** Each thruster contributes a fixed column — its full-throttle wrench —
 * and the normal-equations inverse over all of them is built at construction.
 * Recomputing is needed only when the set of *working* thrusters changes, which
 * is when one is destroyed, not when the ship manoeuvres or takes damage
 * elsewhere (DESIGN.md §4: mass properties and thruster geometry have different
 * triggers).
 *
 * **The torque row is preconditioned**, and it matters more than it sounds.
 * Mount arms are metres, so a thruster's torque column is tens of times its
 * force column and *hundreds* of times larger once squared into the normal
 * equations. Left alone, the least-squares solve then weights torque error
 * thousands of times more heavily than force error — and while that is harmless
 * when the system is exactly solvable, it is ruinous once thrusters pin at their
 * bounds and fewer than three remain free. The solve becomes overdetermined and
 * quietly fits torque while ignoring force: measured at a 75% shortfall on
 * demands that were perfectly achievable, with torque *overshooting* its target.
 * Scaling the torque row by a characteristic length of the layout — chosen so
 * the force and torque blocks contribute equally — makes the two commensurable
 * and the residual split sensible.
 *
 * **What is minimised is Σuᵢ², not propellant.** Least squares spreads demand
 * across the thrusters that can serve it, giving smooth, predictable control.
 * Genuinely propellant-optimal allocation is a linear program whose solutions
 * sit on vertices, so it burns fewer thrusters harder and switches abruptly
 * between them as the demand rotates — cheaper in fuel, worse to fly and to
 * watch. The difference is small next to whether the ship's *layout* is any
 * good, which is the thing the player actually controls. Recorded in §12.
 */

export interface ThrusterSpec {
  /** Mount point in body frame, metres from the centre of mass. */
  x: number;
  y: number;
  /** Direction the thrust pushes the ship, body frame. Normalised on build. */
  dirX: number;
  dirY: number;
  /** Thrust at full throttle, newtons. */
  maxThrust: number;
}

/** Filled in place by `allocate`, so allocation allocates nothing. */
export class Allocation {
  /** Body-frame wrench actually produced, which may fall short of the demand. */
  fx = 0;
  fy = 0;
  torque = 0;
  /**
   * True if any thruster ended at *full* throttle — the layout ran out of
   * thrust for what was asked. Deliberately not set for a thruster at zero:
   * most thrusters are off in most allocations, so a flag covering both bounds
   * would be true almost always and mean nothing.
   */
  saturated = false;
  /** Redistribution passes used; diagnostic. */
  passes = 0;
}

/**
 * Ridge added only when the normal equations are singular — when the layout
 * cannot span all three axes, as one with no torque authority cannot. Costs
 * roughly this much relative error in the affected directions, which is
 * nine significant figures of thrust and therefore irrelevant to anything the
 * game does with the answer.
 */
const RIDGE = 1e-9;

/** How near zero a determinant must be, relative to the matrix scale, to count as singular. */
const DET_EPSILON = 1e-12;

/**
 * Hard ceiling on solver passes. Each pass pins exactly one thruster, so a
 * layout needs no more passes than it has thrusters; this only guards against a
 * pathological layout on a very large ship.
 */
const MAX_PASSES = 64;


export class ThrusterLayout {
  readonly count: number;

  /** Mount points and directions, body frame. */
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly dirX: Float64Array;
  readonly dirY: Float64Array;
  readonly maxThrust: Float64Array;

  /**
   * Full-throttle wrench per thruster — the columns of the allocation matrix.
   * Precomputed because the geometry cannot change without rebuilding.
   */
  readonly wfx: Float64Array;
  readonly wfy: Float64Array;
  readonly wt: Float64Array;

  /**
   * The torque column divided by the layout's characteristic length, so that
   * the force and torque blocks of the normal equations carry equal weight.
   * The solve runs on these; the wrench reported to the caller is computed from
   * the unscaled columns, so preconditioning never leaks into the answer.
   */
  readonly wts: Float64Array;
  /** Reciprocal of that characteristic length. */
  readonly torqueScale: number;

  /** Inverse normal equations over every thruster, for the unsaturated case. */
  private readonly inv = new Float64Array(6);

  /**
   * Scratch for `allocate`. Held here rather than allocated per call: this is
   * the most frequent computation in the ship update, and it is written and
   * read inside a single synchronous call, so there is nothing to interleave
   * with. Ships sharing a blueprint share a layout and therefore this scratch,
   * which is safe for the same reason.
   */
  private readonly pinned: Uint8Array;
  /** Indices still free this pass; refilled each pass, never allocated. */
  private readonly freeIdx: Int32Array;

  constructor(specs: readonly ThrusterSpec[]) {
    const n = specs.length;
    this.count = n;
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.dirX = new Float64Array(n);
    this.dirY = new Float64Array(n);
    this.maxThrust = new Float64Array(n);
    this.wfx = new Float64Array(n);
    this.wfy = new Float64Array(n);
    this.wt = new Float64Array(n);
    this.wts = new Float64Array(n);
    this.pinned = new Uint8Array(n);
    this.freeIdx = new Int32Array(n);

    for (let i = 0; i < n; i++) {
      const s = specs[i]!;
      const len = sqrt(s.dirX * s.dirX + s.dirY * s.dirY);
      // A thruster with no direction produces nothing rather than a NaN.
      const ux = len > 0 ? s.dirX / len : 0;
      const uy = len > 0 ? s.dirY / len : 0;
      const t = s.maxThrust;

      this.px[i] = s.x;
      this.py[i] = s.y;
      this.dirX[i] = ux;
      this.dirY[i] = uy;
      this.maxThrust[i] = t;

      this.wfx[i] = t * ux;
      this.wfy[i] = t * uy;
      // Torque about the centre of mass: r × F.
      this.wt[i] = t * (s.x * uy - s.y * ux);
    }

    // Characteristic length: the value of L for which Σ(wt/L)² equals
    // Σ(wfx² + wfy²), so neither block dominates the other.
    let forceSq = 0;
    let torqueSq = 0;
    for (let i = 0; i < n; i++) {
      forceSq += this.wfx[i] * this.wfx[i] + this.wfy[i] * this.wfy[i];
      torqueSq += this.wt[i] * this.wt[i];
    }
    // A layout with no torque authority, or none at all, needs no scaling: its
    // torque column is zero, so any factor gives the same zeros.
    this.torqueScale = forceSq > 0 && torqueSq > 0 ? sqrt(forceSq / torqueSq) : 1;
    for (let i = 0; i < n; i++) this.wts[i] = this.wt[i] * this.torqueScale;

    this.buildInverse(this.inv, -1);
  }

  /**
   * Invert the normal equations `A Aᵀ + λI` over the thrusters not pinned this
   * pass. `pass < 0` means "every thruster", used for the precomputed case.
   */
  private buildInverse(out: Float64Array, pass: number): void {
    let a = 0;
    let b = 0;
    let c = 0;
    let d = 0;
    let e = 0;
    let f = 0;
    for (let i = 0; i < this.count; i++) {
      if (pass >= 0 && this.pinned[i] === 1) continue;
      const x = this.wfx[i];
      const y = this.wfy[i];
      const t = this.wts[i];
      a += x * x;
      b += x * y;
      c += x * t;
      d += y * y;
      e += y * t;
      f += t * t;
    }

    // The ridge is applied only if the matrix is actually singular, and it is
    // scaled to the matrix so it behaves the same at any ship size. Applying it
    // unconditionally would bias every layout, including the well-behaved ones:
    // the error is roughly the ridge over the diagonal, which is small but not
    // small enough to be free.
    const scale = (a + d + f) / 3;
    const singularityThreshold = DET_EPSILON * scale * scale * scale;

    for (let attempt = 0; attempt < 2; attempt++) {
      const lambda = attempt === 0 ? 0 : RIDGE * scale + Number.MIN_VALUE;
      const A = a + lambda;
      const D = d + lambda;
      const F = f + lambda;

      const c00 = D * F - e * e;
      const c01 = c * e - b * F;
      const c02 = b * e - c * D;
      const det = A * c00 + b * c01 + c * c02;

      // A layout that cannot span all three axes gives a singular matrix — no
      // torque authority makes the torque row vanish entirely. One more attempt
      // with a ridge turns that into a graceful least-squares answer.
      if (attempt === 0 && (det < 0 ? -det : det) <= singularityThreshold) continue;

      const invDet = det !== 0 ? 1 / det : 0;
      out[0] = c00 * invDet;
      out[1] = c01 * invDet;
      out[2] = c02 * invDet;
      out[3] = (A * F - c * c) * invDet;
      out[4] = (b * c - A * e) * invDet;
      out[5] = (A * D - b * b) * invDet;
      return;
    }
  }

  private readonly passInv = new Float64Array(6);

  /**
   * Choose throttles delivering as much of the demanded body-frame wrench as
   * the layout can, writing them into `throttles` and the result into `out`.
   *
   * Least squares first, then **redistribution**: any thruster whose throttle
   * came out below 0 or above 1 is pinned at that bound, its contribution is
   * taken off the demand, and the rest are solved again. Each pass pins at
   * least one thruster, so this terminates.
   *
   * When the demand is beyond the layout, the result is whatever the clamped
   * solve produced — which is *not* the same as the demand scaled down, and may
   * point somewhere slightly different. `out.fx/fy/torque` report what was
   * actually produced, so a pilot that cares can compare and reduce its ask.
   *
   * Redistribution is a **heuristic, not an exact solver**, and it can fall
   * short of a demand that is strictly achievable. A thruster pinned at a bound
   * is never released, so an early guess is never revisited. Measured across
   * randomised layouts with full authority: **mean shortfall 0.016%, worst
   * 5.4%** of the demand. Randomised geometry is close to adversarial — real
   * layouts, where thrusters are placed on purpose, sit far better than that.
   *
   * Making it exact means bounded-variable least squares: releasing pinned
   * thrusters when the gradient says they would help, with a line search to
   * guarantee progress. Releasing *without* the line search was tried and is
   * worse than not releasing at all — the active set oscillates, pinning and
   * unpinning the same thruster until the pass budget runs out, which took the
   * worst case from 5% to 234%. Recorded in §12.
   */
  allocate(
    demandFx: number,
    demandFy: number,
    demandTorque: number,
    throttles: Float64Array,
    out: Allocation,
  ): void {
    const n = this.count;
    out.saturated = false;
    out.passes = 0;
    for (let i = 0; i < n; i++) {
      throttles[i] = 0;
      this.pinned[i] = 0;
    }
    if (n === 0) {
      out.fx = 0;
      out.fy = 0;
      out.torque = 0;
      return;
    }

    // Demand still to be met, after the contribution of anything pinned at 1.
    // Torque is carried in preconditioned units throughout the solve.
    let rx = demandFx;
    let ry = demandFy;
    let rt = demandTorque * this.torqueScale;

    const passLimit = n + 1 < MAX_PASSES ? n + 1 : MAX_PASSES;
    for (let pass = 0; pass < passLimit; pass++) {
      out.passes = pass + 1;

      let k = 0;
      for (let i = 0; i < n; i++) if (this.pinned[i] === 0) this.freeIdx[k++] = i;
      if (k === 0) break;

      // Which normal equations apply depends on how many thrusters are left.
      //
      //   k >= 3  the system is underdetermined: many throttle combinations
      //           give the demanded wrench, and the minimum-norm one is wanted.
      //           That is the 3x3 `A Aᵀ` form.
      //   k < 3   the system is overdetermined: the demand generally cannot be
      //           met at all, and the closest approach is wanted. That is the
      //           k x k `Aᵀ A` form. Using the 3x3 form here was a real bug —
      //           it is singular with fewer than three columns, so the ridge
      //           took over and returned something numerically arbitrary.
      let violated = false;

      if (k < 3) {
        violated = this.solveOverdetermined(k, rx, ry, rt, throttles);
        if (violated) {
          // Recompute the residual from scratch: solveOverdetermined pins as it
          // goes, and anything pinned at full throttle has taken its share.
          rx = demandFx;
          ry = demandFy;
          rt = demandTorque * this.torqueScale;
          for (let i = 0; i < n; i++) {
            if (this.pinned[i] === 1 && throttles[i]! === 1) {
              rx -= this.wfx[i];
              ry -= this.wfy[i];
              rt -= this.wts[i];
            }
          }
          continue;
        }
        break;
      }

      const usePrecomputed = pass === 0 && k === n;
      const m = usePrecomputed ? this.inv : this.passInv;
      if (!usePrecomputed) this.buildInverse(this.passInv, pass);

      // y = (A Aᵀ + λI)⁻¹ r, then u = Aᵀ y is the minimum-norm solution.
      const y0 = m[0]! * rx + m[1]! * ry + m[2]! * rt;
      const y1 = m[1]! * rx + m[3]! * ry + m[4]! * rt;
      const y2 = m[2]! * rx + m[4]! * ry + m[5]! * rt;

      // Pin only the *worst* violator, then solve again. Pinning every
      // violator at once collapses a nine-thruster layout to two in a single
      // pass and never reconsiders them, which is how an easily achievable
      // demand ended up missed by more than 100%. One at a time is what makes
      // this an active-set method rather than a guess.
      let worstIndex = -1;
      let worstAmount = 0;
      let worstAtFull = false;

      for (let i = 0; i < n; i++) {
        if (this.pinned[i] === 1) continue;
        const u = this.wfx[i] * y0 + this.wfy[i] * y1 + this.wts[i] * y2;
        throttles[i] = u;
        if (u < 0) {
          if (-u > worstAmount) {
            worstAmount = -u;
            worstIndex = i;
            worstAtFull = false;
          }
        } else if (u > 1) {
          if (u - 1 > worstAmount) {
            worstAmount = u - 1;
            worstIndex = i;
            worstAtFull = true;
          }
        }
      }

      if (worstIndex < 0) {
        violated = false;
      } else {
        violated = true;
        this.pinned[worstIndex] = 1;
        if (worstAtFull) {
          throttles[worstIndex] = 1;
          rx -= this.wfx[worstIndex];
          ry -= this.wfy[worstIndex];
          rt -= this.wts[worstIndex];
        } else {
          throttles[worstIndex] = 0;
        }
      }

      if (!violated) break;
    }

    // Exhausting the pass budget would otherwise leave the last pass's
    // provisional values in place, so guarantee the bound here rather than
    // relying on the loop having converged.
    for (let i = 0; i < n; i++) {
      const u = throttles[i]!;
      if (u < 0) throttles[i] = 0;
      else if (u > 1) throttles[i] = 1;
    }

    // Report what the throttles actually produce, rather than what was asked
    // for or what the solve believed: the two part company under saturation.
    let fx = 0;
    let fy = 0;
    let torque = 0;
    for (let i = 0; i < n; i++) {
      const u = throttles[i]!;
      // Read from the answer rather than from the pinning decisions: a throttle
      // that lands exactly on 1 is at the limit just as much as one that had to
      // be pulled back to it.
      if (u >= 1) out.saturated = true;
      fx += this.wfx[i] * u;
      fy += this.wfy[i] * u;
      torque += this.wt[i] * u;
    }
    out.fx = fx;
    out.fy = fy;
    out.torque = torque;
  }

  /**
   * Least squares over one or two free thrusters: minimise ‖A u − r‖² rather
   * than ‖u‖². Returns true if any throttle had to be pinned at a bound.
   */
  private solveOverdetermined(
    k: number,
    rx: number,
    ry: number,
    rt: number,
    throttles: Float64Array,
  ): boolean {
    const i0 = this.freeIdx[0]!;
    const a0x = this.wfx[i0];
    const a0y = this.wfy[i0];
    const a0t = this.wts[i0];

    if (k === 1) {
      const denominator = a0x * a0x + a0y * a0y + a0t * a0t;
      const u = denominator > 0 ? (a0x * rx + a0y * ry + a0t * rt) / denominator : 0;
      return this.place(i0, u, throttles);
    }

    const i1 = this.freeIdx[1]!;
    const a1x = this.wfx[i1];
    const a1y = this.wfy[i1];
    const a1t = this.wts[i1];

    const g00 = a0x * a0x + a0y * a0y + a0t * a0t;
    const g01 = a0x * a1x + a0y * a1y + a0t * a1t;
    const g11 = a1x * a1x + a1y * a1y + a1t * a1t;
    const b0 = a0x * rx + a0y * ry + a0t * rt;
    const b1 = a1x * rx + a1y * ry + a1t * rt;

    const det = g00 * g11 - g01 * g01;
    // Two parallel columns leave the split between them undetermined; give the
    // whole job to the first, which the redistribution pass can then correct.
    let u0: number;
    let u1: number;
    if (det > DET_EPSILON * (g00 * g11 + Number.MIN_VALUE)) {
      u0 = (g11 * b0 - g01 * b1) / det;
      u1 = (g00 * b1 - g01 * b0) / det;
    } else {
      u0 = g00 > 0 ? b0 / g00 : 0;
      u1 = 0;
    }

    // Both are placed before returning, so a single pass can pin either or both.
    const violated0 = this.place(i0, u0, throttles);
    const violated1 = this.place(i1, u1, throttles);
    return violated0 || violated1;
  }

  /** Write a throttle, pinning it if it fell outside its bounds. */
  private place(i: number, u: number, throttles: Float64Array): boolean {
    if (u < 0) {
      this.pinned[i] = 1;
      throttles[i] = 0;
      return true;
    }
    if (u > 1) {
      this.pinned[i] = 1;
      throttles[i] = 1;
      return true;
    }
    throttles[i] = u;
    return false;
  }

  /**
   * The furthest this layout can push in a direction through wrench space —
   * the support function of the achievable set.
   *
   * The achievable wrenches form a **zonotope**: the set of `A u` for `u` in
   * the unit cube, which is the Minkowski sum of one segment per thruster. Its
   * support function is therefore just `Σ max(0, aᵢ · d)`, exact and linear in
   * the thruster count, with no vertices to enumerate.
   *
   * This is what draws the manoeuvring envelope for the player (DESIGN.md §4):
   * sample directions, and each answer is a supporting plane of the true shape.
   * Pass a unit direction to read the answer in newtons or newton-metres.
   */
  support(dirFx: number, dirFy: number, dirTorque: number): number {
    let total = 0;
    for (let i = 0; i < this.count; i++) {
      const projection = this.wfx[i] * dirFx + this.wfy[i] * dirFy + this.wt[i] * dirTorque;
      if (projection > 0) total += projection;
    }
    return total;
  }

  /** Greatest force available along a body-frame direction, ignoring torque. */
  maxThrustAlong(dirX: number, dirY: number): number {
    const len = sqrt(dirX * dirX + dirY * dirY);
    if (len === 0) return 0;
    return this.support(dirX / len, dirY / len, 0);
  }

  /** Greatest torque available in the given sense (+1 or −1), ignoring force. */
  maxTorque(sense: number): number {
    return this.support(0, 0, sense >= 0 ? 1 : -1);
  }

  /**
   * Whether the layout can produce force on both axes and torque in both
   * senses. A layout failing this cannot hold an arbitrary heading while
   * translating, which is a design error worth surfacing in the editor rather
   * than leaving the player to discover in battle.
   */
  hasFullAuthority(): boolean {
    return (
      this.support(1, 0, 0) > 0 &&
      this.support(-1, 0, 0) > 0 &&
      this.support(0, 1, 0) > 0 &&
      this.support(0, -1, 0) > 0 &&
      this.support(0, 0, 1) > 0 &&
      this.support(0, 0, -1) > 0
    );
  }
}

/**
 * Apply an allocated body-frame wrench to a body.
 *
 * One rotation for the whole ship rather than one per thruster: the allocation
 * has already summed them, and `Bodies.applyLocalForceAtLocalPoint` would take
 * a sine and cosine of the same angle for every thruster in the layout.
 */
export function applyAllocation(bodies: Bodies, id: BodyId, allocation: Allocation): void {
  bodies.applyLocalWrench(id, allocation.fx, allocation.fy, allocation.torque);
}

/**
 * How far the produced wrench falls short of the demand, as a fraction of the
 * demand's size. Zero when the demand was met. Useful to a pilot deciding
 * whether to ask for less, and to the editor when reporting a weak layout.
 */
export function shortfall(
  demandFx: number,
  demandFy: number,
  demandTorque: number,
  out: Allocation,
): number {
  const dx = demandFx - out.fx;
  const dy = demandFy - out.fy;
  const dt = demandTorque - out.torque;
  const errorSize = sqrt(dx * dx + dy * dy + dt * dt);
  const demandSize = sqrt(
    demandFx * demandFx + demandFy * demandFy + demandTorque * demandTorque,
  );
  if (demandSize === 0) return errorSize > 0 ? 1 : 0;
  return errorSize / demandSize;
}
