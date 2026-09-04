import type { Bodies } from './bodies.js';
import { abs, angleDelta, atan2, clamp, cos, max, min, normalizeAngle, PI, sin, sqrt } from './math.js';

/**
 * Turrets: mounts that slew to a bearing and report when they are on target.
 *
 * **Kinematically, not through the physics.** A turret's bearing is a number
 * that moves toward where it is pointed under a rate limit and an acceleration
 * limit, and the reaction the hull feels is computed from that directly. There
 * is no hinge, no motor and no rigid body.
 *
 * The old Unity prototype did the opposite, and it is the clearest cautionary
 * tale in the archive. Each turret was three rigid bodies joined by two hinges,
 * driven by `JointMotor.targetVelocity` set from a proportional term with no
 * derivative — and the gains were handed to the *genetic algorithm* to search.
 * Asking a GA to find stable PD gains for a jointed chain through a constraint
 * solver produces exactly what it produced: enormous torques, violent damping,
 * and turrets that lock up trying to traverse the long way round. See
 * DESIGN.md §10.
 *
 * What replaces it is a **braking-limited slew**. Each step the turret works
 * out the fastest rate from which it could still stop exactly on target —
 * `sqrt(2·a·|error|)` — takes the lesser of that and its rate limit, and moves
 * its actual rate toward that figure under its acceleration limit. No gains, no
 * tuning, no overshoot, and it arrives in the shortest time the limits allow.
 * The behaviour is a property of the mount's specification rather than of a
 * search over coefficients.
 *
 * The reaction torque on the hull is `−I·β̈`: the internal torque pair between
 * turret and hull. So a heavy turret slewing hard visibly yaws a small ship,
 * which is the realism the jointed version was reaching for, at no cost.
 */

/**
 * Floor on the bearing error below which a turret counts as on target. About
 * 0.06°, and finer than any gunnery cares about.
 *
 * It is only a floor. Braking half a step early leaves the turret parked within
 * `a·dt²/8` of its target, so a mount with violent acceleration cannot point
 * more finely than its own discretisation — claiming otherwise would leave it
 * stopped just outside tolerance, never reporting ready, and never firing. The
 * effective tolerance is therefore widened per turret to suit its acceleration.
 */
const ON_TARGET_FLOOR = 0.001;

export interface TurretSpec {
  /** Body *index* this turret is mounted on. */
  owner: number;
  /** Mount point in body frame, metres. */
  x: number;
  y: number;
  /** Bearing it points to when idle, body frame. */
  restBearing?: number;
  /**
   * Half-width of the traverse arc about `restBearing`, radians. At or above π
   * the turret traverses fully — the arc is what the ship's own superstructure
   * leaves it (DESIGN.md §3).
   */
  arc?: number;
  /** Traverse rate limit, radians per second. */
  maxRate: number;
  /** Traverse acceleration limit, radians per second squared. */
  maxAccel: number;
  /** Moment of inertia of the moving part, kg·m², for the hull reaction. */
  inertia?: number;
  /** Muzzle velocity of what it fires, metres per second, for lead. */
  muzzleSpeed?: number;
  /** Distance from mount to muzzle along the barrel, metres. */
  muzzleOffset?: number;
}

/** Where a turret's shot starts and which way it goes. Filled in place. */
export class FiringSolution {
  x = 0;
  y = 0;
  /** Unit vector along the barrel, world frame. */
  dirX = 0;
  dirY = 0;
  /** World bearing of the barrel, radians. */
  bearing = 0;
}

/**
 * Time for a projectile leaving now at `speed` to meet a target moving at a
 * constant velocity, or -1 if it never can.
 *
 * Solves `|d + v·t| = speed·t` for the earliest positive `t` — a quadratic. A
 * target running away faster than the shot flies gives no solution, which is
 * the honest answer rather than an aim point that cannot be hit.
 *
 * `dx, dy` is target minus shooter; `dvx, dvy` is target velocity minus
 * shooter's, so a shot inherits the firing ship's motion.
 */
export function interceptTime(
  dx: number,
  dy: number,
  dvx: number,
  dvy: number,
  speed: number,
): number {
  const a = dvx * dvx + dvy * dvy - speed * speed;
  const b = 2 * (dx * dvx + dy * dvy);
  const c = dx * dx + dy * dy;

  if (c === 0) return 0;

  // Closing speed exactly matches the projectile speed: the quadratic degrades
  // to a linear equation.
  if (abs(a) < 1e-12) {
    if (abs(b) < 1e-12) return -1;
    const t = -c / b;
    return t >= 0 ? t : -1;
  }

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return -1;

  const root = sqrt(discriminant);
  const t0 = (-b - root) / (2 * a);
  const t1 = (-b + root) / (2 * a);

  // The earliest non-negative root: the first moment the shot can arrive.
  const lo = t0 < t1 ? t0 : t1;
  const hi = t0 < t1 ? t1 : t0;
  if (lo >= 0) return lo;
  if (hi >= 0) return hi;
  return -1;
}

export class Turrets {
  owner!: Int32Array;
  mountX!: Float64Array;
  mountY!: Float64Array;
  restBearing!: Float64Array;
  arc!: Float64Array;
  maxRate!: Float64Array;
  maxAccel!: Float64Array;
  inertia!: Float64Array;
  muzzleSpeed!: Float64Array;
  muzzleOffset!: Float64Array;

  /** Current bearing, body frame. */
  bearing!: Float64Array;
  /** Current traverse rate, radians per second, relative to the hull. */
  rate!: Float64Array;
  /** Bearing being slewed toward, body frame, already clamped to the arc. */
  commanded!: Float64Array;

  /** 1 when the bearing is within tolerance of `commanded`. */
  onTarget!: Uint8Array;
  /**
   * Bearing error this turret counts as on target: the floor above, or its own
   * discretisation limit if that is coarser. Refined on the first step, once
   * the timestep is known.
   */
  tolerance!: Float64Array;
  /**
   * 1 when the last aim command lay outside the traverse arc. The turret slews
   * as close as it can, but a caller must not read `onTarget` as "may fire":
   * both have to hold.
   */
  blocked!: Uint8Array;
  alive!: Uint8Array;

  capacity = 0;
  count = 0;
  highWater = 0;

  private free: number[] = [];

  constructor(initialCapacity = 128) {
    this.grow(initialCapacity);
  }

  private grow(capacity: number): void {
    const f64 = (old: Float64Array | undefined): Float64Array => {
      const next = new Float64Array(capacity);
      if (old) next.set(old);
      return next;
    };
    const i32 = (old: Int32Array | undefined): Int32Array => {
      const next = new Int32Array(capacity);
      if (old) next.set(old);
      return next;
    };
    const u8 = (old: Uint8Array | undefined): Uint8Array => {
      const next = new Uint8Array(capacity);
      if (old) next.set(old);
      return next;
    };

    this.owner = i32(this.owner);
    this.mountX = f64(this.mountX);
    this.mountY = f64(this.mountY);
    this.restBearing = f64(this.restBearing);
    this.arc = f64(this.arc);
    this.maxRate = f64(this.maxRate);
    this.maxAccel = f64(this.maxAccel);
    this.inertia = f64(this.inertia);
    this.muzzleSpeed = f64(this.muzzleSpeed);
    this.muzzleOffset = f64(this.muzzleOffset);
    this.bearing = f64(this.bearing);
    this.rate = f64(this.rate);
    this.commanded = f64(this.commanded);
    this.onTarget = u8(this.onTarget);
    this.tolerance = f64(this.tolerance);
    this.blocked = u8(this.blocked);
    this.alive = u8(this.alive);

    this.capacity = capacity;
  }

  add(spec: TurretSpec): number {
    let i: number;
    const reused = this.free.pop();
    if (reused !== undefined) {
      i = reused;
    } else {
      if (this.highWater >= this.capacity) this.grow(this.capacity * 2);
      i = this.highWater++;
    }

    const rest = normalizeAngle(spec.restBearing ?? 0);
    this.owner[i] = spec.owner;
    this.mountX[i] = spec.x;
    this.mountY[i] = spec.y;
    this.restBearing[i] = rest;
    this.arc[i] = spec.arc ?? PI;
    this.maxRate[i] = spec.maxRate;
    this.maxAccel[i] = spec.maxAccel;
    this.inertia[i] = spec.inertia ?? 0;
    this.muzzleSpeed[i] = spec.muzzleSpeed ?? 0;
    this.muzzleOffset[i] = spec.muzzleOffset ?? 0;
    this.bearing[i] = rest;
    this.rate[i] = 0;
    this.commanded[i] = rest;
    this.onTarget[i] = 1;
    this.tolerance[i] = ON_TARGET_FLOOR;
    this.blocked[i] = 0;
    this.alive[i] = 1;
    this.count++;
    return i;
  }

  remove(i: number): void {
    if (i < 0 || i >= this.highWater || this.alive[i] === 0) return;
    this.alive[i] = 0;
    this.free.push(i);
    this.count--;
  }

  /** Clamp a body-frame bearing into this turret's traverse arc. */
  private clampToArc(i: number, bodyBearing: number): number {
    const halfWidth = this.arc[i];
    if (halfWidth >= PI) return normalizeAngle(bodyBearing);
    const rest = this.restBearing[i];
    const offset = angleDelta(rest, bodyBearing);
    return normalizeAngle(rest + clamp(offset, -halfWidth, halfWidth));
  }

  /**
   * Set the commanded bearing and refresh `onTarget` at once, so the flag never
   * describes a command that has been superseded. Without this a caller reading
   * `onTarget` straight after commanding a new bearing would be told the turret
   * was already there.
   */
  private setCommand(i: number, allowed: number): void {
    this.commanded[i] = allowed;
    this.onTarget[i] = abs(angleDelta(this.bearing[i]!, allowed)) <= this.tolerance[i]! ? 1 : 0;
  }

  /** Point at a world bearing, clamped to the arc. Sets `blocked` if it had to clamp. */
  commandWorldBearing(bodies: Bodies, i: number, worldBearing: number): void {
    const b = this.owner[i];
    const wanted = normalizeAngle(worldBearing - bodies.angle[b]!);
    const allowed = this.clampToArc(i, wanted);
    this.setCommand(i, allowed);
    this.blocked[i] = abs(angleDelta(allowed, wanted)) > this.tolerance[i]! ? 1 : 0;
  }

  /** Give up and return to the idle bearing. */
  returnToRest(i: number): void {
    this.setCommand(i, this.restBearing[i]!);
    this.blocked[i] = 0;
  }

  /**
   * Aim at a moving target, leading it by the projectile's flight time.
   *
   * The lead is computed from the *mount* rather than the muzzle: using the
   * muzzle would be circular, since where the muzzle is depends on the bearing
   * being solved for, and the offset is negligible beside any real range.
   *
   * Returns the intercept time, or -1 if the target cannot be caught — in which
   * case the turret is left pointing at the target's present position, which is
   * the best available guess and keeps it tracking.
   */
  aimAt(
    bodies: Bodies,
    i: number,
    targetX: number,
    targetY: number,
    targetVx: number,
    targetVy: number,
  ): number {
    const b = this.owner[i];
    const angle = bodies.angle[b]!;
    const c = cos(angle);
    const s = sin(angle);
    // Mount position in world coordinates.
    const mx = bodies.x[b]! + this.mountX[i]! * c - this.mountY[i]! * s;
    const my = bodies.y[b]! + this.mountX[i]! * s + this.mountY[i]! * c;

    const dx = targetX - mx;
    const dy = targetY - my;
    const speed = this.muzzleSpeed[i]!;

    let aimX = dx;
    let aimY = dy;
    let t = -1;
    if (speed > 0) {
      t = interceptTime(dx, dy, targetVx - bodies.vx[b]!, targetVy - bodies.vy[b]!, speed);
      if (t > 0) {
        aimX = dx + (targetVx - bodies.vx[b]!) * t;
        aimY = dy + (targetVy - bodies.vy[b]!) * t;
      }
    }

    this.commandWorldBearing(bodies, i, atan2(aimY, aimX));
    return t;
  }

  /**
   * Slew every turret one step and apply the reaction to its hull.
   *
   * The rate chosen is the fastest that can still stop exactly on target,
   * `sqrt(2·a·|error|)`, capped by the rate limit — then the actual rate moves
   * toward it under the acceleration limit. That is what makes this arrive
   * without overshoot and without any gain to tune.
   */
  step(dt: number, bodies: Bodies): void {
    for (let i = 0; i < this.highWater; i++) {
      if (this.alive[i] === 0) continue;

      const error = angleDelta(this.bearing[i]!, this.commanded[i]!);
      const accel = this.maxAccel[i]!;
      const rateLimit = this.maxRate[i]!;

      // The dead band left by braking early is `accel·dt²/8`; the tolerance has
      // to sit outside it or the turret parks just short and never reports
      // ready. A factor of two above gives margin without being generous.
      const tolerance = max(ON_TARGET_FLOOR, (accel * dt * dt) / 4);
      this.tolerance[i] = tolerance;

      // Fastest rate from which the remaining error can still be braked out,
      // less half a step's worth of acceleration. Braking exactly on the
      // continuous limit `sqrt(2·a·|e|)` overshoots slightly once time is
      // discrete, and correcting that by clamping the rate at the last moment
      // would break the acceleration limit — which is a property of the mount,
      // not a guideline. Starting to brake half a step early keeps both.
      const brakingRate = max(0, sqrt(2 * accel * abs(error)) - 0.5 * accel * dt);
      const desired = (error >= 0 ? 1 : -1) * min(brakingRate, rateLimit);

      const previousRate = this.rate[i]!;
      const maxChange = accel * dt;
      let next = desired;
      if (desired - previousRate > maxChange) next = previousRate + maxChange;
      else if (desired - previousRate < -maxChange) next = previousRate - maxChange;

      this.bearing[i] = normalizeAngle(this.bearing[i]! + next * dt);
      this.rate[i] = next;
      this.onTarget[i] =
        abs(angleDelta(this.bearing[i]!, this.commanded[i]!)) <= tolerance ? 1 : 0;

      // Reaction on the hull: the internal torque pair, −I·β̈. A heavy turret
      // slewing hard yaws a light ship, which is the point.
      const inertia = this.inertia[i]!;
      if (inertia > 0 && dt > 0) {
        const angularAccel = (next - previousRate) / dt;
        if (angularAccel !== 0) {
          bodies.torque[this.owner[i]!] -= inertia * angularAccel;
        }
      }
    }
  }

  /** World bearing of the barrel. */
  worldBearing(bodies: Bodies, i: number): number {
    return normalizeAngle(this.bearing[i]! + bodies.angle[this.owner[i]!]!);
  }

  /**
   * Where a shot from this turret starts and which way it travels, filled into
   * `out`. One rotation for the mount and one for the barrel, no allocation.
   */
  firingSolution(bodies: Bodies, i: number, out: FiringSolution): void {
    const b = this.owner[i]!;
    const angle = bodies.angle[b]!;
    const c = cos(angle);
    const s = sin(angle);
    const mx = bodies.x[b]! + this.mountX[i]! * c - this.mountY[i]! * s;
    const my = bodies.y[b]! + this.mountX[i]! * s + this.mountY[i]! * c;

    const world = normalizeAngle(this.bearing[i]! + angle);
    const dirX = cos(world);
    const dirY = sin(world);
    const offset = this.muzzleOffset[i]!;

    out.bearing = world;
    out.dirX = dirX;
    out.dirY = dirY;
    out.x = mx + dirX * offset;
    out.y = my + dirY * offset;
  }

  /** Whether this turret may shoot: on target, and the target within its arc. */
  readyToFire(i: number): boolean {
    return this.alive[i] === 1 && this.onTarget[i] === 1 && this.blocked[i] === 0;
  }
}
