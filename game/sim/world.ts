import { Bodies, type BodyId, type BodySpec } from './bodies.js';
import { normalizeAngle } from './math.js';
import { Rng } from './rng.js';

/**
 * A source of forces, run once per step after positions have been advanced.
 * Gravity wells, thrusters, drag zones and tractor beams are all providers.
 */
export type ForceProvider = (world: World) => void;

export interface WorldOptions {
  /**
   * Seconds of simulated time per step. Fixed for the lifetime of the world:
   * a variable timestep makes the simulation unreproducible, so the caller
   * accumulates real time and decides how many steps to run, rather than
   * passing a delta in (DESIGN.md non-negotiable 2).
   */
  dt: number;
  seed: number;
  initialCapacity?: number;
}

/**
 * The simulation world.
 *
 * Integration is kick-drift-kick leapfrog: velocities take a half step on the
 * old acceleration, positions take a full step, forces are re-evaluated, and
 * velocities take a half step on the new acceleration.
 *
 * This is second-order and symplectic, which matters because gravity wells are
 * in scope. Explicit Euler gains energy without bound and would spiral orbits
 * outward; symplectic Euler is stable but only first-order, so orbits visibly
 * precess. Leapfrog keeps both the orbital energy and the apsides where they
 * should be for the cost of retaining one acceleration per body.
 *
 * Thrust and drag depend on velocity, so the scheme is not strictly symplectic
 * once they are in play. That is fine and normal — what has to be well behaved
 * over thousands of steps is the position-dependent part, which is gravity.
 */
export class World {
  readonly dt: number;
  readonly bodies: Bodies;
  readonly rng: Rng;

  /** Steps elapsed. Simulated time is `tick * dt`. */
  tick = 0;

  private providers: ForceProvider[] = [];
  private primed = false;

  constructor(options: WorldOptions) {
    if (!(options.dt > 0)) {
      throw new Error(`World: dt must be positive, got ${options.dt}`);
    }
    this.dt = options.dt;
    this.bodies = new Bodies(options.initialCapacity ?? 256);
    this.rng = new Rng(options.seed);
  }

  addForceProvider(provider: ForceProvider): void {
    this.providers.push(provider);
    this.primed = false;
  }

  /**
   * Create a body. Invalidates the leapfrog priming, so the next step
   * re-evaluates forces before its first half-kick — otherwise a body created
   * mid-battle would take its first half step with a stale zero acceleration.
   */
  spawn(spec?: BodySpec): BodyId {
    const id = this.bodies.create(spec);
    this.primed = false;
    return id;
  }

  destroy(id: BodyId): void {
    this.bodies.destroy(id);
    this.primed = false;
  }

  /** Evaluate forces and accelerations at the current positions. */
  private prime(): void {
    this.evaluateForces();
    this.deriveAccelerations();
    this.primed = true;
  }

  private evaluateForces(): void {
    this.bodies.clearForces();
    for (let i = 0; i < this.providers.length; i++) {
      this.providers[i]!(this);
    }
  }

  private deriveAccelerations(): void {
    const b = this.bodies;
    const n = b.highWater;
    for (let i = 0; i < n; i++) {
      if (b.alive[i] === 0) continue;
      const im = b.invMass[i];
      b.ax[i] = b.fx[i] * im;
      b.ay[i] = b.fy[i] * im;
      b.angularAcc[i] = b.torque[i] * b.invInertia[i];
    }
  }

  step(): void {
    if (!this.primed) this.prime();

    const b = this.bodies;
    const dt = this.dt;
    const half = dt * 0.5;
    const n = b.highWater;

    // Kick: half step on the acceleration from the end of the previous step.
    for (let i = 0; i < n; i++) {
      if (b.alive[i] === 0) continue;
      b.vx[i] += b.ax[i] * half;
      b.vy[i] += b.ay[i] * half;
      b.angularVel[i] += b.angularAcc[i] * half;
    }

    // Drift: full step on position. Angles are re-normalised every step so
    // that the range reduction in sin/cos never sees a large argument.
    for (let i = 0; i < n; i++) {
      if (b.alive[i] === 0) continue;
      b.x[i] += b.vx[i] * dt;
      b.y[i] += b.vy[i] * dt;
      b.angle[i] = normalizeAngle(b.angle[i] + b.angularVel[i] * dt);
    }

    // Re-evaluate at the new positions.
    this.evaluateForces();
    this.deriveAccelerations();

    // Kick: half step on the new acceleration.
    for (let i = 0; i < n; i++) {
      if (b.alive[i] === 0) continue;
      b.vx[i] += b.ax[i] * half;
      b.vy[i] += b.ay[i] * half;
      b.angularVel[i] += b.angularAcc[i] * half;
    }

    this.tick++;
  }

  /** Run `count` steps. */
  run(count: number): void {
    for (let i = 0; i < count; i++) this.step();
  }

  /** Total kinetic energy. Diagnostic; used by the integrator tests. */
  kineticEnergy(): number {
    const b = this.bodies;
    let e = 0;
    for (let i = 0; i < b.highWater; i++) {
      if (b.alive[i] === 0) continue;
      e += 0.5 * b.mass[i] * (b.vx[i] * b.vx[i] + b.vy[i] * b.vy[i]);
      e += 0.5 * b.inertia[i] * b.angularVel[i] * b.angularVel[i];
    }
    return e;
  }
}
