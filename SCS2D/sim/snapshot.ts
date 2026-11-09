import type { Bodies } from "./bodies.js";
import { originOf, type ShipDesign } from "./blueprint.js";
import type { WellSpec } from "./gravity.js";
import type { Doctrine, DoctrineOverride } from "./doctrine.js";
import { leakSpeed } from "./fuel.js";
import { NOT_INSIDE, type Projectiles } from "./projectiles.js";
import { BEAM_PLASMA, type Beams } from "./beams.js";
import { MOST_CLOUDS, type Debris } from "./debris.js";
import type { ImpactLog } from "./damage.js";
import type { Ships } from "./ships.js";
import type { Turrets } from "./turrets.js";
import type { World } from "./world.js";
import { cos, sin } from "./math.js";
import * as shipRoute from "./shipRoute.js";
import { fittingOf } from "./rebuild.js";

/** Seconds a closed hole is still pictured, for the vapour it let out to drift off. */
export const LEAK_LINGER = 2;
/** Seconds the scratches round a patched hole take to fade. A hole its lining sealed keeps them. */
export const LEAK_SCRATCH_FADE = 3;

/** Leaking, or closed so lately that what it let out is still drifting off. */
function venting(leak: { rate: number; age: number; closed: number }): boolean {
    return leak.rate > 0 || (leak.closed >= 0 && leak.age - leak.closed < LEAK_LINGER);
}

/**
 * A read-only picture of the world, for anything outside the simulation to
 * draw or report on.
 *
 * This is the "snapshots out" half of the contract (DESIGN.md non-negotiable
 * 6). A renderer given the live stores could read anything, hold an index
 * across a step, or — worst — write to them; given a snapshot it can do none of
 * those. The boundary is what lets the simulation run in a worker later
 * without the renderer noticing.
 *
 * **Filled into caller-owned arrays, not allocated per frame.** A snapshot is
 * taken as often as something looks at it, which for a viewer is every frame.
 * `capture` grows the buffers when it must and otherwise reuses them, so a
 * steady-state frame allocates nothing (non-negotiable 4).
 *
 * Geometry is *not* copied. A design's module layout is fixed for the life of
 * the design, so a snapshot carries a reference to the design and the body
 * pose to draw it at; a renderer transforms the modules itself. Copying the
 * layout every frame would be copying a constant.
 */

/** An order as drawn: what it is, and the body of what it is given against. */
export interface OrderView {
    kind: "attack" | "defend" | "ram" | "dock" | "scavenge" | "deliver" | "flee" | "hide";
    /** The body it is against or making for, or -1 for none yet. */
    target: number;
    /** How far off it was told to hold, and how fast to close, where told rather than doctrine's. */
    distance?: number;
    speed?: number;
}

/** One ship: which design to draw, where it is, and how its turrets are trained. */
export interface ShipView {
    /** What the ship is now, damage and all; what it is built to is its `blueprint`. */
    currentStructure: ShipDesign;
    /**
     * Which body it is — how a flash finds the hull it went off against a frame
     * or two later, when the ships have moved and the list may have changed.
     */
    body: number;
    team: number;
    /** Which of its side's ships it is, from one; zero for a ship with no such count, as in an editor. */
    serial: number;
    /** Which ship it is after its side's name, as "1" or "1.2" (`Ships.nameOf`); absent for its serial. */
    name?: string;
    /**
     * The name painted on each of its cores, as "1" or "1.2", in its design's
     * core order; null for one another ship on its hull works. Optional.
     */
    coreNames?: (string | null)[];
    /** Whether each of its cores still flies anything, in its design's core order. Optional: absent, all do. */
    coresWorking?: boolean[];
    /** The body of what it is fighting, or -1 or absent for nothing. */
    fighting?: number;
    /** What it is doing, told or of its own accord, and the body it is doing it to; absent for nothing. */
    doing?: OrderView["kind"];
    doingTo?: number;
    /**
     * The band of ranges it is holding against what it is fighting, centre to
     * centre, metres; absent when it holds none, as for a ram.
     */
    fightingMin?: number;
    fightingMax?: number;
    /** The body of what it is escorting, or -1 or absent for nothing. */
    covering?: number;
    /** How far from that it stays, centre to centre, metres, and how close it comes; absent, as close as keeping clear lets it. */
    coverBand?: number;
    coverInner?: number;
    /**
     * Where it is flying to, world frame: the point it makes for first, such as where a pad's way in
     * starts, and the point it means to end up at, such as the pad; absent for nowhere in particular.
     */
    viaX?: number;
    viaY?: number;
    destX?: number;
    destY?: number;
    /** The body of what it is keeping clear of most, and how far off it wants it, centre to centre, metres; absent for nothing. */
    avoiding?: number;
    avoidRoom?: number;
    /** Where the middle of that clearance is, world frame: off the body's middle where only its deck can be hit. */
    avoidX?: number;
    avoidY?: number;
    /** How close the two would be touching there. */
    avoidTouch?: number;
    /** The corner it is making for on its way round what is in its way (`shipRoute`), world frame; absent for none. */
    routeX?: number;
    routeY?: number;
    /**
     * The design it is built to, whatever damage has made of `design`: what it is
     * of, for grouping it with others. Absent where it is `design`, as in an editor.
     */
    blueprint?: ShipDesign;
    /** Which ship it is in the simulation, as commands name it; absent where there is none, as in an editor. */
    ship?: number;
    /** The orders it has been given, the current one first; absent for none. */
    orders?: OrderView[];
    /** Its doctrine, with what it has been told over it; absent where there is none, as in an editor. */
    doctrine?: Doctrine;
    /** What it has been told over its doctrine; absent for nothing. */
    override?: DoctrineOverride;
    /** What its pads and slipways have been told to keep, by `slotKey`; absent for nothing. */
    keeps?: Readonly<Record<string, number>>;
    /** What its pads and slipways have been told to build, by `slotKey`; absent for nothing. */
    crafts?: Readonly<Record<string, ShipDesign>>;
    x: number;
    y: number;
    angle: number;
    /** The way it points (`Ships.flownCore`), where that is not its body's `angle`. */
    heading?: number;
    /** Whether it rides a body another ship owns, or is parked on a pad: that ship's icon stands for it. */
    riding?: boolean;
    vx: number;
    vy: number;
    /** World bearing of each turret, in the design's turret order. */
    turretBearings: number[];
    /** Which of those turrets are on target and clear to shoot. */
    turretReady: boolean[];
    /**
     * Where each turret will fire: the world bearing it is aiming along, how far
     * off that it will pull the trigger (radians), and how far it is worth
     * shooting at what it is aiming at (metres; 0 for nothing). Optional, so a
     * view built by hand can leave them out.
     */
    turretAim?: number[];
    turretTrigger?: number[];
    turretTriggerReach?: number[];
    /** Which turrets are pointing into their own ship, where they will not fire. */
    turretFouled?: boolean[];
    /**
     * How full each gun is, 0 to 1 (`Ships.loadOf`), and whether it is
     * reloading rather than ready or firing. Optional, as the aim is.
     */
    turretLoad?: number[];
    turretReloading?: boolean[];
    /**
     * How much lightning each mount shows, 0 to 1: a plasma lance's charge, which
     * it leaks; nothing for any other mount. Absent, none.
     */
    turretSparks?: number[];
    /** Seconds the lightning is drawn at, so it stands still when time does. */
    sparkClock?: number;
    /**
     * The band of ranges its doctrine closes to, centre to centre, against the
     * enemy it prefers, metres. Only a preview sets it.
     */
    holdMin?: number;
    holdMax?: number;
    /**
     * The bearings off its bow, body frame, that bring the most main guns to
     * bear on a target: where it turns to fight. Only a preview sets it.
     */
    attackBearings?: number[];
    /** Throttle held by each engine, 0 to 1, in the design's engine order. */
    throttles: number[];
    /**
     * How far along each of an engine's flames it will fire on what it finds,
     * metres (0 unless it is a weapon), and whether it is firing now. Optional,
     * as the turrets' are.
     */
    engineTriggerReach?: number[];
    engineFiring?: boolean[];
    /**
     * How much of each flame ray landed on a hull last step, as that ray's
     * share of its power — 0 where it met nothing. Every ray twice, once a
     * layer, where `landedIndex` says.
     */
    landed: number[];
    /** The layers each engine's plume is in. Optional, as the triggers are. */
    plumeLayers?: number[];
    /**
     * How much of each module is left, 1 untouched and 0 spent, in the design's
     * module order. A spent module is still there and still stops shells — it is
     * drawn as wreckage rather than not drawn.
     */
    integrity: number[];
    /**
     * How much of each module's fittings are in, 1 for all: a module being
     * built or taken apart does nothing until they are. Optional, as a view
     * built by hand has none.
     */
    fitted?: number[];
    /** Each scar showing, `SCAR_VIEW_STRIDE` numbers apiece (`sim/scars.ts`). Optional, as a view built by hand has none. */
    scars?: number[];
    /** Counts changes to `scars`, so a view can tell when to redraw them. */
    scarsVersion?: number;
    /** Which modules no working core reaches, so they do nothing (`ShipDesign.coveredBy`). Optional, as a view built by hand has none. */
    outOfReach?: boolean[];
    /**
     * Each robot out on the hull, `ROBOT_VIEW_STRIDE` numbers apiece: where it
     * is and which way it faces, body frame, and the share of its charge and of
     * its metal left. Optional, so a view built by hand can leave it out.
     */
    robots?: number[];
    /** How many robots are home in each module, in the design's module order. Optional, as `robots` is. */
    berthed?: number[];
    /** Each robot home, four numbers apiece: its bay, the share of its charge and of its metal it has, and its berth. Optional. */
    docked?: number[];
    /** How many robots each module is the bay of, home or out, by module. Optional. */
    crews?: number[];
    /** How many of those are aboard, each holding a berth, by module. Optional. */
    aboard?: number[];
    /**
     * Each robot a bay is building, two numbers apiece: its bay, and how far it
     * is through, 0 to 1; the most nearly finished of a bay first. Optional.
     */
    builds?: number[];
    /** How full each module is of fuel, 0 to 1, and 1 for one that holds none. */
    fuel?: number[];
    /** How full each module is of metal, 0 to 1, and 1 for one that holds none. */
    metal?: number[];
    /** How full each module is of charge, 0 to 1, and 1 for one that holds none. */
    charge?: number[];
    /**
     * Holes in what holds fuel, body frame: where each is, the way the fuel
     * leaves, how wide the hole is, and how fast it is going out, kg/s. Kept
     * after a hole closes while its scratches show (`LEAK_SCRATCH_FADE`). On the
     * first ship riding a body only, so a hull's leaks are drawn once.
     */
    leakX?: number[];
    leakY?: number[];
    leakDirX?: number[];
    leakDirY?: number[];
    leakWidth?: number[];
    leakRate?: number[];
    /** How long each hole has been open, s, and how fast its fuel leaves, m/s: how far its vapour has got. */
    leakAge?: number[];
    leakSpeed?: number[];
    /** What each hole has been (`Leak`), for how wide it was when each puff left, and how full its tank is. */
    leakOpened?: number[];
    leakClosing?: number[];
    leakFloor?: number[];
    leakPatched?: number[];
    leakFill?: number[];
    /** The module each hole is in, and how old it was when it closed (below nought while open). */
    leakModule?: number[];
    leakClosed?: number[];
    /**
     * Whether the ship still has a core with control in it (§4).
     *
     * A hull with a sound core and nothing else is a ship — it can be pushed,
     * it can be run into, it is somebody's, and in a race it is a competitor —
     * so the view does not grey it for being unable to fight, or engineless
     * craft would draw as wreckage. It greys one that has *lost* the means to
     * fight, which is `isMissionKilled`.
     */
    hasControl: boolean;
    /**
     * Whether this is a piece of a ship rather than a ship: no working core, no
     * pilot, no guns. What a renderer uses to keep the arrowhead icon (§ icons)
     * standing for ships that are still flown, not for the wreckage they shed.
     */
    isDerelict: boolean;
    /**
     * Whether it is still flown but has lost every gun and engine it had, or the
     * stores to use them (`Ships.isMissionKilled`). Drawn grey and framed last,
     * with the hulks; a ship built with neither stays in its colours.
     */
    isMissionKilled: boolean;
    /**
     * Which of its mounts are out, in the design's turret order. Read from the
     * gunnery rather than worked out from `integrity`, so that a gun drawn as
     * able to shoot is one that can.
     */
    turretDisabled: boolean[];
    /** An asteroid's rock left, and the ore and ice in it, kg; absent for anything else. */
    rock?: { rock: number; ore: number; ice: number };
    /**
     * Which modules this view draws, in module order; absent or empty for all.
     * Two ships hooked together share a body and a design, and each draws only
     * its own side — in its own colours — so nothing is drawn twice.
     */
    drawn?: boolean[];
    /** The side each module came from, in module order; absent or empty for all `team`'s. */
    sides?: number[];
}

export class Snapshot {
    /** Steps elapsed, and simulated seconds. */
    tick = 0;
    time = 0;
    /** Seconds a step of the battle lasts: what a frame is exposed for. */
    dt = 0;

    /**
     * Wells acting on the battle, where they were when it was taken: a renderer
     * that cannot show why trajectories bend is showing a bug rather than a battle.
     */
    wells: WellSpec[] = [];

    ships: ShipView[] = [];
    shipCount = 0;

    /** Rounds in flight, as flat pairs so a renderer can loop without objects. */
    projectileX = new Float64Array(0);
    projectileY = new Float64Array(0);
    /** Where each round was fired or burst from. */
    projectileStartX = new Float64Array(0);
    projectileStartY = new Float64Array(0);
    projectileVx = new Float64Array(0);
    projectileVy = new Float64Array(0);
    projectileWidth = new Float64Array(0);
    /** 1 for a round passing through a hull, 0 for one in open flight. */
    projectileInside = new Uint8Array(0);
    /** The side whose ship fired it, or -1 where that ship is gone. */
    projectileTeam = new Int16Array(0);
    projectileCount = 0;

    /** Beams in flight, as flat pairs so a renderer can loop without objects. */
    beamStartX = new Float64Array(0);
    beamStartY = new Float64Array(0);
    beamEndX = new Float64Array(0);
    beamEndY = new Float64Array(0);
    beamWidth = new Float64Array(0);
    beamPower = new Float64Array(0);
    /** The side whose ship fired it, or -1 where that ship is gone. */
    beamTeam = new Int16Array(0);
    /** 1 for a plasma lance's pulse rather than a beam. */
    beamPlasma = new Uint8Array(0);
    /** How far each was fired, metres, before anything stopped it short. */
    beamReach = new Float64Array(0);
    beamCount = 0;

    /** Each body's side while a picture is taken, so a shot can be told whose it is. */
    private bodyTeam = new Int16Array(0);

    /** Every body's side, -1 for none, sized for `bodies`; filled by `capture`. */
    teamsByBody(bodies: number): Int16Array {
        if (this.bodyTeam.length < bodies) this.bodyTeam = new Int16Array(bodies * 2);
        this.bodyTeam.fill(-1);
        return this.bodyTeam;
    }

    /**
     * Impacts since the last picture: where a hit landed and what it was worth.
     *
     * Drained from the log rather than sampled, because a frame may cover
     * several steps and a hit that happened in the middle of one is still a hit
     * somebody should see.
     */
    impactX = new Float64Array(0);
    impactY = new Float64Array(0);
    impactEnergy = new Float64Array(0);
    impactKind = new Uint8Array(0);
    /** The body each landed on, and where on it, so a flash rides the hull. */
    impactBody = new Int32Array(0);
    impactLocalX = new Float64Array(0);
    impactLocalY = new Float64Array(0);
    impactVx = new Float64Array(0);
    impactVy = new Float64Array(0);
    impactGrowth = new Float64Array(0);
    /** The way each points, in its body's frame where it has one; zero for none. */
    impactDirX = new Float64Array(0);
    impactDirY = new Float64Array(0);
    /** The outward normal of the surface each met, in the same frame; zero for none. */
    impactNormalX = new Float64Array(0);
    impactNormalY = new Float64Array(0);
    /** How fast each happened, m/s: a collision's closing speed; zero for the rest. */
    impactSpeed = new Float64Array(0);
    /** The struck hull's angle and velocity as each happened; zero for none. */
    impactHullAngle = new Float64Array(0);
    impactHullVx = new Float64Array(0);
    impactHullVy = new Float64Array(0);
    impactCount = 0;

    /**
     * Lingering debris (`debris.ts`): where each bit is, which way it lies, how
     * long it is, how faded, what it is drawn from, the side whose paint is on
     * it (`UNPAINTED` for none) and how hot it still glows.
     */
    debrisX = new Float64Array(0);
    debrisY = new Float64Array(0);
    debrisAngle = new Float64Array(0);
    debrisSize = new Float64Array(0);
    debrisFade = new Float64Array(0);
    debrisSeed = new Uint32Array(0);
    debrisPaint = new Int8Array(0);
    debrisHeat = new Float64Array(0);
    debrisCount = 0;
    /** Fuel let out where a module holding it broke up (`Debris.vent`), as the debris store holds it. */
    cloudX = new Float64Array(MOST_CLOUDS);
    cloudY = new Float64Array(MOST_CLOUDS);
    cloudAge = new Float64Array(MOST_CLOUDS);
    cloudFuel = new Float64Array(MOST_CLOUDS);
    cloudFill = new Float64Array(MOST_CLOUDS);
    cloudSize = new Float64Array(MOST_CLOUDS);
    cloudSeed = new Uint32Array(MOST_CLOUDS);
    cloudCount = 0;

    /**
     * Bounding box of the *ships*, for a camera to frame.
     *
     * Only the ships. Wells are drawn but not framed: a well matters to the eye
     * while the ships are on opposite sides of it, and once they are past it,
     * holding it in shot only pushes the fight away. Projectiles are excluded
     * for a harder reason — a round that misses flies on until it expires,
     * kilometres past anything anyone is looking at, and a camera that followed
     * it would zoom out for a shot nobody cares about, shrinking the battle to a
     * few pixels exactly when it got interesting.
     */
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
}

function growProjectiles(snapshot: Snapshot, needed: number): void {
    if (snapshot.projectileX.length >= needed) return;
    const size = needed * 2;
    snapshot.projectileX = new Float64Array(size);
    snapshot.projectileY = new Float64Array(size);
    snapshot.projectileStartX = new Float64Array(size);
    snapshot.projectileStartY = new Float64Array(size);
    snapshot.projectileVx = new Float64Array(size);
    snapshot.projectileVy = new Float64Array(size);
    snapshot.projectileWidth = new Float64Array(size);
    snapshot.projectileInside = new Uint8Array(size);
    snapshot.projectileTeam = new Int16Array(size);
}

function growBeams(snapshot: Snapshot, needed: number): void {
    if (snapshot.beamStartX.length >= needed) return;
    const size = needed * 2;
    snapshot.beamStartX = new Float64Array(size);
    snapshot.beamStartY = new Float64Array(size);
    snapshot.beamEndX = new Float64Array(size);
    snapshot.beamEndY = new Float64Array(size);
    snapshot.beamWidth = new Float64Array(size);
    snapshot.beamPower = new Float64Array(size);
    snapshot.beamTeam = new Int16Array(size);
    snapshot.beamPlasma = new Uint8Array(size);
    snapshot.beamReach = new Float64Array(size);
}

function growImpacts(snapshot: Snapshot, needed: number): void {
    if (snapshot.impactX.length >= needed) return;
    const size = needed * 2;
    snapshot.impactX = new Float64Array(size);
    snapshot.impactY = new Float64Array(size);
    snapshot.impactEnergy = new Float64Array(size);
    snapshot.impactKind = new Uint8Array(size);
    snapshot.impactBody = new Int32Array(size);
    snapshot.impactLocalX = new Float64Array(size);
    snapshot.impactLocalY = new Float64Array(size);
    snapshot.impactVx = new Float64Array(size);
    snapshot.impactVy = new Float64Array(size);
    snapshot.impactGrowth = new Float64Array(size);
    snapshot.impactDirX = new Float64Array(size);
    snapshot.impactDirY = new Float64Array(size);
    snapshot.impactNormalX = new Float64Array(size);
    snapshot.impactNormalY = new Float64Array(size);
    snapshot.impactSpeed = new Float64Array(size);
    snapshot.impactHullAngle = new Float64Array(size);
    snapshot.impactHullVx = new Float64Array(size);
    snapshot.impactHullVy = new Float64Array(size);
}

function shipView(snapshot: Snapshot, i: number): ShipView {
    const existing = snapshot.ships[i];
    if (existing !== undefined) return existing;
    const created: ShipView = {
        currentStructure: null as unknown as ShipDesign,
        body: -1,
        team: 0,
        serial: 0,
        x: 0,
        y: 0,
        angle: 0,
        vx: 0,
        vy: 0,
        turretBearings: [],
        turretReady: [],
        turretAim: [],
        turretTrigger: [],
        turretTriggerReach: [],
        turretFouled: [],
        turretLoad: [],
        turretReloading: [],
        throttles: [],
        engineTriggerReach: [],
        engineFiring: [],
        plumeLayers: [],
        landed: [],
        integrity: [],
        hasControl: true,
        isDerelict: false,
        isMissionKilled: false,
        turretDisabled: [],
        drawn: [],
        sides: [],
    };
    snapshot.ships[i] = created;
    return created;
}

/** Where a ship's corner is, as `shipRoute` finds it. */
const ROUTE_SPOT = { x: 0, y: 0, vx: 0, vy: 0, radius: 0 };

/** Take a picture of the world into `out`, reusing its buffers. */
export function capture(
    out: Snapshot,
    world: World,
    ships: Ships,
    projectiles: Projectiles,
    beams: Beams,
    wells: readonly WellSpec[] = [],
    impacts?: ImpactLog,
): Snapshot {
    const bodies: Bodies = world.bodies;
    const turrets: Turrets = ships.turrets;

    out.tick = world.tick;
    out.time = world.tick * world.dt;
    out.dt = world.dt;
    // Copied, since a well on rails moves on after the picture is taken.
    out.wells.length = wells.length;
    for (let w = 0; w < wells.length; w++) {
        const well = wells[w]!;
        const into = (out.wells[w] ??= { x: 0, y: 0, gm: 0 });
        into.x = well.x;
        into.y = well.y;
        into.gm = well.gm;
        into.softening = well.softening ?? 0;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    // A shot knows the body that fired it, and a body its ship's side. A body
    // two hooked enemies share is the first one's.
    const bodyTeam = out.teamsByBody(bodies.highWater);
    let n = 0;
    for (let i = 0; i < ships.highWater; i++) {
        if (!ships.isAlive(i)) continue;
        const b = bodies.indexOf(ships.body(i));
        if (b < 0) continue;
        if (bodyTeam[b] === -1) bodyTeam[b] = ships.teamOf(i);

        const design = ships.currentStructure(i);
        const view = shipView(out, n++);
        view.currentStructure = design;
        view.blueprint = ships.blueprint(i);
        view.body = b;
        view.team = ships.teamOf(i);
        view.serial = ships.serialOf(i);
        view.name = ships.nameOf(i);
        ships.coreNames(i, (view.coreNames ??= []));
        ships.coresWorking(i, (view.coresWorking ??= []));
        const fighting = ships.fightingOf(i);
        view.fighting = fighting >= 0 && ships.isAlive(fighting) ? bodies.indexOf(ships.body(fighting)) : -1;
        const held = view.fighting >= 0 ? ships.heldOrder(i) : undefined;
        if (held === undefined) {
            delete view.fightingMin;
            delete view.fightingMax;
        } else {
            view.fightingMin = held.minRange;
            view.fightingMax = held.maxRange;
        }
        const doing = ships.doingOf(i);
        if (doing === null) {
            delete view.doing;
            delete view.doingTo;
        } else {
            view.doing = doing.kind;
            view.doingTo = bodies.indexOf(ships.body(doing.target));
        }
        const covering = ships.coveringOf(i);
        view.covering = covering >= 0 ? bodies.indexOf(ships.body(covering)) : -1;
        if (covering >= 0) {
            view.coverBand = ships.coverBandOf(i, covering);
            const inner = ships.coverInnerOf(i, covering);
            if (inner > 0) view.coverInner = inner;
            else delete view.coverInner;
        } else {
            delete view.coverBand;
            delete view.coverInner;
        }
        const via = ships.viaX[i]!;
        if (via === via) {
            view.viaX = via;
            view.viaY = ships.viaY[i]!;
        } else {
            delete view.viaX;
            delete view.viaY;
        }
        const dest = ships.destX[i]!;
        if (dest === dest) {
            view.destX = dest;
            view.destY = ships.destY[i]!;
        } else {
            delete view.destX;
            delete view.destY;
        }
        const dodging = ships.dodgingOf(i);
        if (dodging >= 0) {
            view.avoiding = bodies.indexOf(ships.body(dodging));
            view.avoidRoom = ships.dodgingRoom[i];
            view.avoidX = ships.dodgingX[i];
            view.avoidY = ships.dodgingY[i];
            view.avoidTouch = ships.dodgingTouch[i];
        } else {
            delete view.avoiding;
            delete view.avoidRoom;
            delete view.avoidX;
            delete view.avoidY;
            delete view.avoidTouch;
        }
        if (shipRoute.cornerOf(ships, bodies, i, ROUTE_SPOT)) {
            view.routeX = ROUTE_SPOT.x;
            view.routeY = ROUTE_SPOT.y;
        } else {
            delete view.routeX;
            delete view.routeY;
        }
        view.ship = i;
        view.doctrine = ships.doctrineOf(i);
        const override = ships.overrideOf(i);
        if (override === undefined) delete view.override;
        else view.override = override;
        const keeps = ships.keepsOf(i);
        if (keeps === undefined) delete view.keeps;
        else view.keeps = keeps;
        const crafts = ships.craftsOf(i);
        if (crafts === undefined) delete view.crafts;
        else view.crafts = crafts;
        const given = ships.ordersOf(i);
        if (given.length === 0) delete view.orders;
        else {
            const orders = (view.orders ??= []);
            orders.length = 0;
            for (const order of given) {
                const kind =
                    order.errand ??
                    (order.flee === true
                        ? order.hide === true
                            ? "hide"
                            : "flee"
                        : order.defend === true
                          ? "defend"
                          : order.ram
                            ? "ram"
                            : "attack");
                // Docking anywhere, where doctrine has chosen to go.
                const target = order.errand !== undefined && order.target < 0 && order === given[0] ? ships.errandTarget(i) : order.target;
                const shown: OrderView = { kind, target: ships.isAlive(target) ? bodies.indexOf(ships.body(target)) : -1 };
                if (order.distance !== undefined) shown.distance = order.distance;
                if (order.speed !== undefined) shown.speed = order.speed;
                orders.push(shown);
            }
        }
        view.x = bodies.x[b]!;
        view.y = bodies.y[b]!;
        view.angle = bodies.angle[b]!;
        const core = ships.flownCore(i);
        if (core >= 0) {
            const origin = originOf(design, core);
            view.heading = view.angle + design.modules[core]!.angle - origin.design.modules[origin.module]!.angle;
        } else {
            view.heading = view.angle;
        }
        view.riding = !ships.ownsBody(i) || ships.isParked(i);
        view.vx = bodies.vx[b]!;
        view.vy = bodies.vy[b]!;
        view.hasControl = ships.hasControl(i);
        view.isDerelict = ships.isDerelict(i);
        view.isMissionKilled = ships.isMissionKilled(i);
        if (ships.isAsteroid(i)) ships.rockLeft(i, (view.rock ??= { rock: 0, ore: 0, ice: 0 }));
        else delete view.rock;

        view.turretBearings.length = design.turrets.length;
        view.turretReady.length = design.turrets.length;
        view.turretDisabled.length = design.turrets.length;
        const aim = (view.turretAim ??= []);
        const trigger = (view.turretTrigger ??= []);
        const triggerReach = (view.turretTriggerReach ??= []);
        const fouled = (view.turretFouled ??= []);
        const load = (view.turretLoad ??= []);
        const reloading = (view.turretReloading ??= []);
        const sparks = (view.turretSparks ??= []);
        aim.length = trigger.length = triggerReach.length = fouled.length = design.turrets.length;
        load.length = reloading.length = sparks.length = design.turrets.length;
        view.sparkClock = out.time;
        for (let t = 0; t < design.turrets.length; t++) {
            const ti = ships.turretIndexOf(i, t);
            view.turretBearings[t] = turrets.worldBearing(bodies, ti);
            view.turretReady[t] = turrets.readyToFire(ti);
            aim[t] = turrets.worldTrigger(bodies, ti);
            trigger[t] = turrets.triggerHalfAngle(ti);
            triggerReach[t] = ships.triggerReach(i, t);
            fouled[t] = turrets.fouled(ti);
            load[t] = ships.loadOf(i, t);
            reloading[t] = ships.isReloading(i, t);
            sparks[t] = design.modules[design.turrets[t]!.module]?.spec.kind === "plasmaLance" ? load[t]! : 0;
            view.turretDisabled[t] = ships.isTurretDisabled(i, t);
        }

        view.throttles.length = design.engines.length;
        const engineReach = (view.engineTriggerReach ??= []);
        const engineFiring = (view.engineFiring ??= []);
        engineReach.length = engineFiring.length = design.engines.length;
        for (let t = 0; t < design.engines.length; t++) {
            view.throttles[t] = ships.throttleOf(i, t);
            engineReach[t] = ships.weaponReach(i, t);
            engineFiring[t] = ships.isEngineFiring(i, t);
        }
        const plumeLayers = (view.plumeLayers ??= []);
        plumeLayers.length = design.engines.length;
        for (let t = 0; t < design.engines.length; t++) plumeLayers[t] = ships.plumeLayersOf(i, t);

        const rays = ships.landedRays(i);
        ships.robotViews(i, (view.robots ??= []));
        ships.robotsBerthed(i, (view.berthed ??= []));
        ships.robotsDocked(i, (view.docked ??= []));
        ships.robotCrews(i, (view.crews ??= []), (view.aboard ??= []), (view.builds ??= []));
        view.landed.length = rays.length;
        for (let r = 0; r < rays.length; r++) view.landed[r] = rays[r]!;

        view.integrity.length = design.modules.length;
        const fitted = (view.fitted ??= []);
        fitted.length = design.modules.length;
        for (let m = 0; m < design.modules.length; m++) {
            const fitting = fittingOf(design.modules[m]!.stats);
            fitted[m] = fitting > 0 ? 1 - ships.damage.unbuiltAt(b, m) / fitting : 1;
            view.integrity[m] = ships.damage.integrity(b, m);
        }
        ships.damage.scars.view(b, (view.scars ??= []));
        view.scarsVersion = ships.damage.scars.version(b);
        const outOfReach = (view.outOfReach ??= []);
        outOfReach.length = design.modules.length;
        for (let m = 0; m < design.modules.length; m++) outOfReach[m] = view.hasControl && !ships.inReach(i, b, m);
        const fuel = (view.fuel ??= []);
        fuel.length = design.modules.length;
        for (let m = 0; m < design.modules.length; m++) {
            const full = design.modules[m]!.stats.fuel;
            fuel[m] = full > 0 ? ships.fuel.held(b, m) / full : 1;
        }
        const metal = (view.metal ??= []);
        metal.length = design.modules.length;
        for (let m = 0; m < design.modules.length; m++) {
            const full = design.modules[m]!.stats.metal;
            metal[m] = full > 0 ? ships.metal.held(b, m) / full : 1;
        }
        const charge = (view.charge ??= []);
        charge.length = design.modules.length;
        for (let m = 0; m < design.modules.length; m++) {
            const full = design.modules[m]!.stats.charge;
            charge[m] = full > 0 ? ships.power.held(b, m) / full : 1;
        }
        const lx = (view.leakX ??= []);
        const ly = (view.leakY ??= []);
        const ldx = (view.leakDirX ??= []);
        const ldy = (view.leakDirY ??= []);
        const lw = (view.leakWidth ??= []);
        const lr = (view.leakRate ??= []);
        const la = (view.leakAge ??= []);
        const ls = (view.leakSpeed ??= []);
        const lo = (view.leakOpened ??= []);
        const lc = (view.leakClosing ??= []);
        const lf = (view.leakFloor ??= []);
        const lp = (view.leakPatched ??= []);
        const lq = (view.leakFill ??= []);
        const lm = (view.leakModule ??= []);
        const lz = (view.leakClosed ??= []);
        lx.length = ly.length = ldx.length = ldy.length = lw.length = lr.length = la.length = ls.length = 0;
        lo.length = lc.length = lf.length = lp.length = lq.length = lm.length = lz.length = 0;
        if (ships.ownsBody(i)) {
            for (const leak of ships.fuel.leaksOf(b)) {
                // Until its scratches have faded, once patched; for good, if not.
                if (leak.patched >= 0 && leak.age - leak.patched >= LEAK_SCRATCH_FADE && !venting(leak)) continue;
                const m = design.modules[leak.module];
                if (m === undefined) continue;
                const c = cos(m.angle);
                const s = sin(m.angle);
                lx.push(m.x + leak.x * c - leak.y * s);
                ly.push(m.y + leak.x * s + leak.y * c);
                ldx.push(leak.nx * c - leak.ny * s);
                ldy.push(leak.nx * s + leak.ny * c);
                lw.push(leak.width);
                lr.push(leak.rate);
                la.push(leak.age);
                const fill = ships.fuel.fill(b, leak.module);
                ls.push(leakSpeed(fill));
                lo.push(leak.opened);
                lc.push(leak.liningClosing);
                lf.push(leak.liningFloor);
                lp.push(leak.patched);
                lq.push(fill);
                lm.push(leak.module);
                lz.push(leak.closed);
            }
        }
        const drawn = (view.drawn ??= []);
        drawn.length = design.modules.length;
        for (let m = 0; m < design.modules.length; m++) drawn[m] = ships.draws(i, m);
        const sides = (view.sides ??= []);
        sides.length = design.modules.length;
        for (let m = 0; m < design.modules.length; m++) sides[m] = ships.moduleSide(i, m);

        // Only the ships still in the fight are framed: a camera that kept
        // wreckage in shot would pull away from the battle to hold on it.
        if (view.hasControl && !view.isMissionKilled) {
            const r = design.radius;
            if (view.x - r < minX) minX = view.x - r;
            if (view.y - r < minY) minY = view.y - r;
            if (view.x + r > maxX) maxX = view.x + r;
            if (view.y + r > maxY) maxY = view.y + r;
        }
    }
    out.shipCount = n;

    // Unless every one of them is wreckage, in which case the wreckage is the
    // battle and framing nothing would leave the camera with infinite bounds.
    if (n > 0 && minX === Infinity) {
        for (let i = 0; i < n; i++) {
            const view = out.ships[i]!;
            const r = view.currentStructure.radius;
            if (view.x - r < minX) minX = view.x - r;
            if (view.y - r < minY) minY = view.y - r;
            if (view.x + r > maxX) maxX = view.x + r;
            if (view.y + r > maxY) maxY = view.y + r;
        }
    }

    growProjectiles(out, projectiles.count);
    let p = 0;
    for (let i = 0; i < projectiles.highWater; i++) {
        if (projectiles.alive[i] === 0) continue;
        out.projectileX[p] = projectiles.x[i]!;
        out.projectileY[p] = projectiles.y[i]!;
        out.projectileStartX[p] = projectiles.startX[i]!;
        out.projectileStartY[p] = projectiles.startY[i]!;
        out.projectileVx[p] = projectiles.vx[i]!;
        out.projectileVy[p] = projectiles.vy[i]!;
        out.projectileWidth[p] = projectiles.width[i]!;
        out.projectileInside[p] = projectiles.inside[i] === NOT_INSIDE ? 0 : 1;
        out.projectileTeam[p] = bodyTeam[projectiles.owner[i]!] ?? -1;
        p++;
    }
    out.projectileCount = p;

    growBeams(out, beams.count);
    let b = 0;
    for (let i = 0; i < beams.highWater; i++) {
        if (beams.alive[i] === 0) continue;
        out.beamStartX[b] = beams.startX[i]!;
        out.beamStartY[b] = beams.startY[i]!;
        out.beamEndX[b] = beams.endX[i]!;
        out.beamEndY[b] = beams.endY[i]!;
        out.beamWidth[b] = beams.width[i]!;
        out.beamPower[b] = beams.power[i]!;
        out.beamTeam[b] = bodyTeam[beams.owner[i]!] ?? -1;
        out.beamPlasma[b] = beams.kind[i] === BEAM_PLASMA ? 1 : 0;
        out.beamReach[b] = beams.reach[i]!;
        b++;
    }
    out.beamCount = b;

    copyDebris(ships.debris, out);

    // Drained, not copied: every impact is shown once, whatever the frame rate.
    out.impactCount = 0;
    if (impacts !== undefined) {
        growImpacts(out, impacts.count);
        for (let i = 0; i < impacts.count; i++) {
            out.impactX[i] = impacts.x[i]!;
            out.impactY[i] = impacts.y[i]!;
            out.impactEnergy[i] = impacts.energy[i]!;
            out.impactKind[i] = impacts.kind[i]!;
            out.impactBody[i] = impacts.body[i]!;
            out.impactLocalX[i] = impacts.localX[i]!;
            out.impactLocalY[i] = impacts.localY[i]!;
            out.impactVx[i] = impacts.vx[i]!;
            out.impactVy[i] = impacts.vy[i]!;
            out.impactGrowth[i] = impacts.growth[i]!;
            out.impactDirX[i] = impacts.dirX[i]!;
            out.impactDirY[i] = impacts.dirY[i]!;
            out.impactNormalX[i] = impacts.normalX[i]!;
            out.impactNormalY[i] = impacts.normalY[i]!;
            out.impactSpeed[i] = impacts.speed[i]!;
            out.impactHullAngle[i] = impacts.hullAngle[i]!;
            out.impactHullVx[i] = impacts.hullVx[i]!;
            out.impactHullVy[i] = impacts.hullVy[i]!;
        }
        out.impactCount = impacts.count;
        impacts.clear();
        impacts.watched = true;
    }

    if (n === 0) {
        minX = minY = maxX = maxY = 0;
    }
    out.minX = minX;
    out.minY = minY;
    out.maxX = maxX;
    out.maxY = maxY;

    return out;
}

/** Copy `debris`'s bits and clouds into `out`. */
export function copyDebris(debris: Debris, out: Snapshot): void {
    if (out.debrisX.length < debris.count) {
        const size = debris.x.length;
        out.debrisX = new Float64Array(size);
        out.debrisY = new Float64Array(size);
        out.debrisAngle = new Float64Array(size);
        out.debrisSize = new Float64Array(size);
        out.debrisFade = new Float64Array(size);
        out.debrisSeed = new Uint32Array(size);
        out.debrisPaint = new Int8Array(size);
        out.debrisHeat = new Float64Array(size);
    }
    for (let i = 0; i < debris.count; i++) {
        out.debrisX[i] = debris.x[i]!;
        out.debrisY[i] = debris.y[i]!;
        out.debrisAngle[i] = debris.angle[i]!;
        out.debrisSize[i] = debris.size[i]!;
        out.debrisFade[i] = debris.fade(i);
        out.debrisSeed[i] = debris.seed[i]!;
        out.debrisPaint[i] = debris.paint[i]!;
        out.debrisHeat[i] = debris.heat(i);
    }
    out.debrisCount = debris.count;
    const clouds = debris.cloudCount;
    out.cloudX.set(debris.cloudX.subarray(0, clouds));
    out.cloudY.set(debris.cloudY.subarray(0, clouds));
    out.cloudAge.set(debris.cloudAge.subarray(0, clouds));
    out.cloudFuel.set(debris.cloudFuel.subarray(0, clouds));
    out.cloudFill.set(debris.cloudFill.subarray(0, clouds));
    out.cloudSize.set(debris.cloudSize.subarray(0, clouds));
    out.cloudSeed.set(debris.cloudSeed.subarray(0, clouds));
    out.cloudCount = clouds;
}
