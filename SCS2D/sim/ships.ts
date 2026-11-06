import { Debris } from "./debris.js";
import { Bodies, type BodyId } from "./bodies.js";
import {
    aboardPose,
    footprintOf,
    padHolds,
    originOf,
    reachAgainst,
    sameOrigin,
    slipwayHolds,
    type Footprint,
    type DesignTurret,
    type ShipDesign,
} from "./blueprint.js";
import { components, joints } from "./connectivity.js";
import { BOTH_LAYERS, HULL_LAYER, Hulls, moduleLayers, OWN_LAYERS, WEAPONS_LAYER } from "./hull.js";
import { Damage, DamageEffect, IMPACT_MUZZLE, type ImpactLog } from "./damage.js";
import { Fuel, LEAK_HOLE_CALIBRES, leakChance } from "./fuel.js";
import { Charge } from "./charge.js";
import { Metal } from "./metal.js";
import { Claim, mendClaim, priorityOf, Resource, Supply } from "./supply.js";
import { SEAL_REACH, SEAL_SPEED } from "./modules.js";
import type { Rng } from "./rng.js";
import { geometryOf, landedIndex, landedLength, plumeLayers, Plumes, weaponPlumeReach } from "./exhaust.js";
import { Choice, inSight, look, lookFrom, score } from "./targeting.js";
import {
    casingMass,
    chargeShare,
    DEFAULT_BURST_SPEED,
    DEFAULT_FRAGMENTS,
    DEFAULT_FUSE,
    firesShells,
    moduleRadius,
    type ModuleSpec,
} from "./modules.js";
import { atan2, angleDelta, PI, clamp, cos, floor, length, max, min, round, sin, sqrt } from "./math.js";
import { Projectiles } from "./projectiles.js";
import type { Store } from "./store.js";
import { Robots, type Robot } from "./robots.js";
import { Allocation, EngineLayout } from "./engines.js";
import { STEER_HOLD_SPEED } from "./helm.js";
import { AttackArcs, AttackRegion } from "./attack.js";
import { FiringSolution, Turrets, TurretState } from "./turrets.js";
import {
    holdBand,
    overriddenDoctrine,
    overriddenMount,
    placementOf,
    withOverride,
    withoutPart,
    type Approach,
    type Doctrine,
    type DoctrineOverride,
    type DoctrinePart,
    type Targeting,
} from "./doctrine.js";
import type { ForceProvider, World } from "./world.js";
import type { WellSpec } from "./gravity.js";
import type { BeamHits, Beams, SpatialGrid } from "./index.js";
import { MAX_BEAM_LENGTH } from "./beams.js";
import { RayHit } from "./spatialGrid.js";
import { fixed } from "./fixed.js";
import { hullsOverlap, type Contacts } from "./collision.js";
import { FUEL_DENSITY, GunType, interiorVolume, type GunStats, type ModuleKind } from "./modules.js";
import * as shipRobotViews from "./shipRobotViews.js";
import * as shipRobots from "./shipRobots.js";
import * as shipRebuild from "./shipRebuild.js";
import type { Rebuild, StripShape } from "./shipRebuild.js";
import * as shipWeld from "./shipWeld.js";
import * as shipSupply from "./shipSupply.js";
import * as shipBreakup from "./shipBreakup.js";
import * as shipForage from "./shipForage.js";
import * as shipClaw from "./shipClaw.js";
import * as shipDocking from "./shipDocking.js";
import * as shipBuild from "./shipBuild.js";
import * as shipFlight from "./shipFlight.js";

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
export const URGE_REFERENCE = 100;

/** Where a ship is, how it moves and how big it is, as whatever flies or aims at it sees it (`Ships.locate`). */
export interface Spot {
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
}

function spot(): Spot {
    return { x: 0, y: 0, vx: 0, vy: 0, radius: 0 };
}

/**
 * The fastest a craft can be closing and still stop within `gap` metres
 * braking at `brake` m/s², once `delay` seconds have gone by at that speed.
 */
export function stoppingSpeed(brake: number, gap: number, delay: number): number {
    if (!(brake > 0) || !Number.isFinite(delay)) return 0;
    const lag = brake * delay;
    return sqrt(2 * brake * gap + lag * lag) - lag;
}

/**
 * What a pilot asks the helm of its heading, alongside the velocity it wants:
 * to `FACE` the heading it gives; to `STEER`, the helm turning its push onto
 * the change of velocity it needs and resting on that heading otherwise; or to
 * `HURRY`, steering as fast as it can push, pointing before it burns.
 */
export const FACE = 0;
export const STEER = 1;
const TIMER_SETTLE = 1e-9;

/** No order, or an order whose target has gone. */
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
export const SHOCK_REACH = 15;

/**
 * A ship lying against an asteroid at under `REST_SPEED` m/s, where they touch,
 * for `REST_TIME` seconds lodges on it, flown or not: stuck, it would otherwise
 * press on the rock, and flash against it, for good. First guesses.
 */
export const REST_SPEED = 0.25;
export const REST_TIME = 10;

/** Chance a claw takes a sound module in its band. Certain on one spent. */
export const CLAW_GRIP_CHANCE = 0.8;

/** Seconds a claw that missed waits before it tries again. */
export const CLAW_RETRY = 0.5;

/** The most a fighter may be moving against a pad and still land on it, m/s: settling, not arriving. */
export const PAD_SPEED = 1;

/** The most two ports may be closing at and still mate, m/s: a nudge, not a bump. */
export const PORT_SPEED = 1;

/** Which turn a module takes to be mended: cores, then engines and weapons, then the rest. */
/** Less metal than this a robot carries, or a hull holds, is rounding rather than metal, kg. */
export const ROBOT_SPENT = 1e-6;

/** The fighters a carrier's pads keep, by its launch design's `builds`. */
interface Brood {
    /** Each pad's fighters, set out or built, by ship index. */
    readonly fighters: number[][];
    /** Walls each pad has put into the next core it lays, kg. */
    readonly work: Float64Array;
}

/** What a builder's slipways are building (`ShipDesign.yards`). */
interface Yard {
    /** Each slipway's ships, built or being built, by ship index. */
    readonly ships: number[][];
    /** Work each slipway has put into the next step of the ship it builds, J. */
    readonly work: Float64Array;
    /** The ship each slipway is building, by index; -1 for none. */
    readonly building: Int32Array;
    /** How far from its bow that ship is built, metres. */
    readonly depth: Float64Array;
    /** The design of the ship each slipway is building, which a change of craft waits for. */
    readonly craft: (ShipDesign | null)[];
}

export function yardFor(design: ShipDesign): Yard | null {
    const n = design.yards?.length ?? 0;
    if (n === 0) return null;
    return {
        ships: design.yards!.map(() => []),
        work: new Float64Array(n),
        building: new Int32Array(n).fill(-1),
        depth: new Float64Array(n),
        craft: design.yards!.map(() => null),
    };
}

/** The module of its compiled design a hull module is, for what tier rebuilding it falls in. */
export function originTier(approach: Approach, design: ShipDesign, m: number): number {
    const origin = originOf(design, m);
    return repairTier(approach, origin.design, origin.module);
}

/**
 * How soon a module is mended or rebuilt, lowest first: by its doctrine's
 * priority for mending it (`mendCorePriority` and the rest).
 */
export function repairTier(approach: Approach, design: ShipDesign, m: number): number {
    return -priorityOf(approach, mendClaim(design, m));
}

/**
 * What a ship is flown and worked on with: cores, robot bays and the
 * generators that charge its robots, which a refit puts up first and takes
 * down last, so as much of the work goes on as can.
 */
export function workforce(kind: string): boolean {
    return kind === "core" || kind === "robotBay" || kind === "generator";
}

/** Whether body `b` holds less than `share` of a full load of `store` on module `m`'s piece, with room for more. */
export function short(store: Store, b: number, m: number, share: number): boolean {
    const held = store.pieceHeld(b, m);
    const room = store.pieceRoom(b, m);
    return room > 0 && held < share * (held + room);
}

/** A design's engines' exhaust speed, m/s, weighted by their thrust; 0 for one with none. */
const EXHAUST = new WeakMap<ShipDesign, number>();
export function exhaustOf(design: ShipDesign): number {
    const known = EXHAUST.get(design);
    if (known !== undefined) return known;
    let thrust = 0;
    let weighted = 0;
    for (const module of design.modules) {
        thrust += module.stats.thrust;
        weighted += module.stats.thrust * module.stats.exhaustVelocity;
    }
    const exhaust = thrust > 0 ? weighted / thrust : 0;
    EXHAUST.set(design, exhaust);
    return exhaust;
}

/**
 * Seconds a hull that has just come apart must drift before it can hook
 * again. A break leaves both faces torn and touching, and without this the
 * pieces would catch each other again on the next step.
 */
export const WELD_SETTLE = 2;

export const NO_TARGET = -1;

/** World bearing from one point to another. */
function bearing(fromX: number, fromY: number, toX: number, toY: number): number {
    return atan2(toY - fromY, toX - fromX);
}

/** Aiming at a ship rather than at any part of it. */
export const WHOLE_SHIP = -1;
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
    if (kind === "core") return doctrine.coreWeight;
    if (kind === "engine") return doctrine.engineWeight;
    // A tank or a hold is shot at as plating until hitting one does something more.
    if (kind === "structure" || kind === "tank" || kind === "hold") return doctrine.structureWeight;
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
    return doctrine.coreWeight < 0 || doctrine.engineWeight < 0 || doctrine.gunWeight < 0 || doctrine.structureWeight < 0;
}

/** Whether a doctrine has any opinion about which part of a ship to hit. */
function picksParts(doctrine: Targeting): boolean {
    return doctrine.coreWeight !== 0 || doctrine.engineWeight !== 0 || doctrine.gunWeight !== 0 || doctrine.structureWeight !== 0;
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
    /**
     * Fly the claw into the target, arriving inside its band of closing speed,
     * to drink from it. Its doctrine's to give, never an order's.
     */
    grapple: boolean;
    /** Settle onto a friend's pad, to be filled from it. Its doctrine's to give, never an order's. */
    land: boolean;
    /** Bring its own port onto a friend's, face to face, to be filled through it. Doctrine's, never an order's. */
    dock: boolean;
    /**
     * Cover the target, a friend: hold the escort band on it, and fight what is
     * attacking it from there. Never leaves the band to give chase.
     */
    defend?: boolean;
    /**
     * Something to fetch or give rather than a target to fight: `dock` takes on
     * all a friend's pad or port can give it, `scavenge` fills its claw from
     * what it grips, and `deliver` gives a friend all it can spare through its
     * port. `target` is the ship, or `NO_TARGET` for its doctrine to choose, one
     * after another until it is full or has nothing left to give. Ends once a
     * dock or claw named has let go, or there was nothing to take or give.
     */
    errand?: Errand;
    /**
     * Run away rather than fight: from every armed enemy for `NO_TARGET`, from
     * `target` if it is an enemy, or round behind `target` if it is a friend or
     * on no side. Never ends of its own accord (`Ships.flee`).
     */
    flee?: boolean;
    /** Fleeing, `target` is cover to hide behind rather than an enemy to run from: decided when told. */
    hide?: boolean;
    /**
     * Told how far off to hold, metres from the target's skin, over what
     * doctrine says: an attack's standoff, or a defence's station. Without it
     * the band follows doctrine as it changes.
     */
    distance?: number;
    /** Told how fast to close or open the range, m/s, over doctrine's `approachSpeed`. */
    speed?: number;
    /** Whether its band and speed are worked out as it flies, from `distance` and `speed` or doctrine, rather than fixed when given. */
    live?: boolean;
}

/** What an order sends a ship to fetch, rather than to fight. */
export type Errand = "dock" | "scavenge" | "deliver";

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

/**
 * How fast a claw with no robots melts fuel out of the rock it grips, kg/s,
 * and the charge each kilogram takes, J: it heats the rock round the ice too,
 * and keeps none of the ore. First guesses, slower and far dearer than robots.
 */
export const CLAW_HEAT_RATE = 1;
export const CLAW_HEAT_ENERGY = 5e6;

/** A body's mass to divide by: a pinned one's, nought, is no mass at all but one nothing moves. */
export function movable(mass: number): number {
    return mass > 0 ? mass : Infinity;
}

/** A pad's or slipway's lasting name in `design`, for telling it what to keep: its module's key, or its place. */
export function slotKey(design: ShipDesign, module: number): string {
    return design.keys?.[design.modules[module]?.index ?? -1] ?? `#${module}`;
}

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
    /** Which ship it is after its side's name (`nameOf`); its serial when not given. */
    name?: string;
    /** Nothing can hurt it: no damage taken, no weld cut. See `Damage.protect`. */
    invulnerable?: boolean;
    /**
     * A marker rather than a hull: nothing collides with it, nothing it is in
     * front of is shielded by it, and nothing moves it. It can still be seen,
     * escorted and scored against. See `BodySpec.ghost`.
     */
    ghost?: boolean;
    /**
     * The well its kernel rides: the hull is pinned, so nothing moves it, and is
     * put every step where the kernel's middle is on the well, turning as it is
     * spun. Its `x`, `y`, `vx` and `vy` are the well's, and not given.
     */
    rides?: WellSpec;
}

export interface FireReport {
    projectilesFired: number;
    beamsFired: number;
}

export class Ships {
    /** Shared by every ship in the world, since a turret's owner is a body index. */
    readonly turrets: Turrets;

    readonly designs: (ShipDesign | null)[] = [];
    /** What each ship's robots rebuild it to: the design it set out as, or that of the ship it flew off. */
    readonly launched: ShipDesign[] = [];
    /** Each ship's hull matched to its launch design (`rebuildFor`). */
    readonly rebuilds: (Rebuild | null)[] = [];
    /** Shell steps finished this tick, as ship, launch module, the module built from, the one paying and its body if another's, else -1. */
    readonly grows: number[] = [];
    /**
     * What a module of wreckage being taken apart was whole, by the spec of the
     * shell it is now: what each step down is cut from, and the face it goes
     * down towards.
     */
    readonly stripShapes = new WeakMap<ModuleSpec, StripShape>();
    /** A module of wreckage with a step of it taken apart this tick, by body: -1 for none. */
    readonly stripped: number[] = [];
    /** Rock bodies and modules, in pairs, that moored ships' robots have taken a step of this step. */
    readonly rockSteps: number[] = [];
    /**
     * Each ship's own doctrine, as it set out. A ship riding a merged hull shares
     * that hull's design, so its doctrine is read from here rather than from it.
     */
    readonly doctrines: Doctrine[] = [];
    readonly bodyIds: BodyId[] = [];
    /**
     * Body index → the hull that body is built from, for the narrow phase, which
     * knows bodies and not ships. The handle is kept beside the design so that a
     * body destroyed and its slot reused is detected rather than inherited.
     *
     * A hull outlives its ship: a wrecked ship is removed from this store while
     * its body stays in the world (§4), and a wreck's matter still stops a
     * shell, so the entry is left where it is.
     */
    readonly hullDesign: (ShipDesign | null)[] = [];
    readonly hullBody: BodyId[] = [];
    /** The well each pinned hull rides, by body index (`ShipSpec.rides`). */
    readonly rides: (WellSpec | undefined)[] = [];
    /** Every hull that has ridden a well, live or not. */
    private readonly riders: BodyId[] = [];
    bodyStore: Bodies | null = null;

    /** What every ship has taken, by body index. */
    readonly damage = new Damage();
    /** What each body has left in its tanks. */
    readonly fuel = new Fuel();
    readonly metal = new Metal();
    readonly power = new Charge();
    /** Who gets the stores' contents when there is not enough to go round. */
    readonly supply = new Supply([this.fuel, this.metal, this.power]);
    /** The world's step, for `supply`. */
    tick = 0;
    readonly robots = new Robots();
    /** How deep in a spawn this is, so only one asked for from outside is split at its ports. */
    private spawning = 0;

    /**
     * The narrow phase over those hulls, so that a shot lands on a ship's
     * modules rather than on the circle drawn round them.
     *
     * Owned here because this is what knows which body is which ship. Beams are
     * cast through it without the caller having to pass it; a round is cast by
     * `Projectiles.step`, which the caller drives, so that one is handed this.
     */
    readonly hulls = new Hulls(this);
    /** The twisted metal pieces too small to keep become: only drawn, changing nothing (`debris.ts`). */
    readonly debris = new Debris();
    /** Scratch for a module's outline as it is broken up. */
    readonly outline: number[] = [];
    /**
     * The blow that shattered each module this step, by `blowKey`, while it is
     * broken up: its joules, where it struck and the way it drove, in the
     * hull's frame. Empty between steps.
     */
    readonly shatterBlows = new Map<number, readonly number[]>();

    /**
     * The same, for beams and plumes, which get through what they have already
     * burnt holes in. A shell is stopped by matter whatever state it is in; a
     * beam or a flame goes on through a module burnt past breaking at what its
     * holes let by.
     */
    readonly holedHulls = new Hulls(this, this.damage);

    /**
     * Per-ship engine layouts, and the damage version each was built at.
     *
     * A design's layout is shared by every ship built to it, so a damaged ship
     * needs one of its own — rebuilt when its damage changes and not per step,
     * which is what §4's "damage never changes topology" buys: the geometry of
     * what can push is what changed, and mass properties are untouched.
     */
    readonly layouts: (EngineLayout | null)[] = [];
    readonly layoutVersion: number[] = [];
    /** Persistent between steps, per §12: never shared scratch. */
    readonly throttles: Float64Array[] = [];
    /**
     * How much of each of a ship's flame rays landed on something last step,
     * as the ray's `share`: what a renderer draws the burn's glow from, and
     * where it cuts the flame off. Indexed by `landedIndex`.
     */
    readonly landed: Float64Array[] = [];
    /** Scratch for the exhaust pass, so that burning allocates nothing. */
    readonly plumes = new Plumes();
    /**
     * Which engines of the ship being flown this step are burning as weapons.
     * Scratch, written and read inside one `flyOne`, so one array serves every
     * ship however many engines each has.
     */
    forced = new Uint8Array(0);
    // Reused by `attackHeading` for every ship, every step.
    readonly attackArcs = new AttackArcs();
    readonly attackRegion = new AttackRegion();
    /** Which of each ship's engines burned as weapons when it was last flown. */
    readonly lit: Uint8Array[] = [];
    /** Turret store indices owned by each ship, and their gun timers. */
    readonly turretIndex: Int32Array[] = [];
    readonly cooldown: Float64Array[] = [];
    readonly turretStates: Uint8Array[] = [];
    readonly nextBarrelToFire: Int32Array[] = [];
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
    readonly turretTarget: Int32Array[] = [];
    readonly turretRethinkAt: Float64Array[] = [];
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
    readonly turretAiming: Int32Array[] = [];
    /**
     * Which module of its target each mount is shooting at, or -1 for the ship
     * as a whole — which is what a doctrine with no opinion about parts means,
     * since picking a part is picking a smaller thing to miss.
     */
    readonly turretAimModule: Int32Array[] = [];

    readonly team: number[] = [];
    readonly serial: number[] = [];
    readonly names: string[] = [];
    /** Whether a ship has had a piece fly off it this step, flown from a core of its own. */
    readonly parted: number[] = [];
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
    readonly derelict: number[] = [];
    /** Whether each ship set out with a gun or an engine to lose; a piece takes its ship's. */
    readonly couldFight: number[] = [];
    /** 1 for a fighter its doctrine has taken down into the hull layer as well. */
    readonly committed: number[] = [];
    /** Whether each ship has turned its main engines along its want rather than its guns to its target. */
    readonly burning: number[] = [];
    /** Whether each ship is on the run out of an attacking pass or back in, where its guns wait for its mains. */
    readonly running: number[] = [];
    /** Which way round each ship is going on an attack, +1 or -1, or 0 before it has picked. */
    readonly passSide: number[] = [];
    /** Whether each ship's approach is planned on braking with its mains, which it must then turn to do. */
    readonly brakingOnMains: number[] = [];

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
    /** And its angular momentum about the origin, kg·m²/s. */
    discardedL = 0;

    /**
     * Which ship each body is, so a blow landing on a body finds the hull it
     * has to be answered by. Guarded by the handle, since a destroyed body's
     * slot is handed out again.
     */
    readonly shipByBody: number[] = [];
    /**
     * Body index → which ship's computer works each of its modules, where more
     * than one ship rides that body; null where one works all of it. -1 is nobody's.
     *
     * Two ships hooked together are one body flown by both (`Ships.weld`): each
     * keeps its own side, orders and guns, and works only the modules it brought.
     * `shipByBody` is the body's *primary* — the one that answers for its shape.
     */
    readonly pilots: (Int32Array | null)[] = [];
    /**
     * Body index → the side each module came from, for drawing; null where it is
     * all the primary's. A hull that hooked a piece of somebody else's keeps it
     * in that side's colours, as a severed piece does.
     */
    readonly sides: (Int32Array | null)[] = [];
    /**
     * Body index → the name painted on each of its cores, null for any other
     * module. Painted by whoever builds the core and never changed, so it goes
     * with the module wherever the hull takes it.
     */
    readonly paint: ((string | null)[] | null)[] = [];

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
    readonly cutSeen: number[] = [];
    /** The world tick each ship last came apart at, or was broken off at. */
    readonly partedAt: number[] = [];
    /** The world tick each ship's claws last tried to close, so a miss waits `CLAW_RETRY`. */
    readonly clawTried: number[] = [];
    /** Whether each ship's slipways are held up by wreckage caught on what they build, which its robots then clear whatever the room. */
    readonly waitsOnWreck: number[] = [];

    readonly blowBody: number[] = [];
    readonly blowModule: number[] = [];
    readonly blowJx: number[] = [];
    readonly blowJy: number[] = [];
    readonly blowX: number[] = [];
    readonly blowY: number[] = [];
    blows = 0;

    /**
     * Each ship's orders, oldest first: `orders[ship][n]`.
     *
     * A queue rather than a stack, so a ship carries out what it was told in the
     * order it was told, and moves on to the next when one is finished — which
     * is what makes a list of orders a *plan* rather than a pile of
     * interruptions.
     */
    readonly orders: Order[][] = [];

    /**
     * What each ship has decided to fight on its own account, and the step at
     * which it will think about that again.
     *
     * The player's queue outranks this entirely: doctrine is what a ship falls
     * back on when it has been told nothing, so this is consulted only when the
     * queue is empty and is never written into it. An order given is an order
     * obeyed, and a ship that has run out of orders is not left idle.
     */
    readonly chosen: number[] = [];
    /** A fighter's `fightReach` as it landed on a pad, or as the one a pad is building will be. */
    readonly landedReach: number[] = [];
    /** The ship its doctrine has committed it to ramming, or `NO_TARGET`. Kept until that ship is out of the fight. */
    private readonly ramming: number[] = [];
    /** The tick each ship last fired a gun or a beam, or -1. */
    private readonly firedAt: number[] = [];
    /** What each ship has broken off to drink from with its claw, or `NO_TARGET`. */
    readonly salvaging: number[] = [];
    /** The tick each ship next reconsiders whether, and where, to refuel. */
    readonly forageAt: number[] = [];
    /** Whether each ship is refuelling: from running low until its claw's piece is full. */
    readonly refuelling: number[] = [];
    /** Whether each ship is being filled at a friend's port: from running down to `refuelBelow` until it is full. */
    readonly docking: number[] = [];
    /** Whether each ship is taking fuel to a friend: from setting out until it has given what it can spare. */
    readonly delivering: number[] = [];
    /** Whether each ship's doctrine has it withdrawing, to hide or flee (`decide`). */
    private readonly withdrawing: number[] = [];
    /** What each withdrawing ship hides behind, or `NO_TARGET` to flee. */
    private readonly hiding: number[] = [];
    /** Whether each fighter is rearming: from running low on metal until it is full. */
    readonly rearming: number[] = [];
    /** Whether each ship has been docked under the errand it is on, which then ends when the dock lets go. */
    readonly errandDocked: number[] = [];
    /** Each ship's doctrine as its design has it, before anything it has been told over it. */
    readonly ownDoctrines: Doctrine[] = [];
    /** What each ship has been told over its doctrine, or undefined for nothing. */
    readonly overrides: (DoctrineOverride | undefined)[] = [];
    /** Each ship's mounts' doctrines with its override, by mount, for the design they were worked out for. */
    readonly mountDoctrines: ({ design: ShipDesign; byMount: Map<DesignTurret, Targeting> } | null)[] = [];
    /** How many each pad and slipway is told to keep, by its module's lasting key, over its design's count. */
    readonly keeps: (Readonly<Record<string, number>> | undefined)[] = [];
    /** What each pad and slipway is told to build, by its module's lasting key, over its design's craft. */
    readonly crafts: (Readonly<Record<string, ShipDesign>> | undefined)[] = [];
    /** The carrier each fighter last set out from or landed on, or -1. */
    readonly home: number[] = [];
    /** Whether each fighter is recharging: from running its batteries down until they are full. */
    readonly recharging: number[] = [];
    /** The world tick `command` is flying. */
    now = 0;
    /** The tick each ship last touched what it means to drink from without holding it. */
    readonly touchedSource: number[] = [];
    /** The tick each ship began its present rest against an asteroid, and the tick it was last seen resting. */
    readonly restFrom: number[] = [];
    readonly restAt: number[] = [];
    /**
     * Where each claw ship means to take hold (`chooseGrip`): the body, the hull
     * it was chosen on and the module it is on, and the point and the face's
     * outward normal in that hull's frame about its centre of mass, so it turns
     * with the hull. The tick it was chosen, to look again from.
     */
    readonly gripBody: number[] = [];
    readonly gripHull: (ShipDesign | null)[] = [];
    readonly gripModule: number[] = [];
    readonly gripX: number[] = [];
    readonly gripY: number[] = [];
    readonly gripNx: number[] = [];
    readonly gripNy: number[] = [];
    /** How far the jaws may land either side of the grip point and still be on its face, m. */
    readonly gripSlack: number[] = [];
    /** Whether each claw ship is closing straight in on its grip point, rather than making for the gate. */
    readonly gripClosing: number[] = [];
    readonly gripAt: number[] = [];
    /** The heading `squareUp` last asked for. */
    gripHeading = 0;
    /** Each module's outline while a face is chosen, flat, and where each starts in it. */
    readonly gripOutlines: number[] = [];
    readonly gripStarts: number[] = [];
    /** What lies about the source while a face is chosen, flat: where in its frame, and how far off it is kept, middle to middle. */
    readonly gripObstacles: number[] = [];
    /** The points along a face looked at as a grip, metres from its first corner. */
    readonly gripAlongs: number[] = [];
    /** The pad, by module of its ship's design, a fighter is making for to refuel; -1 for none. */
    readonly landingPad: number[] = [];
    /**
     * The carrier each fighter is parked on, or -1. A parked fighter keeps its
     * own body, which shots and beams hit, but is pinned to its pad, meets no
     * other hull, and weighs on the carrier (`park`).
     */
    readonly parkedOn: number[] = [];
    /** The pad it is parked on, by module of its carrier's launch design. */
    readonly parkedPad: number[] = [];
    /** Where its blueprint's origin sits in the pad's frame, and which way it points in it. */
    readonly parkedX: number[] = [];
    readonly parkedY: number[] = [];
    readonly parkedAngle: number[] = [];
    /** Its mass as its carrier last counted it. */
    readonly parkedMass: number[] = [];
    /**
     * For a ship moored to an asteroid by its claw, rather than parked on a pad,
     * the claw, by module of its own hull; -1 for any other. A moored ship is
     * parked with no pad (`parkedPad` -1), posed in its rock's blueprint frame.
     */
    readonly mooredClaw: number[] = [];
    /** Where its claw grips, in the rock's blueprint frame. */
    readonly mooredGripX: number[] = [];
    readonly mooredGripY: number[] = [];
    /** Each asteroid's fastest closing on another this run of touching, m/s, and the last step it touched one. */
    readonly rockMet: number[] = [];
    readonly rockMetAt: number[] = [];
    /** Scratch for drawing: the robots stranded on one rock. */
    readonly strandedHere: Robot[] = [];
    /** Robots left on a rock by a ship no longer moored there, with the side they are on and the ship that left them. */
    readonly stranded: { robot: Robot; team: number; home: number }[] = [];
    /** Scratch for two rocks becoming one: each stranded robot on either, and where it stands, world frame, in threes. */
    readonly rebasingStranded: number[] = [];
    /** Scratch for two rocks becoming one: each moored ship, and where it grips, world frame, in threes. */
    readonly rebasing: number[] = [];
    /** Every fighter parked. */
    readonly parkedShips: number[] = [];
    /** Each carrier's fighters by the pad that keeps them (`ShipDesign.builds`); null for a ship whose pads build none. */
    readonly broods: (Brood | null)[] = [];
    /** Whether each fighter is being built on its pad, from its core laid down until it is whole. */
    readonly unfinished: number[] = [];
    /** Each builder's slipways and what they are building; null for a ship with none that builds. */
    readonly yards: (Yard | null)[] = [];
    /** Whether each ship is still going up on a slipway, its walls not yet all built. */
    readonly printing: number[] = [];
    /** The ship that built each ship on a slipway, while the ship is still clearing it; -1 for none. */
    readonly clearing: number[] = [];
    /** The tick each such ship was let go. */
    readonly clearingSince: number[] = [];
    /** Scratch for a module's outline, measured against a slipway's face. */
    readonly faceCorners: number[] = [];
    /** The tick each carrier last put work into a fighter it is building; -1 for never. */
    readonly builtAt: number[] = [];
    /** Whether each ship has been refitted to a design other than the one it set out as (`refit`). */
    readonly refitting: number[] = [];
    /** The port, by module of its ship's design, a ship is making for to refuel; -1 for none. */
    readonly dockPort: number[] = [];
    /** Which of its own ports it means to mate with it; -1 for none. */
    readonly ownPort: number[] = [];
    /** Where `aroundHull` last said to steer for, world metres. */
    wayX = 0;
    wayY = 0;
    /** The way in `wayIn` last chose, world radians, and where it leaves the carrier's circle, world metres. */
    wayAngle = 0;
    entryX = 0;
    entryY = 0;
    /** The way in to its pad each fighter is taking, in its carrier's frame, and the pad and body it is for; NaN for none. */
    readonly landingWay: number[] = [];
    readonly landingWayPad: number[] = [];
    readonly landingWayBody: number[] = [];
    /**
     * What each ship is covering, which is never what it is fighting: a consort
     * is by definition something it will not shoot at. Chosen on the same
     * schedule as the fight and pulled on every step, since where a craft is
     * relative to its charge changes far faster than which charge it wants.
     */
    private readonly consort: number[] = [];
    /** The blend of steering urges being accumulated for one craft, and the acceleration each wants matched. */
    urgeVx = 0;
    urgeVy = 0;
    urgeAx = 0;
    urgeAy = 0;
    urgeWeight = 0;
    /** What this step's pilot asks the helm of its heading: `FACE`, `STEER` or `HURRY`. */
    intent = FACE;
    /** The most change of velocity this step's pilot lets the helm make without turning for it, m/s (`steerHeading`). */
    steerSlack = STEER_HOLD_SPEED;
    /** Whether this step's pilot has no heading of its own for the helm to rest on, only where it faces now. */
    steerFree = false;
    /** What `pushAbility` last said of how long before a push begins, seconds. */
    pushDelay = 0;
    /**
     * What each ship docking last saw of the point it is docking with: its
     * velocity, the tick it was seen, and its acceleration as worked out from
     * them, settled over `DOCK_ACCEL_SETTLE`.
     */
    readonly dockSeenVx: number[] = [];
    readonly dockSeenVy: number[] = [];
    readonly dockSeenAt: number[] = [];
    readonly dockAx: number[] = [];
    readonly dockAy: number[] = [];
    /** The heaviest dodge in the blend: how much it is wanted, and seconds until the near miss. */
    dodgeWeight = 0;
    dodgeWhen = 0;
    /** Whether that dodge is from a rock. */
    dodgeRock = false;
    /** How far into its band's fade the craft's fight wants it moved, from 0 at rest in the band to 1 outside the fade (`hold`). */
    fightFade = 1;
    /** Where the threats a fleeing craft weighs lie, as a weighted sum of directions to them (`threats`). */
    threatX = 0;
    threatY = 0;
    /** How many things the last `armedShare` counted. */
    tools = 0;
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
    readonly demandFx: number[] = [];
    readonly demandFy: number[] = [];
    readonly demandTorque: number[] = [];
    /**
     * This step's turret recoil on each ship's body, replayed with the wrench.
     * Kept apart and set afresh every step, because the wrench of a ship nobody
     * is flying is held rather than recomputed, and recoil added into it piled up.
     */
    private readonly recoil: number[] = [];
    /** This step's push from fuel leaking out of each ship's body, body frame. */
    readonly leakFx: number[] = [];
    readonly leakFy: number[] = [];
    readonly leakTorque: number[] = [];

    readonly alive: number[] = [];

    readonly allocation = new Allocation();
    private readonly solution = new FiringSolution();
    /**
     * Where a mount sits in the world and how fast that point is moving, filled
     * in place by `locateMount` and read straight away. Persistent rather than
     * built per call, per §12.
     */
    private readonly gunPoint = { x: 0, y: 0, vx: 0, vy: 0 };
    /** Where a part of a target is, for a mount choosing between them. */
    readonly partAt = { x: 0, y: 0 };
    /** What the pilot is fighting, what it is covering, and what it is weighing up. Reused, never shared. */
    readonly fightAt = spot();
    readonly coverAt = spot();
    readonly lookAt = spot();
    private readonly sizeAt = spot();
    /** Where a shot would land, for the friendly check. Reused, never shared. */
    private readonly lineOfFire = new RayHit();
    /** The ships that are asteroids, and a flag by ship, as of step `rocksAt`. */
    private readonly rockShips: number[] = [];
    readonly rockFlag: number[] = [];
    private rocksAt = -1;
    /** How deep the line `blockingRock` last looked along cuts the rock it named, nothing to one. */
    blockDepth = 0;

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

    /**
     * The layers module `m` of ship `i`'s body is in for what it does: the
     * body's, or, on a hull shared with a carrier, a fighter's own on a piece
     * that came aboard a fighter, so it flies over the deck it is sat on.
     */
    private pieceLayers(i: number, b: number, design: ShipDesign, m: number): number {
        const whole = this.layersOf(b);
        if (whole !== OWN_LAYERS) return whole;
        const piece = design.pieces?.[m];
        if (piece === undefined || design.fighterPieces?.includes(piece) !== true) return OWN_LAYERS;
        return this.committed[i] === 1 ? BOTH_LAYERS : WEAPONS_LAYER;
    }

    /** Whether this ship is the first riding its body: the one a hull's own doings are told through. */
    ownsBody(i: number): boolean {
        const bodies = this.bodyStore;
        const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[i]!);
        return b >= 0 && this.shipByBody[b] === i;
    }

    /**
     * The core this ship flies from, or -1: a module of its body's design, so on
     * a shared body it says where on the hull this ship is.
     */
    flownCore(i: number): number {
        const bodies = this.bodyStore;
        const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[i]!);
        if (b < 0) return -1;
        for (const core of this.designs[i]!.cores) if (this.pilotAt(b, core) === i) return core;
        return -1;
    }

    holed(
        bodyIndex: number,
        module: number,
        integrity: number,
        x: number,
        y: number,
        nx: number,
        ny: number,
        calibre: number,
        rng: Rng,
    ): void {
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
            age: 0,
            opened: width,
            liningClosing: lining * SEAL_SPEED,
            liningFloor: max(0, width - lining * SEAL_REACH),
            patched: -1,
            closed: -1,
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
    layoutOf(i: number): EngineLayout {
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
    /** Whether ship `i`'s hull has robots aboard, which may bring it back. */
    private mending(bodies: Bodies, i: number): boolean {
        const b = bodies.indexOf(this.bodyIds[i]!);
        return b >= 0 && (this.robots.on(b)?.length ?? 0) > 0;
    }

    private hulk(i: number): boolean {
        return this.team[i] !== NEUTRAL_TEAM && !this.hasControl(i);
    }

    /** Returns true when the ship has no main weapon left: no sound main gun with a round to load, and no main weapon engine that can burn. */
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
            if (design.turrets[t]!.main && this.canFire(i, b, t)) return false;
        }
        // An engine meant as a weapon is one while it can still burn.
        for (const t of design.mainWeaponEngines) {
            if (this.canBurn(i, b, t)) return false;
        }
        return true;
    }

    /**
     * Whether mount `t` is sound and can shoot once more: a gun with a round on
     * its piece of hull to load, or a beam with the rest of a shot's charge
     * stored there or made there within a cycle. A beam whose generators will
     * get there in the end counts, however long they take.
     */
    private canFire(i: number, b: number, t: number): boolean {
        if (this.isTurretDisabled(i, t)) return false;
        const mount = this.designs[i]!.turrets[t]!;
        const gun = mount.gun;
        if (gun.type === GunType.Projectile) {
            return !(gun.roundMass > 0) || this.metal.pieceHeld(b, mount.module) >= gun.roundMass;
        }
        const timer = this.cooldown[i]![t]!;
        if (!(timer > 0) || !(gun.cycleTime > 0)) return true;
        const rate = this.damage.remaining(b, mount.module, DamageEffect.FireRate);
        const need = (gun.beamPower * gun.beamOnTime * rate * timer) / gun.cycleTime;
        const made = this.power.pieceGeneration(b, mount.module, this.damage) * gun.cycleTime;
        const held = this.power.pieceHeld(b, mount.module);
        if (!(made > 0)) return held >= need;
        return held + this.power.pieceRoom(b, mount.module) + made >= need;
    }

    /** Whether engine `t` is sound and has fuel on its piece of hull to burn. */
    private canBurn(i: number, b: number, t: number): boolean {
        const design = this.designs[i]!;
        const module = design.engines[t]?.module ?? -1;
        if (!(this.left(i, b, module, DamageEffect.Thrust) > 0)) return false;
        // A layout built by hand has no modules, and so nothing to run dry.
        if (!((design.modules[module]?.stats.exhaustVelocity ?? 0) > 0)) return true;
        return this.fuel.fed(b, module, this.damage) > 0;
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

    /** Returns true when this ship has no engine that is sound and fuelled. */
    hasNoEngines(i: number): boolean {
        if (this.alive[i] === 0) return true;
        if (this.derelict[i] === 1) return true;
        // Sound engines nothing is throttling push nothing anywhere.
        if (!this.hasControl(i)) return true;
        const bodies = this.bodyStore;
        const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[i]!);
        if (b < 0) return true;
        const engines = this.designs[i]!.engines;
        for (let t = 0; t < engines.length; t++) {
            if (this.canBurn(i, b, t)) return false;
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

    /**
     * Whether a ship still flown has lost all it had to fight with: disabled,
     * having set out able to shoot or move. One built with neither is not.
     */
    isMissionKilled(i: number): boolean {
        return this.couldFight[i] === 1 && this.hasControl(i) && this.isDisabled(i);
    }

    /** Whether this is a piece of a ship rather than a ship: no pilot, no guns. */
    isDerelict(i: number): boolean {
        return this.derelict[i] === 1;
    }

    /** The design ship `i` is built to, whatever damage has made of it: what it set out as, or was refitted to. */
    blueprint(i: number): ShipDesign {
        return this.launched[i] ?? this.currentStructure(i);
    }

    /** What ship `i` is now, damage and all; what it is built to is its `blueprint`. */
    currentStructure(i: number): ShipDesign {
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
     * Which ship this is, after its side's name: its serial, and for a ship
     * that came of one cut between its cores, that ship's name and the number
     * of the core it is flown from, as "1.2".
     */
    nameOf(i: number): string {
        return this.names[i]!;
    }

    /**
     * The name painted on each of ship `i`'s cores, in its design's core order,
     * into `out`; null for one another ship on its hull works, as a carrier's is
     * to the fighter on its pad.
     */
    coreNames(i: number, out: (string | null)[]): void {
        const design = this.designs[i]!;
        const b = this.bodyStore === null ? -1 : this.bodyStore.indexOf(this.bodyIds[i]!);
        out.length = design.cores.length;
        for (let k = 0; k < design.cores.length; k++) {
            const core = design.cores[k]!;
            out[k] = b >= 0 && !this.ownsAt(i, b, core) ? null : b >= 0 ? this.paintAt(b, core) : this.painted(i, design, core);
        }
    }

    /** Whether each of ship `i`'s cores still flies anything, in its design's core order, into `out`. */
    coresWorking(i: number, out: boolean[]): void {
        const design = this.designs[i]!;
        const b = this.bodyStore === null ? -1 : this.bodyStore.indexOf(this.bodyIds[i]!);
        out.length = design.cores.length;
        for (let k = 0; k < design.cores.length; k++)
            out[k] = b >= 0 && this.damage.remaining(b, design.cores[k]!, DamageEffect.Control) > 0;
    }

    /**
     * The name ship `i` paints on module `m` of `design` as it builds it, if a
     * core: its own, numbered by which core of the design it set out as this is
     * where that design has more than one. Null for any other module.
     */
    painted(i: number, design: ShipDesign, m: number): string | null {
        if (design.modules[m]!.spec.kind !== "core") return null;
        const number = this.launched[i]!.cores.length > 1 ? this.coreNumber(i, design, m) : 0;
        return number > 0 ? `${this.names[i]}.${number}` : this.names[i]!;
    }

    /** The name painted on module `m` of body `b`, or null for anything but a core. */
    paintAt(b: number, m: number): string | null {
        return this.paint[b]?.[m] ?? null;
    }

    /** Which core of ship `i`'s launch design module `m` of `design` is, from one, or nought. */
    private coreNumber(i: number, design: ShipDesign, m: number): number {
        const launch = this.launched[i]!;
        for (let k = 0; k < launch.cores.length; k++) if (sameOrigin(launch, launch.cores[k]!, design, m)) return k + 1;
        return 0;
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
            pinned: spec.rides !== undefined,
        });

        const bodyIdx = world.bodies.indexOf(id);
        this.rides[bodyIdx] = spec.rides;
        if (spec.rides !== undefined) {
            this.riders.push(id);
            this.ride(world.bodies, bodyIdx, design);
        }
        this.bodyStore = world.bodies;
        this.shipByBody[bodyIdx] = this.alive.length;
        this.pilots[bodyIdx] = null;
        this.sides[bodyIdx] = null;
        this.hullDesign[bodyIdx] = design;
        this.hullBody[bodyIdx] = id;
        this.damage.register(bodyIdx, design);
        this.fuel.register(bodyIdx, design);
        this.metal.register(bodyIdx, design);
        this.power.register(bodyIdx, design);
        this.robots.register(bodyIdx, design);
        // Set out with stores part full, it weighs only what it carries.
        if (this.fuel.spentMass(bodyIdx) > 0 || this.metal.spentMass(bodyIdx) > 0) shipBreakup.settleMass(this, world.bodies, bodyIdx);
        if (spec.invulnerable === true) this.damage.protect(bodyIdx);
        const mounts = design.turrets;
        const indices = new Int32Array(mounts.length);
        for (let t = 0; t < mounts.length; t++) {
            indices[t] = this.turrets.add({ ...mounts[t]!.mount, owner: bodyIdx });
        }

        const i = this.alive.length;
        this.designs.push(design);
        this.launched.push(design);
        this.rebuilds.push(null);
        this.doctrines.push(design.doctrine);
        this.bodyIds.push(id);
        this.throttles.push(new Float64Array(design.engines.length));
        this.lit.push(new Uint8Array(design.engines.length));
        this.landed.push(new Float64Array(landedLength(design)));
        this.turretIndex.push(fixed(indices));
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
        this.names.push(spec.name ?? `${serial}`);
        this.paint[bodyIdx] = design.modules.map((_, m) => this.painted(i, design, m));
        this.derelict.push(0);
        this.couldFight.push(design.turrets.some((t) => t.main) || design.engines.length > 0 ? 1 : 0);
        this.committed.push(0);
        this.burning.push(0);
        this.running.push(0);
        this.passSide.push(0);
        this.brakingOnMains.push(0);
        this.cutSeen.push(-1);
        this.partedAt.push(-Infinity);
        this.clawTried.push(-Infinity);
        this.waitsOnWreck.push(0);
        this.chosen.push(NO_TARGET);
        this.landedReach.push(0);
        this.ramming.push(NO_TARGET);
        this.firedAt.push(-1);
        this.salvaging.push(NO_TARGET);
        this.forageAt.push(i);
        this.refuelling.push(0);
        this.docking.push(0);
        this.delivering.push(0);
        this.withdrawing.push(0);
        this.hiding.push(NO_TARGET);
        this.rearming.push(0);
        this.errandDocked.push(0);
        this.ownDoctrines.push(design.doctrine);
        this.overrides.push(undefined);
        this.mountDoctrines.push(null);
        this.keeps.push(undefined);
        this.crafts.push(undefined);
        this.recharging.push(0);
        this.home.push(-1);
        this.touchedSource.push(-Infinity);
        this.restFrom.push(0);
        this.restAt.push(-Infinity);
        this.gripBody.push(-1);
        this.gripHull.push(null);
        this.gripModule.push(-1);
        this.gripX.push(0);
        this.gripY.push(0);
        this.gripNx.push(0);
        this.gripNy.push(0);
        this.gripSlack.push(0);
        this.gripClosing.push(0);
        this.gripAt.push(-Infinity);
        this.landingPad.push(-1);
        this.dockSeenVx.push(0);
        this.dockSeenVy.push(0);
        this.dockSeenAt.push(-Infinity);
        this.dockAx.push(0);
        this.dockAy.push(0);
        this.landingWay.push(NaN);
        this.landingWayPad.push(-1);
        this.landingWayBody.push(-1);
        this.parkedOn.push(-1);
        this.parkedPad.push(-1);
        this.parkedX.push(0);
        this.parkedY.push(0);
        this.parkedAngle.push(0);
        this.parkedMass.push(0);
        this.mooredClaw.push(-1);
        this.rockMet.push(0);
        this.rockMetAt.push(-Infinity);
        this.mooredGripX.push(0);
        this.mooredGripY.push(0);
        const builds = design.builds ?? [];
        this.broods.push(builds.length === 0 ? null : { fighters: builds.map(() => []), work: new Float64Array(builds.length) });
        this.unfinished.push(0);
        this.yards.push(yardFor(design));
        this.printing.push(0);
        this.clearing.push(-1);
        this.clearingSince.push(0);
        this.builtAt.push(-1);
        this.refitting.push(0);
        this.dockPort.push(-1);
        this.ownPort.push(-1);
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
            grapple: false,
            land: false,
            dock: false,
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

        if (spec.ghost !== true) {
            let at = (m: number): number => m;
            if (design.pieces === undefined && this.spawning === 0) {
                this.spawning++;
                at = this.dockAtPorts(world, i);
                this.spawning--;
            }
            for (const aboard of design.aboard ?? []) {
                if (at(aboard.pad) < 0) continue;
                const f = this.launchAboard(world, i, spec, at(aboard.pad), aboard.design);
                // The one it sets out with is one of those it keeps.
                const k = builds.findIndex((build) => build.pad === aboard.pad);
                if (k >= 0) this.broods[i]!.fighters[k]!.push(f);
            }
        }
        return i;
    }

    /**
     * Set a layout out as the ships its cores fly, docked port to port, where
     * the only thing joining them is a pair of ports face to face: so a support
     * ship drawn against its mother ship's side starts docked to it rather than
     * welded, and can let go. A part with no core of its own stays welded.
     */
    private dockAtPorts(world: World, i: number): (m: number) => number {
        const unchanged = (m: number): number => m;
        const design = this.designs[i]!;
        const mated = joints(design).filter(
            (joint) => design.modules[joint.a]!.spec.kind === "port" && design.modules[joint.b]!.spec.kind === "port",
        );
        if (mated.length === 0) return unchanged;
        const groups = components(design, (joint) => mated.includes(joint));
        if (groups.length < 2) return unchanged;
        const cores = new Set(design.cores);
        if (!groups.every((group) => group.some((m) => cores.has(m)))) return unchanged;
        // The group holding the first core goes on as this ship; each other is a ship of its own.
        const main = groups.find((group) => group.includes(design.cores[0]!))!;
        const others: { ship: number; group: number[] }[] = [];
        for (const group of groups) {
            if (group === main) continue;
            const before = this.alive.length;
            if (shipBreakup.detach(this, world, i, design, group)) others.push({ ship: before, group });
        }
        shipBreakup.reshape(this, world, i, design, main);
        // Where each module of the layout ends up in the docked hull: this ship's
        // own first, then each docked ship's after them in turn.
        const where = new Int32Array(design.modules.length).fill(-1);
        main.forEach((m, k) => (where[m] = k));
        for (const { ship, group } of others) {
            const joint = mated.find((j) => (main.includes(j.a) && group.includes(j.b)) || (main.includes(j.b) && group.includes(j.a)));
            if (joint === undefined) continue;
            const mine = main.includes(joint.a) ? joint.a : joint.b;
            const theirs = mine === joint.a ? joint.b : joint.a;
            const offset = this.designs[i]!.modules.length;
            shipWeld.merge(this, world, i, ship, where[mine]!, group.indexOf(theirs), { at: "a", kind: "port" });
            group.forEach((m, k) => (where[m] = offset + k));
        }
        return (m) => where[m]!;
    }

    /**
     * Set a fighter out docked on pad `pad` of ship `i`: lying along the pad, in
     * the middle of it and moving with it, then taken aboard as one that had
     * landed there is.
     */
    private launchAboard(world: World, i: number, spec: ShipSpec, pad: number, fighter: ShipDesign): number {
        const bodies = world.bodies;
        const b = bodies.indexOf(this.bodyIds[i]!);
        const pose = aboardPose(this.designs[i]!, { pad, design: fighter });
        const angle = bodies.angle[b]!;
        const c = cos(angle);
        const s = sin(angle);
        const x = bodies.x[b]! + pose.x * c - pose.y * s;
        const y = bodies.y[b]! + pose.x * s + pose.y * c;
        const heading = angle + pose.angle;
        const spin = bodies.angularVel[b]!;
        const f = this.spawn(world, {
            design: fighter,
            x,
            y,
            angle: heading,
            vx: bodies.vx[b]! - spin * (y - bodies.y[b]!),
            vy: bodies.vy[b]! + spin * (x - bodies.x[b]!),
            angularVel: spin,
            team: spec.team ?? 0,
            ...(spec.invulnerable === true ? { invulnerable: true } : {}),
        });
        this.landedReach[f] = shipSupply.fightReach(this, f);
        shipDocking.park(this, bodies, i, f, pad);
        this.home[f] = i;
        return f;
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
        // Told to defend, it still picks its own fight, from among the friend's attackers.
        const defending = this.defendingOf(i);
        if (this.orders[i]!.length > 0 && defending === NO_TARGET && this.errandOf(i) === undefined) {
            // Being told what to do clears what it had decided for itself, so
            // running out of orders is a fresh look rather than a stale one.
            this.chosen[i] = NO_TARGET;
            this.consort[i] = NO_TARGET;
            this.ramming[i] = NO_TARGET;
            this.salvaging[i] = NO_TARGET;
            this.withdrawing[i] = 0;
            return;
        }
        if (defending !== NO_TARGET) {
            this.ramming[i] = NO_TARGET;
            this.salvaging[i] = NO_TARGET;
        }
        // A ram, once decided, is seen through: no second look at the target, and
        // no consort to break off for.
        const rammed = this.ramming[i]!;
        if (rammed !== NO_TARGET) {
            if (this.alive[rammed] === 1 && this.derelict[rammed] === 0 && this.hasControl(rammed) && !this.isDisabled(i)) {
                this.chosen[i] = rammed;
                this.consort[i] = NO_TARGET;
                return;
            }
            this.ramming[i] = NO_TARGET;
        }
        if (world.tick < this.rethinkAt[i]!) return;

        const design = this.designs[i]!;
        this.rethinkAt[i] = world.tick + this.rethinkTicks(world, design.mass);

        // With no gun or engine that works, it can neither reach a fight nor
        // shoot one, so it stops looking until it is mended or refuelled.
        if (this.isDisabled(i)) {
            this.chosen[i] = NO_TARGET;
            this.consort[i] = NO_TARGET;
            this.withdrawing[i] = 0;
            this.hiding[i] = NO_TARGET;
            return;
        }

        const b = bodies.indexOf(this.bodyIds[i]!);
        if (b < 0) return;

        const doctrine = this.doctrines[i]!.targeting;
        const loyalTo = this.chosen[i]!;

        // What it is fighting. A ship with nothing to shoot with has nothing to
        // choose between — but it may still have somewhere it would rather be,
        // which is why this no longer ends the question.
        let fighting = NO_TARGET;
        // A ship that can ram still has a fight with nothing left to shoot, or
        // nothing to shoot with at all.
        const approach = this.doctrines[i]!.approach;
        const rammer = approach.ramRadii > 0;
        const reach = shipSupply.fightReach(this, i);
        if ((design.reach > 0 && !this.isDisarmed(i)) || (rammer && reach > 0)) {
            const wanted = doctrine.ramMass > 0 && this.wouldRam(bodies, i, b) ? doctrine.ramMass : doctrine.preferredMass;
            // Defending, only what is attacking its charge, while anything is.
            let attackers = false;
            if (defending !== NO_TARGET) {
                for (let t = 0; t < this.alive.length && !attackers; t++) {
                    attackers = this.alive[t] === 1 && this.hostile(i, t) && this.focusOf(t) === defending;
                }
            }
            this.choice.begin();
            this.maskedChoice.begin();
            // Facing is judged along the line to what it is already fighting, not
            // along its nose: turned away to burn, a hull's nose says nothing of
            // what it would rather fight, and judged by it a craft on a pass
            // changed its mind with every turn.
            const lb = loyalTo === NO_TARGET || this.alive[loyalTo] !== 1 ? -1 : bodies.indexOf(this.bodyIds[loyalTo]!);
            const lx = lb < 0 || lb === b ? 0 : bodies.x[lb]! - bodies.x[b]!;
            const ly = lb < 0 || lb === b ? 0 : bodies.y[lb]! - bodies.y[b]!;
            const ll = length(lx, ly);
            for (let t = 0; t < this.alive.length; t++) {
                if (t === i || this.alive[t] === 0) continue;
                if (attackers && this.focusOf(t) !== defending) continue;
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
                let seen = look(bodies, b, tb, t, this.designs[t]!.mass, !this.isDisarmed(t), !this.hasNoEngines(t));
                // Sharing a body, it is as far off as its own modules are.
                const at = this.locate(bodies, t, tb, this.lookAt);
                if (this.sharesBody(t, tb)) seen = { ...seen, range: length(at.x - bodies.x[b]!, at.y - bodies.y[b]!) };
                if (ll > 0 && doctrine.facingWeight !== 0) {
                    const cx = at.x - bodies.x[b]!;
                    const cy = at.y - bodies.y[b]!;
                    const cl = length(cx, cy);
                    seen = { ...seen, facing: cl > 0 ? (cx * lx + cy * ly) / (cl * ll) : 1 };
                }
                // Behind an asteroid, it is gone for only when nothing in sight is there to fight.
                const hidden = this.rockBetween(bodies, bodies.x[b]!, bodies.y[b]!, at.x, at.y, b, tb);
                const candidate =
                    doctrine.sightWeight !== 0 && !inSight(bodies, bodies.x[b]!, bodies.y[b]!, b, tb) ? { ...seen, clear: false } : seen;
                (hidden ? this.maskedChoice : this.choice).offer(
                    candidate,
                    score(doctrine, candidate, reach, design.mass, loyalTo, -1, wanted),
                );
            }
            fighting = this.choice.ship !== NO_TARGET ? this.choice.ship : this.maskedChoice.ship;
        }
        // What it would rather be with. Offered at all only when the doctrine
        // says escorting is worth something, since every weight here may be
        // negative and a consort scored by the ordinary ones would beat a distant
        // enemy on proximity alone — which would have every fleet in the game
        // huddling rather than fighting.
        this.chosen[i] = fighting;
        this.consort[i] = defending;
        if (defending === NO_TARGET && this.withdraws(i, b, fighting)) {
            this.chosen[i] = NO_TARGET;
            this.consort[i] = NO_TARGET;
            this.withdrawing[i] = 1;
            this.hiding[i] = this.coverFor(bodies, i, b);
            return;
        }
        this.withdrawing[i] = 0;
        this.hiding[i] = NO_TARGET;
        if (defending !== NO_TARGET || !(doctrine.escortWeight > 0)) return;

        this.choice.begin();
        for (let t = 0; t < this.alive.length; t++) {
            if (t === i || this.alive[t] === 0) continue;
            // Wreckage is nobody's consort. A live friendly that cannot fight is:
            // a thing worth covering is usually a thing that cannot cover itself.
            // So is a hulk with robots aboard, which may yet mend its core.
            if (this.derelict[t] === 1 || this.hostile(i, t)) continue;
            if (this.hulk(t) && !this.mending(bodies, t)) continue;
            // Nor is a friend too small for it to bother covering. A neutral is an
            // objective rather than a ship to look after, and is gone to whatever
            // its size: a goal is a marker far smaller than anything racing to it.
            if (this.team[t] === this.team[i] && this.designs[t]!.radius < approach.escortMinRadii * design.radius) {
                continue;
            }
            const tb = bodies.indexOf(this.bodyIds[t]!);
            if (tb < 0 || tb === b) continue;
            const candidate = look(bodies, b, tb, t, this.designs[t]!.mass, !this.isDisarmed(t), !this.hasNoEngines(t));
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
    escortBand(i: number, design: ShipDesign, target: number): number {
        const approach = this.doctrines[i]!.approach;
        const theirs = this.sizeOf(target);
        const told = this.getCurrentOrder(i);
        if (told?.defend === true && told.target === target && told.distance !== undefined) return theirs + design.radius + told.distance;
        const wanted = approach.escortRadii * theirs;
        // From skin to skin, for the same reason a standoff is from the target's:
        // keeping station a hundred metres off a thing a kilometre across is a
        // place inside it, and so is a station closer than two hulls the same
        // size can turn without touching.
        const skin = theirs + design.radius;
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
    hostile(i: number, other: number): boolean {
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
            if (held !== NO_TARGET && (this.alive[held] !== 1 || this.derelict[held] === 1 || !this.hasControl(held))) {
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

            if (!(this.left(i, b, mount.module, DamageEffect.FireRate) > 0)) {
                targets[t] = NO_TARGET;
                aims[t] = WHOLE_SHIP;
                continue;
            }

            const ti = indices[t]!;
            const doctrine = this.aimDoctrine(i, mount);

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
                // So does one sharing a body with others, a friend or a rock.
                const shared = !hooked && this.sharesBody(e, tb);
                let tx = bodies.x[tb]!;
                let ty = bodies.y[tb]!;
                if (!hooked && !this.canAimAt(i, mount, hurts, e, tb)) {
                    // A ship with nothing left this mount will shoot at is not a target
                    // for it, however good it looks by every other measure.
                    continue;
                }
                if (hooked || shared) {
                    const part = this.aimModule(bodies, i, mount, layers, e, gunX, gunY, hooked);
                    if (part < 0) continue;
                    this.partPoint(bodies, tb, this.designs[e]!, part);
                    tx = this.partAt.x;
                    ty = this.partAt.y;
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
                const partRange = hooked || shared ? length(tx - gunX, ty - gunY) : 0;
                const candidate =
                    hooked || shared
                        ? {
                              ...seen,
                              range: partRange,
                              closing: hooked ? 0 : seen.closing,
                              facing: partRange > 0 ? (faceX * (tx - gunX) + faceY * (ty - gunY)) / partRange : 1,
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
                    i,
                    mount,
                    e,
                    refusesAnything(doctrine) ? this.aimFor(bodies, i, mount, layers, e, gunX, gunY, hooked) : WHOLE_SHIP,
                );
                // A hooked target is alongside, with nothing between to look past.
                const judged =
                    !hooked && doctrine.sightWeight !== 0 && !inSight(bodies, gunX, gunY, b, tb)
                        ? { ...candidate, clear: false }
                        : candidate;
                // Behind an asteroid is as good as out of its arc: tracked, for when it comes out.
                const open = clear && (hooked || !this.rockBetween(bodies, gunX, gunY, tx, ty, b, tb));
                (candidate.range > against ? this.farChoice : open ? this.choice : this.maskedChoice).offer(
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
            aims[t] = targets[t] === NO_TARGET ? WHOLE_SHIP : this.choosePart(bodies, b, i, mount, layers, targets[t]!, gunX, gunY);
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
        if (part < 0 || hooked || this.sharesBody(target, tb) || refusesAnything(this.aimDoctrine(i, mount))) return part;
        const design = this.designs[target]!;
        this.partPoint(bodies, tb, design, part);
        const range = length(this.partAt.x - gunX, this.partAt.y - gunY);
        if (range <= this.reachFor(i, mount, moduleRadius(design.modules[part]!.spec))) return part;
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
    private reachOn(i: number, mount: DesignTurret, target: number, part: number): number {
        const design = this.designs[target]!;
        const selective = refusesAnything(this.aimDoctrine(i, mount)) && part >= 0 && part < design.modules.length;
        return this.reachFor(i, mount, selective ? moduleRadius(design.modules[part]!.spec) : this.sizeOf(target));
    }

    /** How far a mount will fire at something of this radius, metres. */
    private reachFor(i: number, mount: DesignTurret, radius: number): number {
        return reachAgainst(mount.gun, radius) * this.aimDoctrine(i, mount).fireRange;
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
        i: number,
        mount: DesignTurret,
        layers: number,
        target: number,
        fromX: number,
        fromY: number,
        hooked = false,
    ): number {
        const doctrine = this.aimDoctrine(i, mount);
        // A mount in the hull layer with no opinion about parts shoots at the
        // hull. One in the weapons layer cannot: amidships is usually deck, which
        // its rounds pass over, so it always picks something in the weapons layer. Nor can one
        // hooked to its target, whose hull's middle may be its own.
        const anyPart = !picksParts(doctrine);
        const tb = bodies.indexOf(this.bodyIds[target]!);
        if (tb < 0) return WHOLE_SHIP;
        // Nor one sharing its body with others, whose middle may be theirs.
        if (anyPart && this.meetsWhole(layers, target) && !hooked && !this.sharesBody(target, tb)) return WHOLE_SHIP;
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
        const part = this.aimModule(bodies, i, mount, layers, target, fromX, fromY, hooked);
        if (part !== NOTHING_AIMABLE || !this.firesShellsFrom(i, mount)) return part;
        return this.aimModule(bodies, i, mount, BOTH_LAYERS, target, fromX, fromY, hooked);
    }

    /**
     * Where ship `t`, on body `tb`, is to anything flying or aiming at it, into
     * `out`. Its body's middle and motion and its own radius, unless it shares the
     * body with other ships or rock it has hooked on to: then the middle of the
     * modules it works, moving as that point of the body does, and as big as
     * they reach. Flown at by the body's middle, a ship stuck to an asteroid or
     * a capital is the asteroid or the capital, to be shot at all over.
     */
    locate(bodies: Bodies, t: number, tb: number, out: Spot): Spot {
        const design = this.designs[t]!;
        out.x = bodies.x[tb]!;
        out.y = bodies.y[tb]!;
        out.vx = bodies.vx[tb]!;
        out.vy = bodies.vy[tb]!;
        out.radius = design.radius;
        const pilots = this.pilots[tb];
        if (pilots === null || pilots === undefined) return out;
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (let k = 0; k < design.modules.length; k++) {
            if (pilots[k] !== t || this.damage.spent(tb, k)) continue;
            sx += design.modules[k]!.x;
            sy += design.modules[k]!.y;
            n++;
        }
        if (n === 0) return out;
        const cx = sx / n;
        const cy = sy / n;
        let radius = 0;
        for (let k = 0; k < design.modules.length; k++) {
            if (pilots[k] !== t || this.damage.spent(tb, k)) continue;
            const m = design.modules[k]!;
            radius = max(radius, length(m.x - cx, m.y - cy) + moduleRadius(m.spec));
        }
        const angle = bodies.angle[tb]!;
        const rx = cx * cos(angle) - cy * sin(angle);
        const ry = cx * sin(angle) + cy * cos(angle);
        const spin = bodies.angularVel[tb]!;
        out.x += rx;
        out.y += ry;
        out.vx -= spin * ry;
        out.vy += spin * rx;
        out.radius = radius;
        return out;
    }

    /** How big ship `t` is to anything aiming at it: its own radius, or what `locate` makes of it. */
    private sizeOf(t: number): number {
        const bodies = this.bodyStore;
        const tb = bodies === null ? -1 : bodies.indexOf(this.bodyIds[t]!);
        return tb < 0 || !this.sharesBody(t, tb) ? this.designs[t]!.radius : this.locate(bodies!, t, tb, this.sizeAt).radius;
    }

    /** Whether ship `t` shares body `tb` with another ship or with rock it hooked on to. */
    private sharesBody(t: number, tb: number): boolean {
        const pilots = this.pilots[tb];
        if (pilots === null || pilots === undefined) return false;
        for (let k = 0; k < pilots.length; k++) if (pilots[k] !== t) return true;
        return false;
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
     * own guns working than `ramArmed` says. Guns that are only empty count as
     * working while a friend's pad could fill them.
     */
    private rams(i: number, target: number): boolean {
        const approach = this.doctrines[i]!.approach;
        if (!(approach.ramRadii > 0)) return false;
        const bodies = this.bodyStore;
        if (bodies === null) return false;
        const b = bodies.indexOf(this.bodyIds[i]!);
        const tb = bodies.indexOf(this.bodyIds[target]!);
        if (b < 0 || tb < 0) return false;
        const gap = length(bodies.x[tb]! - bodies.x[b]!, bodies.y[tb]! - bodies.y[b]!) - bodies.radius[tb]!;
        if (gap > approach.ramRadii * bodies.radius[tb]!) return false;
        return this.wouldRam(bodies, i, b);
    }

    /** Whether this ship's doctrine would have it ram whatever came near enough: its guns gone, and no stores to restock them. */
    private wouldRam(bodies: Bodies, i: number, b: number): boolean {
        const approach = this.doctrines[i]!.approach;
        if (!(approach.ramRadii > 0)) return false;
        if (this.armedShare(i, b, true) > approach.ramArmed) return false;
        return this.armedShare(i, b, false) <= approach.ramArmed || !this.canRestock(bodies, i, b);
    }

    /**
     * Whether this ship's doctrine would have it withdraw rather than fight
     * `fighting`: nothing to fight or work with, though a reach of its own, a
     * plume's or a ram's, is something; or no more of it working than
     * `fleeArmed`. Not while it would ram what it is fighting, close enough by
     * `ramRadii`, nor with no armed enemy anywhere to keep clear of.
     */
    private withdraws(i: number, b: number, fighting: number): boolean {
        const approach = this.doctrines[i]!.approach;
        const share = this.armedShare(i, b, false);
        const leaving = this.tools === 0 ? !(shipSupply.fightReach(this, i) > 0) : share <= approach.fleeArmed;
        if (!leaving) return false;
        if (fighting !== NO_TARGET && this.rams(i, fighting)) return false;
        for (let e = 0; e < this.alive.length; e++) if (this.hostile(i, e) && shipFlight.armed(this, e)) return true;
        return false;
    }

    /**
     * Cover for withdrawing ship `i` to hide behind: what it hides behind
     * already while that still serves, or the nearest friend or body on no
     * side, a wreck included, within `hideRange` of its radii, at least
     * `hideSize` of its radius, and no armed enemy's reach on it. `NO_TARGET`
     * for none, to flee instead.
     */
    private coverFor(bodies: Bodies, i: number, b: number): number {
        const approach = this.doctrines[i]!.approach;
        const mine = this.designs[i]!.radius;
        const range = approach.hideRange * mine;
        if (!(range > 0)) return NO_TARGET;
        const serves = (t: number): number => {
            if (t === i || this.alive[t] !== 1 || (this.derelict[t] === 0 && this.hostile(i, t))) return -1;
            const tb = bodies.indexOf(this.bodyIds[t]!);
            if (tb < 0 || tb === b || bodies.ghost[tb] === 1 || bodies.radius[tb]! < approach.hideSize * mine) return -1;
            const d = length(bodies.x[tb]! - bodies.x[b]!, bodies.y[tb]! - bodies.y[b]!);
            if (d > range || shipForage.dangerNear(this, bodies, i, tb) > 0) return -1;
            return d;
        };
        const held = this.hiding[i]!;
        if (held !== NO_TARGET && serves(held) >= 0) return held;
        let best = NO_TARGET;
        let nearest = Infinity;
        for (let t = 0; t < this.alive.length; t++) {
            const d = serves(t);
            if (d >= 0 && d < nearest) {
                nearest = d;
                best = t;
            }
        }
        return best;
    }

    /**
     * The share of what this ship fights or works with that still works, none
     * for a ship with nothing: its main mounts, with `stores` only those with a
     * shot to fire; its claws while doctrine has it out scavenging, and its
     * ports while delivering, wanted whether or not they work. How many there
     * are is left in `tools`.
     */
    armedShare(i: number, b: number, stores: boolean): number {
        const design = this.designs[i]!;
        const turrets = design.turrets;
        let mounts = 0;
        let working = 0;
        for (let t = 0; t < turrets.length; t++) {
            if (!turrets[t]!.main) continue;
            mounts++;
            if (stores ? this.canFire(i, b, t) : !this.isTurretDisabled(i, t)) working++;
        }
        const trip = this.orders[i]!.length === 0 && this.salvaging[i] !== NO_TARGET;
        const wanted = !trip ? "" : this.delivering[i] === 1 ? "port" : this.landingPad[i]! < 0 && this.dockPort[i]! < 0 ? "claw" : "";
        if (wanted !== "") {
            for (let m = 0; m < design.modules.length; m++) {
                if (design.modules[m]!.spec.kind !== wanted || !this.ownsAt(i, b, m)) continue;
                mounts++;
                if (this.left(i, b, m, DamageEffect.Grip) > 0) working++;
            }
        }
        this.tools = mounts;
        return mounts === 0 ? 0 : working / mounts;
    }

    /**
     * Whether a friend has a pad this ship would land on for the metal or charge
     * it has room for, as `forage` would send it. Taken or not: a pad in use is
     * a wait, not a dead end.
     */
    private canRestock(bodies: Bodies, i: number, b: number): boolean {
        const design = this.designs[i]!;
        const approach = this.doctrines[i]!.approach;
        if (!design.fighter || !(approach.approachSpeed > 0)) return false;
        if (approach.scavengeFuelBelow > 0 && shipClaw.workingClaw(this, i, b) >= 0) return false;
        const own = design.cores[0] ?? 0;
        const metalRoom = approach.rearmBelow >= 0 ? this.metal.pieceRoom(b, own) : 0;
        const chargeRoom = approach.rechargeBelow > 0 ? this.power.pieceRoom(b, own) : 0;
        if (!(metalRoom > 0 || chargeRoom > 0)) return false;
        const box = footprintOf(design);
        for (let t = 0; t < this.alive.length; t++) {
            if (t === i || this.alive[t] === 0 || this.derelict[t] === 1) continue;
            if (this.team[t] !== this.team[i] || this.hostile(i, t)) continue;
            const tb = bodies.indexOf(this.bodyIds[t]!);
            if (tb < 0 || tb === b) continue;
            const modules = this.designs[t]!.modules;
            for (let pad = 0; pad < modules.length; pad++) {
                if (modules[pad]!.spec.kind !== "pad" || !(modules[pad]!.stats.pumpRate > 0)) continue;
                if (!this.fitsPad(box, modules[pad]!.spec) || !(this.left(t, tb, pad, DamageEffect.Grip) > 0)) continue;
                if (metalRoom > 0 && this.metal.pieceHeld(tb, pad) > shipSupply.metalReserve(this, tb, pad)) return true;
                if (chargeRoom > 0 && this.power.pieceHeld(tb, pad) > shipSupply.chargeReserve(this, tb, pad)) return true;
            }
        }
        return false;
    }

    /** Whether a ship of footprint `box` fits on `pad`, either way round. */
    fitsPad(box: Footprint, pad: ModuleSpec): boolean {
        const long = box.maxX - box.minX;
        const wide = box.maxY - box.minY;
        return (long <= pad.length && wide <= pad.width) || (long <= pad.width && wide <= pad.length);
    }

    /**
     * Whether a fighter takes the hull layer as well: whenever it is grappling,
     * or ramming — by its doctrine's decision or by order — and due to strike
     * within `ramCommit` seconds. Until then it flies the ram in the weapons
     * layer, where the hulls it passes on the way are no obstacle.
     *
     * Only while clear of every hull, in either direction (DESIGN.md §3), so a
     * fighter cannot drop into a capital's structure or climb back out of one it
     * has struck. Clear of its modules rather than its bounding circle, so a
     * fighter alongside a long hull can still commit.
     */
    private commitOne(bodies: Bodies, i: number): void {
        if (!this.designs[i]!.fighter) return;
        // Spent on the way in, it has given up its ram but is still armed: it coasts on into what it was aimed at.
        if (this.committed[i] === 1 && this.isDisabled(i)) return;
        const b = bodies.indexOf(this.bodyIds[i]!);
        if (b < 0) return;
        const order = this.effectiveOrder(i);
        // Parked, it meets nothing of its carrier, so would look clear on the pad and drop into its hull when let go.
        const ramming = order !== undefined && order.target !== NO_TARGET && (order.ram || order.grapple) && this.parkedOn[i]! < 0;
        const want = ramming && (order.grapple || this.strikesWithin(bodies, i, b, order.target)) ? 1 : 0;
        if (want === this.committed[i] || !this.clearOfHulls(bodies, b)) return;
        this.committed[i] = want;
    }

    /** Whether ship `i`, on body `b`, will reach `target`'s bounding circle within its doctrine's `ramCommit` seconds, or has. */
    private strikesWithin(bodies: Bodies, i: number, b: number, target: number): boolean {
        const tb = bodies.indexOf(this.bodyIds[target]!);
        if (tb < 0) return false;
        const dx = bodies.x[tb]! - bodies.x[b]!;
        const dy = bodies.y[tb]! - bodies.y[b]!;
        const range = length(dx, dy);
        const gap = range - bodies.radius[tb]! - bodies.radius[b]!;
        if (!(gap > 0)) return true;
        const closing = ((bodies.vx[b]! - bodies.vx[tb]!) * dx + (bodies.vy[b]! - bodies.vy[tb]!) * dy) / range;
        return gap <= closing * this.doctrines[i]!.approach.ramCommit;
    }

    /** Whether no module of this body overlaps any other hull's. */
    private clearOfHulls(bodies: Bodies, b: number): boolean {
        const own = this.designOf(b);
        if (own === null) return true;
        for (let j = 0; j < bodies.highWater; j++) {
            if (j === b || bodies.alive[j] === 0 || bodies.ghost[j] === 1 || !this.meets(b, j)) continue;
            const other = this.designOf(j);
            if (other !== null && hullsOverlap(bodies, b, own, j, other)) return false;
        }
        return true;
    }

    /** The tick ship `i` last fired a gun or a beam, or -1 if it never has. */
    lastFired(i: number): number {
        return this.firedAt[i]!;
    }

    /** Whether ship `i`'s doctrine has committed it to ramming something. */
    isRamming(i: number): boolean {
        return this.ramming[i] !== NO_TARGET;
    }

    /** The ship ship `i` is ramming, or `NO_TARGET`. */
    ramTarget(i: number): number {
        return this.ramming[i] ?? NO_TARGET;
    }

    /** Centre to centre between two ships, m; infinite if either has no body. */
    distanceBetween(i: number, j: number): number {
        const bodies = this.bodyStore;
        if (bodies === null) return Infinity;
        const a = bodies.indexOf(this.bodyIds[i]!);
        const b = bodies.indexOf(this.bodyIds[j]!);
        if (a < 0 || b < 0) return Infinity;
        return length(bodies.x[b]! - bodies.x[a]!, bodies.y[b]! - bodies.y[a]!);
    }

    /** Centre to centre from ship `i` to the nearest hostile ship anyone controls, m; infinite if there is none. */
    nearestEnemy(i: number): number {
        let nearest = Infinity;
        for (let e = 0; e < this.alive.length; e++) {
            if (e === i || this.alive[e] === 0 || this.derelict[e] === 1 || !this.hostile(i, e) || !this.hasControl(e)) continue;
            const d = this.distanceBetween(i, e);
            if (d < nearest) nearest = d;
        }
        return nearest;
    }

    /** Whether this fighter has dropped into the hull layer as well. */
    isCommitted(i: number): boolean {
        return this.committed[i] === 1;
    }

    /** The layers every module of this ship is in, or `OWN_LAYERS`: a fighter's, by whether it has committed. */
    shipLayers(i: number): number {
        if (!this.designs[i]!.fighter) return OWN_LAYERS;
        return this.committed[i] === 1 ? BOTH_LAYERS : WEAPONS_LAYER;
    }

    /** The layers this mount's shots fly in: a fighter's guns fire in whatever it occupies. */
    private mountLayers(i: number, mount: DesignTurret): number {
        const whole = this.shipLayers(i);
        if (whole !== OWN_LAYERS) return whole;
        if (!mount.hullLayer) return WEAPONS_LAYER;
        // A thick hull beam stands in both, and fires a beam in each.
        return mount.gun.type === GunType.Beam && this.designs[i]!.modules[mount.module]!.weaponsLayer ? BOTH_LAYERS : HULL_LAYER;
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
    private canAimAt(i: number, mount: DesignTurret, layers: number, target: number, tb: number): boolean {
        const doctrine = this.aimDoctrine(i, mount);
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

    /**
     * What ship `i` is doing, told or of its own accord, and to which ship: an
     * errand or a trip doctrine sent it on, a ram, a fight on a friend's behalf,
     * or an attack. Null for nothing.
     */
    doingOf(i: number): { kind: "attack" | "defend" | "ram" | "flee" | "hide" | Errand; target: number } | null {
        const given = this.getCurrentOrder(i);
        if (given?.flee === true) {
            const from = shipFlight.fleeTarget(this, given);
            return from === NO_TARGET ? null : { kind: given.hide === true ? "hide" : "flee", target: from };
        }
        if (given?.errand !== undefined) {
            const target = this.errandTarget(i);
            return target === NO_TARGET ? null : { kind: given.errand, target };
        }
        const source = this.salvaging[i]!;
        if (given === undefined && source !== NO_TARGET && this.alive[source] === 1) {
            const kind = this.delivering[i] === 1 ? "deliver" : this.landingPad[i]! >= 0 || this.dockPort[i]! >= 0 ? "dock" : "scavenge";
            return { kind, target: source };
        }
        if (given === undefined && this.withdrawing[i] === 1) {
            const cover = this.hiding[i]!;
            return cover !== NO_TARGET && this.alive[cover] === 1 ? { kind: "hide", target: cover } : null;
        }
        const target = this.focusOf(i);
        if (target === NO_TARGET || this.alive[target] !== 1) return null;
        if (given?.ram === true || (given === undefined && this.ramming[i] === target)) return { kind: "ram", target };
        return { kind: this.defendingOf(i) !== NO_TARGET ? "defend" : "attack", target };
    }

    /** What this ship is staying with as an escort, as `cover` flies it; `NO_TARGET` for nothing, or for a ship out of control. */
    coveringOf(i: number): number {
        const bodies = this.bodyStore;
        if (bodies === null || this.alive[i] !== 1 || !this.hasControl(i)) return NO_TARGET;
        return this.liveConsort(bodies, i, bodies.indexOf(this.bodyIds[i]!));
    }

    /** How far from `consort` ship `i` stays as its escort, centre to centre, metres. */
    coverBandOf(i: number, consort: number): number {
        return this.escortBand(i, this.designs[i]!, consort);
    }

    /** Ship `i`'s consort while it is one worth staying with: alive, not a hulk left to itself, and on a body of its own. */
    liveConsort(bodies: Bodies, i: number, b: number): number {
        const consort = this.consort[i] ?? NO_TARGET;
        if (consort === NO_TARGET || this.alive[consort] !== 1) return NO_TARGET;
        if (this.hulk(consort) && !this.mending(bodies, consort)) return NO_TARGET;
        const cb = bodies.indexOf(this.bodyIds[consort]!);
        return cb < 0 || cb === b ? NO_TARGET : consort;
    }

    /**
     * The order whose band of ranges ship `i` is holding against what it is
     * fighting, or undefined: for nothing, or for an order that closes to touch
     * — a ram, a grip, a landing or a dock — rather than to a range.
     */
    heldOrder(i: number): Readonly<Order> | undefined {
        const standing = this.standing[i];
        const order = this.getCurrentOrder(i) ?? (standing !== undefined && standing.target === this.chosenOf(i) ? standing : undefined);
        if (order === undefined || order.target === NO_TARGET) return undefined;
        if (
            order.ram ||
            order.grapple ||
            order.land ||
            order.dock ||
            order.defend === true ||
            order.errand !== undefined ||
            order.flee === true
        ) {
            return undefined;
        }
        if (!(order.maxRange > 0)) return undefined;
        return order;
    }

    private focusOf(i: number): number {
        const given = this.getCurrentOrder(i);
        if (given !== undefined && given.defend !== true && given.errand === undefined && given.flee !== true) return given.target;
        return this.chosenOf(i);
    }

    /** A mount's doctrine on ship `i`, with what the ship has been told over it. */
    private aimDoctrine(i: number, mount: DesignTurret): Targeting {
        const override = this.overrides[i];
        if (override === undefined) return mount.targeting;
        const design = this.designs[i]!;
        let cached = this.mountDoctrines[i];
        if (cached === null || cached === undefined || cached.design !== design) {
            cached = { design, byMount: new Map() };
            this.mountDoctrines[i] = cached;
        }
        let resolved = cached.byMount.get(mount);
        if (resolved === undefined) {
            const placement = placementOf(design.keys?.[design.modules[mount.module]?.index ?? -1]);
            resolved = overriddenMount(mount.targeting, mount.main, placement, override);
            cached.byMount.set(mount, resolved);
        }
        return resolved;
    }

    /** The doctrine mount `t` of ship `i` goes by, with what the ship has been told over it. */
    mountDoctrineOf(i: number, t: number): Targeting {
        return this.aimDoctrine(i, this.designs[i]!.turrets[t]!);
    }

    /** What ship `i` has been told over its doctrine, or undefined for nothing. */
    overrideOf(i: number): DoctrineOverride | undefined {
        return this.overrides[i];
    }

    /** Ship `i`'s doctrine, with what it has been told over it. */
    doctrineOf(i: number): Doctrine {
        return this.doctrines[i]!;
    }

    /** Tell one field of one part of ship `i`'s doctrine, or with `null` take it back to its design's. */
    setDoctrine(i: number, part: DoctrinePart, field: string, value: number | null): void {
        this.override(i, withOverride(this.overrides[i], part, field, value));
    }

    /** Take one part of ship `i`'s doctrine, or with `undefined` all of it, back to its design's. */
    resetDoctrine(i: number, part: DoctrinePart | undefined): void {
        this.override(i, withoutPart(this.overrides[i], part));
    }

    private override(i: number, next: DoctrineOverride | undefined): void {
        if (this.alive[i] !== 1) return;
        this.overrides[i] = next;
        this.doctrines[i] = overriddenDoctrine(this.ownDoctrines[i]!, next);
        this.mountDoctrines[i] = null;
        // A fresh look with what it now goes by, rather than at its next rethink.
        this.rethinkAt[i] = 0;
    }

    /**
     * Tell the pad or slipway of ship `i` with lasting key `slot` (`slotKey`) how
     * many of what it builds to keep in the fight, or with `null` go back to its
     * design's count.
     */
    setKeep(i: number, slot: string, keep: number | null): void {
        if (this.alive[i] !== 1) return;
        const next: Record<string, number> = { ...this.keeps[i] };
        if (keep === null) delete next[slot];
        else next[slot] = max(0, floor(keep));
        this.keeps[i] = Object.keys(next).length === 0 ? undefined : next;
    }

    /** How many ship `i`'s pad or slipway `module`, of the design it was launched as, keeps: told, or its design's `keep`. */
    keepFor(i: number, module: number, keep: number): number {
        const told = this.keeps[i];
        if (told === undefined) return keep;
        return told[slotKey(this.launched[i]!, module)] ?? keep;
    }

    /**
     * Tell the pad or slipway of ship `i` with lasting key `slot` to build
     * `craft` from now on, or with `null` its design's craft. False, and nothing
     * changed, for no such slot or a craft it could not build: a pad builds a
     * fighter that fits on it, a slipway a ship no wider than it is.
     */
    setCraft(i: number, slot: string, craft: ShipDesign | null): boolean {
        const launched = this.launched[i];
        if (this.alive[i] !== 1 || launched === undefined) return false;
        const pad = launched.builds?.find((order) => slotKey(launched, order.pad) === slot);
        const yard = launched.yards?.find((order) => slotKey(launched, order.slipway) === slot);
        if (pad === undefined && yard === undefined) return false;
        if (craft !== null) {
            const at = launched.modules[pad?.pad ?? yard!.slipway]!.spec;
            const fits =
                pad !== undefined
                    ? craft.fighter && padHolds(craft, at)
                    : !craft.fighter && (craft.aboard?.length ?? 0) === 0 && slipwayHolds(craft, at);
            if (!fits) return false;
        }
        const next: Record<string, ShipDesign> = { ...this.crafts[i] };
        if (craft === null) delete next[slot];
        else next[slot] = craft;
        this.crafts[i] = Object.keys(next).length === 0 ? undefined : next;
        return true;
    }

    /** What ship `i`'s pad or slipway `module`, of the design it was launched as, builds: told, or its design's. */
    craftFor(i: number, module: number, craft: ShipDesign): ShipDesign {
        const told = this.crafts[i];
        if (told === undefined) return craft;
        return told[slotKey(this.launched[i]!, module)] ?? craft;
    }

    /** What ship `i`'s pads and slipways have been told to build, by `slotKey`. */
    craftsOf(i: number): Readonly<Record<string, ShipDesign>> | undefined {
        return this.crafts[i];
    }

    /** What ship `i`'s pads and slipways have been told to keep, by `slotKey`. */
    keepsOf(i: number): Readonly<Record<string, number>> | undefined {
        return this.keeps[i];
    }

    /** Whether this ship's doctrine has it withdrawing, to hide or flee, rather than fighting. */
    isWithdrawing(i: number): boolean {
        return this.withdrawing[i] === 1 && this.orders[i]!.length === 0 && this.salvaging[i] === NO_TARGET;
    }

    /** The errand this ship is ordered on, if its current order is one. */
    errandOf(i: number): Errand | undefined {
        return this.getCurrentOrder(i)?.errand;
    }

    /** Where ship `i`'s errand is taking it: the friend it was told, or the one its doctrine chose; `NO_TARGET` for none yet. */
    errandTarget(i: number): number {
        const given = this.getCurrentOrder(i);
        if (given?.errand === undefined) return NO_TARGET;
        if (given.target !== NO_TARGET) return given.target;
        const source = this.salvaging[i]!;
        return source !== NO_TARGET && this.alive[source] === 1 ? source : NO_TARGET;
    }

    /** Whether ship `i` has an order other than an errand, which a dock lets go of it for. */
    commanded(i: number): boolean {
        const given = this.getCurrentOrder(i);
        return given !== undefined && given.errand === undefined;
    }

    /** Whether moored ship `i` has been told to go: an order, or an errand to anything but the rock it is moored to. */
    sentAway(i: number): boolean {
        const given = this.getCurrentOrder(i);
        return given !== undefined && (given.errand === undefined || given.target !== this.parkedOn[i]);
    }

    /** Whether ship `i` was told where to go on its errand, so armed enemies near it are not to put it off. */
    sentTo(i: number): boolean {
        const given = this.getCurrentOrder(i);
        return given?.errand !== undefined && given.target !== NO_TARGET;
    }

    /** The friend this ship is ordered to defend, or `NO_TARGET`. */
    defendingOf(i: number): number {
        const given = this.getCurrentOrder(i);
        return given !== undefined && given.defend === true ? given.target : NO_TARGET;
    }

    /** What this ship's doctrine chose to fight, orders aside; `NO_TARGET` for nothing. */
    chosenOf(i: number): number {
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
        const current = this.designs[i]!.turrets[t]!.main ? this.getCurrentOrder(i) : undefined;
        // A friend to defend, fetch from or hide behind is not a target.
        const given = current?.defend === true || current?.errand !== undefined || current?.flee === true ? undefined : current;
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
        // Out to the target, though, when a friend may be hooked to it: then it is no passer-by.
        const tb = target === NO_TARGET ? -1 : bodies.indexOf(this.bodyIds[target]!);
        const shared = tb >= 0 && this.sharesBody(target, tb);
        const lookahead = gun.type === GunType.Beam ? MAX_BEAM_LENGTH : shared ? reach : gun.muzzleSpeed * FRIENDLY_LOOKAHEAD;
        const range = lookahead < reach ? lookahead : reach;
        if (!(range > 0)) return false;
        const hit = this.lineOfFire;
        // A friend is only in the way of what it would stop.
        this.hulls.castFrom(layers, -1, -1);
        const dx = this.solution.dirX * range;
        const dy = this.solution.dirY * range;
        const found = grid.raycast(
            bodies,
            this.solution.x,
            this.solution.y,
            this.solution.x + dx,
            this.solution.y + dy,
            hit,
            bodyIdx,
            this.hulls,
        );
        // Whose module it meets, not whose body: a friend hooked to the target is still in the way, and the target is not.
        const module =
            found && this.hulls.describe(bodies, hit.bodyIndex, this.solution.x, this.solution.y, dx, dy) ? this.hulls.module : -1;
        this.hulls.reset();
        if (!found) return false;
        const pilots = this.pilots[hit.bodyIndex];
        const other = module >= 0 && pilots !== null && pilots !== undefined ? pilots[module]! : this.shipAt(bodies, hit.bodyIndex);
        if (other < 0 || other === i || other === target || this.alive[other] !== 1) return false;
        return this.derelict[other] === 0 && !this.hostile(i, other);
    }

    /**
     * Whether an asteroid is across this shot, short of `target`: the line the
     * round leaves on, out to the target's range. Checked against every rock's
     * bounding circle rather than by a cast, because there are few of them and
     * a shot is wasted on one however far down the line it is.
     */
    private rockInTheWay(bodies: Bodies, bodyIdx: number, target: number): boolean {
        const tb = bodies.indexOf(this.bodyIds[target]!);
        if (tb < 0) return false;
        const x = this.solution.x;
        const y = this.solution.y;
        const range = length(bodies.x[tb]! - x, bodies.y[tb]! - y);
        return this.rockBetween(bodies, x, y, x + this.solution.dirX * range, y + this.solution.dirY * range, bodyIdx, tb);
    }

    /**
     * Whether an asteroid's bounding circle crosses the line from (`fromX`,
     * `fromY`) to (`toX`, `toY`). Never body `own` or `to`, which a ship moored
     * to a rock or a target clinging to one share, nor a rock the line starts
     * inside, which says nothing about which way is blocked.
     */
    private rockBetween(bodies: Bodies, fromX: number, fromY: number, toX: number, toY: number, own: number, to: number): boolean {
        return this.blockingRock(bodies, fromX, fromY, toX, toY, own, to) >= 0;
    }

    /**
     * `rockBetween`, naming the rock whose circle the line cuts deepest, or -1,
     * and leaving how deep in `blockDepth`: one through its middle, nothing at a graze.
     */
    blockingRock(bodies: Bodies, fromX: number, fromY: number, toX: number, toY: number, own: number, to: number): number {
        this.blockDepth = 0;
        const dx = toX - fromX;
        const dy = toY - fromY;
        const lengthSq = dx * dx + dy * dy;
        if (!(lengthSq > 0)) return -1;
        let deepest = -1;
        for (let k = 0; k < this.rockShips.length; k++) {
            const rock = this.rockShips[k]!;
            if (this.alive[rock] === 0) continue;
            const rb = bodies.indexOf(this.bodyIds[rock]!);
            if (rb < 0 || rb === own || rb === to || bodies.ghost[rb] === 1) continue;
            const ox = bodies.x[rb]! - fromX;
            const oy = bodies.y[rb]! - fromY;
            const r = bodies.radius[rb]!;
            if (ox * ox + oy * oy < r * r) continue;
            const along = (ox * dx + oy * dy) / lengthSq;
            if (along <= 0 || along >= 1) continue;
            const px = ox - along * dx;
            const py = oy - along * dy;
            const depth = 1 - sqrt(px * px + py * py) / r;
            if (depth > this.blockDepth) {
                this.blockDepth = depth;
                deepest = rock;
            }
        }
        return deepest;
    }

    /**
     * Whether a hull on ship `i`'s side, under control, lies across the line from
     * its body `b` to (`toX`, `toY`), within its own radius of that hull's circle.
     * Never body `to`, nor a fighter, which will be elsewhere by the time it gets there.
     */
    friendBetween(bodies: Bodies, i: number, b: number, toX: number, toY: number, to: number): boolean {
        const fromX = bodies.x[b]!;
        const fromY = bodies.y[b]!;
        const dx = toX - fromX;
        const dy = toY - fromY;
        const lengthSq = dx * dx + dy * dy;
        if (!(lengthSq > 0)) return false;
        const mine = this.designs[i]!.radius;
        for (let t = 0; t < this.alive.length; t++) {
            if (t === i || this.alive[t] !== 1 || this.team[t] !== this.team[i] || this.designs[t]!.fighter || !this.hasControl(t))
                continue;
            const ob = bodies.indexOf(this.bodyIds[t]!);
            if (ob < 0 || ob === b || ob === to || bodies.ghost[ob] === 1) continue;
            const ox = bodies.x[ob]! - fromX;
            const oy = bodies.y[ob]! - fromY;
            const along = (ox * dx + oy * dy) / lengthSq;
            if (along <= 0 || along >= 1) continue;
            const r = bodies.radius[ob]! + mine;
            const px = ox - along * dx;
            const py = oy - along * dy;
            if (px * px + py * py < r * r) return true;
        }
        return false;
    }

    /** Note which ships are asteroids, once a step: there are few, and every pilot and gun asks. */
    private noteRocks(tick: number): void {
        if (this.rocksAt === tick) return;
        this.rocksAt = tick;
        this.rockShips.length = 0;
        for (let t = 0; t < this.alive.length; t++) {
            const rock = this.alive[t] !== 0 && this.isAsteroid(t);
            this.rockFlag[t] = rock ? 1 : 0;
            if (rock) this.rockShips.push(t);
        }
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
    rethinkTicks(world: World, mass: number): number {
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
    effectiveOrder(i: number): Order | undefined {
        const given = this.getCurrentOrder(i);
        // Defending is covering, which the pilot flies as a consort rather than as a station.
        if (given?.defend === true) return undefined;
        // An errand is flown as doctrine's own trips to a dock are.
        if (given !== undefined && given.errand === undefined) {
            if (given.flee !== true) this.liveBand(i, given);
            return given;
        }

        const design = this.designs[i]!;
        const approach = this.doctrines[i]!.approach;
        const standing = this.standing[i]!;
        const source = this.salvaging[i]!;
        if (source !== NO_TARGET && this.alive[source] === 1) {
            standing.target = source;
            standing.minRange = 0;
            standing.maxRange = 0;
            standing.ram = false;
            standing.grapple = this.landingPad[i]! < 0 && this.dockPort[i]! < 0;
            standing.land = this.landingPad[i]! >= 0;
            standing.dock = this.dockPort[i]! >= 0;
            standing.flee = false;
            standing.hide = false;
            standing.approachSpeed = approach.approachSpeed;
            return standing;
        }
        standing.grapple = false;
        standing.land = false;
        standing.dock = false;
        standing.flee = false;
        standing.hide = false;

        if (this.withdrawing[i] === 1) {
            const cover = this.hiding[i]!;
            standing.target = cover !== NO_TARGET && this.alive[cover] === 1 ? cover : NO_TARGET;
            standing.flee = true;
            standing.hide = standing.target !== NO_TARGET;
            standing.minRange = 0;
            standing.maxRange = 0;
            standing.ram = false;
            standing.approachSpeed = approach.approachSpeed;
            return standing;
        }

        const target = this.chosen[i]!;
        if (target === NO_TARGET || this.alive[target] !== 1 || !this.hasControl(target)) {
            return undefined;
        }

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
        const band = holdBand(approach, design.reach, this.sizeOf(target));
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
    pushOrder(
        i: number,
        target: number,
        minRange: number,
        maxRange: number,
        approachSpeed: number,
        cancelOn: OrderCancelCondition = OrderCancelCondition.CompleteDisable,
    ): void {
        const order = {
            target: target,
            minRange: minRange,
            maxRange: maxRange,
            approachSpeed: approachSpeed,
            cancelOn: cancelOn,
            ram: false,
            grapple: false,
            land: false,
            dock: false,
        };
        this.orders[i]!.push(order);
    }

    /** Add an order to ram `target`, closing at `approachSpeed` (its doctrine's, if not given), to the end of this ship's queue. */
    pushRam(
        i: number,
        target: number,
        approachSpeed?: number,
        cancelOn: OrderCancelCondition = OrderCancelCondition.CompleteDisable,
    ): void {
        const speed = approachSpeed ?? this.doctrines[i]!.approach.approachSpeed;
        this.orders[i]!.push({
            target,
            minRange: 0,
            maxRange: 0,
            approachSpeed: speed,
            cancelOn,
            ram: true,
            grapple: false,
            land: false,
            dock: false,
            ...(approachSpeed === undefined ? { live: true } : { speed: approachSpeed }),
        });
    }

    /** Drop every order this ship has. It holds its heading and its fire. */
    clearOrder(i: number): void {
        if (this.orders[i]?.[0]?.errand !== undefined) shipForage.stopForaging(this, i);
        this.orders[i] = [];
        this.errandDocked[i] = 0;
    }

    /**
     * Add an order to attack `target`, fought as this ship's doctrine would fight
     * one it chose: its standoff band and approach speed.
     */
    pushAttack(
        i: number,
        target: number,
        cancelOn: OrderCancelCondition = OrderCancelCondition.CompleteDisable,
        distance?: number,
        speed?: number,
    ): void {
        this.pushOrder(i, target, 0, 0, 0, cancelOn);
        const order = this.orders[i]!.at(-1)!;
        order.live = true;
        if (distance !== undefined) order.distance = distance;
        if (speed !== undefined) order.speed = speed;
        this.liveBand(i, order);
    }

    /**
     * Bring an order's band and speed up to date: from what it was told, or
     * from its doctrine as it is now and the target as it now is.
     */
    private liveBand(i: number, order: Order): void {
        if (order.live !== true) return;
        const approach = this.doctrines[i]!.approach;
        order.approachSpeed = order.speed ?? approach.approachSpeed;
        if (order.ram || order.defend === true || order.target === NO_TARGET || this.alive[order.target] !== 1) return;
        const band = holdBand(approach, this.designs[i]!.reach, this.designs[order.target]!.radius, order.distance);
        order.minRange = band.min;
        order.maxRange = band.max;
    }

    /** Add an order to defend `friend` until it is gone, `distance` off its skin and closing at `speed` where told. */
    pushDefend(i: number, friend: number, distance?: number, speed?: number): void {
        const approach = this.doctrines[i]!.approach;
        this.orders[i]!.push({
            target: friend,
            minRange: 0,
            maxRange: 0,
            approachSpeed: speed ?? approach.approachSpeed,
            live: true,
            ...(distance === undefined ? {} : { distance }),
            ...(speed === undefined ? {} : { speed }),
            cancelOn: OrderCancelCondition.CompletelyDead,
            ram: false,
            grapple: false,
            land: false,
            dock: false,
            defend: true,
        });
        // A fresh look at who is attacking it, rather than at the next rethink.
        this.rethinkAt[i] = 0;
    }

    /**
     * Add an order to dock and take on all it can: at `friend`, or with
     * `NO_TARGET` wherever its doctrine would go. False, and nothing added, for
     * a friend it could not dock with: no pad it fits, or for a ship that is
     * not a fighter, no port where it has one.
     */
    pushDock(i: number, friend: number): boolean {
        if (friend !== NO_TARGET && !this.couldDockAt(i, friend)) return false;
        return this.pushErrand(i, "dock", friend);
    }

    /**
     * Add an order to fill its claw: from `source` (a wreck, an enemy, a friend
     * out of control, or one still flying, which gives only fuel above its own
     * reserve), or with `NO_TARGET` from source after source as its doctrine
     * would choose, until it is full. False, and nothing added, for a ship with
     * no claw, or a source on no side.
     */
    pushScavenge(i: number, source: number): boolean {
        if (!this.designs[i]!.modules.some((m) => m.spec.kind === "claw")) return false;
        if (
            source !== NO_TARGET &&
            (source === i || this.alive[source] !== 1 || (this.team[source] === NEUTRAL_TEAM && !this.isAsteroid(source)))
        )
            return false;
        return this.pushErrand(i, "scavenge", source);
    }

    /**
     * Add an order to give all it can spare through its port: to `friend`, or
     * with `NO_TARGET` to friend after friend as its doctrine would choose,
     * until it has nothing left to spare. False, and nothing added, for a ship
     * with no port, or a friend without one.
     */
    pushDeliver(i: number, friend: number): boolean {
        const design = this.designs[i]!;
        if (design.fighter || !design.modules.some((m) => m.spec.kind === "port")) return false;
        if (friend !== NO_TARGET) {
            if (friend === i || this.alive[friend] !== 1 || this.team[friend] !== this.team[i]) return false;
            if (!this.designs[friend]!.modules.some((m) => m.spec.kind === "port")) return false;
        }
        return this.pushErrand(i, "deliver", friend);
    }

    /**
     * Replace this ship's orders with running away: from every armed enemy for
     * `NO_TARGET`, from `target` if it is an armed enemy, or hiding behind it if
     * it is a friend or on no side, a wreck included. False, and nothing
     * changed, for itself or an enemy with nothing to run from.
     */
    pushFlee(i: number, target: number): boolean {
        let hide = false;
        if (target !== NO_TARGET) {
            if (target === i || this.alive[target] !== 1) return false;
            hide = this.derelict[target] === 1 || !this.hostile(i, target);
            if (!hide && !shipFlight.armed(this, target)) return false;
        }
        this.clearOrder(i);
        this.orders[i]!.push({
            target,
            minRange: 0,
            maxRange: 0,
            approachSpeed: this.doctrines[i]!.approach.approachSpeed,
            cancelOn: OrderCancelCondition.None,
            ram: false,
            grapple: false,
            land: false,
            dock: false,
            flee: true,
            hide,
        });
        return true;
    }

    private pushErrand(i: number, errand: Errand, target: number): boolean {
        this.orders[i]!.push({
            target,
            minRange: 0,
            maxRange: 0,
            approachSpeed: this.doctrines[i]!.approach.approachSpeed,
            cancelOn: OrderCancelCondition.CompletelyDead,
            ram: false,
            grapple: false,
            land: false,
            dock: false,
            errand,
        });
        if (this.orders[i]!.length === 1) this.startErrand(i);
        return true;
    }

    /** Set ship `i` off on the errand now at the head of its queue, rather than at its next rethink. */
    private startErrand(i: number): void {
        shipForage.stopForaging(this, i);
        this.errandDocked[i] = 0;
        this.forageAt[i] = 0;
    }

    /** Whether ship `i` has the kind of dock that could ever mate with one of `t`'s, worn or not. */
    private couldDockAt(i: number, t: number): boolean {
        if (t === i || this.alive[t] !== 1 || this.team[t] !== this.team[i]) return false;
        const design = this.designs[i]!;
        const host = this.designs[t]!;
        if (design.fighter) {
            const box = footprintOf(design);
            return host.modules.some((m) => m.spec.kind === "pad" && this.fitsPad(box, m.spec));
        }
        return design.modules.some((m) => m.spec.kind === "port") && host.modules.some((m) => m.spec.kind === "port");
    }

    /** Drop the order at `n` in this ship's queue, the current one being 0. */
    dropOrder(i: number, n: number): void {
        this.orders[i]?.splice(n, 1);
        if (n === 0) this.nextOrder(i);
    }

    /** What follows an order leaving the head of the queue: a fresh start on the next one, if that is an errand. */
    nextOrder(i: number): void {
        this.errandDocked[i] = 0;
        if (this.errandOf(i) !== undefined) this.startErrand(i);
    }

    /** This ship's orders, the current one first. */
    ordersOf(i: number): readonly Readonly<Order>[] {
        return this.orders[i] ?? [];
    }

    /**
     * The force provider that applies what `command` decided.
     *
     * Register it once with the world. It is idempotent: it re-applies stored
     * values rather than computing new ones, so the double evaluation on a
     * primed step costs nothing but a repeat of the same sum.
     */
    forceProvider(): ForceProvider {
        return this;
    }

    applyForces(world: World): void {
        const bodies = world.bodies;
        // Where the rails have put the wells, which the providers before this one did.
        for (let r = 0; r < this.riders.length; r++) {
            const b = bodies.indexOf(this.riders[r]!);
            const design = b < 0 ? null : this.hullDesign[b];
            if (design !== null && design !== undefined) this.ride(bodies, b, design);
        }
        // And the fighters on the carriers, the carriers wherever they are.
        // Moored hulls first, since a fighter may be parked on one.
        for (let k = 0; k < this.parkedShips.length; k++)
            if (this.mooredClaw[this.parkedShips[k]!]! >= 0) shipDocking.pin(this, bodies, this.parkedShips[k]!);
        for (let k = 0; k < this.parkedShips.length; k++)
            if (this.mooredClaw[this.parkedShips[k]!]! < 0) shipDocking.pin(this, bodies, this.parkedShips[k]!);
        for (let i = 0; i < this.alive.length; i++) {
            if (this.alive[i] === 0) continue;
            bodies.applyLocalWrench(
                this.bodyIds[i]!,
                this.demandFx[i]! + this.leakFx[i]!,
                this.demandFy[i]! + this.leakFy[i]!,
                this.demandTorque[i]! + this.recoil[i]! + this.leakTorque[i]!,
            );
        }
    }

    /**
     * Put a pinned hull where its kernel's middle sits on the well it rides,
     * moving as the well does and as the hull turns about it.
     */
    private ride(bodies: Bodies, b: number, design: ShipDesign): void {
        const well = this.rides[b];
        if (well === undefined) return;
        let kernel = -1;
        for (let m = 0; m < design.modules.length && kernel < 0; m++) if (design.modules[m]!.spec.kind === "kernel") kernel = m;
        if (kernel < 0) return;
        const module = design.modules[kernel]!;
        const angle = bodies.angle[b]!;
        const c = cos(angle);
        const s = sin(angle);
        const rx = module.x * c - module.y * s;
        const ry = module.x * s + module.y * c;
        const spin = bodies.angularVel[b]!;
        bodies.x[b] = well.x - rx;
        bodies.y[b] = well.y - ry;
        bodies.vx[b] = (well.vx ?? 0) + spin * ry;
        bodies.vy[b] = (well.vy ?? 0) - spin * rx;
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
    /**
     * What every body's generators make this step, banked, with no pilot to
     * draw on it: a battle whose ships are not flown still charges robots.
     */
    generate(dt: number, world: World): void {
        this.tick = world.tick;
        const bodies = world.bodies;
        this.bodyStore = bodies;
        for (let i = 0; i < this.alive.length; i++) {
            if (this.alive[i] === 0) continue;
            const b = bodies.indexOf(this.bodyIds[i]!);
            if (b < 0 || this.shipByBody[b] !== i) continue;
            this.power.close(b);
            this.power.open(b, dt, this.damage);
        }
    }

    command(dt: number, world: World, grid?: SpatialGrid): void {
        this.tick = world.tick;
        const bodies = world.bodies;
        this.bodyStore = bodies;
        this.now = world.tick;
        this.noteRocks(world.tick);

        // What every body's generators make this step, for what draws on it below.
        for (let i = 0; i < this.alive.length; i++) {
            if (this.alive[i] === 0) continue;
            const b = bodies.indexOf(this.bodyIds[i]!);
            if (b >= 0 && this.shipByBody[b] === i) {
                // Last step's spare banked, now that everything after the pilots has drawn on it.
                this.power.close(b);
                this.power.open(b, dt, this.damage);
            }
        }

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
            // Nor does a ship with nothing left to push or shoot with fly or aim:
            // it shuts down until it is mended or restocked.
            if (this.inert(bodies, i)) {
                this.shutDown(i);
                // Its beams still charge, which may bring it back.
                this.reloadOne(dt, bodies, i);
                continue;
            }
            this.removeInvalidOrders(i);
            this.decide(world, bodies, i);
            shipForage.forage(this, world, bodies, i);
            this.decideTurrets(world, bodies, i);
            shipFlight.flyOne(this, dt, bodies, i, grid);
            this.commitOne(bodies, i);
            this.trainOne(bodies, i);
            this.reloadOne(dt, bodies, i);
        }

        // Every ship pushing pays for what it burns.
        for (let i = 0; i < this.alive.length; i++) {
            if (this.alive[i] === 1) shipFlight.burn(this, dt, bodies, i);
        }
        // Once per body, however many ships ride it.
        for (let i = 0; i < this.alive.length; i++) {
            if (this.alive[i] === 1) shipFlight.leak(this, dt, bodies, i);
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
     * the world has stepped and the index has been rebuilt. Given `log`, each
     * round fired is recorded at its muzzle, for a flash.
     */
    fire(world: World, projectiles: Projectiles, beams: Beams, grid: SpatialGrid, beamHits: BeamHits, log?: ImpactLog): FireReport {
        this.tick = world.tick;
        const bodies = world.bodies;
        this.bodyStore = bodies;
        this.noteRocks(world.tick);
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
            if (bodyIdx < 0 || this.onSlipway(i, bodyIdx)) continue;

            // Recoil is accumulated across the ship's guns and applied once, after
            // all of them have fired. Applying it per gun would work only for a ship
            // with one: `fireFrom` gives a round the hull's velocity, so the second
            // gun's round would inherit a hull the first gun had already pushed, and
            // the salvo would quietly gain the momentum that ordering invented. A
            // broadside leaves together.
            let impulseX = 0;
            let impulseY = 0;
            let angularImpulse = 0;
            let loaded = false;

            for (let t = 0; t < indices.length; t++) {
                let state = turretStates[t]!;
                const gun = design.turrets[t]!.gun;
                let barrel = barrels[t]!;

                // What damage has left of this mount's rate of fire. A wrecked mount
                // stops where it is: it does not finish the shot it was committed to,
                // because there is no longer a gun to finish it with.
                if (!this.ownsAt(i, bodyIdx, design.turrets[t]!.module)) continue;
                const rate = this.left(i, bodyIdx, design.turrets[t]!.module, DamageEffect.FireRate);
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

                const lateralOffset = gun.barrelCount > 1 ? (barrel - (gun.barrelCount - 1) * 0.5) * gun.barrelSpacing : 0;

                this.turrets.firingSolution(bodies, ti, this.solution, lateralOffset);

                // A burst already committed is seen through: the emitter is lit and
                // there is nothing to hold. Discipline is about pulling the trigger.
                if (
                    (state != TurretState.CommittedOn &&
                        this.friendlyInTheWay(
                            bodies,
                            grid,
                            i,
                            bodyIdx,
                            gun,
                            target === NO_TARGET ? design.turrets[t]!.reach : this.turrets.fireReach[ti]!,
                            target,
                            this.mountLayers(i, design.turrets[t]!),
                        )) ||
                    (target !== NO_TARGET && this.rockInTheWay(bodies, bodyIdx, target))
                ) {
                    continue;
                }

                if (gun.type == GunType.Projectile) {
                    // A gun with nothing to load holds, ready, until there is.
                    const mount = design.turrets[t]!.module;
                    if (shipSupply.allowed(this, Resource.Metal, bodyIdx, mount, Claim.Fire, gun.roundMass) < gun.roundMass) continue;
                    if (!this.metal.load(bodyIdx, mount, gun.roundMass)) continue;
                    shipSupply.took(this, Resource.Metal, bodyIdx, mount, Claim.Fire, gun.roundMass);
                    loaded = true;
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
                    log?.push(
                        this.solution.x,
                        this.solution.y,
                        gun.muzzleEnergy,
                        IMPACT_MUZZLE,
                        bodies,
                        bodyIdx,
                        0,
                        0,
                        0,
                        this.solution.dirX,
                        this.solution.dirY,
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
                    // The round was part of the hull's mass until it was loaded, so the
                    // hull's velocity it leaves with is momentum the hull no longer has.
                    const impulse = gun.roundMass * gun.muzzleSpeed;
                    const jx = -this.solution.dirX * impulse;
                    const jy = -this.solution.dirY * impulse;
                    impulseX += jx;
                    impulseY += jy;
                    angularImpulse += (this.solution.x - bodies.x[bodyIdx]!) * jy - (this.solution.y - bodies.y[bodyIdx]!) * jx;

                    // A battered mount loads slower, which is the whole of what damage
                    // does to a gun for now.
                    timers[t] = gun.cycleTime / rate;

                    turretStates[t] = TurretState.Reloading; // Projectile guns immediately reload after firing.

                    projectilesFired++; // increment for every shot fired
                    this.firedAt[i] = world.tick;
                } else {
                    // One beam a layer, each with its share of the power: a thick
                    // module takes both, and what is in one layer only takes its half
                    // and lets the other go on past it, as a thick engine's flame does.
                    const layers = this.mountLayers(i, design.turrets[t]!);
                    // A craft in both layers to ram or dock fires as it is, in both at once.
                    const split = layers === BOTH_LAYERS && this.shipLayers(i) === OWN_LAYERS;
                    for (let k = 0; k < (split ? 2 : 1); k++) {
                        const layer = split ? (k === 0 ? HULL_LAYER : WEAPONS_LAYER) : layers;
                        beams.fireFrom(
                            bodyIdx,
                            this.solution.x,
                            this.solution.y,
                            this.solution.dirX,
                            this.solution.dirY,
                            gun.calibre,
                            split ? gun.beamPower / 2 : gun.beamPower,
                            0,
                            bodies,
                            grid,
                            beamHits,
                            this.holedHulls,
                            design.turrets[t]!.module,
                            layer,
                        );
                    }
                    this.firedAt[i] = world.tick;
                    if (state == TurretState.Idle) {
                        // was idle before, now committed on for beamOnTime
                        turretStates[t] = TurretState.CommittedOn;
                        timers[t] = gun.beamOnTime;
                        this.turrets.lit[ti] = 1;

                        beamsFired++; // only increment when going from idle to on.
                    }
                }
            }

            // Lighter by what left, before what pushed it off acts on what remains.
            if (loaded) shipBreakup.settleMass(this, bodies, bodyIdx);
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
                const layers = this.pieceLayers(i, bodyIdx, design, design.engines[t]!.module ?? -1);
                this.plumes.burn(design, t, force, this.damage, bodies, bodyIdx, grid, this.holedHulls, dt, landed, layers);
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
        if (kept[0] === orders[0]) return;
        if (orders[0]?.errand !== undefined) shipForage.stopForaging(this, i);
        this.nextOrder(i);
    }

    /** Whether an order's `cancelOn` condition has been met. */
    private orderFinished(order: Order): boolean {
        // Station-keeping: held whatever becomes of the target, including nothing.
        if (order.cancelOn === OrderCancelCondition.None) return false;
        // An errand for doctrine to direct has no target to lose.
        if (order.errand !== undefined && order.target === NO_TARGET) return false;

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

    /** Whether this ship has turned its main engines along its want rather than its guns to its target. */
    isBurning(i: number): boolean {
        return this.burning[i] === 1;
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
            const slack = this.firingSlack(
                this.aimDoctrine(i, mounts[t]!),
                target,
                part,
                this.turrets.aimDx[ti]!,
                this.turrets.aimDy[ti]!,
                rx,
                ry,
            );
            // In reach of what it will fire on: the part it picked if it minds what
            // it hits, and otherwise the ship, from its middle.
            const selective = refusesAnything(this.aimDoctrine(i, mounts[t]!)) && part !== WHOLE_SHIP;
            this.turrets.allowSlack(
                ti,
                slack,
                this.slackOffset,
                this.reachOn(i, mounts[t]!, target, part),
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
        const doctrine = this.aimDoctrine(i, mount);
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
        if (!refusesAnything(doctrine) && this.meetsWhole(layers, target) && !hooked && !this.sharesBody(target, targetBody))
            return WHOLE_SHIP;

        // One that *has* refused something cannot: a ship's centre is whatever is
        // amidships, which on most hulls is the plating a beam has just turned
        // down. So it chooses again from what is actually left, now, and only
        // stands down when the answer is that there is nothing it will shoot at.
        // The mount is already located by the caller.
        return this.aimFor(bodies, i, mount, layers, target, this.gunPoint.x, this.gunPoint.y, hooked);
    }

    blow(bodyIndex: number, module: number, jx: number, jy: number, px: number, py: number): void {
        shipBreakup.blow(this, bodyIndex, module, jx, jy, px, py);
    }

    sever(world: World, contacts?: Contacts): number {
        return shipBreakup.sever(this, world, contacts);
    }

    weld(world: World, contacts: Contacts): number {
        return shipWeld.weld(this, world, contacts);
    }

    pump(world: World): number {
        return shipSupply.pump(this, world);
    }

    tend(world: World): void {
        shipRobots.tend(this, world);
    }

    strandedOn(rock: number): number {
        return shipRobots.strandedOn(this, rock);
    }

    walkDist = new Float64Array(0);
    walkPrev = new Int32Array(0);

    robotsBerthed(i: number, out: number[]): void {
        shipRobotViews.robotsBerthed(this, i, out);
    }

    robotsDocked(i: number, out: number[]): void {
        shipRobotViews.robotsDocked(this, i, out);
    }

    robotCrews(i: number, crews: number[], aboard: number[], builds: number[]): void {
        shipRobotViews.robotCrews(this, i, crews, aboard, builds);
    }

    robotViews(i: number, out: number[]): void {
        shipRobotViews.robotViews(this, i, out);
    }

    /** Where `robotPlace` puts a robot from the middle of the module it is on, m, in its design's frame. */
    robotDx = 0;
    robotDy = 0;
    /** Where `spotOn` puts a robot from a module's middle, m, in its design's frame. */
    spotX = 0;
    spotY = 0;
    /** The ship, and its body, whose robots `robotPlace` is placing. */
    placeOwner = -1;
    placeHull = -1;

    cull(world: World): number {
        return shipBreakup.cull(this, world);
    }

    /** The side module `m` of body `b` came from. */
    sideAt(b: number, m: number): number {
        const sides = this.sides[b];
        return sides === null || sides === undefined ? this.team[this.shipByBody[b]!]! : sides[m]!;
    }

    /** The side module `m` of the body ship `i` rides came from, for drawing it in that side's colours. */
    moduleSide(i: number, m: number): number {
        const b = this.bodyStore === null ? -1 : this.bodyStore.indexOf(this.bodyIds[i]!);
        return b < 0 ? this.team[i]! : this.sideAt(b, m);
    }

    /** Each module's side, or null if every one is `team`'s. */
    sidesOf(sideOf: (m: number) => number, count: number, team: number): Int32Array | null {
        let mixed = false;
        const sides = new Int32Array(count);
        for (let m = 0; m < count; m++) {
            sides[m] = sideOf(m);
            if (sides[m] !== team) mixed = true;
        }
        return mixed ? sides : null;
    }

    /** Whether ship `i`, riding body index `b`, works module `m` of it. */
    ownsAt(i: number, b: number, m: number): boolean {
        const pilots = this.pilots[b];
        return pilots === null || pilots === undefined || pilots[m] === i;
    }

    /**
     * What damage has left of a module's effect, for the ship working it: none
     * for anyone else, and none while no working core reaches it (`inReach`).
     */
    left(i: number, b: number, module: number, effect: DamageEffect): number {
        if (!this.ownsAt(i, b, module)) return 0;
        if (effect !== DamageEffect.Control && !this.inReach(i, b, module)) return 0;
        return this.damage.remaining(b, module, effect);
    }

    /** Whether one of ship `i`'s working cores reaches module `m` of body index `b` (`ShipDesign.coveredBy`). */
    inReach(i: number, b: number, m: number): boolean {
        const cores = this.designs[i]?.coveredBy?.[m];
        if (cores === null || cores === undefined) return true;
        for (let k = 0; k < cores.length; k++) {
            const core = cores[k]!;
            if (this.ownsAt(i, b, core) && this.damage.remaining(b, core, DamageEffect.Control) > 0) return true;
        }
        return false;
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
    ridersOf(bodies: Bodies, b: number): number[] {
        const riders: number[] = [];
        for (let r = 0; r < this.alive.length; r++) {
            if (this.alive[r] === 1 && bodies.indexOf(this.bodyIds[r]!) === b) riders.push(r);
        }
        return riders;
    }

    /** Put ship `r` aboard the body `p` is primary of, sharing its design and mount state. */
    board(r: number, p: number): void {
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
    shipAt(bodies: Bodies, bodyIndex: number): number {
        const i = this.shipByBody[bodyIndex];
        if (i === undefined || i < 0) return -1;
        if (this.alive[i] !== 1) return -1;
        if (bodies.indexOf(this.bodyIds[i]!) !== bodyIndex) return -1;
        return i;
    }

    momentumX = 0;
    momentumY = 0;

    settleShedOf(b: number): void {
        shipBreakup.settleShedOf(this, b);
    }

    /** Whether body `b` is a fighter parked on a pad. */
    isParkedBody(b: number): boolean {
        const ship = this.shipByBody[b];
        return ship !== undefined && ship >= 0 && this.parkedOn[ship]! >= 0;
    }

    /**
     * The body that moves for body `b`, parked on a pad or moored to a rock:
     * its carrier's, or what that is parked or moored on in turn. -1 for one
     * not parked.
     */
    carrierOf(b: number): number {
        if (this.bodyStore === null) return -1;
        let root = -1;
        for (let at = b, depth = 0; depth < 4; depth++) {
            const ship = this.shipByBody[at];
            const up = ship === undefined || ship < 0 ? -1 : this.carrierBodyOf(this.bodyStore, ship);
            if (up < 0) break;
            root = at = up;
        }
        return root;
    }

    /** Whether bodies `b` and `j` can meet: never a fighter parked on a pad and its carrier, nor two parked on one. */
    meets(b: number, j: number): boolean {
        const cb = this.carrierOf(b);
        const cj = this.carrierOf(j);
        return cb !== j && cj !== b && (cb < 0 || cb !== cj);
    }

    /** Whether ship `i` is parked on a pad. */
    isParked(i: number): boolean {
        return this.parkedOn[i]! >= 0;
    }

    /** The ship whose pad ship `i` is parked on, or -1. */
    parkedCarrier(i: number): number {
        return this.parkedOn[i]!;
    }

    /** The body of the carrier ship `f` is parked on, or -1. */
    carrierBodyOf(bodies: Bodies, f: number): number {
        const c = this.parkedOn[f]!;
        return c < 0 || this.alive[c] === 0 ? -1 : bodies.indexOf(this.bodyIds[c]!);
    }

    /** The pad ship `f` is parked on, by module of its carrier's hull: -1 for one not parked, or whose pad has gone. */
    parkedPadOf(bodies: Bodies, f: number): number {
        const cb = this.carrierBodyOf(bodies, f);
        if (cb < 0) return -1;
        const c = this.parkedOn[f]!;
        const pad = shipRebuild.rebuildFor(this, c, this.designs[c]!).at[this.parkedPad[f]!]!;
        return pad >= 0 && this.ownsAt(c, cb, pad) ? pad : -1;
    }

    isMoored(i: number): boolean {
        return shipForage.isMoored(this, i);
    }

    land(world: World): number {
        return shipDocking.land(this, world);
    }

    refit(world: World, i: number, to: ShipDesign): string | null {
        return shipBuild.refit(this, world, i, to);
    }

    /** Whether ship `i` is refitted and its hull is not yet what it was refitted to: something to come down, or to go up. */
    isRefitting(i: number): boolean {
        if (this.refitting[i] !== 1 || this.alive[i] === 0) return false;
        const bodies = this.bodyStore!;
        const b = bodies.indexOf(this.bodyIds[i]!);
        if (b < 0) return false;
        const design = this.hullDesign[b]!;
        for (let m = 0; m < design.modules.length; m++) if (this.ownsAt(i, b, m) && shipRebuild.wreckage(this, i, b, m)) return true;
        return !shipBuild.finished(this, b, i, design);
    }

    build(world: World): void {
        shipBuild.build(this, world);
    }

    canBuildArmed(i: number): boolean {
        return shipBuild.canBuildArmed(this, i);
    }

    /** The tick ship `i` last put work into a fighter it is building on a pad; -1 for never. */
    lastBuilt(i: number): number {
        return this.builtAt[i] ?? -1;
    }

    /** Whether ship `i` is a fighter still being built on its pad, or a ship on its slipway. */
    isUnfinished(i: number): boolean {
        return this.unfinished[i] === 1;
    }

    /** Whether ship `i` is going up on a slipway, its walls not yet all built. */
    isPrinting(i: number): boolean {
        return this.printing[i] === 1;
    }

    /**
     * The best thing to drink from or take apart: a wreck, or an enemy with no
     * main guns left, scored by what it would gain, less what getting there
     * burns, for the time spent — getting there at what it can close at,
     * pumping and taking apart — and put off by armed enemies near it. Metal
     * counts as `fuelPerMetal` of fuel a kilogram. One that pays no more than the
     * trip costs, or that is going away faster than it can follow, is not gone
     * for.
     */
    /** Whether a hull is an asteroid: rock, or a kernel, and nobody's. */
    isAsteroid(t: number): boolean {
        if (this.team[t] !== NEUTRAL_TEAM) return false;
        return this.designs[t]!.modules.some((module) => module.spec.kind === "rock" || module.spec.kind === "kernel");
    }

    /** The rock left on ship `t`'s hull, and the ore and ice in it, kg, into `out`. */
    rockLeft(t: number, out: { rock: number; ore: number; ice: number }): void {
        out.rock = out.ore = out.ice = 0;
        const bodies = this.bodyStore;
        const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[t]!);
        if (b < 0) return;
        for (let m = 0; m < this.designs[t]!.modules.length; m++) {
            const module = this.designs[t]!.modules[m]!;
            if (module.spec.kind !== "rock") continue;
            const left = module.stats.structureMass + module.stats.fittingMass - this.damage.shedAt(b, m) - this.damage.unbuiltAt(b, m);
            if (!(left > 0)) continue;
            out.rock += left;
            out.ore += left * (module.spec.ore ?? 0);
            out.ice += left * (module.spec.ice ?? 0);
        }
    }

    /**
     * How much of a step's reload a gun gets through, 0 to 1. A gun that loads
     * rounds gets all of it. A beam refills its bank from its piece of hull's
     * power over its reload, so it gets the share of the step's energy that
     * power could supply.
     */
    private recharged(b: number, i: number, t: number, dt: number): number {
        if (this.turretStates[i]![t] !== TurretState.Reloading) return 1;
        const mount = this.designs[i]!.turrets[t]!;
        const gun = mount.gun;
        if (gun.type !== GunType.Beam || !(gun.cycleTime > 0)) return 1;
        const rate = this.damage.remaining(b, mount.module, DamageEffect.FireRate);
        const need = (gun.beamPower * gun.beamOnTime * rate * dt) / gun.cycleTime;
        if (!(need > 0)) return 1;
        const allowed = shipSupply.allowed(this, Resource.Charge, b, mount.module, Claim.Fire, need);
        const got = this.power.draw(b, mount.module, need < allowed ? need : allowed);
        shipSupply.took(this, Resource.Charge, b, mount.module, Claim.Fire, got);
        return got / need;
    }

    /** Whether ship `i` is parked on a pad, or is held by a slipway of body `b` building it. */
    onPad(i: number, b: number): boolean {
        return this.parkedOn[i]! >= 0 || this.onSlipway(i, b);
    }

    /** Whether ship `i` is held by a slipway of body `b`: built, and doing nothing until it is let go. */
    onSlipway(i: number, b: number): boolean {
        const design = this.hullDesign[b];
        for (const seam of design?.seams ?? []) {
            if (seam.dock === "slipway" && this.pilotAt(b, seam.b) === i) return true;
        }
        return false;
    }

    /** Engines off and nothing asked of them, while what it is holding is pumped aboard. */
    idle(i: number): void {
        this.throttles[i]!.fill(0);
        this.demandFx[i] = 0;
        this.demandFy[i] = 0;
        this.demandTorque[i] = 0;
        this.brakingOnMains[i] = 0;
        this.burning[i] = 0;
    }

    /** Run down each of ship `i`'s mounts' reload, as far as its power allows. */
    private reloadOne(dt: number, bodies: Bodies, i: number): void {
        const timers = this.cooldown[i]!;
        const b = bodies.indexOf(this.bodyIds[i]!);
        const mounts = this.designs[i]!.turrets;
        // The main battery first, so it has the power when there is not enough to go round.
        for (let pass = 0; pass < 2; pass++) {
            for (let t = 0; t < timers.length; t++) {
                if (mounts[t]!.main !== (pass === 0) || !this.ownsAt(i, b, mounts[t]!.module)) continue;
                if (timers[t]! > 0) {
                    const remaining = timers[t]! - dt * this.recharged(b, i, t, dt);
                    timers[t] = remaining > TIMER_SETTLE ? remaining : 0;
                }
            }
        }
    }

    /** Whether ship `i` has no engine that can burn and no mount of its own that can fire. */
    private inert(bodies: Bodies, i: number): boolean {
        if (!this.hasNoEngines(i)) return false;
        const b = bodies.indexOf(this.bodyIds[i]!);
        if (b < 0) return true;
        const mounts = this.designs[i]!.turrets;
        for (let t = 0; t < mounts.length; t++) {
            if (this.ownsAt(i, b, mounts[t]!.module) && this.canFire(i, b, t)) return false;
        }
        return true;
    }

    /** Stop everything ship `i` is doing, and forget what it was fighting. */
    private shutDown(i: number): void {
        this.failSafe(i);
        this.idle(i);
        this.chosen[i] = NO_TARGET;
        this.consort[i] = NO_TARGET;
        this.ramming[i] = NO_TARGET;
        this.withdrawing[i] = 0;
        this.hiding[i] = NO_TARGET;
    }

    private failSafe(i: number): void {
        // A rider shares its host's mount state, so stops only the mounts it works.
        const turrets = this.turretIndex[i]!;
        const b = this.bodyStore === null ? -1 : this.bodyStore.indexOf(this.bodyIds[i]!);
        const mounts = this.designs[i]!.turrets;
        for (let t = 0; t < turrets.length; t++) {
            if (b >= 0 && !this.ownsAt(i, b, mounts[t]!.module)) continue;
            this.turrets.stop(turrets[t]!);
        }
        this.throttles[i]!.fill(0);
        this.demandFx[i] = 0;
        this.demandFy[i] = 0;
        this.demandTorque[i] = 0;
    }

    remove(i: number): void {
        if (this.alive[i] === 0) return;
        if (this.parkedOn[i]! >= 0) {
            if (this.bodyStore === null) {
                this.parkedShips.splice(this.parkedShips.indexOf(i), 1);
                this.parkedOn[i] = -1;
            } else {
                shipDocking.unpark(this, this.bodyStore, i, this.now);
            }
        }
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
    exhaustOf(i: number, design: ShipDesign, bodyIndex: number, engine: number): number {
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
        return weaponPlumeReach(geometryOf(module), this.exhaustOf(i, design, b, engine));
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
