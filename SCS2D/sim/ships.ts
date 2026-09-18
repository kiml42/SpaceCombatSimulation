import { Bodies, type BodyId } from './bodies.js';
import type { ShipDesign } from './blueprint.js';
import { Hulls } from './hull.js';
import { Damage, DamageEffect } from './damage.js';
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
import { Allocation, ThrusterLayout } from './thrusters.js';
import { FiringSolution, Turrets, TurretState } from './turrets.js';
import type { World } from './world.js';
import type { BeamHits, Beams, SpatialGrid } from './index.js';
import { GunType } from './modules.js';

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
 * How near zero a countdown has to get before it counts as finished, seconds.
 *
 * A timer set to a whole number of timesteps does not reach exactly zero by
 * repeated subtraction: `dt` is not representable in binary, so the residue
 * after the right number of steps is a few parts in 10^15 and its *sign* is
 * arithmetic luck. A 0.8 s countdown lands just below zero and finishes on
 * time; 1.6, 3.2 and 6.4 land just above it and run a whole extra step. That
 * is a sixtieth of a second of reload nobody asked for, appearing and
 * disappearing as the scaling laws move a cycle time about.
 *
 * Fifteen orders of magnitude above the residue and seven below a timestep, so
 * it cannot fail to absorb the one or let a gun fire measurably early. The
 * countdown is snapped to zero rather than the comparisons being loosened, so
 * that a finished timer reads as zero everywhere — including anything that
 * later shows a reload as a fraction of its cycle.
 */
const TIMER_SETTLE = 1e-9;

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
  /** Under what condition should this order be cancelled */
  cancelOn: OrderCancelCondition;
}

/**
 * When a ship is finished with an order and moves on to the next.
 *
 * Every condition but `None` also drops an order whose target has gone: a
 * target that no longer exists cannot be fought, whatever finishing it would
 * have meant.
 */
export enum OrderCancelCondition {
  /** Never dropped, not even when the target is gone. Station-keeping. */
  None = 0,
  /** Dropped once the target is gone. Nothing short of that will do. */
  CompletelyDead = 1,
  /** Dropped once the target has no working weapon: it cannot shoot back. */
  Disarm = 2,
  /** Dropped once the target has no working engine: it cannot run. */
  NoEngines = 3,
  /** Dropped once the target can no longer either shoot back or run. */
  DisarmOrNoEngines = 4,
  /** Dropped only once the target can do neither: a mission kill (§3). */
  CompleteDisable = 5,
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

export interface FireReport {
  projectilesFired: number;
  beamsFired: number;
}

export class Ships {
  /** Shared by every ship in the world, since a turret's owner is a body index. */
  readonly turrets: Turrets;

  private readonly designs: (ShipDesign | null)[] = [];
  private readonly bodyIds: BodyId[] = [];
  /**
   * Body index → the hull that body is built from, for the narrow phase, which
   * knows bodies and not ships. The handle is kept beside the design so that a
   * body destroyed and its slot reused is detected rather than inherited.
   *
   * A hull outlives its ship: a wrecked ship is removed from this store while
   * its body stays in the world (§4), and a wreck's matter still stops a
   * shell, so the entry is left where it is.
   */
  private readonly hullDesign: (ShipDesign | null)[] = [];
  private readonly hullBody: BodyId[] = [];
  private bodyStore: Bodies | null = null;

  /** What every ship has taken, by body index. */
  readonly damage = new Damage();

  /**
   * The narrow phase over those hulls, so that a shot lands on a ship's
   * modules rather than on the circle drawn round them.
   *
   * Owned here because this is what knows which body is which ship. Beams are
   * cast through it without the caller having to pass it; a round is cast by
   * `Projectiles.step`, which the caller drives, so that one is handed this.
   */
  readonly hulls = new Hulls(this);

  /**
   * The same, for beams, which bore through what they have already destroyed.
   * A shell is stopped by matter whatever state it is in; a beam is stopped
   * only by matter it can still boil away.
   */
  readonly beamHulls = new Hulls(this, {
    stops: (body, module) => !this.damage.spent(body, module),
  });

  /**
   * Per-ship thruster layouts, and the damage version each was built at.
   *
   * A design's layout is shared by every ship built to it, so a damaged ship
   * needs one of its own — rebuilt when its damage changes and not per step,
   * which is what §4's "damage never changes topology" buys: the geometry of
   * what can push is what changed, and mass properties are untouched.
   */
  private readonly layouts: (ThrusterLayout | null)[] = [];
  private readonly layoutVersion: number[] = [];
  /** Persistent between steps, per §12: never shared scratch. */
  private readonly throttles: Float64Array[] = [];
  /** Turret store indices owned by each ship, and their gun timers. */
  private readonly turretIndex: Int32Array[] = [];
  private readonly cooldown: Float64Array[] = [];
  private readonly turretStates: Uint8Array[] = [];
  private readonly nextBarrelToFire: Int32Array[] = [];

  private readonly team: number[] = [];

  /**
   * Each ship's orders, oldest first: `orders[ship][n]`.
   *
   * A queue rather than a stack, so a ship carries out what it was told in the
   * order it was told, and moves on to the next when one is finished — which
   * is what makes a list of orders a *plan* rather than a pile of
   * interruptions.
   */
  private readonly orders: Order[][] = [];

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

  /**
   * The hull a body is built from, or null for a body that has none — which is
   * what the narrow phase asks, and what makes a round land on a ship's
   * modules rather than on the circle drawn round them.
   */
  designOf(bodyIndex: number): ShipDesign | null {
    const design = this.hullDesign[bodyIndex];
    if (design === undefined || design === null) return null;
    // The slot may have been destroyed and taken by something else since.
    const bodies = this.bodyStore;
    if (bodies !== null && bodies.indexOf(this.hullBody[bodyIndex]!) !== bodyIndex) return null;
    return design;
  }

  /**
   * The thruster layout to fly this ship by: the design's own while it is
   * undamaged, and one of its own once it is not.
   *
   * Rebuilt only when the ship's damage has changed since the last time, which
   * is a version comparison rather than a dirty flag — nothing has to remember
   * to set it.
   */
  private layoutOf(i: number): ThrusterLayout {
    const design = this.designs[i]!;
    const bodies = this.bodyStore;
    const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[i]!);
    if (b < 0) return design.thrusterLayout;

    const version = this.damage.version(b);
    const built = this.layouts[i];
    if (built !== null && built !== undefined && this.layoutVersion[i] === version) return built;

    let damaged = false;
    const specs = design.thrusters.map((spec) => {
      const left = this.damage.remaining(b, spec.module ?? -1, DamageEffect.Thrust);
      if (left < 1) damaged = true;
      return left === 1 ? spec : { ...spec, maxThrust: spec.maxThrust * left };
    });
    // An undamaged ship keeps the design's shared layout, so the common case
    // costs one comparison and no allocation.
    const layout = damaged ? new ThrusterLayout(specs) : design.thrusterLayout;
    this.layouts[i] = layout;
    this.layoutVersion[i] = version;
    return layout;
  }

  /** Returns true when the ship has no active weapons left */
  isDisarmed(i: number): boolean {
    if (this.alive[i] === 0) return true;
    const bodies = this.bodyStore;
    const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[i]!);
    if (b < 0) return true;
    const design = this.designs[i]!;
    for (let t = 0; t < design.turrets.length; t++) {
      if (!this.isTurretDisabled(i, t)) return false;
    }
    return true;
  }

  /**
   * Whether this ship's `t`-th mount can still shoot.
   *
   * The same question `fire` asks before it lets a gun off, so that anything
   * drawing a turret and the gunnery that runs it cannot disagree about which
   * guns are out — which is the whole reason this lives here and not in the
   * renderer, where the cutout would have to be guessed at.
   */
  isTurretDisabled(i: number, t: number): boolean {
    if (this.alive[i] === 0) return true;
    const bodies = this.bodyStore;
    const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[i]!);
    if (b < 0) return true;
    const turret = this.designs[i]!.turrets[t];
    if (turret === undefined) return true;
    return !(this.damage.remaining(b, turret.module, DamageEffect.FireRate) > 0);
  }

  /** Returns true when this ship has no active engines */
  hasNoEngines(i: number): boolean {
    if (this.alive[i] === 0) return true;
    const bodies = this.bodyStore;
    const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[i]!);
    if (b < 0) return true;
    const design = this.designs[i]!;
    for (const thruster of design.thrusters) {
      if (this.damage.remaining(b, thruster.module ?? -1, DamageEffect.Thrust) > 0) return false;
    }
    return true;
  }

  /**
   * Whether a ship can still do anything: push, or shoot.
   *
   * A ship that can do neither is a hulk — it keeps its mass, drifts on and
   * goes on stopping shells (§4), which is what makes §3's mission kill worth
   * something. It is not removed, so this is the question a scenario asks
   * rather than a state the store holds.
   */
  isDisabled(i: number): boolean {
    return this.isDisarmed(i) && this.hasNoEngines(i);
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
    this.bodyStore = world.bodies;
    this.hullDesign[bodyIdx] = design;
    this.hullBody[bodyIdx] = id;
    this.damage.register(bodyIdx, design);
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
    this.turretStates.push(new Uint8Array(mounts.length));
    this.nextBarrelToFire.push(new Int32Array(mounts.length));
    this.team.push(spec.team ?? 0);
    this.orders.push([]); // Initialise to an empty array of orders for this ship
    this.demandFx.push(0);
    this.demandFy.push(0);
    this.demandTorque.push(0);
    this.alive.push(1);

    return i;
  }

  /**
   * Add an order to the end of this ship's queue.
   *
   * Orders are carried out in the order they were given: the ship works on the
   * first one until `cancelOn` says it is finished, then takes up the next.
   */
  pushOrder(i: number, target: number, minRange: number, maxRange: number, approachSpeed: number, cancelOn: OrderCancelCondition = OrderCancelCondition.CompleteDisable): void {
    const order = {
      target: target,
      minRange: minRange,
      maxRange: maxRange,
      approachSpeed: approachSpeed,
      cancelOn: cancelOn
    };
    this.orders[i]!.push(order);
  }

  /** Drop every order this ship has. It holds its heading and its fire. */
  clearOrder(i: number): void {
    this.orders[i] = [];
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
      this.removeInvalidOrders(i);
      this.flyOne(dt, bodies, i);
      this.trainOne(bodies, i);
      const timers = this.cooldown[i]!;
      for (let t = 0; t < timers.length; t++) {
        if (timers[t]! > 0) {
          const remaining = timers[t]! - dt;
          timers[t] = remaining > TIMER_SETTLE ? remaining : 0;
        }
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
  fire(world: World, projectiles: Projectiles, beams: Beams, grid: SpatialGrid, beamHits: BeamHits): FireReport {
    const bodies = world.bodies;
    let projectilesFired = 0;
    let beamsFired = 0;

    for (let i = 0; i < this.alive.length; i++) {
      if (this.alive[i] === 0) continue;
      const design = this.designs[i]!;
      const indices = this.turretIndex[i]!;
      const timers = this.cooldown[i]!;

      const turretStates = this.turretStates[i]!;
      const barrels = this.nextBarrelToFire[i]!;
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
        let state = turretStates[t]!;
        const gun = design.turrets[t]!.gun;
        let barrel = barrels[t]!;

        // What damage has left of this mount's rate of fire. A wrecked mount
        // stops where it is: it does not finish the shot it was committed to,
        // because there is no longer a gun to finish it with.
        const rate = this.damage.remaining(bodyIdx, design.turrets[t]!.module, DamageEffect.FireRate);
        if (!(rate > 0)) {
          turretStates[t] = TurretState.Idle;
          timers[t] = 0;
          continue;
        }

        if (timers[t]! <= 0 && state != TurretState.Idle) {
          // the timer's run out, progress the state (except idle, which only progresses when ready to fire)
          if (state == TurretState.Reloading) {
            // finished reloading -> idle & switch to the next barrel
            state = turretStates[t] = TurretState.Idle;
            barrel = barrels[t] = (barrel + 1) % gun.barrelCount;
          }
          if (state == TurretState.CommittedOn) {
            // finished firing -> reload
            state = turretStates[t] = TurretState.Reloading;
            timers[t] = gun.cycleTime / rate;
          }
        }

        if (state == TurretState.Reloading) continue; // Can't fire while reloading.

        const ti = indices[t]!;

        const order = this.getCurrentOrder(i);

        // skip if it's not ready to fire, and it's not committed to being on.
        if ((!order || order.target === NO_TARGET || !this.turrets.readyToFire(ti)) && state != TurretState.CommittedOn) continue;

        const lateralOffset =
          gun.barrelCount > 1
            ? (barrel - (gun.barrelCount - 1) * 0.5) * gun.barrelSpacing
            : 0;

        this.turrets.firingSolution(bodies, ti, this.solution, lateralOffset);

        if (gun.type == GunType.Projectile) {
          projectiles.fireFrom(
            bodies,
            bodyIdx,
            this.solution.x,
            this.solution.y,
            this.solution.dirX * gun.muzzleSpeed + this.solution.vx,
            this.solution.dirY * gun.muzzleSpeed + this.solution.vy,
            gun.calibre,
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
          // Only the muzzle velocity recoils. The round also leaves carrying the
          // tangential velocity of the mount it sat on, but that is momentum it
          // already had while attached rather than anything the gun gave it, so
          // the charge does not push back for it.
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

          // A battered mount loads slower, which is the whole of what damage
          // does to a gun for now.
          timers[t] = gun.cycleTime / rate;

          turretStates[t] = TurretState.Reloading; // Projectile guns immediately reload after firing.

          projectilesFired++;  // increment for every shot fired
        } else {
          beams.fireFrom(
            bodyIdx,
            this.solution.x,
            this.solution.y,
            this.solution.dirX,
            this.solution.dirY,
            gun.calibre,
            gun.beamPower,
            0,
            bodies,
            grid,
            beamHits,
            this.beamHulls,
          );
          if (state == TurretState.Idle) {
            // was idle before, now committed on for beamOnTime
            state = turretStates[t] = TurretState.CommittedOn;
            timers[t] = gun.beamOnTime;

            beamsFired++;  // only increment when going from idle to on.
          }
        }
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

    return { projectilesFired, beamsFired };
  }

  /**
   * Drop every order this ship is finished with, wherever it sits in the
   * queue — not only the one it is working on.
   *
   * A target killed by somebody else while the queue waited its turn is just
   * as finished as one this ship killed itself, and leaving it in would send
   * the ship off to fight a wreck later.
   */
  removeInvalidOrders(i: number): void {
    const orders = this.orders[i];
    if (orders === undefined) return;
    const kept: Order[] = [];
    for (const order of orders) {
      if (!this.orderFinished(order)) kept.push(order);
    }
    this.orders[i] = kept;
  }

  /** Whether an order's `cancelOn` condition has been met. */
  private orderFinished(order: Order): boolean {
    // Station-keeping: held whatever becomes of the target, including nothing.
    if (order.cancelOn === OrderCancelCondition.None) return false;

    // Everything else needs a target that is still there to be finished with.
    if (order.target === NO_TARGET || this.alive[order.target] !== 1) return true;

    const disarmed = this.isDisarmed(order.target);
    const stranded = this.hasNoEngines(order.target);
    switch (order.cancelOn) {
      case OrderCancelCondition.CompletelyDead:
        return false;
      case OrderCancelCondition.Disarm:
        return disarmed;
      case OrderCancelCondition.NoEngines:
        return stranded;
      case OrderCancelCondition.DisarmOrNoEngines:
        return disarmed || stranded;
      case OrderCancelCondition.CompleteDisable:
        return disarmed && stranded;
      default:
        return false;
    }
  }

  /**
   * The order this ship is working on: the oldest it has not finished with, or
   * `undefined` when it has none and is free to hold its heading and its fire.
   */
  getCurrentOrder(i: number): Order | undefined {
    return this.orders[i]?.[0];
  }

  /** How many orders this ship still has, the current one included. */
  orderCount(i: number): number {
    return this.orders[i]?.length ?? 0;
  }

  /**
   * One ship's pilot: hold the ordered range band, and face the target.
   *
   * It eases into the band, holds station by matching the target's velocity,
   * and points the bow at whatever it is fighting. That is enough to make two
   * ships fight and to drive every number a blueprint derives.
   *
   * **A stop-gap until doctrine and orders (ROADMAP.md §8 step 3), which
   * replace it.** There is no evasion here, no approach angle, no propellant
   * budget and no formation keeping — all of which are per-craft configuration
   * (§2) rather than anything a pilot should decide for itself. What survives
   * that replacement is the shape of the thing: a demand wrench handed to the
   * allocator, and a target handed to the turrets.
   */
  private flyOne(dt: number, bodies: Bodies, i: number): void {
    const order = this.getCurrentOrder(i);
    const b = bodies.indexOf(this.bodyIds[i]!);
    if (b < 0) return;

    let wantVx = 0;
    let wantVy = 0;
    let wantAngle = bodies.angle[b]!;

    // No order at all is the same problem as an order with no target: hold
    // what you are doing and wait to be told something.
    const target = order?.target ?? NO_TARGET;
    if (order !== undefined && target !== NO_TARGET && this.alive[target] === 1) {
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
    const layout = this.layoutOf(i);
    const maxTorque = layout.maxTorque(error >= 0 ? 1 : -1);
    const maxAlpha = inertia > 0 ? maxTorque / inertia : 0;
    const wantRate = error >= 0
      ? brakingRate(error, maxAlpha, dt)
      : -brakingRate(error, maxAlpha, dt);
    const localTorque =
      dt > 0 ? (inertia * (wantRate - bodies.angularVel[b]!)) / dt : 0;

    layout.allocate(
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
    const order = this.getCurrentOrder(i);

    if (!order || order.target === NO_TARGET || this.alive[order.target] !== 1) {
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

  /**
   * Index in the shared turret store of one of a ship's mounts, in the order
   * its design lists them. What a snapshot needs to read a bearing back out.
   */
  turretIndexOf(i: number, turret: number): number {
    return this.turretIndex[i]![turret]!;
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
