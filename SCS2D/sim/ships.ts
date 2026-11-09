import { Debris } from "./debris.js";
import { Bodies, type BodyId } from "./bodies.js";
import { aboardPose, padHolds, sameOrigin, slipwayHolds, type DesignTurret, type ShipDesign } from "./blueprint.js";
import { components, joints } from "./connectivity.js";
import { BOTH_LAYERS, HULL_LAYER, Hulls, OWN_LAYERS, WEAPONS_LAYER } from "./hull.js";
import { Damage, DamageEffect, type ImpactLog } from "./damage.js";
import { Fuel, LEAK_HOLE_CALIBRES, leakChance } from "./fuel.js";
import { Charge } from "./charge.js";
import { Metal } from "./metal.js";
import { mendClaim, priorityOf, Supply } from "./supply.js";
import { SEAL_REACH, SEAL_SPEED } from "./modules.js";
import type { Rng } from "./rng.js";
import { geometryOf, landedIndex, landedLength, plumeLayers, Plumes, weaponPlumeReach } from "./exhaust.js";
import { Choice } from "./targeting.js";
import { moduleRadius, shotCharge, shotFuel, volleyCharge, type ModuleSpec } from "./modules.js";
import { atan2, clamp, cos, floor, length, max, min, round, sin } from "./math.js";
import { Projectiles } from "./projectiles.js";
import type { Store } from "./store.js";
import { Robots, type Robot } from "./robots.js";
import { Allocation, EngineLayout } from "./engines.js";
import { STEER_HOLD_SPEED } from "./helm.js";
import { AttackArcs, AttackRegion } from "./attack.js";
import { FiringSolution, Turrets, TurretState } from "./turrets.js";
import {
    overriddenDoctrine,
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
import { RayHit } from "./spatialGrid.js";
import { fixed } from "./fixed.js";
import type { Contacts } from "./collision.js";
import { FUEL_DENSITY, GunType, interiorVolume } from "./modules.js";
import * as shipRobotViews from "./shipRobotViews.js";
import * as shipRobots from "./shipRobots.js";
import * as shipRebuild from "./shipRebuild.js";
import type { Rebuild, StripShape } from "./shipRebuild.js";
import * as shipWeld from "./shipWeld.js";
import * as shipSupply from "./shipSupply.js";
import * as shipBreakup from "./shipBreakup.js";
import * as shipForage from "./shipForage.js";
import * as shipDocking from "./shipDocking.js";
import * as shipBuild from "./shipBuild.js";
import * as shipFlight from "./shipFlight.js";
import * as shipAim from "./shipAim.js";
import * as shipOrders from "./shipOrders.js";
import * as shipDecide from "./shipDecide.js";
import * as shipFire from "./shipFire.js";

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
 * What a pilot asks the helm of its heading, alongside the velocity it wants:
 * to `FACE` the heading it gives; to `STEER`, the helm turning its push onto
 * the change of velocity it needs and resting on that heading otherwise; or to
 * `HURRY`, steering as fast as it can push, pointing before it burns.
 */
export const FACE = 0;
export const STEER = 1;
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
 * A ship lying against an asteroid at under `REST_SPEED` m/s, where they touch,
 * for `REST_TIME` seconds lodges on it, flown or not: stuck, it would otherwise
 * press on the rock, and flash against it, for good. First guesses.
 */
export const REST_SPEED = 0.25;
export const REST_TIME = 10;

/** Seconds a claw that missed waits before it tries again. */
export const CLAW_RETRY = 0.5;

/** Which turn a module takes to be mended: cores, then engines and weapons, then the rest. */
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

/**
 * How soon a module is mended or rebuilt, lowest first: by its doctrine's
 * priority for mending it (`mendCorePriority` and the rest).
 */
export function repairTier(approach: Approach, design: ShipDesign, m: number): number {
    return -priorityOf(approach, mendClaim(design, m));
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

export const NO_TARGET = -1;

/** World bearing from one point to another. */
export function bearing(fromX: number, fromY: number, toX: number, toY: number): number {
    return atan2(toY - fromY, toX - fromX);
}

/** Aiming at a ship rather than at any part of it. */
export const WHOLE_SHIP = -1;
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
    /** What each rail gun's capacitor bank holds, J; it starts a battle full. */
    readonly bank: Float64Array[] = [];
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
    readonly ramming: number[] = [];
    /** The tick each ship last fired a gun or a beam, or -1. */
    readonly firedAt: number[] = [];
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
    readonly withdrawing: number[] = [];
    /** What each withdrawing ship hides behind, or `NO_TARGET` to flee. */
    readonly hiding: number[] = [];
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
    /** What each ship's heaviest dodge this step is from, or -1; and how far off it wants that, centre to centre, m. */
    readonly dodgingFrom: number[] = [];
    readonly dodgingRoom: number[] = [];
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
    readonly consort: number[] = [];
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
    readonly rethinkAt: number[] = [];
    /**
     * The order doctrine makes up, one per ship and rewritten in place, so that
     * falling back on doctrine allocates nothing per step.
     */
    readonly standing: Order[] = [];
    readonly choice = new Choice();
    /** A mount's pick among what is in reach but it cannot fire at now: tracked, trigger held. */
    readonly maskedChoice = new Choice();
    /** And among what is out of reach, so it is already pointed at it when it closes. */
    readonly farChoice = new Choice();
    /** The middle of the last `firingSlack`'s cone, radians off its aim point. */
    slackOffset = 0;

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
    readonly solution = new FiringSolution();
    /**
     * Where a mount sits in the world and how fast that point is moving, filled
     * in place by `locateMount` and read straight away. Persistent rather than
     * built per call, per §12.
     */
    readonly gunPoint = { x: 0, y: 0, vx: 0, vy: 0 };
    /** Where a part of a target is, for a mount choosing between them. */
    readonly partAt = { x: 0, y: 0 };
    /** What the pilot is fighting, what it is covering, and what it is weighing up. Reused, never shared. */
    readonly fightAt = spot();
    readonly coverAt = spot();
    readonly lookAt = spot();
    readonly sizeAt = spot();
    /** Where a shot would land, for the friendly check. Reused, never shared. */
    readonly lineOfFire = new RayHit();
    /** The ships that are asteroids, and a flag by ship, as of step `rocksAt`. */
    readonly rockShips: number[] = [];
    readonly rockFlag: number[] = [];
    rocksAt = -1;
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
        return ship === undefined ? OWN_LAYERS : shipAim.shipLayers(this, ship);
    }

    /**
     * The layers module `m` of ship `i`'s body is in for what it does: the
     * body's, or, on a hull shared with a carrier, a fighter's own on a piece
     * that came aboard a fighter, so it flies over the deck it is sat on.
     */
    pieceLayers(i: number, b: number, design: ShipDesign, m: number): number {
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

    mountBearing(bodyIndex: number, turret: number): number {
        const i = this.shipByBody[bodyIndex];
        if (i === undefined || i < 0 || this.alive[i] !== 1 || this.designs[i] !== this.hullDesign[bodyIndex]) return NaN;
        const index = this.turretIndex[i]?.[turret];
        return index === undefined ? NaN : this.turrets.bearing[index]!;
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
    mending(bodies: Bodies, i: number): boolean {
        const b = bodies.indexOf(this.bodyIds[i]!);
        return b >= 0 && (this.robots.on(b)?.length ?? 0) > 0;
    }

    hulk(i: number): boolean {
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
     * Whether mount `t` is sound and can shoot once more: a gun with a round's
     * metal on its piece of hull and, if it is still reloading, the rest of
     * its fuel there, and the rest of its charge stored there or made there
     * within a cycle. One whose generators will get there in the end counts,
     * however long they take.
     */
    canFire(i: number, b: number, t: number): boolean {
        if (this.isTurretDisabled(i, t)) return false;
        const mount = this.designs[i]!.turrets[t]!;
        const gun = mount.gun;
        const timer = this.cooldown[i]![t]!;
        const reloading = timer > 0 && gun.cycleTime > 0;
        const rate = reloading ? this.damage.remaining(b, mount.module, DamageEffect.FireRate) : 0;
        if (gun.type === GunType.Projectile && gun.casing > 0 && this.metal.pieceHeld(b, mount.module) < gun.casing) return false;
        if (reloading && this.fuel.fed(b, mount.module, this.damage) < (shotFuel(gun) * rate * timer) / gun.cycleTime) return false;
        if (gun.bankEnergy > 0) {
            const short = volleyCharge(gun) - this.bank[i]![t]!;
            if (!(short > 0)) return true;
            return this.power.pieceHeld(b, mount.module) >= short || this.power.pieceGeneration(b, mount.module, this.damage) > 0;
        }
        if (!reloading) return true;
        const need = (shotCharge(gun) * rate * timer) / gun.cycleTime;
        if (!(need > 0)) return true;
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
        const cooldown = new Float64Array(mounts.length);
        const states = new Uint8Array(mounts.length);
        // A lance charged only on target sets out uncharged.
        for (let t = 0; t < mounts.length; t++) {
            const spec = design.modules[mounts[t]!.module]?.spec;
            if (spec === undefined || spec.kind !== "plasmaLance" || spec.ready === true) continue;
            states[t] = TurretState.Reloading;
            cooldown[t] = mounts[t]!.gun.cycleTime;
        }
        this.cooldown.push(cooldown);
        this.turretStates.push(states);
        this.nextBarrelToFire.push(new Int32Array(mounts.length));
        const bank = new Float64Array(mounts.length);
        for (let t = 0; t < mounts.length; t++) bank[t] = mounts[t]!.gun.bankEnergy;
        this.bank.push(bank);
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
        this.dodgingFrom.push(-1);
        this.dodgingRoom.push(0);
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
        return shipAim.focusOf(this, i);
    }

    /**
     * What ship `i` is doing, told or of its own accord, and to which ship: an
     * errand or a trip doctrine sent it on, a ram, a fight on a friend's behalf,
     * or an attack. Null for nothing.
     */
    doingOf(i: number): { kind: "attack" | "defend" | "ram" | "flee" | "hide" | Errand; target: number } | null {
        const given = shipOrders.getCurrentOrder(this, i);
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
        const target = shipAim.focusOf(this, i);
        if (target === NO_TARGET || this.alive[target] !== 1) return null;
        if (given?.ram === true || (given === undefined && this.ramming[i] === target)) return { kind: "ram", target };
        return { kind: this.defendingOf(i) !== NO_TARGET ? "defend" : "attack", target };
    }

    /** What this ship is staying with as an escort, as `cover` flies it; `NO_TARGET` for nothing, or for a ship out of control. */
    coveringOf(i: number): number {
        const bodies = this.bodyStore;
        if (bodies === null || this.alive[i] !== 1 || !this.hasControl(i)) return NO_TARGET;
        return shipDecide.liveConsort(this, bodies, i, bodies.indexOf(this.bodyIds[i]!));
    }

    /** What this ship is keeping clear of above all else, as `avoid` flew it last step; `NO_TARGET` for nothing. */
    dodgingOf(i: number): number {
        if (this.alive[i] !== 1 || !this.hasControl(i)) return NO_TARGET;
        const t = this.dodgingFrom[i]!;
        return t >= 0 && this.alive[t] === 1 ? t : NO_TARGET;
    }

    /** How far from `consort` ship `i` stays as its escort, centre to centre, metres. */
    coverBandOf(i: number, consort: number): number {
        return shipDecide.escortBand(this, i, this.designs[i]!, consort);
    }

    /** The inside edge of that band, centre to centre, metres; 0 for none. */
    coverInnerOf(i: number, consort: number): number {
        return shipDecide.escortInnerEdge(this, i, this.designs[i]!, consort, this.coverBandOf(i, consort));
    }

    heldOrder(i: number): Readonly<Order> | undefined {
        return shipOrders.heldOrder(this, i);
    }

    /** The doctrine mount `t` of ship `i` goes by, with what the ship has been told over it. */
    mountDoctrineOf(i: number, t: number): Targeting {
        return shipAim.aimDoctrine(this, i, this.designs[i]!.turrets[t]!);
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
        return shipOrders.getCurrentOrder(this, i)?.errand;
    }

    /** Where ship `i`'s errand is taking it: the friend it was told, or the one its doctrine chose; `NO_TARGET` for none yet. */
    errandTarget(i: number): number {
        const given = shipOrders.getCurrentOrder(this, i);
        if (given?.errand === undefined) return NO_TARGET;
        if (given.target !== NO_TARGET) return given.target;
        const source = this.salvaging[i]!;
        return source !== NO_TARGET && this.alive[source] === 1 ? source : NO_TARGET;
    }

    /** Whether ship `i` has an order other than an errand, which a dock lets go of it for. */
    commanded(i: number): boolean {
        const given = shipOrders.getCurrentOrder(this, i);
        return given !== undefined && given.errand === undefined;
    }

    /** Whether moored ship `i` has been told to go: an order, or an errand to anything but the rock it is moored to. */
    sentAway(i: number): boolean {
        const given = shipOrders.getCurrentOrder(this, i);
        return given !== undefined && (given.errand === undefined || given.target !== this.parkedOn[i]);
    }

    /** Whether ship `i` was told where to go on its errand, so armed enemies near it are not to put it off. */
    sentTo(i: number): boolean {
        const given = shipOrders.getCurrentOrder(this, i);
        return given?.errand !== undefined && given.target !== NO_TARGET;
    }

    /** The friend this ship is ordered to defend, or `NO_TARGET`. */
    defendingOf(i: number): number {
        const given = shipOrders.getCurrentOrder(this, i);
        return given !== undefined && given.defend === true ? given.target : NO_TARGET;
    }

    /** What this ship's doctrine chose to fight, orders aside; `NO_TARGET` for nothing. */
    chosenOf(i: number): number {
        const fighting = this.chosen[i]!;
        return fighting !== NO_TARGET && this.alive[fighting] === 1 ? fighting : NO_TARGET;
    }

    /** How long a hull of this mass waits before reconsidering, in steps. */
    rethinkTicks(world: World, mass: number): number {
        const seconds = clamp(mass / THINKING_MASS, MIN_RETHINK, MAX_RETHINK);
        // At least one step, or a ship would decide twice in the same instant.
        return max(1, round(seconds / world.dt));
    }

    pushOrder(
        i: number,
        target: number,
        minRange: number,
        maxRange: number,
        approachSpeed: number,
        cancelOn: OrderCancelCondition = OrderCancelCondition.CompleteDisable,
    ): void {
        shipOrders.pushOrder(this, i, target, minRange, maxRange, approachSpeed, cancelOn);
    }

    pushRam(
        i: number,
        target: number,
        approachSpeed?: number,
        cancelOn: OrderCancelCondition = OrderCancelCondition.CompleteDisable,
    ): void {
        shipOrders.pushRam(this, i, target, approachSpeed, cancelOn);
    }

    clearOrder(i: number): void {
        shipOrders.clearOrder(this, i);
    }

    pushAttack(
        i: number,
        target: number,
        cancelOn: OrderCancelCondition = OrderCancelCondition.CompleteDisable,
        distance?: number,
        speed?: number,
    ): void {
        shipOrders.pushAttack(this, i, target, cancelOn, distance, speed);
    }

    pushDefend(i: number, friend: number, distance?: number, speed?: number): void {
        shipOrders.pushDefend(this, i, friend, distance, speed);
    }

    pushDock(i: number, friend: number): boolean {
        return shipOrders.pushDock(this, i, friend);
    }

    pushScavenge(i: number, source: number): boolean {
        return shipOrders.pushScavenge(this, i, source);
    }

    pushDeliver(i: number, friend: number): boolean {
        return shipOrders.pushDeliver(this, i, friend);
    }

    pushFlee(i: number, target: number): boolean {
        return shipOrders.pushFlee(this, i, target);
    }

    dropOrder(i: number, n: number): void {
        shipOrders.dropOrder(this, i, n);
    }

    ordersOf(i: number): readonly Readonly<Order>[] {
        return shipOrders.ordersOf(this, i);
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
        shipAim.noteRocks(this, world.tick);

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
                // Its guns still reload, which may bring it back.
                shipFire.reloadOne(this, dt, bodies, i);
                continue;
            }
            shipOrders.removeInvalidOrders(this, i);
            shipDecide.decide(this, world, bodies, i);
            shipForage.forage(this, world, bodies, i);
            shipAim.decideTurrets(this, world, bodies, i);
            shipFlight.flyOne(this, dt, bodies, i, grid);
            shipDecide.commitOne(this, bodies, i);
            shipAim.trainOne(this, bodies, i);
            shipFire.reloadOne(this, dt, bodies, i);
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

    fire(world: World, projectiles: Projectiles, beams: Beams, grid: SpatialGrid, beamHits: BeamHits, log?: ImpactLog): FireReport {
        return shipFire.fire(this, world, projectiles, beams, grid, beamHits, log);
    }

    scorch(world: World, grid: SpatialGrid, dt: number): void {
        shipFire.scorch(this, world, grid, dt);
    }

    removeInvalidOrders(i: number): void {
        shipOrders.removeInvalidOrders(this, i);
    }

    getCurrentOrder(i: number): Order | undefined {
        return shipOrders.getCurrentOrder(this, i);
    }

    orderCount(i: number): number {
        return shipOrders.orderCount(this, i);
    }

    /** Whether this ship has turned its main engines along its want rather than its guns to its target. */
    isBurning(i: number): boolean {
        return this.burning[i] === 1;
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
        this.bank[r] = this.bank[p]!;
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
        const mount = this.designs[i]!.turrets[turret]!;
        // A rail gun is as loaded as its bank is towards its next volley.
        if (mount.gun.bankEnergy > 0 && !(timer > 0)) return min(1, this.bank[i]![turret]! / volleyCharge(mount.gun));
        if (!(timer > 0)) return 1;
        if (this.turretStates[i]![turret] === TurretState.CommittedOn) {
            return mount.gun.beamOnTime > 0 ? min(1, timer / mount.gun.beamOnTime) : 0;
        }
        const bodies = this.bodyStore;
        const b = bodies === null ? -1 : bodies.indexOf(this.bodyIds[i]!);
        const rate = b < 0 ? 1 : this.damage.remaining(b, mount.module, DamageEffect.FireRate);
        const cycle = mount.gun.cycleTime / (rate > 0 ? rate : 1);
        return cycle > 0 ? max(0, 1 - timer / cycle) : 1;
    }

    /** Whether a gun is reloading, rather than ready or firing: a rail gun reloads until its bank holds a volley. */
    isReloading(i: number, turret: number): boolean {
        const timer = this.cooldown[i]![turret]!;
        const gun = this.designs[i]!.turrets[turret]!.gun;
        if (gun.bankEnergy > 0 && !(timer > 0)) return this.bank[i]![turret]! < volleyCharge(gun);
        return this.turretStates[i]![turret] === TurretState.Reloading && timer > 0;
    }

    /** Whether the pilot's demand exceeded what the layout can produce. */
    saturated(): boolean {
        return this.allocation.saturated;
    }
}
