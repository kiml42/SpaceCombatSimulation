import { Bodies, type BodyId } from './bodies.js';
import type { ShipDesign } from './blueprint.js';
import {
  atan2,
  angleDelta,
  brakingRate,
  clamp,
  cos,
  length,
  sin,
} from './math.js';
import { Projectiles } from './projectiles.js';
import { Allocation } from './thrusters.js';
import { FiringSolution, Turrets } from './turrets.js';
import type { World } from './world.js';

/**
 * Ships: a compiled design bound to a body, flying itself and shooting.
 *
 * This is the layer that turns the derived numbers into behaviour. A design
 * says what a ship *is* — its mass, where its thrusters point, what its guns
 * throw and how far each mount can train. A ship is one instance of that: a
 * body in the world, a set of throttles, a set of turrets, and an order.
 *
 * **Designs are shared, ships are not.** A hundred strike craft off one
 * blueprint hold one `ShipDesign` between them and one thruster matrix; what
 * each carries of its own is the state that differs — throttles, gun timers
 * and where it has been told to go.
 *
 * ## Step order
 *
 * The order below is not a matter of taste; three of the four steps are wrong
 * anywhere else.
 *
 * ```
 * ships.command(dt, world);        // pilot, allocation, turret aim and slew
 * world.step();                    // integrate; the force provider applies what command decided
 * grid.rebuild(world.bodies);      // the index projectiles will be cast against
 * ships.fire(world, projectiles);  // muzzles are where the hull has just arrived
 * projectiles.step(dt, ...);
 * ```
 *
 * - **Turrets are commanded before the world advances** (DESIGN.md §4). The
 *   feed-forward rate cancels the hull's rotation over the coming step, so the
 *   slew and the rotation must cover the same interval.
 * - **The wrench is applied by a force provider, not here.** `World` clears
 *   forces at every evaluation and evaluates twice on a primed step, so a force
 *   written directly would be either erased or counted twice. `command` decides
 *   a wrench and stores it; the provider re-applies that stored value however
 *   often it is asked, which makes it idempotent by construction.
 * - **Guns fire after the rebuild**, because a round is cast against the index
 *   in the same step it leaves the barrel, and the muzzle has to be where the
 *   hull now is rather than where it was.
 */

/**
 * Seconds a round lives before expiring. At any muzzle velocity these guns
 * reach, this is tens of kilometres — far outside an engagement — so it is a
 * guard against rounds accumulating for ever, not a range limit.
 */
const ROUND_FLIGHT_TIME = 30;

/**
 * How quickly a pilot tries to correct a velocity error, seconds. Larger is
 * gentler. Chosen for feel rather than derived from anything — unlike the
 * scaling laws in `modules.ts`, a pilot's urgency is not a physical property
 * of the ship. It is doctrine (DESIGN.md §2), and this is its default.
 */
const VELOCITY_RESPONSE_TIME = 2;

/**
 * Seconds over which a pilot aims to close the distance to its ordered band.
 * With `approachSpeed` as a cap, this is what makes the approach ease in
 * rather than arrive at full speed — the same reason a turret brakes into its
 * bearing instead of slamming against it.
 */
const APPROACH_TIME = 8;

/** No order, or an order whose target has gone. */
export const NO_TARGET = -1;

/**
 * An order: a target object and the range band to hold against it.
 *
 * DESIGN.md §2 defines an order as *(target object, allowed distance range,
 * allowed approach-angle range)*, and this is the distance half of that. A
 * ship given one flies straight down the bearing to its target; choosing a
 * quarter to attack from is an approach-angle question, and lives with the
 * rest of doctrine rather than in the order structure.
 */
export interface Order {
  /** Ship index to hold station against, or `NO_TARGET`. */
  target: number;
  /** Range band to hold, metres. */
  minRange: number;
  maxRange: number;
  /** Speed to close or open the range at when outside the band, m/s. */
  approachSpeed: number;
}

export interface ShipSpec {
  design: ShipDesign;
  x?: number;
  y?: number;
  angle?: number;
  vx?: number;
  vy?: number;
  angularVel?: number;
  /** Uninterpreted here; the caller's notion of sides. */
  team?: number;
}

export class Ships {
  /** Shared by every ship in the world, since a turret's owner is a body index. */
  readonly turrets: Turrets;

  private readonly designs: (ShipDesign | null)[] = [];
  private readonly bodyIds: BodyId[] = [];
  /** Persistent between steps, per §12: never shared scratch. */
  private readonly throttles: Float64Array[] = [];
  /** Turret store indices owned by each ship, and their gun timers. */
  private readonly turretIndex: Int32Array[] = [];
  private readonly cooldown: Float64Array[] = [];

  private readonly team: number[] = [];
  private readonly orders: Order[] = [];

  /** The wrench `command` decided, body frame, replayed by the force provider. */
  private readonly demandFx: number[] = [];
  private readonly demandFy: number[] = [];
  private readonly demandTorque: number[] = [];

  private readonly alive: number[] = [];

  private readonly allocation = new Allocation();
  private readonly solution = new FiringSolution();
  /** Turret reaction torque per body index, filled by `Turrets.step`. */
  private reaction = new Float64Array(64);

  constructor(turrets?: Turrets) {
    this.turrets = turrets ?? new Turrets();
  }

  get count(): number {
    let n = 0;
    for (let i = 0; i < this.alive.length; i++) n += this.alive[i]!;
    return n;
  }

  get highWater(): number {
    return this.alive.length;
  }

  isAlive(i: number): boolean {
    return this.alive[i] === 1;
  }

  design(i: number): ShipDesign {
    const d = this.designs[i];
    if (d === null || d === undefined) throw new Error(`Ships: no ship at ${i}`);
    return d;
  }

  body(i: number): BodyId {
    return this.bodyIds[i]!;
  }

  teamOf(i: number): number {
    return this.team[i]!;
  }

  order(i: number): Order {
    return this.orders[i]!;
  }

  /**
   * Put a ship in the world.
   *
   * Mass, inertia and bounding radius come from the design rather than the
   * caller: a ship cannot claim a figure its layout does not support, which is
   * the whole point of compiling a blueprint.
   */
  spawn(world: World, spec: ShipSpec): number {
    const design = spec.design;
    const id = world.spawn({
      x: spec.x ?? 0,
      y: spec.y ?? 0,
      angle: spec.angle ?? 0,
      vx: spec.vx ?? 0,
      vy: spec.vy ?? 0,
      angularVel: spec.angularVel ?? 0,
      mass: design.mass,
      inertia: design.inertia,
      radius: design.radius,
    });

    const bodyIdx = world.bodies.indexOf(id);
    const mounts = design.turrets;
    const indices = new Int32Array(mounts.length);
    for (let t = 0; t < mounts.length; t++) {
      indices[t] = this.turrets.add({ ...mounts[t]!.mount, owner: bodyIdx });
    }

    const i = this.alive.length;
    this.designs.push(design);
    this.bodyIds.push(id);
    this.throttles.push(new Float64Array(design.thrusters.length));
    this.turretIndex.push(indices);
    this.cooldown.push(new Float64Array(mounts.length));
    this.team.push(spec.team ?? 0);
    this.orders.push({
      target: NO_TARGET,
      minRange: 0,
      maxRange: 0,
      approachSpeed: 0,
    });
    this.demandFx.push(0);
    this.demandFy.push(0);
    this.demandTorque.push(0);
    this.alive.push(1);
    return i;
  }

  /** Hold station on another ship within a range band. */
  setOrder(i: number, target: number, minRange: number, maxRange: number, approachSpeed: number): void {
    const order = this.orders[i]!;
    order.target = target;
    order.minRange = minRange;
    order.maxRange = maxRange;
    order.approachSpeed = approachSpeed;
  }

  clearOrder(i: number): void {
    this.setOrder(i, NO_TARGET, 0, 0, 0);
  }

  /**
   * The force provider that applies what `command` decided.
   *
   * Register it once with the world. It is idempotent: it re-applies stored
   * values rather than computing new ones, so the double evaluation on a
   * primed step costs nothing but a repeat of the same sum.
   */
  forceProvider(): (world: World) => void {
    return (world: World) => {
      const bodies = world.bodies;
      for (let i = 0; i < this.alive.length; i++) {
        if (this.alive[i] === 0) continue;
        bodies.applyLocalWrench(
          this.bodyIds[i]!,
          this.demandFx[i]!,
          this.demandFy[i]!,
          this.demandTorque[i]!,
        );
      }
    };
  }

  /**
   * Fly every ship and train every turret, one step. Call before `world.step`.
   */
  command(dt: number, world: World): void {
    const bodies = world.bodies;

    for (let i = 0; i < this.alive.length; i++) {
      if (this.alive[i] === 0) continue;
      this.flyOne(dt, bodies, i);
      this.trainOne(bodies, i);
      const timers = this.cooldown[i]!;
      for (let t = 0; t < timers.length; t++) {
        if (timers[t]! > 0) timers[t] = timers[t]! - dt;
      }
    }

    // Slew every turret, collecting the hull reaction rather than letting it
    // write into forces the world is about to clear.
    if (this.reaction.length < bodies.highWater) {
      this.reaction = new Float64Array(bodies.highWater * 2);
    }
    this.reaction.fill(0);
    this.turrets.step(dt, bodies, this.reaction);
    for (let i = 0; i < this.alive.length; i++) {
      if (this.alive[i] === 0) continue;
      const b = bodies.indexOf(this.bodyIds[i]!);
      if (b < 0) continue;
      this.demandTorque[i] = this.demandTorque[i]! + this.reaction[b]!;
    }
  }

  /**
   * Fire every gun that is loaded, on target and clear to shoot. Call after
   * the world has stepped and the index has been rebuilt.
   */
  fire(world: World, projectiles: Projectiles): number {
    const bodies = world.bodies;
    let fired = 0;

    for (let i = 0; i < this.alive.length; i++) {
      if (this.alive[i] === 0) continue;
      const order = this.orders[i]!;
      if (order.target === NO_TARGET) continue;

      const design = this.designs[i]!;
      const indices = this.turretIndex[i]!;
      const timers = this.cooldown[i]!;
      const bodyIdx = bodies.indexOf(this.bodyIds[i]!);
      if (bodyIdx < 0) continue;

      // Recoil is accumulated across the ship's guns and applied once, after
      // all of them have fired. Applying it per gun would work only for a ship
      // with one: `fireFrom` gives a round the hull's velocity, so the second
      // gun's round would inherit a hull the first gun had already pushed, and
      // the salvo would quietly gain the momentum that ordering invented. A
      // broadside leaves together.
      let impulseX = 0;
      let impulseY = 0;
      let angularImpulse = 0;

      for (let t = 0; t < indices.length; t++) {
        if (timers[t]! > 0) continue;
        const ti = indices[t]!;
        if (!this.turrets.readyToFire(ti)) continue;

        const gun = design.turrets[t]!.gun;
        this.turrets.firingSolution(bodies, ti, this.solution);
        projectiles.fireFrom(
          bodies,
          bodyIdx,
          this.solution.x,
          this.solution.y,
          this.solution.dirX * gun.muzzleSpeed,
          this.solution.dirY * gun.muzzleSpeed,
          ROUND_FLIGHT_TIME,
          gun.roundMass,
          gun.muzzleEnergy,
          0,
          0,
        );

        // An impulse rather than a force: the round leaves within the step, so
        // there is no interval to spread it over. A beam mount firing off the
        // centreline also yaws its own hull, which is part of what an outrigger
        // costs.
        //
        // Total momentum is not conserved across a shot, and cannot be while
        // ammunition has no mass aboard (§12): a round is created carrying the
        // hull's velocity, which adds `roundMass · hullVelocity` to the system.
        // Everything beyond that balances exactly.
        const impulse = gun.roundMass * gun.muzzleSpeed;
        const jx = -this.solution.dirX * impulse;
        const jy = -this.solution.dirY * impulse;
        impulseX += jx;
        impulseY += jy;
        angularImpulse +=
          (this.solution.x - bodies.x[bodyIdx]!) * jy -
          (this.solution.y - bodies.y[bodyIdx]!) * jx;

        timers[t] = gun.cycleTime;
        fired++;
      }

      const mass = bodies.mass[bodyIdx]!;
      if (mass > 0 && (impulseX !== 0 || impulseY !== 0)) {
        bodies.vx[bodyIdx] = bodies.vx[bodyIdx]! + impulseX / mass;
        bodies.vy[bodyIdx] = bodies.vy[bodyIdx]! + impulseY / mass;
      }
      const inertia = bodies.inertia[bodyIdx]!;
      if (inertia > 0 && angularImpulse !== 0) {
        bodies.angularVel[bodyIdx] = bodies.angularVel[bodyIdx]! + angularImpulse / inertia;
      }
    }

    return fired;
  }

  /**
   * One ship's pilot: hold the ordered range band, and face the target.
   *
   * It eases into the band, holds station by matching the target's velocity,
   * and points the bow at whatever it is fighting. That is enough to make two
   * ships fight and to drive every number a blueprint derives.
   *
   * It is deliberately not doctrine. There is no evasion, no approach angle,
   * no propellant budget and no formation keeping here: those are per-craft
   * configuration (DESIGN.md §2), and a pilot that hard-coded them would make
   * them impossible to configure.
   */
  private flyOne(dt: number, bodies: Bodies, i: number): void {
    const design = this.designs[i]!;
    const order = this.orders[i]!;
    const b = bodies.indexOf(this.bodyIds[i]!);
    if (b < 0) return;

    let wantVx = 0;
    let wantVy = 0;
    let wantAngle = bodies.angle[b]!;

    const target = order.target;
    if (target !== NO_TARGET && this.alive[target] === 1) {
      const tb = bodies.indexOf(this.bodyIds[target]!);
      if (tb >= 0) {
        const dx = bodies.x[tb]! - bodies.x[b]!;
        const dy = bodies.y[tb]! - bodies.y[b]!;
        const range = length(dx, dy);
        wantAngle = atan2(dy, dx);

        // Station-keeping is matching the target's velocity; closing or opening
        // is that plus a radial component. Inside the band a ship simply keeps
        // pace, which is what makes a range band a place to sit rather than a
        // line to oscillate across.
        wantVx = bodies.vx[tb]!;
        wantVy = bodies.vy[tb]!;
        if (range > 0) {
          // How far outside the band, signed: positive means too far away.
          // The closing speed tapers with that distance instead of being the
          // full approach speed right up to the edge, which is what stops a
          // ship arriving at the band still doing 150 m/s, sailing through it,
          // and settling into a limit cycle across it. `approachSpeed` becomes
          // the cap rather than the demand.
          const outside =
            range > order.maxRange
              ? range - order.maxRange
              : range < order.minRange
                ? range - order.minRange
                : 0;
          if (outside !== 0) {
            const radial = clamp(
              outside / APPROACH_TIME,
              -order.approachSpeed,
              order.approachSpeed,
            );
            wantVx += (dx / range) * radial;
            wantVy += (dy / range) * radial;
          }
        }
      }
    }

    const mass = bodies.mass[b]!;
    const worldFx = (mass * (wantVx - bodies.vx[b]!)) / VELOCITY_RESPONSE_TIME;
    const worldFy = (mass * (wantVy - bodies.vy[b]!)) / VELOCITY_RESPONSE_TIME;

    // The allocator works in the body frame, so the demand is rotated into it.
    const angle = bodies.angle[b]!;
    const c = cos(angle);
    const s = sin(angle);
    const localFx = worldFx * c + worldFy * s;
    const localFy = -worldFx * s + worldFy * c;

    // Heading: the same braking law the turrets use, at hull scale. The
    // available angular acceleration comes from the layout rather than a
    // guess, so a sluggish ship turns sluggishly because of what it is made
    // of.
    const error = angleDelta(angle, wantAngle);
    const inertia = bodies.inertia[b]!;
    const maxTorque = design.thrusterLayout.maxTorque(error >= 0 ? 1 : -1);
    const maxAlpha = inertia > 0 ? maxTorque / inertia : 0;
    const wantRate = error >= 0
      ? brakingRate(error, maxAlpha, dt)
      : -brakingRate(error, maxAlpha, dt);
    const localTorque =
      dt > 0 ? (inertia * (wantRate - bodies.angularVel[b]!)) / dt : 0;

    design.thrusterLayout.allocate(
      localFx,
      localFy,
      clamp(localTorque, -maxTorque, maxTorque),
      this.throttles[i]!,
      this.allocation,
    );

    this.demandFx[i] = this.allocation.fx;
    this.demandFy[i] = this.allocation.fy;
    this.demandTorque[i] = this.allocation.torque;
  }

  /** Train this ship's turrets on its ordered target, leading it. */
  private trainOne(bodies: Bodies, i: number): void {
    const indices = this.turretIndex[i]!;
    const order = this.orders[i]!;

    if (order.target === NO_TARGET || this.alive[order.target] !== 1) {
      for (let t = 0; t < indices.length; t++) this.turrets.returnToRest(indices[t]!);
      return;
    }

    const tb = bodies.indexOf(this.bodyIds[order.target]!);
    if (tb < 0) {
      for (let t = 0; t < indices.length; t++) this.turrets.returnToRest(indices[t]!);
      return;
    }

    const tx = bodies.x[tb]!;
    const ty = bodies.y[tb]!;
    const tvx = bodies.vx[tb]!;
    const tvy = bodies.vy[tb]!;
    for (let t = 0; t < indices.length; t++) {
      this.turrets.aimAt(bodies, indices[t]!, tx, ty, tvx, tvy);
    }
  }

  /**
   * Remove a ship and its turrets. The body is the caller's to destroy, since
   * a dead ship's hull normally stays in the world as a wreck (§4).
   */
  remove(i: number): void {
    if (this.alive[i] === 0) return;
    const indices = this.turretIndex[i]!;
    for (let t = 0; t < indices.length; t++) this.turrets.remove(indices[t]!);
    this.alive[i] = 0;
    this.designs[i] = null;
    this.demandFx[i] = 0;
    this.demandFy[i] = 0;
    this.demandTorque[i] = 0;
  }

  /** Throttle actually held by one of a ship's thrusters, 0 to 1. Diagnostic. */
  throttleOf(i: number, thruster: number): number {
    return this.throttles[i]![thruster]!;
  }

  /** Seconds until a gun is loaded again. Diagnostic. */
  cooldownOf(i: number, turret: number): number {
    return this.cooldown[i]![turret]!;
  }

  /** Whether the pilot's demand exceeded what the layout can produce. */
  saturated(): boolean {
    return this.allocation.saturated;
  }
}
