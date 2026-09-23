import { Bodies, type BodyId } from './bodies.js';
import { subDesign, type DesignTurret, type ShipDesign } from './blueprint.js';
import { components, cuts, jointBetween, joints, type Joint } from './connectivity.js';
import { Hulls } from './hull.js';
import { Damage, DamageEffect } from './damage.js';
import { plumeRays, Plumes, WEAPON_PLUME_SHARE } from './exhaust.js';
import { Choice, cohesionUrge, look, lookFrom, score } from './targeting.js';
import { thrusterGeometry } from './modules.js';
import {
  atan2,
  angleDelta,
  PI,
  brakingRate,
  clamp,
  cos,
  length,
  max,
  min,
  round,
  sin,
  sqrt,
} from './math.js';
import { Projectiles } from './projectiles.js';
import { Allocation, ThrusterLayout } from './thrusters.js';
import { FiringSolution, Turrets, TurretState } from './turrets.js';
import type { Targeting } from './doctrine.js';
import type { World } from './world.js';
import type { BeamHits, Beams, SpatialGrid } from './index.js';
import { MAX_BEAM_LENGTH } from './beams.js';
import { RayHit } from './spatialGrid.js';
import type { Contacts } from './collision.js';
import { GunType, type GunStats, type ModuleKind } from './modules.js';

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
/**
 * The weight an order is flown with, so a doctrine number of this much is
 * worth exactly as much as doing what it was told.
 */
const URGE_REFERENCE = 100;

const TIMER_SETTLE = 1e-9;

/**
 * Seconds over which a pilot aims to close the distance to its ordered band.
 * With `approachSpeed` as a cap, this is what makes the approach ease in
 * rather than arrive at full speed — the same reason a turret brakes into its
 * bearing instead of slamming against it.
 */
const APPROACH_TIME = 8;

/**
 * How far ahead a pilot looks for something it is about to run into, seconds.
 *
 * Long enough that the answer is a lean rather than a swerve, and short enough
 * that a craft is not steering around a pass that the next few seconds of
 * everybody's manoeuvring will have changed anyway.
 */
const AVOID_HORIZON = 6;

/** No order, or an order whose target has gone. */
/**
 * How much of a weld survives the metal at its ends being wrecked.
 *
 * A destroyed module keeps its mass and its place (§4), so it keeps holding
 * on to its neighbours — badly. Zero here would mean a hull whose middle had
 * been shot out fell to pieces at the first nudge.
 */
const WRECK_STRENGTH = 0.05;

/**
 * Below this mass, a severed piece is scrap and is never put in the world at
 * all, kilograms.
 *
 * Matter is conserved *within a hull* — a wrecked module keeps its mass and
 * its place, which is what makes a battered ship sluggish and its wreckage
 * free armour (§4). It is not conserved in the world: a shard this small is
 * too broken up to be worth going after and too light to be worth avoiding,
 * so tracking it buys nothing. What is discarded is counted rather than
 * quietly dropped, so a salvage economy can balance its books later.
 */
const SCRAP_MASS = 300;

/**
 * How far past the fighting a piece has to drift before it stops being worth
 * tracking, in metres per kilogram above `SCRAP_MASS`.
 *
 * Continuous rather than a second threshold, and that is the point: a shard
 * just over the scrap mass is gone as soon as it leaves the battle, a tonne
 * of hull has to clear it by kilometres, and a serious chunk effectively
 * never leaves. "Worth hunting down for the rest of the battle" falls out of
 * that rather than being declared, which leaves one cliff in the rule instead
 * of two — and the one that is left is at a mass where nothing cares.
 */
const SALVAGE_REACH = 5;

/**
 * How small the battle can get, metres.
 *
 * The area is drawn round the ships still in it, so it shrinks as they die
 * and would collapse to a point around the last one — taking the whole debris
 * field with it in a single step. A survivor going back for the wreckage has
 * to find it still there.
 */
const MINIMUM_BATTLE_RADIUS = 2000;

/**
 * How much hull it takes to be worth a second of thinking, kilograms.
 *
 * How often a ship reconsiders what it is fighting is *derived* rather than
 * configured, because it is not really a preference: a fighter can bring
 * itself round in a moment and should change its mind about as often, and a
 * capital that takes half a minute to come about gains nothing by
 * reconsidering four times a second. Mass stands in for that, being what
 * makes a hull slow to point somewhere new.
 */
const THINKING_MASS = 300_000;
/** However light it is, a ship is not re-picking every step. */
const MIN_RETHINK = 0.25;
/** However heavy it is, a ship has not forgotten there is a battle on. */
const MAX_RETHINK = 4;

/**
 * How often a mount reconsiders: the time it would take to act on the answer.
 *
 * Half a circle of traverse plus one firing cycle — what it costs a mount to
 * swing onto something new and get a shot away. Deriving it that way is what
 * makes a close-in mount reconsider several times a second while an artillery
 * piece that takes six seconds to come round and load thinks about as often
 * as it can do anything about it. Choosing faster than you can act on the
 * choice is only a way of never finishing a slew.
 */
const TURRET_MIN_RETHINK = 0.25;
const TURRET_MAX_RETHINK = 4;

/**
 * How far ahead of a gun's muzzle a friendly stops it firing, in seconds of
 * the round's own flight.
 *
 * Short on purpose. A shell is slow enough and a battle wide enough that
 * asking "is a friend anywhere along where this round could go" would stop a
 * fleet firing at all; what this is for is the consort that has just drifted
 * across the muzzle, which is the case a gunner would actually notice. Beyond
 * it, a round is everyone's problem and the ship that flew into the line of
 * fire is the one that made the mistake.
 *
 * A beam gets no such allowance: it arrives instantly along its whole length,
 * so anything in the line *is* hit, and the cast is the beam itself.
 */
const FRIENDLY_LOOKAHEAD = 0.5;

/**
 * How far a blow carries through a hull before it has half spent itself,
 * metres.
 *
 * A shock disperses as it travels: the metal it passes through crushes,
 * bends and heats, and what reaches a weld thirty metres away is a fraction
 * of what the plating at the impact felt. Without this a fighter that flew
 * into a capital ship's flank would break every weld the fighter's momentum
 * could pay for, wherever they were, and take the ship apart from end to end
 * — the blow has to land *somewhere*.
 */
const SHOCK_REACH = 15;

export const NO_TARGET = -1;

/** World bearing from one point to another. */
function bearing(fromX: number, fromY: number, toX: number, toY: number): number {
  return atan2(toY - fromY, toX - fromX);
}

/** Aiming at a ship rather than at any part of it. */
const WHOLE_SHIP = -1;

/** What a doctrine thinks one kind of module is worth shooting at. */
function partWeight(doctrine: Targeting, kind: ModuleKind): number {
  if (kind === 'core') return doctrine.coreWeight;
  if (kind === 'thruster') return doctrine.engineWeight;
  if (kind === 'structure') return doctrine.structureWeight;
  return doctrine.gunWeight;
}

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

/**
 * The side nobody is on, and nobody is against.
 *
 * A ship on it is hostile to no one and no one is hostile to it, so it is
 * never shot at and never shoots — but it is there, it is solid, and it can be
 * escorted, stationed on and shoved about. What that is for is an object a
 * battle is *about* rather than one fighting in it.
 */
export const NEUTRAL_TEAM = -1;

export interface ShipSpec {
  design: ShipDesign;
  x?: number;
  y?: number;
  angle?: number;
  vx?: number;
  vy?: number;
  angularVel?: number;
  /** Uninterpreted here; the caller's notion of sides. `NEUTRAL_TEAM` is not. */
  team?: number;
  /** Nothing can hurt it: no damage taken, no weld cut. See `Damage.protect`. */
  invulnerable?: boolean;
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
  /** Scratch for the exhaust pass, so that burning allocates nothing. */
  private readonly plumes = new Plumes();
  /**
   * Which engines of the ship being flown this step are burning as weapons.
   * Scratch, written and read inside one `flyOne`, so one array serves every
   * ship however many engines each has.
   */
  private forced = new Uint8Array(0);
  /** Turret store indices owned by each ship, and their gun timers. */
  private readonly turretIndex: Int32Array[] = [];
  private readonly cooldown: Float64Array[] = [];
  private readonly turretStates: Uint8Array[] = [];
  private readonly nextBarrelToFire: Int32Array[] = [];
  /**
   * What each mount has picked to shoot at, and the step it will think about
   * that again.
   *
   * A mount chooses for itself, because a broadside with an enemy on each
   * beam cannot fight both by pointing the whole ship at one of them — and
   * because what a mount can reach is a property of the mount: its own arc,
   * and its own gun's reach. `focusWeight` is what keeps them together
   * without tying them together.
   */
  private readonly turretTarget: Int32Array[] = [];
  private readonly turretRethinkAt: Float64Array[] = [];
  /**
   * What each mount was actually trained on, last time it was trained.
   *
   * **A gun fires at what its barrel is pointing at, not at what it would
   * choose if asked again.** Training happens before the world steps and
   * firing after it, and a hull turns in between — so asking twice can give
   * two answers, and the second one is a target the barrel was never brought
   * round to. A gun with a stale answer shoots off into empty space, which is
   * exactly what it looks like.
   */
  private readonly turretAiming: Int32Array[] = [];
  /**
   * Which module of its target each mount is shooting at, or -1 for the ship
   * as a whole — which is what a doctrine with no opinion about parts means,
   * since picking a part is picking a smaller thing to miss.
   */
  private readonly turretAimModule: Int32Array[] = [];

  private readonly team: number[] = [];

  /**
   * Which ships have nobody aboard: the pieces other ships have been broken
   * into.
   *
   * A chunk is a ship in every way that matters to the rest of the sim — it
   * has a hull, it collides, it takes damage and it can come apart further —
   * and in exactly one way it is not: nothing flies it and nothing fires it.
   * Making it a ship rather than a third kind of thing is what lets it be
   * drawn, hit and severed by the code that already does those.
   */
  private readonly derelict: number[] = [];

  /**
   * Mass thrown away as scrap or lost track of, kilograms — everything the
   * world stopped accounting for. Matter is conserved in a hull but not in
   * the world, and this is the difference, kept rather than silently dropped.
   */
  discarded = 0;
  /**
   * The momentum that went with it, kg·m/s — so that "momentum is conserved"
   * stays a thing a test can check rather than a thing that used to be true.
   */
  discardedPx = 0;
  discardedPy = 0;

  /**
   * Which ship each body is, so a blow landing on a body finds the hull it
   * has to be answered by. Guarded by the handle, since a destroyed body's
   * slot is handed out again.
   */
  private readonly shipByBody: number[] = [];

  /**
   * Blows waiting to be answered: an impulse at a point on a hull, world
   * frame, one entry per array. Drained by `sever`.
   *
   * Kept rather than answered where they land because a hull should come
   * apart once, from everything that hit it this step, rather than once per
   * hit in whatever order the hits were resolved.
   */
  /** The weld-cut version each ship was last checked at, so a hull is walked
   * only when something has taken a fresh bite out of one of its welds. */
  private readonly cutSeen: number[] = [];

  private readonly blowBody: number[] = [];
  private readonly blowModule: number[] = [];
  private readonly blowJx: number[] = [];
  private readonly blowJy: number[] = [];
  private readonly blowX: number[] = [];
  private readonly blowY: number[] = [];
  private blows = 0;

  /**
   * Each ship's orders, oldest first: `orders[ship][n]`.
   *
   * A queue rather than a stack, so a ship carries out what it was told in the
   * order it was told, and moves on to the next when one is finished — which
   * is what makes a list of orders a *plan* rather than a pile of
   * interruptions.
   */
  private readonly orders: Order[][] = [];

  /**
   * What each ship has decided to fight on its own account, and the step at
   * which it will think about that again.
   *
   * The player's queue outranks this entirely: doctrine is what a ship falls
   * back on when it has been told nothing, so this is consulted only when the
   * queue is empty and is never written into it. An order given is an order
   * obeyed, and a ship that has run out of orders is not left idle.
   */
  private readonly chosen: number[] = [];
  /**
   * What each ship is covering, which is never what it is fighting: a consort
   * is by definition something it will not shoot at. Chosen on the same
   * schedule as the fight and pulled on every step, since where a craft is
   * relative to its charge changes far faster than which charge it wants.
   */
  private readonly consort: number[] = [];
  /** The blend of steering urges being accumulated for one craft. */
  private urgeVx = 0;
  private urgeVy = 0;
  private urgeWeight = 0;
  private readonly rethinkAt: number[] = [];
  /**
   * The order doctrine makes up, one per ship and rewritten in place, so that
   * falling back on doctrine allocates nothing per step.
   */
  private readonly standing: Order[] = [];
  private readonly choice = new Choice();

  /** The wrench `command` decided, body frame, replayed by the force provider. */
  private readonly demandFx: number[] = [];
  private readonly demandFy: number[] = [];
  private readonly demandTorque: number[] = [];

  private readonly alive: number[] = [];

  private readonly allocation = new Allocation();
  private readonly solution = new FiringSolution();
  /**
   * Where a mount sits in the world and how fast that point is moving, filled
   * in place by `locateMount` and read straight away. Persistent rather than
   * built per call, per §12.
   */
  private readonly gunPoint = { x: 0, y: 0, vx: 0, vy: 0 };
  /** Where a shot would land, for the friendly check. Reused, never shared. */
  private readonly lineOfFire = new RayHit();

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

  /**
   * Whether anybody is still flying this ship: a core damage has not finished
   * with.
   *
   * A ship is controlled from its cores (DESIGN.md §4), so this is the one
   * question under every other: a hull with none of them working neither
   * manoeuvres nor lays a gun, whatever is left of its engines and mounts. It
   * is how a hit amidships ends a fight that stripping every turret one at a
   * time would also have ended, and it is why a ship worth the mass carries
   * more than one core.
   */
  hasControl(i: number): boolean {
    if (this.alive[i] === 0) return false;
    // Nobody was ever aboard a severed chunk, whatever it is carrying.
    if (this.derelict[i] === 1) return false;
    const bodies = this.bodyStore;
    const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[i]!);
    if (b < 0) return false;
    const design = this.designs[i]!;
    for (const core of design.cores) {
      if (this.damage.remaining(b, core, DamageEffect.Control) > 0) return true;
    }
    return false;
  }

  /** Returns true when the ship has no active weapons left */
  isDisarmed(i: number): boolean {
    if (this.alive[i] === 0) return true;
    if (this.derelict[i] === 1) return true;
    // A sound gun with nothing left to lay it is out of the fight as surely
    // as a wrecked one.
    if (!this.hasControl(i)) return true;
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
    // A sound gun on a piece of hull that came off is still out of the fight:
    // what is missing is not the gun but everything that would tell it what to
    // shoot at. The arc a renderer draws is a promise that a mount may fire
    // there, so a derelict's mounts must not draw one.
    if (this.derelict[i] === 1) return true;
    if (!this.hasControl(i)) return true;
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
    if (this.derelict[i] === 1) return true;
    // Sound engines nothing is throttling push nothing anywhere.
    if (!this.hasControl(i)) return true;
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
   * rather than a state the store holds — and the question target-picking
   * asks too, since a hulk can never be finished off and a ship that goes on
   * shooting at one is a ship shooting at nothing.
   *
   * A ship with no working core is one of these however sound the rest of it
   * is, which is the whole of what shooting at a core buys: one hit in the
   * right place does what stripping every mount would have done.
   */
  isDisabled(i: number): boolean {
    if (this.derelict[i] === 1) return true;
    if (!this.hasControl(i)) return true;
    return this.isDisarmed(i) && this.hasNoEngines(i);
  }

  /** Whether this is a piece of a ship rather than a ship: no pilot, no guns. */
  isDerelict(i: number): boolean {
    return this.derelict[i] === 1;
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
    this.shipByBody[bodyIdx] = this.alive.length;
    this.hullDesign[bodyIdx] = design;
    this.hullBody[bodyIdx] = id;
    this.damage.register(bodyIdx, design);
    if (spec.invulnerable === true) this.damage.protect(bodyIdx);
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
    const chosenBy = new Int32Array(mounts.length).fill(NO_TARGET);
    this.turretTarget.push(chosenBy);
    this.turretAiming.push(new Int32Array(mounts.length).fill(NO_TARGET));
    // Staggered like the hull's own, so a battery does not stop to think all
    // at once for the rest of the battle.
    const schedule = new Float64Array(mounts.length);
    for (let t = 0; t < mounts.length; t++) schedule[t] = i + t;
    this.turretRethinkAt.push(schedule);
    this.turretAimModule.push(new Int32Array(mounts.length).fill(WHOLE_SHIP));
    this.team.push(spec.team ?? 0);
    this.derelict.push(0);
    this.cutSeen.push(-1);
    this.chosen.push(NO_TARGET);
    this.consort.push(NO_TARGET);
    // Staggered by index, so a fleet spawned together does not all stop to
    // think on the same step for the rest of the battle.
    this.rethinkAt.push(i);
    this.standing.push({
      target: NO_TARGET,
      minRange: 0,
      maxRange: 0,
      approachSpeed: 0,
      cancelOn: OrderCancelCondition.CompleteDisable,
    });
    this.orders.push([]); // Initialise to an empty array of orders for this ship
    this.demandFx.push(0);
    this.demandFy.push(0);
    this.demandTorque.push(0);
    this.alive.push(1);

    return i;
  }

  /**
   * Pick a fight, if nobody has picked one for this ship.
   *
   * Only when the order queue is empty: an order given is an order obeyed,
   * and doctrine is the fallback rather than a second voice. And only every
   * so often — a hull reconsiders at a rate its own mass can act on, which
   * also spreads the cost of looking at every enemy across the steps between.
   */
  private decide(world: World, bodies: Bodies, i: number): void {
    if (this.orders[i]!.length > 0) {
      // Being told what to do clears what it had decided for itself, so
      // running out of orders is a fresh look rather than a stale one.
      this.chosen[i] = NO_TARGET;
      this.consort[i] = NO_TARGET;
      return;
    }
    if (world.tick < this.rethinkAt[i]!) return;

    const design = this.designs[i]!;
    this.rethinkAt[i] = world.tick + this.rethinkTicks(world, design.mass);

    const b = bodies.indexOf(this.bodyIds[i]!);
    if (b < 0) return;

    const doctrine = design.doctrine.targeting;
    const loyalTo = this.chosen[i]!;

    // What it is fighting. A ship with nothing to shoot with has nothing to
    // choose between — but it may still have somewhere it would rather be,
    // which is why this no longer ends the question.
    let fighting = NO_TARGET;
    if (design.reach > 0 && !this.isDisarmed(i)) {
      this.choice.begin();
      for (let t = 0; t < this.alive.length; t++) {
        if (t === i || this.alive[t] === 0) continue;
        // Wreckage is matter, not an enemy, nor is anything not hostile, and
        // a hulk offers nothing worth closing on: nobody is aboard it, and no
        // shot fired at it will ever remove it from the battle, so scoring it
        // low is not enough to stop a ship parking next to one forever.
        //
        // **A hulk is a hull with its cores shot out, and nothing else is.**
        // A ship that has merely lost its guns and its engines is harmless
        // and still a target: there is somebody aboard it, and a round
        // through the core finishes it. Excluding those as well would make
        // being harmless the safest thing a hull could be — untouchable by
        // everyone, for as long as it liked.
        if (this.derelict[t] === 1 || !this.hostile(i, t) || !this.hasControl(t)) continue;
        const tb = bodies.indexOf(this.bodyIds[t]!);
        if (tb < 0) continue;
        const candidate = look(
          bodies,
          b,
          tb,
          t,
          this.designs[t]!.mass,
          !this.isDisarmed(t),
          !this.hasNoEngines(t),
        );
        this.choice.offer(
          candidate,
          score(doctrine, candidate, design.reach, design.mass, loyalTo),
        );
      }
      fighting = this.choice.ship;
    }
    // What it would rather be with. Offered at all only when the doctrine
    // says escorting is worth something, since every weight here may be
    // negative and a consort scored by the ordinary ones would beat a distant
    // enemy on proximity alone — which would have every fleet in the game
    // huddling rather than fighting.
    this.chosen[i] = fighting;
    this.consort[i] = NO_TARGET;
    if (!(doctrine.escortWeight > 0)) return;

    this.choice.begin();
    for (let t = 0; t < this.alive.length; t++) {
      if (t === i || this.alive[t] === 0) continue;
      // Wreckage is nobody's consort. A live friendly that cannot fight is:
      // a thing worth covering is usually a thing that cannot cover itself.
      if (this.derelict[t] === 1 || this.hostile(i, t)) continue;
      const tb = bodies.indexOf(this.bodyIds[t]!);
      if (tb < 0) continue;
      const candidate = look(
        bodies,
        b,
        tb,
        t,
        this.designs[t]!.mass,
        !this.isDisarmed(t),
        !this.hasNoEngines(t),
      );
      // Which consort is the ordinary stack's question — proximity dominating,
      // nearly always the nearest. How hard it pulls is the pilot's, and is
      // asked every step rather than on this schedule.
      this.choice.offer(candidate, score(doctrine, candidate, design.reach, design.mass, loyalTo));
    }
    this.consort[i] = this.choice.ship;
  }

  /**
   * How close a craft wants to sit to what it is covering, metres.
   *
   * The escort's own band, not the gunnery one: a standoff is where you sit
   * to *shoot* at something, which is the wrong answer by an order of
   * magnitude for something you are covering. Capped by a fraction of the
   * escort's own reach, since a consort inside that is a consort its guns can
   * do something about — and uncapped for a craft with no guns, which has no
   * reach for the cap to mean anything in.
   */
  private escortBand(design: ShipDesign, target: number): number {
    const approach = design.doctrine.approach;
    const skin = this.designs[target]!.radius;
    const wanted = approach.escortRadii * skin;
    // From the consort's skin, for the same reason a standoff is: keeping
    // station a hundred metres off a thing a kilometre across is a place
    // inside it.
    if (!(design.reach > 0)) return skin + wanted;
    return skin + min(wanted, approach.escort * design.reach);
  }

  /**
   * Whether one ship may shoot at another.
   *
   * Sides are the caller's business and this is the one rule about them the
   * simulation owns: a side is hostile to every side but its own, and
   * `NEUTRAL_TEAM` is hostile to none and safe from all.
   */
  private hostile(i: number, other: number): boolean {
    const mine = this.team[i]!;
    const theirs = this.team[other]!;
    if (mine === NEUTRAL_TEAM || theirs === NEUTRAL_TEAM) return false;
    return mine !== theirs;
  }

  /**
   * Let every mount pick its own fight.
   *
   * Same doctrine as the hull's, asked from the mount's point of view: its
   * own gun's reach rather than the ship's best, and nothing it cannot train
   * on. A mount that has been wrecked chooses nothing, which is also what
   * takes its firing arc off the display.
   */
  private decideTurrets(world: World, bodies: Bodies, i: number): void {
    const design = this.designs[i]!;
    const indices = this.turretIndex[i]!;
    const targets = this.turretTarget[i]!;
    const aims = this.turretAimModule[i]!;
    const schedule = this.turretRethinkAt[i]!;
    const b = bodies.indexOf(this.bodyIds[i]!);
    if (b < 0) return;

    const focus = this.focusOf(i);

    for (let t = 0; t < indices.length; t++) {
      // What it was fighting is dropped the moment that stops being a fight,
      // whatever its schedule says: a mount tracking a wreck, or a hulk, is
      // worse than a mount at rest, because it goes on shooting at it.
      const held = targets[t]!;
      if (
        held !== NO_TARGET &&
        (this.alive[held] !== 1 || this.derelict[held] === 1 || !this.hasControl(held))
      ) {
        targets[t] = NO_TARGET;
        aims[t] = WHOLE_SHIP;
      }
      if (world.tick < schedule[t]!) continue;
      const mount = design.turrets[t]!;
      schedule[t] = world.tick + this.turretRethinkTicks(world, t, design);

      if (!(this.damage.remaining(b, mount.module, DamageEffect.FireRate) > 0)) {
        targets[t] = NO_TARGET;
        aims[t] = WHOLE_SHIP;
        continue;
      }

      const ti = indices[t]!;
      const doctrine = mount.targeting;

      // Everything is measured from the gun rather than from the hull it is
      // bolted to. Metres, against gunnery range — but enough to order two
      // targets differently, which is what stops both beams piling onto the
      // same one when either could take it.
      this.locateMount(bodies, b, mount);
      const gunX = this.gunPoint.x;
      const gunY = this.gunPoint.y;
      const gunVx = this.gunPoint.vx;
      const gunVy = this.gunPoint.vy;

      this.choice.begin();
      for (let e = 0; e < this.alive.length; e++) {
        if (e === i || this.alive[e] === 0) continue;
        if (this.derelict[e] === 1 || !this.hostile(i, e) || !this.hasControl(e)) continue;
        const tb = bodies.indexOf(this.bodyIds[e]!);
        if (tb < 0) continue;
        if (!this.turrets.bearsOn(bodies, ti, bearing(gunX, gunY, bodies.x[tb]!, bodies.y[tb]!))) {
          continue;
        }
        const candidate = lookFrom(
          bodies,
          gunX,
          gunY,
          gunVx,
          gunVy,
          tb,
          e,
          this.designs[e]!.mass,
          !this.isDisarmed(e),
          !this.hasNoEngines(e),
        );
        this.choice.offer(
          candidate,
          score(doctrine, candidate, mount.reach, design.mass, targets[t]!, focus),
        );
      }
      targets[t] = this.choice.ship;
      aims[t] = targets[t] === NO_TARGET
        ? WHOLE_SHIP
        : this.aimModule(bodies, doctrine, targets[t]!, gunX, gunY);
    }
  }

  /**
   * Where a mount is and how fast that point is moving, into `gunPoint`.
   *
   * A mount out on a beam is carried round by its ship, so its velocity is
   * the hull's plus ω × r — the same term a round leaving it inherits.
   */
  private locateMount(bodies: Bodies, b: number, mount: DesignTurret): void {
    const angle = bodies.angle[b]!;
    const rx = mount.mount.x * cos(angle) - mount.mount.y * sin(angle);
    const ry = mount.mount.x * sin(angle) + mount.mount.y * cos(angle);
    const spin = bodies.angularVel[b]!;
    this.gunPoint.x = bodies.x[b]! + rx;
    this.gunPoint.y = bodies.y[b]! + ry;
    this.gunPoint.vx = bodies.vx[b]! - spin * ry;
    this.gunPoint.vy = bodies.vy[b]! + spin * rx;
  }

  /**
   * Which part of a target to shoot at: the best-weighted module still worth
   * hitting, or the ship as a whole when the doctrine has no opinion.
   *
   * Ties go to whatever is nearest the gun — the gun itself, not its ship —
   * so a mount aiming for engines takes the engine on the near side rather
   * than shooting through the ship to reach one behind it. A module already
   * spent is no longer worth a round.
   */
  private aimModule(
    bodies: Bodies,
    doctrine: Targeting,
    target: number,
    fromX: number,
    fromY: number,
  ): number {
    if (
      doctrine.coreWeight === 0 &&
      doctrine.engineWeight === 0 &&
      doctrine.gunWeight === 0 &&
      doctrine.structureWeight === 0
    ) {
      return WHOLE_SHIP;
    }
    const tb = bodies.indexOf(this.bodyIds[target]!);
    if (tb < 0) return WHOLE_SHIP;
    const design = this.designs[target]!;
    const angle = bodies.angle[tb]!;
    const c = cos(angle);
    const s = sin(angle);

    let best = WHOLE_SHIP;
    let bestWeight = 0;
    let bestRange = 0;
    for (let k = 0; k < design.modules.length; k++) {
      if (this.damage.spent(tb, k)) continue;
      const weight = partWeight(doctrine, design.modules[k]!.spec.kind);
      const mx = bodies.x[tb]! + design.modules[k]!.x * c - design.modules[k]!.y * s;
      const my = bodies.y[tb]! + design.modules[k]!.x * s + design.modules[k]!.y * c;
      const range = length(mx - fromX, my - fromY);
      if (best !== WHOLE_SHIP && (weight < bestWeight || (weight === bestWeight && range >= bestRange))) {
        continue;
      }
      best = k;
      bestWeight = weight;
      bestRange = range;
    }
    return best;
  }

  /**
   * What this ship as a whole is fighting, for its mounts to converge on.
   *
   * What it is *fighting*, which is not always what it is flying relative to:
   * a ship covering a consort is stationed on the consort and fighting
   * something else entirely, and taking the station as the focus would point
   * every mount's concentration at a thing no mount may shoot — quietly
   * costing an escorting fleet the very broadside `focusWeight` exists to
   * hold together.
   */
  private focusOf(i: number): number {
    const given = this.getCurrentOrder(i);
    if (given !== undefined) return given.target;
    const fighting = this.chosen[i]!;
    return fighting !== NO_TARGET && this.alive[fighting] === 1 ? fighting : NO_TARGET;
  }

  /**
   * What one mount is shooting at.
   *
   * An order given is an order obeyed, so a mount that can train on the
   * ordered target takes it; one that cannot is not left idle for the sake of
   * it, and fights what it can reach. With nothing ordered this is whatever
   * the mount picked for itself.
   */
  private turretAim(bodies: Bodies, i: number, t: number): number {
    const given = this.getCurrentOrder(i);
    if (given !== undefined && given.target !== NO_TARGET && this.alive[given.target] === 1) {
      const tb = bodies.indexOf(this.bodyIds[given.target]!);
      const b = bodies.indexOf(this.bodyIds[i]!);
      if (tb >= 0 && b >= 0) {
        const ti = this.turretIndex[i]![t]!;
        this.locateMount(bodies, b, this.designs[i]!.turrets[t]!);
        const canBear = this.turrets.bearsOn(
          bodies,
          ti,
          bearing(this.gunPoint.x, this.gunPoint.y, bodies.x[tb]!, bodies.y[tb]!),
        );
        if (canBear) return given.target;
      }
    }
    const own = this.turretTarget[i]![t]!;
    if (own === NO_TARGET || this.alive[own] !== 1) return NO_TARGET;
    return own;
  }

  /**
   * Whether a friendly hull is in the way of this shot.
   *
   * A straight cast from the muzzle along the barrel, at this instant and
   * ignoring everyone's velocity: a gun that tried to work out where its
   * friends will be would be solving the firing problem twice, and the answer
   * it wants is the crude one — is somebody *there*.
   *
   * The cast stops at the nearest hull, so an enemy between this gun and a
   * consort behind it is still shot at. Wreckage is not a friend however it
   * is painted: nobody is aboard it, and holding fire for it would make every
   * broken ship a shield. Nor is what this mount is shooting at, whoever's
   * side it is on — a ship told to fire on one of its own does so, because
   * this is a rule about what is *in the way* and not about who may be shot.
   */
  private friendlyInTheWay(
    bodies: Bodies,
    grid: SpatialGrid,
    i: number,
    bodyIdx: number,
    gun: GunStats,
    target: number,
  ): boolean {
    const range =
      gun.type === GunType.Beam ? MAX_BEAM_LENGTH : gun.muzzleSpeed * FRIENDLY_LOOKAHEAD;
    if (!(range > 0)) return false;
    const hit = this.lineOfFire;
    const found = grid.raycast(
      bodies,
      this.solution.x,
      this.solution.y,
      this.solution.x + this.solution.dirX * range,
      this.solution.y + this.solution.dirY * range,
      hit,
      bodyIdx,
      this.hulls,
    );
    if (!found) return false;
    const other = this.shipAt(bodies, hit.bodyIndex);
    if (other < 0 || other === i || other === target) return false;
    return this.derelict[other] === 0 && !this.hostile(i, other);
  }

  /** How long this mount waits before reconsidering, in steps. */
  private turretRethinkTicks(world: World, t: number, design: ShipDesign): number {
    const mount = design.turrets[t]!;
    const rate = mount.mount.maxRate;
    const sweep = rate > 0 ? PI / rate : TURRET_MAX_RETHINK;
    const seconds = clamp(sweep + mount.gun.cycleTime, TURRET_MIN_RETHINK, TURRET_MAX_RETHINK);
    return max(1, round(seconds / world.dt));
  }

  /** How long a hull of this mass waits before reconsidering, in steps. */
  private rethinkTicks(world: World, mass: number): number {
    const seconds = clamp(mass / THINKING_MASS, MIN_RETHINK, MAX_RETHINK);
    // At least one step, or a ship would decide twice in the same instant.
    return max(1, round(seconds / world.dt));
  }

  /**
   * What this ship is actually doing: what it was told, or failing that what
   * its doctrine makes of the fight it picked.
   *
   * The doctrine order is built here rather than pushed onto the queue, so
   * that "has orders" goes on meaning "has been told something by somebody".
   */
  private effectiveOrder(i: number): Order | undefined {
    const given = this.getCurrentOrder(i);
    if (given !== undefined) return given;

    const target = this.chosen[i]!;
    if (target === NO_TARGET || this.alive[target] !== 1 || !this.hasControl(target)) {
      return undefined;
    }

    const design = this.designs[i]!;
    const approach = design.doctrine.approach;
    const standing = this.standing[i]!;
    standing.target = target;

    // **Close until the target looks big enough to hit.** A gun misses
    // because its firing solution guessed wrong about where the target would
    // be, and how much of a guess it can afford depends on how much of the
    // sky the target fills — so a fighter has to be closed right in on and a
    // capital does not, and one number covers both because it is measured in
    // the target's own radii. Capped by what this ship's guns are good for,
    // so nothing stands off further than it can shoot.
    // **Measured from the target's skin, not from the middle of it.** A gun's
    // reach is how far it can throw a round past its own muzzle, and what it
    // is shooting at is the hull rather than the point the hull turns about —
    // which is the same thing on ships of a size and nothing like it when a
    // fighter attacks a capital. Left centre to centre, a TIE's doctrine sends
    // it to 460 metres from the middle of a Star Destroyer whose own radius is
    // 1,073: the station it is holding is a third of the way inside the ship,
    // so it flies into it, and no amount of keeping clear can save a craft
    // whose orders are to be there.
    const wanted =
      this.designs[target]!.radius +
      min(approach.standoffRadii * this.designs[target]!.radius, approach.standoff * design.reach);
    standing.minRange = max(0, wanted * (1 - approach.tolerance));
    standing.maxRange = max(standing.minRange, wanted * (1 + approach.tolerance));
    standing.approachSpeed = approach.approachSpeed;
    return standing;
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
   *
   * The index is what lets an engine used as a weapon see what is behind it.
   * It is last step's — the rebuild happens after the world moves — which is
   * the same staleness a turret is trained through, and a hundredth of a
   * second of it. Without one, no engine fires on its own account and every
   * ship flies exactly as it would have.
   */
  command(dt: number, world: World, grid?: SpatialGrid): void {
    const bodies = world.bodies;
    this.bodyStore = bodies;

    for (let i = 0; i < this.alive.length; i++) {
      if (this.alive[i] === 0) continue;
      // Nobody aboard a severed chunk, and nobody left aboard a ship whose
      // cores have been shot out, so nothing holds its heading or kills its
      // drift: it tumbles on with whatever the break or the last hit gave it.
      if (!this.hasControl(i)) continue;
      this.removeInvalidOrders(i);
      this.decide(world, bodies, i);
      this.decideTurrets(world, bodies, i);
      this.flyOne(dt, bodies, i, grid);
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
    this.bodyStore = bodies;
    let projectilesFired = 0;
    let beamsFired = 0;

    for (let i = 0; i < this.alive.length; i++) {
      if (this.alive[i] === 0) continue;
      // A gun with nothing left to tell it what to shoot at holds its fire,
      // which is the same rule for a severed chunk and for a ship whose cores
      // have gone.
      if (!this.hasControl(i)) continue;
      const design = this.designs[i]!;
      const indices = this.turretIndex[i]!;
      const aiming = this.turretAiming[i]!;
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

        // What this gun was trained on, rather than what it would pick now:
        // the hull has turned since, and a target chosen after the barrel
        // stopped moving is one the barrel is not pointing at.
        const target = aiming[t]!;

        // skip if it's not ready to fire, and it's not committed to being on.
        if ((target === NO_TARGET || !this.turrets.readyToFire(ti)) && state != TurretState.CommittedOn) continue;

        const lateralOffset =
          gun.barrelCount > 1
            ? (barrel - (gun.barrelCount - 1) * 0.5) * gun.barrelSpacing
            : 0;

        this.turrets.firingSolution(bodies, ti, this.solution, lateralOffset);

        // A burst already committed is seen through: the emitter is lit and
        // there is nothing to hold. Discipline is about pulling the trigger.
        if (state != TurretState.CommittedOn && this.friendlyInTheWay(bodies, grid, i, bodyIdx, gun, target)) {
          continue;
        }

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
   * Burn whatever every burning engine is pointed at.
   *
   * Driven after the index is rebuilt, like firing, and with the throttles the
   * pilot set before the world stepped: an engine damages what is behind it
   * now, where it is now.
   *
   * The thrust it burns with is what the engine is actually producing rather
   * than what it is rated at, so an engine that damage has already half killed
   * leaves a shorter, weaker flame — which is also the flame the renderer
   * draws, since `throttleOf` reports the same fraction.
   */
  scorch(world: World, grid: SpatialGrid, dt: number): void {
    const bodies = world.bodies;
    this.bodyStore = bodies;

    for (let i = 0; i < this.alive.length; i++) {
      if (this.alive[i] === 0) continue;
      const bodyIdx = bodies.indexOf(this.bodyIds[i]!);
      if (bodyIdx < 0) continue;
      const design = this.designs[i]!;
      const throttles = this.throttles[i]!;

      for (let t = 0; t < design.thrusters.length; t++) {
        const force = throttles[t]! * this.exhaustOf(design, bodyIdx, t);
        if (!(force > 0)) continue;
        this.plumes.burn(design, t, force, this.damage, bodies, bodyIdx, grid, this.hulls, dt);
      }
    }
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
  private flyOne(dt: number, bodies: Bodies, i: number, grid?: SpatialGrid): void {
    const b = bodies.indexOf(this.bodyIds[i]!);
    if (b < 0) return;

    // **Where a craft wants to go is several wants added up.** Holding the
    // station it has been given, staying with what it is covering, and keeping
    // out of everybody's way are not alternatives to choose between: a craft
    // does all three at once, more or less, and what decides how much of each
    // is one weight against another in metres per second — which is a currency
    // they all share, unlike a target's score.
    //
    // Every urge is a *velocity* it would like to have and how much it would
    // like it, and the result is their weighted average. With one urge that is
    // exactly the urge, so a craft with nothing to avoid and nobody to cover
    // flies its orders as it always did.
    this.urgeVx = 0;
    this.urgeVy = 0;
    this.urgeWeight = 0;
    let wantAngle = bodies.angle[b]!;

    // No order at all is the same problem as an order with no target: hold
    // what you are doing and wait to be told something.
    const order = this.effectiveOrder(i);
    const target = order?.target ?? NO_TARGET;
    if (order !== undefined && target !== NO_TARGET && this.alive[target] === 1) {
      const tb = bodies.indexOf(this.bodyIds[target]!);
      if (tb >= 0) {
        wantAngle = atan2(bodies.y[tb]! - bodies.y[b]!, bodies.x[tb]! - bodies.x[b]!);
        this.hold(bodies, b, tb, order.minRange, order.maxRange, order.approachSpeed, URGE_REFERENCE);
      }
    }

    const covering = this.cover(bodies, i, b);
    if (target === NO_TARGET && covering >= 0) {
      const cb = bodies.indexOf(this.bodyIds[covering]!);
      if (cb >= 0) wantAngle = atan2(bodies.y[cb]! - bodies.y[b]!, bodies.x[cb]! - bodies.x[b]!);
    }
    this.avoid(bodies, i, b, target !== NO_TARGET ? target : covering);

    // Nothing to want is a want of its own: a craft with no orders, no charge
    // and nothing in its way kills its drift and waits.
    const wantVx = this.urgeWeight > 0 ? this.urgeVx / this.urgeWeight : 0;
    const wantVy = this.urgeWeight > 0 ? this.urgeVy / this.urgeWeight : 0;

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

    // Engines the designer meant as weapons, lit because something worth
    // burning is behind them. Decided before the allocation and taken off the
    // demand, so the rest of the layout spends its step cancelling the push
    // rather than discovering it next step and chasing it forever.
    const firing = this.aimEngines(bodies, grid, i, layout);
    let demandFx = localFx;
    let demandFy = localFy;
    let demandTorque = clamp(localTorque, -maxTorque, maxTorque);
    if (firing > 0) {
      const forced = this.forced;
      for (let t = 0; t < layout.count; t++) {
        if (forced[t] === 0) continue;
        demandFx -= layout.wfx[t]!;
        demandFy -= layout.wfy[t]!;
        demandTorque -= layout.wt[t]!;
      }
    }

    const throttles = this.throttles[i]!;
    layout.allocate(demandFx, demandFy, demandTorque, throttles, this.allocation);

    if (firing === 0) {
      this.demandFx[i] = this.allocation.fx;
      this.demandFy[i] = this.allocation.fy;
      this.demandTorque[i] = this.allocation.torque;
      return;
    }

    // A weapon engine burns flat out whatever the allocator made of it, and
    // the wrench is read back off the throttles rather than off the solve,
    // which knew nothing about them.
    let fx = 0;
    let fy = 0;
    let torque = 0;
    for (let t = 0; t < layout.count; t++) {
      if (this.forced[t] === 1) throttles[t] = 1;
      const u = throttles[t]!;
      fx += layout.wfx[t]! * u;
      fy += layout.wfy[t]! * u;
      torque += layout.wt[t]! * u;
    }
    this.demandFx[i] = fx;
    this.demandFy[i] = fy;
    this.demandTorque[i] = torque;
  }

  /**
   * Mark every engine this ship should fire as a weapon this step, in
   * `forced`, and say how many.
   *
   * An engine burns on its own account when something worth burning is in the
   * part of its plume that would actually hurt — asked at full throttle, since
   * the question is whether to open up rather than what the current burn
   * happens to reach. What counts as worth burning is what a gun would shoot
   * at: not its own hull, not a friend, not wreckage, and not a hulk, which
   * can never be finished off and is not worth being shoved about for.
   */
  private aimEngines(
    bodies: Bodies,
    grid: SpatialGrid | undefined,
    i: number,
    layout: ThrusterLayout,
  ): number {
    const design = this.designs[i]!;
    const armed = design.weaponThrusters;
    if (grid === undefined || armed.length === 0) return 0;

    if (this.forced.length < layout.count) this.forced = new Uint8Array(layout.count);
    const forced = this.forced;
    forced.fill(0);

    const b = bodies.indexOf(this.bodyIds[i]!);
    if (b < 0) return 0;

    let firing = 0;
    for (let k = 0; k < armed.length; k++) {
      const t = armed[k]!;
      // What the nozzle throws rather than what the ship gets — a buried engine
      // has a full flame and no thrust, and it is the flame that burns — less
      // whatever damage has taken off it, since an engine that cannot burn
      // cannot burn anybody.
      const force = this.exhaustOf(design, b, t);
      if (!(force > 0)) continue;
      // Any ray will do: a hull off to one side of a nozzle is as much worth
      // burning as one dead astern, and the rays exist precisely so that the
      // flame's width counts.
      let worth = false;
      const engine = design.modules[design.thrusters[t]?.module ?? -1];
      const rays = engine === undefined ? 0 : plumeRays(thrusterGeometry(engine.spec));
      for (let ray = 0; ray < rays && !worth; ray++) {
        if (!this.plumes.cast(design, t, ray, force, bodies, b, grid, this.hulls)) continue;
        if (this.plumes.share < WEAPON_PLUME_SHARE) continue;
        if (this.plumes.body === b) continue;
        const other = this.shipAt(bodies, this.plumes.body);
        if (other < 0 || this.derelict[other] === 1) continue;
        if (this.team[other] === this.team[i] || this.isDisabled(other)) continue;
        worth = true;
      }
      if (!worth) continue;
      forced[t] = 1;
      firing++;
    }
    return firing;
  }

  /** Add one want to the blend: a velocity, and how much it is wanted. */
  private urge(weight: number, vx: number, vy: number): void {
    if (!(weight > 0)) return;
    this.urgeVx += weight * vx;
    this.urgeVy += weight * vy;
    this.urgeWeight += weight;
  }

  /**
   * Want to be somewhere between two ranges of another body, and moving with
   * it once there.
   *
   * Station-keeping is matching the other's velocity; closing or opening is
   * that plus a radial component. Inside the band a craft simply keeps pace,
   * which is what makes a range band a place to sit rather than a line to
   * oscillate across. The closing speed tapers with how far outside the band
   * it is instead of being the full approach speed right up to the edge, which
   * is what stops a ship arriving at the band still doing 150 m/s, sailing
   * through it, and settling into a limit cycle across it: `approachSpeed`
   * is the cap rather than the demand.
   *
   * Every positional want in the game is this one — an order, a charge to
   * cover, and a neighbour to keep clear of are the same shape with different
   * bands, and a craft that is avoiding something is station-keeping on it
   * with a minimum range and no maximum.
   */
  private hold(
    bodies: Bodies,
    b: number,
    other: number,
    minRange: number,
    maxRange: number,
    approachSpeed: number,
    weight: number,
  ): void {
    if (!(weight > 0)) return;
    const dx = bodies.x[other]! - bodies.x[b]!;
    const dy = bodies.y[other]! - bodies.y[b]!;
    const range = length(dx, dy);
    let vx = bodies.vx[other]!;
    let vy = bodies.vy[other]!;
    if (range > 0) {
      // How far outside the band, signed: positive means too far away.
      const outside =
        range > maxRange ? range - maxRange : range < minRange ? range - minRange : 0;
      if (outside !== 0) {
        const radial = clamp(outside / APPROACH_TIME, -approachSpeed, approachSpeed);
        vx += (dx / range) * radial;
        vy += (dy / range) * radial;
      }
    }
    this.urge(weight, vx, vy);
  }

  /**
   * Stay with what this craft is covering, and say what that is.
   *
   * The pull fades to nothing as the gap closes (`cohesionUrge`), so a craft
   * that has caught up is steered by the fight alone until the fight has drawn
   * it off again — which is what has a fleet close up, advance while it is
   * closed up, and gather when it straggles, rather than either huddling or
   * stringing out.
   */
  private cover(bodies: Bodies, i: number, b: number): number {
    const consort = this.consort[i]!;
    if (consort === NO_TARGET || this.alive[consort] !== 1) return NO_TARGET;
    const cb = bodies.indexOf(this.bodyIds[consort]!);
    if (cb < 0) return NO_TARGET;

    const design = this.designs[i]!;
    const station = this.escortBand(design, consort);
    const gap = length(bodies.x[cb]! - bodies.x[b]!, bodies.y[cb]! - bodies.y[b]!);
    const weight = cohesionUrge(design.doctrine.targeting, gap, station);
    const approach = design.doctrine.approach;
    this.hold(
      bodies,
      b,
      cb,
      0,
      station,
      approach.approachSpeed,
      weight,
    );
    return consort;
  }

  /**
   * Keep out of everybody's way.
   *
   * Whoever it is: a collision hurts both hulls whichever side they are on,
   * and a craft that swerved only for its friends would ram its enemies by
   * accident and call it tactics.
   *
   * **Steered by where a neighbour will be, not by where it is.** Distance
   * alone cannot do this job: a craft holding station a hull's width away is
   * no danger at all and one crossing at two hundred metres a second is,
   * and a bubble treats them the same — so it shoves at things already moving
   * apart and has nothing to say about the thing about to arrive. Measured,
   * a plain bubble moved a fleet action's contacts by a tenth and made some of
   * them worse.
   *
   * So: how long until this pair is at its closest, and how close that will
   * be. A pair that is already opening is left alone, and one that is closing
   * is answered by a want to be somewhere else *at that moment* — steering
   * away from where the gap will be, which is a heading change rather than a
   * stop, so a craft keeps the speed it is carrying and passes wider.
   *
   * The urgency is how little room the pass will leave and how soon it is, so
   * keeping clear is a whisper at the edge of the look-ahead and the loudest
   * thing in the blend just before a collision.
   */
  private avoid(bodies: Bodies, i: number, b: number, flying: number): void {
    const approach = this.designs[i]!.doctrine.approach;
    if (!(approach.separation > 0) || !(approach.separationRadii > 0)) return;
    const mine = this.designs[i]!.radius;
    const x = bodies.x[b]!;
    const y = bodies.y[b]!;
    const vx = bodies.vx[b]!;
    const vy = bodies.vy[b]!;

    for (let t = 0; t < this.alive.length; t++) {
      if (t === i || this.alive[t] === 0) continue;
      // Never the thing it is flying at. Where a craft wants to be relative to
      // that is already decided, by an order or by the doctrine that chose it,
      // and a second opinion here is this code arguing with the orders it is
      // meant to be carrying out — a ship told to ram would sheer off at the
      // last moment and call it seamanship.
      if (t === flying) continue;
      const ob = bodies.indexOf(this.bodyIds[t]!);
      if (ob < 0) continue;

      const touching = mine + this.designs[t]!.radius;
      const room = touching * approach.separationRadii;
      const dx = bodies.x[ob]! - x;
      const dy = bodies.y[ob]! - y;
      const rvx = bodies.vx[ob]! - vx;
      const rvy = bodies.vy[ob]! - vy;

      // When they will be at their closest, and how far apart that is. A pair
      // already opening is at its closest *now*, which is what the clamp says
      // — and saying it that way rather than dropping the pair is what keeps
      // this continuous: an urge that vanished the instant two craft stopped
      // closing would step from its loudest to nothing at the very moment it
      // was loudest, and that discontinuity is enough to make two runs of the
      // same battle diverge from a rounding difference.
      const speedSq = rvx * rvx + rvy * rvy;
      const closing = dx * rvx + dy * rvy;
      const when = speedSq > 0 ? max(0, -closing / speedSq) : 0;
      if (when > AVOID_HORIZON) continue;
      const missX = dx + rvx * when;
      const missY = dy + rvy * when;
      const miss = length(missX, missY);
      if (miss >= touching + room) continue;

      // Away from where the gap is going to be. A pass that would be dead on
      // has no side to go to, so the side is taken across the closing motion
      // — either way opens it, and taking the same one every time is what
      // keeps this deterministic.
      let awayX: number;
      let awayY: number;
      if (miss > 0) {
        awayX = -missX / miss;
        awayY = -missY / miss;
      } else if (speedSq > 0) {
        const speed = sqrt(speedSq);
        awayX = -rvy / speed;
        awayY = rvx / speed;
      } else {
        continue;
      }

      const crowding = 1 - miss / (touching + room);
      const soon = 1 - when / AVOID_HORIZON;
      this.urge(
        approach.separation * crowding * soon,
        vx + awayX * approach.approachSpeed,
        vy + awayY * approach.approachSpeed,
      );
    }
  }

  /** Train each of this ship's turrets on what it is fighting, leading it. */
  private trainOne(bodies: Bodies, i: number): void {
    const indices = this.turretIndex[i]!;
    const aiming = this.turretAiming[i]!;
    for (let t = 0; t < indices.length; t++) {
      const ti = indices[t]!;
      const target = this.turretAim(bodies, i, t);
      aiming[t] = NO_TARGET;
      if (target === NO_TARGET) {
        this.turrets.returnToRest(ti);
        continue;
      }
      const tb = bodies.indexOf(this.bodyIds[target]!);
      if (tb < 0) {
        this.turrets.returnToRest(ti);
        continue;
      }
      aiming[t] = target;

      // Where on it: a part, when the doctrine has an opinion about parts and
      // that part is still there, and otherwise the ship.
      //
      // **The part's position, the hull's velocity.** A part does not travel
      // in the straight line a firing solution assumes: it goes round the
      // centre of mass, so extrapolating the ω × r it has right now sends the
      // aim point off on a tangent that grows with the square of the flight
      // time. Leading the *hull* instead is wrong by at most how far the part
      // sits from the centre of mass, whatever the flight time — metres,
      // against a lead measured in hundreds of them. It is the better
      // approximation for every shot long enough for the difference to
      // matter, and the tangent is worse for exactly those.
      //
      // The error it does leave — a part swinging round to the far side while
      // the round is in the air — grows with the hull's rate of turn and its
      // size, and those pull against each other: a ship large enough for the
      // offset to matter is one too heavy to spin quickly. It is also the
      // forgiving kind of error: an aim point held on the hull puts a round
      // that misses the part it was meant for into some other part of the
      // same ship, where a tangent that has run off the ship misses
      // altogether.
      const part = this.aimPart(i, t, target, tb);
      const design = this.designs[target]!;
      let x = bodies.x[tb]!;
      let y = bodies.y[tb]!;
      // What the barrel has to keep up with is the part's own motion, ω × r
      // and all: that is how fast the sky it sits in is moving. Only the lead
      // is the hull's.
      let sweepVx = bodies.vx[tb]!;
      let sweepVy = bodies.vy[tb]!;
      if (part !== WHOLE_SHIP) {
        const angle = bodies.angle[tb]!;
        const module = design.modules[part]!;
        const rx = module.x * cos(angle) - module.y * sin(angle);
        const ry = module.x * sin(angle) + module.y * cos(angle);
        const spin = bodies.angularVel[tb]!;
        x += rx;
        y += ry;
        sweepVx -= spin * ry;
        sweepVy += spin * rx;
      }
      this.turrets.aimAt(bodies, ti, x, y, bodies.vx[tb]!, bodies.vy[tb]!, sweepVx, sweepVy);
    }
  }

  /**
   * The part of its target this mount is aiming at, or `WHOLE_SHIP`.
   *
   * Checked here rather than trusted, because what was chosen may since have
   * been shot away or broken off — and a gun holding its aim on a module that
   * is no longer there would be pointing at empty space beside the ship. A
   * target that has just come apart renumbers its modules, so a mount may aim
   * at the wrong part of it until it next looks; that is a fraction of a
   * second of pointing at the same ship, which is why it is left alone.
   */
  private aimPart(i: number, t: number, target: number, targetBody: number): number {
    const part = this.turretAimModule[i]![t]!;
    if (part === WHOLE_SHIP) return WHOLE_SHIP;
    if (this.turretTarget[i]![t] !== target) return WHOLE_SHIP;
    const design = this.designs[target]!;
    if (part >= design.modules.length) return WHOLE_SHIP;
    return this.damage.spent(targetBody, part) ? WHOLE_SHIP : part;
  }

  /**
   * Remove a ship and its turrets. The body is the caller's to destroy, since
   * a dead ship's hull normally stays in the world as a wreck (§4).
   */
  /**
   * Record a blow a hull has to survive: an impulse, newton-seconds, applied
   * at a world-frame point on the module it landed on.
   *
   * The momentum itself is the caller's to apply — the contact solver and the
   * gunnery each already do it, and doing it twice would be inventing
   * momentum. This is only the structural half: what the blow does to the
   * welds holding the ship together, answered by `sever`.
   */
  blow(bodyIndex: number, module: number, jx: number, jy: number, px: number, py: number): void {
    if (module < 0) return;
    if (!(jx !== 0 || jy !== 0)) return;
    const i = this.blows++;
    this.blowBody[i] = bodyIndex;
    this.blowModule[i] = module;
    this.blowJx[i] = jx;
    this.blowJy[i] = jy;
    this.blowX[i] = px;
    this.blowY[i] = py;
  }

  /**
   * Answer this step's blows, breaking hulls where they could not take them,
   * and say how many pieces came off.
   *
   * **What parts a hull is a blow, not a wound.** Damage decides how much of
   * a weld is left; something still has to hit the ship hard enough to spend
   * it. So a ship shot to pieces around its spine goes on carrying its wings
   * until something *hits* it, which is the whole difference between a hull
   * coming apart and a hull dissolving.
   *
   * `contacts` are this step's collisions, which are blows like any other and
   * the heaviest a battle has.
   */
  sever(world: World, contacts?: Contacts): number {
    const bodies = world.bodies;
    this.bodyStore = bodies;

    if (contacts !== undefined) {
      for (let k = 0; k < contacts.count; k++) {
        const j = contacts.impulse[k]!;
        if (!(j > 0)) continue;
        const jx = contacts.nx[k]! * j;
        const jy = contacts.ny[k]! * j;
        const x = contacts.x[k]!;
        const y = contacts.y[k]!;
        // The normal points from `a` towards `b`, so `a` took it the other way.
        this.blow(contacts.a[k]!, contacts.moduleA[k]!, -jx, -jy, x, y);
        this.blow(contacts.b[k]!, contacts.moduleB[k]!, jx, jy, x, y);
      }
    }

    let pieces = 0;
    pieces += this.partCutWelds(world);
    for (let k = 0; k < this.blows; k++) {
      pieces += this.answer(world, this.blowBody[k]!, this.blowModule[k]!, this.blowJx[k]!, this.blowJy[k]!, this.blowX[k]!, this.blowY[k]!);
    }
    this.blows = 0;
    return pieces;
  }

  /**
   * Let go of every weld that has been cut through.
   *
   * **A cut needs no blow.** Everything else here is a weld failing under a
   * load, but a weld with none of its section left is not a weak weld: it is
   * an absent one, and what it was holding is simply no longer attached.
   *
   * Walked only for hulls something has cut into since the last look, which
   * is a version comparison like the thruster layout's.
   */
  private partCutWelds(world: World): number {
    const bodies = world.bodies;
    let pieces = 0;
    for (let i = 0; i < this.alive.length; i++) {
      if (this.alive[i] === 0) continue;
      const b = bodies.indexOf(this.bodyIds[i]!);
      if (b < 0) continue;
      const version = this.damage.cutVersion(b);
      if (this.cutSeen[i] === version) continue;
      this.cutSeen[i] = version;

      const design = this.designs[i]!;
      const all = joints(design);
      let through = false;
      for (let k = 0; k < all.length; k++) {
        if (this.damage.weldIntegrity(b, k, all[k]!.width) > 0) continue;
        through = true;
        break;
      }
      if (!through) continue;

      const parts = components(design, (joint) => {
        const k = jointBetween(design, joint.a, joint.b);
        return this.damage.weldIntegrity(b, k, joint.width) <= 0;
      });
      if (parts.length < 2) continue;
      const keeper = this.keeperOf(b, design, parts);
      for (let p = 0; p < parts.length; p++) {
        if (p === keeper) continue;
        if (this.detach(world, i, design, parts[p]!)) pieces++;
      }
      this.reshape(world, i, design, parts[keeper]!);
    }
    return pieces;
  }

  /**
   * Stop tracking wreckage that has drifted out of the fight, and say how
   * many pieces were let go.
   *
   * Between "too smashed to be worth harvesting" and "worth hunting down" is
   * a question about *relevance* rather than size: what matters is whether a
   * piece could still hit somebody or still be worth going after, and both
   * depend on how big it is and how far it is from where the fighting is. So
   * a piece is kept while it is within the battle plus its own reach, and its
   * reach grows with its mass — a shard goes as soon as it leaves, a tonne of
   * hull has to clear the fight by kilometres, and a serious chunk never
   * really leaves at all.
   *
   * Only wreckage. A ship is tracked wherever it goes, because a ship can
   * come back.
   */
  cull(world: World): number {
    const bodies = world.bodies;
    const area = this.battleArea(bodies);
    let dropped = 0;

    for (let i = 0; i < this.alive.length; i++) {
      if (this.alive[i] === 0 || this.derelict[i] === 0) continue;
      const b = bodies.indexOf(this.bodyIds[i]!);
      if (b < 0) continue;
      const design = this.designs[i]!;
      const reach = area.radius + (design.mass - SCRAP_MASS) * SALVAGE_REACH;
      if (length(bodies.x[b]! - area.x, bodies.y[b]! - area.y) <= reach) continue;

      this.discarded += design.mass;
      this.discardedPx += design.mass * bodies.vx[b]!;
      this.discardedPy += design.mass * bodies.vy[b]!;
      this.damage.forget(b);
      this.shipByBody[b] = -1;
      this.remove(i);
      world.destroy(this.bodyIds[i]!);
      dropped++;
    }

    return dropped;
  }

  /**
   * Where the fighting is and how far it reaches: the ships still in it, and
   * the distance from the middle of them to the furthest.
   *
   * Their centre and their spread rather than the smallest circle that
   * contains them — the exact answer is either randomised or cubic, and what
   * this is for is the *scale* of the fight rather than a tight bound. Hulks
   * count, since a drifting wreck is still somewhere the battle was.
   */
  private battleArea(bodies: Bodies): { x: number; y: number; radius: number } {
    let x = 0;
    let y = 0;
    let n = 0;
    for (let i = 0; i < this.alive.length; i++) {
      if (this.alive[i] === 0 || this.derelict[i] === 1) continue;
      const b = bodies.indexOf(this.bodyIds[i]!);
      if (b < 0) continue;
      x += bodies.x[b]!;
      y += bodies.y[b]!;
      n++;
    }
    if (n === 0) return { x: 0, y: 0, radius: Infinity };
    x /= n;
    y /= n;

    let radius = MINIMUM_BATTLE_RADIUS;
    for (let i = 0; i < this.alive.length; i++) {
      if (this.alive[i] === 0 || this.derelict[i] === 1) continue;
      const b = bodies.indexOf(this.bodyIds[i]!);
      if (b < 0) continue;
      radius = max(radius, length(bodies.x[b]! - x, bodies.y[b]! - y));
    }
    return { x, y, radius };
  }

  /** The ship a body is, or -1 — guarded, since a body's slot is reused. */
  private shipAt(bodies: Bodies, bodyIndex: number): number {
    const i = this.shipByBody[bodyIndex];
    if (i === undefined || i < 0) return -1;
    if (this.alive[i] !== 1) return -1;
    if (bodies.indexOf(this.bodyIds[i]!) !== bodyIndex) return -1;
    return i;
  }

  /**
   * What one blow does to one hull.
   *
   * The hull answers the blow as a rigid body would — every module has to
   * reach the new motion — and a weld's job is to drag whatever hangs off it
   * along. So the load through a weld is the impulse that has to *cross* it:
   * the far side's mass by the velocity change at the far side's centre. That
   * is the whole of why a hit on an outlying module takes it off while the
   * same hit amidships takes nothing: the wing's root has to carry the ship,
   * and the ship's middle barely has to carry the wing.
   *
   * **A blow is spent as it breaks things.** The worst-loaded weld goes
   * first, its strength comes off the blow, and what is left goes on to the
   * next — so a ram tears off as much as it has paid for and a nudge tears
   * off one thing or nothing. Answering every overloaded weld at once is what
   * makes a ship shatter rather than break.
   */
  private answer(
    world: World,
    bodyIndex: number,
    module: number,
    jx: number,
    jy: number,
    px: number,
    py: number,
  ): number {
    const bodies = world.bodies;
    const i = this.shipAt(bodies, bodyIndex);
    if (i < 0) return 0;
    const design = this.designs[i]!;
    if (design.modules.length < 2) return 0;
    if (module >= design.modules.length) return 0;

    const all = joints(design);
    const sides = cuts(design);
    if (all.length === 0) return 0;

    // The hull's response, in its own frame, where its modules live.
    const angle = bodies.angle[bodyIndex]!;
    const c = cos(angle);
    const s = sin(angle);
    const invMass = bodies.invMass[bodyIndex]!;
    const invInertia = bodies.invInertia[bodyIndex]!;
    const rcx = px - bodies.x[bodyIndex]!;
    const rcy = py - bodies.y[bodyIndex]!;
    const spin = (rcx * jy - rcy * jx) * invInertia;
    // Where the blow landed, in the hull's frame, to measure outward from.
    const hitX = rcx * c + rcy * s;
    const hitY = -rcx * s + rcy * c;
    const dvx = (jx * invMass) * c + (jy * invMass) * s;
    const dvy = -(jx * invMass) * s + (jy * invMass) * c;

    const failed = new Set<Joint>();
    // What the blow has left to give. Every load is linear in it, so spending
    // it is one scale over all of them.
    const delivered = sqrt(jx * jx + jy * jy);
    let budget = delivered;
    for (;;) {
      let worst = -1;
      let worstLoad = 0;
      let worstStrength = 0;
      for (let k = 0; k < all.length; k++) {
        const joint = all[k]!;
        if (failed.has(joint)) continue;
        const cut = sides[k];
        if (cut === null || cut === undefined) continue;
        const far = 1 - cut.side[module]!;
        const mass = cut.mass[far]!;
        if (!(mass > 0)) continue;
        // Velocity change where the far side's mass actually is.
        const fx = dvx - spin * cut.y[far]!;
        const fy = dvy + spin * cut.x[far]!;
        // What is left of the shock by the time it reaches this weld.
        const away = length(joint.x - hitX, joint.y - hitY);
        const carried = SHOCK_REACH / (SHOCK_REACH + away);
        const load = (mass * sqrt(fx * fx + fy * fy) * budget * carried) / delivered;
        const strength = this.weldStrength(bodyIndex, joint, k);
        if (load <= strength) continue;
        if (load - strength <= worstLoad - worstStrength) continue;
        worst = k;
        worstLoad = load;
        worstStrength = strength;
      }
      if (worst < 0) break;
      failed.add(all[worst]!);
      // Tearing a weld costs the blow what the weld was worth.
      budget -= worstStrength;
      if (!(budget > 0)) break;
    }
    if (failed.size === 0) return 0;

    const parts = components(design, (joint) => failed.has(joint));
    if (parts.length < 2) return 0;

    let pieces = 0;
    const keeper = this.keeperOf(bodyIndex, design, parts);
    for (let p = 0; p < parts.length; p++) {
      if (p === keeper) continue;
      if (this.detach(world, i, design, parts[p]!)) pieces++;
    }
    this.reshape(world, i, design, parts[keeper]!);
    return pieces;
  }

  /**
   * Which piece of a hull that has just come apart goes on being the ship,
   * as an index into `parts`.
   *
   * **The piece holding the lowest-numbered working core.** A ship is flown
   * from its cores, so that is where everything that belongs to the ship
   * rather than to its shape stays: its orders, its side, and what its guns
   * were doing. Lowest-numbered and not largest, for the reason the layout
   * rule anchors on the first core — the size of a piece says nothing about
   * which of them is still a ship, and an index gives the same answer every
   * time the same battle is run.
   *
   * Every *other* piece with a working core of its own becomes a ship too;
   * this only decides which of them is the one that was already there. A hull
   * with no working core left keeps the piece holding its first core, or its
   * lowest module if it has no core at all — a chunk coming apart further.
   * Both are wreckage whichever piece is chosen, so what this settles for them
   * is merely which body goes on being tracked.
   */
  private keeperOf(bodyIndex: number, design: ShipDesign, parts: readonly number[][]): number {
    const partOf = new Map<number, number>();
    for (let p = 0; p < parts.length; p++) {
      for (const module of parts[p]!) partOf.set(module, p);
    }
    let fallback = -1;
    // `cores` is in module order, so the first one that works wins and the
    // first one at all is the fallback.
    for (const core of design.cores) {
      const p = partOf.get(core);
      if (p === undefined) continue;
      if (fallback < 0) fallback = p;
      if (this.damage.remaining(bodyIndex, core, DamageEffect.Control) > 0) return p;
    }
    return fallback < 0 ? 0 : fallback;
  }

  /**
   * What a weld can still carry, newton-seconds.
   *
   * A weld is only as good as the metal at its ends, so damage to either
   * module takes it down — but never to nothing: **wreckage is still metal,
   * and still holds, badly.** Without that floor a hull whose middle had been
   * shot out would shed everything at the first nudge, which is the failure
   * this model exists to avoid.
   */
  private weldStrength(bodyIndex: number, joint: Joint, index: number): number {
    const metal = min(
      this.damage.integrity(bodyIndex, joint.a),
      this.damage.integrity(bodyIndex, joint.b),
    );
    // What is left of the section, which no amount of sound metal at its ends
    // can make up for: a weld cut through is not a weak weld but an absent one.
    const section = this.damage.weldIntegrity(bodyIndex, index, joint.width);
    return joint.strength * section * (WRECK_STRENGTH + (1 - WRECK_STRENGTH) * metal);
  }

  /**
   * Put a piece of a ship into the world as a body of its own.
   *
   * It leaves with the velocity the point it broke off at already had —
   * `v + ω × r` — and the hull's spin, which is what a rigid split conserves:
   * no impulse is invented, so the momentum and the angular momentum of the
   * pieces together are the ones the whole hull had a moment earlier.
   *
   * **A piece with a working core leaves as a ship**, not as wreckage: it is
   * flown, it shoots, it keeps the side it was on, and it works through a copy
   * of the plan the ship was given, because whoever was aboard it was given
   * that plan too. Everything else comes away as a piece of hull with nobody
   * aboard. This is what a second core buys — a hull cut in two amidships
   * becomes two ships rather than a ship and a wreck.
   */
  private detach(world: World, i: number, design: ShipDesign, keep: readonly number[]): boolean {
    const bodies = world.bodies;
    const b = bodies.indexOf(this.bodyIds[i]!);
    const chunk = subDesign(design, keep);
    const offset = this.offsetOf(bodies, b, design, chunk);
    const spin = bodies.angularVel[b]!;
    // Asked of the hull it is still part of, since that is where the damage
    // to these modules is recorded.
    const flies = chunk.cores.some(
      (core) => this.damage.remaining(b, keep[core]!, DamageEffect.Control) > 0,
    );
    // Scrap never reaches the world, so nothing the eye was following ever
    // vanishes: a piece this small is not created rather than removed. A piece
    // that still flies is not scrap at whatever mass — it is a ship, and the
    // smallest ship in the game weighs less than this.
    if (!flies && chunk.mass < SCRAP_MASS) {
      this.discarded += chunk.mass;
      // Whatever it would have left with, had it been worth putting there.
      this.discardedPx += chunk.mass * (bodies.vx[b]! - spin * offset.y);
      this.discardedPy += chunk.mass * (bodies.vy[b]! + spin * offset.x);
      return false;
    }

    const j = this.spawn(world, {
      design: chunk,
      x: bodies.x[b]! + offset.x,
      y: bodies.y[b]! + offset.y,
      angle: bodies.angle[b]!,
      vx: bodies.vx[b]! - spin * offset.y,
      vy: bodies.vy[b]! + spin * offset.x,
      angularVel: spin,
      team: this.team[i]!,
    });
    if (flies) {
      this.orders[j] = this.orders[i]!.map((order) => ({ ...order }));
    } else {
      this.derelict[j] = 1;
    }

    const chunkBody = bodies.indexOf(this.bodyIds[j]!);
    this.damage.register(
      chunkBody,
      chunk,
      this.scarsOf(b, keep),
      this.weldScarsOf(b, design, chunk, keep),
    );
    this.shipByBody[chunkBody] = j;
    return true;
  }

  /**
   * Cut a ship down to the piece its crew is on, in place.
   *
   * Everything derived from the layout is derived again, because the layout
   * is what changed: mass and inertia, the centre of mass the body turns
   * about, the thruster matrix, the mounts and their arcs. What is carried
   * over is state that belongs to the ship rather than to its shape — its
   * orders, its gun timers, where its surviving turrets were pointing, and
   * what each remaining module had already taken.
   */
  private reshape(world: World, i: number, was: ShipDesign, keep: readonly number[]): void {
    const bodies = world.bodies;
    const id = this.bodyIds[i]!;
    const b = bodies.indexOf(id);
    const design = subDesign(was, keep);
    const offset = this.offsetOf(bodies, b, was, design);
    const spin = bodies.angularVel[b]!;

    bodies.x[b] = bodies.x[b]! + offset.x;
    bodies.y[b] = bodies.y[b]! + offset.y;
    bodies.vx[b] = bodies.vx[b]! - spin * offset.y;
    bodies.vy[b] = bodies.vy[b]! + spin * offset.x;
    bodies.setMass(id, design.mass);
    bodies.setInertia(id, design.inertia);
    bodies.radius[b] = design.radius;

    const scars = this.scarsOf(b, keep);
    const weldScars = this.weldScarsOf(b, was, design, keep);

    // Mounts are added before the old ones go, so that a freed slot cannot be
    // handed straight back out and leave two turrets sharing an index.
    const indices = new Int32Array(design.turrets.length);
    const cooldown = new Float64Array(design.turrets.length);
    const states = new Uint8Array(design.turrets.length);
    const barrels = new Int32Array(design.turrets.length);
    const targets = new Int32Array(design.turrets.length).fill(NO_TARGET);
    const aiming = new Int32Array(design.turrets.length).fill(NO_TARGET);
    const aims = new Int32Array(design.turrets.length).fill(WHOLE_SHIP);
    const schedule = new Float64Array(design.turrets.length);
    for (let t = 0; t < design.turrets.length; t++) {
      const mount = design.turrets[t]!;
      const index = this.turrets.add({ ...mount.mount, owner: b });
      indices[t] = index;
      // Which mount this was, by the module it sits on.
      const module = keep[mount.module]!;
      let before = -1;
      for (let k = 0; k < was.turrets.length; k++) {
        if (was.turrets[k]!.module === module) before = k;
      }
      if (before < 0) continue;
      this.turrets.bearing[index] = this.turrets.bearing[this.turretIndex[i]![before]!]!;
      cooldown[t] = this.cooldown[i]![before]!;
      states[t] = this.turretStates[i]![before]!;
      barrels[t] = this.nextBarrelToFire[i]![before]!;
      targets[t] = this.turretTarget[i]![before]!;
      aiming[t] = this.turretAiming[i]![before]!;
      aims[t] = this.turretAimModule[i]![before]!;
      schedule[t] = this.turretRethinkAt[i]![before]!;
    }
    const old = this.turretIndex[i]!;
    for (let t = 0; t < old.length; t++) this.turrets.remove(old[t]!);

    this.designs[i] = design;
    this.hullDesign[b] = design;
    this.turretIndex[i] = indices;
    this.cooldown[i] = cooldown;
    this.turretStates[i] = states;
    this.nextBarrelToFire[i] = barrels;
    this.turretTarget[i] = targets;
    this.turretAiming[i] = aiming;
    this.turretAimModule[i] = aims;
    this.turretRethinkAt[i] = schedule;
    this.throttles[i] = new Float64Array(design.thrusters.length);
    this.layouts[i] = null;
    this.layoutVersion[i] = -1;
    this.damage.register(b, design, scars, weldScars);
    this.cutSeen[i] = this.damage.cutVersion(b);
  }

  /** What each kept module has already absorbed, in the new design's order. */
  private scarsOf(bodyIndex: number, keep: readonly number[]): number[] {
    const scars: number[] = [];
    for (let k = 0; k < keep.length; k++) scars.push(this.damage.absorbedAt(bodyIndex, keep[k]!));
    return scars;
  }

  /**
   * What has already been cut out of each weld the piece keeps, in the new
   * design's joint order — a weld half sawn through stays half sawn through.
   */
  private weldScarsOf(
    bodyIndex: number,
    was: ShipDesign,
    piece: ShipDesign,
    keep: readonly number[],
  ): number[] {
    const scars: number[] = [];
    for (const joint of joints(piece)) {
      scars.push(this.damage.cutAt(bodyIndex, jointBetween(was, keep[joint.a]!, keep[joint.b]!)));
    }
    return scars;
  }

  /**
   * Where a piece's centre of mass sits relative to the whole hull's, world
   * frame — the arm its share of the spin acts through.
   */
  private offsetOf(
    bodies: Bodies,
    b: number,
    was: ShipDesign,
    piece: ShipDesign,
  ): { x: number; y: number } {
    // Both centres are measured in the blueprint's frame, which is the body's
    // frame shifted rather than turned, so the difference needs only the
    // hull's angle to reach the world.
    const dx = piece.centreOfMassX - was.centreOfMassX;
    const dy = piece.centreOfMassY - was.centreOfMassY;
    const angle = bodies.angle[b]!;
    const c = cos(angle);
    const s = sin(angle);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }

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
  /**
   * What one of this ship's mounts is shooting at, or `NO_TARGET` — what it
   * was last trained on, which is the only target it can actually hit.
   *
   * `bodies` is no longer needed and is kept so that callers read the same
   * either way.
   */
  targetOfTurret(_bodies: Bodies, i: number, turret: number): number {
    return this.turretAiming[i]![turret]!;
  }

  turretIndexOf(i: number, turret: number): number {
    return this.turretIndex[i]![turret]!;
  }

  /**
   * What one of a ship's thrusters is producing, as a fraction of its rating.
   *
   * The throttle the allocator set, scaled by what damage has left of the
   * engine — so a half-wrecked engine at full throttle reports a half. That is
   * the quantity the plume is drawn from, and a burning engine drawing a flame
   * it is no longer capable of is the picture disagreeing with the burn.
   */
  throttleOf(i: number, thruster: number): number {
    const bodies = this.bodyStore;
    const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[i]!);
    if (b < 0) return this.throttles[i]![thruster]!;
    const spec = this.designs[i]!.thrusters[thruster]!;
    const left = this.damage.remaining(b, spec.module ?? -1, DamageEffect.Thrust);
    return this.throttles[i]![thruster]! * left;
  }

  /**
   * What one of this ship's engines is throwing out of its nozzle at full
   * throttle, newtons — its rating, less what damage has taken off it.
   *
   * Deliberately not the layout's figure, which is what the *ship* gets: an
   * engine firing into its own hull is throwing just as much gas as a clear
   * one and simply getting nothing for it, so the flame it burns with is the
   * rating and the thrust it flies on is not.
   */
  private exhaustOf(design: ShipDesign, bodyIndex: number, thruster: number): number {
    const spec = design.thrusters[thruster]!;
    return spec.maxThrust * this.damage.remaining(bodyIndex, spec.module ?? -1, DamageEffect.Thrust);
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
