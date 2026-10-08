import { Bodies, type BodyId } from './bodies.js';
import {
  reachAgainst,
  shotSpread,
  subDesign,
  triggerMask,
  weldDesigns,
  type DesignTurret,
  type ShipDesign,
} from './blueprint.js';
import { components, cuts, jointBetween, joints, type Joint } from './connectivity.js';
import { BOTH_LAYERS, HULL_LAYER, Hulls, moduleLayers, OWN_LAYERS, WEAPONS_LAYER } from './hull.js';
import { Damage, DamageEffect } from './damage.js';
import { Fuel, LEAK_HOLE_CALIBRES, leakChance, leakRate, leakSpeed, type Leak } from './fuel.js';
import { SEAL_REACH, SEAL_SPEED } from './modules.js';
import type { Rng } from './rng.js';
import {
  landedIndex,
  landedLength,
  plumeLayers,
  plumeRays,
  Plumes,
  WEAPON_PLUME_SHARE,
  weaponPlumeReach,
} from './exhaust.js';
import { Choice, cohesionUrge, inSight, look, lookFrom, score } from './targeting.js';
import {
  casingMass,
  chargeShare,
  DEFAULT_BURST_SPEED,
  DEFAULT_FRAGMENTS,
  DEFAULT_FUSE,
  engineGeometry,
  firesShells,
  moduleRadius,
  type ModuleSpec,
} from './modules.js';
import {
  abs,
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
import { Allocation, EngineLayout } from './engines.js';
import { addFlame, addTurret, attackBearing, AttackArcs, AttackRegion } from './attack.js';
import { FiringSolution, interceptTime, Turrets, TurretState } from './turrets.js';
import { holdBand, type Targeting } from './doctrine.js';
import type { World } from './world.js';
import type { BeamHits, Beams, SpatialGrid } from './index.js';
import { MAX_BEAM_LENGTH } from './beams.js';
import { RayHit } from './spatialGrid.js';
import { hullsOverlap, type Contacts } from './collision.js';
import { FUEL_DENSITY, GunType, interiorVolume, type GunStats, type ModuleKind } from './modules.js';

/**
 * Ships: a compiled design bound to a body, flying itself and shooting.
 *
 * This is the layer that turns the derived numbers into behaviour. A design
 * says what a ship *is* — its mass, where its engines point, what its guns
 * throw and how far each mount can train. A ship is one instance of that: a
 * body in the world, a set of throttles, a set of turrets, and an order.
 *
 * **Designs are shared, ships are not.** A hundred strike craft off one
 * blueprint hold one `ShipDesign` between them and one engine matrix; what
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

/** The least a fragment flies, seconds, however short its fuse. */
const FRAGMENT_MIN_LIFE = 0.5;

/** Twice the lead, so a fragment outlives the burst's arrival at what it was aimed at. */
function fragmentLife(spec: ModuleSpec): number {
  const life = 2 * (spec.fuse ?? DEFAULT_FUSE);
  return life > FRAGMENT_MIN_LIFE ? life : FRAGMENT_MIN_LIFE;
}

/**
 * What a craft with nothing pointing the way it would brake plans to stop on,
 * as a share of what it has pointing the other way. It has no such thing, so
 * it overshoots and comes about; without it, it would never set out. A
 * stop-gap until a craft can turn to brake (ROADMAP.md §12).
 */
const BRAKE_FLOOR = 0.25;

/**
 * How long a hull takes to settle the last few degrees onto its heading,
 * seconds. Landing in a single step instead asks for full torque over a
 * hundredth of a degree, and the hull rocks either side of its bearing with a
 * pair of its engines at full — which is thrust the ship meant to brake with.
 */
const HEADING_SETTLE_TIME = 0.25;

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

/**
 * The fastest a craft can be closing and still stop within `gap` metres
 * braking at `brake` m/s², once `delay` seconds have gone by at that speed.
 */
function stoppingSpeed(brake: number, gap: number, delay: number): number {
  if (!(brake > 0) || !Number.isFinite(delay)) return 0;
  const lag = brake * delay;
  return sqrt(2 * brake * gap + lag * lag) - lag;
}

/**
 * Roughly how long it takes to cover `gap` metres and stop: at the fastest of
 * `cruise` and what it can stop from (`stoppingSpeed`), then braking at
 * `brake` m/s². From that speed, so a measure of a plan, not of a craft.
 */
function arrivalTime(brake: number, gap: number, cruise: number, delay: number): number {
  const v = min(cruise, stoppingSpeed(brake, gap, delay));
  if (!(v > 0)) return Infinity;
  const braking = (v * v) / (2 * brake);
  return max(0, gap - braking) / v + v / brake;
}

/**
 * How far one of turning to burn and holding the guns on target has to
 * outscore the other to take over from it, as a share: enough that a craft
 * near the line between them does not flip its hull back and forth across it.
 */
const BURN_MARGIN = 0.25;

/** Seconds of closing at its approach speed that stand in for an unarmed rammer's reach in choosing a target. */
const RAM_HORIZON = 60;

/** Below this much velocity still to gain, m/s, a ram points its nose at the target rather than its thrust. */
const RAM_AIM_SPEED = 5;

/** How many times a ram may halve its ask for force to keep the torque to turn with. */
const RAM_FORCE_HALVINGS = 6;

/**
 * A turn short by less than this share of the torque the ship has is no turn
 * at all, and not worth giving up thrust for: a ram dead on its target asks for
 * round-off.
 */
const RAM_TORQUE_NEGLIGIBLE = 1e-6;

const TIMER_SETTLE = 1e-9;


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

/**
 * Closing speed at or below which a ragged edge hooks rather than glancing
 * off, m/s — a drift, not a ram. A dial, in ROADMAP.md §12 with the others.
 */
export const WELD_SPEED = 2;

/** How much of the smaller module's narrower side a hooked edge catches. */
const HOOK_SHARE = 0.5;

/**
 * Seconds a hull that has just come apart must drift before it can hook
 * again. A break leaves both faces torn and touching, and without this the
 * pieces would catch each other again on the next step.
 */
const WELD_SETTLE = 2;

export const NO_TARGET = -1;

/** World bearing from one point to another. */
function bearing(fromX: number, fromY: number, toX: number, toY: number): number {
  return atan2(toY - fromY, toX - fromX);
}

/** Aiming at a ship rather than at any part of it. */
const WHOLE_SHIP = -1;
/**
 * Nothing on this ship that this mount's doctrine will shoot at.
 *
 * Distinct from `WHOLE_SHIP`, which is a mount with no opinion about parts
 * firing at the hull: a ship is made of its modules, so a doctrine that has
 * refused every one left has refused the ship. Aiming at the hull instead
 * would hit exactly what was refused.
 */
const NOTHING_AIMABLE = -2;

/** What a doctrine thinks one kind of module is worth shooting at. */
function partWeight(doctrine: Targeting, kind: ModuleKind): number {
  if (kind === 'core') return doctrine.coreWeight;
  if (kind === 'engine') return doctrine.engineWeight;
  // A tank is shot at as plating until hitting one does something more.
  if (kind === 'structure' || kind === 'tank') return doctrine.structureWeight;
  return doctrine.gunWeight;
}

/**
 * Whether this doctrine would rather not damage some kind of module.
 *
 * The strongest of the three things an aim weight says, and the only one that
 * reaches the trigger: **above zero is destroy this, zero is leave it alone,
 * and below zero is mind not to hit it.** The first two are about what a
 * mount aims at; the third is about what it might hit by accident, so a mount
 * holding one waits until the part it chose is under the muzzle rather than
 * firing at anything on the hull.
 */
function refusesAnything(doctrine: Targeting): boolean {
  return (
    doctrine.coreWeight < 0 ||
    doctrine.engineWeight < 0 ||
    doctrine.gunWeight < 0 ||
    doctrine.structureWeight < 0
  );
}

/** Whether a doctrine has any opinion about which part of a ship to hit. */
function picksParts(doctrine: Targeting): boolean {
  return (
    doctrine.coreWeight !== 0 ||
    doctrine.engineWeight !== 0 ||
    doctrine.gunWeight !== 0 ||
    doctrine.structureWeight !== 0
  );
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
  /**
   * Fly into the target rather than hold a band, which is ignored. A fighter
   * drops into the hull layer to do it.
   */
  ram: boolean;
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
  /**
   * Which of its side's ships this is, counting from one in the order they
   * were put in (`serialOf`). Given for a piece of a ship, which carries the
   * ship's; drawn from the side's count otherwise.
   */
  serial?: number;
  /** Nothing can hurt it: no damage taken, no weld cut. See `Damage.protect`. */
  invulnerable?: boolean;
  /**
   * A marker rather than a hull: nothing collides with it, nothing it is in
   * front of is shielded by it, and nothing moves it. It can still be seen,
   * escorted and scored against. See `BodySpec.ghost`.
   */
  ghost?: boolean;
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
  /** What each body has left in its tanks. */
  readonly fuel = new Fuel();

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
   * Per-ship engine layouts, and the damage version each was built at.
   *
   * A design's layout is shared by every ship built to it, so a damaged ship
   * needs one of its own — rebuilt when its damage changes and not per step,
   * which is what §4's "damage never changes topology" buys: the geometry of
   * what can push is what changed, and mass properties are untouched.
   */
  private readonly layouts: (EngineLayout | null)[] = [];
  private readonly layoutVersion: number[] = [];
  /** Persistent between steps, per §12: never shared scratch. */
  private readonly throttles: Float64Array[] = [];
  /**
   * How much of each of a ship's flame rays landed on something last step,
   * as the ray's `share`: what a renderer draws the burn's glow from, and
   * where it cuts the flame off. Indexed by `landedIndex`.
   */
  private readonly landed: Float64Array[] = [];
  /** Scratch for the exhaust pass, so that burning allocates nothing. */
  private readonly plumes = new Plumes();
  /**
   * Which engines of the ship being flown this step are burning as weapons.
   * Scratch, written and read inside one `flyOne`, so one array serves every
   * ship however many engines each has.
   */
  private forced = new Uint8Array(0);
  // Reused by `attackHeading` for every ship, every step.
  private readonly attackArcs = new AttackArcs();
  private readonly attackRegion = new AttackRegion();
  /** Which of each ship's engines burned as weapons when it was last flown. */
  private readonly lit: Uint8Array[] = [];
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
  private readonly serial: number[] = [];
  /** Ships each side has had put in, so the next is one more. */
  private readonly served = new Map<number, number>();

  /**
   * Which ships were never controlled: the pieces other ships have been broken
   * into.
   *
   * A chunk is a ship in every way that matters to the rest of the sim — it
   * has a hull, it collides, it takes damage and it can come apart further —
   * and in exactly one way it is not: nothing flies it and nothing fires it.
   * Making it a ship rather than a third kind of thing is what lets it be
   * drawn, hit and severed by the code that already does those.
   */
  private readonly derelict: number[] = [];
  /** 1 for a fighter its doctrine has taken down into the hull layer as well. */
  private readonly committed: number[] = [];
  /** Whether each ship has turned its main engines along its want rather than its guns to its target. */
  private readonly burning: number[] = [];
  /** Whether each ship's approach is planned on braking with its mains, which it must then turn to do. */
  private readonly brakingOnMains: number[] = [];

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
   * Body index → which ship's computer works each of its modules, where more
   * than one ship rides that body; null where one works all of it. -1 is nobody's.
   *
   * Two ships hooked together are one body flown by both (`Ships.weld`): each
   * keeps its own side, orders and guns, and works only the modules it brought.
   * `shipByBody` is the body's *primary* — the one that answers for its shape.
   */
  private readonly pilots: (Int32Array | null)[] = [];
  /**
   * Body index → the side each module came from, for drawing; null where it is
   * all the primary's. A hull that hooked a piece of somebody else's keeps it
   * in that side's colours, as a severed piece does.
   */
  private readonly sides: (Int32Array | null)[] = [];

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
  /** The world tick each ship last came apart at, or was broken off at. */
  private readonly partedAt: number[] = [];

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
  /** The ship its doctrine has committed it to ramming, or `NO_TARGET`. Kept until that ship is out of the fight. */
  private readonly ramming: number[] = [];
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
  /** The heaviest dodge in the blend: how much it is wanted, and seconds until the near miss. */
  private dodgeWeight = 0;
  private dodgeWhen = 0;
  private readonly rethinkAt: number[] = [];
  /**
   * The order doctrine makes up, one per ship and rewritten in place, so that
   * falling back on doctrine allocates nothing per step.
   */
  private readonly standing: Order[] = [];
  private readonly choice = new Choice();
  /** A mount's pick among what is in reach but it cannot fire at now: tracked, trigger held. */
  private readonly maskedChoice = new Choice();
  /** And among what is out of reach, so it is already pointed at it when it closes. */
  private readonly farChoice = new Choice();
  /** The middle of the last `firingSlack`'s cone, radians off its aim point. */
  private slackOffset = 0;

  /** The wrench `command` decided, body frame, replayed by the force provider. */
  private readonly demandFx: number[] = [];
  private readonly demandFy: number[] = [];
  private readonly demandTorque: number[] = [];
  /**
   * This step's turret recoil on each ship's body, replayed with the wrench.
   * Kept apart and set afresh every step, because the wrench of a ship nobody
   * is flying is held rather than recomputed, and recoil added into it piled up.
   */
  private readonly recoil: number[] = [];
  /** This step's push from fuel leaking out of each ship's body, body frame. */
  private readonly leakFx: number[] = [];
  private readonly leakFy: number[] = [];
  private readonly leakTorque: number[] = [];

  private readonly alive: number[] = [];

  private readonly allocation = new Allocation();
  private readonly solution = new FiringSolution();
  /**
   * Where a mount sits in the world and how fast that point is moving, filled
   * in place by `locateMount` and read straight away. Persistent rather than
   * built per call, per §12.
   */
  private readonly gunPoint = { x: 0, y: 0, vx: 0, vy: 0 };
  /** Where a part of a target is, for a mount choosing between them. */
  private readonly partAt = { x: 0, y: 0 };
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
  /** The layers every module of this body is in; `OWN_LAYERS` for anything but a fighter. */
  layersOf(bodyIndex: number): number {
    if (this.designOf(bodyIndex) === null) return OWN_LAYERS;
    const ship = this.shipByBody[bodyIndex];
    return ship === undefined ? OWN_LAYERS : this.shipLayers(ship);
  }

  /** Whether this ship is the first riding its body: the one a hull's own doings are told through. */
  ownsBody(i: number): boolean {
    const bodies = this.bodyStore;
    const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[i]!);
    return b >= 0 && this.shipByBody[b] === i;
  }

  holed(bodyIndex: number, module: number, integrity: number, x: number, y: number, nx: number, ny: number, calibre: number, rng: Rng): void {
    const m = this.designOf(bodyIndex)?.modules[module];
    if (m === undefined || !(this.fuel.held(bodyIndex, module) > 0)) return;
    if (rng.nextFloat() >= leakChance(integrity)) return;
    // Into the module's own frame, so the hole goes with it.
    const c = cos(m.angle);
    const s = sin(m.angle);
    const dx = x - m.x;
    const dy = y - m.y;
    const width = calibre * LEAK_HOLE_CALIBRES;
    const lining = m.stats.lining;
    this.fuel.hole(bodyIndex, {
      module,
      x: dx * c + dy * s,
      y: -dx * s + dy * c,
      nx: nx * c + ny * s,
      ny: -nx * s + ny * c,
      width,
      floor: max(0, width - lining * SEAL_REACH),
      closing: lining * SEAL_SPEED,
      rate: 0,
    });
  }

  fuelDepth(bodyIndex: number, module: number): number {
    const stats = this.designOf(bodyIndex)?.modules[module]?.stats;
    if (stats === undefined || !(stats.fuel > 0)) return 0;
    return min(1, this.fuel.held(bodyIndex, module) / (FUEL_DENSITY * interiorVolume(stats)));
  }

  designOf(bodyIndex: number): ShipDesign | null {
    const design = this.hullDesign[bodyIndex];
    if (design === undefined || design === null) return null;
    // The slot may have been destroyed and taken by something else since.
    const bodies = this.bodyStore;
    if (bodies !== null && bodies.indexOf(this.hullBody[bodyIndex]!) !== bodyIndex) return null;
    return design;
  }

  /**
   * The engine layout to fly this ship by: the design's own while it is
   * undamaged, and one of its own once it is not.
   *
   * Rebuilt only when the ship's damage has changed since the last time, which
   * is a version comparison rather than a dirty flag — nothing has to remember
   * to set it.
   */
  private layoutOf(i: number): EngineLayout {
    const design = this.designs[i]!;
    const bodies = this.bodyStore;
    const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[i]!);
    if (b < 0) return design.engineLayout;

    const version = this.damage.version(b);
    const built = this.layouts[i];
    if (built !== null && built !== undefined && this.layoutVersion[i] === version) return built;

    let damaged = false;
    const specs = design.engines.map((spec) => {
      const left = this.left(i, b, spec.module ?? -1, DamageEffect.Thrust);
      if (left < 1) damaged = true;
      return left === 1 ? spec : { ...spec, maxThrust: spec.maxThrust * left };
    });
    // An undamaged ship keeps the design's shared layout, so the common case
    // costs one comparison and no allocation.
    const layout = damaged ? new EngineLayout(specs) : design.engineLayout;
    this.layouts[i] = layout;
    this.layoutVersion[i] = version;
    return layout;
  }

  /**
   * Whether this ship is still under control: a core damage has not finished
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
    // A severed chunk was never controlled, whatever it is carrying.
    if (this.derelict[i] === 1) return false;
    const bodies = this.bodyStore;
    const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[i]!);
    if (b < 0) return false;
    const design = this.designs[i]!;
    for (const core of design.cores) {
      if (this.left(i, b, core, DamageEffect.Control) > 0) return true;
    }
    return false;
  }

  /**
   * A ship with nothing left controlling it to cover: its cores shot out. Not a
   * neutral, which is an objective rather than a ship.
   */
  private hulk(i: number): boolean {
    return this.team[i] !== NEUTRAL_TEAM && !this.hasControl(i);
  }

  /** Returns true when the ship has no main weapon left: no main gun, and no main weapon engine. */
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
      if (design.turrets[t]!.main && !this.isTurretDisabled(i, t)) return false;
    }
    // An engine meant as a weapon is one while it can still burn.
    for (const t of design.mainWeaponEngines) {
      const module = design.engines[t]?.module ?? -1;
      if (this.left(i, b, module, DamageEffect.Thrust) > 0) return false;
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
  /**
   * How far this mount is worth shooting at what it is aiming at, metres, or 0
   * when it is aiming at nothing.
   */
  triggerReach(i: number, t: number): number {
    const target = this.turretAiming[i]![t]!;
    if (target === NO_TARGET || this.alive[target] !== 1) return 0;
    return this.turrets.fireReach[this.turretIndex[i]![t]!]!;
  }

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
    return !(this.left(i, b, turret.module, DamageEffect.FireRate) > 0);
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
    for (const engine of design.engines) {
      if (this.left(i, b, engine.module ?? -1, DamageEffect.Thrust) > 0) return false;
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

  /** Which of its side's ships this is, from one; a piece broken off carries its ship's. */
  serialOf(i: number): number {
    return this.serial[i]!;
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
      mass: spec.ghost === true ? 0 : design.mass,
      inertia: spec.ghost === true ? 0 : design.inertia,
      radius: design.radius,
      ghost: spec.ghost === true,
    });

    const bodyIdx = world.bodies.indexOf(id);
    this.bodyStore = world.bodies;
    this.shipByBody[bodyIdx] = this.alive.length;
    this.pilots[bodyIdx] = null;
    this.sides[bodyIdx] = null;
    this.hullDesign[bodyIdx] = design;
    this.hullBody[bodyIdx] = id;
    this.damage.register(bodyIdx, design);
    this.fuel.register(bodyIdx, design);
    if (spec.invulnerable === true) this.damage.protect(bodyIdx);
    const mounts = design.turrets;
    const indices = new Int32Array(mounts.length);
    for (let t = 0; t < mounts.length; t++) {
      indices[t] = this.turrets.add({ ...mounts[t]!.mount, owner: bodyIdx });
    }

    const i = this.alive.length;
    this.designs.push(design);
    this.bodyIds.push(id);
    this.throttles.push(new Float64Array(design.engines.length));
    this.lit.push(new Uint8Array(design.engines.length));
    this.landed.push(new Float64Array(landedLength(design)));
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
    let serial = spec.serial;
    if (serial === undefined) {
      serial = (this.served.get(spec.team ?? 0) ?? 0) + 1;
      this.served.set(spec.team ?? 0, serial);
    }
    this.serial.push(serial);
    this.derelict.push(0);
    this.committed.push(0);
    this.burning.push(0);
    this.brakingOnMains.push(0);
    this.cutSeen.push(-1);
    this.partedAt.push(-Infinity);
    this.chosen.push(NO_TARGET);
    this.ramming.push(NO_TARGET);
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
      ram: false,
    });
    this.orders.push([]); // Initialise to an empty array of orders for this ship
    this.demandFx.push(0);
    this.demandFy.push(0);
    this.demandTorque.push(0);
    this.recoil.push(0);
    this.leakFx.push(0);
    this.leakFy.push(0);
    this.leakTorque.push(0);
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
      this.ramming[i] = NO_TARGET;
      return;
    }
    // A ram, once decided, is seen through: no second look at the target, and
    // no consort to break off for.
    const rammed = this.ramming[i]!;
    if (rammed !== NO_TARGET) {
      if (this.alive[rammed] === 1 && this.derelict[rammed] === 0 && this.hasControl(rammed)) {
        this.chosen[i] = rammed;
        this.consort[i] = NO_TARGET;
        return;
      }
      this.ramming[i] = NO_TARGET;
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
    // A ship that can ram still has a fight with nothing left to shoot, or
    // nothing to shoot with at all.
    const approach = design.doctrine.approach;
    const rammer = approach.ramRadii > 0;
    const reach = design.reach > 0 ? design.reach : rammer ? approach.approachSpeed * RAM_HORIZON : 0;
    if ((design.reach > 0 && !this.isDisarmed(i)) || (rammer && reach > 0)) {
      this.choice.begin();
      for (let t = 0; t < this.alive.length; t++) {
        if (t === i || this.alive[t] === 0) continue;
        // Wreckage is matter, not an enemy, nor is anything not hostile, and
        // a hulk offers nothing worth closing on: nothing controls it, and no
        // shot fired at it will ever remove it from the battle, so scoring it
        // low is not enough to stop a ship parking next to one forever.
        //
        // **A hulk is a hull with its cores shot out, and nothing else is.**
        // A ship that has merely lost its guns and its engines is harmless
        // and still a target: its core still controls it, and a round
        // through the core finishes it. Excluding those as well would make
        // being harmless the safest thing a hull could be — untouchable by
        // everyone, for as long as it liked.
        if (this.derelict[t] === 1 || !this.hostile(i, t) || !this.hasControl(t)) continue;
        const tb = bodies.indexOf(this.bodyIds[t]!);
        if (tb < 0 || tb === b) continue;
        const seen = look(
          bodies,
          b,
          tb,
          t,
          this.designs[t]!.mass,
          !this.isDisarmed(t),
          !this.hasNoEngines(t),
        );
        const candidate =
          doctrine.sightWeight !== 0 && !inSight(bodies, bodies.x[b]!, bodies.y[b]!, b, tb)
            ? { ...seen, clear: false }
            : seen;
        this.choice.offer(
          candidate,
          score(doctrine, candidate, reach, design.mass, loyalTo),
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
      if (this.derelict[t] === 1 || this.hostile(i, t) || this.hulk(t)) continue;
      // Nor is a friend too small for it to bother covering. A neutral is an
      // objective rather than a ship to look after, and is gone to whatever
      // its size: a goal is a marker far smaller than anything racing to it.
      if (
        this.team[t] === this.team[i] &&
        this.designs[t]!.radius < approach.escortMinRadii * design.radius
      ) {
        continue;
      }
      const tb = bodies.indexOf(this.bodyIds[t]!);
      if (tb < 0 || tb === b) continue;
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
    // A secondary mount ignores orders, so converges on what doctrine chose.
    const ownFocus = this.chosenOf(i);

    for (let t = 0; t < indices.length; t++) {
      // A mount another ship on this body works is that ship's to aim.
      if (!this.ownsAt(i, b, design.turrets[t]!.module)) continue;
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
      const layers = this.mountLayers(i, mount);
      // A shell's fragments fly in both layers, so it can hurt a ship its own
      // layer would pass by.
      const hurts = this.firesShellsFrom(i, mount) ? BOTH_LAYERS : layers;
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
      const barrel = this.turrets.worldBearing(bodies, ti);
      const faceX = cos(barrel);
      const faceY = sin(barrel);

      this.choice.begin();
      this.maskedChoice.begin();
      this.farChoice.begin();
      for (let e = 0; e < this.alive.length; e++) {
        if (e === i || this.alive[e] === 0) continue;
        if (this.derelict[e] === 1 || !this.hostile(i, e) || !this.hasControl(e)) continue;
        const tb = bodies.indexOf(this.bodyIds[e]!);
        if (tb < 0) continue;
        // An enemy hooked on shares this body, so the body's centre says
        // nothing about where it is: it is where the part this mount would
        // shoot at is.
        const hooked = tb === b;
        let tx = bodies.x[tb]!;
        let ty = bodies.y[tb]!;
        if (hooked) {
          const part = this.aimModule(bodies, mount, layers, e, gunX, gunY, true);
          if (part < 0) continue;
          this.partPoint(bodies, tb, this.designs[e]!, part);
          tx = this.partAt.x;
          ty = this.partAt.y;
        } else if (!this.canAimAt(mount, hurts, e, tb)) {
          // A ship with nothing left this mount will shoot at is not a target
          // for it, however good it looks by every other measure.
          continue;
        }
        // What it cannot point at or fire at yet is still worth tracking: the
        // gun is on it the moment the target, or the ship, moves round.
        const towards = bearing(gunX, gunY, tx, ty);
        const clear = this.turrets.firesOn(bodies, ti, towards);
        const seen = lookFrom(
          bodies,
          gunX,
          gunY,
          gunVx,
          gunVy,
          faceX,
          faceY,
          tb,
          e,
          this.designs[e]!.mass,
          !this.isDisarmed(e),
          !this.hasNoEngines(e),
        );
        const hookedRange = hooked ? length(tx - gunX, ty - gunY) : 0;
        const candidate = hooked
          ? {
              ...seen,
              range: hookedRange,
              closing: 0,
              facing: hookedRange > 0 ? (faceX * (tx - gunX) + faceY * (ty - gunY)) / hookedRange : 1,
            }
          : seen;
        // Out of reach is tracked but never preferred to anything in reach,
        // and never fired on: proximity alone would let a mount shoot at
        // something far outside what its gun is good for all battle.
        //
        // Against *this* target's size rather than the one the doctrine
        // expects: a capital is worth shooting at from far further off than a
        // fighter. A doctrine that minds what it hits fires only on the part
        // it picked, so its reach is against that part.
        const against = this.reachOn(
          mount,
          e,
          refusesAnything(doctrine) ? this.aimFor(bodies, i, mount, layers, e, gunX, gunY, hooked) : WHOLE_SHIP,
        );
        // A hooked target is alongside, with nothing between to look past.
        const judged =
          !hooked && doctrine.sightWeight !== 0 && !inSight(bodies, gunX, gunY, b, tb)
            ? { ...candidate, clear: false }
            : candidate;
        (candidate.range > against ? this.farChoice : clear ? this.choice : this.maskedChoice).offer(
          judged,
          score(doctrine, candidate, against, design.mass, targets[t]!, mount.main ? focus : ownFocus),
        );
      }
      // Something it can fire at first; then what is in reach but behind its
      // own ship or out of its arc; then what it will be able to reach.
      targets[t] =
        this.choice.ship !== NO_TARGET
          ? this.choice.ship
          : this.maskedChoice.ship !== NO_TARGET
            ? this.maskedChoice.ship
            : this.farChoice.ship;
      aims[t] =
        targets[t] === NO_TARGET
          ? WHOLE_SHIP
          : this.choosePart(bodies, b, i, mount, layers, targets[t]!, gunX, gunY);
      // Holding something it cannot fire on yet, it looks again soon: what it
      // can fire on may turn up long before its own reconsidering would.
      if (this.choice.ship === NO_TARGET && targets[t] !== NO_TARGET) {
        schedule[t] = world.tick + max(1, round(TURRET_MIN_RETHINK / world.dt));
      }
    }
  }

  /**
   * The part of a target a mount aims at, or the whole ship.
   *
   * The part, as a doctrine picks it, wherever that is worth shooting at.
   * Further out than that, when hitting any of the ship will do, the middle
   * of the ship: more of the shots land. A shell bursts into the hull layer,
   * so it can be aimed there too; solid shot in the weapons layer would pass
   * over the deck, and takes the part it can hit nearest the middle instead.
   */
  private choosePart(
    bodies: Bodies,
    b: number,
    i: number,
    mount: DesignTurret,
    layers: number,
    target: number,
    gunX: number,
    gunY: number,
  ): number {
    const shells = this.firesShellsFrom(i, mount);
    const tb = bodies.indexOf(this.bodyIds[target]!);
    const hooked = tb === b;
    const part = this.aimFor(bodies, i, mount, layers, target, gunX, gunY, hooked);
    if (part < 0 || hooked || refusesAnything(mount.targeting)) return part;
    const design = this.designs[target]!;
    this.partPoint(bodies, tb, design, part);
    const range = length(this.partAt.x - gunX, this.partAt.y - gunY);
    if (range <= this.reachFor(mount, moduleRadius(design.modules[part]!.spec))) return part;
    if (this.meetsWhole(shells ? layers | HULL_LAYER : layers, target)) return WHOLE_SHIP;
    let middle = part;
    let nearest = Infinity;
    for (let k = 0; k < design.modules.length; k++) {
      if (!this.reaches(layers, design, tb, target, k)) continue;
      const m = design.modules[k]!;
      const off = m.x * m.x + m.y * m.y;
      if (off < nearest) {
        nearest = off;
        middle = k;
      }
    }
    return middle;
  }

  /**
   * How far a mount will fire at a target, aiming at `part` of it: against
   * the size of what it will fire on, which is the whole ship unless its
   * doctrine minds what it hits, and as far out as its doctrine says.
   */
  private reachOn(mount: DesignTurret, target: number, part: number): number {
    const design = this.designs[target]!;
    const selective = refusesAnything(mount.targeting) && part >= 0 && part < design.modules.length;
    return this.reachFor(mount, selective ? moduleRadius(design.modules[part]!.spec) : design.radius);
  }

  /** How far a mount will fire at something of this radius, metres. */
  private reachFor(mount: DesignTurret, radius: number): number {
    return reachAgainst(mount.gun, radius) * mount.targeting.fireRange;
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
    mount: DesignTurret,
    layers: number,
    target: number,
    fromX: number,
    fromY: number,
    hooked = false,
  ): number {
    const doctrine = mount.targeting;
    // A mount in the hull layer with no opinion about parts shoots at the
    // hull. One in the weapons layer cannot: amidships is usually deck, which
    // its rounds pass over, so it always picks something in the weapons layer. Nor can one
    // hooked to its target, whose hull's middle may be its own.
    const anyPart = !picksParts(doctrine);
    if (anyPart && this.meetsWhole(layers, target) && !hooked) return WHOLE_SHIP;
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
      if (!this.reaches(layers, design, tb, target, k)) continue;
      const weight = anyPart ? 1 : partWeight(doctrine, design.modules[k]!.spec.kind);
      // Only what this doctrine wants destroyed. Zero is not a poor ranking
      // but a different statement — *not worth a shot* — and the best of a
      // bad list would otherwise still be chosen however bad the list is.
      if (weight <= 0) continue;
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
    // Nothing left that this doctrine wants destroyed, so there is nothing
    // here to shoot at — not the hull either, since the hull is the modules
    // it has just passed over.
    return best === WHOLE_SHIP ? NOTHING_AIMABLE : best;
  }

  /**
   * `aimModule` for ship `i`'s mount, looking past its own layer when that has
   * nothing to offer and it fires shells, whose fragments fly in both.
   */
  private aimFor(
    bodies: Bodies,
    i: number,
    mount: DesignTurret,
    layers: number,
    target: number,
    fromX: number,
    fromY: number,
    hooked: boolean,
  ): number {
    const part = this.aimModule(bodies, mount, layers, target, fromX, fromY, hooked);
    if (part !== NOTHING_AIMABLE || !this.firesShellsFrom(i, mount)) return part;
    return this.aimModule(bodies, mount, BOTH_LAYERS, target, fromX, fromY, hooked);
  }

  /** Where module `part` of a body is in the world, into `partAt`. */
  private partPoint(bodies: Bodies, tb: number, design: ShipDesign, part: number): void {
    const angle = bodies.angle[tb]!;
    const module = design.modules[part]!;
    this.partAt.x = bodies.x[tb]! + module.x * cos(angle) - module.y * sin(angle);
    this.partAt.y = bodies.y[tb]! + module.x * sin(angle) + module.y * cos(angle);
  }

  /**
   * Whether a round from this mount could land on module `k` of a target:
   * still standing, still the target's, and in a layer the mount fires in.
   */
  private reaches(layers: number, design: ShipDesign, tb: number, target: number, k: number): boolean {
    if (this.damage.spent(tb, k) || !this.ownsAt(target, tb, k)) return false;
    return (moduleLayers(design.modules[k]!, this.shipLayers(target)) & layers) !== 0;
  }

  /**
   * Whether a shot in these layers meets whatever it hits of this ship, so the
   * ship's centre is as good an aim point as any part: in the hull layer, at
   * a ship every module of which is in it.
   */
  private meetsWhole(layers: number, target: number): boolean {
    const whole = this.shipLayers(target);
    return (layers & HULL_LAYER) !== 0 && (whole === OWN_LAYERS || (whole & HULL_LAYER) !== 0);
  }

  /**
   * Whether this ship's doctrine would ram its target now: close enough, by
   * `ramRadii` of the target's radius from its edge, and with no more of its
   * own guns working than `ramArmed` says.
   */
  private rams(i: number, target: number): boolean {
    const approach = this.designs[i]!.doctrine.approach;
    if (!(approach.ramRadii > 0) || this.armedShare(i) > approach.ramArmed) return false;
    const bodies = this.bodyStore;
    if (bodies === null) return false;
    const b = bodies.indexOf(this.bodyIds[i]!);
    const tb = bodies.indexOf(this.bodyIds[target]!);
    if (b < 0 || tb < 0) return false;
    const gap = length(bodies.x[tb]! - bodies.x[b]!, bodies.y[tb]! - bodies.y[b]!) - bodies.radius[tb]!;
    return gap <= approach.ramRadii * bodies.radius[tb]!;
  }

  /** The share of this ship's main mounts that can still fire; none for a ship with none. */
  private armedShare(i: number): number {
    const turrets = this.designs[i]!.turrets;
    let mounts = 0;
    let working = 0;
    for (let t = 0; t < turrets.length; t++) {
      if (!turrets[t]!.main) continue;
      mounts++;
      if (!this.isTurretDisabled(i, t)) working++;
    }
    return mounts === 0 ? 0 : working / mounts;
  }

  /**
   * Whether a fighter takes the hull layer as well: whenever it is ramming,
   * which is flying at a target with a band of nothing, by its doctrine's
   * decision or by order.
   *
   * Only while clear of every hull, in either direction (DESIGN.md §3), so a
   * fighter cannot drop into a capital's structure or climb back out of one it
   * has struck. Clear of its modules rather than its bounding circle, so a
   * fighter alongside a long hull can still commit.
   */
  private commitOne(bodies: Bodies, i: number): void {
    if (!this.designs[i]!.fighter) return;
    const b = bodies.indexOf(this.bodyIds[i]!);
    if (b < 0) return;
    const order = this.effectiveOrder(i);
    const ramming = order !== undefined && order.target !== NO_TARGET && order.ram;
    const want = ramming ? 1 : 0;
    if (want === this.committed[i] || !this.clearOfHulls(bodies, b)) return;
    this.committed[i] = want;
  }

  /** Whether no module of this body overlaps any other hull's. */
  private clearOfHulls(bodies: Bodies, b: number): boolean {
    const own = this.designOf(b);
    if (own === null) return true;
    for (let j = 0; j < bodies.highWater; j++) {
      if (j === b || bodies.alive[j] === 0 || bodies.ghost[j] === 1) continue;
      const other = this.designOf(j);
      if (other !== null && hullsOverlap(bodies, b, own, j, other)) return false;
    }
    return true;
  }

  /** Whether this fighter has dropped into the hull layer as well. */
  isCommitted(i: number): boolean {
    return this.committed[i] === 1;
  }

  /** The layers every module of this ship is in, or `OWN_LAYERS`: a fighter's, by whether it has committed. */
  private shipLayers(i: number): number {
    if (!this.designs[i]!.fighter) return OWN_LAYERS;
    return this.committed[i] === 1 ? BOTH_LAYERS : WEAPONS_LAYER;
  }

  /** The layers this mount's shots fly in: a fighter's guns fire in whatever it occupies. */
  private mountLayers(i: number, mount: DesignTurret): number {
    const whole = this.shipLayers(i);
    if (whole !== OWN_LAYERS) return whole;
    return mount.hullLayer ? HULL_LAYER : WEAPONS_LAYER;
  }

  /** Whether this ship's mount fires shells, whose fragments fly in both layers. */
  private firesShellsFrom(i: number, mount: DesignTurret): boolean {
    return firesShells(this.designs[i]!.modules[mount.module]!.spec);
  }

  /**
   * Whether this mount's doctrine would shoot at anything still standing on
   * that ship, in a layer it can reach.
   *
   * Asked while choosing a target rather than after, because a ship a mount
   * may not fire at is not a worse target than the rest — it is not a target.
   * A mount that scored it anyway would pick it, train on it and hold its
   * fire, which is a gun taken out of the battle by its own doctrine.
   */
  private canAimAt(mount: DesignTurret, layers: number, target: number, tb: number): boolean {
    const doctrine = mount.targeting;
    const anyPart = !picksParts(doctrine);
    if (anyPart && this.meetsWhole(layers, target)) return true;
    const design = this.designs[target]!;
    for (let k = 0; k < design.modules.length; k++) {
      if (!this.reaches(layers, design, tb, target, k)) continue;
      if (anyPart || partWeight(doctrine, design.modules[k]!.spec.kind) > 0) return true;
    }
    return false;
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
  /** What this ship is fighting: its order's target, else what its doctrine chose; `NO_TARGET` for nothing. */
  fightingOf(i: number): number {
    return this.focusOf(i);
  }

  private focusOf(i: number): number {
    const given = this.getCurrentOrder(i);
    if (given !== undefined) return given.target;
    return this.chosenOf(i);
  }

  /** What this ship's doctrine chose to fight, orders aside; `NO_TARGET` for nothing. */
  private chosenOf(i: number): number {
    const fighting = this.chosen[i]!;
    return fighting !== NO_TARGET && this.alive[fighting] === 1 ? fighting : NO_TARGET;
  }

  /**
   * What one mount is shooting at.
   *
   * An order given is an order obeyed by the main battery, so a main mount
   * that can train on the ordered target takes it; one that cannot is not left
   * idle for the sake of it, and fights what it can reach. A secondary mount
   * ignores orders, so a close-in gun goes on swatting whatever is about to
   * hit the ship. Otherwise this is whatever the mount picked for itself.
   */
  private turretAim(bodies: Bodies, i: number, t: number): number {
    const given = this.designs[i]!.turrets[t]!.main ? this.getCurrentOrder(i) : undefined;
    let tracksGiven = false;
    if (given !== undefined && given.target !== NO_TARGET && this.alive[given.target] === 1) {
      const tb = bodies.indexOf(this.bodyIds[given.target]!);
      const b = bodies.indexOf(this.bodyIds[i]!);
      if (tb >= 0 && b >= 0 && tb !== b) {
        const ti = this.turretIndex[i]![t]!;
        this.locateMount(bodies, b, this.designs[i]!.turrets[t]!);
        const towards = bearing(this.gunPoint.x, this.gunPoint.y, bodies.x[tb]!, bodies.y[tb]!);
        if (this.turrets.firesOn(bodies, ti, towards)) return given.target;
        tracksGiven = true;
      }
    }
    const own = this.turretTarget[i]![t]!;
    if (own !== NO_TARGET && this.alive[own] === 1) return own;
    // Nothing else to do: track the order where it may not fire, or cannot
    // point, so the gun is on it as it comes clear or round.
    return tracksGiven ? given!.target : NO_TARGET;
  }

  /**
   * Seconds until a round from this mount bursts: its fuse short of the
   * flight time to what it is aimed at. Never, with nothing to time it to.
   */
  private fuseFor(turret: number, target: number, spec: ModuleSpec): number {
    const flight = this.turrets.aimTime[turret]!;
    if (target === NO_TARGET || !(flight > 0) || !firesShells(spec)) return Infinity;
    const fuse = flight - (spec.fuse ?? DEFAULT_FUSE);
    return fuse > 0 ? fuse : 0;
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
   * is painted: nothing controls it, and holding fire for it would make every
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
    reach: number,
    target: number,
    layers: number,
  ): boolean {
    // Never further than the shot itself goes: a consort beyond what this gun
    // is willing to shoot at is not in the way of anything, and a cast that
    // looked past it would hold fire for a ship in no danger — as well as
    // walking grid cells to learn nothing.
    const lookahead =
      gun.type === GunType.Beam ? MAX_BEAM_LENGTH : gun.muzzleSpeed * FRIENDLY_LOOKAHEAD;
    const range = lookahead < reach ? lookahead : reach;
    if (!(range > 0)) return false;
    const hit = this.lineOfFire;
    // A friend is only in the way of what it would stop.
    this.hulls.castFrom(layers, -1, -1);
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
    this.hulls.reset();
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
    const band = holdBand(approach, design.reach, this.designs[target]!.radius);
    standing.minRange = band.min;
    standing.maxRange = band.max;
    if (this.ramming[i] !== target && this.rams(i, target)) this.ramming[i] = target;
    standing.ram = this.ramming[i] === target;
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
      cancelOn: cancelOn,
      ram: false,
    };
    this.orders[i]!.push(order);
  }

  /** Add an order to ram `target`, closing at `approachSpeed`, to the end of this ship's queue. */
  pushRam(i: number, target: number, approachSpeed: number, cancelOn: OrderCancelCondition = OrderCancelCondition.CompleteDisable): void {
    this.orders[i]!.push({ target, minRange: 0, maxRange: 0, approachSpeed, cancelOn, ram: true });
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
          this.demandFx[i]! + this.leakFx[i]!,
          this.demandFy[i]! + this.leakFy[i]!,
          this.demandTorque[i]! + this.recoil[i]! + this.leakTorque[i]!,
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
      // Nothing controls a severed chunk, or a ship whose cores have been
      // shot out, so nothing holds its heading or kills its
      // drift: its engines and turrets fail safe and stop, and it tumbles on
      // with whatever the break or the last hit gave it.
      if (!this.hasControl(i)) {
        this.failSafe(i);
        continue;
      }
      this.removeInvalidOrders(i);
      this.decide(world, bodies, i);
      this.decideTurrets(world, bodies, i);
      this.flyOne(dt, bodies, i, grid);
      this.commitOne(bodies, i);
      this.trainOne(bodies, i);
      const timers = this.cooldown[i]!;
      const b = bodies.indexOf(this.bodyIds[i]!);
      const mounts = this.designs[i]!.turrets;
      for (let t = 0; t < timers.length; t++) {
        if (!this.ownsAt(i, b, mounts[t]!.module)) continue;
        if (timers[t]! > 0) {
          const remaining = timers[t]! - dt;
          timers[t] = remaining > TIMER_SETTLE ? remaining : 0;
        }
      }
    }

    // Every ship pushing pays for what it burns.
    for (let i = 0; i < this.alive.length; i++) {
      if (this.alive[i] === 1) this.burn(dt, bodies, i);
    }
    // Once per body, however many ships ride it.
    for (let i = 0; i < this.alive.length; i++) {
      if (this.alive[i] === 1) this.leak(dt, bodies, i);
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
      // Once per body, however many ships ride it.
      this.recoil[i] = b >= 0 && this.shipByBody[b] === i ? this.reaction[b]! : 0;
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
        if (!this.ownsAt(i, bodyIdx, design.turrets[t]!.module)) continue;
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

        const ti = indices[t]!;
        this.turrets.lit[ti] = state == TurretState.CommittedOn ? 1 : 0;
        if (state == TurretState.Reloading) continue; // Can't fire while reloading.


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
        if (
          state != TurretState.CommittedOn &&
          this.friendlyInTheWay(
            bodies,
            grid,
            i,
            bodyIdx,
            gun,
            target === NO_TARGET ? design.turrets[t]!.reach : this.turrets.fireReach[ti]!,
            target,
            this.mountLayers(i, design.turrets[t]!),
          )
        ) {
          continue;
        }

        if (gun.type == GunType.Projectile) {
          const fuse = design.modules[design.turrets[t]!.module]!.spec;
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
            design.turrets[t]!.module,
            this.mountLayers(i, design.turrets[t]!),
            this.fuseFor(ti, target, fuse),
            fuse.burstSpeed ?? DEFAULT_BURST_SPEED,
            fragmentLife(fuse),
            firesShells(fuse) ? (fuse.fragments ?? DEFAULT_FRAGMENTS) : 0,
            casingMass(fuse, gun.roundMass),
            firesShells(fuse) ? 1 - chargeShare(fuse.burstSpeed ?? DEFAULT_BURST_SPEED) : 1,
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
            design.turrets[t]!.module,
            this.mountLayers(i, design.turrets[t]!),
          );
          if (state == TurretState.Idle) {
            // was idle before, now committed on for beamOnTime
            state = turretStates[t] = TurretState.CommittedOn;
            timers[t] = gun.beamOnTime;
            this.turrets.lit[ti] = 1;

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
      const landed = this.landed[i]!;
      landed.fill(0);

      for (let t = 0; t < design.engines.length; t++) {
        const force = throttles[t]! * this.exhaustOf(i, design, bodyIdx, t);
        if (!(force > 0)) continue;
        this.plumes.burn(design, t, force, this.damage, bodies, bodyIdx, grid, this.hulls, dt, landed, this.layersOf(bodyIdx));
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
   * One ship's pilot: hold the range band of its order, or of what doctrine
   * chose, and face the target.
   *
   * It brakes into the band, holds station by matching the target's velocity,
   * and points the bow at whatever it is fighting, blended with escorting and
   * keeping clear. What to fight and how close to sit are doctrine's to say
   * (§2), not the pilot's; it only turns them into a demand wrench for the
   * allocator. There is no evasion, approach angle or propellant budget.
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
    this.dodgeWeight = 0;
    let wantAngle = bodies.angle[b]!;
    // What it is fighting, if anything: the body, and how far out it holds it.
    let fighting = -1;
    let holdOut = 0;

    // No order at all is the same problem as an order with no target: hold
    // what you are doing and wait to be told something.
    const order = this.effectiveOrder(i);
    const target = order?.target ?? NO_TARGET;
    if (order !== undefined && target !== NO_TARGET && this.alive[target] === 1) {
      const tb = bodies.indexOf(this.bodyIds[target]!);
      // Hooked on to it: nowhere to steer for.
      if (tb >= 0 && tb !== b) {
        wantAngle = atan2(bodies.y[tb]! - bodies.y[b]!, bodies.x[tb]! - bodies.x[b]!);
        if (!order.ram) {
          wantAngle = this.attackHeading(i, b, tb, bodies, wantAngle);
          fighting = tb;
          holdOut = order.maxRange;
        }
        if (order.ram) this.charge(bodies, b, tb, order.approachSpeed);
        else this.hold(bodies, i, b, tb, order.minRange, order.maxRange, order.approachSpeed, URGE_REFERENCE, wantAngle);
      }
    }

    // A ram overrides the rest of the doctrine: no cover, no keeping clear.
    if (order === undefined || !order.ram) {
      const covering = this.cover(bodies, i, b);
      if (target === NO_TARGET && covering >= 0) {
        const cb = bodies.indexOf(this.bodyIds[covering]!);
        if (cb >= 0) wantAngle = atan2(bodies.y[cb]! - bodies.y[b]!, bodies.x[cb]! - bodies.x[b]!);
      }
      this.avoid(bodies, i, b, target !== NO_TARGET ? target : covering);
    }

    // Nothing to want is a want of its own: a craft with no orders, no charge
    // and nothing in its way kills its drift and waits.
    const wantVx = this.urgeWeight > 0 ? this.urgeVx / this.urgeWeight : 0;
    const wantVy = this.urgeWeight > 0 ? this.urgeVy / this.urgeWeight : 0;

    if (fighting < 0) this.brakingOnMains[i] = 0;
    if (fighting >= 0) wantAngle = this.burnOrFight(i, b, fighting, bodies, wantAngle, wantVx, wantVy, holdOut);
    else this.burning[i] = 0;

    // A ram is a race to the target, so it points its main thrust along the
    // change of velocity it needs rather than its nose at the target.
    if (order?.ram === true) {
      const dvx = wantVx - bodies.vx[b]!;
      const dvy = wantVy - bodies.vy[b]!;
      if (dvx * dvx + dvy * dvy > RAM_AIM_SPEED * RAM_AIM_SPEED) wantAngle = atan2(dvy, dvx);
    }

    const mass = bodies.mass[b]!;
    // The allocator works in the body frame, so the demand is rotated into it.
    const angle = bodies.angle[b]!;
    // A ram asks for far more than any layout gives, and a saturated ask for
    // force leaves nothing to stop a turn with. So it points, then burns: the
    // force asked for falls away with how far off its heading still is.
    const aligned = order?.ram === true ? max(0, cos(angleDelta(angle, wantAngle))) : 1;
    const response = this.designs[i]!.doctrine.approach.responseTime;
    const worldFx = (aligned * mass * (wantVx - bodies.vx[b]!)) / response;
    const worldFy = (aligned * mass * (wantVy - bodies.vy[b]!)) / response;
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
    const turn = min(brakingRate(error, maxAlpha, dt), (error >= 0 ? error : -error) / HEADING_SETTLE_TIME);
    const wantRate = error >= 0 ? turn : -turn;
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
    // A ram asks for more force than it can have, and what is given up for it
    // can be the torque to stop a turn. Ask for less until the turn gets most
    // of what it wanted.
    if (order?.ram === true) {
      for (let k = 0; k < RAM_FORCE_HALVINGS; k++) {
        const short = demandTorque - this.allocation.torque;
        if (abs(short) <= 0.5 * abs(demandTorque) || abs(short) <= maxTorque * RAM_TORQUE_NEGLIGIBLE) break;
        demandFx *= 0.5;
        demandFy *= 0.5;
        layout.allocate(demandFx, demandFy, demandTorque, throttles, this.allocation);
      }
    }

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
   * The heading that puts a target lying at `towards` where this ship's
   * working main guns bear most (`attackBearing`), led by those guns' time of
   * flight, so a battery that cannot train far is pointed where its shot will
   * meet the target rather than where the target is.
   */
  private attackHeading(i: number, b: number, tb: number, bodies: Bodies, towards: number): number {
    const design = this.designs[i]!;
    const arcs = this.attackArcs;
    arcs.clear();
    for (let t = 0; t < design.turrets.length; t++) {
      const turret = design.turrets[t]!;
      if (turret.main && !this.isTurretDisabled(i, t)) addTurret(arcs, turret.mount);
    }
    for (const t of design.mainWeaponEngines) {
      if (this.left(i, b, design.engines[t]!.module ?? -1, DamageEffect.Thrust) > 0) addFlame(arcs, design, t);
    }
    const current = angleDelta(bodies.angle[b]!, towards);
    const region = attackBearing(arcs, current, design.doctrine.approach.turnBias, design.thrustBearing, this.attackRegion);
    if (region.speed > 0) {
      const dx = bodies.x[tb]! - bodies.x[b]!;
      const dy = bodies.y[tb]! - bodies.y[b]!;
      const dvx = bodies.vx[tb]! - bodies.vx[b]!;
      const dvy = bodies.vy[tb]! - bodies.vy[b]!;
      const t = interceptTime(dx, dy, dvx, dvy, region.speed);
      if (t > 0) towards = atan2(dy + dvy * t, dx + dvx * t);
    }
    return towards - region.aim;
  }

  /**
   * The attack heading, or the heading that points the main thrust axis along
   * the change of velocity this ship wants, whichever its doctrine scores
   * higher: `burnWeight` for the share of that change turning makes before
   * holding would, turn included, against `rangeHold` for how near the band it
   * is. Held by `BURN_MARGIN` either way.
   *
   * A ship whose guns-on thrust already gives what the pilot asks for never
   * turns. When a dodge is most of what it wants, only what each makes
   * before the near miss counts, so a quick sidestep beats a slow flip.
   */
  private burnOrFight(
    i: number,
    b: number,
    tb: number,
    bodies: Bodies,
    attack: number,
    wantVx: number,
    wantVy: number,
    maxRange: number,
  ): number {
    const design = this.designs[i]!;
    const approach = design.doctrine.approach;
    const dvx = wantVx - bodies.vx[b]!;
    const dvy = wantVy - bodies.vy[b]!;
    const dv = length(dvx, dvy);
    const mass = bodies.mass[b]!;
    const layout = this.layoutOf(i);
    const axis = layout.maxThrustAlong(cos(design.thrustBearing), sin(design.thrustBearing)) / mass;
    if (!(approach.burnWeight > 0) || !(dv > 0) || !(axis > 0)) {
      this.burning[i] = 0;
      return attack;
    }
    const ux = dvx / dv;
    const uy = dvy / dv;
    // What the layout gives along the want with the guns held on target.
    const c = cos(attack);
    const s = sin(attack);
    const held = layout.maxThrustAlong(ux * c + uy * s, -ux * s + uy * c) / mass;
    const burnHeading = atan2(uy, ux) - design.thrustBearing;
    const turn = this.turnTime(bodies, i, b, angleDelta(attack, burnHeading));
    if (!(turn < Infinity)) {
      this.burning[i] = 0;
      return attack;
    }
    // The pilot asks for no more than the change over its response time, so
    // thrust past that is no use either way. Turning has made the change by
    // `turned`; compare what holding has made of it by then, or by the near
    // miss if that is sooner.
    const want = dv / approach.responseTime;
    const turnedRate = min(axis, want);
    const heldRate = min(held, want);
    const turned = turn + dv / turnedRate;
    const dodging = this.dodgeWeight > 0 && 2 * this.dodgeWeight >= this.urgeWeight;
    const by = dodging ? min(turned, this.dodgeWhen) : turned;
    const gain = max(0, min(dv, turnedRate * max(0, by - turn)) - min(dv, heldRate * by)) / dv;

    const range = length(bodies.x[tb]! - bodies.x[b]!, bodies.y[tb]! - bodies.y[b]!);
    const near = range > maxRange && maxRange > 0 ? maxRange / range : 1;
    const burn = approach.burnWeight * gain;
    const hold = approach.rangeHold * near;
    // Committed to stopping on its mains: it holds them against its way in
    // whatever the score, since its approach was planned on them.
    if (this.brakingOnMains[i] === 1) {
      this.burning[i] = 1;
      return atan2(bodies.y[b]! - bodies.y[tb]!, bodies.x[b]! - bodies.x[tb]!) - design.thrustBearing;
    }
    const now = this.burning[i] === 1 ? burn * (1 + BURN_MARGIN) > hold : burn > hold * (1 + BURN_MARGIN);
    this.burning[i] = now ? 1 : 0;
    return now ? burnHeading : attack;
  }

  /** Whether this ship has turned its main engines along its want rather than its guns to its target. */
  isBurning(i: number): boolean {
    return this.burning[i] === 1;
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
    layout: EngineLayout,
  ): number {
    const design = this.designs[i]!;
    const armed = design.weaponEngines;
    const lit = this.lit[i]!;
    lit.fill(0);
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
      const force = this.exhaustOf(i, design, b, t);
      if (!(force > 0)) continue;
      // Any ray will do: a hull off to one side of a nozzle is as much worth
      // burning as one dead astern, and the rays exist precisely so that the
      // flame's width counts.
      let worth = false;
      // A thick engine's flame is in each layer, so is worth firing for
      // what either of them would burn.
      const engine = design.modules[design.engines[t]?.module ?? -1];
      const rays = engine === undefined ? 0 : plumeRays(engineGeometry(engine.spec));
      const layers = plumeLayers(design, t, this.layersOf(b));
      for (let layer = HULL_LAYER; layer <= WEAPONS_LAYER && !worth; layer <<= 1) {
        if ((layers & layer) === 0) continue;
        for (let ray = 0; ray < rays && !worth; ray++) {
          if (!this.plumes.cast(design, t, ray, force, bodies, b, grid, this.hulls, layer)) continue;
          if (this.plumes.share < WEAPON_PLUME_SHARE) continue;
          if (this.plumes.body === b) continue;
          const other = this.shipAt(bodies, this.plumes.body);
          if (other < 0 || this.derelict[other] === 1) continue;
          if (this.team[other] === this.team[i] || this.isDisabled(other)) continue;
          worth = true;
        }
      }
      if (!worth) continue;
      forced[t] = 1;
      lit[t] = 1;
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
   * oscillate across.
   *
   * **The radial part is flown down a stopping curve.** A craft speeds up
   * towards the band on `accelerate` of the thrust it has that way, holds
   * `approachSpeed`, and starts braking where `brake` of what it has the
   * other way will just stop it at the edge — so it arrives rather than
   * sailing through, however far out it started. Both are read off the layout
   * in the heading it is holding, since that is what it will have to do it
   * with: a hull whose guns keep it facing its target brakes on its retros.
   * For a craft fighting the other, that is `fightingAt`, its attack heading,
   * not however it lies mid-turn.
   *
   * Every positional want in the game is this one — an order and a charge to
   * cover are the same shape with different bands.
   */
  /**
   * Close on `other` at `speed`, with nothing across the line between them,
   * and no braking to arrive: a ram is meant to hit.
   */
  private charge(bodies: Bodies, b: number, other: number, speed: number): void {
    const dx = bodies.x[other]! - bodies.x[b]!;
    const dy = bodies.y[other]! - bodies.y[b]!;
    const range = length(dx, dy);
    const close = range > 0 ? speed / range : 0;
    this.urge(URGE_REFERENCE, bodies.vx[other]! + dx * close, bodies.vy[other]! + dy * close);
  }

  private hold(
    bodies: Bodies,
    i: number,
    b: number,
    other: number,
    minRange: number,
    maxRange: number,
    approachSpeed: number,
    weight: number,
    fightingAt?: number,
  ): void {
    const fighting = fightingAt !== undefined;
    // Set again below while it is still closing on a curve planned on its mains.
    const wasOnMains = this.brakingOnMains[i] === 1;
    if (fighting) this.brakingOnMains[i] = 0;
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
        // The way the band lies, and how fast this craft is already heading
        // that way relative to the other.
        const sense = outside > 0 ? 1 : -1;
        const ux = (sense * dx) / range;
        const uy = (sense * dy) / range;
        const making = (bodies.vx[b]! - vx) * ux + (bodies.vy[b]! - vy) * uy;

        const approach = this.designs[i]!.doctrine.approach;
        const facing = fightingAt ?? bodies.angle[b]!;
        const push = this.accelerationAlong(bodies, i, b, ux, uy, facing);
        const retro = max(this.accelerationAlong(bodies, i, b, -ux, -uy, facing), BRAKE_FLOOR * push);
        const accelerate = approach.accelerate * push;
        const brake = approach.brake * retro;

        // The fastest it can be making and still stop in the gap, allowing for
        // the pilot taking its response time to answer. Braking itself is
        // never capped: `brake` is what the curve plans on, and a craft that
        // has fallen behind it spends whatever it has.
        const gap = outside * sense;
        const response = approach.responseTime;
        let stopping = stoppingSpeed(brake, gap, response);
        // A craft that turns to burn brakes on its mains, once it has turned,
        // and is held to it: a curve planned on them is one it cannot stop on
        // otherwise.
        if (fighting) {
          const mains = this.mainsBrake(bodies, i, b, retro);
          // Turned away and back again: it fights facing the other way. Only
          // when that gets it there sooner, turns and all: on a short run in a
          // flip costs more than it saves.
          const turn = this.halfTurnTime(bodies, i, b);
          const turned = mains > brake ? stoppingSpeed(mains, gap, response + turn) : 0;
          const sooner =
            turned > stopping &&
            arrivalTime(mains, gap, approachSpeed, response + turn) + turn <
              arrivalTime(brake, gap, approachSpeed, response);
          if (sooner) stopping = turned;
          // Already turned onto them: planned on them, with no turn to allow for.
          if (wasOnMains && mains > 0) stopping = max(stopping, stoppingSpeed(mains, gap, response));
          // Once on it, held to it until it has stopped closing.
          // On the curve: going as fast as it can stop from on its mains, so it
          // has to turn and start now.
          const onCurve = sooner && turned < approachSpeed && making >= turned;
          this.brakingOnMains[i] = sense > 0 && making > 0 && (onCurve || wasOnMains) ? 1 : 0;
        }
        let radial = min(approachSpeed, stopping);
        // A share below one caps how much faster it asks to be going within
        // one response time, which caps the push the pilot demands. At one it
        // is left alone, since the layout is the cap then, and capping the want
        // as well would only let a sideways correction crowd it out.
        if (approach.accelerate < 1) {
          radial = min(radial, max(making, 0) + accelerate * response);
        }
        vx += ux * radial;
        vy += uy * radial;
      }
    }
    this.urge(weight, vx, vy);
  }

  /**
   * What this craft plans to brake at turned onto its mains, m/s²: `brake` of
   * its main thrust axis's acceleration, if its doctrine would turn to burn for
   * that over the `retro` it has with its guns held on, and 0 if not. Weighed
   * as `burnOrFight` weighs a change too big for the turn to matter, against
   * holding its guns on inside the band.
   */
  private mainsBrake(bodies: Bodies, i: number, b: number, retro: number): number {
    const design = this.designs[i]!;
    const approach = design.doctrine.approach;
    const axis = this.layoutOf(i).maxThrustAlong(cos(design.thrustBearing), sin(design.thrustBearing)) / bodies.mass[b]!;
    if (!(axis > retro)) return 0;
    const turns = approach.burnWeight * ((axis - retro) / axis) > approach.rangeHold * (1 + BURN_MARGIN);
    return turns ? approach.brake * axis : 0;
  }

  /** Seconds to turn half round from rest and stop there, flat out both ways. */
  private halfTurnTime(bodies: Bodies, i: number, b: number): number {
    return this.turnTime(bodies, i, b, PI);
  }

  /** Seconds to turn through `by` radians from rest and stop there, flat out both ways. */
  private turnTime(bodies: Bodies, i: number, b: number, by: number): number {
    const alpha = this.layoutOf(i).maxTorque(by >= 0 ? 1 : -1) / bodies.inertia[b]!;
    return alpha > 0 ? 2 * sqrt(abs(by) / alpha) : Infinity;
  }

  /** How hard this craft can accelerate along a world direction facing `angle`, m/s². */
  private accelerationAlong(bodies: Bodies, i: number, b: number, dirX: number, dirY: number, angle: number): number {
    const c = cos(angle);
    const s = sin(angle);
    const force = this.layoutOf(i).maxThrustAlong(dirX * c + dirY * s, -dirX * s + dirY * c);
    return force / bodies.mass[b]!;
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
    if (consort === NO_TARGET || this.alive[consort] !== 1 || this.hulk(consort)) return NO_TARGET;
    const cb = bodies.indexOf(this.bodyIds[consort]!);
    if (cb < 0 || cb === b) return NO_TARGET;

    const design = this.designs[i]!;
    const station = this.escortBand(design, consort);
    const gap = length(bodies.x[cb]! - bodies.x[b]!, bodies.y[cb]! - bodies.y[b]!);
    const weight = cohesionUrge(design.doctrine.targeting, gap, station);
    const approach = design.doctrine.approach;
    this.hold(bodies, i, b, cb, 0, station, approach.approachSpeed, weight);
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
      // Nothing to keep clear of in something that cannot be hit.
      if (ob < 0 || ob === b || bodies.ghost[ob] === 1) continue;

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
      if (when > approach.avoidHorizon) continue;
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
      const soon = 1 - when / approach.avoidHorizon;
      const weight = approach.separation * crowding * soon;
      if (weight > this.dodgeWeight) {
        this.dodgeWeight = weight;
        this.dodgeWhen = when;
      }
      this.urge(weight, vx + awayX * approach.dodgeSpeed, vy + awayY * approach.dodgeSpeed);
    }
  }

  /** Train each of this ship's turrets on what it is fighting, leading it. */
  private trainOne(bodies: Bodies, i: number): void {
    const indices = this.turretIndex[i]!;
    const aiming = this.turretAiming[i]!;
    const own = bodies.indexOf(this.bodyIds[i]!);
    const mounts = this.designs[i]!.turrets;
    for (let t = 0; t < indices.length; t++) {
      if (!this.ownsAt(i, own, mounts[t]!.module)) continue;
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
      // Tracked whether or not it is in reach, so the gun is already on it
      // when it closes; the trigger is held until it is (`allowSlack`).
      this.locateMount(bodies, own, mounts[t]!);
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
      const part = this.aimPart(bodies, i, t, target, tb);
      // Nothing on it this mount will shoot at — including under an order,
      // which can say which ship to fight but cannot make a gun fire at the
      // one thing its doctrine refused. It stands down until it looks again,
      // by which time the battle or the target will have changed.
      if (part === NOTHING_AIMABLE) {
        this.turrets.returnToRest(ti);
        continue;
      }
      aiming[t] = target;
      const design = this.designs[target]!;
      let x = bodies.x[tb]!;
      let y = bodies.y[tb]!;
      // What the barrel has to keep up with is the part's own motion, ω × r
      // and all: that is how fast the sky it sits in is moving. Only the lead
      // is the hull's.
      let sweepVx = bodies.vx[tb]!;
      let sweepVy = bodies.vy[tb]!;
      let rx = 0;
      let ry = 0;
      if (part !== WHOLE_SHIP) {
        const angle = bodies.angle[tb]!;
        const module = design.modules[part]!;
        rx = module.x * cos(angle) - module.y * sin(angle);
        ry = module.x * sin(angle) + module.y * cos(angle);
        const spin = bodies.angularVel[tb]!;
        x += rx;
        y += ry;
        sweepVx -= spin * ry;
        sweepVy += spin * rx;
      }
      this.turrets.aimAt(bodies, ti, x, y, bodies.vx[tb]!, bodies.vy[tb]!, sweepVx, sweepVy);
      const slack = this.firingSlack(mounts[t]!.targeting, target, part, this.turrets.aimDx[ti]!, this.turrets.aimDy[ti]!, rx, ry);
      // In reach of what it will fire on: the part it picked if it minds what
      // it hits, and otherwise the ship, from its middle.
      const selective = refusesAnything(mounts[t]!.targeting) && part !== WHOLE_SHIP;
      this.turrets.allowSlack(
        ti,
        slack,
        this.slackOffset,
        this.reachOn(mounts[t]!, target, part),
        selective ? length(x - this.gunPoint.x, y - this.gunPoint.y) : length(x - rx - this.gunPoint.x, y - ry - this.gunPoint.y),
      );
    }
  }

  /**
   * How far off its aim point a mount may fire and still do what its doctrine
   * asked, radians.
   *
   * **The angular size of what it is shooting at**, which is the whole of why
   * a fixed tolerance was wrong: a gun trained to within a twentieth of a
   * degree of the centre of a capital it could not miss was waiting for
   * nothing, while the same tolerance on a fighter two kilometres off is
   * looser than the target is wide.
   *
   * **Which thing has to be hit is the doctrine's own refusals, rather than a
   * setting of its own.** The question a gunner is asking is "would this shot
   * land on something I am allowed to shoot at", and the aim weights already
   * answer it. A doctrine that refuses nothing is allowed to hit any part of
   * that ship, so anywhere on the hull will do. One that refuses something is
   * not: the part it chose is the only piece it is sure of, so it holds until
   * that part is under the muzzle. A refusal therefore says two things at
   * once, and they are the same thing — *mind what you hit*.
   *
   * Where the ship will do, the cone is the whole ship's, about its middle,
   * whatever part the aim is on: `slackOffset` says how far that middle is off
   * the aim point. A gun aiming at a wing fires once anywhere on the hull is
   * under the muzzle.
   *
   * Approximate on purpose, and in the forgiving direction: a bounding circle
   * is not a silhouette, so a target seen end-on is taken to be as wide as it
   * is long. What that costs is a shot sent at a ship that has presented its
   * bow, which is a shot at a ship rather than a shot at nothing. ROADMAP §12
   * holds the presented aspect, and with it the finer answer this
   * approximates — which of a target's *neighbouring* parts a stray shot
   * would land on, rather than whether any of them might be refused.
   */
  private firingSlack(
    doctrine: Targeting,
    target: number,
    part: number,
    aimX: number,
    aimY: number,
    partX: number,
    partY: number,
  ): number {
    this.slackOffset = 0;
    const design = this.designs[target]!;
    const range = length(aimX, aimY);
    if (!(range > 0)) return 0;

    // Selective, so the part it picked is the whole of what it will accept.
    if (refusesAnything(doctrine) && part !== WHOLE_SHIP) {
      return atan2(moduleRadius(design.modules[part]!.spec), range);
    }

    // Otherwise the whole ship's cone, about its middle: where the aim is,
    // less where the part sits on the hull, led alike.
    const cx = aimX - partX;
    const cy = aimY - partY;
    const centre = length(cx, cy);
    if (!(centre > 0)) return 0;
    this.slackOffset = angleDelta(atan2(aimY, aimX), atan2(cy, cx));
    return atan2(design.radius, centre);
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
  private aimPart(bodies: Bodies, i: number, t: number, target: number, targetBody: number): number {
    const mount = this.designs[i]!.turrets[t]!;
    const doctrine = mount.targeting;
    const part = this.turretAimModule[i]![t]!;
    // The ship as a whole, chosen for this target: too far out for a part.
    if (part === WHOLE_SHIP && this.turretTarget[i]![t] === target) return WHOLE_SHIP;
    const held =
      this.turretTarget[i]![t] !== target ||
      part === WHOLE_SHIP ||
      part === NOTHING_AIMABLE ||
      part >= this.designs[target]!.modules.length ||
      this.damage.spent(targetBody, part)
        ? -1
        : part;
    if (held >= 0) return held;

    // Nothing usable held: the part has been shot away, or this is a target
    // the mount was ordered onto rather than one it chose. A doctrine with no
    // refusals can fall back on the hull, which is where a mount with no
    // opinion about parts aims anyway — if it fires in the hull layer. In the
    // weapons layer amidships is deck its rounds pass over.
    const hooked = targetBody === bodies.indexOf(this.bodyIds[i]!);
    const layers = this.mountLayers(i, mount);
    if (!refusesAnything(doctrine) && this.meetsWhole(layers, target) && !hooked) return WHOLE_SHIP;

    // One that *has* refused something cannot: a ship's centre is whatever is
    // amidships, which on most hulls is the plating a beam has just turned
    // down. So it chooses again from what is actually left, now, and only
    // stands down when the answer is that there is nothing it will shoot at.
    // The mount is already located by the caller.
    return this.aimFor(bodies, i, mount, layers, target, this.gunPoint.x, this.gunPoint.y, hooked);
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
   * is a version comparison like the engine layout's.
   */
  private partCutWelds(world: World): number {
    const bodies = world.bodies;
    let pieces = 0;
    for (let i = 0; i < this.alive.length; i++) {
      if (this.alive[i] === 0) continue;
      const b = bodies.indexOf(this.bodyIds[i]!);
      // A body is walked once, by its primary, however many ships ride it.
      if (b < 0 || this.shipByBody[b] !== i) continue;
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
      pieces += this.breakUp(world, i, design, parts);
    }
    return pieces;
  }

  /**
   * Hook together the hulls this step's slow contacts pressed a ragged edge
   * into, and say how many pairs became one.
   *
   * Torn metal catches where a clean hull would glance off, so a contact
   * closing at no more than `WELD_SPEED` where either module is ragged
   * (`Damage.ragged`) makes the two bodies one, held by a seam. A ship hooked
   * onto a wreck carries it and gains nothing it can use, since command never
   * crosses a seam. Two ships hooked together both ride the one body, each
   * flying and fighting with what it brought, so they pull against each other.
   * A seam holds and tears like any weld, so a blow can part them again.
   *
   * Every weld *removes* a body rather than holding two in a lasting contact.
   */
  weld(world: World, contacts: Contacts): number {
    const bodies = world.bodies;
    this.bodyStore = bodies;
    let welded = 0;
    // Made only on a weld, which is rare, so a quiet step allocates nothing.
    let joined = null as Set<number> | null;
    const settled = world.tick - WELD_SETTLE / world.dt;
    for (let k = 0; k < contacts.count; k++) {
      // Pressed together, slowly: touching or drifting apart hooks nothing.
      const closing = contacts.closing[k]!;
      if (!(closing > 0) || closing > WELD_SPEED) continue;
      const a = contacts.a[k]!;
      const b = contacts.b[k]!;
      const i = this.shipAt(bodies, a);
      const j = this.shipAt(bodies, b);
      if (i < 0 || j < 0 || joined?.has(i) === true || joined?.has(j) === true) continue;
      if (this.partedAt[i]! > settled || this.partedAt[j]! > settled) continue;
      if (this.damage.isProtected(a) || this.damage.isProtected(b)) continue;
      const ma = contacts.moduleA[k]!;
      const mb = contacts.moduleB[k]!;
      if (!this.damage.ragged(a, ma) && !this.damage.ragged(b, mb)) continue;
      // A flown hull keeps its body; two wrecks keep the older's slot.
      if (this.derelict[i] === 1 && this.derelict[j] === 0) this.merge(world, j, i, mb, ma);
      else this.merge(world, i, j, ma, mb);
      joined ??= new Set<number>();
      joined.add(i);
      joined.add(j);
      // The contact is now inside one body: its impulse is no blow to answer.
      contacts.impulse[k] = 0;
      welded++;
    }
    return welded;
  }

  /**
   * Make `other` part of `keep`, hooked where module `mk` of one met module
   * `mo` of the other. Momentum and angular momentum come out as they went in:
   * one rigid body moving as the two did between them.
   */
  private merge(world: World, keep: number, other: number, mk: number, mo: number): void {
    const bodies = world.bodies;
    const idK = this.bodyIds[keep]!;
    const bk = bodies.indexOf(idK);
    const bo = bodies.indexOf(this.bodyIds[other]!);
    const dk = this.designs[keep]!;
    const dO = this.designs[other]!;

    // The other's blueprint frame, in the keeper's.
    const angleK = bodies.angle[bk]!;
    const turn = bodies.angle[bo]! - angleK;
    const ck = cos(angleK);
    const sk = sin(angleK);
    const ct = cos(turn);
    const st = sin(turn);
    const wx = bodies.x[bo]! - bodies.x[bk]!;
    const wy = bodies.y[bo]! - bodies.y[bk]!;
    const dx = dk.centreOfMassX + (wx * ck + wy * sk) - (dO.centreOfMassX * ct - dO.centreOfMassY * st);
    const dy = dk.centreOfMassY + (-wx * sk + wy * ck) - (dO.centreOfMassX * st + dO.centreOfMassY * ct);
    const specK = dk.modules[mk]!.spec;
    const specO = dO.modules[mo]!.spec;
    const width = HOOK_SHARE * min(min(specK.length, specK.width), min(specO.length, specO.width));
    const design = weldDesigns(dk, dO, dx, dy, turn, mk, mo, width);

    const massK = bodies.mass[bk]!;
    const massO = bodies.mass[bo]!;
    const total = massK + massO;
    const cx = bodies.x[bk]! + (design.centreOfMassX - dk.centreOfMassX) * ck - (design.centreOfMassY - dk.centreOfMassY) * sk;
    const cy = bodies.y[bk]! + (design.centreOfMassX - dk.centreOfMassX) * sk + (design.centreOfMassY - dk.centreOfMassY) * ck;
    const vx = (massK * bodies.vx[bk]! + massO * bodies.vx[bo]!) / total;
    const vy = (massK * bodies.vy[bk]! + massO * bodies.vy[bo]!) / total;
    // About the new centre: each body's own spin, and its motion around it.
    const spinOf = (body: number, mass: number): number =>
      bodies.inertia[body]! * bodies.angularVel[body]! +
      mass * ((bodies.x[body]! - cx) * bodies.vy[body]! - (bodies.y[body]! - cy) * bodies.vx[body]!);
    const angular = spinOf(bk, massK) + spinOf(bo, massO);

    bodies.x[bk] = cx;
    bodies.y[bk] = cy;
    bodies.vx[bk] = vx;
    bodies.vy[bk] = vy;
    bodies.setMass(idK, design.mass);
    bodies.setInertia(idK, design.inertia);
    bodies.angularVel[bk] = angular / design.inertia;
    bodies.radius[bk] = design.radius;

    // Who works what: a wreck is nobody's once a second pilot is aboard, and a
    // ship alone keeps working all of it.
    const n = dk.modules.length;
    const flown = this.derelict[other] === 0;
    const staying = this.ridersOf(bodies, bk);
    const moving = flown ? this.ridersOf(bodies, bo) : [];
    const wasK = this.pilots[bk] ?? null;
    const wasO = this.pilots[bo] ?? null;
    let pilots: Int32Array | null = null;
    if (flown || wasK !== null) {
      pilots = new Int32Array(design.modules.length);
      for (let m = 0; m < n; m++) pilots[m] = wasK === null ? keep : wasK[m]!;
      for (let m = n; m < pilots.length; m++) pilots[m] = !flown ? -1 : wasO === null ? other : wasO[m - n]!;
    }

    this.adopt(keep, bk, design, (m) => (m < n ? keep : other), (m) => (m < n ? m : m - n));
    this.pilots[bk] = pilots;
    // Spun up against the inertia the fuel left aboard gives it.
    bodies.angularVel[bk] = angular / bodies.inertia[bk]!;

    const gone = this.bodyIds[other]!;
    this.damage.forget(bo);
    this.fuel.forget(bo);
    this.shipByBody[bo] = -1;
    this.pilots[bo] = null;
    this.sides[bo] = null;
    // Everyone already aboard takes the new design, wreckage hooked on or not:
    // a ship left on the old one would be drawn, aimed and fired from a layout
    // the body no longer has.
    for (const r of staying) if (r !== keep) this.board(r, keep);
    if (flown) {
      const old = this.turretIndex[other]!;
      for (let t = 0; t < old.length; t++) this.turrets.remove(old[t]!);
      for (const r of moving) this.board(r, keep);
    } else {
      this.remove(other);
    }
    world.destroy(gone);
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

      const mass = bodies.mass[b]!;
      this.discarded += mass;
      this.discardedPx += mass * bodies.vx[b]!;
      this.discardedPy += mass * bodies.vy[b]!;
      this.damage.forget(b);
      this.fuel.forget(b);
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

  /** The side module `m` of body `b` came from. */
  private sideAt(b: number, m: number): number {
    const sides = this.sides[b];
    return sides === null || sides === undefined ? this.team[this.shipByBody[b]!]! : sides[m]!;
  }

  /** The side module `m` of the body ship `i` rides came from, for drawing it in that side's colours. */
  moduleSide(i: number, m: number): number {
    const b = this.bodyStore === null ? -1 : this.bodyStore.indexOf(this.bodyIds[i]!);
    return b < 0 ? this.team[i]! : this.sideAt(b, m);
  }

  /** Each module's side, or null if every one is `team`'s. */
  private sidesOf(sideOf: (m: number) => number, count: number, team: number): Int32Array | null {
    let mixed = false;
    const sides = new Int32Array(count);
    for (let m = 0; m < count; m++) {
      sides[m] = sideOf(m);
      if (sides[m] !== team) mixed = true;
    }
    return mixed ? sides : null;
  }

  /** Whether ship `i`, riding body index `b`, works module `m` of it. */
  private ownsAt(i: number, b: number, m: number): boolean {
    const pilots = this.pilots[b];
    return pilots === null || pilots === undefined || pilots[m] === i;
  }

  /** What damage has left of a module's effect, for the ship working it: none for anyone else. */
  private left(i: number, b: number, module: number, effect: DamageEffect): number {
    return this.ownsAt(i, b, module) ? this.damage.remaining(b, module, effect) : 0;
  }

  /** Whether ship `i` works module `m` of the body it rides. */
  owns(i: number, m: number): boolean {
    const b = this.bodyStore === null ? -1 : this.bodyStore.indexOf(this.bodyIds[i]!);
    return b >= 0 && this.ownsAt(i, b, m);
  }

  /**
   * Whether ship `i` should draw module `m`: what it works, and — for the
   * body's primary — what nobody works, so each module is drawn once.
   */
  draws(i: number, m: number): boolean {
    const b = this.bodyStore === null ? -1 : this.bodyStore.indexOf(this.bodyIds[i]!);
    if (b < 0) return false;
    const pilots = this.pilots[b];
    if (pilots === null || pilots === undefined) return true;
    return pilots[m] === i || (pilots[m] === -1 && this.shipByBody[b] === i);
  }

  /**
   * The ship answering for a module of a body: whoever works it, or the body's
   * primary when nobody does or no module is named. -1 for no ship.
   */
  pilotAt(bodyIndex: number, module = -1): number {
    const bodies = this.bodyStore;
    if (bodies === null) return -1;
    const primary = this.shipAt(bodies, bodyIndex);
    if (primary < 0) return -1;
    const pilots = this.pilots[bodyIndex];
    if (pilots === null || pilots === undefined || module < 0) return primary;
    const owner = pilots[module] ?? -1;
    return owner >= 0 && this.alive[owner] === 1 ? owner : primary;
  }

  /** Every ship riding a body, primary included, in slot order. */
  private ridersOf(bodies: Bodies, b: number): number[] {
    const riders: number[] = [];
    for (let r = 0; r < this.alive.length; r++) {
      if (this.alive[r] === 1 && bodies.indexOf(this.bodyIds[r]!) === b) riders.push(r);
    }
    return riders;
  }

  /** Put ship `r` aboard the body `p` is primary of, sharing its design and mount state. */
  private board(r: number, p: number): void {
    const design = this.designs[p]!;
    this.designs[r] = design;
    this.bodyIds[r] = this.bodyIds[p]!;
    this.turretIndex[r] = this.turretIndex[p]!;
    this.cooldown[r] = this.cooldown[p]!;
    this.turretStates[r] = this.turretStates[p]!;
    this.nextBarrelToFire[r] = this.nextBarrelToFire[p]!;
    this.turretTarget[r] = this.turretTarget[p]!;
    this.turretAiming[r] = this.turretAiming[p]!;
    this.turretAimModule[r] = this.turretAimModule[p]!;
    this.turretRethinkAt[r] = this.turretRethinkAt[p]!;
    this.throttles[r] = new Float64Array(design.engines.length);
    this.lit[r] = new Uint8Array(design.engines.length);
    this.landed[r] = new Float64Array(landedLength(design));
    this.layouts[r] = null;
    this.layoutVersion[r] = -1;
    this.cutSeen[r] = this.cutSeen[p]!;
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
    return this.breakUp(world, i, design, parts);
  }

  /**
   * Give every piece of a hull that has come apart a body of its own, and say
   * how many came off. Ship `i` is the body's primary and stays with it.
   *
   * With several ships aboard, each goes with the piece it is flown from — its
   * lowest working core, else its first core — so two ships hooked together
   * part as the two ships they were. A piece nobody is flown from is wreckage,
   * or a ship of its own if a working core is on it (`detach`).
   */
  private breakUp(world: World, i: number, design: ShipDesign, parts: readonly number[][]): number {
    const bodies = world.bodies;
    const b = bodies.indexOf(this.bodyIds[i]!);
    const pilots = this.pilots[b] ?? null;
    let pieces = 0;
    if (pilots === null) {
      const keeper = this.keeperOf(b, design, parts);
      for (let p = 0; p < parts.length; p++) {
        if (p === keeper) continue;
        if (this.detach(world, i, design, parts[p]!)) pieces++;
      }
      this.reshape(world, i, design, parts[keeper]!);
      return pieces;
    }

    const partOf = new Int32Array(design.modules.length);
    for (let p = 0; p < parts.length; p++) for (const m of parts[p]!) partOf[m] = p;
    const riders = this.ridersOf(bodies, b);
    const home = riders.map((r) => partOf[this.anchorOf(b, design, pilots, r)]!);
    const keeper = home[riders.indexOf(i)]!;
    for (let p = 0; p < parts.length; p++) {
      if (p === keeper) continue;
      const aboard = riders.filter((_, k) => home[k] === p);
      if (aboard.length > 0) {
        this.rehome(world, i, aboard, design, parts[p]!, pilots);
        pieces++;
        continue;
      }
      // A second core of somebody's, flying on for that ship's side.
      const core = design.cores.find(
        (c) => partOf[c] === p && this.damage.remaining(b, c, DamageEffect.Control) > 0,
      );
      const owner = core === undefined ? -1 : pilots[core]!;
      if (this.detach(world, i, design, parts[p]!, owner >= 0 && this.alive[owner] === 1 ? owner : i)) pieces++;
    }
    const staying = riders.filter((_, k) => home[k] === keeper);
    this.reshape(world, i, design, parts[keeper]!);
    this.assignPilots(b, i, staying, pilots, parts[keeper]!);
    return pieces;
  }

  /** The module ship `r` is flown from: its lowest working core, its first core, or its lowest module. */
  private anchorOf(b: number, design: ShipDesign, pilots: Int32Array, r: number): number {
    let first = -1;
    for (const core of design.cores) {
      if (pilots[core] !== r) continue;
      if (this.damage.remaining(b, core, DamageEffect.Control) > 0) return core;
      if (first < 0) first = core;
    }
    if (first >= 0) return first;
    for (let m = 0; m < pilots.length; m++) if (pilots[m] === r) return m;
    return 0;
  }

  /**
   * Carry who works what over to body `b`, now cut down to `keep`, and put
   * everyone `aboard` on its primary `p`. One ship alone works all of it.
   */
  private assignPilots(b: number, p: number, aboard: readonly number[], was: Int32Array, keep: readonly number[]): void {
    if (aboard.length < 2) {
      this.pilots[b] = null;
      return;
    }
    const pilots = new Int32Array(keep.length);
    for (let k = 0; k < keep.length; k++) {
      const owner = was[keep[k]!]!;
      pilots[k] = aboard.includes(owner) ? owner : -1;
    }
    this.pilots[b] = pilots;
    for (const r of aboard) if (r !== p) this.board(r, p);
  }

  /**
   * Move the ships `aboard` onto a new body made of the modules `keep` of the
   * body `from` is primary of — a ship parting from the one it was hooked to,
   * leaving as a rigid split does (`detach`) and taking its own orders and
   * mount state with it.
   */
  private rehome(world: World, from: number, aboard: readonly number[], was: ShipDesign, keep: readonly number[], pilots: Int32Array): void {
    const bodies = world.bodies;
    const b = bodies.indexOf(this.bodyIds[from]!);
    const chunk = subDesign(was, keep);
    const offset = this.offsetOf(bodies, b, was, chunk);
    const spin = bodies.angularVel[b]!;
    const id = world.spawn({
      x: bodies.x[b]! + offset.x,
      y: bodies.y[b]! + offset.y,
      angle: bodies.angle[b]!,
      vx: bodies.vx[b]! - spin * offset.y,
      vy: bodies.vy[b]! + spin * offset.x,
      angularVel: spin,
      mass: chunk.mass,
      inertia: chunk.inertia,
      radius: chunk.radius,
    });
    const nb = bodies.indexOf(id);
    const p = aboard[0]!;
    this.hullBody[nb] = id;
    // Read from `from`, which still holds the old body and its mounts; those are
    // released when it is reshaped.
    this.adopt(p, nb, chunk, () => from, (m) => keep[m]!, false);
    this.bodyIds[p] = id;
    this.shipByBody[nb] = p;
    for (const r of aboard) this.partedAt[r] = world.tick;
    this.assignPilots(nb, p, aboard, pilots, keep);
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
   * of the plan the ship was given, because the core it is flown from was given
   * that plan too. Everything else comes away as a piece of hull with nothing
   * controlling it. This is what a second core buys — a hull cut in two amidships
   * becomes two ships rather than a ship and a wreck.
   */
  private detach(world: World, i: number, design: ShipDesign, keep: readonly number[], side = i): boolean {
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
    let mass = chunk.mass;
    for (let m = 0; m < keep.length; m++) mass -= chunk.modules[m]!.stats.fuel - this.fuel.held(b, keep[m]!);
    if (!flies && mass < SCRAP_MASS) {
      this.discarded += mass;
      // Whatever it would have left with, had it been worth putting there.
      this.discardedPx += mass * (bodies.vx[b]! - spin * offset.y);
      this.discardedPy += mass * (bodies.vy[b]! + spin * offset.x);
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
      team: this.team[side]!,
      serial: this.serial[side]!,
    });
    this.partedAt[j] = world.tick;
    if (flies) {
      this.orders[j] = this.orders[side]!.map((order) => ({ ...order }));
    } else {
      this.derelict[j] = 1;
    }

    // Its mounts keep pointing and slewing as they were rather than starting
    // at rest; with nothing to fly it, a fail-safe then brakes them where
    // they point.
    const from = this.turretIndex[i]!;
    const to = this.turretIndex[j]!;
    chunk.turrets.forEach((mount, t) => {
      const before = design.turrets.findIndex((m) => m.module === keep[mount.module]);
      if (before >= 0) this.turrets.carry(from[before]!, to[t]!, 0);
    });

    const chunkBody = bodies.indexOf(this.bodyIds[j]!);
    this.damage.register(
      chunkBody,
      chunk,
      this.scarsOf(b, keep),
      this.weldScarsOf(b, design, chunk, keep),
    );
    this.fuel.register(
      chunkBody,
      chunk,
      keep.map((m) => this.fuel.held(b, m)),
      this.leaksInto(keep.length, (m) => ({ body: b, module: keep[m]! })),
    );
    this.settleMass(bodies, chunkBody);
    this.shipByBody[chunkBody] = j;
    this.sides[chunkBody] = this.sidesOf((m) => this.sideAt(b, keep[m]!), keep.length, this.team[j]!);
    return true;
  }

  /**
   * Cut a ship down to the piece it is flown from, in place.
   *
   * Everything derived from the layout is derived again, because the layout
   * is what changed: mass and inertia, the centre of mass the body turns
   * about, the engine matrix, the mounts and their arcs. What is carried
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

    this.partedAt[i] = world.tick;
    this.adopt(i, b, design, () => i, (m) => keep[m]!);
  }

  /**
   * Make a ship's body carry a new design in place, keeping whatever belongs to
   * the ship rather than its shape: each module's scars, each weld's cuts, and
   * each surviving mount's state. `shipOf` and `moduleOf` say which ship and
   * which of its modules each module of the new design was.
   */
  private adopt(
    i: number,
    b: number,
    design: ShipDesign,
    shipOf: (module: number) => number,
    moduleOf: (module: number) => number,
    release = true,
  ): void {
    const bodies = this.bodyStore!;
    const bodyOf = (ship: number): number => bodies.indexOf(this.bodyIds[ship]!);
    const sides = this.sidesOf((m) => this.sideAt(bodyOf(shipOf(m)), moduleOf(m)), design.modules.length, this.team[i]!);
    const scars: number[] = [];
    const fuel: number[] = [];
    for (let m = 0; m < design.modules.length; m++) {
      scars.push(this.damage.absorbedAt(bodyOf(shipOf(m)), moduleOf(m)));
      fuel.push(this.fuel.held(bodyOf(shipOf(m)), moduleOf(m)));
    }
    // A weld half sawn through stays half sawn through; a seam is new.
    const weldScars: number[] = [];
    for (const joint of joints(design)) {
      const ship = shipOf(joint.a);
      if (shipOf(joint.b) !== ship) {
        weldScars.push(0);
        continue;
      }
      const k = jointBetween(this.designs[ship]!, moduleOf(joint.a), moduleOf(joint.b));
      weldScars.push(this.damage.cutAt(bodyOf(ship), k));
    }

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
    const specs = sides === null ? [] : design.modules.map((m) => m.spec);
    for (let t = 0; t < design.turrets.length; t++) {
      const mount = design.turrets[t]!;
      // Two sides on one body: the other side's modules are not this mount's
      // own ship downrange but something to shoot at.
      const mask =
        sides === null
          ? (mount.mount.mask ?? [])
          : triggerMask(
              specs,
              mount.module,
              (_spec, k) => sides[k] === sides[mount.module] && (mount.hullLayer || design.modules[k]!.weaponsLayer),
              shotSpread(mount.gun),
            );
      const index = this.turrets.add({ ...mount.mount, mask, owner: b });
      indices[t] = index;
      // Which mount this was, by the module it sits on.
      const ship = shipOf(mount.module);
      const module = moduleOf(mount.module);
      const was = this.designs[ship]!;
      let before = -1;
      for (let k = 0; k < was.turrets.length; k++) {
        if (was.turrets[k]!.module === module) before = k;
      }
      if (before < 0) continue;
      // Pointing and slewing as it was, turned into this hull's frame: a ship
      // merged in was flying a heading of its own.
      const turn = bodies.angle[bodyOf(ship)]! - bodies.angle[b]!;
      this.turrets.carry(this.turretIndex[ship]![before]!, index, turn);
      cooldown[t] = this.cooldown[ship]![before]!;
      states[t] = this.turretStates[ship]![before]!;
      barrels[t] = this.nextBarrelToFire[ship]![before]!;
      targets[t] = this.turretTarget[ship]![before]!;
      // Not what it was aiming at: a weld lands between aiming and firing, so
      // it holds fire until the next `command` has aimed it from the new hull.
      aims[t] = this.turretAimModule[ship]![before]!;
      schedule[t] = this.turretRethinkAt[ship]![before]!;
    }
    if (release) {
      const old = this.turretIndex[i]!;
      for (let t = 0; t < old.length; t++) this.turrets.remove(old[t]!);
    }

    this.designs[i] = design;
    this.hullDesign[b] = design;
    this.sides[b] = sides;
    this.turretIndex[i] = indices;
    this.cooldown[i] = cooldown;
    this.turretStates[i] = states;
    this.nextBarrelToFire[i] = barrels;
    this.turretTarget[i] = targets;
    this.turretAiming[i] = aiming;
    this.turretAimModule[i] = aims;
    this.turretRethinkAt[i] = schedule;
    this.throttles[i] = new Float64Array(design.engines.length);
    this.lit[i] = new Uint8Array(design.engines.length);
    this.landed[i] = new Float64Array(landedLength(design));
    this.layouts[i] = null;
    this.layoutVersion[i] = -1;
    this.damage.register(b, design, scars, weldScars);
    const leaks = this.leaksInto(design.modules.length, (m) => ({ body: bodyOf(shipOf(m)), module: moduleOf(m) }));
    this.fuel.register(b, design, fuel, leaks);
    this.settleMass(bodies, b);
    this.cutSeen[i] = this.damage.cutVersion(b);
  }

  /**
   * Draw what this ship's engines burned this step from its tanks, and throttle
   * back any engine whose tanks could not supply it.
   *
   * Paid by gas thrown rather than by thrust delivered: an engine firing into
   * its own hull burns its fuel all the same (`exhaustOf`).
   */
  private burn(dt: number, bodies: Bodies, i: number): void {
    const b = bodies.indexOf(this.bodyIds[i]!);
    if (b < 0) return;
    const design = this.designs[i]!;
    const throttles = this.throttles[i]!;
    let burned = false;
    let short = false;
    for (let t = 0; t < design.engines.length; t++) {
      const u = throttles[t]!;
      if (!(u > 0)) continue;
      const module = design.engines[t]!.module ?? -1;
      const exhaust = design.modules[module]?.stats.exhaustVelocity ?? 0;
      // A layout built by hand has no modules, and so nothing to run dry.
      if (!(exhaust > 0)) continue;
      const wanted = (u * this.exhaustOf(i, design, b, t) * dt) / exhaust;
      if (!(wanted > 0)) continue;
      const got = this.fuel.drain(b, module, wanted);
      burned = true;
      if (got < wanted) {
        throttles[t] = (u * got) / wanted;
        short = true;
      }
    }
    if (burned) this.settleMass(bodies, b);
    if (!short) return;

    // What the engines that ran short actually push with.
    const layout = this.layoutOf(i);
    let fx = 0;
    let fy = 0;
    let torque = 0;
    for (let t = 0; t < layout.count; t++) {
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
   * Let fuel out of every hole in this ship's body, and push the body the
   * other way. Once per body: a ship riding another's leaks nothing of its own.
   */
  private leak(dt: number, bodies: Bodies, i: number): void {
    this.leakFx[i] = 0;
    this.leakFy[i] = 0;
    this.leakTorque[i] = 0;
    const b = bodies.indexOf(this.bodyIds[i]!);
    if (b < 0 || this.shipByBody[b] !== i || !(dt > 0)) return;
    const leaks = this.fuel.leaksOf(b);
    if (leaks.length === 0) return;
    const design = this.hullDesign[b]!;
    let fx = 0;
    let fy = 0;
    let torque = 0;
    let vented = false;
    for (const leak of leaks) {
      // The lining swells into the hole, pinching it off as far as it can reach.
      if (leak.width > leak.floor) leak.width = max(leak.floor, leak.width - leak.closing * dt);
      const fill = this.fuel.fill(b, leak.module);
      const taken = this.fuel.vent(b, leak.module, leakRate(PI * 0.25 * leak.width * leak.width, fill) * dt);
      leak.rate = taken / dt;
      if (!(taken > 0)) continue;
      vented = true;
      const m = design.modules[leak.module]!;
      const c = cos(m.angle);
      const s = sin(m.angle);
      const hx = m.x + leak.x * c - leak.y * s;
      const hy = m.y + leak.x * s + leak.y * c;
      // Pushed against the jet, at the hole.
      const thrust = leak.rate * leakSpeed(fill);
      const px = -(leak.nx * c - leak.ny * s) * thrust;
      const py = -(leak.nx * s + leak.ny * c) * thrust;
      fx += px;
      fy += py;
      torque += hx * py - hy * px;
    }
    if (vented) this.settleMass(bodies, b);
    this.leakFx[i] = fx;
    this.leakFy[i] = fy;
    this.leakTorque[i] = torque;
  }

  /** Every hole in a body that comes over to a new design, renumbered by where each module went. */
  private leaksInto(n: number, from: (module: number) => { body: number; module: number }): Leak[] {
    const out: Leak[] = [];
    for (let m = 0; m < n; m++) {
      const { body, module } = from(m);
      for (const leak of this.fuel.leaksOf(body)) if (leak.module === module) out.push({ ...leak, module: m });
    }
    return out;
  }

  /** A body's mass and inertia: its design's, less the fuel burnt from it. */
  private settleMass(bodies: Bodies, b: number): void {
    const design = this.hullDesign[b];
    // Something nothing moves stays that way.
    if (design === null || design === undefined || !(bodies.mass[b]! > 0)) return;
    const id = this.hullBody[b]!;
    bodies.setMass(id, design.mass - this.fuel.burntMass(b));
    bodies.setInertia(id, design.inertia - this.fuel.burntInertia(b));
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

  /** With no working core, every engine cuts out and every turret brakes to a stop. */
  private failSafe(i: number): void {
    const turrets = this.turretIndex[i]!;
    for (let t = 0; t < turrets.length; t++) this.turrets.stop(turrets[t]!);
    this.throttles[i]!.fill(0);
    this.demandFx[i] = 0;
    this.demandFy[i] = 0;
    this.demandTorque[i] = 0;
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
    this.recoil[i] = 0;
    this.leakFx[i] = 0;
    this.leakFy[i] = 0;
    this.leakTorque[i] = 0;
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
   * What one of a ship's engines is producing, as a fraction of its rating.
   *
   * The throttle the allocator set, scaled by what damage has left of the
   * engine — so a half-wrecked engine at full throttle reports a half. That is
   * the quantity the plume is drawn from, and a burning engine drawing a flame
   * it is no longer capable of is the picture disagreeing with the burn.
   */
  /**
   * How much of one flame ray landed on something last step, as its share of
   * the ray's power: 1 at the nozzle, 0 for a ray that met nothing.
   */
  landedShare(i: number, engine: number, ray: number, layer = HULL_LAYER): number {
    return this.landed[i]![landedIndex(this.designs[i]!, engine, ray, layer)] ?? 0;
  }

  /** The layers one of this ship's engines' plumes is in. */
  plumeLayersOf(i: number, engine: number): number {
    const bodies = this.bodyStore;
    const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[i]!);
    return plumeLayers(this.designs[i]!, engine, b < 0 ? OWN_LAYERS : this.layersOf(b));
  }

  /** Every ray's `landedShare` for one ship, flat. Read-only. */
  landedRays(i: number): Float64Array {
    return this.landed[i]!;
  }

  throttleOf(i: number, engine: number): number {
    const bodies = this.bodyStore;
    const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[i]!);
    if (b < 0) return this.throttles[i]![engine]!;
    const spec = this.designs[i]!.engines[engine]!;
    const left = this.left(i, b, spec.module ?? -1, DamageEffect.Thrust);
    return this.throttles[i]![engine]! * left;
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
  private exhaustOf(i: number, design: ShipDesign, bodyIndex: number, engine: number): number {
    const spec = design.engines[engine]!;
    return spec.maxThrust * this.left(i, bodyIndex, spec.module ?? -1, DamageEffect.Thrust);
  }

  /**
   * How far into its flame one of this ship's engines would burn something
   * worth firing on, at full throttle, metres: 0 unless it is a weapon that
   * can still burn.
   */
  weaponReach(i: number, engine: number): number {
    const design = this.designs[i]!;
    const spec = design.engines[engine]!;
    if (spec.weapon !== true) return 0;
    const module = design.modules[spec.module ?? -1];
    const bodies = this.bodyStore;
    const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[i]!);
    if (module === undefined || b < 0) return 0;
    return weaponPlumeReach(engineGeometry(module.spec), this.exhaustOf(i, design, b, engine));
  }

  /** Whether one of this ship's engines is burning as a weapon. */
  isEngineFiring(i: number, engine: number): boolean {
    return this.hasControl(i) && this.lit[i]![engine] === 1;
  }

  /** Seconds until a gun is loaded again. Diagnostic. */
  cooldownOf(i: number, turret: number): number {
    return this.cooldown[i]![turret]!;
  }

  /**
   * How full a gun is, 0 to 1: through its reload while it reloads, what is
   * left of its burst while a beam fires, and 1 when it is ready.
   */
  loadOf(i: number, turret: number): number {
    const timer = this.cooldown[i]![turret]!;
    if (!(timer > 0)) return 1;
    const mount = this.designs[i]!.turrets[turret]!;
    if (this.turretStates[i]![turret] === TurretState.CommittedOn) {
      return mount.gun.beamOnTime > 0 ? min(1, timer / mount.gun.beamOnTime) : 0;
    }
    const bodies = this.bodyStore;
    const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[i]!);
    const rate = b < 0 ? 1 : this.damage.remaining(b, mount.module, DamageEffect.FireRate);
    const cycle = mount.gun.cycleTime / (rate > 0 ? rate : 1);
    return cycle > 0 ? max(0, 1 - timer / cycle) : 1;
  }

  /** Whether a gun is reloading, rather than ready or firing. */
  isReloading(i: number, turret: number): boolean {
    return this.turretStates[i]![turret] === TurretState.Reloading && this.cooldown[i]![turret]! > 0;
  }

  /** Whether the pilot's demand exceeded what the layout can produce. */
  saturated(): boolean {
    return this.allocation.saturated;
  }
}
