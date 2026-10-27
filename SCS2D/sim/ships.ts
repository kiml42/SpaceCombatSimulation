import { Bodies, type BodyId } from "./bodies.js";
import {
    aboardPose,
    footprintOf,
    modulesOverlap,
    padHolds,
    approachTurn,
    originOf,
    reachAgainst,
    rebuiltDesign,
    keptAs,
    remarkedDesign,
    sameOrigin,
    seamedDesign,
    shotSpread,
    slipwayHolds,
    twinOf,
    subDesign,
    triggerMask,
    weldDesigns,
    type DockAt,
    type Footprint,
    type Seam,
    type DesignModule,
    type DesignTurret,
    type ShipDesign,
} from "./blueprint.js";
import { components, cuts, DOCK_HOLD, JOINT_IMPULSE_PER_AREA, jointBetween, joints, seamThickness, type Joint } from "./connectivity.js";
import { BOTH_LAYERS, HULL_LAYER, Hulls, moduleLayers, OWN_LAYERS, WEAPONS_LAYER } from "./hull.js";
import {
    Damage,
    DAMAGE_ENERGY_PER_KG,
    DamageEffect,
    IMPACT_MUZZLE,
    REPAIR_ENERGY_PER_JOULE,
    REPAIR_WASTE,
    repairWork,
    DISASSEMBLY_WASTE,
    type ImpactLog,
} from "./damage.js";
import { buildWork, faceNearest, faceToward, fittingOf, inFrame, SHELL_STEPS, shellOf } from "./rebuild.js";
import { printedCraft, printFrame, printLength, SLIPWAY_STEP, type Print } from "./slipway.js";
import { Fuel, LEAK_HOLE_CALIBRES, leakChance, leakRate, leakSpeed, type Leak } from "./fuel.js";
import { Charge } from "./charge.js";
import { Metal } from "./metal.js";
import { Claim, mendClaim, priorityOf, Resource, Supply } from "./supply.js";
import { berthGrid, isHullMount, moduleCentre, moduleOutline, robotsOn, SEAL_REACH, SEAL_SPEED, weldBox } from "./modules.js";
import type { Rng } from "./rng.js";
import { geometryOf, landedIndex, landedLength, plumeLayers, plumeRays, Plumes, WEAPON_PLUME_SHARE, weaponPlumeReach } from "./exhaust.js";
import { Choice, cohesionUrge, inSight, look, lookFrom, score } from "./targeting.js";
import {
    casingMass,
    chargeShare,
    DEFAULT_BURST_SPEED,
    DEFAULT_FRAGMENTS,
    DEFAULT_FUSE,
    firesShells,
    moduleRadius,
    type ModuleSpec,
    type ModuleStats,
} from "./modules.js";
import { abs, atan2, angleDelta, PI, brakingRate, clamp, cos, exp, floor, length, max, min, round, sin, sqrt } from "./math.js";
import { Projectiles } from "./projectiles.js";
import { padApproaches, type PadApproach } from "./padApproach.js";
import type { Store } from "./store.js";
import {
    crawl,
    doorBetween,
    legLength,
    neighbourOf,
    pathTo,
    robotShare,
    RobotMode,
    Robots,
    staysWhole,
    walk,
    walkTime,
    type Robot,
} from "./robots.js";
import { Allocation, EngineLayout } from "./engines.js";
import { addFlame, addTurret, attackBearing, AttackArcs, AttackRegion } from "./attack.js";
import { FiringSolution, interceptTime, Turrets, TurretState } from "./turrets.js";
import {
    DEFAULT_DOCTRINE,
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
import { wellPull, type WellSpec } from "./gravity.js";
import type { BeamHits, Beams, SpatialGrid } from "./index.js";
import { MAX_BEAM_LENGTH } from "./beams.js";
import { RayHit } from "./spatialGrid.js";
import { fixed } from "./fixed.js";
import { CLAW_ALIGN, CLAW_DEPTH, CLAW_STIFFNESS, hullsOverlap, moduleOverlapsHull, Stab, type Contacts } from "./collision.js";
import {
    DOCK_POWER_PER_METRE,
    FUEL_DENSITY,
    PAD_REPAIR_PER_METRE,
    SLIPWAY_BUILD_PER_METRE,
    SLIPWAY_CLEAR_TIME,
    SLIPWAY_PUSH,
    ROBOT_BUILD_ENERGY,
    ROBOT_BUILD_TIME,
    berthRate,
    robotsKept,
    ROBOT_CHARGE,
    ROBOT_LOAD,
    ROBOT_MASS,
    ROBOT_REFILL_TIME,
    ROBOT_REPAIR_RATE,
    GunType,
    interiorVolume,
    type GunStats,
    type ModuleKind,
} from "./modules.js";

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
 * How near, as a share of its own radius, a hull will let its turn swing a
 * part of it towards another hull, over and above the room it needs to stop.
 */
const TURN_CLEARANCE_RADII = 0.1;

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

/** Where a ship is, how it moves and how big it is, as whatever flies or aims at it sees it (`Ships.locate`). */
interface Spot {
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
}

function spot(): Spot {
    return { x: 0, y: 0, vx: 0, vy: 0, radius: 0 };
}

/** Robots a bay is building, the most nearly finished first. */
function mostDone(a: number, b: number): number {
    return b - a;
}

/** Seconds of a robot's work short of `ROBOT_BUILD_TIME` that still counts as done, for what rounding leaves. */
const BUILD_SLACK = 1e-9;

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
/** How hard a fleeing ship eases off once clear of every enemy's reach, m/s². */
const FLEE_EASE = 3;

/** How many times a pilot may halve its ask for force to keep the torque to turn with. */
const FORCE_HALVINGS = 6;

/**
 * A turn short by less than this share of the torque the ship has is no turn
 * at all, and not worth giving up thrust for: a craft dead on its heading asks
 * for round-off.
 */
const TORQUE_NEGLIGIBLE = 1e-6;

/**
 * A turn asking less than this share of the torque a craft has is not worth
 * giving up thrust for, nor is one given more than this share of what it asked.
 */
const TURN_SHARE = 0.1;

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
 * Below this mass, wreckage in the fight is let go once it is in nobody's way,
 * kilograms (`Ships.loose`).
 *
 * A fighter's parts weigh a few hundred kilograms to a few tonnes and a
 * capital's modules five to nine, so this reaches fighter debris and no more:
 * pieces too small to be worth a scavenger's trip, kept only as obstacles.
 */
const LOOSE_MASS = 5000;

/** How long a loose piece is kept whatever, seconds, so the eye sees it fly off. */
const LOOSE_AGE = 5;

/** How far ahead a loose piece looks for something under control to meet, seconds. */
const LOOSE_HORIZON = 10;

/** How near that has to pass beyond the two radii to count, metres. */
const LOOSE_CLEARANCE = 50;

/** How often loose pieces are looked over, seconds. */
const LOOSE_PERIOD = 1;

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

/** How far past the end of a module's weldable part a contact may still weld it, metres. */
const WELD_REACH = 0.05;

/**
 * Whether world point `x`, `y` is on the part of `module` that may be welded,
 * with its body at `bx`, `by` turned `angle`: anywhere but a hull mount's
 * barrel. A stop-gap until a barrel collides where it is drawn rather than as
 * the rest of the module's rectangle. An engine's bell still welds, as debris
 * can snag on one even though a layout is never attached by it.
 */
export function onWeldablePart(module: DesignModule, bx: number, by: number, angle: number, x: number, y: number): boolean {
    const spec = module.spec;
    if (!isHullMount(spec.kind)) return true;
    const weld = weldBox(spec);
    const whole = moduleCentre(spec);
    const part = moduleCentre(weld);
    // The welded part's middle, along the module from its centre.
    const offset = (part.x - whole.x) * cos(module.angle) + (part.y - whole.y) * sin(module.angle);
    const c = cos(angle);
    const s = sin(angle);
    const cx = bx + module.x * c - module.y * s;
    const cy = by + module.x * s + module.y * c;
    const own = angle + module.angle;
    const along = (x - cx) * cos(own) + (y - cy) * sin(own);
    return abs(along - offset) <= weld.length * 0.5 + WELD_REACH;
}

/** How much of the smaller module's narrower side a hooked edge catches. */
const HOOK_SHARE = 0.5;

/**
 * The closing speeds a claw takes best between, m/s: quicker than a ragged
 * edge hooks, since jaws are made to close on what meets them, and short of
 * a ram. Below the band it has too little to bite with; above it, up to
 * `CLAW_SPEED_MAX`, it is more likely to glance off.
 */
export const CLAW_SPEED_LOW = 1;
export const CLAW_SPEED_HIGH = 4;
export const CLAW_SPEED_MAX = 8;

/** Chance a claw takes a sound module in its band. Certain on one spent. */
export const CLAW_GRIP_CHANCE = 0.8;

/**
 * How hard a claw has to be pushed back, stabbing in (`collision.ts`), before
 * it bites, per metre of its width, N: a heavier ship bites coming in slower.
 */
export const CLAW_BITE_FORCE = 5e4;

/** Seconds a claw that missed waits before it tries again. */
export const CLAW_RETRY = 0.5;

/** Share of a gripped module's capacity the jaws take as they close. */
export const CLAW_BITE = 0.1;

/** The closing speed a pilot brings its claw in at, m/s: the middle of its band. */
const CLAW_APPROACH = (CLAW_SPEED_LOW + CLAW_SPEED_HIGH) / 2;

/** Seconds a claw ship keeps the face it chose to grip before looking again, while still out past the gate. */
const GRIP_RECHOOSE = 1;
/**
 * How far out from a face, in the gripping ship's radii, nothing of its source
 * may stand for the face to have room in front of it: room to come in, and
 * for what docks with it once it holds on, rather than the floor of a notch.
 */
const GRIP_CLEAR = 4;
/** The share of the braking it has that a claw ship plans its last approach on. */
const GRIP_BRAKING = 0.5;
/** How far off square to its face, radians, a claw may be and still close on it. */
const GRIP_SQUARE = 0.15;
/** How far off the line out from its grip point a claw may be and still close, as a share of the jaws' width, where its face leaves it less. */
const GRIP_LINE = 0.5;

/** The most a fighter may be moving against a pad and still land on it, m/s: settling, not arriving. */
export const PAD_SPEED = 1;

/**
 * How long, seconds, a docking ship takes to trust a change in how what it is
 * docking with is accelerating: long enough that a knock does not throw it,
 * short enough to follow a carrier opening its throttle.
 */
const DOCK_ACCEL_SETTLE = 0.25;

/** The most two ports may be closing at and still mate, m/s: a nudge, not a bump. */
export const PORT_SPEED = 1;

/** Cosine of how far from face to face two ports may meet and still mate: 30°. */
const PORT_ALIGN = 0.8660254037844386;

/** The speed a pilot closes the last stretch onto a port at, m/s. */
const PORT_APPROACH = 0.5;

/** How far off a port, in its own radii, a pilot lines up before closing in. */
const PORT_STANDOFF_RADII = 1;

/** How far off its heading, radians, a pilot may be and still close the last stretch. */
const PORT_HEADING_SLACK = 0.1;

/**
 * How far out a fighter making for a pad lines itself up with it, in its own
 * radii. Further off it points where it is going.
 */
const PAD_ALIGN_RADII = 4;

/**
 * How far round a friend, radians, a ship coming in from the wrong side for a
 * pad or a port steers at a time: it circles the hull outside its radius rather
 * than flying through what stands between it and where it is going.
 */
const HULL_ORBIT_STEP = 0.5;

/**
 * How much shorter a trip round a carrier, radians, another way in to a pad
 * has to be before a fighter gives up the one it is taking, so one coming in
 * dead astern does not swing between the two corners either side.
 */
const WAY_STICK = 0.3;

/**
 * How full a robot's bar is drawn, 0 to 1: what it is carrying home while it
 * fetches, whether taking wreckage apart or bound for or out on rock, or else
 * what it still has to spend mending.
 */
function robotLoad(robot: Robot): number {
    const fetching = robot.strip || robot.bound >= 0 || robot.away >= 0 || robot.cargo + robot.cargoFuel > 0;
    return (fetching ? robot.cargo + robot.cargoFuel : robot.metal) / ROBOT_LOAD;
}

/** How much of a module's half-length and half-breadth the robots on it stand within, so all are seen on it. */
const ROBOT_SPOT_SHARE = 0.6;
/** How far about where its claw grips a robot of a moored ship stands, as a share of its spot on the claw. */
const ROBOT_GRIP_SPREAD = 0.3;

/** Which turn a module takes to be mended: cores, then engines and weapons, then the rest. */
/** Less metal than this a robot carries, or a hull holds, is rounding rather than metal, kg. */
const ROBOT_SPENT = 1e-6;

/** A ship's hull matched to the design it set out as, for rebuilding what it has lost. */
/** What a module of wreckage being taken apart was whole, and how far down it has come. */
interface StripShape {
    /** It whole, in its hull's frame. */
    readonly spec: ModuleSpec;
    readonly stats: ModuleStats;
    /** The face its walls go down towards. */
    readonly face: number;
    /** How much of its walls still stand. */
    readonly share: number;
}

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

function yardFor(design: ShipDesign): Yard | null {
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

interface Rebuild {
    /** The hull this was worked out for. */
    readonly design: ShipDesign;
    /** Each launch module's index in the hull, or -1 for one it has lost. */
    readonly at: Int32Array;
    /** A hull module of the same compiled design as the launch, whole, for laying the rest out by; -1 for none. */
    readonly frame: number;
    /** Walls each launch module's next shell step has had, kg: kept while the hull is remade. */
    readonly work: Float64Array;
    /** Each hull module's launch module a refit fits out in its walls (`swapFor`), or -1; worked out when first asked. */
    swaps: Int32Array | null;
}

/** Whether two modules stand in the same place with walls of the same shape, whatever they are. */
function sameWalls(a: ModuleSpec, b: ModuleSpec): boolean {
    const near = (u: number, v: number): boolean => abs(u - v) <= 1e-6 * (1 + abs(u));
    if (!near(a.x, b.x) || !near(a.y, b.y) || !near(a.length, b.length) || !near(a.width, b.width)) return false;
    if (!(abs(angleDelta(a.angle ?? 0, b.angle ?? 0)) <= 1e-6)) return false;
    const va = a.vertices ?? [];
    const vb = b.vertices ?? [];
    return va.length === vb.length && va.every((v, k) => near(v, vb[k]!));
}

/** The module of its compiled design a hull module is, for what tier rebuilding it falls in. */
function originTier(approach: Approach, design: ShipDesign, m: number): number {
    const origin = originOf(design, m);
    return repairTier(approach, origin.design, origin.module);
}

/**
 * How soon a module is mended or rebuilt, lowest first: by its doctrine's
 * priority for mending it (`mendCorePriority` and the rest).
 */
function repairTier(approach: Approach, design: ShipDesign, m: number): number {
    return -priorityOf(approach, mendClaim(design, m));
}

/**
 * What a ship is flown and worked on with: cores, robot bays and the
 * generators that charge its robots, which a refit puts up first and takes
 * down last, so as much of the work goes on as can.
 */
function workforce(kind: string): boolean {
    return kind === "core" || kind === "robotBay" || kind === "generator";
}

/** Whether body `b` holds less than `share` of a full load of `store` on module `m`'s piece, with room for more. */
function short(store: Store, b: number, m: number, share: number): boolean {
    const held = store.pieceHeld(b, m);
    const room = store.pieceRoom(b, m);
    return room > 0 && held < share * (held + room);
}

/** A design's engines' exhaust speed, m/s, weighted by their thrust; 0 for one with none. */
const EXHAUST = new WeakMap<ShipDesign, number>();
function exhaustOf(design: ShipDesign): number {
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

/** Half of each of a design's modules' diagonals, metres: the circle round its box. */
const SIZES = new WeakMap<ShipDesign, Float64Array>();
function moduleSizes(design: ShipDesign): Float64Array {
    let sizes = SIZES.get(design);
    if (sizes === undefined) {
        sizes = new Float64Array(design.modules.length);
        for (let m = 0; m < sizes.length; m++) sizes[m] = 0.5 * length(design.modules[m]!.spec.length, design.modules[m]!.spec.width);
        SIZES.set(design, sizes);
    }
    return sizes;
}

/**
 * The chance a claw pushed back with `force` takes a module left at
 * `integrity`: none short of `bite`, and past it likelier the more the module
 * has already been torn open.
 */
export function clawChance(force: number, bite: number, integrity: number): number {
    if (!(force >= bite) || !(force > 0)) return 0;
    const worn = integrity < 0 ? 1 : integrity > 1 ? 0 : 1 - integrity;
    return CLAW_GRIP_CHANCE + (1 - CLAW_GRIP_CHANCE) * worn;
}

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
 * How much more charge a kilogram of rock takes robots to mine than a
 * kilogram of wreckage to strip: they smelt its ore and melt its ice as they
 * cut it out. A first guess.
 */
export const MINING_POWER = 3;

/**
 * How fast a claw with no robots melts fuel out of the rock it grips, kg/s,
 * and the charge each kilogram takes, J: it heats the rock round the ice too,
 * and keeps none of the ore. First guesses, slower and far dearer than robots.
 */
export const CLAW_HEAT_RATE = 1;
export const CLAW_HEAT_ENERGY = 5e6;

/** A body's mass to divide by: a pinned one's, nought, is no mass at all but one nothing moves. */
function movable(mass: number): number {
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

    private readonly designs: (ShipDesign | null)[] = [];
    /** What each ship's robots rebuild it to: the design it set out as, or that of the ship it flew off. */
    private readonly launched: ShipDesign[] = [];
    /** Each ship's hull matched to its launch design (`rebuildFor`). */
    private readonly rebuilds: (Rebuild | null)[] = [];
    /** Shell steps finished this tick, as ship, launch module, the module built from, the one paying and its body if another's, else -1. */
    private readonly grows: number[] = [];
    /**
     * What a module of wreckage being taken apart was whole, by the spec of the
     * shell it is now: what each step down is cut from, and the face it goes
     * down towards.
     */
    private readonly stripShapes = new WeakMap<ModuleSpec, StripShape>();
    /** A module of wreckage with a step of it taken apart this tick, by body: -1 for none. */
    private readonly stripped: number[] = [];
    /** Rock bodies and modules, in pairs, that moored ships' robots have taken a step of this step. */
    private readonly rockSteps: number[] = [];
    /**
     * Each ship's own doctrine, as it set out. A ship riding a merged hull shares
     * that hull's design, so its doctrine is read from here rather than from it.
     */
    private readonly doctrines: Doctrine[] = [];
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
    /** The well each pinned hull rides, by body index (`ShipSpec.rides`). */
    private readonly rides: (WellSpec | undefined)[] = [];
    /** Every hull that has ridden a well, live or not. */
    private readonly riders: BodyId[] = [];
    private bodyStore: Bodies | null = null;

    /** What every ship has taken, by body index. */
    readonly damage = new Damage();
    /** What each body has left in its tanks. */
    readonly fuel = new Fuel();
    readonly metal = new Metal();
    readonly power = new Charge();
    /** Who gets the stores' contents when there is not enough to go round. */
    private readonly supply = new Supply([this.fuel, this.metal, this.power]);
    /** The world's step, for `supply`. */
    private tick = 0;
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
    private readonly names: string[] = [];
    /** Whether a ship has had a piece fly off it this step, flown from a core of its own. */
    private readonly parted: number[] = [];
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
    /** Whether each ship set out with a gun or an engine to lose; a piece takes its ship's. */
    private readonly couldFight: number[] = [];
    /** 1 for a fighter its doctrine has taken down into the hull layer as well. */
    private readonly committed: number[] = [];
    /** Whether each ship has turned its main engines along its want rather than its guns to its target. */
    private readonly burning: number[] = [];
    /** Whether each ship is on the run out of an attacking pass or back in, where its guns wait for its mains. */
    private readonly running: number[] = [];
    /** Which way round each ship is going on an attack, +1 or -1, or 0 before it has picked. */
    private readonly passSide: number[] = [];
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
    /** And its angular momentum about the origin, kg·m²/s. */
    discardedL = 0;

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
     * Body index → the name painted on each of its cores, null for any other
     * module. Painted by whoever builds the core and never changed, so it goes
     * with the module wherever the hull takes it.
     */
    private readonly paint: ((string | null)[] | null)[] = [];

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
    /** The world tick each ship's claws last tried to close, so a miss waits `CLAW_RETRY`. */
    private readonly clawTried: number[] = [];

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
    /** A fighter's `fightReach` as it landed on a pad, or as the one a pad is building will be. */
    private readonly landedReach: number[] = [];
    /** The ship its doctrine has committed it to ramming, or `NO_TARGET`. Kept until that ship is out of the fight. */
    private readonly ramming: number[] = [];
    /** The tick each ship last fired a gun or a beam, or -1. */
    private readonly firedAt: number[] = [];
    /** What each ship has broken off to drink from with its claw, or `NO_TARGET`. */
    private readonly salvaging: number[] = [];
    /** The tick each ship next reconsiders whether, and where, to refuel. */
    private readonly forageAt: number[] = [];
    /** Whether each ship is refuelling: from running low until its claw's piece is full. */
    private readonly refuelling: number[] = [];
    /** Whether each ship is being filled at a friend's port: from running down to `refuelBelow` until it is full. */
    private readonly docking: number[] = [];
    /** Whether each ship is taking fuel to a friend: from setting out until it has given what it can spare. */
    private readonly delivering: number[] = [];
    /** Whether each ship's doctrine has it withdrawing, to hide or flee (`decide`). */
    private readonly withdrawing: number[] = [];
    /** What each withdrawing ship hides behind, or `NO_TARGET` to flee. */
    private readonly hiding: number[] = [];
    /** Whether each fighter is rearming: from running low on metal until it is full. */
    private readonly rearming: number[] = [];
    /** Whether each ship has been docked under the errand it is on, which then ends when the dock lets go. */
    private readonly errandDocked: number[] = [];
    /** Each ship's doctrine as its design has it, before anything it has been told over it. */
    private readonly ownDoctrines: Doctrine[] = [];
    /** What each ship has been told over its doctrine, or undefined for nothing. */
    private readonly overrides: (DoctrineOverride | undefined)[] = [];
    /** Each ship's mounts' doctrines with its override, by mount, for the design they were worked out for. */
    private readonly mountDoctrines: ({ design: ShipDesign; byMount: Map<DesignTurret, Targeting> } | null)[] = [];
    /** How many each pad and slipway is told to keep, by its module's lasting key, over its design's count. */
    private readonly keeps: (Readonly<Record<string, number>> | undefined)[] = [];
    /** What each pad and slipway is told to build, by its module's lasting key, over its design's craft. */
    private readonly crafts: (Readonly<Record<string, ShipDesign>> | undefined)[] = [];
    /** The carrier each fighter last set out from or landed on, or -1. */
    private readonly home: number[] = [];
    /** Whether each fighter is recharging: from running its batteries down until they are full. */
    private readonly recharging: number[] = [];
    /** The world tick `command` is flying. */
    private now = 0;
    /** The tick each ship last touched what it means to drink from without holding it. */
    private readonly touchedSource: number[] = [];
    /**
     * Where each claw ship means to take hold (`chooseGrip`): the body, the hull
     * it was chosen on and the module it is on, and the point and the face's
     * outward normal in that hull's frame about its centre of mass, so it turns
     * with the hull. The tick it was chosen, to look again from.
     */
    private readonly gripBody: number[] = [];
    private readonly gripHull: (ShipDesign | null)[] = [];
    private readonly gripModule: number[] = [];
    private readonly gripX: number[] = [];
    private readonly gripY: number[] = [];
    private readonly gripNx: number[] = [];
    private readonly gripNy: number[] = [];
    /** How far the jaws may land either side of the grip point and still be on its face, m. */
    private readonly gripSlack: number[] = [];
    /** Whether each claw ship is closing straight in on its grip point, rather than making for the gate. */
    private readonly gripClosing: number[] = [];
    private readonly gripAt: number[] = [];
    /** The heading `squareUp` last asked for. */
    private gripHeading = 0;
    /** Each module's outline while a face is chosen, flat, and where each starts in it. */
    private readonly gripOutlines: number[] = [];
    private readonly gripStarts: number[] = [];
    /** The pad, by module of its ship's design, a fighter is making for to refuel; -1 for none. */
    private readonly landingPad: number[] = [];
    /**
     * The carrier each fighter is parked on, or -1. A parked fighter keeps its
     * own body, which shots and beams hit, but is pinned to its pad, meets no
     * other hull, and weighs on the carrier (`park`).
     */
    private readonly parkedOn: number[] = [];
    /** The pad it is parked on, by module of its carrier's launch design. */
    private readonly parkedPad: number[] = [];
    /** Where its blueprint's origin sits in the pad's frame, and which way it points in it. */
    private readonly parkedX: number[] = [];
    private readonly parkedY: number[] = [];
    private readonly parkedAngle: number[] = [];
    /** Its mass as its carrier last counted it. */
    private readonly parkedMass: number[] = [];
    /**
     * For a ship moored to an asteroid by its claw, rather than parked on a pad,
     * the claw, by module of its own hull; -1 for any other. A moored ship is
     * parked with no pad (`parkedPad` -1), posed in its rock's blueprint frame.
     */
    private readonly mooredClaw: number[] = [];
    /** Where its claw grips, in the rock's blueprint frame. */
    private readonly mooredGripX: number[] = [];
    private readonly mooredGripY: number[] = [];
    /** Each asteroid's fastest closing on another this run of touching, m/s, and the last step it touched one. */
    private readonly rockMet: number[] = [];
    private readonly rockMetAt: number[] = [];
    /** Scratch for drawing: the robots stranded on one rock. */
    private readonly strandedHere: Robot[] = [];
    /** Robots left on a rock by a ship no longer moored there, with the side they are on and the ship that left them. */
    private readonly stranded: { robot: Robot; team: number; home: number }[] = [];
    /** Scratch for two rocks becoming one: each stranded robot on either, and where it stands, world frame, in threes. */
    private readonly rebasingStranded: number[] = [];
    /** Scratch for two rocks becoming one: each moored ship, and where it grips, world frame, in threes. */
    private readonly rebasing: number[] = [];
    /** Every fighter parked. */
    private readonly parkedShips: number[] = [];
    /** Each carrier's fighters by the pad that keeps them (`ShipDesign.builds`); null for a ship whose pads build none. */
    private readonly broods: (Brood | null)[] = [];
    /** Whether each fighter is being built on its pad, from its core laid down until it is whole. */
    private readonly unfinished: number[] = [];
    /** Each builder's slipways and what they are building; null for a ship with none that builds. */
    private readonly yards: (Yard | null)[] = [];
    /** Whether each ship is still going up on a slipway, its walls not yet all built. */
    private readonly printing: number[] = [];
    /** The ship that built each ship on a slipway, while the ship is still clearing it; -1 for none. */
    private readonly clearing: number[] = [];
    /** The tick each such ship was let go. */
    private readonly clearingSince: number[] = [];
    /** Scratch for a module's outline, measured against a slipway's face. */
    private readonly faceCorners: number[] = [];
    /** The tick each carrier last put work into a fighter it is building; -1 for never. */
    private readonly builtAt: number[] = [];
    /** Whether each ship has been refitted to a design other than the one it set out as (`refit`). */
    private readonly refitting: number[] = [];
    /** The port, by module of its ship's design, a ship is making for to refuel; -1 for none. */
    private readonly dockPort: number[] = [];
    /** Which of its own ports it means to mate with it; -1 for none. */
    private readonly ownPort: number[] = [];
    /** Where `aroundHull` last said to steer for, world metres. */
    private wayX = 0;
    private wayY = 0;
    /** The way in `wayIn` last chose, world radians, and where it leaves the carrier's circle, world metres. */
    private wayAngle = 0;
    private entryX = 0;
    private entryY = 0;
    /** The way in to its pad each fighter is taking, in its carrier's frame, and the pad and body it is for; NaN for none. */
    private readonly landingWay: number[] = [];
    private readonly landingWayPad: number[] = [];
    private readonly landingWayBody: number[] = [];
    /**
     * What each ship is covering, which is never what it is fighting: a consort
     * is by definition something it will not shoot at. Chosen on the same
     * schedule as the fight and pulled on every step, since where a craft is
     * relative to its charge changes far faster than which charge it wants.
     */
    private readonly consort: number[] = [];
    /** The blend of steering urges being accumulated for one craft, and the acceleration each wants matched. */
    private urgeVx = 0;
    private urgeVy = 0;
    private urgeAx = 0;
    private urgeAy = 0;
    private urgeWeight = 0;
    /**
     * What each ship docking last saw of the point it is docking with: its
     * velocity, the tick it was seen, and its acceleration as worked out from
     * them, settled over `DOCK_ACCEL_SETTLE`.
     */
    private readonly dockSeenVx: number[] = [];
    private readonly dockSeenVy: number[] = [];
    private readonly dockSeenAt: number[] = [];
    private readonly dockAx: number[] = [];
    private readonly dockAy: number[] = [];
    /** The heaviest dodge in the blend: how much it is wanted, and seconds until the near miss. */
    private dodgeWeight = 0;
    private dodgeWhen = 0;
    /** Whether that dodge is from a rock. */
    private dodgeRock = false;
    /** Where the threats a fleeing craft weighs lie, as a weighted sum of directions to them (`threats`). */
    private threatX = 0;
    private threatY = 0;
    /** How many things the last `armedShare` counted. */
    private tools = 0;
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
    /** What the pilot is fighting, what it is covering, and what it is weighing up. Reused, never shared. */
    private readonly fightAt = spot();
    private readonly coverAt = spot();
    private readonly lookAt = spot();
    private readonly sizeAt = spot();
    /** Where a shot would land, for the friendly check. Reused, never shared. */
    private readonly lineOfFire = new RayHit();
    /** The ships that are asteroids, and a flag by ship, as of step `rocksAt`. */
    private readonly rockShips: number[] = [];
    private readonly rockFlag: number[] = [];
    private rocksAt = -1;
    /** How deep the line `blockingRock` last looked along cuts the rock it named, nothing to one. */
    private blockDepth = 0;

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
        return this.fuel.pieceHeld(b, module) > 0;
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
    private painted(i: number, design: ShipDesign, m: number): string | null {
        if (design.modules[m]!.spec.kind !== "core") return null;
        const number = this.launched[i]!.cores.length > 1 ? this.coreNumber(i, design, m) : 0;
        return number > 0 ? `${this.names[i]}.${number}` : this.names[i]!;
    }

    /** The name painted on module `m` of body `b`, or null for anything but a core. */
    private paintAt(b: number, m: number): string | null {
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
        if (this.fuel.spentMass(bodyIdx) > 0 || this.metal.spentMass(bodyIdx) > 0) this.settleMass(world.bodies, bodyIdx);
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
            if (this.detach(world, i, design, group)) others.push({ ship: before, group });
        }
        this.reshape(world, i, design, main);
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
            this.merge(world, i, ship, where[mine]!, group.indexOf(theirs), { at: "a", kind: "port" });
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
        this.landedReach[f] = this.fightReach(f);
        this.park(bodies, i, f, pad);
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
        const reach = this.fightReach(i);
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
    private escortBand(i: number, design: ShipDesign, target: number): number {
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
    private locate(bodies: Bodies, t: number, tb: number, out: Spot): Spot {
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
        const leaving = this.tools === 0 ? !(this.fightReach(i) > 0) : share <= approach.fleeArmed;
        if (!leaving) return false;
        if (fighting !== NO_TARGET && this.rams(i, fighting)) return false;
        for (let e = 0; e < this.alive.length; e++) if (this.hostile(i, e) && this.armed(e)) return true;
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
            if (d > range || this.dangerNear(bodies, i, tb) > 0) return -1;
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
    private armedShare(i: number, b: number, stores: boolean): number {
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
        if (approach.scavengeFuelBelow > 0 && this.workingClaw(i, b) >= 0) return false;
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
                if (metalRoom > 0 && this.metal.pieceHeld(tb, pad) > this.metalReserve(tb, pad)) return true;
                if (chargeRoom > 0 && this.power.pieceHeld(tb, pad) > this.chargeReserve(tb, pad)) return true;
            }
        }
        return false;
    }

    /** Whether a ship of footprint `box` fits on `pad`, either way round. */
    private fitsPad(box: Footprint, pad: ModuleSpec): boolean {
        const long = box.maxX - box.minX;
        const wide = box.maxY - box.minY;
        return (long <= pad.length && wide <= pad.width) || (long <= pad.width && wide <= pad.length);
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
        // Parked, it meets nothing of its carrier, so would look clear on the pad and drop into its hull when let go.
        const ramming = order !== undefined && order.target !== NO_TARGET && (order.ram || order.grapple) && this.parkedOn[i]! < 0;
        const want = ramming ? 1 : 0;
        if (want === this.committed[i] || !this.clearOfHulls(bodies, b)) return;
        this.committed[i] = want;
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
    private shipLayers(i: number): number {
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
            const from = this.fleeTarget(given);
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
    private liveConsort(bodies: Bodies, i: number, b: number): number {
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
    private keepFor(i: number, module: number, keep: number): number {
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
    private craftFor(i: number, module: number, craft: ShipDesign): ShipDesign {
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
    private commanded(i: number): boolean {
        const given = this.getCurrentOrder(i);
        return given !== undefined && given.errand === undefined;
    }

    /** Whether ship `i` was told where to go on its errand, so armed enemies near it are not to put it off. */
    private sentTo(i: number): boolean {
        const given = this.getCurrentOrder(i);
        return given?.errand !== undefined && given.target !== NO_TARGET;
    }

    /** The friend this ship is ordered to defend, or `NO_TARGET`. */
    private defendingOf(i: number): number {
        const given = this.getCurrentOrder(i);
        return given !== undefined && given.defend === true ? given.target : NO_TARGET;
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
    private blockingRock(bodies: Bodies, fromX: number, fromY: number, toX: number, toY: number, own: number, to: number): number {
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
        if (this.orders[i]?.[0]?.errand !== undefined) this.stopForaging(i);
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
            if (!hide && !this.armed(target)) return false;
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
        this.stopForaging(i);
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
    private nextOrder(i: number): void {
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
            if (this.mooredClaw[this.parkedShips[k]!]! >= 0) this.pin(bodies, this.parkedShips[k]!);
        for (let k = 0; k < this.parkedShips.length; k++)
            if (this.mooredClaw[this.parkedShips[k]!]! < 0) this.pin(bodies, this.parkedShips[k]!);
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
            this.power.open(b, dt, this.damage);
            this.power.close(b);
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
            if (b >= 0 && this.shipByBody[b] === i) this.power.open(b, dt, this.damage);
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
            this.removeInvalidOrders(i);
            this.decide(world, bodies, i);
            this.forage(world, bodies, i);
            this.decideTurrets(world, bodies, i);
            this.flyOne(dt, bodies, i, grid);
            this.commitOne(bodies, i);
            this.trainOne(bodies, i);
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

        // What nothing drew on charges the batteries.
        for (let i = 0; i < this.alive.length; i++) {
            if (this.alive[i] === 0) continue;
            const b = bodies.indexOf(this.bodyIds[i]!);
            if (b >= 0 && this.shipByBody[b] === i) this.power.close(b);
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
                    if (this.allowed(Resource.Metal, bodyIdx, mount, Claim.Fire, gun.roundMass) < gun.roundMass) continue;
                    if (!this.metal.load(bodyIdx, mount, gun.roundMass)) continue;
                    this.took(Resource.Metal, bodyIdx, mount, Claim.Fire, gun.roundMass);
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
            if (loaded) this.settleMass(bodies, bodyIdx);
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
        if (orders[0]?.errand !== undefined) this.stopForaging(i);
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
        this.urgeAx = 0;
        this.urgeAy = 0;
        this.urgeWeight = 0;
        this.dodgeWeight = 0;
        this.dodgeRock = false;
        let wantAngle = bodies.angle[b]!;
        // What it is fighting, if anything: the body, and how far out it holds it.
        let fighting = -1;
        let holdOut = 0;

        // Of two ships docked by their ports, the smaller idles and the larger
        // flies the pair: two pilots on one body would pull it apart.
        const partner = this.portPartner(i, b);
        if (partner >= 0) {
            const mass = this.ownMass(i, b);
            const theirs = this.ownMass(partner, b);
            if (mass < theirs || (mass === theirs && i > partner)) {
                this.idle(i);
                return;
            }
        }

        // Sat on a pad, however it got there: the pad lets it go, and its engines
        // would only push the carrier and burn the deck.
        if (this.onPad(i, b)) {
            this.idle(i);
            return;
        }

        // Just off a slipway, drifting clear: its engines stay off while they would
        // burn its builder, unless it is drifting back into it, as a well under an
        // anchored builder pulls it.
        const builder = this.clearing[i]!;
        if (builder >= 0) {
            const bb = this.alive[builder] === 1 ? bodies.indexOf(this.bodyIds[builder]!) : -1;
            const waited = (this.now - this.clearingSince[i]!) * dt;
            const back =
                bb >= 0 &&
                (bodies.x[b]! - bodies.x[bb]!) * (bodies.vx[b]! - bodies.vx[bb]!) +
                    (bodies.y[b]! - bodies.y[bb]!) * (bodies.vy[b]! - bodies.vy[bb]!) <
                    0;
            if (bb >= 0 && grid !== undefined && waited < SLIPWAY_CLEAR_TIME && !back && this.wouldBurn(bodies, grid, i, bb)) {
                this.idle(i);
                return;
            }
            this.clearing[i] = -1;
        }

        // No order at all is the same problem as an order with no target: hold
        // what you are doing and wait to be told something.
        const order = this.effectiveOrder(i);
        const target = order?.target ?? NO_TARGET;
        const fleeing = order?.flee === true;
        // Running, it points its mains the way it wants to go, as a ram does.
        let running = false;
        if (fleeing) {
            running = this.flee(bodies, i, b, order!);
            this.avoid(bodies, i, b, NO_TARGET, NO_TARGET);
        } else if (order !== undefined && target !== NO_TARGET && this.alive[target] === 1) {
            const tb = bodies.indexOf(this.bodyIds[target]!);
            // Holding it in its claw, or sat on its pad: nothing to fly for while it drinks.
            if ((order.grapple || order.land) && tb === b) {
                this.idle(i);
                return;
            }
            const claw = order.grapple ? this.workingClaw(i, b) : -1;
            if (order.dock) {
                // Docked and the larger, it flies the pair, wanting nothing but to hold still.
                if (tb >= 0 && tb !== b) wantAngle = this.dockOn(dt, bodies, i, b, tb, this.dockPort[i]!, this.ownPort[i]!);
            } else if (order.land && tb >= 0) {
                wantAngle = this.landOn(dt, bodies, i, b, tb, this.landingPad[i]!);
            } else if (order.grapple && claw < 0) {
                this.salvaging[i] = NO_TARGET;
            } else if (claw >= 0 && tb >= 0) {
                // The jaws, not the bow, are what point at it.
                const jaws = this.designs[i]!.modules[claw]!.spec.angle ?? 0;
                const across = this.hullAcross(bodies, i, b, tb, target);
                if (across >= 0) {
                    wantAngle = this.roundHull(bodies, i, b, across, tb) - jaws;
                } else {
                    const standOff = this.now - this.touchedSource[i]! < CLAW_RETRY / dt;
                    let radial: number;
                    // Lining up square takes turning both ways: one that cannot stop a turn closes on the middle.
                    const layout = this.layoutOf(i);
                    if (layout.maxTorque(1) > 0 && layout.maxTorque(-1) > 0 && this.chooseGrip(bodies, i, b, tb, target, claw, dt)) {
                        radial = this.squareUp(bodies, i, b, tb, claw, standOff);
                        wantAngle = this.gripHeading;
                    } else {
                        wantAngle = atan2(bodies.y[tb]! - bodies.y[b]!, bodies.x[tb]! - bodies.x[b]!) - jaws;
                        radial = this.grapple(bodies, i, b, tb, claw, wantAngle, standOff);
                    }
                    // An asteroid comes on in its orbit: match its motion on the mains first, then turn the jaws to it.
                    if (this.isAsteroid(target)) wantAngle = this.matchOrbit(bodies, i, b, tb, wantAngle, radial);
                }
            } else if (tb >= 0 && tb !== b) {
                // Not hooked on to it, which would leave nowhere to steer for.
                const at = this.locate(bodies, target, tb, this.fightAt);
                wantAngle = atan2(at.y - bodies.y[b]!, at.x - bodies.x[b]!);
                if (!order.ram) {
                    wantAngle = this.attackHeading(i, b, at, bodies, wantAngle);
                    fighting = tb;
                    holdOut = order.maxRange;
                }
                if (order.ram) this.charge(bodies, b, at, order.approachSpeed);
                else {
                    this.hold(bodies, i, b, at, order.minRange, order.maxRange, order.approachSpeed, URGE_REFERENCE, wantAngle);
                    this.orbit(bodies, i, b, at, tb);
                }
            }
        }

        // A ram overrides the rest of the doctrine: no cover, and no keeping clear
        // but of rocks and friends; and so does closing on a source, which means
        // touching it, but for a hulk coming through. Landing keeps clear of all
        // but its carrier, since two making for neighbouring pads cross.
        if (order?.grapple === true) this.avoid(bodies, i, b, target, NO_TARGET, true);
        if (order?.ram === true) this.avoid(bodies, i, b, target, NO_TARGET, false, true);
        if (order?.land === true) this.avoid(bodies, i, b, target, NO_TARGET, false, false, true);
        if (!fleeing && (order === undefined || !(order.ram || order.grapple || order.land || order.dock))) {
            const covering = this.cover(bodies, i, b);
            if (target === NO_TARGET && covering >= 0) {
                const cb = bodies.indexOf(this.bodyIds[covering]!);
                if (cb >= 0) wantAngle = atan2(bodies.y[cb]! - bodies.y[b]!, bodies.x[cb]! - bodies.x[b]!);
                // Defending and on station, it turns its main battery on the attacker.
                const attacker = covering === this.defendingOf(i) ? this.chosenOf(i) : NO_TARGET;
                const ab = attacker === NO_TARGET ? -1 : bodies.indexOf(this.bodyIds[attacker]!);
                if (cb >= 0 && ab >= 0 && ab !== b) {
                    const gap = length(bodies.x[cb]! - bodies.x[b]!, bodies.y[cb]! - bodies.y[b]!);
                    if (gap <= this.escortBand(i, this.designs[i]!, covering)) {
                        const at = this.locate(bodies, attacker, ab, this.lookAt);
                        wantAngle = this.attackHeading(i, b, at, bodies, atan2(at.y - bodies.y[b]!, at.x - bodies.x[b]!));
                    }
                }
            }
            // Clear of what it is covering, as of anything else: a charge is
            // stationed on, never flown into.
            this.avoid(bodies, i, b, target, covering);
        }

        // Nothing to want is a want of its own: a craft with no orders, no charge
        // and nothing in its way kills its drift and waits.
        const wantVx = this.urgeWeight > 0 ? this.urgeVx / this.urgeWeight : 0;
        const wantVy = this.urgeWeight > 0 ? this.urgeVy / this.urgeWeight : 0;
        const leadAx = this.urgeWeight > 0 ? this.urgeAx / this.urgeWeight : 0;
        const leadAy = this.urgeWeight > 0 ? this.urgeAy / this.urgeWeight : 0;

        if (fighting < 0) this.brakingOnMains[i] = 0;
        if (fighting >= 0) wantAngle = this.burnOrFight(i, b, this.fightAt, bodies, wantAngle, wantVx, wantVy, holdOut);
        else this.burning[i] = 0;

        // A ram is a race to the target, so it points its main thrust along the
        // change of velocity it needs rather than its nose at the target.
        if (order?.ram === true || running) {
            const dvx = wantVx - bodies.vx[b]!;
            const dvy = wantVy - bodies.vy[b]!;
            if (dvx * dvx + dvy * dvy > RAM_AIM_SPEED * RAM_AIM_SPEED) wantAngle = atan2(dvy, dvx);
        } else if (this.dodgeRock && 2 * this.dodgeWeight >= this.urgeWeight) {
            // So is getting out of a rock's way, once that is most of what it wants:
            // held on target, a heavy hull's thrusters push it aside too slowly to miss.
            const dvx = wantVx - bodies.vx[b]!;
            const dvy = wantVy - bodies.vy[b]!;
            if (dvx * dvx + dvy * dvy > RAM_AIM_SPEED * RAM_AIM_SPEED) wantAngle = atan2(dvy, dvx) - this.designs[i]!.thrustBearing;
        }

        const mass = bodies.mass[b]!;
        // The allocator works in the body frame, so the demand is rotated into it.
        const angle = bodies.angle[b]!;
        // A ram asks for far more than any layout gives, and a saturated ask for
        // force leaves nothing to stop a turn with. So it points, then burns: the
        // force asked for falls away with how far off its heading still is.
        const aligned = order?.ram === true ? max(0, cos(angleDelta(angle, wantAngle))) : 1;
        const response = this.doctrines[i]!.approach.responseTime;
        const worldFx = aligned * mass * ((wantVx - bodies.vx[b]!) / response + leadAx);
        const worldFy = aligned * mass * ((wantVy - bodies.vy[b]!) / response + leadAy);
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
        // Planned on the torque that stops the turn, not the one that starts it.
        // On a lopsided layout those differ, and a turn planned on the stronger
        // overshoots past half round, where the error wraps and it goes round again.
        const brakeTorque = layout.maxTorque(error >= 0 ? -1 : 1);
        const maxAlpha = inertia > 0 ? brakeTorque / inertia : 0;
        const turn = min(brakingRate(error, maxAlpha, dt), (error >= 0 ? error : -error) / HEADING_SETTLE_TIME);
        let wantRate = error >= 0 ? turn : -turn;
        // Never round into something, but for what it means to touch: a turn that
        // would swing the hull into a neighbour is not started, and one already
        // under way is stopped.
        const touching = order !== undefined && (order.ram || order.grapple || order.land || order.dock) ? target : NO_TARGET;
        if (wantRate !== 0 && this.turnBlocked(bodies, i, b, layout, wantRate > 0 ? 1 : -1, touching)) wantRate = 0;
        const localTorque = dt > 0 ? (inertia * (wantRate - bodies.angularVel[b]!)) / dt : 0;

        // Engines the designer meant as weapons, lit because something worth
        // burning is behind them. Decided before the allocation and taken off the
        // demand, so the rest of the layout spends its step cancelling the push
        // rather than discovering it next step and chasing it forever.
        const firing = this.aimEngines(bodies, grid, i, layout);
        let demandFx = localFx;
        let demandFy = localFy;
        let demandTorque = clamp(localTorque, -layout.maxTorque(-1), layout.maxTorque(1));
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
        // Asked for more force than it has, the allocator can give up the turn for
        // it, and a lopsided layout can even turn the wrong way. So ask for less: a
        // ram until it gets most of its turn, anything else only while a turn worth
        // having is starved, since a lopsided hull loses a little whenever it pushes.
        const ram = order?.ram === true;
        for (let k = 0; k < FORCE_HALVINGS; k++) {
            const got = this.allocation.torque;
            const short = demandTorque - got;
            if (abs(short) <= maxTorque * TORQUE_NEGLIGIBLE) break;
            if (ram) {
                if (abs(short) <= 0.5 * abs(demandTorque)) break;
            } else {
                const sense = demandTorque >= 0 ? 1 : -1;
                if (abs(demandTorque) <= TURN_SHARE * layout.maxTorque(sense)) break;
                if (got * sense >= TURN_SHARE * abs(demandTorque)) break;
                const missX = demandFx - this.allocation.fx;
                const missY = demandFy - this.allocation.fy;
                if (missX * missX + missY * missY <= 0.25 * (demandFx * demandFx + demandFy * demandFy)) break;
            }
            demandFx *= 0.5;
            demandFy *= 0.5;
            layout.allocate(demandFx, demandFy, demandTorque, throttles, this.allocation);
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
    private attackHeading(i: number, b: number, at: Spot, bodies: Bodies, towards: number): number {
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
        const region = attackBearing(arcs, current, this.doctrines[i]!.approach.turnBias, design.thrustBearing, this.attackRegion);
        if (region.speed > 0) {
            const dx = at.x - bodies.x[b]!;
            const dy = at.y - bodies.y[b]!;
            const dvx = at.vx - bodies.vx[b]!;
            const dvy = at.vy - bodies.vy[b]!;
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
        at: Spot,
        bodies: Bodies,
        attack: number,
        wantVx: number,
        wantVy: number,
        maxRange: number,
    ): number {
        const design = this.designs[i]!;
        const approach = this.doctrines[i]!.approach;
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

        const range = length(at.x - bodies.x[b]!, at.y - bodies.y[b]!);
        // On the run out of a pass or back in, its guns wait for its mains.
        const near = this.running[i] === 1 ? 0 : range > maxRange && maxRange > 0 ? maxRange / range : 1;
        const burn = approach.burnWeight * gain;
        const hold = approach.rangeHold * near;
        // Committed to stopping on its mains: it holds them against its way in
        // whatever the score, since its approach was planned on them.
        if (this.brakingOnMains[i] === 1) {
            this.burning[i] = 1;
            return atan2(bodies.y[b]! - at.y, bodies.x[b]! - at.x) - design.thrustBearing;
        }
        const now = this.burning[i] === 1 ? burn * (1 + BURN_MARGIN) > hold : burn > hold * (1 + BURN_MARGIN);
        this.burning[i] = now ? 1 : 0;
        return now ? burnHeading : attack;
    }

    /**
     * Whether turning the way `sense` says (+1 anticlockwise) would swing part
     * of this hull into a neighbour other than `touching`.
     *
     * Module by module, each as the circle round its box, since what a turn
     * sweeps is the ends of a hull and not its middle. It would when a module
     * the turn carries towards a module of another hull is nearer it than the
     * hull needs to stop turning that way, from the rate it has, plus
     * `TURN_CLEARANCE_RADII`.
     */
    private turnBlocked(bodies: Bodies, i: number, b: number, layout: EngineLayout, sense: number, touching: number): boolean {
        const design = this.designs[i]!;
        const x = bodies.x[b]!;
        const y = bodies.y[b]!;
        const w = bodies.angularVel[b]! * sense;
        const inertia = bodies.inertia[b]!;
        // How far round it would go before it could stop, at most half a turn:
        // past that it reaches everything it can.
        const alpha = inertia > 0 ? layout.maxTorque(-sense) / inertia : 0;
        const stop = w > 0 ? (alpha > 0 ? min(PI, (w * w) / (2 * alpha)) : PI) : 0;
        // A point turned through that is moved this share of its distance out.
        const chord = 2 * sin(0.5 * stop);
        const margin = TURN_CLEARANCE_RADII * design.radius;
        const sweep = design.radius * chord + margin;
        let c = NaN;
        let sn = NaN;
        const myLayers = this.shipLayers(i);
        // By body: a carrier holding something in its claw is one body with it, which either may ride first.
        const touched = touching === NO_TARGET || this.alive[touching] === 0 ? -1 : bodies.indexOf(this.bodyIds[touching]!);
        for (let t = 0; t < this.alive.length; t++) {
            if (t === i || t === touching || this.alive[t] === 0) continue;
            const ob = bodies.indexOf(this.bodyIds[t]!);
            if (ob < 0 || ob === b || ob === touched || bodies.ghost[ob] === 1 || !this.meets(b, ob)) continue;
            // A body walked once, however many ships ride it.
            if (this.shipByBody[ob] !== t) continue;
            const theirs = this.designs[t]!;
            const ox = bodies.x[ob]!;
            const oy = bodies.y[ob]!;
            if (!(length(ox - x, oy - y) < design.radius + theirs.radius + sweep)) continue;
            if (c !== c) {
                c = cos(bodies.angle[b]!);
                sn = sin(bodies.angle[b]!);
            }
            const oc = cos(bodies.angle[ob]!);
            const os = sin(bodies.angle[ob]!);
            const mine = moduleSizes(design);
            const sizes = moduleSizes(theirs);
            const theirLayers = this.layersOf(ob);
            for (let k = 0; k < design.modules.length; k++) {
                const m = design.modules[k]!;
                const layers = moduleLayers(m, myLayers);
                const rx = m.x * c - m.y * sn;
                const ry = m.x * sn + m.y * c;
                const room = length(rx, ry) * chord + margin;
                const size = mine[k]!;
                // Too far from the whole of the other hull to reach any of it.
                if (!(length(ox - x - rx, oy - y - ry) < size + theirs.radius + room)) continue;
                for (let q = 0; q < theirs.modules.length; q++) {
                    const n = theirs.modules[q]!;
                    // A fighter overflies thin hull, its own pad among it.
                    if ((moduleLayers(n, theirLayers) & layers) === 0) continue;
                    const dx = ox + n.x * oc - n.y * os - x - rx;
                    const dy = oy + n.x * os + n.y * oc - y - ry;
                    // Clearly out of reach, without the square root.
                    const reach = size + sizes[q]! + room;
                    if (dx * dx + dy * dy > reach * reach * (1 + 1e-9) + 1e-9) continue;
                    // Anticlockwise carries this module along (-ry, rx).
                    if (!(sense * (-ry * dx + rx * dy) > 0)) continue;
                    if (length(dx, dy) - size - sizes[q]! < room) return true;
                }
            }
        }
        return false;
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
    private aimEngines(bodies: Bodies, grid: SpatialGrid | undefined, i: number, layout: EngineLayout): number {
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
            const rays = engine === undefined ? 0 : plumeRays(geometryOf(engine));
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

    /**
     * Add one want to the blend: a velocity, how much it is wanted, and the
     * acceleration of whatever that velocity is following, which is matched as
     * well as closed on: a velocity alone is always a step behind a target that
     * is speeding up.
     */
    private urge(weight: number, vx: number, vy: number, ax = 0, ay = 0): void {
        if (!(weight > 0)) return;
        this.urgeVx += weight * vx;
        this.urgeVy += weight * vy;
        this.urgeAx += weight * ax;
        this.urgeAy += weight * ay;
        this.urgeWeight += weight;
    }

    /**
     * How ship `i`, docking, sees the point it is docking with accelerating, from
     * that point's velocity now and when it last looked, into `dockAx`, `dockAy`.
     * A look that is not the step after the last starts afresh.
     */
    private dockingAccel(i: number, vx: number, vy: number, dt: number): void {
        if (this.dockSeenAt[i] === this.now - 1 && dt > 0) {
            const settle = min(1, dt / DOCK_ACCEL_SETTLE);
            this.dockAx[i] = this.dockAx[i]! + ((vx - this.dockSeenVx[i]!) / dt - this.dockAx[i]!) * settle;
            this.dockAy[i] = this.dockAy[i]! + ((vy - this.dockSeenVy[i]!) / dt - this.dockAy[i]!) * settle;
        } else {
            this.dockAx[i] = 0;
            this.dockAy[i] = 0;
        }
        this.dockSeenVx[i] = vx;
        this.dockSeenVy[i] = vy;
        this.dockSeenAt[i] = this.now;
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
    /**
     * Go round an asteroid hiding `at`, on body `tb`, from ship `i`: orbit it
     * the short way round to where `at` is, at the distance it is now, or clear
     * of it if that is too close. As fast as holds that distance in the rock's
     * pull, so it coasts round on a free orbit; a rock with no pull keeps it
     * going round at the speed it has. As loud as the rock is deep in the way.
     */
    private orbit(bodies: Bodies, i: number, b: number, at: Spot, tb: number): void {
        const approach = this.doctrines[i]!.approach;
        if (!(approach.orbitWeight > 0)) return;
        const x = bodies.x[b]!;
        const y = bodies.y[b]!;
        const rock = this.blockingRock(bodies, x, y, at.x, at.y, b, tb);
        if (rock < 0) return;
        const rb = bodies.indexOf(this.bodyIds[rock]!);
        const ox = x - bodies.x[rb]!;
        const oy = y - bodies.y[rb]!;
        const r = length(ox, oy);
        if (!(r > 0)) return;
        const ux = ox / r;
        const uy = oy / r;
        // The way round that is shorter to where the target is.
        const sense = ux * (at.y - bodies.y[rb]!) - uy * (at.x - bodies.x[rb]!) >= 0 ? 1 : -1;
        const rvx = bodies.vx[b]! - bodies.vx[rb]!;
        const rvy = bodies.vy[b]! - bodies.vy[rb]!;
        this.wellPullOn(bodies, b, rb);
        const free = sqrt(length(this.partAt.x, this.partAt.y) * r);
        const speed = free > 0 ? free : min(length(rvx, rvy), approach.approachSpeed);
        const clear = bodies.radius[rb]! + this.designs[i]!.radius * (1 + approach.separationRadii);
        const out = r < clear ? (clear - r) / approach.responseTime : 0;
        this.urge(
            approach.orbitWeight * URGE_REFERENCE * this.blockDepth,
            bodies.vx[rb]! - sense * uy * speed + ux * out,
            bodies.vy[rb]! + sense * ux * speed + uy * out,
        );
    }

    private charge(bodies: Bodies, b: number, at: Spot, speed: number): void {
        const dx = at.x - bodies.x[b]!;
        const dy = at.y - bodies.y[b]!;
        const range = length(dx, dy);
        const close = range > 0 ? speed / range : 0;
        this.urge(URGE_REFERENCE, at.vx + dx * close, at.vy + dy * close);
    }

    private hold(
        bodies: Bodies,
        i: number,
        b: number,
        at: Spot,
        minRange: number,
        maxRange: number,
        approachSpeed: number,
        weight: number,
        fightingAt?: number,
    ): void {
        const fighting = fightingAt !== undefined;
        // Set again below while it is still closing on a curve planned on its mains.
        const wasOnMains = this.brakingOnMains[i] === 1;
        if (fighting) {
            this.brakingOnMains[i] = 0;
            this.running[i] = 0;
        }
        if (!(weight > 0)) return;
        const dx = at.x - bodies.x[b]!;
        const dy = at.y - bodies.y[b]!;
        const range = length(dx, dy);
        if (fighting && range > 0 && this.doctrines[i]!.approach.tangentialMax > 0) {
            this.pass(bodies, i, b, at, dx / range, dy / range, range, minRange, maxRange, approachSpeed, fightingAt, weight);
            return;
        }
        let vx = at.vx;
        let vy = at.vy;
        if (range > 0) {
            // How far outside the band, signed: positive means too far away.
            const outside = range > maxRange ? range - maxRange : range < minRange ? range - minRange : 0;
            if (outside !== 0) {
                // The way the band lies, and how fast this craft is already heading
                // that way relative to the other.
                const sense = outside > 0 ? 1 : -1;
                const ux = (sense * dx) / range;
                const uy = (sense * dy) / range;
                const making = (bodies.vx[b]! - vx) * ux + (bodies.vy[b]! - vy) * uy;

                const approach = this.doctrines[i]!.approach;
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
                        arrivalTime(mains, gap, approachSpeed, response + turn) + turn < arrivalTime(brake, gap, approachSpeed, response);
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
     * Attack on the move, for a doctrine that wants sideways speed: hold it
     * between `tangentialMin` and `tangentialMax` relative to the target, going
     * round whichever way it already is, since that costs the least.
     *
     * Out past the band it flies the line that grazes a circle at the band's
     * inner edge, so it comes in aiming to miss and its speed is sideways by the
     * time it is in range; it may close faster than that far out, no faster
     * than it can slow to it by the band. In the band it circles if it has the
     * speed and its thrust can hold the turn at it, closing no further inside
     * the inner edge; otherwise it carries on through on a pass. Out past the
     * band on the far side, the same line points it back, which is a turn onto
     * its mains for the next pass.
     */
    private pass(
        bodies: Bodies,
        i: number,
        b: number,
        at: Spot,
        ux: number,
        uy: number,
        range: number,
        minRange: number,
        maxRange: number,
        approachSpeed: number,
        facing: number,
        weight: number,
    ): void {
        const approach = this.doctrines[i]!.approach;
        const lo = approach.tangentialMin;
        const hi = approach.tangentialMax;
        const rvx = bodies.vx[b]! - at.vx;
        const rvy = bodies.vy[b]! - at.vy;
        const across = ux * rvy - uy * rvx;
        // Kept until it is plainly going round the other way, so a craft with
        // next to no sideways speed does not flip from side to side.
        let side = this.passSide[i]!;
        if (side === 0 || across * side < -lo / 2) side = across < 0 ? -1 : 1;
        this.passSide[i] = side;
        const tx = -uy * side;
        const ty = ux * side;
        const closing = rvx * ux + rvy * uy;
        const speed = clamp(across * side, lo, hi);
        const inner = minRange > 0 ? minRange : maxRange / 2;
        let wantX: number;
        let wantY: number;
        if (range > maxRange) {
            this.running[i] = 1;
            const arrive = clamp(approachSpeed, lo, hi);
            const brake = approach.brake * this.accelerationAlong(bodies, i, b, -ux, -uy, facing);
            const fly = max(arrive, min(approachSpeed, sqrt(arrive * arrive + 2 * brake * (range - maxRange))));
            const graze = min(1, inner / range);
            const straight = sqrt(1 - graze * graze);
            wantX = (ux * straight + tx * graze) * fly;
            wantY = (uy * straight + ty * graze) * fly;
        } else {
            // Circles only once it has the speed. Short of it, it carries on through
            // if it is passing, or heads out if not, and the run back in on its
            // mains brings it.
            const pull = approach.accelerate * this.accelerationAlong(bodies, i, b, ux, uy, facing);
            const circling = across * side >= lo && (speed * speed) / range <= pull;
            const arrive = clamp(approachSpeed, lo, hi);
            const passing = circling || closing > lo / 2;
            const radial = circling ? (range < inner ? min(closing, 0) : 0) : passing ? closing : min(closing, -arrive);
            if (!passing) this.running[i] = 1;
            wantX = ux * radial + tx * speed;
            wantY = uy * radial + ty * speed;
        }
        this.urge(weight, at.vx + wantX, at.vy + wantY);
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
        const approach = this.doctrines[i]!.approach;
        const axis = this.layoutOf(i).maxThrustAlong(cos(design.thrustBearing), sin(design.thrustBearing)) / movable(bodies.mass[b]!);
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
        return force / movable(bodies.mass[b]!);
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
        const consort = this.liveConsort(bodies, i, b);
        if (consort === NO_TARGET) return NO_TARGET;
        const cb = bodies.indexOf(this.bodyIds[consort]!);

        const design = this.designs[i]!;
        const station = this.escortBand(i, design, consort);
        const gap = length(bodies.x[cb]! - bodies.x[b]!, bodies.y[cb]! - bodies.y[b]!);
        // Told to, it holds the band as firmly as it would a station.
        const weight = this.defendingOf(i) === consort ? URGE_REFERENCE : cohesionUrge(this.doctrines[i]!.targeting, gap, station);
        const told = this.getCurrentOrder(i);
        const speed = told?.defend === true && told.target === consort ? told.speed : undefined;
        this.hold(
            bodies,
            i,
            b,
            this.locate(bodies, consort, cb, this.coverAt),
            0,
            station,
            speed ?? this.doctrines[i]!.approach.approachSpeed,
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
    /** Whether ship `e` can hurt anything: a main gun that can fire, or a ram doctrine and the control to fly it. */
    private armed(e: number): boolean {
        if (this.alive[e] !== 1 || this.derelict[e] === 1) return false;
        return !this.isDisarmed(e) || (this.doctrines[e]!.approach.ramRadii > 0 && this.hasControl(e));
    }

    /**
     * What a flee order runs from or hides behind now: its target, or
     * `NO_TARGET` for every armed enemy, which is also what it falls back on
     * once an enemy it was running from can no longer hurt it, or cover it was
     * hiding behind is gone altogether. Cover destroyed is still hidden behind,
     * as a wreck.
     */
    private fleeTarget(order: Readonly<Order>): number {
        const t = order.target;
        if (t === NO_TARGET || this.alive[t] !== 1) return NO_TARGET;
        return order.hide === true || this.armed(t) ? t : NO_TARGET;
    }

    /**
     * Weigh the armed enemies of ship `i` whose reach, times its `fleeMargin`,
     * point (`x`, `y`) is inside: `only` alone, or all of them for `NO_TARGET`.
     * Each by how deep inside it is, and one with a gun on ship `i` by its
     * `aimedWeight` more. Leaves the weighted sum of directions to them in
     * `threatX` and `threatY`, and says how much they weigh in all.
     */
    private threats(bodies: Bodies, i: number, b: number, x: number, y: number, only: number): number {
        const approach = this.doctrines[i]!.approach;
        const mine = this.designs[i]!.radius;
        let tx = 0;
        let ty = 0;
        let total = 0;
        for (let e = 0; e < this.alive.length; e++) {
            if ((only !== NO_TARGET && e !== only) || !this.hostile(i, e) || !this.armed(e)) continue;
            const eb = bodies.indexOf(this.bodyIds[e]!);
            if (eb < 0 || eb === b) continue;
            const clear = (this.fightReach(e) + mine) * approach.fleeMargin;
            const dx = bodies.x[eb]! - x;
            const dy = bodies.y[eb]! - y;
            const d = length(dx, dy);
            if (!(d < clear) || !(d > 0)) continue;
            const weight = (1 - d / clear) * (this.aimsAt(e, i) ? approach.aimedWeight : 1);
            tx += (weight * dx) / d;
            ty += (weight * dy) / d;
            total += weight;
        }
        this.threatX = tx;
        this.threatY = ty;
        return total;
    }

    /** Whether any of ship `e`'s mounts is aimed at ship `i`. */
    private aimsAt(e: number, i: number): boolean {
        const aiming = this.turretAiming[e]!;
        for (let t = 0; t < aiming.length; t++) if (aiming[t] === i) return true;
        return false;
    }

    /**
     * Fly a flee order. Running from what is within reach of it, straight away
     * at its approach speed; clear of them all, easing off at `FLEE_EASE`, so it
     * neither leaves its friends behind nor has to brake hard to run again.
     * Hiding, round to its cover's side away from the threats to it, as close as
     * its keeping clear of anything holds it, and moving with it there. Says
     * whether it is running, to point its mains that way.
     */
    private flee(bodies: Bodies, i: number, b: number, order: Readonly<Order>): boolean {
        const approach = this.doctrines[i]!.approach;
        const from = this.fleeTarget(order);
        const vx = bodies.vx[b]!;
        const vy = bodies.vy[b]!;
        const cb = from !== NO_TARGET && order.hide === true ? bodies.indexOf(this.bodyIds[from]!) : -1;
        if (cb >= 0 && cb !== b) return this.hide(bodies, i, b, cb);

        const weight = this.threats(bodies, i, b, bodies.x[b]!, bodies.y[b]!, from);
        if (weight > 0) {
            const away = length(this.threatX, this.threatY);
            if (away > 0) {
                this.urge(URGE_REFERENCE, (-this.threatX / away) * approach.approachSpeed, (-this.threatY / away) * approach.approachSpeed);
                return true;
            }
        }
        const speed = length(vx, vy);
        const keep = speed > 0 ? max(0, 1 - (FLEE_EASE * approach.responseTime) / speed) : 0;
        this.urge(URGE_REFERENCE, vx * keep, vy * keep);
        return false;
    }

    /** Fly round behind cover `cb`, from the threats to it, or the nearest armed enemy when none is in reach of it. */
    private hide(bodies: Bodies, i: number, b: number, cb: number): boolean {
        const approach = this.doctrines[i]!.approach;
        const cx = bodies.x[cb]!;
        const cy = bodies.y[cb]!;
        let tx = 0;
        let ty = 0;
        if (this.threats(bodies, i, b, cx, cy, NO_TARGET) > 0) {
            tx = this.threatX;
            ty = this.threatY;
        } else {
            let nearest = Infinity;
            for (let e = 0; e < this.alive.length; e++) {
                if (!this.hostile(i, e) || !this.armed(e)) continue;
                const eb = bodies.indexOf(this.bodyIds[e]!);
                if (eb < 0 || eb === b || eb === cb) continue;
                const d = length(bodies.x[eb]! - cx, bodies.y[eb]! - cy);
                if (d < nearest && d > 0) {
                    nearest = d;
                    tx = (bodies.x[eb]! - cx) / d;
                    ty = (bodies.y[eb]! - cy) / d;
                }
            }
        }
        // With nothing to hide from, it stays on whichever side it is.
        let sx = cx - bodies.x[b]!;
        let sy = cy - bodies.y[b]!;
        const toward = length(tx, ty);
        if (toward > 0) {
            sx = tx / toward;
            sy = ty / toward;
        } else {
            const d = length(sx, sy);
            if (d > 0) {
                sx /= d;
                sy /= d;
            }
        }
        const touching = this.designs[i]!.radius + bodies.radius[cb]!;
        const off = touching * (1 + max(0, approach.separationRadii));
        // The spot, and the way to it.
        const dx = cx - sx * off - bodies.x[b]!;
        const dy = cy - sy * off - bodies.y[b]!;
        const gap = length(dx, dy);
        let wx = bodies.vx[cb]!;
        let wy = bodies.vy[cb]!;
        if (gap > 0) {
            const ux = dx / gap;
            const uy = dy / gap;
            const push = this.accelerationAlong(bodies, i, b, ux, uy, bodies.angle[b]!);
            const brake = approach.brake * max(this.accelerationAlong(bodies, i, b, -ux, -uy, bodies.angle[b]!), BRAKE_FLOOR * push);
            const speed = min(approach.approachSpeed, stoppingSpeed(brake, gap, approach.responseTime));
            wx += ux * speed;
            wy += uy * speed;
        }
        this.urge(URGE_REFERENCE, wx, wy);
        return gap > touching;
    }

    private avoid(
        bodies: Bodies,
        i: number,
        b: number,
        flying: number,
        covering: number,
        hulksOnly = false,
        ramming = false,
        landing = false,
    ): void {
        const approach = this.doctrines[i]!.approach;
        if (!(approach.separation > 0) || !(approach.separationRadii > 0)) return;
        const mine = this.designs[i]!.radius;
        // A rock or a friend it is ramming rides the body it is ramming.
        const flyingBody = flying === NO_TARGET ? -1 : bodies.indexOf(this.bodyIds[flying]!);
        // Landing, nor the rock its carrier is moored to, which its pad sits against.
        const under = landing && flying !== NO_TARGET ? this.carrierBodyOf(bodies, flying) : -1;
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
            // Nor its own fighters: a carrier trusts what flies from its pads to
            // keep clear of it, rather than running from its wing as it comes and goes.
            if (this.home[t] === i) continue;
            if (hulksOnly && this.hasControl(t)) continue;
            // Ramming, it keeps clear of rocks and its own side, which nothing rams on purpose.
            if (ramming && !this.isAsteroid(t) && !(this.team[t] === this.team[i] && this.hasControl(t))) continue;
            const ob = bodies.indexOf(this.bodyIds[t]!);
            // Nothing to keep clear of in something that cannot be hit.
            if (ob < 0 || ob === b || bodies.ghost[ob] === 1 || !this.meets(b, ob)) continue;
            // Coming in to grip or land, it is among rocks on purpose, and keeps clear of them as of anything.
            const rock = this.rockFlag[t] === 1 && !hulksOnly && !landing;
            if ((ramming || rock) && ob === flyingBody) continue;
            if (ob === under) continue;

            const touching = mine + this.designs[t]!.radius;
            // Clear by its own size, not the other's, which would keep it a rock's or a carrier's breadth off.
            let room = (ramming ? mine : touching) * approach.separationRadii;
            // Its charge no further out than its station, or the two wants fight:
            // covering pulls it in to where keeping clear pushes it out.
            if (t === covering) room = min(room, max(0, this.escortBand(i, this.designs[i]!, t) - touching));
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
            const closest = speedSq > 0 ? max(0, -closing / speedSq) : 0;
            const missX = dx + rvx * closest;
            const missY = dy + rvy * closest;
            const miss = length(missX, missY);
            if (miss >= touching + room) continue;
            // Soon is when they touch, if they will: the closest the middles come is
            // far later than that for anything large.
            const when = miss < touching && speedSq > 0 ? max(0, closest - sqrt((touching * touching - miss * miss) / speedSq)) : closest;
            // A pass that would come within its own clearance of a rock is looked for
            // however far ahead it is: a rock is big, and does not get out of the way.
            const clearance = mine * approach.separationRadii;
            const need = rock ? touching + clearance - miss : 0;
            if (when > approach.avoidHorizon && !(need > 0)) continue;
            // Nor a friend coming to land on it or dock with it: shying away from
            // that is refusing it.
            if (this.salvaging[t] === i && (this.landingPad[t]! >= 0 || this.dockPort[t]! >= 0)) continue;

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

            let weight =
                when < approach.avoidHorizon
                    ? approach.separation * (1 - miss / (touching + room)) * (1 - when / approach.avoidHorizon)
                    : 0;
            if (need > 0) weight = max(weight, approach.separation * this.rockUrgency(bodies, i, b, need, clearance, when, awayX, awayY));
            if (weight > this.dodgeWeight) {
                this.dodgeWeight = weight;
                this.dodgeWhen = when;
                this.dodgeRock = rock;
            }
            this.urge(weight, vx + awayX * approach.dodgeSpeed, vy + awayY * approach.dodgeSpeed);
        }
    }

    /**
     * How loudly ship `i` should keep clear of a rock it will pass `need` metres
     * too close to in `when` seconds, from nothing to one.
     *
     * Against how long a sidestep takes it: turning its mains to (`awayX`,
     * `awayY`), and then pushing `need` metres aside on them. Loudest from when it
     * must start to make it, rising from nothing `rockMargin` seconds before
     * that, so a heavy hull that turns slowly looks further ahead than a fighter.
     * A dodge that only grew with nearness had a ship keep its guns on target
     * until a rock was too close to miss. Scaled by `need` against `clearance`
     * too, so it fades out at the edge of the clearance rather than stopping dead.
     */
    private rockUrgency(
        bodies: Bodies,
        i: number,
        b: number,
        need: number,
        clearance: number,
        when: number,
        awayX: number,
        awayY: number,
    ): number {
        const design = this.designs[i]!;
        const approach = this.doctrines[i]!.approach;
        const push = this.layoutOf(i).maxThrustAlong(cos(design.thrustBearing), sin(design.thrustBearing)) / bodies.mass[b]!;
        const turn = this.turnTime(bodies, i, b, angleDelta(bodies.angle[b]!, atan2(awayY, awayX) - design.thrustBearing));
        const takes = turn + approach.responseTime + (push > 0 ? sqrt((2 * need) / push) : Infinity);
        const soon = clamp((takes + approach.rockMargin - when) / approach.rockMargin, 0, 1);
        return (clearance > 0 ? min(1, need / clearance) : 1) * soon;
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
        this.settleShed(bodies);

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
            this.shakeLoose(world, k);
            pieces += this.answer(
                world,
                this.blowBody[k]!,
                this.blowModule[k]!,
                this.blowJx[k]!,
                this.blowJy[k]!,
                this.blowX[k]!,
                this.blowY[k]!,
            );
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
     * **A claw closes on what its bow meets**, sound or torn, at up to
     * `CLAW_SPEED_MAX` and by chance (`clawChance`), and its seam holds
     * `DOCK_HOLD` times harder and carries a fuel line (`pump`).
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
            const a = contacts.a[k]!;
            const b = contacts.b[k]!;
            const i = this.shipAt(bodies, a);
            const j = this.shipAt(bodies, b);
            // A pilot pressed against its source has to stand off and come again,
            // since leaning on it closes at nothing.
            if (i >= 0 && j >= 0 && this.salvaging[i] === j) this.touchedSource[i] = world.tick;
            if (i >= 0 && j >= 0 && this.salvaging[j] === i) this.touchedSource[j] = world.tick;
            // Pressed together, slowly: touching or drifting apart hooks nothing,
            // but for a claw stabbing in, which bites by how hard it is pushed back.
            const closing = contacts.closing[k]!;
            const stab = contacts.stab[k]!;
            // Rock meeting rock is judged by how fast it met, before giving slowed it.
            if (i >= 0 && j >= 0 && this.isAsteroid(i) && this.isAsteroid(j)) {
                this.rockTouch(i, closing, world.tick);
                this.rockTouch(j, closing, world.tick);
            }
            if (stab !== Stab.A && stab !== Stab.B && (!(closing > 0) || closing > CLAW_SPEED_MAX)) continue;
            if (i < 0 || j < 0 || joined?.has(i) === true || joined?.has(j) === true) continue;
            if (this.partedAt[i]! > settled || this.partedAt[j]! > settled) continue;
            if (this.damage.isProtected(a) || this.damage.isProtected(b)) continue;
            // Nothing joins a hull parked on a pad: it would lose its pad.
            if (this.isParkedBody(a) || this.isParkedBody(b)) continue;
            const ma = contacts.moduleA[k]!;
            const mb = contacts.moduleB[k]!;
            // A claw closes on what its bow meets, ragged or not.
            const nx = contacts.nx[k]!;
            const ny = contacts.ny[k]!;
            let claw: "a" | "b" | null = null;
            const force = contacts.impulse[k]! / world.dt;
            if (stab === Stab.A && this.grips(world, a, ma, b, mb, nx, ny, force)) claw = "a";
            else if (stab === Stab.B && this.grips(world, b, mb, a, ma, -nx, -ny, force)) claw = "b";
            // Two ports nudged face to face mate, when one ship was making for the other.
            const port = claw === null && this.mates(world, a, ma, b, mb, closing);
            // Rock meeting rock slowly sticks, as rubble does, torn or not; a minor
            // onto a major rides its rail, and two majors never meet on one.
            const pinnedA = bodies.pinned[a] === 1;
            const pinnedB = bodies.pinned[b] === 1;
            const rubble = claw === null && this.isAsteroid(i) && this.isAsteroid(j) && !(pinnedA && pinnedB);
            if (rubble && max(this.rockMet[i]!, this.rockMet[j]!) > WELD_SPEED) continue;
            // Nothing else but a claw holds on to an asteroid nothing moves.
            if ((pinnedA || pinnedB) && claw === null && !rubble) continue;
            if (claw === null && !port && !rubble) {
                if (closing > WELD_SPEED) continue;
                if (!this.damage.ragged(a, ma) && !this.damage.ragged(b, mb)) continue;
                const x = contacts.x[k]!;
                const y = contacts.y[k]!;
                if (!this.weldsAt(bodies, a, ma, x, y) || !this.weldsAt(bodies, b, mb, x, y)) continue;
            }
            // A claw on an asteroid moors to it, keeping its own body, rather than becoming one with it.
            if (claw !== null) {
                const holderBody = claw === "a" ? a : b;
                const rockBody = claw === "a" ? b : a;
                const holder = this.pilotAt(holderBody, claw === "a" ? ma : mb);
                const rock = this.pilotAt(rockBody, claw === "a" ? mb : ma);
                if (rock >= 0 && this.isAsteroid(rock)) {
                    // Only a ship flying its own body moors: one riding another's has no body of its own to pin.
                    if (holder < 0 || this.shipByBody[holderBody] !== holder) continue;
                    this.moor(bodies, holder, rock, claw === "a" ? ma : mb, contacts.x[k]!, contacts.y[k]!);
                    joined ??= new Set<number>();
                    joined.add(i);
                    joined.add(j);
                    contacts.impulse[k] = 0;
                    welded++;
                    continue;
                }
            }
            // A pinned major keeps its body and its rail; otherwise a flown hull
            // keeps its body; two wrecks keep the older's slot.
            const swap = pinnedB || (!pinnedA && this.derelict[i] === 1 && this.derelict[j] === 0);
            // Whatever is moored to either rock stays where it is on the one they make.
            if (rubble) this.holdMoorings(bodies, i, j);
            const dock: DockAt | null = port
                ? { at: swap ? "b" : "a", kind: "port" }
                : claw === null
                  ? null
                  : { at: (claw === "a") !== swap ? "a" : "b", kind: "claw" };
            if (swap) this.merge(world, j, i, mb, ma, dock);
            else this.merge(world, i, j, ma, mb, dock);
            if (rubble) this.rebaseMoorings(bodies);
            joined ??= new Set<number>();
            joined.add(i);
            joined.add(j);
            // The contact is now inside one body: its impulse is no blow to answer.
            contacts.impulse[k] = 0;
            welded++;
        }
        return welded;
    }

    /** Note asteroid `i` touching rock at `closing` m/s at `tick`: the fastest of a run of touching steps, afresh after a step apart. */
    private rockTouch(i: number, closing: number, tick: number): void {
        if (this.rockMetAt[i]! < tick - 1) this.rockMet[i] = 0;
        this.rockMetAt[i] = tick;
        if (closing > this.rockMet[i]!) this.rockMet[i] = closing;
    }

    /** `onWeldablePart` for module `m` of body `b`, as it is posed now. */
    private weldsAt(bodies: Bodies, b: number, m: number, x: number, y: number): boolean {
        const module = this.hullDesign[b]?.modules[m];
        return module === undefined || onWeldablePart(module, bodies.x[b]!, bodies.y[b]!, bodies.angle[b]!, x, y);
    }

    /**
     * Whether port `ma` of body `a` and port `mb` of body `b` mate: both still
     * working, worked by two friends both under control, met within 30° of face
     * to face at no more than `PORT_SPEED`, and one of the two making for
     * exactly this pair of ports.
     */
    private mates(world: World, a: number, ma: number, b: number, mb: number, closing: number): boolean {
        if (closing > PORT_SPEED) return false;
        const da = this.hullDesign[a];
        const db = this.hullDesign[b];
        if (da === null || da === undefined || db === null || db === undefined) return false;
        const sa = da.modules[ma]!.spec;
        const sb = db.modules[mb]!.spec;
        if (sa.kind !== "port" || sb.kind !== "port") return false;
        const i = this.pilotAt(a, ma);
        const j = this.pilotAt(b, mb);
        if (i < 0 || j < 0 || i === j || this.hostile(i, j) || this.team[i] !== this.team[j]) return false;
        if (!this.hasControl(i) || !this.hasControl(j)) return false;
        if (!(this.left(i, a, ma, DamageEffect.Grip) > 0) || !(this.left(j, b, mb, DamageEffect.Grip) > 0)) return false;
        const bodies = world.bodies;
        const fa = bodies.angle[a]! + (sa.angle ?? 0);
        const fb = bodies.angle[b]! + (sb.angle ?? 0);
        if (cos(fa - fb) > -PORT_ALIGN) return false;
        const wants = (s: number, t: number, own: number, theirs: number): boolean =>
            this.salvaging[s] === t &&
            this.ownPort[s] === own &&
            this.dockPort[s] === theirs &&
            !this.threatened(bodies, s, s === i ? b : a, true);
        return wants(i, j, ma, mb) || wants(j, i, mb, ma);
    }

    /**
     * Whether module `m` of body `b` is a claw that closes on module `mo` of
     * body `o`, met along `nx`, `ny` (pointing from the claw into what it met)
     * pushed back with `force`. Rolls for it, so only a claw that could take asks the
     * battle's generator anything; a miss leaves the claw's ship waiting
     * `CLAW_RETRY`. Taking bites the module it closes on.
     *
     * A claw goes for wrecks and enemies, never a friend still under control,
     * and only for fuel it has room for, or for a wreck its ship's robots could
     * take apart into metal it has room for.
     */
    private grips(world: World, b: number, m: number, o: number, mo: number, nx: number, ny: number, force: number): boolean {
        const design = this.hullDesign[b];
        if (design === null || design === undefined) return false;
        const spec = design.modules[m]!.spec;
        if (spec.kind !== "claw") return false;
        const bite = CLAW_BITE_FORCE * spec.width;
        if (!(force >= bite)) return false;
        if (!(this.damage.remaining(b, m, DamageEffect.Grip) > 0)) return false;
        const bodies = world.bodies;
        const facing = bodies.angle[b]! + (spec.angle ?? 0);
        if (nx * cos(facing) + ny * sin(facing) < CLAW_ALIGN) return false;
        const holder = this.pilotAt(b, m);
        const held = this.pilotAt(o, mo);
        if (holder < 0 || held < 0 || holder === held) return false;
        const friend = !this.drinkable(holder, held);
        if (friend && !this.sentToDrink(holder, held)) return false;
        // A friend still flying gives only what it holds above its own reserve.
        const drinks = this.fuel.pieceRoom(b, m) > 0 && this.fuel.pieceHeld(o, mo) > (friend ? this.reserve(o, mo) : 0);
        // Rock is mined for its ice as well as its ore, and a claw alone can melt the ice out.
        const rock = this.hullDesign[o]?.modules[mo]?.spec;
        const ice = rock?.kind === "rock" ? (rock.ice ?? 0) : 0;
        const heats = ice > 0 && this.fuel.pieceRoom(b, m) > 0 && this.power.pieceHeld(b, m) > 0;
        const strips =
            (this.metal.pieceRoom(b, m) > 0 || (ice > 0 && this.fuel.pieceRoom(b, m) > 0)) &&
            (this.derelict[held] === 1 || (!this.hasControl(held) && !this.hasRobots(o, held))) &&
            this.canStrip(b, holder, m, world.dt);
        if (!drinks && !strips && !heats && !this.wantsAnchor(bodies, holder)) return false;
        if (!this.sentTo(holder) && this.threatened(bodies, holder, o, false)) return false;
        if (world.tick - this.clawTried[holder]! < CLAW_RETRY / world.dt) return false;
        this.clawTried[holder] = world.tick;
        if (world.rng.nextFloat() >= clawChance(force, bite, this.damage.integrity(o, mo))) return false;
        const capacity = this.damage.capacityLeft(o, mo) + this.damage.absorbedAt(o, mo);
        this.damage.absorb(o, mo, CLAW_BITE * capacity);
        return true;
    }

    /**
     * A claw melting fuel out of the rock it grips, for `dt` seconds of its
     * working: as fast as `CLAW_HEAT_RATE`, its piece's tanks have room and its
     * charge pays for, the rock it heats taken off whatever it gives. Says
     * whether it melted any.
     */
    private heat(b: number, design: ShipDesign, claw: number, held: number, dt: number): boolean {
        const spec = design.modules[held]!.spec;
        if (spec.kind !== "rock") return false;
        const ice = (spec.ice ?? 0) * (1 - DISASSEMBLY_WASTE);
        if (!(ice > 0) || !(dt > 0)) return false;
        const left = design.modules[held]!.stats.mass - this.damage.unbuiltAt(b, held);
        let fuel = min(CLAW_HEAT_RATE * dt, this.fuel.pieceRoom(b, claw), left * ice);
        fuel = min(fuel, this.power.pieceHeld(b, claw) / CLAW_HEAT_ENERGY);
        if (!(fuel > ROBOT_SPENT)) return false;
        this.power.drain(b, claw, fuel * CLAW_HEAT_ENERGY);
        this.damage.unfit(b, held, fuel / ice);
        this.fuel.add(b, claw, fuel);
        return true;
    }

    /**
     * Pump what every working claw holds into its own piece of hull, and let go
     * once its piece is full or what it holds is dry, and say how many let go.
     *
     * A claw keeps hold while it cannot pump — its jaws are shut — so only one
     * that is still working decides it is done.
     */
    pump(world: World): number {
        this.tick = world.tick;
        const bodies = world.bodies;
        this.bodyStore = bodies;
        let released = 0;
        for (let i = 0; i < this.alive.length; i++) {
            if (this.alive[i] === 0) continue;
            const b = bodies.indexOf(this.bodyIds[i]!);
            // A body is walked once, by its primary, however many ships ride it.
            if (b < 0 || this.shipByBody[b] !== i) continue;
            const design = this.designs[i]!;
            const seams = design.seams;
            if (seams === undefined || this.damage.isProtected(b)) continue;
            let moved = false;
            for (const seam of seams) {
                if (seam.dock === undefined) continue;
                const working = this.damage.remaining(b, seam.a, DamageEffect.Grip);
                if (!(working > 0)) continue;
                if (seam.dock === "slipway") {
                    // Held while its walls go up, fitted out once they are, filled from
                    // what the builder can spare, and let go once it has all it can take.
                    const built = this.pilotAt(b, seam.b);
                    if (built >= 0 && this.printing[built] === 1) continue;
                    if (built >= 0 && this.unfinished[built] === 1) {
                        const joules = SLIPWAY_BUILD_PER_METRE * design.modules[seam.a]!.spec.width * working * world.dt;
                        if (this.tendAtFace(bodies, b, built, seam.a, joules)) this.builtAt[this.pilotAt(b, seam.a)] = world.tick;
                        else if (!this.atFace(b, built, seam.a)) this.unfinished[built] = 0;
                        continue;
                    }
                    if (built >= 0) {
                        const rate = design.modules[seam.a]!.stats.pumpRate * working * world.dt;
                        const cable = DOCK_POWER_PER_METRE * design.modules[seam.a]!.spec.width * working * world.dt;
                        if (this.dockPump(Resource.Fuel, this.fuel, b, seam.a, seam.b, rate, Claim.Slipway) > 0) moved = true;
                        if (this.dockPump(Resource.Metal, this.metal, b, seam.a, seam.b, rate, Claim.Slipway) > 0) moved = true;
                        this.dockPump(Resource.Charge, this.power, b, seam.a, seam.b, cable, Claim.Slipway);
                        const fuelLeft = this.fuel.pieceRoom(b, seam.b) > 0 && this.fuel.pieceHeld(b, seam.a) > this.reserve(b, seam.a);
                        const metalLeft =
                            this.metal.pieceRoom(b, seam.b) > 0 && this.metal.pieceHeld(b, seam.a) > this.metalReserve(b, seam.a);
                        const chargeLeft =
                            this.power.pieceRoom(b, seam.b) > 0 && this.power.pieceHeld(b, seam.a) > this.chargeReserve(b, seam.a);
                        if (fuelLeft || metalLeft || chargeLeft) continue;
                    }
                }
                const rate = design.modules[seam.a]!.stats.pumpRate * working * world.dt;
                // A ship that minds danger lets go the moment an armed enemy is in reach.
                if (seam.dock !== "slipway" && !this.threatenedAt(bodies, b, seam)) {
                    if (seam.dock === "claw") {
                        // A claw drinks what it holds, and holds on while its robots can take it apart.
                        const holder = this.pilotAt(b, seam.a);
                        const source = this.pilotAt(b, seam.b);
                        // A friend still flying, which it was sent to, gives what it holds above its reserve.
                        const kept = holder >= 0 && source >= 0 && !this.drinkable(holder, source) ? this.reserve(b, seam.b) : 0;
                        const offered = this.fuel.pieceHeld(b, seam.b) - kept;
                        if (offered > 0 && this.fuel.transfer(b, seam.b, seam.a, rate < offered ? rate : offered) > 0) moved = true;
                        if (this.fuel.pieceRoom(b, seam.a) > 0 && this.fuel.pieceHeld(b, seam.b) > kept) continue;
                        if (holder >= 0 && this.canStrip(b, holder, seam.a, world.dt) && this.strippable(holder, b, design, seam.a))
                            continue;
                        // Anchored while it builds, it holds on until what it is building is let go.
                        if (holder >= 0 && this.wantsAnchor(bodies, holder)) continue;
                        // With no robots to mine it, it melts the ice out of the rock itself.
                        if (holder >= 0 && this.heat(b, design, seam.a, seam.b, working * world.dt)) {
                            moved = true;
                            continue;
                        }
                    } else if (seam.dock === "port") {
                        // Two ports pass fuel, metal and charge into whichever ship is
                        // refuelling, from what the other can spare, and part once it is
                        // full, nothing more can be spared, or either is given an order.
                        const oa = this.pilotAt(b, seam.a);
                        const ob = this.pilotAt(b, seam.b);
                        // Or out of whichever is delivering, whether the other asked or not.
                        const intoB = (this.docking[ob] === 1 && this.docking[oa] !== 1) || this.delivering[oa] === 1;
                        const intoA = (this.docking[oa] === 1 && this.docking[ob] !== 1) || this.delivering[ob] === 1;
                        const ordered = this.commanded(oa) || this.commanded(ob);
                        const bothWorking = this.damage.remaining(b, seam.b, DamageEffect.Grip);
                        if (!(bothWorking > 0)) continue;
                        if (!ordered && (intoA || intoB)) {
                            const from = intoB ? seam.a : seam.b;
                            const to = intoB ? seam.b : seam.a;
                            // Through the narrower of the two couplings, as worn as the worse.
                            const narrower = min(design.modules[seam.a]!.stats.pumpRate, design.modules[seam.b]!.stats.pumpRate);
                            const flow = narrower * min(working, bothWorking) * world.dt;
                            // Delivering, it keeps what it means to keep over its reserve.
                            const over = this.fuel.pieceHeld(b, from) - this.keepsBack(b, from);
                            if (this.dockPump(Resource.Fuel, this.fuel, b, from, to, flow < over ? flow : over, Claim.Ports) > 0)
                                moved = true;
                            if (this.dockPump(Resource.Metal, this.metal, b, from, to, flow, Claim.Ports) > 0) moved = true;
                            // Charge alongside, through the narrower coupling's cabling.
                            const cable =
                                DOCK_POWER_PER_METRE *
                                min(design.modules[seam.a]!.spec.width, design.modules[seam.b]!.spec.width) *
                                min(working, bothWorking) *
                                world.dt;
                            this.dockPump(Resource.Charge, this.power, b, from, to, cable, Claim.Ports);
                            const fuelLeft = this.fuel.pieceRoom(b, to) > 0 && this.fuel.pieceHeld(b, from) > this.keepsBack(b, from);
                            const metalLeft = this.metal.pieceRoom(b, to) > 0 && this.metal.pieceHeld(b, from) > this.metalReserve(b, from);
                            const chargeLeft =
                                this.power.pieceRoom(b, to) > 0 && this.power.pieceHeld(b, from) > this.chargeReserve(b, from);
                            if (fuelLeft || metalLeft || chargeLeft) continue;
                        }
                    }
                }
                // Done: the dock lets go, which `sever` reads as the seam cut through.
                if (seam.dock === "slipway") {
                    // What it built holds its engines until it is clear (`pushOff`).
                    const built = this.pilotAt(b, seam.b);
                    if (built >= 0) {
                        this.clearing[built] = this.pilotAt(b, seam.a);
                        this.clearingSince[built] = world.tick;
                    }
                }
                const k = jointBetween(design, seam.a, seam.b);
                this.damage.cutWeld(b, k, seam.width);
                released++;
            }
            if (moved) this.settleMass(bodies, b);
            this.growAll(world);
        }
        for (let k = 0; k < this.parkedShips.length; k++) {
            const f = this.parkedShips[k]!;
            if (this.mooredClaw[f]! >= 0 ? this.tendMoored(world, f) : this.tendParked(world, f)) continue;
            this.unpark(bodies, f, world.tick);
            released++;
            k--;
        }
        this.growAll(world);
        return released;
    }

    /**
     * Pump up to `most` of resource `r` across a dock of body `b`, from module
     * `from`'s piece to module `to`'s, as `claim` of the giver, wanting what
     * the receiver has room for, and say how much went.
     */
    private dockPump(r: Resource, store: Store, b: number, from: number, to: number, most: number, claim: Claim): number {
        if (!(most > 0)) return 0;
        const spare = this.allowed(r, b, from, claim, store.pieceRoom(b, to));
        if (!(spare > 0)) return 0;
        const moved = store.transfer(b, from, to, most < spare ? most : spare);
        this.took(r, b, from, claim, moved);
        return moved;
    }

    /**
     * Work the pad fighter `f` is parked on, and say whether it holds it still.
     * One being built is built, and held until it is whole whatever else is
     * going on. Anything else is filled with fuel, metal and charge, each from
     * what the carrier can spare, and mended, and let go once it holds what its
     * doctrine leaves with (`launchFuel` and its kind), or all the carrier can
     * spare if that is less and the carrier is not anchored, and is mended; or
     * at once once given an order. Danger lets it go once loaded, mended or not. A pad
     * gone, or one that can no longer grip, lets go of anything.
     */
    private tendParked(world: World, f: number): boolean {
        const bodies = world.bodies;
        const pad = this.parkedPadOf(bodies, f);
        const fb = bodies.indexOf(this.bodyIds[f]!);
        if (pad < 0 || fb < 0 || this.alive[f] === 0 || this.derelict[f] === 1) return false;
        const c = this.parkedOn[f]!;
        const cb = this.carrierBodyOf(bodies, f);
        const working = this.damage.remaining(cb, pad, DamageEffect.Grip);
        if (!(working > 0)) return false;
        if (this.damage.isProtected(cb)) return true;
        const width = this.designs[c]!.modules[pad]!.spec.width;
        const work = PAD_REPAIR_PER_METRE * width * working * world.dt;
        if (this.unfinished[f] === 1) {
            const progress = this.mend(bodies, fb, f, pad, work, cb) || this.padBuild(bodies, fb, f, cb, pad, work);
            if (progress) this.builtAt[c] = world.tick;
            if (this.finished(fb, f, this.designs[f]!)) {
                this.unfinished[f] = 0;
                // Its reach as the fighter it now is, for whether it waits aboard.
                const whole = this.launched[f]!;
                const approach = this.doctrines[f]!.approach;
                this.landedReach[f] = whole.reach > 0 ? whole.reach : approach.ramRadii > 0 ? approach.approachSpeed * RAM_HORIZON : 0;
            }
            return true;
        }
        const into = this.designs[f]!.cores[0] ?? 0;
        const rate = this.designs[c]!.modules[pad]!.stats.pumpRate * working * world.dt;
        const cable = DOCK_POWER_PER_METRE * width * working * world.dt;
        const fuel = this.across(Resource.Fuel, this.fuel, cb, pad, fb, into, rate);
        const metal = this.across(Resource.Metal, this.metal, cb, pad, fb, into, rate);
        this.across(Resource.Charge, this.power, cb, pad, fb, into, cable);
        if (fuel > 0 || metal > 0) {
            this.settleMass(bodies, fb);
            this.settleMass(bodies, cb);
        }
        // Mended first, and then built back to what it set out as.
        let repairLeft = this.mend(bodies, fb, f, pad, work, cb);
        if (!repairLeft) repairLeft = this.padBuild(bodies, fb, f, cb, pad, work);
        if (this.commanded(f)) return false;
        // Loaded once it holds what its doctrine leaves with of each, or the
        // carrier has no more of it to spare and is not getting any: an anchored
        // carrier is mining or scavenging, so what it is short of is coming, and
        // it waits for it.
        const approach = this.doctrines[f]!.approach;
        const coming = this.isMoored(c);
        const fuelLeft =
            short(this.fuel, fb, into, approach.launchFuel) && (coming || this.fuel.pieceHeld(cb, pad) > this.reserve(cb, pad));
        const metalLeft =
            short(this.metal, fb, into, approach.launchMetal) && (coming || this.metal.pieceHeld(cb, pad) > this.metalReserve(cb, pad));
        const chargeLeft =
            short(this.power, fb, into, approach.launchCharge) && (coming || this.power.pieceHeld(cb, pad) > this.chargeReserve(cb, pad));
        const loaded = !fuelLeft && !metalLeft && !chargeLeft;
        // A ship that minds danger lets go once loaded if an armed enemy is in reach, mended or not.
        if (loaded && !this.sentTo(f) && this.threatened(bodies, f, cb, true)) return false;
        if (this.waitsAboard(bodies, f, fb)) return true;
        return !loaded || repairLeft;
    }

    /**
     * Pump up to `most` of resource `r` from the piece of body `from` module
     * `out` is on, as far as its pads may have it, into the piece of body `to`
     * module `into` is on, as far as it has room, and say how much went.
     */
    private across(r: Resource, store: Store, from: number, out: number, to: number, into: number, most: number): number {
        const room = store.pieceRoom(to, into);
        const amount = min(most, min(this.allowed(r, from, out, Claim.Pads, room), room));
        if (!(amount > 0)) return 0;
        const taken = store.drain(from, out, amount);
        const put = store.add(to, into, taken);
        // Anything there turned out to be no room for goes back.
        if (put < taken) store.add(from, out, taken - put);
        this.took(r, from, out, Claim.Pads, put);
        return put;
    }

    /**
     * Build some of what fighter `i`, on body `b` and parked on pad `pad` of
     * body `payB`, has lost since it set out, with `joules` of the pad's work: a
     * kilogram for each kilogram's worth of damage, as robots build, from the
     * metal and charge on the pad's piece of hull. Its fittings first, then a
     * shell's walls, then a module lost, against what is left of it, cores
     * first. Says whether it built anything.
     */
    private padBuild(bodies: Bodies, b: number, i: number, payB: number, pad: number, joules: number): boolean {
        const launch = this.launched[i];
        if (launch === undefined) return false;
        const design = this.hullDesign[b]!;
        const rebuild = this.rebuildFor(i, design);
        let best = -1;
        let bestBuild = -1;
        let bestTier = Infinity;
        const approach = this.doctrines[i]!.approach;
        for (let m = 0; m < design.modules.length; m++) {
            if (!this.ownsAt(i, b, m)) continue;
            if (design.modules[m]!.shell === undefined && !(this.damage.unbuiltAt(b, m) > 0)) continue;
            const tier = originTier(approach, design, m);
            if (tier < bestTier) {
                best = m;
                bestBuild = -1;
                bestTier = tier;
            }
        }
        if (best < 0 && rebuild.frame >= 0) {
            const compiled = originOf(design, rebuild.frame).design;
            for (const joint of joints(launch)) {
                if (joint.seam === true) continue;
                for (const [l, against] of [
                    [joint.a, joint.b],
                    [joint.b, joint.a],
                ] as const) {
                    const m = rebuild.at[against]!;
                    if (rebuild.at[l]! >= 0 || m < 0 || !this.ownsAt(i, b, m)) continue;
                    if (design.modules[m]!.shell !== undefined || originOf(design, m).design !== compiled) continue;
                    const tier = repairTier(approach, launch, l);
                    if (tier < bestTier) {
                        best = m;
                        bestBuild = l;
                        bestTier = tier;
                    }
                }
            }
        }
        if (best < 0) return false;
        const fitting = bestBuild < 0 && design.modules[best]!.shell === undefined;
        const l = fitting ? -1 : bestBuild >= 0 ? bestBuild : rebuild.at.indexOf(best);
        const origin = fitting ? null : originOf(launch, l);
        const whole = origin === null ? design.modules[best]!.stats : origin.design.modules[origin.module]!.stats;
        const work = buildWork(whole);
        const perKg = work * REPAIR_ENERGY_PER_JOULE;
        const waste = 1 + REPAIR_WASTE;
        const wall = whole.structureMass / SHELL_STEPS;
        const most = joules / work;
        const metal = this.allowed(Resource.Metal, payB, pad, Claim.Pads, fitting ? most * waste : wall * waste);
        let kg = min(most, this.allowed(Resource.Charge, payB, pad, Claim.Pads, most * perKg) / perKg);
        if (fitting) {
            kg = min(kg, metal / waste);
            if (!(kg > 0)) return false;
            const mass = bodies.mass[payB]!;
            const inertia = bodies.inertia[payB]!;
            const put = this.damage.fit(b, best, kg);
            if (!(put > 0)) return false;
            this.metal.drain(payB, pad, put * waste);
            this.power.drain(payB, pad, put * perKg);
            this.took(Resource.Metal, payB, pad, Claim.Pads, put * waste);
            this.took(Resource.Charge, payB, pad, Claim.Pads, put * perKg);
            this.settleMass(bodies, b);
            this.settleMass(bodies, payB);
            this.discardFrom(bodies, payB, mass, inertia);
            return true;
        }
        // Nothing to pay for the step with, or a step waiting on room to go up.
        if (metal < wall * waste) return false;
        kg = min(kg, wall - rebuild.work[l]!);
        if (!(kg > 0)) {
            if (rebuild.work[l]! >= wall) this.grows.push(i, l, best, pad, payB);
            return false;
        }
        rebuild.work[l] = rebuild.work[l]! + kg;
        this.power.drain(payB, pad, kg * perKg);
        this.took(Resource.Charge, payB, pad, Claim.Pads, kg * perKg);
        if (rebuild.work[l]! >= wall) this.grows.push(i, l, best, pad, payB);
        return true;
    }

    /** Put up every shell step finished since last asked (`grow`). */
    private growAll(world: World): void {
        for (let k = 0; k < this.grows.length; k += 5) {
            this.grow(world, this.grows[k]!, this.grows[k + 1]!, this.grows[k + 2]!, this.grows[k + 3]!, this.grows[k + 4]!);
        }
        this.grows.length = 0;
    }

    /**
     * Undo up to `joules` of the damage to ship `i`'s modules on body `b`, from
     * the metal and charge on module `from`'s piece of hull, reserves and all: cores first,
     * then engines and weapons, then the rest. Each joule takes
     * `REPAIR_ENERGY_PER_JOULE` of charge, and the metal it had shed and
     * `REPAIR_WASTE` more, which leaves the world. Says whether it mended
     * something and has more to mend.
     */
    private mend(bodies: Bodies, b: number, i: number, from: number, joules: number, payB = b): boolean {
        this.settleShed(bodies);
        const design = this.hullDesign[b]!;
        const approach = this.doctrines[i]!.approach;
        // What a step of it could use at most, for what its pads ask for.
        let wantMetal = 0;
        let hurt = false;
        for (let m = 0; m < design.modules.length; m++) {
            if (!this.ownsAt(i, b, m) || !(this.damage.absorbedAt(b, m) > 0)) continue;
            hurt = true;
            const most = min(joules / repairWork(design.modules[m]!.stats), this.damage.absorbedAt(b, m));
            wantMetal = max(wantMetal, this.damage.repairMetal(b, m, most) * (1 + REPAIR_WASTE));
        }
        if (!hurt) return false;
        let metal = this.allowed(Resource.Metal, payB, from, Claim.Pads, wantMetal);
        let charge = this.allowed(Resource.Charge, payB, from, Claim.Pads, joules * REPAIR_ENERGY_PER_JOULE);
        let budget = joules;
        let usedMetal = 0;
        let usedCharge = 0;
        let left = false;
        for (
            let tier = this.firstMend(approach, i, b, design, Infinity);
            tier > -Infinity;
            tier = this.firstMend(approach, i, b, design, tier)
        ) {
            for (let m = 0; m < design.modules.length; m++) {
                if (priorityOf(approach, mendClaim(design, m)) !== tier || !this.ownsAt(i, b, m)) continue;
                const absorbed = this.damage.absorbedAt(b, m);
                if (!(absorbed > 0)) continue;
                const work = repairWork(design.modules[m]!.stats);
                let undo = min(budget / work, charge / (work * REPAIR_ENERGY_PER_JOULE));
                // What it costs in metal rises no faster than the damage undone, so
                // cutting the damage down to the metal there is never asks for more.
                const kg = this.damage.repairMetal(b, m, undo) * (1 + REPAIR_WASTE);
                if (kg > metal) undo *= metal / kg;
                const cost = this.damage.repairMetal(b, m, undo) * (1 + REPAIR_WASTE);
                const undone = this.damage.repair(b, m, undo);
                // Its holes are the first thing plugged.
                if (undone > 0) this.fuel.seal(b, m);
                budget -= undone * work;
                metal -= cost;
                charge -= undone * work * REPAIR_ENERGY_PER_JOULE;
                usedMetal += cost;
                usedCharge += undone * work * REPAIR_ENERGY_PER_JOULE;
                if (this.damage.absorbedAt(b, m) > 0) left = true;
            }
        }
        if (!(usedCharge > 0)) return false;
        const mass = bodies.mass[payB]!;
        const inertia = bodies.inertia[payB]!;
        if (usedMetal > 0) this.metal.drain(payB, from, usedMetal);
        this.power.drain(payB, from, usedCharge);
        this.took(Resource.Metal, payB, from, Claim.Pads, usedMetal);
        this.took(Resource.Charge, payB, from, Claim.Pads, usedCharge);
        this.settleMass(bodies, b);
        // Paid for from a carrier, which carries what it mends.
        if (payB !== b) this.settleMass(bodies, payB);
        this.discardFrom(bodies, payB, mass, inertia);
        return left;
    }

    /**
     * The highest priority below `below` that mending any of ship `i`'s damaged
     * modules on body `b` has by doctrine `approach`; -Infinity for none.
     */
    private firstMend(approach: Approach, i: number, b: number, design: ShipDesign, below: number): number {
        let best = -Infinity;
        for (let m = 0; m < design.modules.length; m++) {
            if (!(this.damage.absorbedAt(b, m) > 0) || !this.ownsAt(i, b, m)) continue;
            const p = priorityOf(approach, mendClaim(design, m));
            if (p < below && p > best) best = p;
        }
        return best;
    }

    /**
     * Send every hull's robots about their work: out from their bays to what
     * needs mending most, mending it, and home to be refilled.
     *
     * A robot works only for the ship that works its bay, and only on that
     * ship's modules, but on what it carries: neither a ship with no control
     * nor a bay out of command or broken stops it, only one that cannot refill
     * it once it is spent. It goes
     * for cores first, then engines and weapons, then the rest, the nearest of
     * each, sharing out the work so two do not crowd one module while another
     * waits. Mending costs what it costs on a pad (`mend`): charge from what it
     * carries, and metal drawn from its piece of hull up to what it may spend.
     */
    tend(world: World): void {
        this.tick = world.tick;
        const bodies = world.bodies;
        this.bodyStore = bodies;
        const dt = world.dt;
        for (let b = 0; b < bodies.highWater; b++) {
            const robots = this.robots.on(b);
            const design = this.hullDesign[b];
            if (robots === null || design === null || design === undefined || bodies.alive[b] === 0) continue;
            // What was shed is settled before any of it comes back.
            this.damage.takeUnsettledAt(b, this);
            const mass = bodies.mass[b]!;
            const inertia = bodies.inertia[b]!;
            let mended = false;
            for (let r = 0; r < robots.length; r++) {
                const robot = robots[r]!;
                // Out on the rock its ship is moored to, it works there.
                if (robot.away >= 0) {
                    const owner = this.pilotAt(b, robot.bay);
                    const kept = this.tendAway(bodies, b, design, robot, owner, dt);
                    // Its ship gone from the rock: left there, for whichever friend comes for it.
                    if (kept < 0) {
                        this.strand(bodies, robot, owner >= 0 ? owner : this.shipByBody[b]!);
                        this.robots.lose(b, r--);
                    }
                    if (kept !== 0) mended = true;
                    continue;
                }
                // A module destroyed under a robot takes it with it.
                const on = this.robotOn(design, robot);
                const left = this.damage.integrity(b, on);
                if (robot.stoodOn === on && robot.stood > 0 && !(left > 0)) {
                    this.robots.lose(b, r--);
                    mended = true;
                    continue;
                }
                robot.stoodOn = on;
                robot.stood = left;
                const owner = this.pilotAt(b, robot.bay);
                if (owner < 0) continue;
                // Home to a bay a refit is about to take down: taken apart, its metal to the holds.
                if (robot.mode === RobotMode.Berthed && this.due(owner, b, design, robot.bay)) {
                    this.metal.add(b, robot.bay, ROBOT_MASS + robot.cargo);
                    if (robot.cargoFuel > 0) this.fuel.add(b, robot.bay, robot.cargoFuel);
                    this.robots.lose(b, r--);
                    mended = true;
                    continue;
                }
                if (this.tendOne(b, design, robots, robot, owner, dt)) mended = true;
            }
            if (this.buildRobots(b, design, robots, dt)) mended = true;
            if (mended) {
                this.settleMass(bodies, b);
                this.discardFrom(bodies, b, mass, inertia);
            }
            this.growAll(world);
            const done = this.stripped[b] ?? -1;
            if (done >= 0) {
                this.stripped[b] = -1;
                this.stepDown(world, b, done);
            }
        }
        this.tendStranded(bodies);
        // Rock robots from moored ships have taken a step of, which has none of its own.
        while (this.rockSteps.length > 0) {
            const m = this.rockSteps.pop()!;
            const rb = this.rockSteps.pop()!;
            if (bodies.alive[rb] === 1) this.stepDown(world, rb, m);
        }
    }

    /** The module a robot is on: where it stands, or of the two its leg joins, the nearer. */
    private robotOn(design: ShipDesign, robot: Robot): number {
        if (robot.path === null || robot.leg >= robot.path.length - 1) return robot.at;
        return robot.along * 2 < legLength(design, robot.path, robot.leg) ? robot.at : robot.path[robot.leg + 1]!;
    }

    /**
     * Each of a body's working bays that is short of robots builds them.
     *
     * **Metal to start one, charge to finish it.** A bay starts a robot in each
     * free berth it is short of one for, so long as its piece of hull holds a
     * robot's mass of metal and `REPAIR_WASTE` more to pay for it then: the
     * metal is aboard from the start, as the robot it will be. Each then takes
     * `ROBOT_BUILD_TIME` of a berth's work, slower as the bay is damaged, and
     * `ROBOT_BUILD_ENERGY` of charge from the piece as it goes, so metal sets how
     * many it builds at once and charge how fast. Short of charge, the most
     * nearly finished are built first. Only from what is over what its doctrine
     * keeps for its own engines and weapons (`metalReserve`, `chargeReserve`). Short by `robotsKept`,
     * counting those out on a rock. Says whether one was started or finished.
     */
    private buildRobots(b: number, design: ShipDesign, robots: Robot[], dt: number): boolean {
        const building = this.robots.buildingOn(b);
        if (building === null) return false;
        let changed = false;
        const cost = ROBOT_MASS * (1 + REPAIR_WASTE);
        const perSecond = ROBOT_BUILD_ENERGY / ROBOT_BUILD_TIME;
        for (let m = 0; m < design.modules.length; m++) {
            const berths = design.modules[m]!.stats.robots;
            const owner = this.pilotAt(b, m);
            if (!(berths > 0) || owner < 0) continue;
            // One a refit is taking down builds no more.
            if (this.refitting[owner] === 1 && this.wreckage(owner, b, m)) continue;
            const working = this.left(owner, b, m, DamageEffect.Tending);
            if (!(working > 0)) continue;
            const making = building[m]!;
            let crew = making.length;
            let aboard = making.length;
            for (let r = 0; r < robots.length; r++) {
                if (robots[r]!.bay !== m) continue;
                crew++;
                if (robots[r]!.away < 0) aboard++;
            }
            const kept = robotsKept(design.modules[m]!.spec, design.modules[m]!.stats, this.isMoored(owner));
            const missing = min(kept - crew, berths - aboard);
            let metal = missing > 0 ? this.allowed(Resource.Metal, b, m, Claim.Robots, missing * cost) : 0;
            while (crew < kept && aboard < berths && metal >= cost) {
                this.metal.drain(b, m, cost);
                this.took(Resource.Metal, b, m, Claim.Robots, cost);
                metal -= cost;
                this.robots.start(b, m);
                crew++;
                aboard++;
                changed = true;
            }
            if (making.length === 0) continue;
            making.sort(mostDone);
            const step = dt * working * berthRate(design.modules[m]!.stats);
            let wanted = 0;
            for (let k = 0; k < making.length; k++) wanted += (ROBOT_BUILD_TIME - making[k]!) * perSecond;
            let spare = this.allowed(Resource.Charge, b, m, Claim.Robots, wanted);
            for (let k = 0; k < making.length; k++) {
                const want = min(step, ROBOT_BUILD_TIME - making[k]!) * perSecond;
                if (!(spare > 0)) break;
                const got = this.power.drain(b, m, want < spare ? want : spare);
                this.took(Resource.Charge, b, m, Claim.Robots, got);
                spare -= got;
                making[k] = making[k]! + got / perSecond;
            }
            for (let k = making.length - 1; k >= 0; k--) {
                if (making[k]! < ROBOT_BUILD_TIME - BUILD_SLACK) continue;
                this.robots.finish(b, m, k);
                changed = true;
            }
        }
        return changed;
    }

    /** One robot's step. Says whether it mended anything. */
    private tendOne(b: number, design: ShipDesign, robots: Robot[], robot: Robot, owner: number, dt: number): boolean {
        if (robot.mode === RobotMode.Berthed) {
            // A working bay refills it, and tops its charge up from its piece of
            // hull, reserves and all, each step it waits.
            const working = this.left(owner, b, robot.bay, DamageEffect.Tending) * berthRate(design.modules[robot.bay]!.stats);
            // What it brought home goes into the holds, as far as they have room.
            let unloaded = false;
            if (robot.cargo + robot.cargoFuel > 0) robot.brought = (robot.cargo + robot.cargoFuel) / ROBOT_LOAD;
            if (robot.cargoFuel > 0) {
                const put = this.fuel.add(b, robot.bay, robot.cargoFuel);
                robot.cargoFuel = put < robot.cargoFuel ? robot.cargoFuel - put : 0;
                unloaded = put > 0;
                // What the tanks have no room for is let go, not carried out again.
                if (robot.cargoFuel > 0) {
                    robot.cargoFuel = 0;
                    unloaded = true;
                }
            }
            if (robot.cargo > 0) {
                const put = this.metal.add(b, robot.bay, robot.cargo);
                robot.cargo = put < robot.cargo ? robot.cargo - put : 0;
                unloaded = unloaded || put > 0;
                // Taking its own hull down for a refit, what the holds have no room for is thrown away.
                if (robot.cargo > 0 && this.refitting[owner] === 1) {
                    robot.cargo = 0;
                    unloaded = true;
                }
            }
            if (working > 0) {
                if (robot.refill > 0) {
                    robot.refill -= dt * working;
                    if (!(robot.refill > 0)) {
                        robot.refill = 0;
                        robot.metal = ROBOT_LOAD;
                        robot.brought = 0;
                    }
                }
                // Charged as it is filled, as fast as there is charge to give over
                // what the ship keeps for its engines and weapons.
                const want = min(ROBOT_CHARGE - robot.charge, (ROBOT_CHARGE / ROBOT_REFILL_TIME) * dt * working);
                const spare = this.allowed(Resource.Charge, b, robot.bay, Claim.Robots, ROBOT_CHARGE - robot.charge);
                if (want > 0 && spare > 0) {
                    const got = this.power.drain(b, robot.bay, want < spare ? want : spare);
                    this.took(Resource.Charge, b, robot.bay, Claim.Robots, got);
                    robot.charge += got;
                }
                // Waits to be full while its piece of hull has the charge to fill it.
                if (robot.refill > 0 || (robot.charge < ROBOT_CHARGE - 1 && spare > want)) return unloaded;
            }
            // It goes on what it carries, whether its bay can still refill it or not.
            if (!(robot.metal > ROBOT_SPENT) || !(robot.charge >= ROBOT_REPAIR_RATE * REPAIR_ENERGY_PER_JOULE * dt)) return unloaded;
            // Nothing has been hit since it last looked and found nothing to do.
            if (robot.idleAt !== this.damage.version(b)) {
                this.sendOut(b, design, robots, robot, owner);
                if (robot.target < 0) robot.idleAt = this.damage.version(b);
            }
            // Nothing on its own hull: over to the rock its ship is moored to, if it has room for any.
            if (robot.target < 0) this.sendAcross(b, design, robot, owner);
            return unloaded;
        }
        if (robot.mode === RobotMode.Out || robot.mode === RobotMode.Home) {
            if (robot.path === null) {
                // Come over to a remade hull with nowhere to be, or sent home from its own bay: home.
                this.route(b, design, robot, owner, robot.bay);
                if (robot.path === null && robot.at !== robot.bay) return false;
                if (robot.path === null) robot.mode = RobotMode.Home;
            }
            const path = robot.path;
            if (path !== null) {
                crawl(design, robot, dt);
                if (robot.leg < path.length - 1) return false;
            }
            robot.path = null;
            robot.leg = 0;
            robot.along = 0;
            if (robot.mode === RobotMode.Home) {
                robot.mode = RobotMode.Berthed;
                robot.refill = ROBOT_REFILL_TIME;
                robot.target = -1;
                robot.strip = false;
            } else {
                robot.mode = RobotMode.Working;
            }
            return false;
        }
        if (robot.bound >= 0) {
            this.crossOver(b, design, robots, robot, owner);
            return false;
        }
        if (robot.strip) return this.stripOne(b, design, robots, robot, owner, dt);
        // Working: mending what is hurt before building any more of it.
        const m = robot.target;
        const owned = m >= 0 && this.ownsAt(owner, b, m);
        const hurt = owned && robot.build < 0 && this.damage.absorbedAt(b, m) > 0;
        if (owned && !hurt && (robot.build >= 0 || design.modules[m]!.shell !== undefined || this.damage.unbuiltAt(b, m) > 0)) {
            return this.buildOne(b, design, robots, robot, owner, dt);
        }
        if (!hurt) {
            this.sendOut(b, design, robots, robot, owner);
            return false;
        }
        const work = repairWork(design.modules[m]!.stats);
        const step = (ROBOT_REPAIR_RATE * dt) / work;
        let undo = min(step, robot.charge / (work * REPAIR_ENERGY_PER_JOULE));
        // Short of charge for a full step's work: this is its last.
        let short = undo < step;
        const claim = mendClaim(design, m);
        const whole = this.damage.repairMetal(b, m, this.damage.absorbedAt(b, m)) * (1 + REPAIR_WASTE);
        const spare = min(robot.metal, this.allowed(Resource.Metal, b, m, claim, whole));
        const kg = this.damage.repairMetal(b, m, undo) * (1 + REPAIR_WASTE);
        if (kg > 0 && kg > spare) {
            undo *= spare > 0 ? spare / kg : 0;
            short = true;
        }
        const cost = this.damage.repairMetal(b, m, undo) * (1 + REPAIR_WASTE);
        const undone = this.damage.repair(b, m, undo);
        // Its holes are the first thing plugged.
        if (undone > 0) this.fuel.seal(b, m);
        robot.charge -= undone * work * REPAIR_ENERGY_PER_JOULE;
        robot.metal -= cost;
        if (cost > 0) this.took(Resource.Metal, b, m, claim, this.metal.drain(b, m, cost));
        // Out of what this needs, short of finishing it: home for more.
        if (short && this.damage.absorbedAt(b, m) > 0) this.sendHome(b, design, robot, owner, m);
        return undone > 0;
    }

    /**
     * One robot's step building module `robot.target`: putting its fittings in,
     * or for a shell, or a module lost against it (`robot.build`), the walls of
     * the next step, which go up when the step is paid for (`grow`). A
     * kilogram is the work of mending a kilogram's worth of damage, and costs
     * `REPAIR_WASTE` more metal than ends up in the module, off its piece of
     * hull, reserves and all. Says whether it put anything in.
     */
    private buildOne(b: number, design: ShipDesign, robots: Robot[], robot: Robot, owner: number, dt: number): boolean {
        const m = robot.target;
        const fitting = robot.build < 0 && design.modules[m]!.shell === undefined;
        const rebuild = fitting ? null : this.rebuildFor(owner, design);
        const l = rebuild === null ? -1 : robot.build >= 0 ? robot.build : rebuild.at.indexOf(m);
        // Begun for a design it has since been refitted from: nothing to build there now.
        if (rebuild !== null && l < 0) {
            robot.build = -1;
            this.sendOut(b, design, robots, robot, owner);
            return false;
        }
        const origin = rebuild === null ? null : originOf(this.launched[owner]!, l);
        const whole = origin === null ? design.modules[m]!.stats : origin.design.modules[origin.module]!.stats;
        const work = buildWork(whole);
        const step = (ROBOT_REPAIR_RATE / work) * dt;
        const charge = work * REPAIR_ENERGY_PER_JOULE;
        const waste = 1 + REPAIR_WASTE;
        let kg = min(step, min(robot.charge / charge, robot.metal / waste));
        let short = kg < step;
        const claim = origin === null ? mendClaim(design, m) : mendClaim(origin.design, origin.module);
        const wanted = rebuild === null ? this.damage.unbuiltAt(b, m) * waste : (whole.structureMass / SHELL_STEPS) * waste;
        const spare = this.allowed(Resource.Metal, b, m, claim, wanted);
        let more: boolean;
        let put: number;
        if (rebuild === null) {
            if (kg * waste > spare) {
                kg = spare > 0 ? spare / waste : 0;
                short = true;
            }
            put = this.damage.fit(b, m, kg);
            if (put > 0) this.took(Resource.Metal, b, m, claim, this.metal.drain(b, m, put * waste));
            more = this.damage.unbuiltAt(b, m) > 0;
        } else {
            const wall = whole.structureMass / SHELL_STEPS;
            // Waiting on a step that is in the way of something: mending comes first, if any has come up since.
            if (rebuild.work[l]! >= wall && robot.idleAt !== this.damage.version(b)) {
                robot.idleAt = this.damage.version(b);
                this.sendOut(b, design, robots, robot, owner);
                return false;
            }
            // Nothing to pay for the step with: no sense starting it.
            if (spare < wall * waste) {
                kg = 0;
                short = true;
            }
            kg = min(kg, wall - rebuild.work[l]!);
            if (kg > 0) rebuild.work[l] = rebuild.work[l]! + kg;
            put = kg > 0 ? kg : 0;
            if (rebuild.work[l]! >= wall) this.grows.push(owner, l, m, m, -1);
            more = true;
        }
        robot.charge -= put * charge;
        robot.metal -= put * waste;
        // Out of what this needs, short of finishing it: home for more.
        if (short && more) {
            this.sendHome(b, design, robot, owner, m);
            robot.build = -1;
        }
        return robot.build < 0 && design.modules[m]!.shell === undefined && put > 0;
    }

    /**
     * Send a robot home from module `m`, short of what its work there needs.
     * If that piece of hull has no metal left to give, it stays berthed until
     * something on the hull changes, rather than going straight back out.
     */
    private sendHome(b: number, design: ShipDesign, robot: Robot, owner: number, m: number): void {
        this.route(b, design, robot, owner, robot.bay);
        robot.mode = RobotMode.Home;
        if (!(this.metal.pieceHeld(b, m) > ROBOT_SPENT)) robot.idleAt = this.damage.version(b);
    }

    /**
     * Send a berthed robot of moored ship `owner` to its claw, body `b`, to
     * cross onto the rock and mine it, if the rock has any it has room for.
     */
    private sendAcross(b: number, design: ShipDesign, robot: Robot, owner: number): boolean {
        const claw = this.mooredClaw[owner]!;
        if (claw < 0 || this.bodyStore === null || this.commanded(owner)) return false;
        const cb = this.carrierBodyOf(this.bodyStore, owner);
        if (cb < 0 || !this.strippableAcross(owner, b, robot.bay, cb)) return false;
        this.route(b, design, robot, owner, claw);
        if (robot.path === null && robot.at !== claw) return false;
        robot.bound = this.parkedOn[owner]!;
        robot.target = claw;
        robot.strip = false;
        robot.mode = robot.path === null ? RobotMode.Working : RobotMode.Out;
        return true;
    }

    /** A robot of ship `owner` at its claw, body `b`, stepping onto the rock it is bound for, or home if it has let go. */
    private crossOver(b: number, design: ShipDesign, robots: Robot[], robot: Robot, owner: number): void {
        const rock = robot.bound;
        robot.bound = -1;
        const bodies = this.bodyStore!;
        const cb = this.parkedOn[owner] === rock && this.mooredClaw[owner]! >= 0 ? this.carrierBodyOf(bodies, owner) : -1;
        const entry = cb < 0 ? -1 : this.heldRock(bodies, owner);
        if (entry < 0) {
            this.sendHome(b, design, robot, owner, robot.at);
            return;
        }
        robot.away = rock;
        robot.awayDesign = this.hullDesign[cb]!;
        robot.at = entry;
        robot.path = null;
        if (!this.sendOnRock(b, cb, robots, robot, owner)) this.homeOnRock(cb, robot, owner);
    }

    /**
     * Give a robot of ship `owner` out on its rock, body `cb`, rock to take
     * apart for what its bay on body `b` has room for: as `sendToStrip` does on
     * a hull, but for the rock its claw holds, which stays to hold it by. It
     * goes where a trip, there and back, brings home the most a second; a wedge
     * of rock is too big for robots to crowd, so fewer there only breaks a tie.
     */
    private sendOnRock(b: number, cb: number, robots: Robot[], robot: Robot, owner: number): boolean {
        const rd = this.hullDesign[cb]!;
        const metalRoom = this.metal.pieceRoom(b, robot.bay) > ROBOT_SPENT;
        const fuelRoom = this.fuel.pieceRoom(b, robot.bay) > ROBOT_SPENT;
        const room = ROBOT_LOAD - robot.cargo - robot.cargoFuel;
        if (!(metalRoom || fuelRoom) || !(room > ROBOT_SPENT)) return false;
        const held = this.heldRock(this.bodyStore!, owner);
        const { dist, prev } = this.walkScratch(rd.modules.length);
        walk(rd, robot.at, dist, prev, (m) => this.ofRock(cb, m));
        let best = -1;
        let bestRate = -1;
        let bestCrowd = Infinity;
        for (let m = 0; m < rd.modules.length; m++) {
            if (m === held || !Number.isFinite(dist[m]!) || !this.ofRock(cb, m) || !this.comesOff(owner, cb, rd, m)) continue;
            if (!this.minable(rd, m, metalRoom, fuelRoom)) continue;
            // What it would bring home, as `mineRock` takes it, and the time it would take.
            const spec = rd.modules[m]!.spec;
            const rock = spec.kind === "rock";
            const kept = ((rock && metalRoom ? (spec.ore ?? 0) : 0) + (rock && fuelRoom ? (spec.ice ?? 0) : 0)) * (1 - DISASSEMBLY_WASTE);
            const work = buildWork(this.stripStep(cb, rd, m).stats);
            let kg = robot.charge / (work * REPAIR_ENERGY_PER_JOULE * MINING_POWER);
            if (kept > 0) kg = min(kg, room / kept);
            const time = 2 * walkTime(rd, prev, m, robot.tag) + (kg * work) / ROBOT_REPAIR_RATE;
            const rate = time > 0 ? (kg * kept) / time : 0;
            let crowd = 0;
            for (let k = 0; k < robots.length; k++)
                if (robots[k] !== robot && robots[k]!.away === robot.away && robots[k]!.target === m) crowd++;
            if (rate > bestRate || (rate === bestRate && crowd < bestCrowd)) {
                best = m;
                bestRate = rate;
                bestCrowd = crowd;
            }
        }
        if (best < 0) return false;
        robot.target = best;
        robot.strip = true;
        robot.path = pathTo(prev, dist, best);
        robot.leg = 0;
        robot.along = 0;
        robot.mode = robot.path !== null && robot.path.length > 1 ? RobotMode.Out : RobotMode.Working;
        if (robot.mode === RobotMode.Working) robot.path = null;
        return true;
    }

    /** Set a robot of ship `owner` out on its rock, body `cb`, walking back to where its claw grips. */
    private homeOnRock(cb: number, robot: Robot, owner: number): void {
        const rd = this.hullDesign[cb]!;
        const entry = this.heldRock(this.bodyStore!, owner);
        robot.mode = RobotMode.Home;
        robot.target = -1;
        robot.strip = false;
        robot.leg = 0;
        robot.along = 0;
        robot.path = null;
        if (entry < 0 || robot.at === entry) return;
        const { dist, prev } = this.walkScratch(rd.modules.length);
        walk(rd, robot.at, dist, prev, (m) => this.ofRock(cb, m));
        const path = pathTo(prev, dist, entry);
        robot.path = path !== null && path.length > 1 ? path : null;
    }

    /**
     * One step of a robot of ship `owner` out on the rock it is moored to, its
     * bay on body `b`: walking, mining, and back across to its claw. Says 1 if
     * it mined, -1 if it was lost, with its ship no longer moored there, and 0
     * otherwise.
     */
    private tendAway(bodies: Bodies, b: number, design: ShipDesign, robot: Robot, owner: number, dt: number): number {
        const rock = robot.away;
        if (owner < 0 || this.parkedOn[owner] !== rock || !(this.mooredClaw[owner]! >= 0)) return -1;
        const cb = this.carrierBodyOf(bodies, owner);
        const rd = cb < 0 ? null : this.hullDesign[cb];
        if (rd === null || rd === undefined) return -1;
        // The rock has changed under it: on the nearest of what is left, and about its work afresh.
        if (rd !== robot.awayDesign) {
            this.remapOnRock(robot, rd);
            robot.path = null;
            robot.leg = 0;
            robot.along = 0;
            if (robot.mode !== RobotMode.Home) {
                robot.mode = RobotMode.Out;
                robot.target = -1;
            }
        }
        if (robot.mode === RobotMode.Out || robot.mode === RobotMode.Home) {
            if (robot.path === null) {
                if (robot.mode === RobotMode.Out && robot.target < 0) {
                    if (!this.sendOnRock(b, cb, this.robots.on(b)!, robot, owner)) this.homeOnRock(cb, robot, owner);
                    return 0;
                }
                if (robot.mode === RobotMode.Home && robot.at !== this.heldRock(bodies, owner)) {
                    this.homeOnRock(cb, robot, owner);
                    if (robot.path === null) return 0;
                }
            }
            const path = robot.path;
            if (path !== null) {
                crawl(rd, robot, dt);
                if (robot.leg < path.length - 1) return 0;
            }
            robot.path = null;
            robot.leg = 0;
            robot.along = 0;
            if (robot.mode === RobotMode.Out) {
                robot.mode = RobotMode.Working;
                return 0;
            }
            // Back where its claw grips: across onto its own hull and home, once
            // its bay has a berth for it; the extra a moored bay keeps wait here.
            if (this.aboardIn(b, robot.bay) >= design.modules[robot.bay]!.stats.robots) return 0;
            robot.away = -1;
            robot.awayDesign = null;
            robot.at = this.mooredClaw[owner]!;
            this.route(b, design, robot, owner, robot.bay);
            return 0;
        }
        return this.mineRock(b, cb, rd, robot, owner, dt) ? 1 : 0;
    }

    /**
     * Put a robot out on a rock whose design has changed under it, as mining
     * does, on the nearest module of the new design to where it stood.
     */
    private remapOnRock(robot: Robot, rd: ShipDesign): void {
        const was = robot.awayDesign!.modules[robot.at];
        robot.at = this.nearestModule(
            rd,
            (was?.x ?? 0) + robot.awayDesign!.centreOfMassX - rd.centreOfMassX,
            (was?.y ?? 0) + robot.awayDesign!.centreOfMassY - rd.centreOfMassY,
        );
        robot.awayDesign = rd;
    }

    /** The module of `design` nearest body-frame point `x`, `y`. */
    private nearestModule(design: ShipDesign, x: number, y: number): number {
        let near = 0;
        let gap = Infinity;
        for (let m = 0; m < design.modules.length; m++) {
            const d = length(design.modules[m]!.x - x, design.modules[m]!.y - y);
            if (d < gap) {
                gap = d;
                near = m;
            }
        }
        return near;
    }

    /**
     * Leave a robot of ship `owner` where it is on the rock it is out on, its
     * ship no longer moored there: still carrying what it had mined, waiting
     * for a friend to moor there with a berth for it. Lost if the rock is.
     */
    private strand(bodies: Bodies, robot: Robot, owner: number): void {
        const rock = robot.away;
        if (rock < 0 || this.alive[rock] === 0 || bodies.indexOf(this.bodyIds[rock]!) < 0 || owner < 0) return;
        robot.mode = RobotMode.Home;
        robot.target = -1;
        robot.strip = false;
        robot.bound = -1;
        robot.path = null;
        robot.leg = 0;
        robot.along = 0;
        this.stranded.push({ robot, team: this.team[owner]!, home: owner });
    }

    /**
     * Each robot stranded on a rock, waiting where it is, or taken aboard by a
     * ship of its side moored to that rock with a berth for it: the ship that
     * left it before any other. It then walks to that ship's claw and goes home
     * to its new bay with what it carries. One whose rock is gone is lost.
     */
    private tendStranded(bodies: Bodies): void {
        for (let k = this.stranded.length - 1; k >= 0; k--) {
            const { robot, team, home } = this.stranded[k]!;
            const rock = robot.away;
            const cb = this.alive[rock] === 1 ? bodies.indexOf(this.bodyIds[rock]!) : -1;
            const rd = cb < 0 ? null : this.hullDesign[cb];
            if (rd === null || rd === undefined) {
                this.stranded.splice(k, 1);
                continue;
            }
            if (rd !== robot.awayDesign) this.remapOnRock(robot, rd);
            let taker = -1;
            let bay = -1;
            for (let p = 0; p < this.parkedShips.length && taker !== home; p++) {
                const f = this.parkedShips[p]!;
                if (this.mooredClaw[f]! < 0 || this.team[f] !== team || !this.hasControl(f) || this.carrierBodyOf(bodies, f) !== cb)
                    continue;
                const berth = this.freeBerth(bodies, f);
                if (berth < 0) continue;
                if (taker < 0 || f === home) {
                    taker = f;
                    bay = berth;
                }
            }
            if (taker < 0) continue;
            const fb = bodies.indexOf(this.bodyIds[taker]!);
            this.stranded.splice(k, 1);
            robot.bay = bay;
            robot.away = this.parkedOn[taker]!;
            this.robots.adopt(fb, robot);
            this.makeRoomFor(fb, taker, bay);
            this.homeOnRock(cb, robot, taker);
        }
    }

    /**
     * Bay `bay` of ship `f`, on body `fb`, having taken a robot aboard: if that
     * and those it is building are more than it keeps, it stops building the
     * least finished, and the metal goes back into its piece of hull.
     */
    private makeRoomFor(fb: number, f: number, bay: number): void {
        const design = this.hullDesign[fb];
        const robots = this.robots.on(fb);
        if (design === null || design === undefined || robots === null) return;
        let crew = this.robots.buildingOn(fb)?.[bay]?.length ?? 0;
        for (let r = 0; r < robots.length; r++) if (robots[r]!.bay === bay) crew++;
        if (crew > robotsKept(design.modules[bay]!.spec, design.modules[bay]!.stats, this.isMoored(f)) && this.robots.cancel(fb, bay)) {
            this.metal.add(fb, bay, ROBOT_MASS);
        }
    }

    /** A robot bay of ship `f`'s short of the robots it keeps (`robotsKept`), or -1. */
    private freeBerth(bodies: Bodies, f: number): number {
        const fb = bodies.indexOf(this.bodyIds[f]!);
        const design = fb < 0 ? null : this.hullDesign[fb];
        const robots = this.robots.on(fb);
        if (design === null || design === undefined || robots === null) return -1;
        for (let m = 0; m < design.modules.length; m++) {
            const berths = design.modules[m]!.stats.robots;
            if (!(berths > 0) || this.pilotAt(fb, m) !== f) continue;
            // Not counting those it is building: one it takes aboard takes the place of one of them.
            let crew = 0;
            for (let r = 0; r < robots.length; r++) if (robots[r]!.bay === m) crew++;
            if (crew < robotsKept(design.modules[m]!.spec, design.modules[m]!.stats, this.isMoored(f))) return m;
        }
        return -1;
    }

    /** How many robots are stranded on asteroid `rock`, by its ship. */
    strandedOn(rock: number): number {
        let count = 0;
        for (const { robot } of this.stranded) if (robot.away === rock) count++;
        return count;
    }

    /**
     * One step of a robot out on its rock, body `cb`, taking module
     * `robot.target` apart as `stripOne` does wreckage: ore smelted and ice
     * melted into what it carries, for its charge, until it is full or short
     * of charge, when it walks back. Says whether it took any.
     */
    private mineRock(b: number, cb: number, rd: ShipDesign, robot: Robot, owner: number, dt: number): boolean {
        const m = robot.target;
        if (
            m < 0 ||
            m >= rd.modules.length ||
            m === this.heldRock(this.bodyStore!, owner) ||
            !this.ofRock(cb, m) ||
            !this.comesOff(owner, cb, rd, m)
        ) {
            if (!this.sendOnRock(b, cb, this.robots.on(b)!, robot, owner)) this.homeOnRock(cb, robot, owner);
            return false;
        }
        const room = ROBOT_LOAD - robot.cargo - robot.cargoFuel;
        if (!(room > ROBOT_SPENT)) {
            this.homeOnRock(cb, robot, owner);
            return false;
        }
        const spec = rd.modules[m]!.spec;
        const ore = spec.kind === "rock" ? (spec.ore ?? 0) : 0;
        // Its ice is kept only while its bay's tanks have room for it.
        const ice = spec.kind === "rock" && this.fuel.pieceRoom(b, robot.bay) > ROBOT_SPENT ? (spec.ice ?? 0) : 0;
        const step = this.stripStep(cb, rd, m);
        const work = buildWork(step.stats);
        const per = work * REPAIR_ENERGY_PER_JOULE * MINING_POWER;
        const done = this.damage.unbuiltAt(cb, m);
        let kg = min((ROBOT_REPAIR_RATE / work) * dt, robot.charge / per);
        const short = kg < (ROBOT_REPAIR_RATE / work) * dt;
        const yieldPerKg = (ore + ice) * (1 - DISASSEMBLY_WASTE);
        kg = min(kg, yieldPerKg > 0 ? room / yieldPerKg : Infinity, step.kg - done);
        if (kg > 0) {
            this.damage.unfit(cb, m, kg);
            robot.charge -= kg * per;
            robot.cargo += kg * ore * (1 - DISASSEMBLY_WASTE);
            robot.cargoFuel += kg * ice * (1 - DISASSEMBLY_WASTE);
            this.settleMass(this.bodyStore!, cb);
        }
        if (done + (kg > 0 ? kg : 0) >= step.kg - ROBOT_SPENT && !this.rockStepped(cb)) this.rockSteps.push(cb, m);
        if (short || !(ROBOT_LOAD - robot.cargo - robot.cargoFuel > ROBOT_SPENT)) this.homeOnRock(cb, robot, owner);
        return kg > 0;
    }

    /** Whether module `m` of body `cb` is an asteroid's, which a moored ship's robots may walk and mine. */
    private ofRock(cb: number, m: number): boolean {
        const p = this.pilotAt(cb, m);
        return p >= 0 && this.isAsteroid(p);
    }

    /** Whether a step of rock body `cb` is already due to come down this step. */
    private rockStepped(cb: number): boolean {
        for (let k = 0; k < this.rockSteps.length; k += 2) if (this.rockSteps[k] === cb) return true;
        return false;
    }

    /** Whether any robot of ship `f`'s, on body `b`, is out on its rock or on its way there. */
    private anyAway(b: number, f: number): boolean {
        for (const robot of this.robots.on(b) ?? [])
            if (this.pilotAt(b, robot.bay) === f && (robot.away >= 0 || robot.bound >= 0)) return true;
        return false;
    }

    /** Call ship `f`'s robots on body `b` in off its rock, body `cb`: those out there walk back, those on their way turn round. */
    private recallAway(b: number, design: ShipDesign, f: number, cb: number): void {
        for (const robot of this.robots.on(b) ?? []) {
            if (this.pilotAt(b, robot.bay) !== f) continue;
            if (robot.bound >= 0) {
                robot.bound = -1;
                this.sendHome(b, design, robot, f, robot.at);
            } else if (robot.away >= 0 && robot.mode !== RobotMode.Home) {
                this.homeOnRock(cb, robot, f);
            }
        }
    }

    /** Ship `i`'s hull matched to its launch design, worked out again when the hull has changed. */
    private rebuildFor(i: number, design: ShipDesign): Rebuild {
        const known = this.rebuilds[i];
        if (known !== null && known !== undefined && known.design === design) return known;
        const launch = this.launched[i]!;
        const at = new Int32Array(launch.modules.length).fill(-1);
        for (let l = 0; l < launch.modules.length; l++) {
            for (let m = 0; m < design.modules.length; m++) {
                if (sameOrigin(launch, l, design, m)) {
                    at[l] = m;
                    break;
                }
            }
        }
        const compiled = originOf(launch, 0).design;
        let frame = -1;
        for (let m = 0; m < design.modules.length && frame < 0; m++) {
            if (design.modules[m]!.shell === undefined && originOf(design, m).design === compiled) frame = m;
        }
        const rebuild = { design, at, frame, work: known?.work ?? new Float64Array(launch.modules.length), swaps: null };
        this.rebuilds[i] = rebuild;
        return rebuild;
    }

    /**
     * Give a robot something of its ship's launch design to rebuild, once there
     * is nothing to mend: the fittings of a module whose walls are up, the
     * walls of a shell, or a module lost, against a module of its hull that is
     * whole. The first tier with anything in it, of that what fewest robots are
     * after, the nearest of those. Says whether it found anything.
     */
    private sendToBuild(b: number, design: ShipDesign, robots: Robot[], robot: Robot, owner: number, dist: Float64Array): boolean {
        const launch = this.launched[owner];
        if (launch === undefined) return false;
        const rebuild = this.rebuildFor(owner, design);
        const crowdOf = (m: number, l: number): number => {
            let crowd = 0;
            for (let k = 0; k < robots.length; k++) {
                const other = robots[k]!;
                if (other !== robot && other.target === m && other.build === l) crowd++;
            }
            return crowd;
        };
        let best = -1;
        let bestBuild = -1;
        let bestTier = Infinity;
        const approach = this.doctrines[owner]!.approach;
        let bestCrowd = Infinity;
        let bestDist = Infinity;
        // Refitted, what flies and works on the ship goes up first, to get more of the work going sooner.
        const refit = this.refitting[owner] === 1;
        const consider = (m: number, l: number, kept: number): void => {
            const kind = l >= 0 ? launch.modules[l]!.spec.kind : originOf(design, m).design.modules[originOf(design, m).module]!.spec.kind;
            const tier = refit && workforce(kind) ? -Infinity : kept;
            const crowd = crowdOf(m, l);
            if (tier < bestTier || (tier === bestTier && (crowd < bestCrowd || (crowd === bestCrowd && dist[m]! < bestDist)))) {
                best = m;
                bestBuild = l;
                bestTier = tier;
                bestCrowd = crowd;
                bestDist = dist[m]!;
            }
        };
        for (let m = 0; m < design.modules.length; m++) {
            if (!Number.isFinite(dist[m]!) || !this.ownsAt(owner, b, m) || this.wreckage(owner, b, m)) continue;
            if (design.modules[m]!.shell !== undefined || this.damage.unbuiltAt(b, m) > 0) consider(m, -1, originTier(approach, design, m));
        }
        if (rebuild.frame >= 0) {
            const compiled = originOf(design, rebuild.frame).design;
            for (const joint of joints(launch)) {
                if (joint.seam === true) continue;
                for (const [l, against] of [
                    [joint.a, joint.b],
                    [joint.b, joint.a],
                ] as const) {
                    const m = rebuild.at[against]!;
                    if (rebuild.at[l]! >= 0 || m < 0 || !Number.isFinite(dist[m]!) || !this.ownsAt(owner, b, m)) continue;
                    if (this.wreckage(owner, b, m)) continue;
                    if (design.modules[m]!.shell !== undefined || originOf(design, m).design !== compiled) continue;
                    // Refitted, what is in the way comes down before this goes up.
                    if (this.refitting[owner] === 1 && this.inTheWay(design, rebuild, launch, l)) continue;
                    consider(m, l, repairTier(approach, launch, l));
                }
            }
        }
        if (best < 0) return false;
        robot.target = best;
        robot.build = bestBuild;
        return true;
    }

    /** Whether anything of hull `design` stands where launch module `l` of `launch` would be built. */
    private inTheWay(design: ShipDesign, rebuild: Rebuild, launch: ShipDesign, l: number): boolean {
        const origin = originOf(launch, l);
        const reference = originOf(design, rebuild.frame);
        const placed = inFrame(
            origin.design.modules[origin.module]!.spec,
            reference.design.modules[reference.module]!.spec,
            design.modules[rebuild.frame]!.spec,
        );
        for (const module of design.modules) if (modulesOverlap(module.spec, placed)) return true;
        return false;
    }

    /**
     * Put up the next step of the walls of launch module `l` of ship `i`, built
     * from module `from` of its hull, once robots or a pad have put the work in
     * and the piece of hull `payer` is on can pay for the metal: a shell first laid against `from`,
     * growing across the module, and at its last step the module itself, whole
     * but for its fittings. Not while anything else is in the way of it. The
     * payer is on body `payB`, the carrier a fighter is parked on, or -1 for its own.
     */
    private grow(world: World, i: number, l: number, from: number, payer = from, payB = -1): void {
        const bodies = world.bodies;
        const b = bodies.indexOf(this.bodyIds[i]!);
        const p = b < 0 ? -1 : this.shipAt(bodies, b);
        if (p < 0) return;
        const design = this.designs[p]!;
        const rebuild = this.rebuildFor(i, design);
        const origin = originOf(this.launched[i]!, l);
        const whole = origin.design.modules[origin.module]!;
        const wall = whole.stats.structureMass / SHELL_STEPS;
        if (!(rebuild.work[l]! >= wall) || from >= design.modules.length) return;
        const was = rebuild.at[l]!;
        const shell = was < 0 ? null : design.modules[was]!.shell;
        if (was >= 0 && shell === undefined) return;
        // Laid out by a whole module of its design, or by where its own walls say it goes.
        let placed = shell?.placed;
        if (rebuild.frame >= 0) {
            const reference = originOf(design, rebuild.frame);
            placed = inFrame(whole.spec, reference.design.modules[reference.module]!.spec, design.modules[rebuild.frame]!.spec);
        }
        if (placed === undefined) return;
        const face = shell?.face ?? faceToward(placed, design.modules[from]!.spec);
        const share = min(1, (shell?.share ?? 0) + 1 / SHELL_STEPS);
        const at = was < 0 ? design.modules.length : was;
        const piece = design.pieces?.[was < 0 ? from : was] ?? 0;
        let next: ShipDesign;
        if (share >= 1 - 1e-9) {
            next = rebuiltDesign(design, at, placed, whole.stats, origin, null, piece);
        } else {
            const part = shellOf(placed, whole.stats, face, share);
            next = rebuiltDesign(design, at, part.spec, part.stats, origin, { share, face, placed }, piece);
        }

        // Refitted, it waits for anything of its own hull in the way to come down.
        if (this.refitting[i] === 1) {
            for (let k = 0; k < next.modules.length; k++) {
                if (k !== at && modulesOverlap(next.modules[k]!.spec, next.modules[at]!.spec)) return;
            }
        }

        // Where the hull will be, and whether anything else is.
        const offset = this.offsetOf(bodies, b, design, next);
        const x = bodies.x[b]! + offset.x;
        const y = bodies.y[b]! + offset.y;
        for (let j = 0; j < bodies.highWater; j++) {
            // A fighter on a pad is in nothing's way on its own carrier.
            if (j === b || bodies.alive[j] === 0 || bodies.ghost[j] === 1 || !this.meets(b, j)) continue;
            const other = this.designOf(j);
            if (other !== null && moduleOverlapsHull(next, at, x, y, bodies.angle[b]!, bodies, j, other)) return;
        }
        const cost = wall * (1 + REPAIR_WASTE);
        if (payB >= 0) {
            // On a pad, paid for by the carrier, which carries it.
            if (this.allowed(Resource.Metal, payB, payer, Claim.Pads, cost) < cost) return;
            const carried = bodies.mass[payB]!;
            const turning = bodies.inertia[payB]!;
            this.took(Resource.Metal, payB, payer, Claim.Pads, this.metal.drain(payB, payer, cost));
            rebuild.work[l] = 0;
            this.regrow(world, p, b, design, next, at, i);
            if (share >= 1 - 1e-9) this.damage.unfit(b, at, fittingOf(whole.stats));
            this.settleMass(bodies, b);
            this.settleMass(bodies, payB);
            this.discardFrom(bodies, payB, carried, turning);
            return;
        }
        const claim = mendClaim(origin.design, origin.module);
        if (this.allowed(Resource.Metal, b, payer, claim, cost) < cost) return;

        this.momentum(bodies);
        const beforeX = this.momentumX;
        const beforeY = this.momentumY;
        const mass = bodies.mass[b]!;
        const inertia = bodies.inertia[b]!;
        this.took(Resource.Metal, b, payer, claim, this.metal.drain(b, payer, cost));
        rebuild.work[l] = 0;
        this.regrow(world, p, b, design, next, at, i);
        if (share >= 1 - 1e-9) this.damage.unfit(b, at, fittingOf(whole.stats));
        this.settleMass(bodies, b);
        // What it wasted left at the hull's speed; the hull's centre moved, and the
        // momentum it had with it.
        this.discardFrom(bodies, b, mass, inertia);
        this.momentum(bodies);
        bodies.vx[b] = bodies.vx[b]! + (beforeX - this.momentumX) / movable(bodies.mass[b]!);
        bodies.vy[b] = bodies.vy[b]! + (beforeY - this.momentumY) / movable(bodies.mass[b]!);
        // Robots about to start it are building it now, standing on it.
        for (const robot of this.robots.on(b) ?? []) {
            if (robot.build === l && this.pilotAt(b, robot.bay) === i) {
                robot.build = -1;
                robot.target = at;
                if (robot.mode === RobotMode.Working) robot.at = at;
            }
        }
    }

    /**
     * Make body `b`, primary `p`, carry `next`: its design with module `at` put
     * in or replaced, every other module where it was. Everything aboard stays
     * as it was, robots included; a module new to the hull is ship `builder`'s.
     */
    private regrow(world: World, p: number, b: number, was: ShipDesign, next: ShipDesign, at: number, builder: number): void {
        const bodies = world.bodies;
        const id = this.bodyIds[p]!;
        const offset = this.offsetOf(bodies, b, was, next);
        const spin = bodies.angularVel[b]!;
        bodies.x[b] = bodies.x[b]! + offset.x;
        bodies.y[b] = bodies.y[b]! + offset.y;
        bodies.vx[b] = bodies.vx[b]! - spin * offset.y;
        bodies.vy[b] = bodies.vy[b]! + spin * offset.x;
        bodies.setMass(id, next.mass);
        bodies.setInertia(id, next.inertia);
        bodies.radius[b] = next.radius;
        const n = was.modules.length;
        const pilots = this.pilots[b];
        if (pilots !== null && pilots !== undefined && at >= n) {
            const more = new Int32Array(next.modules.length);
            more.set(pilots);
            more[at] = builder;
            this.pilots[b] = more;
        }
        this.adopt(
            p,
            b,
            next,
            () => p,
            (m) => (m < n ? m : -1),
            true,
            true,
            builder,
        );
        for (const r of this.ridersOf(bodies, b)) if (r !== p) this.board(r, p);
    }

    /**
     * Give a robot the next module to mend, from where it is: the first tier
     * with anything in it, and of that the module fewest robots are already
     * after, the nearest of those. With nothing to mend, something to rebuild
     * (`sendToBuild`). Home when there is nothing.
     */
    private sendOut(b: number, design: ShipDesign, robots: Robot[], robot: Robot, owner: number): void {
        const n = design.modules.length;
        const { dist, prev } = this.walkScratch(n);
        this.walkFrom(b, design, robot, owner, dist, prev);
        let best = -1;
        let bestTier = Infinity;
        let bestCrowd = Infinity;
        let bestDist = Infinity;
        const approach = this.doctrines[owner]!.approach;
        for (let m = 0; m < n; m++) {
            if (!Number.isFinite(dist[m]!) || !(this.damage.absorbedAt(b, m) > 0) || !this.ownsAt(owner, b, m)) continue;
            if (this.wreckage(owner, b, m)) continue;
            const tier = repairTier(approach, design, m);
            let crowd = 0;
            for (let k = 0; k < robots.length; k++) if (robots[k] !== robot && robots[k]!.target === m) crowd++;
            // No more on it than it has room for: the rest mend something else, or go mining.
            if (crowd >= robotsOn(design.modules[m]!.spec)) continue;
            if (tier < bestTier || (tier === bestTier && (crowd < bestCrowd || (crowd === bestCrowd && dist[m]! < bestDist)))) {
                best = m;
                bestTier = tier;
                bestCrowd = crowd;
                bestDist = dist[m]!;
            }
        }
        robot.build = -1;
        robot.strip = false;
        if (best < 0 && this.sendToBuild(b, design, robots, robot, owner, dist)) best = robot.target;
        if (best < 0 && this.sendToStrip(b, design, robots, robot, owner, dist)) best = robot.target;
        if (best < 0) {
            robot.target = -1;
            if (robot.mode !== RobotMode.Berthed) {
                this.route(b, design, robot, owner, robot.bay);
                robot.mode = robot.at === robot.bay ? RobotMode.Berthed : RobotMode.Home;
            }
            return;
        }
        robot.target = best;
        robot.path = pathTo(prev, dist, best);
        robot.leg = 0;
        robot.along = 0;
        robot.mode = robot.path !== null && robot.path.length > 1 ? RobotMode.Out : RobotMode.Working;
        if (robot.mode === RobotMode.Working) robot.path = null;
    }

    /** Set a robot walking from where it is to module `to`, over its owner's modules; no path if it cannot. */
    private route(b: number, design: ShipDesign, robot: Robot, owner: number, to: number): void {
        robot.leg = 0;
        robot.along = 0;
        if (robot.at === to) {
            robot.path = null;
            return;
        }
        const { dist, prev } = this.walkScratch(design.modules.length);
        this.walkFrom(b, design, robot, owner, dist, prev);
        const path = pathTo(prev, dist, to);
        robot.path = path !== null && path.length > 1 ? path : null;
    }

    /**
     * Distances from where a robot of ship `owner` stands to every module it may
     * go to: over its own hull's welds, and across a seam onto wreckage and over
     * that, but never onto a ship still in the fight.
     */
    private walkFrom(b: number, design: ShipDesign, robot: Robot, owner: number, dist: Float64Array, prev: Int32Array): void {
        walk(
            design,
            robot.at,
            dist,
            prev,
            (m) => this.ownsAt(owner, b, m) || this.wreckage(owner, b, m),
            (u, v) => this.wreckage(owner, b, u) || this.wreckage(owner, b, v),
        );
    }

    /**
     * Whether module `m` of body `b` is wreckage to ship `i`: hull nobody flies,
     * or that a ship with no control flies and no robots of its own are mending,
     * or a piece of ship `i`'s own body it hooked on rather than set out with.
     * Never a ship still under control, friend or foe.
     */
    private wreckage(i: number, b: number, m: number): boolean {
        const owner = this.pilots[b]?.[m] ?? i;
        if (owner === i) {
            const hull = this.hullDesign[b];
            const pieces = hull?.pieces;
            if (pieces !== undefined) {
                const own = this.ownPiece(i, b);
                if (own >= 0 && pieces[m] !== own) return true;
            }
            // Refitted, what is no module of the design it is refitted to comes down.
            return this.refitting[i] === 1 && hull !== null && hull !== undefined && originOf(hull, m).design !== this.launched[i];
        }
        if (owner < 0 || this.alive[owner] === 0 || this.derelict[owner] === 1) return true;
        // Being built on a pad or slipway, it has no working core or robots yet, and is not wreckage for that.
        if (this.unfinished[owner] === 1) return false;
        return !this.hasControl(owner) && !this.hasRobots(b, owner);
    }

    /** The piece of body `b` ship `i` is flown from: that of a core of its own, a working one first. */
    private ownPiece(i: number, b: number): number {
        const design = this.hullDesign[b]!;
        let first = -1;
        for (const core of design.cores) {
            if (!this.ownsAt(i, b, core)) continue;
            if (this.damage.remaining(b, core, DamageEffect.Control) > 0) return design.pieces?.[core] ?? 0;
            if (first < 0) first = design.pieces?.[core] ?? 0;
        }
        return first;
    }

    /**
     * Whether ship `s` has a robot on body `b` with the charge for a step's
     * work, or a piece of hull at module `from` that has charge to give one or
     * makes it.
     */
    private canStrip(b: number, s: number, from: number, dt: number): boolean {
        const step = ROBOT_REPAIR_RATE * REPAIR_ENERGY_PER_JOULE * dt;
        let any = false;
        for (const robot of this.robots.on(b) ?? []) {
            if (this.pilotAt(b, robot.bay) !== s) continue;
            if (robot.charge >= step) return true;
            any = true;
        }
        return any && (this.power.pieceHeld(b, from) >= step || this.power.pieceGeneration(b, from, this.damage) > 0);
    }

    /** Whether module `m` of body `b` is a core, bay or generator of ship `owner`'s own that a refit is taking down. */
    private ownWorkforce(owner: number, b: number, design: ShipDesign, m: number): boolean {
        return (
            this.refitting[owner] === 1 &&
            this.pilotAt(b, m) === owner &&
            workforce(design.modules[m]!.spec.kind) &&
            this.wreckage(owner, b, m)
        );
    }

    /** Whether ship `owner` has anything of its own hull but cores, bays and generators left for its refit to take down. */
    private anyPlainWreckage(owner: number, b: number, design: ShipDesign): boolean {
        if (this.refitting[owner] !== 1) return false;
        for (let m = 0; m < design.modules.length; m++) {
            if (this.pilotAt(b, m) !== owner || workforce(design.modules[m]!.spec.kind)) continue;
            if (this.wreckage(owner, b, m) && this.comesOff(owner, b, design, m)) return true;
        }
        return false;
    }

    /**
     * Whether ship `owner`'s refit is ready to take down core, bay or generator
     * `m`: nothing else of its own left to come down first, and for a core or a
     * bay, another of its kind built, fitted out and working, a bay with robots
     * of its own, so it is flown and worked on to the end.
     */
    private due(owner: number, b: number, design: ShipDesign, m: number): boolean {
        if (!this.ownWorkforce(owner, b, design, m) || this.anyPlainWreckage(owner, b, design)) return false;
        const kind = design.modules[m]!.spec.kind;
        if (kind === "generator") return true;
        const effect = kind === "core" ? DamageEffect.Control : DamageEffect.Tending;
        for (let k = 0; k < design.modules.length; k++) {
            if (k === m || design.modules[k]!.spec.kind !== kind || design.modules[k]!.shell !== undefined) continue;
            if (this.pilotAt(b, k) !== owner || this.damage.unbuiltAt(b, k) > 0 || !(this.left(owner, b, k, effect) > 0)) continue;
            if (kind === "robotBay" && !(this.robots.on(b) ?? []).some((robot) => robot.bay === k)) continue;
            return true;
        }
        return false;
    }

    /** Whether ship `s` has robots of its own on body `b`. */
    private hasRobots(b: number, s: number): boolean {
        for (const robot of this.robots.on(b) ?? []) if (this.pilotAt(b, robot.bay) === s) return true;
        return false;
    }

    /** Whether module `m`, wreckage to ship `owner`, can come off: without cutting the rest loose, or refitted in place. */
    private comesOff(owner: number, b: number, design: ShipDesign, m: number): boolean {
        return staysWhole(design, m) || this.swapFor(owner, b, design, m) >= 0;
    }

    /**
     * The module of its refit's design ship `owner` fits out in the walls of
     * module `m` of its hull, or -1: one not yet built, where `m` stands, with
     * walls of the same shape and mass. `m` is then refitted in place, its
     * fittings out and the new ones in, rather than taken down and built again.
     */
    private swapFor(owner: number, b: number, design: ShipDesign, m: number): number {
        if (this.refitting[owner] !== 1 || this.pilotAt(b, m) !== owner) return -1;
        const rebuild = this.rebuildFor(owner, design);
        if (rebuild.swaps === null) {
            const swaps = new Int32Array(design.modules.length).fill(-1);
            rebuild.swaps = swaps;
            if (rebuild.frame >= 0) {
                const launch = this.launched[owner]!;
                const reference = originOf(design, rebuild.frame);
                const taken = new Uint8Array(launch.modules.length);
                for (let k = 0; k < design.modules.length; k++) {
                    const module = design.modules[k]!;
                    if (module.shell !== undefined || this.pilotAt(b, k) !== owner || !this.wreckage(owner, b, k)) continue;
                    for (let l = 0; l < launch.modules.length; l++) {
                        if (rebuild.at[l]! >= 0 || taken[l] === 1) continue;
                        const origin = originOf(launch, l);
                        const whole = origin.design.modules[origin.module]!;
                        const placed = inFrame(
                            whole.spec,
                            reference.design.modules[reference.module]!.spec,
                            design.modules[rebuild.frame]!.spec,
                        );
                        if (
                            !sameWalls(module.spec, placed) ||
                            !(abs(module.stats.structureMass - whole.stats.structureMass) <= 1e-6 * whole.stats.structureMass)
                        )
                            continue;
                        swaps[k] = l;
                        taken[l] = 1;
                        break;
                    }
                }
            }
        }
        return rebuild.swaps[m] ?? -1;
    }

    /**
     * Make module `m` of body `b`, its fittings out, launch module `l` of ship
     * `i`'s refit: the same walls, its fittings still to go in.
     */
    private refitInPlace(world: World, b: number, m: number, i: number, l: number): void {
        const bodies = world.bodies;
        const p = this.shipAt(bodies, b);
        if (p < 0) return;
        const design = this.designs[p]!;
        const rebuild = this.rebuildFor(i, design);
        const origin = originOf(this.launched[i]!, l);
        const whole = origin.design.modules[origin.module]!;
        const reference = originOf(design, rebuild.frame);
        const placed = inFrame(whole.spec, reference.design.modules[reference.module]!.spec, design.modules[rebuild.frame]!.spec);
        const next = rebuiltDesign(design, m, placed, whole.stats, origin, null, design.pieces?.[m] ?? 0);
        const out = this.damage.unbuiltAt(b, m);

        this.momentum(bodies);
        const beforeX = this.momentumX;
        const beforeY = this.momentumY;
        const mass = bodies.mass[b]!;
        const inertia = bodies.inertia[b]!;
        this.regrow(world, p, b, design, next, m, i);
        this.damage.fit(b, m, out);
        this.damage.unfit(b, m, fittingOf(whole.stats));
        this.settleMass(bodies, b);
        this.discardFrom(bodies, b, mass, inertia);
        this.momentum(bodies);
        bodies.vx[b] = bodies.vx[b]! + (beforeX - this.momentumX) / movable(bodies.mass[b]!);
        bodies.vy[b] = bodies.vy[b]! + (beforeY - this.momentumY) / movable(bodies.mass[b]!);
    }

    /**
     * Whether ship `owner` has wreckage on body `b` its robots could take apart,
     * one that can come off without cutting the rest loose (`staysWhole`), and
     * room in the holds on its piece of hull at module `into` to bring it home to.
     */
    private strippable(owner: number, b: number, design: ShipDesign, into: number): boolean {
        const metalRoom = this.metal.pieceRoom(b, into) > ROBOT_SPENT;
        const fuelRoom = this.fuel.pieceRoom(b, into) > ROBOT_SPENT;
        if (!metalRoom && !fuelRoom) return false;
        for (let m = 0; m < design.modules.length; m++) {
            if (this.wreckage(owner, b, m) && this.comesOff(owner, b, design, m) && this.minable(design, m, metalRoom, fuelRoom))
                return true;
        }
        return false;
    }

    /**
     * Give a robot wreckage to take apart, once there is nothing to mend or
     * build and its bay's holds have room for what it brings home: a module
     * whose going leaves the rest held on, so a wreck comes off from its far
     * end inwards and never drifts free. Fewest robots already at it first, the
     * nearest of those. Says whether it found any.
     */
    private sendToStrip(b: number, design: ShipDesign, robots: Robot[], robot: Robot, owner: number, dist: Float64Array): boolean {
        const metalRoom = this.metal.pieceRoom(b, robot.bay) > ROBOT_SPENT || this.refitting[owner] === 1;
        const fuelRoom = this.fuel.pieceRoom(b, robot.bay) > ROBOT_SPENT;
        if (!(metalRoom || fuelRoom) || !(robot.cargo + robot.cargoFuel < ROBOT_LOAD - ROBOT_SPENT)) return false;
        let best = -1;
        let bestCrowd = Infinity;
        let bestDist = Infinity;
        for (let m = 0; m < design.modules.length; m++) {
            if (!Number.isFinite(dist[m]!) || !this.wreckage(owner, b, m) || !this.comesOff(owner, b, design, m)) continue;
            // Rock is worth taking only for what the bay has room for of what it holds.
            if (!this.minable(design, m, metalRoom, fuelRoom)) continue;
            // Its own hull's cores, bays and generators come down last of all, and only when due.
            if (this.ownWorkforce(owner, b, design, m) && !this.due(owner, b, design, m)) continue;
            // A bay comes down once its robots are home and taken apart; its own go home for that.
            if (design.modules[m]!.spec.kind === "robotBay" && this.ownWorkforce(owner, b, design, m)) {
                if (robot.bay === m) {
                    this.sendHome(b, design, robot, owner, m);
                    return true;
                }
                if (robots.some((other) => other.bay === m)) continue;
            }
            let crowd = 0;
            for (let k = 0; k < robots.length; k++) if (robots[k] !== robot && robots[k]!.target === m) crowd++;
            if (crowd < bestCrowd || (crowd === bestCrowd && dist[m]! < bestDist)) {
                best = m;
                bestCrowd = crowd;
                bestDist = dist[m]!;
            }
        }
        if (best < 0) return false;
        robot.target = best;
        robot.strip = true;
        return true;
    }

    /**
     * Whether a robot may take module `m` apart for what its bay has room for:
     * anything but a kernel, and rock only if it holds ore or ice the bay can
     * take. Any other wreckage is metal.
     */
    private minable(design: ShipDesign, m: number, metalRoom: boolean, fuelRoom: boolean): boolean {
        const spec = design.modules[m]!.spec;
        if (spec.kind === "kernel") return false;
        if (spec.kind !== "rock") return metalRoom;
        return (metalRoom && (spec.ore ?? 0) > 0) || (fuelRoom && (spec.ice ?? 0) > 0);
    }

    /**
     * Where taking module `m` of body `b` apart has got to: what it was whole,
     * how much of its walls stand, the face they go down towards, and the
     * metal the next step down holds, kg — its fittings, while it has any, and a
     * step of its walls, less what damage has shed of them.
     */
    private stripStep(b: number, design: ShipDesign, m: number): StripShape & { kg: number } {
        const module = design.modules[m]!;
        const shape = this.stripShapes.get(module.spec);
        const stats = module.stats;
        const dry = stats.structureMass + stats.fittingMass;
        const kept = dry > 0 ? 1 - this.damage.shedAt(b, m) / dry : 0;
        const whole = shape?.stats ?? stats;
        const fittings = shape === undefined ? fittingOf(stats) : 0;
        const kg = (fittings + whole.structureMass / SHELL_STEPS) * (kept > 0 ? kept : 0);
        if (shape !== undefined) return { ...shape, kg };
        const face = faceToward(module.spec, design.modules[neighbourOf(design, m)]!.spec);
        return { spec: module.spec, stats, face, share: 1, kg };
    }

    /**
     * One robot's step taking wreckage apart, which is building run backwards:
     * any metal the wreck holds first, as it is, then its fittings out and its
     * walls down a step at a time (`stepDown`), a kilogram the work it took to
     * build, paid for in charge. What comes off goes into the robot, less
     * `DISASSEMBLY_WASTE`, and once it is full, or short of charge, it takes it
     * home to its bay's holds.
     */
    private stripOne(b: number, design: ShipDesign, robots: Robot[], robot: Robot, owner: number, dt: number): boolean {
        const m = robot.target;
        if (m < 0 || m >= design.modules.length || !this.wreckage(owner, b, m) || !this.comesOff(owner, b, design, m)) {
            this.sendOut(b, design, robots, robot, owner);
            return false;
        }
        const room = ROBOT_LOAD - robot.cargo - robot.cargoFuel;
        if (!(room > ROBOT_SPENT)) {
            this.sendHome(b, design, robot, owner, robot.bay);
            return false;
        }
        const lift = (ROBOT_REPAIR_RATE / DAMAGE_ENERGY_PER_KG) * dt;
        // On its own piece of hull, what the module holds is its ship's: poured
        // into the rest of its stores before any of it comes down, and the rest
        // of the piece's metal left where it is.
        const own = (design.pieces?.[m] ?? 0) === (design.pieces === undefined ? 0 : this.ownPiece(owner, b));
        if (own && this.fuel.spill(b, m) + this.metal.spill(b, m) + this.power.spill(b, m) > 0) return true;
        const loose = own ? 0 : this.metal.pieceHeld(b, m);
        if (loose > ROBOT_SPENT) {
            robot.cargo += this.metal.drain(b, m, min(lift, room));
            return true;
        }
        const step = this.stripStep(b, design, m);
        // Refitted in place, only its fittings come out.
        if (this.swapFor(owner, b, design, m) >= 0)
            step.kg = fittingOf(step.stats) * (1 - this.damage.shedAt(b, m) / (step.stats.structureMass + step.stats.fittingMass));
        const work = buildWork(step.stats);
        // Rock is mined, not unbuilt: its ore smelted to metal and its ice melted
        // to fuel as it comes off, for more charge, and the rest of it lost.
        const spec = design.modules[m]!.spec;
        const rock = spec.kind === "rock";
        const ore = rock ? (spec.ore ?? 0) : 1;
        const ice = rock && this.fuel.pieceRoom(b, robot.bay) > ROBOT_SPENT ? (spec.ice ?? 0) : 0;
        const per = work * REPAIR_ENERGY_PER_JOULE * (rock ? MINING_POWER : 1);
        const done = this.damage.unbuiltAt(b, m);
        let kg = min((ROBOT_REPAIR_RATE / work) * dt, robot.charge / per);
        // Short of charge for a full step's work: this is its last.
        const short = kg < (ROBOT_REPAIR_RATE / work) * dt;
        const yieldPerKg = (ore + ice) * (1 - DISASSEMBLY_WASTE);
        kg = min(kg, yieldPerKg > 0 ? room / yieldPerKg : Infinity, step.kg - done);
        if (kg > 0) {
            this.damage.unfit(b, m, kg);
            robot.charge -= kg * per;
            robot.cargo += kg * ore * (1 - DISASSEMBLY_WASTE);
            robot.cargoFuel += kg * ice * (1 - DISASSEMBLY_WASTE);
        }
        if (done + (kg > 0 ? kg : 0) >= step.kg - ROBOT_SPENT) this.stripped[b] = m;
        if (short || !(ROBOT_LOAD - robot.cargo - robot.cargoFuel > ROBOT_SPENT)) this.sendHome(b, design, robot, owner, robot.bay);
        return kg > 0;
    }

    /**
     * Take a step of module `m` of body `b` down, the work for it done: a
     * module's fittings and the first step of its walls, then each step after,
     * the shell shrinking towards the face it was built against as a rebuilt
     * one grows, and at the last, what is left of it off the hull (`takeApart`).
     */
    private stepDown(world: World, b: number, m: number): void {
        const bodies = world.bodies;
        const p = this.shipAt(bodies, b);
        if (p < 0) return;
        const design = this.designs[p]!;
        if (m >= design.modules.length) return;
        const owner = this.pilotAt(b, m);
        const l = owner < 0 ? -1 : this.swapFor(owner, b, design, m);
        if (l >= 0) {
            this.refitInPlace(world, b, m, owner, l);
            return;
        }
        if (!staysWhole(design, m)) return;
        const step = this.stripStep(b, design, m);
        const share = step.share - 1 / SHELL_STEPS;
        if (!(share > 1e-9)) {
            this.takeApart(world, b, m);
            return;
        }
        this.settleShed(bodies);
        const part = shellOf(step.spec, step.stats, step.face, share);
        const next = rebuiltDesign(
            design,
            m,
            part.spec,
            part.stats,
            originOf(design, m),
            { share, face: step.face },
            design.pieces?.[m] ?? 0,
        );
        this.stripShapes.set(part.spec, { spec: step.spec, stats: step.stats, face: step.face, share });

        this.momentum(bodies);
        const beforeX = this.momentumX;
        const beforeY = this.momentumY;
        const mass = bodies.mass[b]!;
        const inertia = bodies.inertia[b]!;
        this.regrow(world, p, b, design, next, m, p);
        // A smaller shell takes what damage it had as harder hit, but nothing was
        // destroyed under a robot working it: it takes its footing again.
        for (const robot of this.robots.on(b) ?? []) if (robot.stoodOn === m) robot.stoodOn = -1;
        // What was taken off is already out of it, as fittings not in.
        this.damage.fit(b, m, step.kg);
        this.settleMass(bodies, b);
        // Never more of it than there was: what the walls left had shed is lost.
        if (bodies.mass[b]! > mass) {
            this.damage.unfit(b, m, bodies.mass[b]! - mass);
            this.settleMass(bodies, b);
        }
        this.discardFrom(bodies, b, mass, inertia);
        this.momentum(bodies);
        bodies.vx[b] = bodies.vx[b]! + (beforeX - this.momentumX) / movable(bodies.mass[b]!);
        bodies.vy[b] = bodies.vy[b]! + (beforeY - this.momentumY) / movable(bodies.mass[b]!);
    }

    /**
     * Take what is left of module `m` of body `b` off its hull, its last step
     * taken apart: anything still in it leaves the world. Robots on it step back
     * onto a neighbour. A ship with nothing left of it goes.
     */
    private takeApart(world: World, b: number, m: number): void {
        const bodies = world.bodies;
        const p = this.shipAt(bodies, b);
        if (p < 0) return;
        const design = this.designs[p]!;
        if (m >= design.modules.length || design.modules.length < 2 || !staysWhole(design, m)) return;
        this.settleShed(bodies);

        const keep: number[] = [];
        for (let k = 0; k < design.modules.length; k++) if (k !== m) keep.push(k);
        const next = subDesign(design, keep);
        const after = (k: number): number => (k > m ? k - 1 : k);
        // Every robot where it was and about what it was about, renumbered; one on
        // what is coming away steps onto what it was reached across.
        const step = neighbourOf(design, m);
        for (const robot of this.robots.on(b) ?? []) {
            // Out on a rock, only its bay is this hull's.
            if (robot.away >= 0) {
                robot.bay = after(robot.bay);
                continue;
            }
            if (robot.at === m) robot.at = step;
            robot.at = after(robot.at);
            robot.bay = after(robot.bay);
            robot.stoodOn = robot.stoodOn === m ? -1 : after(robot.stoodOn);
            if (robot.target === m) {
                robot.target = -1;
                robot.strip = false;
            } else if (robot.target > m) {
                robot.target--;
            }
            const path = robot.path;
            if (path !== null && path.includes(m)) {
                robot.path = null;
                robot.leg = 0;
                robot.along = 0;
            } else if (path !== null) {
                for (let k = 0; k < path.length; k++) path[k] = after(path[k]!);
            }
        }
        const riders = this.ridersOf(bodies, b);

        this.momentum(bodies);
        const beforeX = this.momentumX;
        const beforeY = this.momentumY;
        const mass = bodies.mass[b]!;
        const inertia = bodies.inertia[b]!;
        const id = this.bodyIds[p]!;
        const offset = this.offsetOf(bodies, b, design, next);
        const spin = bodies.angularVel[b]!;
        bodies.x[b] = bodies.x[b]! + offset.x;
        bodies.y[b] = bodies.y[b]! + offset.y;
        bodies.vx[b] = bodies.vx[b]! - spin * offset.y;
        bodies.vy[b] = bodies.vy[b]! + spin * offset.x;
        bodies.setMass(id, next.mass);
        bodies.setInertia(id, next.inertia);
        bodies.radius[b] = next.radius;
        const pilots = this.pilots[b];
        if (pilots !== null && pilots !== undefined) this.pilots[b] = Int32Array.from(keep, (k) => pilots[k]!);
        this.adopt(
            p,
            b,
            next,
            () => p,
            (k) => keep[k]!,
            true,
            true,
        );
        for (const r of riders) if (r !== p) this.board(r, p);
        this.renumber(bodies, b, riders, m);
        // A ship riding here with none of its hull left is gone, and the body
        // passes to one that has some, if it was this one's.
        const left = this.pilots[b];
        if (left !== null && left !== undefined) {
            for (const r of riders) {
                if (left.includes(r)) continue;
                if (this.shipByBody[b] === r) {
                    const heir = riders.find((o) => o !== r && left.includes(o));
                    if (heir === undefined) continue;
                    this.shipByBody[b] = heir;
                }
                // Its mounts are the body's, still worked by whoever is left.
                this.turretIndex[r] = new Int32Array(0);
                this.remove(r);
            }
        }
        this.settleMass(bodies, b);
        this.discardFrom(bodies, b, mass, inertia);
        this.momentum(bodies);
        bodies.vx[b] = bodies.vx[b]! + (beforeX - this.momentumX) / movable(bodies.mass[b]!);
        bodies.vy[b] = bodies.vy[b]! + (beforeY - this.momentumY) / movable(bodies.mass[b]!);
    }

    /** Module `m` of body `b` gone: every ship's note of a module past it there moves down one. */
    private renumber(bodies: Bodies, b: number, riders: readonly number[], m: number): void {
        const down = (k: number): number => (k > m ? k - 1 : k === m ? -1 : k);
        for (const r of riders) if (this.ownPort[r]! >= 0) this.ownPort[r] = down(this.ownPort[r]!);
        for (let s = 0; s < this.alive.length; s++) {
            if (this.alive[s] === 0) continue;
            const t = this.salvaging[s]!;
            if (t === NO_TARGET || this.alive[t] !== 1 || bodies.indexOf(this.bodyIds[t]!) !== b) continue;
            if (this.landingPad[s]! >= 0) this.landingPad[s] = down(this.landingPad[s]!);
            if (this.dockPort[s]! >= 0) this.dockPort[s] = down(this.dockPort[s]!);
        }
    }

    private walkDist = new Float64Array(0);
    private walkPrev = new Int32Array(0);

    private walkScratch(n: number): { dist: Float64Array; prev: Int32Array } {
        if (this.walkDist.length < n) {
            this.walkDist = new Float64Array(n);
            this.walkPrev = new Int32Array(n);
        }
        return { dist: this.walkDist, prev: this.walkPrev };
    }

    /**
     * How many robots are home in each module of ship `i`'s hull, by module,
     * into `out`: all nought unless `i` is the ship that flies the body.
     */
    robotsBerthed(i: number, out: number[]): void {
        const b = this.bodyStore === null ? -1 : this.bodyStore.indexOf(this.bodyIds[i]!);
        const design = b >= 0 ? this.hullDesign[b] : null;
        out.length = design?.modules.length ?? 0;
        out.fill(0);
        if (b < 0 || this.shipByBody[b] !== i) return;
        for (const robot of this.robots.on(b) ?? []) if (robot.mode === RobotMode.Berthed) out[robot.bay] = (out[robot.bay] ?? 0) + 1;
    }

    /**
     * Each robot home on ship `i`'s hull, four numbers apiece into `out`: its
     * bay, the share of its charge and of its metal it has, its metal counted
     * up over its refill, or what it brought home counted down as it unloads,
     * so that is seen happening, and its berth there. Nothing unless `i`
     * is the ship that flies the body.
     */
    robotsDocked(i: number, out: number[]): void {
        out.length = 0;
        const b = this.bodyStore === null ? -1 : this.bodyStore.indexOf(this.bodyIds[i]!);
        if (b < 0 || this.shipByBody[b] !== i) return;
        const robots = this.robots.on(b) ?? [];
        for (let r = 0; r < robots.length; r++) {
            const robot = robots[r]!;
            if (robot.mode !== RobotMode.Berthed) continue;
            // Unloading what it fetched, its bar empties; topping up what it mends with, it fills.
            const left = robot.refill / ROBOT_REFILL_TIME;
            const metal = robot.refill > 0 ? (robot.brought > 0 ? robot.brought * left : 1 - left) : robot.metal / ROBOT_LOAD;
            out.push(robot.bay, robot.charge / ROBOT_CHARGE, metal, this.berthOf(robots, r));
        }
    }

    /**
     * For each module of ship `i`'s hull, how many robots it is the bay of,
     * home or out, into `crews`, and how many of those are aboard, holding a
     * berth, into `aboard`; and each robot a bay is building, as its bay and how
     * far it is through, 0 to 1, into `builds`, two numbers apiece, the most
     * nearly finished of a bay first. Nothing unless `i` is the ship that flies the body.
     */
    robotCrews(i: number, crews: number[], aboard: number[], builds: number[]): void {
        const b = this.bodyStore === null ? -1 : this.bodyStore.indexOf(this.bodyIds[i]!);
        const design = b >= 0 ? this.hullDesign[b] : null;
        crews.length = aboard.length = design?.modules.length ?? 0;
        builds.length = 0;
        crews.fill(0);
        aboard.fill(0);
        if (b < 0 || this.shipByBody[b] !== i) return;
        for (const robot of this.robots.on(b) ?? []) {
            crews[robot.bay] = (crews[robot.bay] ?? 0) + 1;
            if (robot.away < 0) aboard[robot.bay] = (aboard[robot.bay] ?? 0) + 1;
        }
        const making = this.robots.buildingOn(b);
        if (making !== null) for (let m = 0; m < making.length; m++) for (const done of making[m]!) builds.push(m, done / ROBOT_BUILD_TIME);
    }

    /**
     * Each robot out on ship `i`'s hull, `ROBOT_VIEW_STRIDE` numbers apiece into
     * `out`: where it is and which way it faces, in its body's frame, and the
     * share of its charge and of its metal it has left. Nothing unless `i` is
     * the ship that flies the body, so a hull two ships share shows its robots
     * once.
     */
    robotViews(i: number, out: number[]): void {
        out.length = 0;
        const b = this.bodyStore === null ? -1 : this.bodyStore.indexOf(this.bodyIds[i]!);
        if (b < 0 || this.shipByBody[b] !== i) return;
        const robots = this.robots.on(b) ?? [];
        const design = this.hullDesign[b];
        const bodies = this.bodyStore!;
        if (design === null || design === undefined) return;
        this.placeOwner = i;
        this.placeHull = b;
        // A rock shows the robots stranded on it, where they stand, dotted over the module as any are.
        const here = this.strandedHere;
        here.length = 0;
        for (let k = 0; k < this.stranded.length; k++) {
            const robot = this.stranded[k]!.robot;
            if (robot.awayDesign === design && bodies.indexOf(this.bodyIds[robot.away]!) === b) here.push(robot);
        }
        for (let k = 0; k < here.length; k++) {
            const robot = here[k]!;
            const module = design.modules[robot.at]!;
            const heading = this.robotPlace(design, here, k);
            out.push(
                module.x + this.robotDx,
                module.y + this.robotDy,
                heading,
                robot.charge / ROBOT_CHARGE,
                (robot.cargo + robot.cargoFuel) / ROBOT_LOAD,
            );
        }
        for (let r = 0; r < robots.length; r++) {
            const robot = robots[r]!;
            if (robot.mode === RobotMode.Berthed) continue;
            if (robot.away >= 0) {
                this.awayView(b, robots, r, out);
                continue;
            }
            const here = design.modules[robot.at]!;
            const charge = robot.charge / ROBOT_CHARGE;
            // Taking wreckage apart, it fills with what it carries home.
            const metal = robotLoad(robot);
            const heading = this.robotPlace(design, robots, r);
            out.push(here.x + this.robotDx, here.y + this.robotDy, heading, charge, metal);
        }
    }

    /** Where `robotPlace` puts a robot from the middle of the module it is on, m, in its design's frame. */
    private robotDx = 0;
    private robotDy = 0;
    /** Where `spotOn` puts a robot from a module's middle, m, in its design's frame. */
    private spotX = 0;
    private spotY = 0;
    /** The ship, and its body, whose robots `robotPlace` is placing. */
    private placeOwner = -1;
    private placeHull = -1;

    /**
     * Where robot `r` is drawn from the middle of the module it is on, into
     * `robotDx` and `robotDy`, and which way it faces. Each robot has its own
     * spot on each module (`spotOn`), works there, and crawls straight from its
     * spot on one module to its spot on the next, so it arrives where it works.
     */
    private robotPlace(design: ShipDesign, robots: Robot[], r: number): number {
        const robot = robots[r]!;
        const here = design.modules[robot.at]!;
        this.spotFor(design, robot.at, robots, r);
        const fromX = this.spotX;
        const fromY = this.spotY;
        const path = robot.path;
        if (path !== null && robot.leg < path.length - 1) {
            const next = path[robot.leg + 1]!;
            const there = design.modules[next]!;
            this.spotFor(design, next, robots, r);
            const leg = legLength(design, path, robot.leg);
            const t = leg > 0 ? min(1, robot.along / leg) : 0;
            const toX = there.x + this.spotX - here.x;
            const toY = there.y + this.spotY - here.y;
            // By where the two meet, so it never crosses a gap between their corners.
            const door = doorBetween(design, robot.at, next);
            const doorX = door === null ? fromX : door[0] - here.x;
            const doorY = door === null ? fromY : door[1] - here.y;
            const first = length(doorX - fromX, doorY - fromY);
            const second = length(toX - doorX, toY - doorY);
            const gone = t * (first + second);
            if (gone < first) {
                const share = first > 0 ? gone / first : 0;
                this.robotDx = fromX + (doorX - fromX) * share;
                this.robotDy = fromY + (doorY - fromY) * share;
                // Facing the way it crawls.
                return atan2(doorY - fromY, doorX - fromX);
            }
            const share = second > 0 ? (gone - first) / second : 1;
            this.robotDx = doorX + (toX - doorX) * share;
            this.robotDy = doorY + (toY - doorY) * share;
            return atan2(toY - doorY, toX - doorX);
        }
        this.robotDx = fromX;
        this.robotDy = fromY;
        // Facing in to the middle of the module it is working on.
        return atan2(-fromY, -fromX);
    }

    /**
     * Robot `r`'s spot on module `m` of `design`, its own hull's or, out, its
     * rock's, from the module's middle, into `spotX` and `spotY`. Its own bay's
     * is its berth, so it walks home onto its pad. Moored, its claw's is where
     * the claw grips, and the gripped rock's is the same place, so it steps
     * across without moving; elsewhere, its own spot on the module (`spotOn`).
     */
    private spotFor(design: ShipDesign, m: number, robots: Robot[], r: number): void {
        const robot = robots[r]!;
        const owner = this.placeOwner;
        const hull = this.placeHull;
        if (robot.away < 0 && m === robot.bay) {
            this.berthSpot(design, m, robots, r);
            return;
        }
        const claw = this.mooredClaw[owner]!;
        const bodies = this.bodyStore!;
        const cb = claw >= 0 ? this.carrierBodyOf(bodies, owner) : -1;
        const atClaw = robot.away < 0 && m === claw;
        const atGrip = robot.away >= 0 && robot.away === this.parkedOn[owner] && m === this.heldRock(bodies, owner);
        if (cb < 0 || hull < 0 || !(atClaw || atGrip)) {
            this.spotOn(design, m, robot.tag);
            return;
        }
        // The grip, in the hull's frame, by way of the world, with a little of its own spot on the claw about it.
        const hd = this.hullDesign[hull]!;
        const rd = this.hullDesign[cb]!;
        const rc = cos(bodies.angle[cb]!);
        const rs = sin(bodies.angle[cb]!);
        const gx = this.mooredGripX[owner]! - rd.centreOfMassX;
        const gy = this.mooredGripY[owner]! - rd.centreOfMassY;
        const wx = bodies.x[cb]! + gx * rc - gy * rs - bodies.x[hull]!;
        const wy = bodies.y[cb]! + gx * rs + gy * rc - bodies.y[hull]!;
        const hc = cos(bodies.angle[hull]!);
        const hs = sin(bodies.angle[hull]!);
        this.spotOn(hd, claw, robot.tag);
        const px = wx * hc + wy * hs + ROBOT_GRIP_SPREAD * this.spotX;
        const py = -wx * hs + wy * hc + ROBOT_GRIP_SPREAD * this.spotY;
        if (atClaw) {
            this.spotX = px - hd.modules[claw]!.x;
            this.spotY = py - hd.modules[claw]!.y;
            return;
        }
        // And back out into the rock's frame, as the design it is out on has it.
        const qx = bodies.x[hull]! + px * hc - py * hs - bodies.x[cb]!;
        const qy = bodies.y[hull]! + px * hs + py * hc - bodies.y[cb]!;
        this.spotX = qx * rc + qy * rs + rd.centreOfMassX - design.centreOfMassX - design.modules[m]!.x;
        this.spotY = -qx * rs + qy * rc + rd.centreOfMassY - design.centreOfMassY - design.modules[m]!.y;
    }

    /**
     * Robot `r`'s berth in its bay `m`, from the bay's middle, into `spotX` and
     * `spotY`: the pad of the bay's grid (`berthGrid`) its place among the
     * bay's robots gives it, where it is drawn once home.
     */
    private berthSpot(design: ShipDesign, m: number, robots: Robot[], r: number): void {
        const spec = design.modules[m]!.spec;
        const { across, down } = berthGrid(spec);
        const slot = this.berthOf(robots, r);
        const along = -0.5 * spec.length + (spec.length / max(1, across)) * ((slot % max(1, across)) + 0.5);
        const side = -0.5 * spec.width + (spec.width / max(1, down)) * (floor(slot / max(1, across)) + 0.5);
        const angle = spec.angle ?? 0;
        const c = cos(angle);
        const s = sin(angle);
        this.spotX = along * c - side * s;
        this.spotY = along * s + side * c;
    }

    /** Which of its bay's berths robot `r` has: its place among the robots of that bay aboard. */
    private berthOf(robots: Robot[], r: number): number {
        let slot = 0;
        for (let k = 0; k < r; k++) if (robots[k]!.bay === robots[r]!.bay && robots[k]!.away < 0) slot++;
        return slot;
    }

    /** How many berths of body `b`'s bay `bay` are taken: its robots aboard, not out on a rock, and those it is building. */
    private aboardIn(b: number, bay: number): number {
        const robots = this.robots.on(b);
        let aboard = this.robots.buildingOn(b)?.[bay]?.length ?? 0;
        if (robots !== null) for (let r = 0; r < robots.length; r++) if (robots[r]!.bay === bay && robots[r]!.away < 0) aboard++;
        return aboard;
    }

    /**
     * Robot `tag`'s spot on module `m`, from its middle, into `spotX` and
     * `spotY`: over the middle of the module, the robots of one body dotted
     * evenly over it, each module laid out its own way.
     */
    private spotOn(design: ShipDesign, m: number, tag: number): void {
        const spec = design.modules[m]!.spec;
        // A low-discrepancy sequence by tag, so robots numbered together stand apart.
        const u = (tag * 0.7548776662 + robotShare(m, 1)) % 1;
        const v = (tag * 0.5698402911 + robotShare(m, 2)) % 1;
        const corners = spec.vertices;
        if (corners !== undefined) {
            // A shaped module's box is not centred on it: one triangle of the fan
            // from its middle, and a point within it, so the spot is on the matter.
            const n = corners.length / 2;
            const k = floor(u * n);
            const f = u * n - k;
            const reach = ROBOT_SPOT_SHARE * sqrt(v);
            const j = (k + 1) % n;
            const x = reach * ((1 - f) * corners[2 * k]! + f * corners[2 * j]!);
            const y = reach * ((1 - f) * corners[2 * k + 1]! + f * corners[2 * j + 1]!);
            const c = cos(spec.angle ?? 0);
            const s = sin(spec.angle ?? 0);
            this.spotX = x * c - y * s;
            this.spotY = x * s + y * c;
            return;
        }
        const along = (2 * u - 1) * ROBOT_SPOT_SHARE * 0.5 * spec.length;
        const across = (2 * v - 1) * ROBOT_SPOT_SHARE * 0.5 * spec.width;
        const angle = spec.angle ?? 0;
        const c = cos(angle);
        const s = sin(angle);
        this.spotX = along * c - across * s;
        this.spotY = along * s + across * c;
    }

    /** `robotViews` for robot `r`, out on its rock, put in the frame of its own ship's body `b`. */
    private awayView(b: number, robots: Robot[], r: number, out: number[]): void {
        const bodies = this.bodyStore!;
        const robot = robots[r]!;
        const rock = robot.away;
        const cb = this.alive[rock] === 1 ? bodies.indexOf(this.bodyIds[rock]!) : -1;
        const rd = robot.awayDesign;
        const here = rd?.modules[robot.at];
        if (cb < 0 || rd === null || here === undefined) return;
        const heading = this.robotPlace(rd, robots, r);
        const x = here.x + this.robotDx;
        const y = here.y + this.robotDy;
        // From the rock's frame to the world's, and into its own ship's.
        const rc = cos(bodies.angle[cb]!);
        const rs = sin(bodies.angle[cb]!);
        const wx = bodies.x[cb]! + x * rc - y * rs - bodies.x[b]!;
        const wy = bodies.y[cb]! + x * rs + y * rc - bodies.y[b]!;
        const turn = bodies.angle[cb]! - bodies.angle[b]!;
        const c = cos(-bodies.angle[b]!);
        const s = sin(-bodies.angle[b]!);
        const metal = robotLoad(robot);
        out.push(wx * c - wy * s, wx * s + wy * c, heading + turn, robot.charge / ROBOT_CHARGE, metal);
    }

    /** Whether the ship a dock is filling minds danger and has an armed enemy in reach of the pair. */
    private threatenedAt(bodies: Bodies, b: number, seam: Seam): boolean {
        let receiver: number;
        if (seam.dock === "claw") receiver = this.pilotAt(b, seam.a);
        else {
            const oa = this.pilotAt(b, seam.a);
            const ob = this.pilotAt(b, seam.b);
            receiver = this.docking[oa] === 1 ? oa : this.docking[ob] === 1 ? ob : -1;
        }
        if (receiver < 0 || this.sentTo(receiver)) return false;
        if (this.threatened(bodies, receiver, b, seam.dock !== "claw")) return true;
        // Holding a wreck, it cannot get out of the way of anything: what can
        // will, but a hulk cannot.
        return seam.dock === "claw" && this.hulkBearingDown(bodies, receiver, b);
    }

    /** Whether a hulk will hit body `b` within ship `i`'s look-ahead. */
    private hulkBearingDown(bodies: Bodies, i: number, b: number): boolean {
        const approach = this.doctrines[i]!.approach;
        if (!(approach.separation > 0)) return false;
        const mine = bodies.radius[b]!;
        for (let t = 0; t < this.alive.length; t++) {
            if (this.alive[t] === 0 || this.hasControl(t)) continue;
            const ob = bodies.indexOf(this.bodyIds[t]!);
            if (ob < 0 || ob === b || bodies.ghost[ob] === 1 || !this.meets(b, ob)) continue;
            const dx = bodies.x[ob]! - bodies.x[b]!;
            const dy = bodies.y[ob]! - bodies.y[b]!;
            const rvx = bodies.vx[ob]! - bodies.vx[b]!;
            const rvy = bodies.vy[ob]! - bodies.vy[b]!;
            const closing = dx * rvx + dy * rvy;
            if (!(closing < 0)) continue;
            const when = -closing / (rvx * rvx + rvy * rvy);
            if (when > approach.avoidHorizon) continue;
            if (length(dx + rvx * when, dy + rvy * when) < mine + bodies.radius[ob]!) return true;
        }
        return false;
    }

    /** How far ship `i` fights from, metres: its guns' reach, or a ram's run if it has none. */
    private fightReach(i: number): number {
        const reach = this.designs[i]!.reach;
        const approach = this.doctrines[i]!.approach;
        return reach > 0 ? reach : approach.ramRadii > 0 ? approach.approachSpeed * RAM_HORIZON : 0;
    }

    /**
     * Whether fighter `i`, aboard body `b`, waits: it has no target, or its
     * target is further off than its `sortieRange` times its reach. A fighter
     * with no way to fight never waits.
     */
    private waitsAboard(bodies: Bodies, i: number, b: number): boolean {
        const reach = this.landedReach[i]!;
        if (!(reach > 0)) return false;
        const target = this.chosen[i]!;
        if (target === NO_TARGET) return true;
        const tb = bodies.indexOf(this.bodyIds[target]!);
        if (tb < 0) return true;
        const apart = length(bodies.x[tb]! - bodies.x[b]!, bodies.y[tb]! - bodies.y[b]!);
        return apart > this.doctrines[i]!.approach.sortieRange * reach;
    }

    /**
     * Whether ship `i` minds danger and has an armed enemy within reach of body
     * `at`: by its `scavengeDanger` at a source, by its `dockDanger` at a friend's dock.
     */
    private threatened(bodies: Bodies, i: number, at: number, dock: boolean): boolean {
        const approach = this.doctrines[i]!.approach;
        return (dock ? approach.dockDanger : approach.scavengeDanger) > 0 && this.dangerNear(bodies, i, at) > 0;
    }

    /**
     * The fuel the ship working module `m` of body `b` keeps back from that
     * module's piece of hull for its own engines and weapons, kg: its
     * doctrine's `fuelReserve` of a full load.
     */
    private reserve(b: number, m: number): number {
        const owner = this.pilotAt(b, m);
        const kept = owner < 0 ? 0 : this.doctrines[owner]!.approach.fuelReserve;
        return kept > 0 ? kept * (this.fuel.pieceHeld(b, m) + this.fuel.pieceRoom(b, m)) : 0;
    }

    /** The same for charge, its doctrine's `chargeReserve`. */
    private chargeReserve(b: number, m: number): number {
        const owner = this.pilotAt(b, m);
        const kept = owner < 0 ? 0 : this.doctrines[owner]!.approach.chargeReserve;
        return kept > 0 ? kept * (this.power.pieceHeld(b, m) + this.power.pieceRoom(b, m)) : 0;
    }

    /** The same for metal, its doctrine's `metalReserve`. */
    private metalReserve(b: number, m: number): number {
        const owner = this.pilotAt(b, m);
        const kept = owner < 0 ? 0 : this.doctrines[owner]!.approach.metalReserve;
        return kept > 0 ? kept * (this.metal.pieceHeld(b, m) + this.metal.pieceRoom(b, m)) : 0;
    }

    /** The doctrine of whoever works module `m` of body `b`, or the default for nobody's. */
    private approachAt(b: number, m: number): Approach {
        const owner = this.pilotAt(b, m);
        return owner < 0 ? DEFAULT_DOCTRINE.approach : this.doctrines[owner]!.approach;
    }

    /**
     * How much `claim` may take of resource `r` now from module `m`'s piece of
     * body `b` (`Supply.allow`), wanting `want` in all. Ask once a step with
     * what it wants, and again with nothing to look again.
     */
    private allowed(r: Resource, b: number, m: number, claim: Claim, want: number): number {
        const reserve =
            r === Resource.Fuel ? this.reserve(b, m) : r === Resource.Metal ? this.metalReserve(b, m) : this.chargeReserve(b, m);
        return this.supply.allow(b, r, m, claim, want, reserve, this.approachAt(b, m), this.tick);
    }

    /** Note what `claim` took (`Supply.took`). */
    private took(r: Resource, b: number, m: number, claim: Claim, amount: number): void {
        this.supply.took(b, r, m, claim, amount);
    }

    /**
     * Make `other` part of `keep`, hooked where module `mk` of one met module
     * `mo` of the other. Momentum and angular momentum come out as they went in:
     * one rigid body moving as the two did between them.
     */
    private merge(world: World, keep: number, other: number, mk: number, mo: number, dock: DockAt | null = null): void {
        const bodies = world.bodies;
        this.settleShed(bodies);
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
        // A dock holds across the whole of its part; torn metal catches on part of an edge.
        const width =
            dock === null
                ? HOOK_SHARE * min(min(specK.length, specK.width), min(specO.length, specO.width))
                : dock.at === "a"
                  ? specK.width
                  : specO.width;
        const design = weldDesigns(dk, dO, dx, dy, turn, mk, mo, width, dock);

        const massK = bodies.mass[bk]!;
        const massO = bodies.mass[bo]!;
        const total = massK + massO;
        const cx = bodies.x[bk]! + (design.centreOfMassX - dk.centreOfMassX) * ck - (design.centreOfMassY - dk.centreOfMassY) * sk;
        const cy = bodies.y[bk]! + (design.centreOfMassX - dk.centreOfMassX) * sk + (design.centreOfMassY - dk.centreOfMassY) * ck;
        // A pinned keeper goes on as its rail has it, whatever joins it.
        const pinned = bodies.pinned[bk] === 1;
        const vx = pinned ? bodies.vx[bk]! : (massK * bodies.vx[bk]! + massO * bodies.vx[bo]!) / total;
        const vy = pinned ? bodies.vy[bk]! : (massK * bodies.vy[bk]! + massO * bodies.vy[bo]!) / total;
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

        this.adopt(
            keep,
            bk,
            design,
            (m) => (m < n ? keep : other),
            (m) => (m < n ? m : m - n),
        );
        this.pilots[bk] = pilots;
        // Spun up against the inertia the fuel left aboard gives it.
        bodies.angularVel[bk] = angular / bodies.inertia[bk]!;

        const gone = this.bodyIds[other]!;
        this.damage.forget(bo);
        this.fuel.forget(bo);
        this.metal.forget(bo);
        this.power.forget(bo);
        this.robots.forget(bo);
        this.shipByBody[bo] = -1;
        this.pilots[bo] = null;
        this.sides[bo] = null;
        this.paint[bo] = null;
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
     * Small debris goes sooner, wherever it is, once it is in nobody's way
     * (`loose`).
     *
     * Only wreckage. A ship is tracked wherever it goes, because a ship can
     * come back.
     */
    cull(world: World): number {
        const bodies = world.bodies;
        const area = this.battleArea(bodies);
        const period = max(1, round(LOOSE_PERIOD / world.dt));
        const looking = world.tick % period === 0;
        let dropped = 0;

        for (let i = 0; i < this.alive.length; i++) {
            if (this.alive[i] === 0 || this.derelict[i] === 0) continue;
            const b = bodies.indexOf(this.bodyIds[i]!);
            if (b < 0) continue;
            const design = this.designs[i]!;
            const reach = area.radius + (design.mass - SCRAP_MASS) * SALVAGE_REACH;
            const away = length(bodies.x[b]! - area.x, bodies.y[b]! - area.y) > reach;
            if (!away && !(looking && this.loose(world, i, b))) continue;

            const mass = bodies.mass[b]!;
            this.discarded += mass;
            this.discardedPx += mass * bodies.vx[b]!;
            this.discardedPy += mass * bodies.vy[b]!;
            this.discardedL +=
                bodies.inertia[b]! * bodies.angularVel[b]! + mass * (bodies.x[b]! * bodies.vy[b]! - bodies.y[b]! * bodies.vx[b]!);
            this.damage.forget(b);
            this.fuel.forget(b);
            this.metal.forget(b);
            this.power.forget(b);
            this.robots.forget(b);
            this.shipByBody[b] = -1;
            this.remove(i);
            world.destroy(this.bodyIds[i]!);
            dropped++;
        }

        return dropped;
    }

    /**
     * Whether wreck `i`, on body `b`, is small debris in nobody's way: lighter
     * than `LOOSE_MASS`, loose for `LOOSE_AGE`, nobody's salvage, and with
     * nothing under control due to pass within `LOOSE_CLEARANCE` of it in the
     * next `LOOSE_HORIZON`, going as both are. Such a piece will not be gone
     * after and is not in the way, so it is only scenery. Another wreck does
     * not keep it: two that meet weld into something heavier.
     */
    private loose(world: World, i: number, b: number): boolean {
        const bodies = world.bodies;
        if (!(bodies.mass[b]! < LOOSE_MASS) || (world.tick - this.partedAt[i]!) * world.dt < LOOSE_AGE) return false;
        for (let t = 0; t < this.alive.length; t++) {
            if (this.alive[t] === 0 || this.derelict[t] === 1) continue;
            if (this.salvaging[t] === i) return false;
            if (!this.hasControl(t)) continue;
            const tb = bodies.indexOf(this.bodyIds[t]!);
            if (tb < 0 || tb === b) continue;
            const dx = bodies.x[tb]! - bodies.x[b]!;
            const dy = bodies.y[tb]! - bodies.y[b]!;
            const vx = bodies.vx[tb]! - bodies.vx[b]!;
            const vy = bodies.vy[tb]! - bodies.vy[b]!;
            const speedSq = vx * vx + vy * vy;
            const when = speedSq > 0 ? clamp(-(dx * vx + dy * vy) / speedSq, 0, LOOSE_HORIZON) : 0;
            const clear = bodies.radius[b]! + bodies.radius[tb]! + LOOSE_CLEARANCE;
            if (length(dx + vx * when, dy + vy * when) < clear) return false;
        }
        return true;
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

    /**
     * What damage has left of a module's effect, for the ship working it: none
     * for anyone else, and none while no working core reaches it (`inReach`).
     */
    private left(i: number, b: number, module: number, effect: DamageEffect): number {
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
    private answer(world: World, bodyIndex: number, module: number, jx: number, jy: number, px: number, py: number): number {
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
        const dvx = jx * invMass * c + jy * invMass * s;
        const dvy = -(jx * invMass) * s + jy * invMass * c;

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
        this.settleShed(bodies);
        this.momentum(bodies);
        const beforeX = this.momentumX;
        const beforeY = this.momentumY;
        this.parted[i] = 0;
        const pieces = this.breakApart(world, i, design, parts);
        // Cut between its cores, it is now the ship flown from the one it kept, as
        // each piece that flew off is the ship flown from its own.
        if (this.parted[i] === 1) {
            const kept = this.designs[i]!;
            const core =
                kept.cores.find((c) => this.damage.remaining(bodies.indexOf(this.bodyIds[i]!), c, DamageEffect.Control) > 0) ??
                kept.cores[0];
            const name = core === undefined ? null : this.paintAt(bodies.indexOf(this.bodyIds[i]!), core);
            if (name !== null) this.names[i] = name;
            this.parted[i] = 0;
        }
        // Each piece leaves at the hull's velocity at its own centre of mass, which
        // conserves momentum only if the hull's mass is where its design put it.
        // What spending and damage have taken off unevenly says otherwise, so the
        // piece that stays with the ship takes up the difference.
        this.momentum(bodies);
        const b = bodies.indexOf(this.bodyIds[i]!);
        const mass = bodies.mass[b]!;
        if (mass > 0) {
            bodies.vx[b] = bodies.vx[b]! + (beforeX - this.momentumX) / mass;
            bodies.vy[b] = bodies.vy[b]! + (beforeY - this.momentumY) / mass;
        }
        return pieces;
    }

    /** The world's momentum, with what it has discarded, into `momentumX` and `momentumY`. */
    private momentum(bodies: Bodies): void {
        let x = this.discardedPx;
        let y = this.discardedPy;
        for (let b = 0; b < bodies.highWater; b++) {
            // A parked fighter's is its carrier's.
            if (bodies.alive[b] === 0 || this.isParkedBody(b)) continue;
            x += bodies.mass[b]! * bodies.vx[b]!;
            y += bodies.mass[b]! * bodies.vy[b]!;
        }
        this.momentumX = x;
        this.momentumY = y;
    }

    private momentumX = 0;
    private momentumY = 0;

    private breakApart(world: World, i: number, design: ShipDesign, parts: readonly number[][]): number {
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
            const core = design.cores.find((c) => partOf[c] === p && this.damage.remaining(b, c, DamageEffect.Control) > 0);
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
    private rehome(
        world: World,
        from: number,
        aboard: readonly number[],
        was: ShipDesign,
        keep: readonly number[],
        pilots: Int32Array,
    ): void {
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
        this.adopt(
            p,
            nb,
            chunk,
            () => from,
            (m) => keep[m]!,
            false,
        );
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
     * is merely which body goes on being tracked. An asteroid keeps the piece
     * holding its kernel, which is the one its rail pins in place; rock knocked
     * off it goes free.
     */
    private keeperOf(bodyIndex: number, design: ShipDesign, parts: readonly number[][]): number {
        const partOf = new Map<number, number>();
        for (let p = 0; p < parts.length; p++) {
            for (const module of parts[p]!) partOf.set(module, p);
        }
        for (let m = 0; m < design.modules.length; m++) {
            if (design.modules[m]!.spec.kind === "kernel") return partOf.get(m) ?? 0;
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
        const metal = min(this.damage.integrity(bodyIndex, joint.a), this.damage.integrity(bodyIndex, joint.b));
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
        const flies = chunk.cores.some((core) => this.damage.remaining(b, keep[core]!, DamageEffect.Control) > 0);
        // Scrap never reaches the world, so nothing the eye was following ever
        // vanishes: a piece this small is not created rather than removed. A piece
        // that still flies is not scrap at whatever mass — it is a ship, and the
        // smallest ship in the game weighs less than this.
        let mass = chunk.mass;
        for (let m = 0; m < keep.length; m++) {
            const { stats } = chunk.modules[m]!;
            mass -= stats.fuel - this.fuel.held(b, keep[m]!) + stats.metal - this.metal.held(b, keep[m]!);
            mass -= this.damage.shedAt(b, keep[m]!);
        }
        if (!flies && mass < SCRAP_MASS) {
            this.discarded += mass;
            // Whatever it would have left with, had it been worth putting there.
            const vx = bodies.vx[b]! - spin * offset.y;
            const vy = bodies.vy[b]! + spin * offset.x;
            this.discardedPx += mass * vx;
            this.discardedPy += mass * vy;
            // Its inertia taken as its full design's, scaled to what it weighs.
            this.discardedL +=
                ((chunk.inertia * mass) / chunk.mass) * spin + mass * ((bodies.x[b]! + offset.x) * vy - (bodies.y[b]! + offset.y) * vx);
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
        this.couldFight[j] = this.couldFight[side]!;
        if (flies) {
            this.orders[j] = this.orders[side]!.map((order) => ({ ...order }));
            // And what it was told of how to fight.
            this.overrides[j] = this.overrides[side];
            this.keeps[j] = this.keeps[side];
            this.crafts[j] = this.crafts[side];
            this.doctrines[j] = overriddenDoctrine(this.ownDoctrines[j]!, this.overrides[j]);
            // Still that ship, so it rebuilds to the design that ship set out as: a
            // hull cut in two can grow back into two. Wreckage sets out as itself.
            this.launched[j] = this.launched[side]!;
            // Named for the core it is flown from, by what is painted on it.
            const core = chunk.cores.find((c) => this.damage.remaining(b, keep[c]!, DamageEffect.Control) > 0);
            const name = core === undefined ? null : this.paintAt(b, keep[core]!);
            if (name !== null) {
                this.names[j] = name;
                if (side === i) this.parted[i] = 1;
            }
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
            keep.map((m) => this.damage.unbuiltAt(b, m)),
        );
        this.fuel.register(
            chunkBody,
            chunk,
            keep.map((m) => this.fuel.held(b, m)),
            this.leaksInto(keep.length, (m) => ({ body: b, module: keep[m]! })),
        );
        this.metal.register(
            chunkBody,
            chunk,
            keep.map((m) => this.metal.held(b, m)),
        );
        this.power.register(
            chunkBody,
            chunk,
            keep.map((m) => this.power.held(b, m)),
        );
        const kept = new Int32Array(design.modules.length).fill(-1);
        for (let k = 0; k < keep.length; k++) kept[keep[k]!] = k;
        const madeBefore = this.robots.buildingOn(b);
        this.robots.register(
            chunkBody,
            chunk,
            this.robots.take(b, (m) => kept[m] ?? -1),
            (m) => madeBefore?.[keep[m]!] ?? [],
        );
        this.settleMass(bodies, chunkBody);
        this.shipByBody[chunkBody] = j;
        this.sides[chunkBody] = this.sidesOf((m) => this.sideAt(b, keep[m]!), keep.length, this.team[j]!);
        this.paint[chunkBody] = keep.map((m) => this.paintAt(b, m));
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
        this.settleShed(bodies);
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
        this.adopt(
            i,
            b,
            design,
            () => i,
            (m) => keep[m]!,
        );
    }

    /**
     * Make a ship's body carry a new design in place, keeping whatever belongs to
     * the ship rather than its shape: each module's scars, each weld's cuts, and
     * each surviving mount's state. `shipOf` and `moduleOf` say which ship and
     * which of its modules each module of the new design was; a core new to the
     * hull is painted by `builder`.
     */
    private adopt(
        i: number,
        b: number,
        design: ShipDesign,
        shipOf: (module: number) => number,
        moduleOf: (module: number) => number,
        release = true,
        keepRobots = false,
        builder = i,
    ): void {
        const bodies = this.bodyStore!;
        const bodyOf = (ship: number): number => bodies.indexOf(this.bodyIds[ship]!);
        // A module new to the hull (`moduleOf` -1) is its builder's, empty and unhurt.
        const sides = this.sidesOf(
            (m) => (moduleOf(m) < 0 ? this.team[i]! : this.sideAt(bodyOf(shipOf(m)), moduleOf(m))),
            design.modules.length,
            this.team[i]!,
        );
        const paint = design.modules.map((_, m) => {
            const was = moduleOf(m);
            return (was < 0 ? null : this.paintAt(bodyOf(shipOf(m)), was)) ?? this.painted(builder, design, m);
        });
        const scars: number[] = [];
        const fuel: number[] = [];
        const metal: number[] = [];
        const charge: number[] = [];
        const unbuilt: number[] = [];
        for (let m = 0; m < design.modules.length; m++) {
            const from = bodyOf(shipOf(m));
            const was = moduleOf(m);
            scars.push(was < 0 ? 0 : this.damage.absorbedAt(from, was));
            fuel.push(was < 0 ? 0 : this.fuel.held(from, was));
            metal.push(was < 0 ? 0 : this.metal.held(from, was));
            charge.push(was < 0 ? 0 : this.power.held(from, was));
            unbuilt.push(was < 0 ? 0 : this.damage.unbuiltAt(from, was));
        }
        // A weld half sawn through stays half sawn through; a seam is new.
        const weldScars: number[] = [];
        for (const joint of joints(design)) {
            const ship = shipOf(joint.a);
            if (shipOf(joint.b) !== ship || moduleOf(joint.a) < 0 || moduleOf(joint.b) < 0) {
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
            for (let k = 0; module >= 0 && k < was.turrets.length; k++) {
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
        this.paint[b] = paint;
        this.turretIndex[i] = fixed(indices);
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
        this.damage.register(b, design, scars, weldScars, unbuilt);
        const leaks = this.leaksInto(design.modules.length, (m) => ({ body: bodyOf(shipOf(m)), module: moduleOf(m) }));
        this.fuel.register(b, design, fuel, leaks);
        this.metal.register(b, design, metal);
        this.power.register(b, design, charge);
        // Grown in place, every robot is where it was and about what it was about.
        // The robots each bay was building, wherever the bay came from.
        const made = (m: number): readonly number[] => {
            const was = moduleOf(m);
            return was < 0 ? [] : (this.robots.buildingOn(bodyOf(shipOf(m)))?.[was] ?? []);
        };
        this.robots.register(
            b,
            design,
            keepRobots ? (this.robots.on(b) ?? []) : this.robotsInto(design.modules.length, bodyOf, shipOf, moduleOf),
            made,
        );
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
            const allowed = this.allowed(Resource.Fuel, b, module, Claim.Thrust, wanted);
            const got = this.fuel.drain(b, module, wanted < allowed ? wanted : allowed);
            this.took(Resource.Fuel, b, module, Claim.Thrust, got);
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

    /**
     * Every robot that comes over to a new design from the bodies its modules
     * were on, renumbered by where each module went.
     */
    private robotsInto(
        n: number,
        bodyOf: (ship: number) => number,
        shipOf: (module: number) => number,
        moduleOf: (module: number) => number,
    ): Robot[] {
        const out: Robot[] = [];
        const sources: number[] = [];
        for (let m = 0; m < n; m++) {
            const body = bodyOf(shipOf(m));
            if (!sources.includes(body)) sources.push(body);
        }
        for (const body of sources) {
            const into = new Map<number, number>();
            for (let m = 0; m < n; m++) if (bodyOf(shipOf(m)) === body) into.set(moduleOf(m), m);
            for (const robot of this.robots.take(body, (m) => into.get(m) ?? -1)) out.push(robot);
        }
        return out;
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

    /**
     * A body's mass and inertia: its design's, less the fuel and metal spent
     * from it and what damage has shed, and with every fighter parked on it.
     * Its centre of mass stays put.
     */
    private settleMass(bodies: Bodies, b: number): void {
        const design = this.hullDesign[b];
        // Something nothing moves stays that way.
        if (design === null || design === undefined || !(bodies.mass[b]! > 0)) return;
        const id = this.hullBody[b]!;
        let parkedMass = 0;
        let parkedInertia = 0;
        for (let k = 0; k < this.parkedShips.length; k++) {
            const f = this.parkedShips[k]!;
            const fb = bodies.indexOf(this.bodyIds[f]!);
            if (fb < 0 || bodies.indexOf(this.bodyIds[this.parkedOn[f]!]!) !== b) continue;
            const dx = bodies.x[fb]! - bodies.x[b]!;
            const dy = bodies.y[fb]! - bodies.y[b]!;
            this.parkedMass[f] = bodies.mass[fb]!;
            parkedMass += bodies.mass[fb]!;
            parkedInertia += bodies.inertia[fb]! + bodies.mass[fb]! * (dx * dx + dy * dy);
        }
        bodies.setMass(
            id,
            parkedMass +
                design.mass -
                this.fuel.spentMass(b) -
                this.metal.spentMass(b) -
                this.damage.shedMass(b) -
                this.robots.missingMass(b) -
                this.damage.unbuiltMass(b) +
                this.robots.cargoMass(b),
        );
        bodies.setInertia(
            id,
            parkedInertia +
                design.inertia -
                this.fuel.spentInertia(b) -
                this.metal.spentInertia(b) -
                this.damage.shedInertia(b) -
                this.robots.missingInertia(b) -
                this.damage.unbuiltInertia(b),
        );
    }

    /**
     * Settle every hull damage has shed mass from since last asked, counting
     * what it shed as discarded: it left at the hull's own speed, so the books
     * still balance. Done before anything reads a hull's mass to remake it.
     */
    private settleShed(bodies: Bodies): void {
        this.bodyStore = bodies;
        this.damage.takeUnsettled(this);
    }

    /** Damage's call back, for `settleShed`. */
    settleShedOf(b: number): void {
        const bodies = this.bodyStore!;
        const mass = bodies.mass[b]!;
        const inertia = bodies.inertia[b]!;
        this.settleMass(bodies, b);
        this.discardFrom(bodies, b, mass, inertia);
    }

    /**
     * Count as discarded what body `b` lost since it weighed `mass` and turned
     * with `inertia`: it left at the body's own speed, so the books still
     * balance. Nothing, for a body nothing moves.
     */
    private discardFrom(bodies: Bodies, b: number, mass: number, inertia: number): void {
        const kg = mass - bodies.mass[b]!;
        this.discarded += kg;
        this.discardedPx += kg * bodies.vx[b]!;
        this.discardedPy += kg * bodies.vy[b]!;
        // Its share of the hull's turning, and of the hull's motion about the origin.
        this.discardedL +=
            (inertia - bodies.inertia[b]!) * bodies.angularVel[b]! + kg * (bodies.x[b]! * bodies.vy[b]! - bodies.y[b]! * bodies.vx[b]!);
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
    private weldScarsOf(bodyIndex: number, was: ShipDesign, piece: ShipDesign, keep: readonly number[]): number[] {
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
    private offsetOf(bodies: Bodies, b: number, was: ShipDesign, piece: ShipDesign): { x: number; y: number } {
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
    /**
     * Break off for fuel, metal or charge, or go back to the fight.
     *
     * A ship with a working claw goes looking once its claw's piece of hull is
     * down to its doctrine's `scavengeFuelBelow` of a full load, and keeps at it,
     * source after source, until it is full; then the fight has it back. Where
     * to drink is reconsidered as often as a fight would be, and sooner when the
     * source is gone or dry. Without one, a fighter goes to a friend's pad, and
     * anything else with a port to a friend's port, once its fuel or charge is
     * down to `refuelBelow`; a fighter also goes once its metal is down to
     * `rearmBelow`, or it is no more whole than `repairBelow`, and whichever
     * sent it, it comes back for all of them.
     */
    private forage(world: World, bodies: Bodies, i: number): void {
        const b = bodies.indexOf(this.bodyIds[i]!);
        const held = this.salvaging[i]!;
        const hb = held !== NO_TARGET && this.alive[held] === 1 ? bodies.indexOf(this.bodyIds[held]!) : -1;
        // On an errand, it takes on or gives all it can whatever its doctrine's thresholds.
        const errand = this.errandOf(i);
        const ordered = errand === "dock";
        const scavengeOrder = errand === "scavenge";
        const deliverOrder = errand === "deliver";
        const only = errand !== undefined ? this.getCurrentOrder(i)!.target : NO_TARGET;
        // Drinking: its claw or its pad lets go when it is done. First, since it
        // now rides the other's body under a design that is both of theirs, or
        // is parked on its pad.
        const docked = b >= 0 && (hb === b || (held !== NO_TARGET && this.parkedOn[i] === held));
        if (docked && (this.orders[i]!.length === 0 || errand !== undefined)) {
            if (errand !== undefined) this.errandDocked[i] = 1;
            return;
        }
        if (errand !== undefined && this.errandDocked[i] === 1) {
            // Let go: it has had all that dock or source would give, or given all it
            // could. Sent nowhere in particular, it scavenges or delivers on.
            if (ordered || only !== NO_TARGET) {
                this.finishErrand(i);
                return;
            }
            this.errandDocked[i] = 0;
            this.stopForaging(i);
        }
        const design = this.designs[i]!;
        const approach = this.doctrines[i]!.approach;
        // An order given outranks it, as it outranks the rest of doctrine.
        const free = b >= 0 && (this.orders[i]!.length === 0 || errand !== undefined);
        // Doctrine's own errands, when it is on none of an order's.
        const own = free && errand === undefined;
        if (errand !== undefined && errand !== "deliver" && this.delivering[i] === 1) this.stopForaging(i);
        // Taking fuel to a friend, it keeps at it while it has fuel to give.
        const giverPort =
            (own && !design.fighter && approach.deliverFuelAbove > 0) || (free && deliverOrder) ? this.workingPort(bodies, i, b) : -1;
        if (deliverOrder) {
            if (giverPort >= 0 && this.hasToSpare(b, giverPort)) this.deliver(world, bodies, i, b, giverPort, only);
            if (this.salvaging[i] === NO_TARGET) this.finishErrand(i);
            return;
        }
        const deliverable = giverPort >= 0 && this.canDeliver(b, giverPort, approach.deliverFuelAbove);
        if (this.delivering[i] === 1) {
            if (deliverable) {
                this.deliver(world, bodies, i, b, giverPort);
                return;
            }
            this.stopForaging(i);
        }
        // A ship that builds only anchored goes to anchor when it would build.
        const anchors = own && this.wantsAnchor(bodies, i);
        const forages = scavengeOrder || anchors || (own && (approach.scavengeFuelBelow > 0 || approach.scavengeMetalBelow > 0));
        const docks = ordered || (own && approach.refuelBelow > 0);
        const recharges = ordered || (own && approach.rechargeBelow > 0);
        const claw = forages && b >= 0 ? this.workingClaw(i, b) : -1;
        if (scavengeOrder && claw < 0) {
            this.finishErrand(i);
            return;
        }
        // A fighter with no claw lands on a friend's pad instead, and anything
        // else with a port of its own docks with a friend's. Only a pad mends.
        const rearms = claw < 0 && design.fighter && (ordered || (own && approach.rearmBelow >= 0));
        const repairs = claw < 0 && design.fighter && (ordered || (own && approach.repairBelow > 0));
        const lands = (docks || rearms || recharges || repairs) && claw < 0 && design.fighter;
        const port = docks && !design.fighter ? this.workingPort(bodies, i, b) : -1;
        // A ship with a claw too docks only once it is down to `refuelBelow`, and
        // until it is full; otherwise it goes scavenging by `scavengeFuelBelow`.
        let viaPort = port >= 0 && claw < 0;
        if (port >= 0 && claw >= 0) {
            const portHeld = this.fuel.pieceHeld(b, port);
            const portRoom = this.fuel.pieceRoom(b, port);
            viaPort = portRoom > 0 && (this.docking[i] === 1 || portHeld <= approach.refuelBelow * (portHeld + portRoom));
        }
        const scavenges = claw >= 0 && !viaPort;
        // Metal from a wreck comes by its robots taking it apart.
        const strips = scavenges && (scavengeOrder || approach.scavengeMetalBelow > 0) && this.hasRobots(b, i);
        const into = scavenges ? claw : lands ? (design.cores[0] ?? 0) : viaPort ? port : -1;
        if (into < 0) {
            if (ordered) this.finishErrand(i);
            else this.stopForaging(i);
            return;
        }
        const below = scavenges ? approach.scavengeFuelBelow : approach.refuelBelow;
        const ownHeld = this.fuel.pieceHeld(b, into);
        const wantsFuel = scavenges ? scavengeOrder || approach.scavengeFuelBelow > 0 : docks;
        const room = wantsFuel ? this.fuel.pieceRoom(b, into) : 0;
        const full = ownHeld + room;
        const metalRoom = rearms || strips || (ordered && viaPort) ? this.metal.pieceRoom(b, into) : 0;
        const chargeRoom = (lands || (ordered && viaPort)) && recharges ? this.power.pieceRoom(b, into) : 0;
        const charge = chargeRoom > 0 ? this.power.pieceHeld(b, into) : 0;
        const thirsty = full > 0 && room > 0 && ownHeld <= below * full;
        const empty = rearms && metalRoom > 0 && this.outOfRounds(i, b, into, approach.rearmBelow);
        const metalHeld = strips ? this.metal.pieceHeld(b, into) : 0;
        const hungry = strips && metalRoom > 0 && metalHeld <= approach.scavengeMetalBelow * (metalHeld + metalRoom);
        // Only running flat sends it for charge, so it never lands for a sliver of it.
        const flat = chargeRoom > 0 && charge <= approach.rechargeBelow * (charge + chargeRoom);
        const recharging = chargeRoom > 0 && (ordered || flat || this.recharging[i] === 1);
        // Mending only makes it more whole, so nothing need hold it to the trip.
        const hurt = repairs && (ordered ? this.wholeness(b, i) < 1 : this.wholeness(b, i) <= approach.repairBelow);
        const going = ordered
            ? room > 0 || metalRoom > 0 || recharging || hurt
            : scavengeOrder
              ? room > 0 || metalRoom > 0
              : thirsty ||
                empty ||
                hungry ||
                (anchors && scavenges) ||
                recharging ||
                hurt ||
                (this.refuelling[i] === 1 && room > 0) ||
                (this.rearming[i] === 1 && metalRoom > 0);
        this.refuelling[i] = going && room > 0 ? 1 : 0;
        this.docking[i] = going && viaPort && (room > 0 || ordered) ? 1 : 0;
        this.rearming[i] = going && metalRoom > 0 ? 1 : 0;
        this.recharging[i] = recharging ? 1 : 0;
        if (!going && errand !== undefined) {
            // Nothing it could take on: done, or done before it set out.
            this.finishErrand(i);
            return;
        }
        if (!going) {
            // Full, or wanting nothing: what it can spare goes to a friend.
            if (deliverable) this.deliver(world, bodies, i, b, giverPort);
            else this.stopForaging(i);
            return;
        }
        if (held !== NO_TARGET) {
            // Gone, dry, taken, or no longer what it is after: look again now rather
            // than at the next rethink.
            const lost = lands
                ? hb < 0 || this.landingPad[i]! < 0 || !this.padFree(bodies, held, this.landingPad[i]!)
                : viaPort
                  ? hb < 0 || this.dockPort[i]! < 0 || this.ownPort[i] !== port || !this.portFree(bodies, held, this.dockPort[i]!)
                  : hb < 0 ||
                    this.landingPad[i]! >= 0 ||
                    this.dockPort[i]! >= 0 ||
                    this.shipByBody[hb] !== held ||
                    !(
                        (room > 0 && this.fuelOffered(i, held, hb)) ||
                        (metalRoom > 0 && this.strippableWreck(held)) ||
                        (anchors && this.isAsteroid(held))
                    );
            if (lost && scavengeOrder && only !== NO_TARGET) {
                // Gone, or with nothing more to give: what it was sent to is done with.
                this.finishErrand(i);
                return;
            }
            if (lost) {
                this.salvaging[i] = NO_TARGET;
                this.landingPad[i] = -1;
                this.dockPort[i] = -1;
                this.ownPort[i] = -1;
                this.forageAt[i] = world.tick;
            }
        }
        if (world.tick < this.forageAt[i]!) return;
        this.forageAt[i] = world.tick + this.rethinkTicks(world, design.mass);
        if (lands) {
            this.pickPad(bodies, i, b, room, metalRoom, recharging ? chargeRoom : 0, hurt, only);
        } else if (viaPort) {
            this.pickPort(bodies, i, b, port, room, ordered ? metalRoom : 0, ordered ? chargeRoom : 0, only);
        } else if (only !== NO_TARGET) {
            if (!this.clawCanTake(bodies, i, b, claw, only)) {
                this.finishErrand(i);
                return;
            }
            this.salvaging[i] = only;
            this.landingPad[i] = -1;
            this.dockPort[i] = -1;
        } else {
            this.salvaging[i] = this.pickSource(bodies, i, b, claw, room, strips ? metalRoom : 0, anchors);
            this.landingPad[i] = -1;
            this.dockPort[i] = -1;
            if (scavengeOrder && this.salvaging[i] === NO_TARGET) {
                // Nothing left anywhere worth the trip.
                this.finishErrand(i);
                return;
            }
            // Nothing left to scavenge: what it has goes to a friend instead.
            if (this.salvaging[i] === NO_TARGET && deliverable) this.deliver(world, bodies, i, b, giverPort);
        }
    }

    /**
     * Whether the ship working port `port` of body `b` holds enough to deliver:
     * more than `above` of a full load on that port's piece of hull, and more
     * than it keeps back for itself.
     */
    /** Whether the ship working port `port` of body `b` holds fuel or metal above what it keeps back for itself. */
    private hasToSpare(b: number, port: number): boolean {
        return this.fuel.pieceHeld(b, port) > this.reserve(b, port) || this.metal.pieceHeld(b, port) > this.metalReserve(b, port);
    }

    /**
     * Whether ship `i`'s claw on body `b` could ever take anything from ship
     * `t`: what doctrine would drink from, or a friend still flying, which it
     * may when it is sent to.
     */
    private clawCanTake(bodies: Bodies, i: number, b: number, claw: number, t: number): boolean {
        if (t === i || this.alive[t] !== 1 || (this.team[t] === NEUTRAL_TEAM && !this.isAsteroid(t))) return false;
        const tb = bodies.indexOf(this.bodyIds[t]!);
        if (tb < 0 || tb === b || !this.clawReaches(b, claw, tb)) return false;
        return this.drinkable(i, t) || this.team[t] === this.team[i];
    }

    /** Whether ship `t` on body `tb` has fuel for ship `i`'s claw: any at all, or from a friend still flying, any above its reserve. */
    private fuelOffered(i: number, t: number, tb: number): boolean {
        if (this.drinkable(i, t)) return this.fuel.left(tb) > 0;
        const modules = this.designs[t]!.modules;
        for (let m = 0; m < modules.length; m++) {
            if (this.ownsAt(t, tb, m) && this.fuel.pieceHeld(tb, m) > this.reserve(tb, m)) return true;
        }
        return false;
    }

    /** Whether ship `i` was sent to scavenge from `t`, a friend still flying, which doctrine never drinks from. */
    private sentToDrink(i: number, t: number): boolean {
        const given = this.getCurrentOrder(i);
        return given?.errand === "scavenge" && given.target === t;
    }

    private canDeliver(b: number, port: number, above: number): boolean {
        const held = this.fuel.pieceHeld(b, port);
        const full = held + this.fuel.pieceRoom(b, port);
        return full > 0 && held > above * full && held > this.reserve(b, port);
    }

    /**
     * What the ship working module `m` of body `b` keeps back from a friend
     * docked with it, kg: its `refuelBelow` of a full load, or, taking fuel to
     * a friend, its `deliverFuelAbove`, so it gives only what it holds above
     * that and is never left at its own threshold for refuelling.
     */
    private keepsBack(b: number, m: number): number {
        const owner = this.pilotAt(b, m);
        const kept = this.reserve(b, m);
        if (owner < 0 || this.delivering[owner] !== 1 || this.errandOf(owner) === "deliver") return kept;
        const above = this.doctrines[owner]!.approach.deliverFuelAbove;
        return max(kept, above * (this.fuel.pieceHeld(b, m) + this.fuel.pieceRoom(b, m)));
    }

    /**
     * Take fuel to a friend: keep to the friend's port it is making for until it
     * is gone, taken or full, or it is time to look again, then pick afresh.
     */
    private deliver(world: World, bodies: Bodies, i: number, b: number, port: number, only = NO_TARGET): void {
        this.refuelling[i] = 0;
        this.docking[i] = 0;
        this.rearming[i] = 0;
        this.recharging[i] = 0;
        this.landingPad[i] = -1;
        const held = this.salvaging[i]!;
        const hb = held !== NO_TARGET && this.alive[held] === 1 ? bodies.indexOf(this.bodyIds[held]!) : -1;
        const keep =
            this.delivering[i] === 1 &&
            hb >= 0 &&
            this.dockPort[i]! >= 0 &&
            this.ownPort[i] === port &&
            this.portFree(bodies, held, this.dockPort[i]!) &&
            (this.fuel.pieceRoom(hb, this.dockPort[i]!) > 0 ||
                (this.errandOf(i) === "deliver" && this.metal.pieceRoom(hb, this.dockPort[i]!) > 0));
        if (keep && world.tick < this.forageAt[i]!) return;
        this.forageAt[i] = world.tick + this.rethinkTicks(world, this.designs[i]!.mass);
        this.pickDelivery(bodies, i, b, port, only);
        this.delivering[i] = this.salvaging[i] !== NO_TARGET ? 1 : 0;
    }

    /**
     * The best friend's port to take fuel to, as a port to be filled at is
     * chosen: the fuel it can give and the friend has room for, for the time to
     * get there and pump it through the slower of the two ports, put off by armed
     * enemies near it and by every other ship already making for it.
     */
    private pickDelivery(bodies: Bodies, i: number, b: number, own: number, only = NO_TARGET): void {
        const design = this.designs[i]!;
        const approach = this.doctrines[i]!.approach;
        this.salvaging[i] = NO_TARGET;
        this.dockPort[i] = -1;
        this.ownPort[i] = -1;
        if (!(approach.approachSpeed > 0)) return;
        // Ordered, it gives all it can spare, metal too, whatever `deliverFuelAbove` says.
        const ordered = this.errandOf(i) === "deliver";
        const held = this.fuel.pieceHeld(b, own);
        const above = ordered ? 0 : approach.deliverFuelAbove * (held + this.fuel.pieceRoom(b, own));
        const spare = held - max(this.reserve(b, own), above);
        const spareMetal = ordered ? this.metal.pieceHeld(b, own) - this.metalReserve(b, own) : 0;
        if (!(spare > 0) && !(spareMetal > 0)) return;
        const ownPump = design.modules[own]!.stats.pumpRate;
        let bestScore = 0;
        for (let t = 0; t < this.alive.length; t++) {
            if (t === i || this.alive[t] === 0 || this.derelict[t] === 1 || this.delivering[t] === 1) continue;
            if (only !== NO_TARGET && t !== only) continue;
            if (this.team[t] !== this.team[i] || this.hostile(i, t) || !this.hasControl(t)) continue;
            const tb = bodies.indexOf(this.bodyIds[t]!);
            if (tb < 0 || tb === b) continue;
            const host = this.designs[t]!;
            // Sent to it, it goes whatever is near.
            let danger = only !== NO_TARGET ? 0 : -1;
            for (let p = 0; p < host.modules.length; p++) {
                if (host.modules[p]!.spec.kind !== "port" || !this.ownsAt(t, tb, p) || !this.portFree(bodies, t, p)) continue;
                const room = this.fuel.pieceRoom(tb, p);
                const metalRoom = spareMetal > 0 ? this.metal.pieceRoom(tb, p) : 0;
                const pump = min(ownPump, host.modules[p]!.stats.pumpRate);
                if (!((room > 0 && spare > 0) || metalRoom > 0) || !(pump > 0)) continue;
                const take = max(0, spare < room ? spare : room) + (spareMetal < metalRoom ? spareMetal : metalRoom);
                const gap = length(bodies.x[tb]! - bodies.x[b]!, bodies.y[tb]! - bodies.y[b]!);
                if (danger < 0) danger = approach.dockDanger > 0 ? this.dangerNear(bodies, i, tb) : 0;
                let queue = 0;
                for (let o = 0; o < this.alive.length; o++) {
                    if (o !== i && this.alive[o] === 1 && this.salvaging[o] === t && this.dockPort[o] === p) queue++;
                }
                const score =
                    take / (gap / approach.approachSpeed + take / pump) / (1 + max(0, approach.dockDanger) * danger) / (1 + queue);
                if (score > bestScore) {
                    bestScore = score;
                    this.salvaging[i] = t;
                    this.dockPort[i] = p;
                    this.ownPort[i] = own;
                }
            }
        }
    }

    /** Done with the errand at the head of its queue: on to the next order, or back to doctrine. */
    private finishErrand(i: number): void {
        this.stopForaging(i);
        this.orders[i]!.shift();
        this.nextOrder(i);
    }

    private stopForaging(i: number): void {
        this.salvaging[i] = NO_TARGET;
        this.landingPad[i] = -1;
        this.dockPort[i] = -1;
        this.ownPort[i] = -1;
        this.refuelling[i] = 0;
        this.docking[i] = 0;
        this.delivering[i] = 0;
        this.rearming[i] = 0;
        this.recharging[i] = 0;
    }

    /**
     * Whether ship `i` is down to its doctrine's `below` of a full load of metal
     * on the piece of hull module `own` is on: at zero, too little for any of its
     * guns there to load a round. False for a ship with no gun there to feed.
     */
    private outOfRounds(i: number, b: number, own: number, below: number): boolean {
        const design = this.designs[i]!;
        let round = Infinity;
        for (const mount of design.turrets) {
            const kg = mount.gun.roundMass;
            if (kg > 0 && kg < round && this.metal.pieceAt(b, mount.module) === this.metal.pieceAt(b, own)) round = kg;
        }
        if (round === Infinity) return false;
        const held = this.metal.pieceHeld(b, own);
        return held < round || held <= below * (held + this.metal.pieceRoom(b, own));
    }

    /** How many armed enemies of ship `i` are within their own reach of body `tb`. */
    private dangerNear(bodies: Bodies, i: number, tb: number): number {
        let danger = 0;
        for (let e = 0; e < this.alive.length; e++) {
            if (this.alive[e] === 0 || this.derelict[e] === 1 || !this.hostile(i, e) || this.isDisarmed(e)) continue;
            const eb = bodies.indexOf(this.bodyIds[e]!);
            if (eb < 0 || eb === tb) continue;
            const reach = this.designs[e]!.reach + bodies.radius[tb]!;
            if (length(bodies.x[eb]! - bodies.x[tb]!, bodies.y[eb]! - bodies.y[tb]!) <= reach) danger++;
        }
        return danger;
    }

    /**
     * How whole ship `i` on body `b` is, as `repairBelow` measures it: the lower
     * of its weakest core's integrity and the share of the mass it set out with
     * still sound, a module lost counting for none.
     */
    private wholeness(b: number, i: number): number {
        const design = this.designs[i]!;
        let weakest = 1;
        let sound = 0;
        for (let m = 0; m < design.modules.length; m++) {
            if (!this.ownsAt(i, b, m)) continue;
            const integrity = this.damage.integrity(b, m);
            sound += integrity * design.modules[m]!.stats.mass;
            if (design.modules[m]!.spec.kind === "core" && integrity < weakest) weakest = integrity;
        }
        let full = 0;
        for (const module of (this.launched[i] ?? design).modules) full += module.stats.mass;
        return full > 0 ? min(weakest, sound / full) : weakest;
    }

    /** Whether module `pad` of ship `t` is a pad still working, with nothing on it. */
    private padFree(bodies: Bodies, t: number, pad: number): boolean {
        const design = this.designs[t]!;
        if (design.modules[pad]?.spec.kind !== "pad") return false;
        const tb = bodies.indexOf(this.bodyIds[t]!);
        if (tb < 0 || !(this.left(t, tb, pad, DamageEffect.Grip) > 0)) return false;
        // Only a pad of its launch design is one a fighter can be parked on.
        const l = this.rebuildFor(t, design).at.indexOf(pad);
        if (l < 0) return false;
        for (let k = 0; k < this.parkedShips.length; k++) {
            const f = this.parkedShips[k]!;
            if (this.parkedOn[f] === t && this.parkedPad[f] === l) return false;
        }
        return true;
    }

    /**
     * The best friend's pad to land on of those it fits, by the fuel, metal and
     * charge its ship can spare for the time it would take to get there and be
     * filled, put off by armed enemies near it by its `dockDanger`, and by every
     * other fighter already making for it.
     */
    private pickPad(
        bodies: Bodies,
        i: number,
        b: number,
        room: number,
        metalRoom: number,
        chargeRoom: number,
        hurt: boolean,
        only = NO_TARGET,
    ): void {
        const approach = this.doctrines[i]!.approach;
        this.salvaging[i] = NO_TARGET;
        this.landingPad[i] = -1;
        this.dockPort[i] = -1;
        if (!(approach.approachSpeed > 0)) return;
        const box = footprintOf(this.designs[i]!);
        let bestScore = 0;
        for (let t = 0; t < this.alive.length; t++) {
            if (t === i || this.alive[t] === 0 || this.derelict[t] === 1 || (only !== NO_TARGET && t !== only)) continue;
            if (this.team[t] !== this.team[i] || this.hostile(i, t)) continue;
            const tb = bodies.indexOf(this.bodyIds[t]!);
            if (tb < 0 || tb === b) continue;
            const design = this.designs[t]!;
            // Sent to it, it goes whatever is near.
            let danger = only !== NO_TARGET ? 0 : -1;
            for (let pad = 0; pad < design.modules.length; pad++) {
                const spec = design.modules[pad]!.spec;
                if (spec.kind !== "pad" || !this.padFree(bodies, t, pad) || !this.fitsPad(box, spec)) continue;
                const spare = this.fuel.pieceHeld(tb, pad) - this.reserve(tb, pad);
                const spareMetal = this.metal.pieceHeld(tb, pad) - this.metalReserve(tb, pad);
                const pump = design.modules[pad]!.stats.pumpRate;
                const fuelTake = max(0, min(spare, room));
                const metalTake = max(0, min(spareMetal, metalRoom));
                const take = fuelTake + metalTake;
                const spareCharge = this.power.pieceHeld(tb, pad) - this.chargeReserve(tb, pad);
                const chargeTake = max(0, min(spareCharge, chargeRoom));
                const cable = DOCK_POWER_PER_METRE * spec.width;
                // Mending is paid for in charge and metal, reserves and all.
                const mends = hurt && this.power.pieceHeld(tb, pad) > 0 && this.metal.pieceHeld(tb, pad) > 0;
                if (!(take > 0 || chargeTake > 0 || mends) || !(pump > 0)) continue;
                // To the pad, not the carrier's middle: one waiting at a pad would otherwise
                // take the far one as soon as it is free, and cross whoever is coming the other way.
                const place = this.modulePlace(bodies, tb, design, pad);
                const gap = length(place.x - bodies.x[b]!, place.y - bodies.y[b]!);
                if (danger < 0) danger = approach.dockDanger > 0 ? this.dangerNear(bodies, i, tb) : 0;
                // A pad another fighter is already making for is a wait behind it.
                let queue = 0;
                for (let o = 0; o < this.alive.length; o++) {
                    if (o !== i && this.alive[o] === 1 && this.salvaging[o] === t && this.landingPad[o] === pad) queue++;
                }
                // Fuel and metal come aboard together, each at the pad's rate. For
                // charge alone, the pad that has it soonest.
                const time = gap / approach.approachSpeed + max(fuelTake / pump, metalTake / pump, chargeTake / cable);
                const score = (take > 0 ? take : 1) / time / (1 + max(0, approach.dockDanger) * danger) / (1 + queue);
                if (score > bestScore) {
                    bestScore = score;
                    this.salvaging[i] = t;
                    this.landingPad[i] = pad;
                }
            }
        }
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
    private meets(b: number, j: number): boolean {
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
    private carrierBodyOf(bodies: Bodies, f: number): number {
        const c = this.parkedOn[f]!;
        return c < 0 || this.alive[c] === 0 ? -1 : bodies.indexOf(this.bodyIds[c]!);
    }

    /** The pad ship `f` is parked on, by module of its carrier's hull: -1 for one not parked, or whose pad has gone. */
    private parkedPadOf(bodies: Bodies, f: number): number {
        const cb = this.carrierBodyOf(bodies, f);
        if (cb < 0) return -1;
        const c = this.parkedOn[f]!;
        const pad = this.rebuildFor(c, this.designs[c]!).at[this.parkedPad[f]!]!;
        return pad >= 0 && this.ownsAt(c, cb, pad) ? pad : -1;
    }

    /**
     * Park fighter `f` on pad `pad` of ship `c` where it lies: from now on it
     * is pinned there and weighs on the carrier, the two moving off together
     * with the momentum they had between them. False, changing nothing, for a
     * pad that is no pad of the carrier's launch design.
     */
    private park(bodies: Bodies, c: number, f: number, pad: number): boolean {
        const design = this.designs[c]!;
        const l = this.rebuildFor(c, design).at.indexOf(pad);
        const cb = bodies.indexOf(this.bodyIds[c]!);
        const fb = bodies.indexOf(this.bodyIds[f]!);
        if (l < 0 || cb < 0 || fb < 0) return false;
        const module = design.modules[pad]!;
        const angle = bodies.angle[cb]!;
        const c0 = cos(angle);
        const s0 = sin(angle);
        const facing = angle + (module.spec.angle ?? 0);
        const pc = cos(facing);
        const ps = sin(facing);
        // Its blueprint's origin rather than its middle, which moves as it is built.
        const own = this.designs[f]!;
        const fc = cos(bodies.angle[fb]!);
        const fs = sin(bodies.angle[fb]!);
        const ox = bodies.x[fb]! - (own.centreOfMassX * fc - own.centreOfMassY * fs);
        const oy = bodies.y[fb]! - (own.centreOfMassX * fs + own.centreOfMassY * fc);
        const dx = ox - (bodies.x[cb]! + module.x * c0 - module.y * s0);
        const dy = oy - (bodies.y[cb]! + module.x * s0 + module.y * c0);
        this.parkedX[f] = dx * pc + dy * ps;
        this.parkedY[f] = -dx * ps + dy * pc;
        this.parkedAngle[f] = bodies.angle[fb]! - facing;

        // About the carrier's middle, which stays put: what each brought. A
        // carrier on a pinned body takes none of it, as nothing moves it.
        const mc = bodies.mass[cb]!;
        const mf = bodies.mass[fb]!;
        const vx = (mc * bodies.vx[cb]! + mf * bodies.vx[fb]!) / (mc + mf);
        const vy = (mc * bodies.vy[cb]! + mf * bodies.vy[fb]!) / (mc + mf);
        const rx = bodies.x[fb]! - bodies.x[cb]!;
        const ry = bodies.y[fb]! - bodies.y[cb]!;
        const spin =
            bodies.inertia[cb]! * bodies.angularVel[cb]! +
            bodies.inertia[fb]! * bodies.angularVel[fb]! +
            mf * (rx * (bodies.vy[fb]! - vy) - ry * (bodies.vx[fb]! - vx));
        const moves = mc > 0;
        if (moves) {
            bodies.vx[cb] = vx;
            bodies.vy[cb] = vy;
        }

        this.parkedOn[f] = c;
        this.parkedPad[f] = l;
        this.parkedShips.push(f);
        this.settleMass(bodies, cb);
        if (moves) bodies.angularVel[cb] = spin / bodies.inertia[cb]!;
        this.pin(bodies, f);
        return true;
    }

    /**
     * Let fighter `f` off its pad, moving as the pad was: the carrier no longer
     * carries its weight, nor the momentum it had going round with it.
     */
    private unpark(bodies: Bodies, f: number, tick: number): void {
        const k = this.parkedShips.indexOf(f);
        if (k < 0) return;
        const cb = this.carrierBodyOf(bodies, f);
        const fb = bodies.indexOf(this.bodyIds[f]!);
        this.parkedShips.splice(k, 1);
        this.parkedOn[f] = -1;
        this.parkedPad[f] = -1;
        this.mooredClaw[f] = -1;
        this.partedAt[f] = tick;
        if (cb < 0) return;
        this.settleMass(bodies, cb);
        if (fb < 0) return;
        // Counted at the carrier's middle while parked, it was going round it as well.
        const share = bodies.mass[fb]! / movable(bodies.mass[cb]!);
        bodies.vx[cb] = bodies.vx[cb]! - share * (bodies.vx[fb]! - bodies.vx[cb]!);
        bodies.vy[cb] = bodies.vy[cb]! - share * (bodies.vy[fb]! - bodies.vy[cb]!);
    }

    /** Put parked fighter `f` where it sits on its pad, moving with it. Nothing, while its pad is gone. */
    private pin(bodies: Bodies, f: number): void {
        if (this.mooredClaw[f]! >= 0) {
            this.pinMoored(bodies, f);
            return;
        }
        const fb = bodies.indexOf(this.bodyIds[f]!);
        const pad = this.parkedPadOf(bodies, f);
        if (fb < 0 || pad < 0) return;
        const cb = this.carrierBodyOf(bodies, f);
        const module = this.designs[this.parkedOn[f]!]!.modules[pad]!;
        const angle = bodies.angle[cb]!;
        const c = cos(angle);
        const s = sin(angle);
        const facing = angle + (module.spec.angle ?? 0);
        const pc = cos(facing);
        const ps = sin(facing);
        const own = this.designs[f]!;
        const heading = facing + this.parkedAngle[f]!;
        const fc = cos(heading);
        const fs = sin(heading);
        const lx = this.parkedX[f]!;
        const ly = this.parkedY[f]!;
        const rx = module.x * c - module.y * s + lx * pc - ly * ps + own.centreOfMassX * fc - own.centreOfMassY * fs;
        const ry = module.x * s + module.y * c + lx * ps + ly * pc + own.centreOfMassX * fs + own.centreOfMassY * fc;
        const spin = bodies.angularVel[cb]!;
        bodies.x[fb] = bodies.x[cb]! + rx;
        bodies.y[fb] = bodies.y[cb]! + ry;
        bodies.angle[fb] = heading;
        bodies.vx[fb] = bodies.vx[cb]! - spin * ry;
        bodies.vy[fb] = bodies.vy[cb]! + spin * rx;
        bodies.angularVel[fb] = spin;
        // Its weight changes as it is filled, mended and shot at.
        if (bodies.mass[fb] !== this.parkedMass[f]) this.settleMass(bodies, cb);
    }

    /**
     * Moor ship `f` by claw `claw` of its hull to asteroid `rock`, gripping at
     * world point `gx`, `gy`: parked as a fighter is on a pad, but on the rock,
     * keeping its own body and design. The two move off together with the
     * momentum they had between them; a rock nothing moves takes none of it.
     */
    private moor(bodies: Bodies, f: number, rock: number, claw: number, gx: number, gy: number): void {
        const cb = bodies.indexOf(this.bodyIds[rock]!);
        const fb = bodies.indexOf(this.bodyIds[f]!);
        if (cb < 0 || fb < 0 || !this.poseMoored(bodies, f, cb, fb, gx, gy)) return;
        const mc = bodies.mass[cb]!;
        const mf = bodies.mass[fb]!;
        const vx = (mc * bodies.vx[cb]! + mf * bodies.vx[fb]!) / (mc + mf);
        const vy = (mc * bodies.vy[cb]! + mf * bodies.vy[fb]!) / (mc + mf);
        const rx = bodies.x[fb]! - bodies.x[cb]!;
        const ry = bodies.y[fb]! - bodies.y[cb]!;
        const spin =
            bodies.inertia[cb]! * bodies.angularVel[cb]! +
            bodies.inertia[fb]! * bodies.angularVel[fb]! +
            mf * (rx * (bodies.vy[fb]! - vy) - ry * (bodies.vx[fb]! - vx));
        const moves = mc > 0;
        if (moves) {
            bodies.vx[cb] = vx;
            bodies.vy[cb] = vy;
        }
        this.parkedOn[f] = rock;
        this.parkedPad[f] = -1;
        this.mooredClaw[f] = claw;
        this.parkedShips.push(f);
        this.settleMass(bodies, cb);
        if (moves) bodies.angularVel[cb] = spin / bodies.inertia[cb]!;
        this.pinMoored(bodies, f);
    }

    /**
     * Where moored ship `f`, on body `fb`, sits on its rock, body `cb`, and
     * where its claw grips, world point `gx`, `gy`, kept in the rock's
     * blueprint frame. False for a body with no hull.
     */
    private poseMoored(bodies: Bodies, f: number, cb: number, fb: number, gx: number, gy: number): boolean {
        const rd = this.hullDesign[cb];
        const fd = this.hullDesign[fb];
        if (rd === null || rd === undefined || fd === null || fd === undefined) return false;
        const angle = bodies.angle[cb]!;
        const c = cos(angle);
        const s = sin(angle);
        // Both blueprint origins, which stay put on their hulls as rock is mined away.
        const rox = bodies.x[cb]! - (rd.centreOfMassX * c - rd.centreOfMassY * s);
        const roy = bodies.y[cb]! - (rd.centreOfMassX * s + rd.centreOfMassY * c);
        const fc = cos(bodies.angle[fb]!);
        const fs = sin(bodies.angle[fb]!);
        const dx = bodies.x[fb]! - (fd.centreOfMassX * fc - fd.centreOfMassY * fs) - rox;
        const dy = bodies.y[fb]! - (fd.centreOfMassX * fs + fd.centreOfMassY * fc) - roy;
        this.parkedX[f] = dx * c + dy * s;
        this.parkedY[f] = -dx * s + dy * c;
        this.parkedAngle[f] = bodies.angle[fb]! - angle;
        this.mooredGripX[f] = (gx - rox) * c + (gy - roy) * s;
        this.mooredGripY[f] = -(gx - rox) * s + (gy - roy) * c;
        return true;
    }

    /** Where each ship moored to asteroid `i` or `j` grips, in the world, before the two become one. */
    private holdMoorings(bodies: Bodies, i: number, j: number): void {
        this.rebasing.length = 0;
        this.rebasingStranded.length = 0;
        for (let k = 0; k < this.stranded.length; k++) {
            const robot = this.stranded[k]!.robot;
            if (robot.away !== i && robot.away !== j) continue;
            const cb = bodies.indexOf(this.bodyIds[robot.away]!);
            const here = robot.awayDesign?.modules[robot.at];
            if (cb < 0 || here === undefined) continue;
            const c = cos(bodies.angle[cb]!);
            const s = sin(bodies.angle[cb]!);
            this.rebasingStranded.push(k, bodies.x[cb]! + here.x * c - here.y * s, bodies.y[cb]! + here.x * s + here.y * c);
        }
        for (let k = 0; k < this.parkedShips.length; k++) {
            const f = this.parkedShips[k]!;
            if (this.mooredClaw[f]! < 0 || (this.parkedOn[f] !== i && this.parkedOn[f] !== j)) continue;
            const cb = this.carrierBodyOf(bodies, f);
            const rd = cb < 0 ? null : this.hullDesign[cb];
            if (rd === null || rd === undefined) continue;
            const c = cos(bodies.angle[cb]!);
            const s = sin(bodies.angle[cb]!);
            const lx = this.mooredGripX[f]! - rd.centreOfMassX;
            const ly = this.mooredGripY[f]! - rd.centreOfMassY;
            this.rebasing.push(f, bodies.x[cb]! + lx * c - ly * s, bodies.y[cb]! + lx * s + ly * c);
        }
    }

    /**
     * Pose again, on the rock two have just made, each ship `holdMoorings`
     * noted, and step its robots out on the rock back to where its claw grips.
     */
    private rebaseMoorings(bodies: Bodies): void {
        for (let k = 0; k < this.rebasing.length; k += 3) {
            const f = this.rebasing[k]!;
            const fb = bodies.indexOf(this.bodyIds[f]!);
            const cb = this.carrierBodyOf(bodies, f);
            if (fb < 0 || cb < 0) continue;
            this.poseMoored(bodies, f, cb, fb, this.rebasing[k + 1]!, this.rebasing[k + 2]!);
            const held = this.heldRock(bodies, f);
            for (const robot of this.robots.on(fb) ?? []) {
                if (robot.away < 0) continue;
                robot.away = this.parkedOn[f]!;
                robot.awayDesign = this.hullDesign[cb]!;
                robot.at = held < 0 ? 0 : held;
                robot.path = null;
                robot.leg = 0;
                robot.along = 0;
                if (robot.mode !== RobotMode.Home) {
                    robot.mode = RobotMode.Out;
                    robot.target = -1;
                }
            }
        }
        this.rebasing.length = 0;
        // A stranded robot stands where it stood, on the nearest of the rock they make.
        for (let k = 0; k < this.rebasingStranded.length; k += 3) {
            const robot = this.stranded[this.rebasingStranded[k]!]!.robot;
            const cb = bodies.indexOf(this.bodyIds[robot.away]!);
            const rd = cb < 0 ? null : this.hullDesign[cb];
            if (rd === null || rd === undefined) continue;
            const dx = this.rebasingStranded[k + 1]! - bodies.x[cb]!;
            const dy = this.rebasingStranded[k + 2]! - bodies.y[cb]!;
            const c = cos(bodies.angle[cb]!);
            const s = sin(bodies.angle[cb]!);
            robot.at = this.nearestModule(rd, dx * c + dy * s, -dx * s + dy * c);
            robot.awayDesign = rd;
        }
        this.rebasingStranded.length = 0;
    }

    /** Put moored ship `f` where it sits on its rock, moving with it. */
    private pinMoored(bodies: Bodies, f: number): void {
        const fb = bodies.indexOf(this.bodyIds[f]!);
        const cb = this.carrierBodyOf(bodies, f);
        const rd = cb < 0 ? null : this.hullDesign[cb];
        const fd = fb < 0 ? null : this.hullDesign[fb];
        if (rd === null || rd === undefined || fd === null || fd === undefined) return;
        const angle = bodies.angle[cb]!;
        const c = cos(angle);
        const s = sin(angle);
        const heading = angle + this.parkedAngle[f]!;
        const fc = cos(heading);
        const fs = sin(heading);
        const lx = this.parkedX[f]! - rd.centreOfMassX;
        const ly = this.parkedY[f]! - rd.centreOfMassY;
        const rx = lx * c - ly * s + fd.centreOfMassX * fc - fd.centreOfMassY * fs;
        const ry = lx * s + ly * c + fd.centreOfMassX * fs + fd.centreOfMassY * fc;
        const spin = bodies.angularVel[cb]!;
        bodies.x[fb] = bodies.x[cb]! + rx;
        bodies.y[fb] = bodies.y[cb]! + ry;
        bodies.angle[fb] = heading;
        bodies.vx[fb] = bodies.vx[cb]! - spin * ry;
        bodies.vy[fb] = bodies.vy[cb]! + spin * rx;
        bodies.angularVel[fb] = spin;
        if (bodies.mass[fb] !== this.parkedMass[f]) this.settleMass(bodies, cb);
    }

    /** Whether ship `i` is moored to an asteroid by its claw. */
    isMoored(i: number): boolean {
        return this.mooredClaw[i]! >= 0;
    }

    /**
     * The module of its rock that moored ship `f`'s claw grips: the nearest to
     * where it took hold, within reach of it, or -1 once that is mined away.
     */
    private heldRock(bodies: Bodies, f: number): number {
        const cb = this.carrierBodyOf(bodies, f);
        const rd = cb < 0 ? null : this.hullDesign[cb];
        if (rd === null || rd === undefined) return -1;
        const gx = this.mooredGripX[f]! - rd.centreOfMassX;
        const gy = this.mooredGripY[f]! - rd.centreOfMassY;
        let best = -1;
        let bestGap = Infinity;
        for (let m = 0; m < rd.modules.length; m++) {
            const module = rd.modules[m]!;
            const reach = max(module.spec.length, module.spec.width);
            const gap = length(module.x - gx, module.y - gy);
            if (gap <= reach && gap < bestGap) {
                best = m;
                bestGap = gap;
            }
        }
        return best;
    }

    /**
     * Work the rock moored ship `f` holds, and say whether it keeps hold: its
     * robots taking it apart while its holds have room, or its claw melting
     * the ice out. It lets go once neither can, or it is given an order, when
     * its robots are back; and at once if its claw can no longer grip, what it
     * held is gone, or an armed enemy is in reach.
     */
    private tendMoored(world: World, f: number): boolean {
        const bodies = world.bodies;
        const fb = bodies.indexOf(this.bodyIds[f]!);
        const cb = this.carrierBodyOf(bodies, f);
        const claw = this.mooredClaw[f]!;
        if (fb < 0 || cb < 0 || this.alive[f] === 0 || this.derelict[f] === 1 || !this.hasControl(f)) return false;
        const working = this.damage.remaining(fb, claw, DamageEffect.Grip);
        if (!(working > 0)) return false;
        const held = this.heldRock(bodies, f);
        if (held < 0) return false;
        if (this.damage.isProtected(cb)) return true;
        if (!this.sentTo(f) && this.threatened(bodies, f, cb, false)) return false;
        // Given an order, it calls its robots in and goes as soon as they are back.
        const ordered = this.commanded(f);
        if (!ordered && this.canStrip(fb, f, claw, world.dt) && this.strippableAcross(f, fb, claw, cb)) return true;
        if (!ordered && this.heatAcross(bodies, fb, claw, cb, held, working * world.dt)) return true;
        // Anchored while it builds, it holds on until what it builds is let go.
        if (!ordered && this.wantsAnchor(bodies, f)) return true;
        // Done, but for its robots out on the rock, which it waits for.
        if (!this.anyAway(fb, f)) return false;
        this.recallAway(fb, this.hullDesign[fb]!, f, cb);
        return true;
    }

    /**
     * Whether moored ship `f`'s robots could take anything of its rock, body
     * `cb`, apart for what the holds on its claw's piece of hull, at `into` of
     * body `fb`, have room for.
     */
    private strippableAcross(f: number, fb: number, into: number, cb: number): boolean {
        const metalRoom = this.metal.pieceRoom(fb, into) > ROBOT_SPENT;
        const fuelRoom = this.fuel.pieceRoom(fb, into) > ROBOT_SPENT;
        if (!metalRoom && !fuelRoom) return false;
        const rd = this.hullDesign[cb];
        if (rd === null || rd === undefined) return false;
        const held = this.heldRock(this.bodyStore!, f);
        for (let m = 0; m < rd.modules.length; m++) {
            if (m !== held && this.ofRock(cb, m) && this.minable(rd, m, metalRoom, fuelRoom) && this.comesOff(f, cb, rd, m)) return true;
        }
        return false;
    }

    /**
     * The claw at `claw` of body `fb` melting fuel out of the rock at `held` of
     * the rock it is moored to, body `cb`, as `heat` does one it has welded to.
     */
    private heatAcross(bodies: Bodies, fb: number, claw: number, cb: number, held: number, dt: number): boolean {
        const rd = this.hullDesign[cb]!;
        const spec = rd.modules[held]!.spec;
        if (spec.kind !== "rock") return false;
        const ice = (spec.ice ?? 0) * (1 - DISASSEMBLY_WASTE);
        if (!(ice > 0) || !(dt > 0)) return false;
        const left = rd.modules[held]!.stats.mass - this.damage.unbuiltAt(cb, held);
        let fuel = min(CLAW_HEAT_RATE * dt, this.fuel.pieceRoom(fb, claw), left * ice);
        fuel = min(fuel, this.power.pieceHeld(fb, claw) / CLAW_HEAT_ENERGY);
        if (!(fuel > ROBOT_SPENT)) return false;
        this.power.drain(fb, claw, fuel * CLAW_HEAT_ENERGY);
        this.damage.unfit(cb, held, fuel / ice);
        this.fuel.add(fb, claw, fuel);
        this.settleMass(bodies, cb);
        this.settleMass(bodies, fb);
        return true;
    }

    /**
     * Whether the blow `k` of this step's knocks a moored ship off its rock:
     * one landing on it harder than its claw holds, the shock spent with
     * distance as it is through a weld, the rest of it then the ship's own.
     */
    private shakeLoose(world: World, k: number): boolean {
        const bodies = world.bodies;
        const fb = this.blowBody[k]!;
        const f = this.shipByBody[fb];
        if (f === undefined || f < 0 || this.mooredClaw[f]! < 0) return false;
        const cb = this.carrierBodyOf(bodies, f);
        const held = this.heldRock(bodies, f);
        const fd = this.hullDesign[fb];
        const rd = cb < 0 ? null : this.hullDesign[cb];
        if (held < 0 || fd === null || fd === undefined || rd === null || rd === undefined) return false;
        const claw = this.mooredClaw[f]!;
        const thickness = min(seamThickness(fd, claw), seamThickness(rd, held));
        const grip = this.damage.remaining(fb, claw, DamageEffect.Grip);
        const strength = fd.modules[claw]!.spec.width * thickness * JOINT_IMPULSE_PER_AREA * DOCK_HOLD * grip;
        const jx = this.blowJx[k]!;
        const jy = this.blowJy[k]!;
        const place = this.modulePlace(bodies, fb, fd, claw);
        const carried = SHOCK_REACH / (SHOCK_REACH + length(this.blowX[k]! - place.x, this.blowY[k]! - place.y));
        const load = length(jx, jy) * carried;
        if (!(load > strength)) return false;
        this.unpark(bodies, f, world.tick);
        // What the rock took of the blow beyond the grip, the ship takes now it is free.
        const share = 1 - strength / load;
        bodies.vx[fb] = bodies.vx[fb]! + jx * share * bodies.invMass[fb]!;
        bodies.vy[fb] = bodies.vy[fb]! + jy * share * bodies.invMass[fb]!;
        bodies.vx[cb] = bodies.vx[cb]! - jx * share * bodies.invMass[cb]!;
        bodies.vy[cb] = bodies.vy[cb]! - jy * share * bodies.invMass[cb]!;
        return true;
    }

    /**
     * Where module `m` of body `tb` is and how it is moving, world frame, and
     * which way it faces.
     */
    private modulePlace(
        bodies: Bodies,
        tb: number,
        design: ShipDesign,
        m: number,
    ): { x: number; y: number; vx: number; vy: number; angle: number } {
        const module = design.modules[m]!;
        const angle = bodies.angle[tb]!;
        const c = cos(angle);
        const s = sin(angle);
        const rx = module.x * c - module.y * s;
        const ry = module.x * s + module.y * c;
        const spin = bodies.angularVel[tb]!;
        return {
            x: bodies.x[tb]! + rx,
            y: bodies.y[tb]! + ry,
            vx: bodies.vx[tb]! - spin * ry,
            vy: bodies.vy[tb]! + spin * rx,
            angle: angle + (module.spec.angle ?? 0),
        };
    }

    /**
     * Fly onto a pad: down a stopping curve onto its middle, matching how it is
     * moving. Like a ram it points its mains along the change of velocity it
     * still needs, and plans to brake on them with a half turn allowed for,
     * since a fighter mostly pushes one way. Once near and nearly matched it
     * lines up with the pad, unless it would fit inside it at any heading.
     * Returns the heading to hold.
     */
    private landOn(dt: number, bodies: Bodies, i: number, b: number, tb: number, pad: number): number {
        const host = this.designOf(tb);
        if (host === null || host.modules[pad] === undefined) return bodies.angle[b]!;
        const design = this.designs[i]!;
        const approach = this.doctrines[i]!.approach;
        const place = this.modulePlace(bodies, tb, host, pad);
        // Matching how the pad is speeding up as well as how it is moving, as if it keeps on.
        this.dockingAccel(i, place.vx, place.vy, dt);
        let ax = this.dockAx[i]!;
        let ay = this.dockAy[i]!;
        // An anchored pad does not fall with what lands on it, so it holds itself up against the rock's pull.
        const root = this.carrierOf(tb);
        const well = this.rides[root >= 0 ? root : tb];
        if (well !== undefined) {
            const pull = wellPull(well, bodies.x[b]!, bodies.y[b]!);
            ax -= (well.x - bodies.x[b]!) * pull;
            ay -= (well.y - bodies.y[b]!) * pull;
        }
        const mine = bodies.radius[b]!;
        const range = length(place.x - bodies.x[b]!, place.y - bodies.y[b]!);
        // Come in by one of the pad's ways in, from where it leaves the hull's
        // circle, circling round to there first if the hull is in the way.
        this.wayIn(bodies, i, b, tb, host, pad, place.x, place.y);
        const nx = cos(this.wayAngle);
        const ny = sin(this.wayAngle);
        const rx = bodies.x[b]! - place.x;
        const ry = bodies.y[b]! - place.y;
        const ahead = rx * nx + ry * ny;
        // Near only from the side its way in is: over the hull beyond the pad, its
        // engines would play on the deck to bring it back.
        const near = range <= PAD_ALIGN_RADII * mine && ahead > -host.modules[pad]!.spec.length / 2;
        let lined = ahead > 0 && abs(ry * nx - rx * ny) <= ahead;
        // Over the hull, only if nothing in its layer stands between it and the pad.
        if (lined && length(bodies.x[b]! - bodies.x[tb]!, bodies.y[b]! - bodies.y[tb]!) < bodies.radius[tb]! + 2 * mine) {
            lined = !this.crossesCarrier(bodies, b, tb, bodies.x[b]!, bodies.y[b]!, -rx, -ry);
        }
        let gx = place.x;
        let gy = place.y;
        let left = range;
        if (!near && !lined) {
            const entry = length(this.entryX - place.x, this.entryY - place.y);
            left = this.aroundHull(bodies, b, tb, this.entryX, this.entryY) + entry;
            gx = this.wayX;
            gy = this.wayY;
        }
        const dx = gx - bodies.x[b]!;
        const dy = gy - bodies.y[b]!;
        const gap = length(dx, dy);
        let vx = place.vx;
        let vy = place.vy;
        if (gap > 0) {
            const ux = dx / gap;
            const uy = dy / gap;
            let radial: number;
            if (near) {
                // The last few metres eased in at what it may land at, so it settles
                // rather than overshooting and turning back.
                radial = min(PAD_SPEED, range / approach.responseTime);
            } else {
                // Braking on what is left once it is keeping up.
                const mains =
                    this.layoutOf(i).maxThrustAlong(cos(design.thrustBearing), sin(design.thrustBearing)) / movable(bodies.mass[b]!);
                const spare = max(0, mains - length(ax, ay));
                const delay = approach.responseTime + this.halfTurnTime(bodies, i, b);
                radial = min(approach.approachSpeed, stoppingSpeed(approach.brake * spare, left, delay));
            }
            vx += ux * radial;
            vy += uy * radial;
        }
        this.urge(URGE_REFERENCE, vx, vy, ax, ay);

        const box = footprintOf(design);
        const spec = host.modules[pad]!.spec;
        const diagonal = length(box.maxX - box.minX, box.maxY - box.minY);
        if (near) {
            // Lined up with the pad either way round, whichever is nearer, unless it fits any way.
            if (diagonal <= min(spec.length, spec.width)) return bodies.angle[b]!;
            const along = angleDelta(bodies.angle[b]!, place.angle);
            return abs(along) <= PI / 2 ? place.angle : place.angle + PI;
        }
        const dvx = vx - bodies.vx[b]! + ax * approach.responseTime;
        const dvy = vy - bodies.vy[b]! + ay * approach.responseTime;
        return length(dvx, dvy) > PAD_SPEED / 2 ? atan2(dvy, dvx) - design.thrustBearing : bodies.angle[b]!;
    }

    /**
     * Steer body `b` for the point `ax`, `ay` off body `tb`'s hull, circling the
     * hull outside its radius when that point is round the far side rather than
     * flying through it. Leaves the next point to make for in `wayX`, `wayY`,
     * and returns how far that is.
     */
    private aroundHull(bodies: Bodies, b: number, tb: number, ax: number, ay: number): number {
        const cx = bodies.x[tb]!;
        const cy = bodies.y[tb]!;
        const from = atan2(bodies.y[b]! - cy, bodies.x[b]! - cx);
        const off = angleDelta(from, atan2(ay - cy, ax - cx));
        if (abs(off) > HULL_ORBIT_STEP) {
            const ring = max(length(ax - cx, ay - cy), bodies.radius[tb]! + 2 * bodies.radius[b]!);
            const step = from + (off > 0 ? HULL_ORBIT_STEP : -HULL_ORBIT_STEP);
            this.wayX = cx + cos(step) * ring;
            this.wayY = cy + sin(step) * ring;
        } else {
            this.wayX = ax;
            this.wayY = ay;
        }
        return length(this.wayX - bodies.x[b]!, this.wayY - bodies.y[b]!);
    }

    /**
     * The body of the nearest hull across body `b`'s line to body `tb` that a
     * claw ship should go round, or -1: a ship under control larger than it, not
     * after the same source, or an asteroid, and far enough short of it to circle clear.
     */
    private hullAcross(bodies: Bodies, i: number, b: number, tb: number, source: number): number {
        const x = bodies.x[b]!;
        const y = bodies.y[b]!;
        const dx = bodies.x[tb]! - x;
        const dy = bodies.y[tb]! - y;
        const range = length(dx, dy);
        if (!(range > 0)) return -1;
        const ux = dx / range;
        const uy = dy / range;
        const short = range - bodies.radius[tb]!;
        let nearest = -1;
        let nearestAt = short;
        for (let t = 0; t < this.alive.length; t++) {
            if (t === i || this.alive[t] === 0 || this.salvaging[t] === source) continue;
            if (!this.isAsteroid(t) && (this.derelict[t] === 1 || !this.hasControl(t))) continue;
            const ob = bodies.indexOf(this.bodyIds[t]!);
            if (
                ob < 0 ||
                ob === b ||
                ob === tb ||
                bodies.ghost[ob] === 1 ||
                !this.meets(b, ob) ||
                !(bodies.radius[ob]! > bodies.radius[b]!)
            )
                continue;
            const cx = bodies.x[ob]! - x;
            const cy = bodies.y[ob]! - y;
            const at = cx * ux + cy * uy;
            if (!(at > 0) || at + bodies.radius[ob]! + 2 * bodies.radius[b]! >= nearestAt) continue;
            if (abs(cx * uy - cy * ux) < bodies.radius[ob]! + bodies.radius[b]!) {
                nearest = ob;
                nearestAt = at;
            }
        }
        return nearest;
    }

    /**
     * Fly body `b` round body `ob`'s hull, outside its radius, to the side of it
     * facing body `tb`, matching how `ob` is moving. Returns the heading to the
     * next point to make for.
     */
    private roundHull(bodies: Bodies, i: number, b: number, ob: number, tb: number): number {
        const cx = bodies.x[ob]!;
        const cy = bodies.y[ob]!;
        const out = atan2(bodies.y[tb]! - cy, bodies.x[tb]! - cx);
        const clear = bodies.radius[ob]! + 2 * bodies.radius[b]!;
        const gap = this.aroundHull(bodies, b, ob, cx + cos(out) * clear, cy + sin(out) * clear);
        const dx = this.wayX - bodies.x[b]!;
        const dy = this.wayY - bodies.y[b]!;
        let vx = bodies.vx[ob]!;
        let vy = bodies.vy[ob]!;
        if (gap > 0) {
            const speed = this.doctrines[i]!.approach.clawSpeed;
            vx += (dx / gap) * speed;
            vy += (dy / gap) * speed;
        }
        this.urge(URGE_REFERENCE, vx, vy);
        return atan2(dy, dx);
    }

    /**
     * Which of pad `pad`'s ways in (`PadApproach`) fighter `i` on body `b` takes
     * to it, into `wayAngle`, and where that way leaves the circle round carrier
     * body `tb` it keeps outside, into `entryX`, `entryY`: the one reached
     * soonest going round the carrier, unless the one it is already taking is
     * nearly as soon, or it is already inside that circle on one. The ways were worked out once, for the carrier as it was
     * compiled, and turn with the pad into whatever hull it is now.
     */
    private wayIn(bodies: Bodies, i: number, b: number, tb: number, host: ShipDesign, pad: number, px: number, py: number): void {
        const origin = originOf(host, pad);
        const turn = bodies.angle[tb]! + approachTurn(host, pad);
        const same = this.landingWayPad[i] === pad && this.landingWayBody[i] === tb;
        const was = same ? this.landingWay[i]! : NaN;
        const compiled: readonly PadApproach[] = origin.design.approaches ?? [];
        let best = NaN;
        let soonest = Infinity;
        // Inside the circle, round the carrier means nothing: it keeps the way it is on.
        const ring = bodies.radius[tb]! + 2 * bodies.radius[b]!;
        const inside = length(bodies.x[b]! - bodies.x[tb]!, bodies.y[b]! - bodies.y[tb]!) < ring;
        if (inside && !Number.isNaN(was)) {
            soonest = -Infinity;
            best = was + bodies.angle[tb]!;
        }
        // A way something is in now, a fighter on the next pad say, is passed over while another is clear.
        let fallback = NaN;
        for (let k = 0; k < compiled.length; k++) {
            if (compiled[k]!.pad !== origin.module) continue;
            const cost = this.wayCost(bodies, b, tb, px, py, compiled[k]!.angle + turn, was);
            if (!(cost < soonest)) continue;
            if (this.wayBlocked(bodies, b, tb, px, py)) {
                if (Number.isNaN(fallback)) fallback = compiled[k]!.angle + turn;
                continue;
            }
            soonest = cost;
            best = compiled[k]!.angle + turn;
        }
        if (Number.isNaN(best)) best = fallback;
        // Compiled with none: worked out for the hull as it is.
        if (Number.isNaN(best)) {
            for (const way of padApproaches(host, pad)) {
                const cost = this.wayCost(bodies, b, tb, px, py, way.angle + bodies.angle[tb]!, was);
                if (cost < soonest) {
                    soonest = cost;
                    best = way.angle + bodies.angle[tb]!;
                }
            }
        }
        this.landingWay[i] = best - bodies.angle[tb]!;
        this.landingWayPad[i] = pad;
        this.landingWayBody[i] = tb;
        this.wayAngle = best;
        this.wayCost(bodies, b, tb, px, py, best, NaN);
    }

    /**
     * Whether anything in the weapons layer of carrier body `tb` stands between
     * where the way `wayCost` last worked out leaves its circle and the pad at
     * `px`, `py`, across body `b`'s width.
     */
    private wayBlocked(bodies: Bodies, b: number, tb: number, px: number, py: number): boolean {
        const dx = px - this.entryX;
        const dy = py - this.entryY;
        const span = length(dx, dy);
        if (!(span > 0)) return false;
        const side = bodies.radius[b]!;
        const ox = (-dy / span) * side;
        const oy = (dx / span) * side;
        let blocked = false;
        for (let k = -1; k <= 1 && !blocked; k++)
            blocked = this.crossesCarrier(bodies, b, tb, this.entryX + k * ox, this.entryY + k * oy, dx, dy);
        return blocked;
    }

    /**
     * Whether the line from `x0`, `y0` along `dx`, `dy` crosses anything in the
     * weapons layer of carrier body `tb`, or any fighter parked on it but body `b`.
     */
    private crossesCarrier(bodies: Bodies, b: number, tb: number, x0: number, y0: number, dx: number, dy: number): boolean {
        this.hulls.castFrom(WEAPONS_LAYER, -1, -1);
        let crosses = this.hulls.confirm(bodies, tb, x0, y0, dx, dy) >= 0;
        for (let k = 0; k < this.parkedShips.length && !crosses; k++) {
            const f = this.parkedShips[k]!;
            const fb = bodies.indexOf(this.bodyIds[f]!);
            if (fb >= 0 && fb !== b && this.carrierBodyOf(bodies, f) === tb) crosses = this.hulls.confirm(bodies, fb, x0, y0, dx, dy) >= 0;
        }
        this.hulls.reset();
        return crosses;
    }

    /**
     * How far round carrier body `tb` body `b` is from where the way in at
     * `angle` off the pad at `px`, `py` leaves the circle it keeps outside,
     * radians, less `WAY_STICK` for the way it was taking, `was` in the
     * carrier's frame. Leaves that point in `entryX`, `entryY`.
     */
    private wayCost(bodies: Bodies, b: number, tb: number, px: number, py: number, angle: number, was: number): number {
        const cx = bodies.x[tb]!;
        const cy = bodies.y[tb]!;
        const nx = cos(angle);
        const ny = sin(angle);
        const ring = bodies.radius[tb]! + 2 * bodies.radius[b]!;
        // How far out along it the circle is crossed.
        const along = (px - cx) * nx + (py - cy) * ny;
        const disc = along * along - ((px - cx) * (px - cx) + (py - cy) * (py - cy)) + ring * ring;
        const out = disc > 0 ? max(0, -along + sqrt(disc)) : 0;
        this.entryX = px + nx * out;
        this.entryY = py + ny * out;
        const round = abs(angleDelta(atan2(bodies.y[b]! - cy, bodies.x[b]! - cx), atan2(this.entryY - cy, this.entryX - cx)));
        const kept = !Number.isNaN(was) && abs(angleDelta(angle - bodies.angle[tb]!, was)) < 1e-6;
        return kept ? round - WAY_STICK : round;
    }

    /** The first of this ship's ports still working and not already mated, or -1. */
    private workingPort(bodies: Bodies, i: number, b: number): number {
        const design = this.designs[i]!;
        for (let m = 0; m < design.modules.length; m++) {
            if (design.modules[m]!.spec.kind === "port" && this.ownsAt(i, b, m) && this.portFree(bodies, i, m)) return m;
        }
        return -1;
    }

    /** Whether module `port` of ship `t` is a port still working, mated to nothing. */
    private portFree(bodies: Bodies, t: number, port: number): boolean {
        const design = this.designs[t]!;
        if (design.modules[port]?.spec.kind !== "port") return false;
        const tb = bodies.indexOf(this.bodyIds[t]!);
        if (tb < 0 || !(this.left(t, tb, port, DamageEffect.Grip) > 0)) return false;
        for (const seam of design.seams ?? []) {
            if (seam.dock === "port" && (seam.a === port || seam.b === port)) return false;
        }
        return true;
    }

    /**
     * The best friend's port to dock with, as a pad is chosen: the fuel its ship
     * can spare for the time to get there and be filled through the slower of
     * the two ports, put off by armed enemies near it and by every other ship
     * already making for it. A friend that is refuelling itself has none to spare.
     */
    private pickPort(
        bodies: Bodies,
        i: number,
        b: number,
        own: number,
        room: number,
        metalRoom = 0,
        chargeRoom = 0,
        only = NO_TARGET,
    ): void {
        const design = this.designs[i]!;
        const approach = this.doctrines[i]!.approach;
        this.salvaging[i] = NO_TARGET;
        this.landingPad[i] = -1;
        this.dockPort[i] = -1;
        this.ownPort[i] = -1;
        if (!(approach.approachSpeed > 0)) return;
        const ownPump = design.modules[own]!.stats.pumpRate;
        let bestScore = 0;
        for (let t = 0; t < this.alive.length; t++) {
            if (t === i || this.alive[t] === 0 || this.derelict[t] === 1 || this.docking[t] === 1) continue;
            if (only !== NO_TARGET && t !== only) continue;
            if (this.team[t] !== this.team[i] || this.hostile(i, t) || !this.hasControl(t)) continue;
            const tb = bodies.indexOf(this.bodyIds[t]!);
            if (tb < 0 || tb === b) continue;
            const host = this.designs[t]!;
            let danger = only !== NO_TARGET ? 0 : -1;
            for (let p = 0; p < host.modules.length; p++) {
                if (host.modules[p]!.spec.kind !== "port" || !this.ownsAt(t, tb, p) || !this.portFree(bodies, t, p)) continue;
                const spare = this.fuel.pieceHeld(tb, p) - this.reserve(tb, p);
                const pump = min(ownPump, host.modules[p]!.stats.pumpRate);
                const spareMetal = metalRoom > 0 ? this.metal.pieceHeld(tb, p) - this.metalReserve(tb, p) : 0;
                const spareCharge = chargeRoom > 0 ? this.power.pieceHeld(tb, p) - this.chargeReserve(tb, p) : 0;
                const others = max(0, min(spareMetal, metalRoom)) + (spareCharge > 0 ? 1 : 0);
                if (!(spare > 0 || others > 0) || !(pump > 0)) continue;
                const take = max(0, spare < room ? spare : room) + others;
                const gap = length(bodies.x[tb]! - bodies.x[b]!, bodies.y[tb]! - bodies.y[b]!);
                if (danger < 0) danger = approach.dockDanger > 0 ? this.dangerNear(bodies, i, tb) : 0;
                let queue = 0;
                for (let o = 0; o < this.alive.length; o++) {
                    if (o !== i && this.alive[o] === 1 && this.salvaging[o] === t && this.dockPort[o] === p) queue++;
                }
                const score =
                    take / (gap / approach.approachSpeed + take / pump) / (1 + max(0, approach.dockDanger) * danger) / (1 + queue);
                if (score > bestScore) {
                    bestScore = score;
                    this.salvaging[i] = t;
                    this.dockPort[i] = p;
                    this.ownPort[i] = own;
                }
            }
        }
    }

    /**
     * Bring this ship's port `own` onto port `theirs` of body `tb`, face to face.
     * It flies to a point a little off their port first, mains along the change
     * of velocity it needs as a ram does, and round their hull to the front of
     * the port if it starts anywhere else; once there, lined up and on the port's
     * axis, it closes the last stretch at `PORT_APPROACH`, slow enough to mate.
     * Returns the heading to hold.
     */
    private dockOn(dt: number, bodies: Bodies, i: number, b: number, tb: number, theirs: number, own: number): number {
        const host = this.designOf(tb);
        const design = this.designs[i]!;
        if (host === null || host.modules[theirs] === undefined || design.modules[own] === undefined) return bodies.angle[b]!;
        const approach = this.doctrines[i]!.approach;
        const place = this.modulePlace(bodies, tb, host, theirs);
        this.dockingAccel(i, place.vx, place.vy, dt);
        const ax = this.dockAx[i]!;
        const ay = this.dockAy[i]!;
        const nx = cos(place.angle);
        const ny = sin(place.angle);
        const face = host.modules[theirs]!.spec.length / 2;
        // Where its own port's face is from its centre of mass, in its own frame.
        const mine = design.modules[own]!;
        const turned = mine.spec.angle ?? 0;
        const ox = mine.x + cos(turned) * mine.spec.length * 0.5;
        const oy = mine.y + sin(turned) * mine.spec.length * 0.5;
        const heading = place.angle + PI - turned;
        const c = cos(heading);
        const s = sin(heading);
        // Its centre of mass with the two faces touching.
        const gx = place.x + nx * face - (ox * c - oy * s);
        const gy = place.y + ny * face - (ox * s + oy * c);
        const rx = bodies.x[b]! - gx;
        const ry = bodies.y[b]! - gy;
        const lateral = abs(-rx * ny + ry * nx);
        const width = min(mine.spec.width, host.modules[theirs]!.spec.width);
        const lined = abs(angleDelta(bodies.angle[b]!, heading)) <= PORT_HEADING_SLACK && lateral <= width * 0.25;
        const standoff = PORT_STANDOFF_RADII * bodies.radius[b]!;
        let tx = lined ? gx : gx + nx * standoff;
        let ty = lined ? gy : gy + ny * standoff;
        // Not out in front of their port: round their hull to a point a radius of
        // theirs off it first, rather than through the hull.
        const fx = bodies.x[b]! - (place.x + nx * face);
        const fy = bodies.y[b]! - (place.y + ny * face);
        const ahead = fx * nx + fy * ny;
        let left = -1;
        if (!lined && !(ahead > 0 && abs(fy * nx - fx * ny) <= ahead)) {
            const reach = bodies.radius[tb]!;
            left = this.aroundHull(bodies, b, tb, place.x + nx * (face + reach), place.y + ny * (face + reach)) + reach;
            tx = this.wayX;
            ty = this.wayY;
        }
        const dx = tx - bodies.x[b]!;
        const dy = ty - bodies.y[b]!;
        const range = length(dx, dy);
        if (left < 0) left = range;
        let vx = place.vx;
        let vy = place.vy;
        if (range > 0) {
            let radial: number;
            if (lined) {
                radial = PORT_APPROACH;
            } else {
                // Braking on what is left once it is keeping up.
                const mains =
                    this.layoutOf(i).maxThrustAlong(cos(design.thrustBearing), sin(design.thrustBearing)) / movable(bodies.mass[b]!);
                const spare = max(0, mains - length(ax, ay));
                const delay = approach.responseTime + this.halfTurnTime(bodies, i, b);
                radial = min(approach.approachSpeed, stoppingSpeed(approach.brake * spare, left, delay));
            }
            vx += (dx / range) * radial;
            vy += (dy / range) * radial;
        }
        this.urge(URGE_REFERENCE, vx, vy, ax, ay);
        const dvx = vx - bodies.vx[b]! + ax * approach.responseTime;
        const dvy = vy - bodies.vy[b]! + ay * approach.responseTime;
        const far = left > PAD_ALIGN_RADII * bodies.radius[b]!;
        if (far && length(dvx, dvy) > PORT_SPEED) return atan2(dvy, dvx) - design.thrustBearing;
        return heading;
    }

    /** The ship docked to this one by a port on the body they share, or -1. */
    private portPartner(i: number, b: number): number {
        const seams = this.designs[i]!.seams;
        if (seams === undefined) return -1;
        for (const seam of seams) {
            if (seam.dock !== "port") continue;
            const pa = this.pilotAt(b, seam.a);
            const pb = this.pilotAt(b, seam.b);
            if (pa === i && pb !== i) return pb;
            if (pb === i && pa !== i) return pa;
        }
        return -1;
    }

    /** The mass of the modules ship `i` works on body `b`, kg: what it brought to a dock. */
    private ownMass(i: number, b: number): number {
        const design = this.designs[i]!;
        let mass = 0;
        for (let m = 0; m < design.modules.length; m++) if (this.ownsAt(i, b, m)) mass += design.modules[m]!.stats.mass;
        return mass;
    }

    /**
     * Take aboard every fighter that has settled onto the pad it was making for:
     * its whole outline inside the pad's, and moving with it to within
     * `PAD_SPEED`. Say how many landed.
     *
     * A fighter flies above a deck, so it never touches a pad; landing is the
     * two meeting at the boundary between the layers, and no commitment.
     */
    land(world: World): number {
        this.tick = world.tick;
        const bodies = world.bodies;
        this.bodyStore = bodies;
        const settled = world.tick - WELD_SETTLE / world.dt;
        let landed = 0;
        for (let i = 0; i < this.alive.length; i++) {
            const pad = this.landingPad[i]!;
            if (this.alive[i] === 0 || pad < 0 || this.committed[i] === 1 || !this.designs[i]!.fighter) continue;
            const c = this.salvaging[i]!;
            if (c === NO_TARGET || this.alive[c] === 0 || this.partedAt[i]! > settled) continue;
            const b = bodies.indexOf(this.bodyIds[i]!);
            const cb = bodies.indexOf(this.bodyIds[c]!);
            if (b < 0 || cb < 0 || b === cb || !this.padFree(bodies, c, pad)) continue;
            if (this.damage.isProtected(b) || this.damage.isProtected(cb) || this.threatened(bodies, i, cb, true)) continue;
            const host = this.designs[c]!;
            const place = this.modulePlace(bodies, cb, host, pad);
            if (length(bodies.vx[b]! - place.vx, bodies.vy[b]! - place.vy) > PAD_SPEED) continue;
            if (!this.within(bodies, b, this.designs[i]!, place, host.modules[pad]!.spec)) continue;
            if (!this.park(bodies, c, i, pad)) continue;
            this.landedReach[i] = this.fightReach(i);
            this.home[i] = c;
            landed++;
        }
        return landed;
    }

    /**
     * Refit ship `i` to `to`, a design compiled from a blueprint: from now on it
     * builds to that rather than to what it set out as. A module of its hull
     * that is a module of `to` by key (`ShipDesign.keys`), laid out the same, is
     * kept as that module; the rest of its own hull comes down, and what `to`
     * has that it has not is built, as robots build back what a ship has lost,
     * building before taking down, and a wall waiting while anything of its own
     * hull is in the way. Its cores, robot bays and generators come down last
     * and go up first, and never the last of its cores or bays, so it is flown
     * and worked on throughout. Refused, saying why, when `to` keeps nothing of
     * the ship to build the rest against.
     */
    refit(world: World, i: number, to: ShipDesign): string | null {
        const bodies = world.bodies;
        this.bodyStore = bodies;
        if (this.alive[i] === 0) return "the ship is gone";
        const keys = to.keys;
        if (keys === undefined) return `${to.name} was not compiled from a blueprint`;
        const b = bodies.indexOf(this.bodyIds[i]!);
        const p = b < 0 ? -1 : this.shipAt(bodies, b);
        if (p < 0) return "the ship is gone";
        const design = this.designs[p]!;
        const as = keptAs(
            design.modules.map((_, m) => {
                if (!this.ownsAt(i, b, m)) return null;
                const from = originOf(design, m);
                const was = from.design.modules[from.module]!;
                return { key: from.design.keys?.[was.index], spec: was.spec };
            }),
            to.modules.map((module) => ({ key: keys[module.index], spec: module.spec })),
        );
        let kept = 0;
        const origins = as.map((k) => {
            if (k < 0) return null;
            kept++;
            return { design: to, module: k };
        });
        if (kept === 0) return `${to.name} keeps nothing of this ship to build the rest against`;
        this.adopt(
            p,
            b,
            remarkedDesign(design, origins),
            () => p,
            (m) => m,
            true,
            true,
        );
        for (const r of this.ridersOf(bodies, b)) if (r !== p) this.board(r, p);
        this.launched[i] = to;
        this.rebuilds[i] = null;
        // What its robots were building is numbered by the design it no longer has.
        for (const robot of this.robots.on(b) ?? []) if (this.pilotAt(b, robot.bay) === i) robot.build = -1;
        this.ownDoctrines[i] = to.doctrine;
        this.doctrines[i] = overriddenDoctrine(to.doctrine, this.overrides[i]);
        this.mountDoctrines[i] = null;
        this.couldFight[i] = to.turrets.some((t) => t.main) || to.engines.length > 0 ? 1 : 0;
        this.buildsFor(i, to);
        this.refitting[i] = 1;
        return null;
    }

    /**
     * What ship `i`'s pads and slipways build, as design `design` says: the one
     * it was launched as, not the slice of it a slipway or pad began with.
     */
    private buildsFor(i: number, design: ShipDesign): void {
        const builds = design.builds ?? [];
        this.broods[i] = builds.length === 0 ? null : { fighters: builds.map(() => []), work: new Float64Array(builds.length) };
        this.yards[i] = yardFor(design);
    }

    /** Whether ship `i` is refitted and its hull is not yet what it was refitted to: something to come down, or to go up. */
    isRefitting(i: number): boolean {
        if (this.refitting[i] !== 1 || this.alive[i] === 0) return false;
        const bodies = this.bodyStore!;
        const b = bodies.indexOf(this.bodyIds[i]!);
        if (b < 0) return false;
        const design = this.hullDesign[b]!;
        for (let m = 0; m < design.modules.length; m++) if (this.ownsAt(i, b, m) && this.wreckage(i, b, m)) return true;
        return !this.finished(b, i, design);
    }

    /**
     * Lay down a fighter on every free pad keeping fewer in the fight than its
     * `keep`: the walls of its core, a shell's first step, laid on the pad
     * where a fighter set out docked would lie, from the face nearest the
     * carrier's middle. Its pad builds the rest as it builds back what a
     * landed fighter has lost (`padBuild`), and holds it until it is whole.
     *
     * Only while the carrier is under control, and never while a fighter of
     * its side is making for the pad: one coming in for fuel matters more than
     * one not yet begun.
     */
    build(world: World): void {
        this.tick = world.tick;
        const bodies = world.bodies;
        this.bodyStore = bodies;
        for (let i = 0; i < this.alive.length; i++) {
            const brood = this.broods[i];
            const yard = this.yards[i];
            if ((brood === null || brood === undefined) && (yard === null || yard === undefined)) continue;
            if (!this.hasControl(i)) continue;
            const b = bodies.indexOf(this.bodyIds[i]!);
            // One still held by the slipway building it builds nothing until it is let go.
            if (b < 0 || this.damage.isProtected(b) || this.onSlipway(i, b)) continue;
            const design = this.designs[i]!;
            const rebuild = this.rebuildFor(i, design);
            for (let k = 0; yard !== null && yard !== undefined && k < yard.building.length; k++) this.print(world, i, b, rebuild.at, k);
            if (brood === null || brood === undefined) continue;
            const builds = this.launched[i]!.builds!;
            for (let k = 0; k < builds.length; k++) {
                const order = builds[k]!;
                const pad = rebuild.at[order.pad]!;
                if (pad < 0 || !this.ownsAt(i, b, pad)) continue;
                if (this.fielded(bodies, i, brood.fighters[k]!) >= this.keepFor(i, order.pad, order.keep)) continue;
                if (!this.padFree(bodies, i, pad) || this.awaited(i, pad)) continue;
                if (!this.mayBuild(i, b, this.launched[i]!.modules[order.pad]!.spec)) continue;
                this.layDown(world, i, b, design, pad, k, this.craftFor(i, order.pad, order.design));
            }
        }
    }

    /**
     * Put a step of slipway `k`'s work into the next slice of the ship it
     * builds, at `SLIPWAY_BUILD_PER_METRE` and the price robots build at, and
     * build the slice once the work is in and the metal is on the slipway's
     * piece of hull: the ship's first slice, short of the ships it keeps,
     * spawned and held against the slipway's face, and every later one pushing
     * it out by `SLIPWAY_STEP` (`reprint`). Its walls all up, the slipway fits
     * it out, fills it and lets it go (`pump`).
     */
    private print(world: World, i: number, b: number, at: ArrayLike<number>, k: number): void {
        const bodies = world.bodies;
        const yard = this.yards[i]!;
        const order = this.launched[i]!.yards![k]!;
        const slipway = at[order.slipway]!;
        if (slipway < 0 || !this.ownsAt(i, b, slipway)) return;
        if (!this.mayBuild(i, b, this.launched[i]!.modules[order.slipway]!.spec)) return;
        let f = yard.building[k]!;
        // Gone, or let go: the slipway is free for the next, and one let go is pushed off.
        if (f >= 0 && (this.alive[f] === 0 || bodies.indexOf(this.bodyIds[f]!) !== b)) {
            if (this.alive[f] === 1) this.pushOff(bodies, i, b, f, slipway);
            yard.building[k] = -1;
            this.printing[f] = 0;
            f = -1;
        }
        if (f < 0 && this.fielded(bodies, i, yard.ships[k]!) >= this.keepFor(i, order.slipway, order.keep)) return;
        // One already on the slipway is finished as it was begun.
        if (f < 0) {
            const chosen = this.craftFor(i, order.slipway, order.design);
            yard.craft[k] = chosen === this.launched[i] ? twinOf(chosen) : chosen;
        }
        const craft = yard.craft[k] ?? order.design;
        const berth = this.launched[i]!.modules[order.slipway]!.spec;
        const length = printLength(craft, berth);
        const depth = f < 0 ? 0 : yard.depth[k]!;
        if (f >= 0 && this.printing[f] !== 1) return;
        const deeper = min(length, depth + SLIPWAY_STEP);
        const next = printedCraft(craft, berth, deeper);
        if (next === null) return;
        const before = f < 0 ? null : printedCraft(craft, berth, depth);

        // What the slice weighs, and the work it takes, module by module.
        let kg = 0;
        let joules = 0;
        const had = new Map<number, number>();
        before?.modules.forEach((m, d) => had.set(m, before.design.modules[d]!.stats.structureMass));
        next.modules.forEach((m, d) => {
            const more = next.design.modules[d]!.stats.structureMass - (had.get(m) ?? 0);
            kg += more;
            joules += more * buildWork(craft.modules[m]!.stats);
        });
        const working = this.left(i, b, slipway, DamageEffect.Grip);
        const width = this.designs[i]!.modules[slipway]!.spec.width;
        // What is at the face is finished before the next slice pushes it out of reach.
        if (f >= 0) {
            const busy = this.tendAtFace(bodies, b, f, slipway, SLIPWAY_BUILD_PER_METRE * width * working * world.dt);
            if (busy) this.builtAt[i] = world.tick;
            if (busy || this.atFace(b, f, slipway)) return;
        }
        const charge = this.allowed(Resource.Charge, b, slipway, Claim.Slipway, (joules - yard.work[k]!) * REPAIR_ENERGY_PER_JOULE);
        const put = min(
            min(SLIPWAY_BUILD_PER_METRE * width * working * world.dt, joules - yard.work[k]!),
            charge / REPAIR_ENERGY_PER_JOULE,
        );
        if (put > 0) {
            yard.work[k] = yard.work[k]! + put;
            this.took(Resource.Charge, b, slipway, Claim.Slipway, this.power.drain(b, slipway, put * REPAIR_ENERGY_PER_JOULE));
            this.builtAt[i] = world.tick;
        }
        const cost = kg * (1 + REPAIR_WASTE);
        // What the slice will cost is set aside for it while its work goes in.
        const metal = this.allowed(Resource.Metal, b, slipway, Claim.Slipway, cost);
        if (yard.work[k]! < joules) return;
        if (metal < cost) return;
        if (f < 0) {
            f = this.layKeel(world, i, b, slipway, craft, next, deeper);
            if (f < 0) return;
            yard.building[k] = f;
            yard.ships[k]!.push(f);
        } else if (!this.reprint(world, b, f, slipway, craft, next, deeper)) return;
        yard.work[k] = 0;
        yard.depth[k] = deeper;
        if (deeper >= length) this.printing[f] = 0;
        const mass = bodies.mass[b]!;
        const inertia = bodies.inertia[b]!;
        this.took(Resource.Metal, b, slipway, Claim.Slipway, this.metal.drain(b, slipway, cost));
        this.settleMass(bodies, b);
        // What it wasted left at the hull's speed.
        this.discardFrom(bodies, b, mass, inertia);
    }

    /**
     * The module of ship `f`, being built on slipway `slipway` of body `b`, that
     * the slipway can reach and is not yet whole, fittings and all; -1 for none.
     * It reaches only what lies within a step of its face: what the slice just
     * built finished, and what the next pushes out. Cores first.
     */
    private atFaceIndex(b: number, f: number, slipway: number): number {
        const design = this.hullDesign[b]!;
        const spec = design.modules[slipway]!.spec;
        const angle = spec.angle ?? 0;
        const c = cos(angle);
        const s = sin(angle);
        const face = spec.length / 2 + SLIPWAY_STEP + 1e-6;
        const corners = this.faceCorners;
        let best = -1;
        let bestTier = Infinity;
        const approach = this.doctrines[f]!.approach;
        for (let m = 0; m < design.modules.length; m++) {
            if (this.pilotAt(b, m) !== f) continue;
            if (!(this.damage.unbuiltAt(b, m) > 0) && !(this.damage.absorbedAt(b, m) > 0)) continue;
            const count = moduleOutline(design.modules[m]!.spec, corners);
            let near = Infinity;
            for (let v = 0; v < count; v++) near = min(near, (corners[v * 2]! - spec.x) * c + (corners[v * 2 + 1]! - spec.y) * s);
            if (near > face) continue;
            const tier = repairTier(approach, design, m);
            if (tier < bestTier) {
                best = m;
                bestTier = tier;
            }
        }
        return best;
    }

    /** Whether the slipway has anything of ship `f` at its face still to fit or mend. */
    private atFace(b: number, f: number, slipway: number): boolean {
        return this.atFaceIndex(b, f, slipway) >= 0;
    }

    /**
     * Put up to `joules` of slipway `slipway`'s work into what of ship `f` is at
     * its face and not yet whole: its fittings, then its damage, from the metal
     * and charge on the slipway's piece of hull at robots' prices. Says whether
     * it did any.
     */
    private tendAtFace(bodies: Bodies, b: number, f: number, slipway: number, joules: number): boolean {
        const m = this.atFaceIndex(b, f, slipway);
        if (m < 0 || !(joules > 0)) return false;
        const stats = this.hullDesign[b]!.modules[m]!.stats;
        const mass = bodies.mass[b]!;
        const inertia = bodies.inertia[b]!;
        const waste = 1 + REPAIR_WASTE;
        if (this.damage.unbuiltAt(b, m) > 0) {
            const work = buildWork(stats);
            const perKg = work * REPAIR_ENERGY_PER_JOULE;
            const most = min(joules / work, this.damage.unbuiltAt(b, m));
            const charge = this.allowed(Resource.Charge, b, slipway, Claim.Slipway, most * perKg);
            const metal = this.allowed(Resource.Metal, b, slipway, Claim.Slipway, most * waste);
            const kg = min(min(joules / work, charge / perKg), metal / waste);
            const put = this.damage.fit(b, m, kg);
            if (!(put > 0)) return false;
            this.took(Resource.Metal, b, slipway, Claim.Slipway, this.metal.drain(b, slipway, put * waste));
            this.took(Resource.Charge, b, slipway, Claim.Slipway, this.power.drain(b, slipway, put * perKg));
        } else {
            this.settleShed(bodies);
            const work = repairWork(stats);
            const most = joules / work;
            const charge = this.allowed(Resource.Charge, b, slipway, Claim.Slipway, most * work * REPAIR_ENERGY_PER_JOULE);
            let undo = min(most, charge / (work * REPAIR_ENERGY_PER_JOULE));
            const kg = this.damage.repairMetal(b, m, undo) * waste;
            const metal = this.allowed(Resource.Metal, b, slipway, Claim.Slipway, this.damage.repairMetal(b, m, most) * waste);
            if (kg > metal) undo *= metal / kg;
            const cost = this.damage.repairMetal(b, m, undo) * waste;
            const undone = this.damage.repair(b, m, undo);
            if (!(undone > 0)) return false;
            this.fuel.seal(b, m);
            if (cost > 0) this.took(Resource.Metal, b, slipway, Claim.Slipway, this.metal.drain(b, slipway, cost));
            this.took(Resource.Charge, b, slipway, Claim.Slipway, this.power.drain(b, slipway, undone * work * REPAIR_ENERGY_PER_JOULE));
        }
        this.settleMass(bodies, b);
        this.discardFrom(bodies, b, mass, inertia);
        return true;
    }

    /**
     * Push ship `f`, just let go by slipway `slipway` of builder `i`'s body `b`,
     * off along the slipway's facing at `SLIPWAY_PUSH` relative to its builder,
     * each moving as its share of the mass says, as a stage separates. Its
     * engines stay off, from when it is let go, until they would not burn the
     * ship that built it (`flyOne`).
     */
    private pushOff(bodies: Bodies, i: number, b: number, f: number, slipway: number): void {
        const fb = bodies.indexOf(this.bodyIds[f]!);
        if (fb < 0) return;
        const angle = bodies.angle[b]! + (this.designs[i]!.modules[slipway]!.spec.angle ?? 0);
        const dx = cos(angle);
        const dy = sin(angle);
        // A builder anchored to a rock is pinned, and weighs nothing to this: it does not move.
        const mb = movable(bodies.mass[b]!);
        const mf = movable(bodies.mass[fb]!);
        const impulse = mb === Infinity ? SLIPWAY_PUSH * mf : (SLIPWAY_PUSH * mb * mf) / (mb + mf);
        bodies.vx[fb] = bodies.vx[fb]! + (impulse / mf) * dx;
        bodies.vy[fb] = bodies.vy[fb]! + (impulse / mf) * dy;
        bodies.vx[b] = bodies.vx[b]! - (impulse / mb) * dx;
        bodies.vy[b] = bodies.vy[b]! - (impulse / mb) * dy;
    }

    /** Whether any of ship `i`'s engines, at full throttle, would play on body `target`. */
    private wouldBurn(bodies: Bodies, grid: SpatialGrid, i: number, target: number): boolean {
        const design = this.designs[i]!;
        const b = bodies.indexOf(this.bodyIds[i]!);
        if (b < 0) return false;
        for (let t = 0; t < design.engines.length; t++) {
            const force = this.exhaustOf(i, design, b, t);
            if (!(force > 0)) continue;
            const engine = design.modules[design.engines[t]?.module ?? -1];
            const rays = engine === undefined ? 0 : plumeRays(geometryOf(engine));
            const layers = plumeLayers(design, t, this.layersOf(b));
            for (let layer = HULL_LAYER; layer <= WEAPONS_LAYER; layer <<= 1) {
                if ((layers & layer) === 0) continue;
                for (let ray = 0; ray < rays; ray++) {
                    if (this.plumes.cast(design, t, ray, force, bodies, b, grid, this.hulls, layer) && this.plumes.body === target)
                        return true;
                }
            }
        }
        return false;
    }

    /**
     * Spawn the first slice of `craft` against slipway `slipway` of builder
     * `i`'s body `b`, and hold it there: a ship being built, which is one in
     * all but its parts. Its index, or -1 while anything is in its way.
     */
    private layKeel(world: World, i: number, b: number, slipway: number, craft: ShipDesign, print: Print, depth: number): number {
        const bodies = world.bodies;
        const hull = this.designs[i]!;
        const frame = printFrame(hull.modules[slipway]!.spec, craft, depth);
        const c = cos(frame.angle);
        const s = sin(frame.angle);
        const seed = print.design;
        // Its centre in the hull's blueprint frame, and then in the world.
        const hx = frame.dx + seed.centreOfMassX * c - seed.centreOfMassY * s - hull.centreOfMassX;
        const hy = frame.dy + seed.centreOfMassX * s + seed.centreOfMassY * c - hull.centreOfMassY;
        const angle = bodies.angle[b]!;
        const ca = cos(angle);
        const sa = sin(angle);
        const x = bodies.x[b]! + hx * ca - hy * sa;
        const y = bodies.y[b]! + hx * sa + hy * ca;
        for (let j = 0; j < bodies.highWater; j++) {
            if (j === b || bodies.alive[j] === 0 || bodies.ghost[j] === 1 || !this.meets(b, j)) continue;
            const other = this.designOf(j);
            if (other === null) continue;
            for (let m = 0; m < seed.modules.length; m++) {
                if (moduleOverlapsHull(seed, m, x, y, angle + frame.angle, bodies, j, other)) return -1;
            }
        }
        const spin = bodies.angularVel[b]!;
        const f = this.spawn(world, {
            design: seed,
            x,
            y,
            angle: angle + frame.angle,
            vx: bodies.vx[b]! - spin * (y - bodies.y[b]!),
            vy: bodies.vy[b]! + spin * (x - bodies.x[b]!),
            angularVel: spin,
            team: this.team[i]!,
        });
        this.launched[f] = craft;
        this.buildsFor(f, craft);
        this.couldFight[f] = craft.turrets.some((t) => t.main) || craft.engines.length > 0 ? 1 : 0;
        this.unfinished[f] = 1;
        this.printing[f] = 1;
        this.merge(world, i, f, slipway, print.held[0]!, { at: "a", kind: "slipway" });
        this.home[f] = i;
        // Held by every piece, the first by the seam it was welded on with.
        if (print.held.length > 1) this.reprint(world, b, f, slipway, craft, print, depth);
        return f;
    }

    /**
     * Make what ship `f`, being built on slipway `slipway` of body `b`, has of `craft` into `print`, built to `depth`: its modules taken out
     * of the hull and put back as `print` lays them, pushed out from the face,
     * each piece held by the slipway. Everything else aboard as it was. False,
     * changing nothing, while anything is in the way of where it goes.
     */
    private reprint(world: World, b: number, f: number, slipway: number, craft: ShipDesign, print: Print, depth: number): boolean {
        const bodies = world.bodies;
        const p = this.shipAt(bodies, b);
        if (p < 0) return false;
        const was = this.designs[p]!;
        const keep: number[] = [];
        const old = new Map<number, number>();
        for (let m = 0; m < was.modules.length; m++) {
            if (this.pilotAt(b, m) === f) old.set(originOf(was, m).module, m);
            else keep.push(m);
        }
        const n = keep.length;
        const at = keep.indexOf(slipway);
        if (at < 0) return false;
        const frame = printFrame(was.modules[slipway]!.spec, craft, depth);
        const width = was.modules[slipway]!.spec.width;
        const held = print.held.map((h) => ({ a: at, b: n + h, width, dock: "slipway" as const }));
        const welded = weldDesigns(subDesign(was, keep), print.design, frame.dx, frame.dy, frame.angle, at, print.held[0]!, width, {
            at: "a",
            kind: "slipway",
        });
        const next = seamedDesign(welded, held.slice(1));
        const moduleOf = (m: number): number => (m < n ? keep[m]! : (old.get(print.modules[m - n]!) ?? -1));

        // Nothing of its own hull, or of anything else, where it goes.
        for (let m = n; m < next.modules.length; m++) {
            for (let k = 0; k < n; k++) if (modulesOverlap(next.modules[k]!.spec, next.modules[m]!.spec)) return false;
        }
        const offset = this.offsetOf(bodies, b, was, next);
        const x = bodies.x[b]! + offset.x;
        const y = bodies.y[b]! + offset.y;
        for (let j = 0; j < bodies.highWater; j++) {
            if (j === b || bodies.alive[j] === 0 || bodies.ghost[j] === 1 || !this.meets(b, j)) continue;
            const other = this.designOf(j);
            if (other === null) continue;
            for (let m = n; m < next.modules.length; m++) {
                if (moduleOverlapsHull(next, m, x, y, bodies.angle[b]!, bodies, j, other)) return false;
            }
        }

        this.momentum(bodies);
        const beforeX = this.momentumX;
        const beforeY = this.momentumY;
        const id = this.bodyIds[p]!;
        const spin = bodies.angularVel[b]!;
        bodies.x[b] = x;
        bodies.y[b] = y;
        bodies.vx[b] = bodies.vx[b]! - spin * offset.y;
        bodies.vy[b] = bodies.vy[b]! + spin * offset.x;
        bodies.setMass(id, next.mass);
        bodies.setInertia(id, next.inertia);
        bodies.radius[b] = next.radius;
        const pilots = this.pilots[b];
        const now = new Int32Array(next.modules.length);
        for (let m = 0; m < now.length; m++) now[m] = m < n ? (pilots?.[keep[m]!] ?? p) : f;
        this.adopt(p, b, next, () => p, moduleOf, true, false, f);
        this.pilots[b] = now;
        for (const r of this.ridersOf(bodies, b)) if (r !== p) this.board(r, p);
        // A module just whole has its walls, and is waiting on its fittings.
        for (let m = n; m < next.modules.length; m++) {
            const from = moduleOf(m);
            if (next.modules[m]!.shell === undefined && (from < 0 || was.modules[from]!.shell !== undefined)) {
                this.damage.unfit(b, m, fittingOf(craft.modules[print.modules[m - n]!]!.stats));
            }
        }
        this.settleMass(bodies, b);
        this.momentum(bodies);
        bodies.vx[b] = bodies.vx[b]! + (beforeX - this.momentumX) / movable(bodies.mass[b]!);
        bodies.vy[b] = bodies.vy[b]! + (beforeY - this.momentumY) / movable(bodies.mass[b]!);
        return true;
    }

    /**
     * How many of a pad's fighters are still in the fight, forgetting the dead:
     * one being built while it is on its carrier, one in control and not
     * mission killed, and one in control aboard a friend, which will be filled.
     */
    private fielded(bodies: Bodies, i: number, fighters: number[]): number {
        let count = 0;
        let kept = 0;
        for (let k = 0; k < fighters.length; k++) {
            const f = fighters[k]!;
            if (this.alive[f] === 0) continue;
            fighters[kept++] = f;
            if (this.unfinished[f] === 1) {
                if (bodies.indexOf(this.bodyIds[f]!) >= 0 && this.parkedOn[f] === i) count++;
                continue;
            }
            if (!this.hasControl(f)) continue;
            const b = bodies.indexOf(this.bodyIds[f]!);
            const p = this.parkedOn[f]! >= 0 ? this.parkedOn[f]! : b < 0 ? -1 : this.shipByBody[b]!;
            if (!this.isMissionKilled(f) || (p !== f && p >= 0 && this.team[p] === this.team[f])) count++;
        }
        fighters.length = kept;
        return count;
    }

    /**
     * Whether a fighter of ship `i`'s side is making for its pad `pad` and can
     * still get there: under control, and with an engine that works.
     */
    private awaited(i: number, pad: number): boolean {
        for (let o = 0; o < this.alive.length; o++) {
            if (this.alive[o] === 0 || this.salvaging[o] !== i || this.landingPad[o] !== pad) continue;
            if (this.derelict[o] === 1 || !this.hasControl(o) || this.hasNoEngines(o)) continue;
            return true;
        }
        return false;
    }

    /**
     * Put a step of the pad's work into the walls of the core it lays next, at
     * the rate and price a pad mends at, and lay them down once there is a
     * shell's step of them and the metal to pay for it.
     */
    private layDown(world: World, i: number, b: number, design: ShipDesign, pad: number, k: number, fighter: ShipDesign): void {
        const bodies = world.bodies;
        const core = fighter.cores[0];
        if (core === undefined) return;
        const whole = fighter.modules[core]!;
        const wall = whole.stats.structureMass / SHELL_STEPS;
        const cost = wall * (1 + REPAIR_WASTE);
        if (this.allowed(Resource.Metal, b, pad, Claim.Pads, cost) < cost) return;
        const brood = this.broods[i]!;
        const work = buildWork(whole.stats);
        const perKg = work * REPAIR_ENERGY_PER_JOULE;
        const working = this.left(i, b, pad, DamageEffect.Grip);
        const joules = PAD_REPAIR_PER_METRE * design.modules[pad]!.spec.width * working * world.dt;
        const charge = this.allowed(Resource.Charge, b, pad, Claim.Pads, (wall - brood.work[k]!) * perKg);
        const kg = min(min(joules / work, charge / perKg), wall - brood.work[k]!);
        if (kg > 0) {
            brood.work[k] = brood.work[k]! + kg;
            this.took(Resource.Charge, b, pad, Claim.Pads, this.power.drain(b, pad, kg * perKg));
            this.builtAt[i] = world.tick;
        }
        if (brood.work[k]! < wall) return;
        brood.work[k] = 0;

        // Where the whole fighter would lie, and where its core's first step is in that.
        const pose = aboardPose(design, { pad, design: fighter });
        const pc = cos(pose.angle);
        const ps = sin(pose.angle);
        // The carrier's middle, in the fighter's blueprint frame.
        const mx = fighter.centreOfMassX - (pose.x * pc + pose.y * ps);
        const my = fighter.centreOfMassY - (-pose.x * ps + pose.y * pc);
        const face = faceNearest(whole.spec, mx, my);
        const share = 1 / SHELL_STEPS;
        const part = shellOf(whole.spec, whole.stats, face, share);
        const origin = { design: fighter, module: core };
        const seed = rebuiltDesign(subDesign(fighter, [core]), 0, part.spec, part.stats, origin, { share, face, placed: whole.spec });
        const ox = seed.centreOfMassX - fighter.centreOfMassX;
        const oy = seed.centreOfMassY - fighter.centreOfMassY;
        const lx = pose.x + ox * pc - oy * ps;
        const ly = pose.y + ox * ps + oy * pc;

        const mass = bodies.mass[b]!;
        const inertia = bodies.inertia[b]!;
        this.took(Resource.Metal, b, pad, Claim.Pads, this.metal.drain(b, pad, cost));
        this.settleMass(bodies, b);
        const angle = bodies.angle[b]!;
        const c = cos(angle);
        const s = sin(angle);
        const x = bodies.x[b]! + lx * c - ly * s;
        const y = bodies.y[b]! + lx * s + ly * c;
        const spin = bodies.angularVel[b]!;
        const f = this.spawn(world, {
            design: seed,
            x,
            y,
            angle: angle + pose.angle,
            vx: bodies.vx[b]! - spin * (y - bodies.y[b]!),
            vy: bodies.vy[b]! + spin * (x - bodies.x[b]!),
            angularVel: spin,
            team: this.team[i]!,
        });
        // It is building towards the whole fighter, and is one in all but its parts.
        this.launched[f] = fighter;
        this.buildsFor(f, fighter);
        this.couldFight[f] = fighter.turrets.some((t) => t.main) || fighter.engines.length > 0 ? 1 : 0;
        this.unfinished[f] = 1;
        this.park(bodies, i, f, pad);
        this.home[f] = i;
        brood.fighters[k]!.push(f);
        // What it wasted left at the hull's speed.
        this.discardFrom(bodies, bodies.indexOf(this.bodyIds[i]!), mass, inertia);
    }

    /** Whether fighter `i`, being built on body `b` of design `design`, has every module its design has, whole and fitted. */
    private finished(b: number, i: number, design: ShipDesign): boolean {
        const rebuild = this.rebuildFor(i, design);
        for (let l = 0; l < rebuild.at.length; l++) {
            const m = rebuild.at[l]!;
            if (m < 0 || design.modules[m]!.shell !== undefined || this.damage.unbuiltAt(b, m) > 0) return false;
        }
        return true;
    }

    /**
     * Whether ship `i` can still put an armed fighter or ship in the fight:
     * under control, with a pad or slipway of its own working that builds one
     * and the metal on its piece of hull for at least the fighter's core or the
     * ship's first slice.
     */
    canBuildArmed(i: number): boolean {
        const builds = this.launched[i]?.builds ?? [];
        const yards = this.launched[i]?.yards ?? [];
        if ((builds.length === 0 && yards.length === 0) || !this.hasControl(i)) return false;
        const bodies = this.bodyStore!;
        const b = bodies.indexOf(this.bodyIds[i]!);
        const design = this.designs[i]!;
        const rebuild = this.rebuildFor(i, design);
        for (const order of yards) {
            const craft = this.craftFor(i, order.slipway, order.design);
            if (!(craft.turrets.some((t) => t.main) || craft.mainWeaponEngines.length > 0)) continue;
            const slipway = rebuild.at[order.slipway]!;
            if (slipway < 0 || !(this.left(i, b, slipway, DamageEffect.Grip) > 0)) continue;
            // The metal for its first slice, at least.
            const berth = this.launched[i]!.modules[order.slipway]!.spec;
            const first = printedCraft(craft, berth, min(printLength(craft, berth), SLIPWAY_STEP));
            let kg = 0;
            for (const module of first?.design.modules ?? []) kg += module.stats.structureMass;
            if (this.metal.pieceHeld(b, slipway) >= kg * (1 + REPAIR_WASTE)) return true;
        }
        for (const order of builds) {
            const fighter = this.craftFor(i, order.pad, order.design);
            const core = fighter.cores[0];
            if (core === undefined || !(fighter.turrets.some((t) => t.main) || fighter.mainWeaponEngines.length > 0)) continue;
            const pad = rebuild.at[order.pad]!;
            if (pad < 0 || !(this.left(i, b, pad, DamageEffect.Grip) > 0)) continue;
            const stats = fighter.modules[core]!.stats;
            if (this.metal.pieceHeld(b, pad) >= (stats.structureMass + fittingOf(stats)) * (1 + REPAIR_WASTE)) return true;
        }
        return false;
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

    /** Whether every corner of body `b`'s bounding box lies inside a pad of `spec` at `place`. */
    private within(
        bodies: Bodies,
        b: number,
        design: ShipDesign,
        place: { x: number; y: number; angle: number },
        spec: ModuleSpec,
    ): boolean {
        const box = footprintOf(design);
        const angle = bodies.angle[b]!;
        const c = cos(angle);
        const s = sin(angle);
        const pc = cos(place.angle);
        const ps = sin(place.angle);
        const halfL = spec.length / 2;
        const halfW = spec.width / 2;
        for (let k = 0; k < 4; k++) {
            const lx = k < 2 ? box.minX : box.maxX;
            const ly = k % 2 === 0 ? box.minY : box.maxY;
            const dx = bodies.x[b]! + lx * c - ly * s - place.x;
            const dy = bodies.y[b]! + lx * s + ly * c - place.y;
            if (abs(dx * pc + dy * ps) > halfL || abs(-dx * ps + dy * pc) > halfW) return false;
        }
        return true;
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
     * How many times over a ship can push itself back from an asteroid, jaws
     * first, against its pull at the surface: Infinity for one with no well.
     */
    private holdsOff(bodies: Bodies, i: number, b: number, claw: number, tb: number): number {
        const pull = this.surfacePull(bodies, tb);
        if (!(pull > 0)) return Infinity;
        const jaws = this.designs[i]!.modules[claw]!.spec.angle ?? 0;
        const back = this.layoutOf(i).maxThrustAlong(-cos(jaws), -sin(jaws)) / movable(bodies.mass[b]!);
        return back / pull;
    }

    /** How hard body `tb`'s well pulls body `b` where it is, m/s², into `partAt`: nothing for a body that rides none. */
    private wellPullOn(bodies: Bodies, b: number, tb: number): void {
        this.partAt.x = 0;
        this.partAt.y = 0;
        const well = this.rides[tb];
        if (well === undefined) return;
        const dx = bodies.x[tb]! - bodies.x[b]!;
        const dy = bodies.y[tb]! - bodies.y[b]!;
        const soft = well.softening ?? 0;
        const r2 = dx * dx + dy * dy + soft * soft;
        if (!(r2 > 0)) return;
        const k = well.gm / (r2 * sqrt(r2));
        this.partAt.x = dx * k;
        this.partAt.y = dy * k;
    }

    /** How hard body `tb`'s well pulls at its edge, m/s²: none for a body that rides none. */
    private surfacePull(bodies: Bodies, tb: number): number {
        const well = this.rides[tb];
        if (well === undefined) return 0;
        const r = bodies.radius[tb]!;
        const soft = well.softening ?? 0;
        const r2 = r * r + soft * soft;
        return (well.gm * r) / (r2 * sqrt(r2));
    }

    /** What an asteroid's rock still holds, kg: all of it, and the ore and ice in it less what mining wastes. */
    private rockHeld(b: number, design: ShipDesign): { rock: number; ore: number; ice: number } {
        let rock = 0;
        let ore = 0;
        let ice = 0;
        for (let m = 0; m < design.modules.length; m++) {
            const { spec, stats } = design.modules[m]!;
            if (spec.kind !== "rock") continue;
            const left = max(0, stats.mass - this.damage.unbuiltAt(b, m));
            rock += left;
            ore += left * (spec.ore ?? 0) * (1 - DISASSEMBLY_WASTE);
            ice += left * (spec.ice ?? 0) * (1 - DISASSEMBLY_WASTE);
        }
        return { rock, ore, ice };
    }

    /**
     * Seconds mining `take` of fuel and `strip` of metal out of an asteroid
     * takes: its robots cutting rock until they have both, or with none, a claw
     * melting the fuel alone.
     */
    private miningTime(held: { rock: number; ore: number; ice: number }, take: number, strip: number, stripRate: number): number {
        if (!(stripRate > 0)) return take / CLAW_HEAT_RATE;
        const forOre = held.ore > 0 ? (strip / held.ore) * held.rock : 0;
        const forIce = held.ice > 0 ? (take / held.ice) * held.rock : 0;
        return max(forOre, forIce) / stripRate;
    }

    /**
     * The source a claw ship goes for: what pays most for the time it takes.
     * Wanting an anchor (`wantsAnchor`), an asteroid with nothing it could take
     * still serves, the nearest first.
     */
    private pickSource(bodies: Bodies, i: number, b: number, claw: number, room: number, metalRoom: number, anchors = false): number {
        const design = this.designs[i]!;
        const approach = this.doctrines[i]!.approach;
        const pump = design.modules[claw]!.stats.pumpRate;
        if (!(pump > 0) || !(approach.clawSpeed > 0)) return NO_TARGET;
        const mass = bodies.mass[b]!;
        const mains = this.layoutOf(i).maxThrustAlong(cos(design.thrustBearing), sin(design.thrustBearing)) / mass;
        const exhaust = exhaustOf(design);
        let robots = 0;
        if (metalRoom > 0) for (const robot of this.robots.on(b) ?? []) if (this.pilotAt(b, robot.bay) === i) robots++;
        const stripRate = (robots * ROBOT_REPAIR_RATE) / DAMAGE_ENERGY_PER_KG;
        let best = NO_TARGET;
        let bestScore = 0;
        for (let t = 0; t < this.alive.length; t++) {
            if (t === i || this.alive[t] === 0) continue;
            // What a claw will close on, and of the enemies only those that cannot shoot back.
            if (!this.drinkable(i, t) || (this.hasControl(t) && !this.isDisarmed(t))) continue;
            const tb = bodies.indexOf(this.bodyIds[t]!);
            // A body is offered once, by the ship it is, and only if the claw can touch it.
            if (tb < 0 || tb === b || this.shipByBody[tb] !== t || !this.clawReaches(b, claw, tb)) continue;
            // An asteroid is worth what its rock holds: ore its robots smelt, and ice
            // they melt, or the claw alone does, slower.
            const asteroid = this.isAsteroid(t);
            if (asteroid && !(approach.rockWeight > 0)) continue;
            // One that pulls cannot be closed on slowly jaws first without thrust to hold off its pull.
            if (asteroid && !(this.holdsOff(bodies, i, b, claw, tb) > 1)) continue;
            // Nor one an enemy has hold of: it would be closing on the enemy as much as on the rock.
            if (asteroid && this.enemyMoored(i, t)) continue;
            const held = asteroid ? this.rockHeld(tb, this.designs[t]!) : null;
            const fuel = held !== null ? held.ice : this.fuel.left(tb);
            const take = fuel < room ? fuel : room;
            // What its robots would bring home of it, less what taking it apart wastes.
            const metal =
                held !== null
                    ? robots > 0
                        ? held.ore
                        : 0
                    : metalRoom > 0 && this.strippableWreck(t)
                      ? (bodies.mass[tb]! - fuel) * (1 - DISASSEMBLY_WASTE)
                      : 0;
            const strip = metal < metalRoom ? metal : metalRoom;
            const anchor = anchors && asteroid;
            if (!(take > 0 || strip > 0 || anchor)) continue;
            const dx = bodies.x[tb]! - bodies.x[b]!;
            const dy = bodies.y[tb]! - bodies.y[b]!;
            const apart = length(dx, dy);
            // Getting there at its closing speed less however fast the source is
            // going away: one it cannot gain on is no source at all.
            const gap = max(0, apart - bodies.radius[tb]!);
            // Already alongside the one it is after, a miss that bounced it off is
            // a reposition, not a trip: neither how fast it is now drifting off nor
            // the speed to match counts against it.
            const alongside = t === this.salvaging[i] && gap <= 2 * bodies.radius[b]!;
            const receding =
                alongside || !(apart > 0) ? 0 : ((bodies.vx[tb]! - bodies.vx[b]!) * dx + (bodies.vy[tb]! - bodies.vy[b]!) * dy) / apart;
            const closing = approach.clawSpeed - receding;
            if (!(closing > 0)) continue;
            // What the trip burns: matching the source's motion, then speeding up
            // and slowing down again, no faster than the gap gives room for. A
            // source has to pay more than that to be worth going for at all.
            const cruise = min(closing, sqrt(mains * gap));
            const dv = (alongside ? 0 : length(bodies.vx[tb]! - bodies.vx[b]!, bodies.vy[tb]! - bodies.vy[b]!)) + 2 * cruise;
            const cost = exhaust > 0 ? mass * (1 - exp(-dv / exhaust)) : 0;
            let gain = (take + strip * approach.fuelPerMetal) * (held !== null ? approach.rockWeight : 1) - cost;
            // An anchor is worth having however little it gives, so the soonest reached wins.
            if (anchor && !(gain > 0)) gain = 1;
            if (!(gain > 0)) continue;
            const time =
                (gap / closing) * approach.tripWeight +
                (held !== null ? this.miningTime(held, take, strip, stripRate) : take / pump + (strip > 0 ? strip / stripRate : 0));
            const danger = approach.scavengeDanger > 0 ? this.dangerNear(bodies, i, tb) : 0;
            const score = gain / max(time, 1e-3) / (1 + max(0, approach.scavengeDanger) * danger);
            if (score > bestScore) {
                best = t;
                bestScore = score;
            }
        }
        return best;
    }

    /** Whether a ship hostile to ship `i` is moored to asteroid `t`. */
    private enemyMoored(i: number, t: number): boolean {
        for (let k = 0; k < this.parkedShips.length; k++) {
            const j = this.parkedShips[k]!;
            if (this.parkedOn[j] === t && this.mooredClaw[j]! >= 0 && this.hostile(i, j)) return true;
        }
        return false;
    }

    /**
     * Whether the claw at module `claw` of body `b` shares a layer with any
     * module of body `tb`: a thin claw cannot close on a fighter or a piece of
     * one, which flies above the deck.
     */
    private clawReaches(b: number, claw: number, tb: number): boolean {
        const mine = moduleLayers(this.hullDesign[b]!.modules[claw]!, this.layersOf(b));
        const design = this.hullDesign[tb];
        if (design === null || design === undefined) return false;
        const theirs = this.layersOf(tb);
        for (const module of design.modules) if ((moduleLayers(module, theirs) & mine) !== 0) return true;
        return false;
    }

    /** Whether ship `t` is wreckage whole, as robots take it apart: nobody flies it, or nobody mends it. */
    private strippableWreck(t: number): boolean {
        if (this.derelict[t] === 1) return true;
        if (this.hasControl(t)) return false;
        const bodies = this.bodyStore;
        const tb = bodies === null ? -1 : bodies.indexOf(this.bodyIds[t]!);
        return tb >= 0 && !this.hasRobots(tb, t);
    }

    /** Whether ship `i`'s claw will close on ship `t`: a wreck of either side, or an enemy. */
    private drinkable(i: number, t: number): boolean {
        return this.derelict[t] === 1 || this.hostile(i, t) || !this.hasControl(t);
    }

    /** The first claw this ship works that can still close, or -1. */
    private workingClaw(i: number, b: number): number {
        const design = this.designs[i]!;
        for (let m = 0; m < design.modules.length; m++) {
            if (design.modules[m]!.spec.kind === "claw" && this.left(i, b, m, DamageEffect.Grip) > 0) return m;
        }
        return -1;
    }

    /**
     * The heading to hold closing on an asteroid: `jawsOn`, the claw towards it,
     * unless its motion is off what `grapple` asks for (`radial`, closing) by
     * more than it can put right with its jaws held on before it arrives, and
     * turning its mains along the difference, and back, would put it right
     * sooner. An asteroid in orbit, or one pulling it in, is never as still as
     * a wreck.
     */
    private matchOrbit(bodies: Bodies, i: number, b: number, tb: number, jawsOn: number, radial: number): number {
        const dx = bodies.x[tb]! - bodies.x[b]!;
        const dy = bodies.y[tb]! - bodies.y[b]!;
        const range = length(dx, dy);
        if (!(range > 0)) return jawsOn;
        const ux = dx / range;
        const uy = dy / range;
        const ex = bodies.vx[tb]! + ux * radial - bodies.vx[b]!;
        const ey = bodies.vy[tb]! + uy * radial - bodies.vy[b]!;
        const error = length(ex, ey);
        if (!(error > CLAW_SPEED_HIGH - CLAW_APPROACH)) return jawsOn;
        const closing = (bodies.vx[b]! - bodies.vx[tb]!) * ux + (bodies.vy[b]! - bodies.vy[tb]!) * uy;
        const left = max(0, range - bodies.radius[tb]!) / max(closing, CLAW_APPROACH);
        const jawsTime = error / this.accelerationAlong(bodies, i, b, ex / error, ey / error, jawsOn);
        if (jawsTime <= left) return jawsOn;
        const mains = atan2(ey, ex) - this.designs[i]!.thrustBearing;
        const mainsTime = 4 * this.halfTurnTime(bodies, i, b) + error / this.accelerationAlong(bodies, i, b, ex / error, ey / error, mains);
        return mainsTime < left && mainsTime < jawsTime ? mains : jawsOn;
    }

    /**
     * How fast body `b` brings claw `claw` in to touch: `CLAW_APPROACH`, unless
     * that is more than the claw's spring could stop it from in its stroke, a
     * heavy ship's claw otherwise driven home hard and torn off.
     */
    private clawArrival(bodies: Bodies, b: number, claw: number): number {
        const spec = this.hullDesign[b]!.modules[claw]!.spec;
        const reach = CLAW_DEPTH * spec.length;
        const mass = bodies.mass[b]!;
        // Its spring's work over the stroke, half k·w·reach², as the hull's speed.
        const most = mass > 0 ? reach * sqrt((CLAW_STIFFNESS * spec.width) / mass) : CLAW_APPROACH;
        return min(CLAW_APPROACH, most);
    }

    /** Where the jaws of claw `claw` of ship `i` reach to, in its body frame about its centre of mass, into `partAt`. */
    private jawsTip(i: number, claw: number): void {
        const module = this.designs[i]!.modules[claw]!;
        const turned = module.spec.angle ?? 0;
        this.partAt.x = module.x + (cos(turned) * module.spec.length) / 2;
        this.partAt.y = module.y + (sin(turned) * module.spec.length) / 2;
    }

    /**
     * Choose, or keep, where ship `i`'s claw will take hold of body `tb`: a
     * point on an outside face of its hull facing the claw, the one whose gate,
     * out along its normal, is nearest the jaws, of those wide enough for the
     * jaws and with room in front of them for the ship to come straight in, if
     * any are, or else of those wide enough, or with room. Kept in `tb`'s frame so it turns with the hull, and kept
     * once the jaws are inside the gate, unless the hull changes or the module
     * is spent; looked at again every `GRIP_RECHOOSE` before that. False with
     * no outside face facing the claw, for it to close on the middle instead.
     */
    private chooseGrip(bodies: Bodies, i: number, b: number, tb: number, source: number, claw: number, dt: number): boolean {
        const hull = this.hullDesign[tb];
        if (hull === null || hull === undefined) return false;
        const angle = bodies.angle[tb]!;
        const c = cos(angle);
        const s = sin(angle);
        // The jaws in the target's frame.
        this.jawsTip(i, claw);
        const shipAngle = bodies.angle[b]!;
        const wx = bodies.x[b]! + this.partAt.x * cos(shipAngle) - this.partAt.y * sin(shipAngle) - bodies.x[tb]!;
        const wy = bodies.y[b]! + this.partAt.x * sin(shipAngle) + this.partAt.y * cos(shipAngle) - bodies.y[tb]!;
        const qx = wx * c + wy * s;
        const qy = wy * c - wx * s;
        const gate = bodies.radius[b]!;
        const kept =
            this.gripBody[i] === tb && this.gripHull[i] === hull && this.gripModule[i]! >= 0 && !this.damage.spent(tb, this.gripModule[i]!);
        if (kept) {
            const out = (qx - this.gripX[i]!) * this.gripNx[i]! + (qy - this.gripY[i]!) * this.gripNy[i]!;
            if (out < 2 * gate || (this.now - this.gripAt[i]!) * dt < GRIP_RECHOOSE) return true;
        }

        const outlines = this.gripOutlines;
        const starts = this.gripStarts;
        const corners = this.faceCorners;
        outlines.length = 0;
        starts.length = 0;
        for (let m = 0; m < hull.modules.length; m++) {
            starts.push(outlines.length);
            if (this.damage.spent(tb, m)) continue;
            const count = moduleOutline(hull.modules[m]!.spec, corners);
            for (let v = 0; v < count * 2; v += 2) outlines.push(corners[v]! - hull.centreOfMassX, corners[v + 1]! - hull.centreOfMassY);
        }
        starts.push(outlines.length);
        const width = this.designs[i]!.modules[claw]!.spec.width;
        let best = Infinity;
        // How good the best face so far is, before how near: wide enough for the jaws counts for more than room in front of it.
        let bestTier = -1;
        for (let m = 0; m < hull.modules.length; m++) {
            // Only the source's own: a friend anchored to the same rock stands in the way, and is no face to grip.
            if (this.pilotAt(tb, m) !== source) continue;
            const from = starts[m]!;
            const n = (starts[m + 1]! - from) / 2;
            for (let e = 0; e < n; e++) {
                const ax = outlines[from + e * 2]!;
                const ay = outlines[from + e * 2 + 1]!;
                const bx = outlines[from + ((e + 1) % n) * 2]!;
                const by = outlines[from + ((e + 1) % n) * 2 + 1]!;
                const span = length(bx - ax, by - ay);
                if (!(span > 0)) continue;
                const tx = (bx - ax) / span;
                const ty = (by - ay) / span;
                // Outward, the outline being anticlockwise.
                const nx = ty;
                const ny = -tx;
                // Facing the jaws.
                if ((qx - ax) * nx + (qy - ay) * ny <= 0) continue;
                // Where the jaws are square across from, but the middle of a face only a few jaws wide.
                const margin = min(width, span) / 2;
                const along = span < 4 * width ? span / 2 : clamp((qx - ax) * tx + (qy - ay) * ty, margin, span - margin);
                const px = ax + tx * along;
                const py = ay + ty * along;
                // Outside: no other module just beyond it.
                if (this.insideAnyOutline(m, px + nx * 0.01, py + ny * 0.01)) continue;
                const cost = length(px + nx * gate - qx, py + ny * gate - qy);
                const fits = span >= width ? 2 : 0;
                // Not worth asking about room in front of one that could not win with it.
                if (fits + 1 < bestTier || (fits + 1 === bestTier && !(cost < best))) continue;
                // Room in front of it, as wide as the ship, to come straight in.
                const tier = fits + (this.corridorClear(px, py, nx, ny, gate, GRIP_CLEAR * gate) ? 1 : 0);
                if (tier < bestTier || (tier === bestTier && !(cost < best))) continue;
                bestTier = tier;
                best = cost;
                this.gripModule[i] = m;
                this.gripX[i] = px;
                this.gripY[i] = py;
                this.gripNx[i] = nx;
                this.gripNy[i] = ny;
                this.gripSlack[i] = max(0, min(along, span - along) - width / 2);
            }
        }
        if (best === Infinity) {
            this.gripBody[i] = -1;
            return false;
        }
        this.gripBody[i] = tb;
        this.gripHull[i] = hull;
        this.gripAt[i] = this.now;
        return true;
    }

    /**
     * Whether the strip in front of a face at `px`, `py` with outward normal
     * `nx`, `ny`, `half` either side of it and `depth` out, misses every
     * module of `gripOutlines`: room for a ship to come straight in to it.
     */
    private corridorClear(px: number, py: number, nx: number, ny: number, half: number, depth: number): boolean {
        const outlines = this.gripOutlines;
        const starts = this.gripStarts;
        // From just off the face, so the module the face is on does not count.
        const lo = 0.05;
        for (let m = 0; m + 1 < starts.length; m++) {
            const from = starts[m]!;
            const n = (starts[m + 1]! - from) / 2;
            if (n < 3) continue;
            // Apart along the strip's own axes?
            let minOut = Infinity;
            let maxOut = -Infinity;
            let minSide = Infinity;
            let maxSide = -Infinity;
            for (let v = 0; v < n; v++) {
                const dx = outlines[from + v * 2]! - px;
                const dy = outlines[from + v * 2 + 1]! - py;
                const out = dx * nx + dy * ny;
                const side = dy * nx - dx * ny;
                minOut = min(minOut, out);
                maxOut = max(maxOut, out);
                minSide = min(minSide, side);
                maxSide = max(maxSide, side);
            }
            if (maxOut <= lo || minOut >= depth || maxSide <= -half || minSide >= half) continue;
            // Apart along one of the module's edge normals?
            let apart = false;
            for (let e = 0; e < n && !apart; e++) {
                const ax = outlines[from + e * 2]!;
                const ay = outlines[from + e * 2 + 1]!;
                const ex = outlines[from + ((e + 1) % n) * 2]! - ax;
                const ey = outlines[from + ((e + 1) % n) * 2 + 1]! - ay;
                // Outward, (ey, -ex): the strip apart if every corner of it lies beyond the edge.
                let nearest = Infinity;
                for (let k = 0; k < 4; k++) {
                    const o = k < 2 ? lo : depth;
                    const sd = k % 2 === 0 ? -half : half;
                    const cx = px + nx * o - ny * sd - ax;
                    const cy = py + ny * o + nx * sd - ay;
                    nearest = min(nearest, cx * ey - cy * ex);
                }
                if (nearest >= 0) apart = true;
            }
            if (!apart) return false;
        }
        return true;
    }

    /** Whether a point in a hull's frame lies inside any module of `gripOutlines` but `skip`. */
    private insideAnyOutline(skip: number, x: number, y: number): boolean {
        const outlines = this.gripOutlines;
        const starts = this.gripStarts;
        for (let m = 0; m + 1 < starts.length; m++) {
            if (m === skip) continue;
            const from = starts[m]!;
            const n = (starts[m + 1]! - from) / 2;
            if (n < 3) continue;
            let inside = true;
            for (let e = 0; e < n && inside; e++) {
                const ax = outlines[from + e * 2]!;
                const ay = outlines[from + e * 2 + 1]!;
                const bx = outlines[from + ((e + 1) % n) * 2]!;
                const by = outlines[from + ((e + 1) % n) * 2 + 1]!;
                if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) <= 0) inside = false;
            }
            if (inside) return true;
        }
        return false;
    }

    /**
     * Bring claw `claw` in square to the face `chooseGrip` chose: make for its
     * gate, a ship's radius out along its normal, down a stopping curve, the
     * jaws on the source's middle until it is near and then turned on to the
     * face; and there, once the jaws are on that
     * line and square to the face, straight in, down a stopping curve as
     * `grapple`'s, onto the face. All moving as that point of the hull does,
     * turning with it included, and held against its well's pull. Sets
     * `gripHeading`, and returns the speed it closes at, negative backing off.
     */
    private squareUp(bodies: Bodies, i: number, b: number, tb: number, claw: number, standOff: boolean): number {
        const angle = bodies.angle[tb]!;
        const c = cos(angle);
        const s = sin(angle);
        const gx = this.gripX[i]!;
        const gy = this.gripY[i]!;
        const px = bodies.x[tb]! + gx * c - gy * s;
        const py = bodies.y[tb]! + gx * s + gy * c;
        const nx = this.gripNx[i]! * c - this.gripNy[i]! * s;
        const ny = this.gripNx[i]! * s + this.gripNy[i]! * c;

        const module = this.designs[i]!.modules[claw]!;
        const jaws = module.spec.angle ?? 0;
        this.gripHeading = atan2(-ny, -nx) - jaws;
        this.jawsTip(i, claw);
        const shipAngle = bodies.angle[b]!;
        const tipX = bodies.x[b]! + this.partAt.x * cos(shipAngle) - this.partAt.y * sin(shipAngle);
        const tipY = bodies.y[b]! + this.partAt.x * sin(shipAngle) + this.partAt.y * cos(shipAngle);
        const out = (tipX - px) * nx + (tipY - py) * ny;
        const across = (tipX - px) * -ny + (tipY - py) * nx;

        const approach = this.doctrines[i]!.approach;
        const gate = bodies.radius[b]!;
        // The gate, and how it moves with the hull.
        const gateX = px + nx * gate;
        const gateY = py + ny * gate;
        const spin = bodies.angularVel[tb]!;
        const vx = bodies.vx[tb]! - spin * (gateY - bodies.y[tb]!);
        const vy = bodies.vy[tb]! + spin * (gateX - bodies.x[tb]!);
        const pull = this.surfacePull(bodies, tb);
        let wantX = 0;
        let wantY = 0;
        let closing = 0;
        // Once closing, it keeps on with twice the room it was let start with, so a wobble does not send it back.
        const loose = this.gripClosing[i] === 1 ? 2 : 1;
        const lined =
            out <= 1.5 * gate &&
            abs(across) <= loose * max(GRIP_LINE * module.spec.width, this.gripSlack[i]!) &&
            abs(angleDelta(shipAngle, this.gripHeading)) <= loose * GRIP_SQUARE;
        this.gripClosing[i] = lined && !standOff ? 1 : 0;
        if (standOff) {
            closing = -CLAW_APPROACH;
            wantX = nx * CLAW_APPROACH;
            wantY = ny * CLAW_APPROACH;
        } else if (lined) {
            // Straight in, the jaws held on the line, planned on half the braking it
            // has less the well's pull: flying lags what it asks for, and a claw
            // driven home too fast is torn off.
            const retro = this.accelerationAlong(bodies, i, b, nx, ny, this.gripHeading);
            const braking = GRIP_BRAKING * max(approach.brake * retro - pull, 0.1 * approach.brake * retro);
            const stopping = stoppingSpeed(braking, max(0, out), approach.responseTime);
            const arrive = this.clawArrival(bodies, b, claw);
            closing = min(approach.clawSpeed, sqrt(stopping * stopping + arrive * arrive));
            const sideways = clamp(-across / max(approach.responseTime, 1e-3), -arrive, arrive);
            // Out to the gate's line, then in: relative to the gate point, out by how far in it is.
            wantX = -nx * closing - ny * sideways;
            wantY = -ny * closing + nx * sideways;
        } else {
            // To the gate, slowing as it gets there.
            const dx = gateX - tipX;
            const dy = gateY - tipY;
            const span = length(dx, dy);
            if (span > 0) {
                const ux = dx / span;
                const uy = dy / span;
                // Well short of it, the jaws on its middle as any claw ship closing on
                // a source holds them, so its mains carry it there.
                if (span > 2 * gate) this.gripHeading = atan2(bodies.y[tb]! - bodies.y[b]!, bodies.x[tb]! - bodies.x[b]!) - jaws;
                const retro = this.accelerationAlong(bodies, i, b, -ux, -uy, this.gripHeading);
                const braking = GRIP_BRAKING * max(approach.brake * retro - pull, 0.1 * approach.brake * retro);
                const stopping = stoppingSpeed(braking, span, approach.responseTime);
                const arrive = this.clawArrival(bodies, b, claw);
                const speed = min(approach.clawSpeed, sqrt(stopping * stopping + arrive * arrive), span / max(approach.responseTime, 1e-3));
                wantX = ux * speed;
                wantY = uy * speed;
                closing = -(wantX * nx + wantY * ny);
            }
        }
        // Held against the source's pull rather than lagging behind it.
        this.wellPullOn(bodies, b, tb);
        this.urge(URGE_REFERENCE, vx + wantX, vy + wantY, -this.partAt.x, -this.partAt.y);
        return closing;
    }

    /**
     * Close on a source jaws first: down a stopping curve onto its edge that
     * stops not at nothing but at `clawArrival`, so the claw arrives inside
     * its band. `facing` is the heading it holds to point the claw. `standOff`
     * backs it away instead, for another run at it.
     */
    private grapple(bodies: Bodies, i: number, b: number, tb: number, claw: number, facing: number, standOff: boolean): number {
        const dx = bodies.x[tb]! - bodies.x[b]!;
        const dy = bodies.y[tb]! - bodies.y[b]!;
        const range = length(dx, dy);
        let vx = bodies.vx[tb]!;
        let vy = bodies.vy[tb]!;
        let radial = 0;
        if (range > 0) {
            const ux = dx / range;
            const uy = dy / range;
            const design = this.designs[i]!;
            const module = design.modules[claw]!;
            const turned = module.spec.angle ?? 0;
            // How far ahead of the centre of mass its jaws reach.
            const jaws = module.x * cos(turned) + module.y * sin(turned) + module.spec.length / 2;
            const gap = max(0, range - bodies.radius[tb]! - jaws);
            const approach = this.doctrines[i]!.approach;
            // Planned on what it really has astern with its jaws held on, with no
            // floor: a claw has to arrive slowly, so a craft that cannot brake
            // facing its source comes in no faster than it can stop.
            const retro = this.accelerationAlong(bodies, i, b, -ux, -uy, facing);
            const braking = max(approach.brake * retro - this.surfacePull(bodies, tb), 0.1 * approach.brake * retro);
            const stopping = stoppingSpeed(braking, gap, approach.responseTime);
            const arrive = this.clawArrival(bodies, b, claw);
            radial = standOff ? -CLAW_APPROACH : min(approach.clawSpeed, sqrt(stopping * stopping + arrive * arrive));
            vx += ux * radial;
            vy += uy * radial;
        }
        this.urge(URGE_REFERENCE, vx, vy);
        return radial;
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
        const allowed = this.allowed(Resource.Charge, b, mount.module, Claim.Fire, need);
        const got = this.power.draw(b, mount.module, need < allowed ? need : allowed);
        this.took(Resource.Charge, b, mount.module, Claim.Fire, got);
        return got / need;
    }

    /** Whether ship `i` is parked on a pad, or is held by a slipway of body `b` building it. */
    private onPad(i: number, b: number): boolean {
        return this.parkedOn[i]! >= 0 || this.onSlipway(i, b);
    }

    /** Whether ship `i` on body `b` may build on pad or slipway `spec`: anywhere, unless it builds only anchored (`buildAnchored`). */
    private mayBuild(i: number, b: number, spec: ModuleSpec): boolean {
        if (spec.buildAnchored !== true || this.workingClaw(i, b) < 0) return true;
        // Moored to a rock, or holding a wreck in its claw.
        if (this.mooredClaw[i]! >= 0) return true;
        for (const seam of this.hullDesign[b]?.seams ?? []) {
            if (seam.dock === "claw" && this.pilotAt(b, seam.a) === i) return true;
        }
        return false;
    }

    /**
     * Whether ship `i` wants an anchor to build: a pad or slipway of it that
     * builds only anchored (`buildAnchored`) has a ship on it, or keeps more
     * than are in the fight.
     */
    private wantsAnchor(bodies: Bodies, i: number): boolean {
        const launched = this.launched[i];
        if (launched === undefined || !this.hasControl(i)) return false;
        const yard = this.yards[i];
        const yards = launched.yards ?? [];
        for (let k = 0; yard !== null && yard !== undefined && k < yards.length; k++) {
            const order = yards[k]!;
            if (launched.modules[order.slipway]!.spec.buildAnchored !== true) continue;
            if (yard.building[k]! >= 0 || this.fielded(bodies, i, yard.ships[k]!) < this.keepFor(i, order.slipway, order.keep)) return true;
        }
        const brood = this.broods[i];
        const builds = launched.builds ?? [];
        for (let k = 0; brood !== null && brood !== undefined && k < builds.length; k++) {
            const order = builds[k]!;
            if (launched.modules[order.pad]!.spec.buildAnchored !== true) continue;
            if (this.fielded(bodies, i, brood.fighters[k]!) < this.keepFor(i, order.pad, order.keep)) return true;
        }
        return false;
    }

    /** Whether ship `i` is held by a slipway of body `b`: built, and doing nothing until it is let go. */
    private onSlipway(i: number, b: number): boolean {
        const design = this.hullDesign[b];
        for (const seam of design?.seams ?? []) {
            if (seam.dock === "slipway" && this.pilotAt(b, seam.b) === i) return true;
        }
        return false;
    }

    /** Engines off and nothing asked of them, while what it is holding is pumped aboard. */
    private idle(i: number): void {
        this.throttles[i]!.fill(0);
        this.demandFx[i] = 0;
        this.demandFy[i] = 0;
        this.demandTorque[i] = 0;
        this.brakingOnMains[i] = 0;
        this.burning[i] = 0;
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
                this.unpark(this.bodyStore, i, this.now);
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
