import {
    Allocation,
    specificImpulse,
    readsSealing,
    robotsKept,
    fillOf,
    SEAL_REACH,
    SEAL_SPEED,
    HullPath,
    exhaustObstruction,
    firingArc,
    firingPeriod,
    shotFuel,
    barrelHalfWidth,
    braceMass,
    readsBarrelCalibres,
    inWeaponsLayer,
    math,
    AttackArcs,
    bestAttackBearings,
    designArcs,
    boxAngle,
    bodySpec,
    moduleCentre,
    moduleStats,
    layoutStats,
    statsInLayout,
    radiansToDegrees,
    hullMountGeometry,
    isHullMount,
    isWeaponMount,
    mountTraverse,
    nozzleReach,
    weaponPlumeReach,
    plumeIntensity,
    shortfall,
    engineGeometry,
    mountAccel,
    slewTime,
    TRAVERSE_TOP_RATE,
    defaultTargeting,
    nominalReach,
    resolveTargeting,
    billOf,
    ROBOT_REPAIR_RATE,
    type Bill,
    type GunStats,
    type ModuleSpec,
    type ShipDesign,
} from "../sim/index.js";
import { GunType } from "../sim/modules.js";
import { buildWork, fittingOf } from "../sim/rebuild.js";

/** A build time, in seconds, minutes or hours as reads best. */
export function buildTime(seconds: number): string {
    if (seconds < 90) return `${Math.round(seconds)} s`;
    if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
    return `${(seconds / 3600).toLocaleString("en-GB", { maximumFractionDigits: 1 })} h`;
}

const { cos, sin, max, min, TAU } = math;

/**
 * What a layout bought, in the units the simulation works in.
 *
 * Every figure here is *read* from a compiled design rather than worked out
 * again. That is the rule the editor lives or dies by: the moment this file
 * computes a mass or a thrust itself, the editor and the battle disagree about
 * the same ship, and the tool's entire value — that the picture and the
 * numbers are true — is gone. What this file is allowed to do is divide by
 * mass and convert to degrees, because an acceleration is a thing a player can
 * compare and a newton is not.
 */

/** One turret's figures, in the order the design lists its turrets. */
export interface TurretReadout {
    /** Bore, metres. */
    calibre: number;
    barrels: number;
    /** Mass of one round, kg. */
    roundMass: number;
    /** Fuel each round burns, kg: its propellant and any bursting charge. */
    shotFuel: number;
    /** Charge each shot draws, J. */
    shotEnergy: number;
    /** How far a plasma lance reaches, metres; zero for anything else. */
    plasmaReach: number;
    /** What a beam or lance delivers while it fires, watts. */
    beamPower: number;
    /** What a lance's jet kicks back with, newtons. */
    jetThrust: number;
    /** Muzzle velocity, m/s. */
    muzzleSpeed: number;
    /** Rounds per minute the mount can sustain. */
    roundsPerMinute: number;
    /** How far the mount may train off its rest bearing, degrees. */
    arcLeft: number;
    arcRight: number;
    /** Seconds to train through half a turn from rest. */
    halfTurn: number;
    /**
     * How far it will fire at the enemy its doctrine wants, metres, as its
     * firing wedge is drawn: null where the ship's size is not known.
     */
    triggerRange?: number | null;
}

/** A power, for a readout. */
export function megawatts(watts: number): string {
    return `${(watts / 1e6).toLocaleString("en-GB", { maximumFractionDigits: 2 })} MW`;
}

/** An energy, for a readout. */
export function megajoules(joules: number): string {
    return `${(joules / 1e6).toLocaleString("en-GB", { maximumFractionDigits: 1 })} MJ`;
}

export interface DesignStats {
    /** Mass as it sets out, kg — the materials the ship is made of and the fuel it starts with. */
    mass: number;
    /** Fuel aboard as it sets out, kg: its tanks, and what its cores carry, each as full as it starts. */
    fuel: number;
    /** Metal aboard as it sets out, kg: its holds, and what its cores carry, each as full as it starts. */
    metal: number;
    /** What its generators make, W. */
    generation: number;
    /** What its batteries hold when full, J, and as it sets out. */
    storage: number;
    storageAtStart: number;
    /** The most its batteries can give out together, W. */
    discharge: number;
    /** What its beams draw firing as fast as they can, W. */
    beamDraw: number;
    /** Seconds every engine could burn flat out on what it sets out with. Infinite with no engines. */
    endurance: number;
    /** What it costs, every fighter it sets out with included: the budget evolution holds it to. */
    bill: Bill;
    /**
     * Change of velocity what it sets out with buys, m/s, by the rocket equation, at the
     * exhaust velocity of all its engines burning together.
     */
    deltaV: number;
    /** Moment of inertia about the centre of mass, kg·m². */
    inertia: number;
    /** Bounding-circle radius about the centre of mass, metres. */
    radius: number;
    moduleCount: number;
    engineCount: number;
    /**
     * Linear acceleration available while holding a heading, m/s², in each of
     * the ship's four senses.
     *
     * Holding, rather than the greater figure a ship willing to spin could
     * project, because every order carries an approach angle (DESIGN.md §2) — a
     * ship that can only accelerate by tumbling cannot obey one. The difference
     * between the two is `headingCost`, and the envelope draws both.
     */
    accelFore: number;
    accelAft: number;
    accelPort: number;
    accelStarboard: number;
    /**
     * Braking, m/s², two ways: holding its main guns on a target ahead of it
     * (away from its best attack bearing), and turned to put its main thrust
     * axis against its way, as a ship that turns to burn does.
     */
    brakeHolding: number;
    brakeTurned: number;
    /** Angular acceleration available, rad/s², turning each way. */
    turnLeft: number;
    turnRight: number;
    /**
     * Whether the layout can push both ways on both axes and turn both ways. A
     * ship without it cannot hold a heading while translating, which is a design
     * error worth finding at the drawing board rather than in a battle.
     */
    fullAuthority: boolean;
    /**
     * The largest fraction of its thrust this layout gives up in order not to
     * spin, over all directions. Zero on a ship whose thrust is balanced about
     * its centre of mass in every direction it can push.
     *
     * This is the readable form of what KSP shows as a centre of thrust offset
     * from the centre of mass. It has to be a cost rather than an offset because
     * the misalignment never *becomes* a spin here: allocation is asked for zero
     * torque and trims the imbalance with whatever engines have authority
     * left. So what a badly balanced layout loses is acceleration, and it loses
     * it hardest where the trimming engines are already at full throttle.
     */
    headingCost: number;
    turrets: TurretReadout[];
    /**
     * Its main gun — the heaviest round in its main battery — and how many of
     * those rounds it sets out with metal for; null with no gun that fires them.
     */
    mainRounds: { roundMass: number; rounds: number } | null;
}

/**
 * How many rounds the gun at `module` can load from the metal its piece of
 * hull sets out with, every gun there sharing it: zero for anything that
 * fires no rounds.
 */
export function roundsAboard(design: ShipDesign, module: number): number {
    const casing = design.modules[module]?.stats.gun?.casing ?? 0;
    if (!(casing > 0)) return 0;
    const piece = design.pieces?.[module] ?? 0;
    let metal = 0;
    for (let m = 0; m < design.modules.length; m++) {
        if ((design.pieces?.[m] ?? 0) !== piece) continue;
        const { stats, spec } = design.modules[m]!;
        metal += stats.metal * fillOf(spec);
    }
    // A whisker under a whole round is still a whole round, not round-off short of one.
    return Math.floor(metal / casing + 1e-9);
}

/** The main battery's heaviest gun, and how many of its rounds the ship sets out with. */
function mainRounds(design: ShipDesign): DesignStats["mainRounds"] {
    let best = -1;
    for (const turret of design.turrets) {
        if (!turret.main || !(turret.gun.roundMass > 0)) continue;
        if (best < 0 || turret.gun.roundMass > design.turrets[best]!.gun.roundMass) best = design.turrets.indexOf(turret);
    }
    if (best < 0) return null;
    const turret = design.turrets[best]!;
    return { roundMass: turret.gun.roundMass, rounds: roundsAboard(design, turret.module) };
}

export function designStats(design: ShipDesign, envelope: Envelopes): DesignStats {
    const layout = design.engineLayout;
    // As it sets out, so a ship that starts part full shows what it really has.
    const mass = design.launchMass;
    const inertia = design.inertia;
    const trim = trimmer(design);
    // The first of its best attack bearings: where it holds its target to fight.
    const attack = bestAttackBearings(designArcs(design, new AttackArcs()), design.thrustBearing)[0]!.bearing;
    let fuel = 0;
    let metal = 0;
    let generation = 0;
    let storage = 0;
    let storageAtStart = 0;
    let discharge = 0;
    let thrust = 0;
    // Kilograms a second, every engine flat out.
    let flow = 0;
    for (const module of design.modules) {
        fuel += module.stats.fuel * fillOf(module.spec);
        metal += module.stats.metal * fillOf(module.spec);
        generation += module.stats.generation;
        storage += module.stats.charge;
        storageAtStart += module.stats.charge * fillOf(module.spec);
        discharge += module.stats.chargeRate;
        if (module.stats.exhaustVelocity > 0) {
            thrust += module.stats.thrust;
            flow += module.stats.thrust / module.stats.exhaustVelocity;
        }
    }
    const exhaust = flow > 0 ? thrust / flow : 0;

    return {
        mass,
        fuel,
        metal,
        generation,
        storage,
        storageAtStart,
        discharge,
        beamDraw: design.turrets.reduce(
            (sum, turret) =>
                sum +
                (turret.gun.type === GunType.Beam && turret.gun.cycleTime > 0
                    ? (turret.gun.beamPower * turret.gun.beamOnTime) / turret.gun.cycleTime
                    : 0),
            0,
        ),
        endurance: flow > 0 ? fuel / flow : Infinity,
        bill: billOf(design),
        deltaV: fuel > 0 && fuel < mass ? exhaust * math.log(mass / (mass - fuel)) : 0,
        inertia,
        radius: design.radius,
        moduleCount: design.modules.length,
        engineCount: design.engines.length,
        // +x is the bow and +y is to port, matching the frame the layouts are
        // drawn in.
        accelFore: trim(1, 0),
        accelAft: trim(-1, 0),
        accelPort: trim(0, 1),
        accelStarboard: trim(0, -1),
        brakeHolding: trim(-math.cos(attack), -math.sin(attack)),
        brakeTurned: trim(math.cos(design.thrustBearing), math.sin(design.thrustBearing)),
        turnLeft: layout.maxTorque(1) / inertia,
        turnRight: layout.maxTorque(-1) / inertia,
        fullAuthority: layout.hasFullAuthority(),
        headingCost: headingCost(envelope),
        mainRounds: mainRounds(design),
        turrets: design.turrets.map((turret) => {
            const gun = turret.gun;
            const mount = turret.mount;
            return {
                calibre: gun.calibre,
                barrels: gun.barrelCount,
                roundMass: gun.roundMass,
                shotFuel: shotFuel(gun),
                shotEnergy: gun.shotEnergy,
                plasmaReach: gun.plasmaReach,
                beamPower: gun.beamPower,
                jetThrust: gun.jetThrust,
                muzzleSpeed: gun.muzzleSpeed,
                roundsPerMinute: firingPeriod(gun) > 0 ? 60 / firingPeriod(gun) : 0,
                arcLeft: radiansToDegrees(mount.leftArc ?? math.PI),
                arcRight: radiansToDegrees(mount.rightArc ?? math.PI),
                halfTurn: slewTime(math.PI, mount.maxRate ?? 0, mount.maxAccel ?? 0),
            };
        }),
    };
}

/**
 * How many directions an envelope is sampled in. Smooth at the size the
 * rosette is drawn, and the holding curve costs an allocation per step per
 * direction, so this is the figure that decides what an edit costs.
 */
export const ENVELOPE_SAMPLES = 48;

/**
 * Magnitudes tried per direction when finding what a layout can hold.
 *
 * A **downward scan**, not a bisection, and the difference is not fussiness:
 * allocation is a heuristic rather than an exact solver (ROADMAP.md §12), so
 * whether a demand is met is *not* monotonic in its magnitude — the corvette's
 * diagonal is met at 6.4 m/s² and missed at 6.0. Bisection assumes monotonic
 * feasibility and would land wherever its first branch happened to send it.
 * Scanning down from the ceiling asks a well-posed question instead: the
 * largest demand this layout actually meets.
 *
 * The resolution that buys — a hundredth of the ceiling — is half a pixel at
 * the size the curve is drawn, which is the only place the answer is read.
 */
const MAGNITUDE_STEPS = 96;

/** How much of a demand may go unmet and still count as met. */
const TOLERANCE = 1e-6;

/** What one module is, on its own, rather than what it contributes to a ship. */
/** One figure about a module: one sort of thing, in units a player reads. */
export interface ReadoutRow {
    readonly name: string;
    readonly value: string;
    /** Detail for tuning rather than choosing, shown under More. */
    readonly more?: boolean;
    /** A part of the row above, as what a tank starts with is of what it holds. */
    readonly sub?: boolean;
    /** What the figure means, where its name alone does not say. */
    readonly title?: string;
}

export interface ModuleReadout {
    rows: ReadoutRow[];
    /** The gun, when the module is a turret and its geometry makes one. */
    gun: TurretReadout | null;
}

/**
 * What an assembly weighs, and what all its copies weigh together.
 *
 * Mass is the one figure that means the same thing about an assembly as it does
 * about a module: it is a sum, so a part of a ship has one. Nothing else on
 * the module panel does — capacity and armour describe a wall, hit points
 * belong to a module that can be shot off on its own, and thrust and a gun's
 * figures are about where a module points, which a bag of modules has no
 * single answer for.
 *
 * Read from `moduleStats`, the same derivation the ship totals are summed
 * from, so an assembly's mass and the change removing it would make to the ship
 * are the same number by construction.
 */
/**
 * What share of one engine's exhaust leaves the ship, for a layout the editor
 * holds as bare specs rather than as a compiled design.
 *
 * The same call the compiler makes, over the same geometry — the specs are in
 * the blueprint's own frame rather than about the centre of mass, and the
 * question is entirely relative, so the answer is the same.
 */
function exhaustEscaping(layout: readonly ModuleSpec[], index: number, rating: number): number {
    if (index < 0 || index >= layout.length) return 1;
    const stats = layoutStats(layout);
    const modules = layout.map((placed, i) => {
        // Bodies, as a compiled design holds them: an exhaust hits a barrel too.
        const spec = bodySpec(placed);
        const centre = moduleCentre(spec);
        return {
            spec,
            stats: stats[i]!,
            x: centre.x,
            y: centre.y,
            angle: boxAngle(spec),
            index: 0,
            weaponsLayer: inWeaponsLayer(spec, stats[i]!.thickness),
        };
    });
    return exhaustObstruction({ modules }, index, rating, new HullPath(), []);
}

export function assemblyMass(layout: readonly ModuleSpec[], picked: readonly number[]): number {
    let total = 0;
    // Measured in the layout rather than on their own, since a thick plate takes
    // its depth — and so its mass — from what it is welded to, which may be a
    // module outside the assembly.
    for (const index of picked) total += statsInLayout(layout, index).mass;
    return total;
}

/**
 * The selected module's own figures.
 *
 * Read from `moduleStats`, which is the same derivation the ship totals are
 * summed from, so a module's mass here and the change it makes to the ship's
 * mass are the same number by construction rather than by agreement.
 *
 * The arc a turret can train through is a property of the module's
 * *surroundings* rather than of the module, so it needs the layout the module
 * sits in. It is worked out with `firingArc` — the same call `compileBlueprint`
 * makes — rather than read off a compiled design, which would mean mapping a
 * layout index onto a design that may have dropped modules it could not
 * measure.
 */
export function moduleReadout(spec: ModuleSpec, layout: readonly ModuleSpec[] = [], index = -1, shipRadius = 0): ModuleReadout {
    // In the layout where there is one, since a thick plate's depth is its
    // neighbours' business; on its own otherwise.
    const stats = layout[index] === spec ? statsInLayout(layout, index) : moduleStats(spec);
    const n = (value: number, places: number): string => value.toLocaleString("en-GB", { maximumFractionDigits: places });
    const tonnes = (kg: number): string => `${n(kg / 1000, 2)} t`;
    const fill = fillOf(spec);
    const carries = stats.fuel > 0 || stats.metal > 0 || stats.charge > 0;
    const rows: ReadoutRow[] = [
        { name: "Mass", value: tonnes(stats.mass), ...(carries ? { title: "With what it holds, full" } : {}) },
        // Comparable only with other modules', which size and armour already show, so detail.
        { name: "Hit points", value: n(stats.hitPoints, 0), more: true },
        { name: "Armour", value: `${n(stats.wallThickness * 1000, 0)} mm` },
        {
            name: "Build",
            value: buildTime((buildWork(stats) * (stats.structureMass + fittingOf(stats))) / ROBOT_REPAIR_RATE),
            title: "For one robot",
        },
    ];
    const add = (row: ReadoutRow): void => void rows.push(row);
    // What the plan view cannot show, and what decides both the wall it carries and whether a turret can reach it.
    add({ name: "Depth", value: `${n(stats.thickness, 2)} m`, more: true });
    add({ name: "Capacity", value: `${n(stats.capacity, 1)} m²`, more: true });
    if (readsSealing(spec.kind)) {
        if (stats.lining > 0) {
            add({ name: "Seals holes to", value: `${n(stats.lining * SEAL_REACH * 1000, 0)} mm`, more: true });
            add({ name: "Seals at", value: `${n(stats.lining * SEAL_SPEED * 1000, 0)} mm/s`, more: true });
        } else add({ name: "Sealing", value: "none", title: "A hole stays open", more: true });
    }

    const load = (name: string, held: number, show: (amount: number) => string): void => {
        if (!(held > 0)) return;
        add({ name, value: show(held) });
        if (fill < 1) add({ name: "starts with", value: show(held * fill), sub: true });
    };
    load("Fuel", stats.fuel, tonnes);
    load("Metal", stats.metal, tonnes);
    load("Charge", stats.charge, megajoules);
    if (stats.charge > 0) add({ name: "Charge rate", value: megawatts(stats.chargeRate), title: "In or out" });
    if (stats.generation > 0) add({ name: "Generates", value: megawatts(stats.generation) });
    if (spec.kind === "robotBay") {
        add({ name: "Robots", value: `${stats.robots}`, title: "Berthed" });
        const moored = robotsKept(spec, stats, true);
        if (moored > stats.robots) add({ name: "while moored", value: `${moored}`, sub: true });
    }
    if (stats.pumpRate > 0) {
        const across =
            spec.kind === "pad"
                ? "Into a fighter landed on it"
                : spec.kind === "port"
                  ? "Either way across a dock"
                  : "From what its bow grips";
        add({ name: "Pump", value: `${n(stats.pumpRate, 0)} kg/s`, title: across });
    }

    if (stats.thrust > 0) {
        // An engine part-buried in its own hull hands that share of its momentum straight back, so the ship gets less
        // than the nozzle throws. Worth saying here, because the envelope cannot say which engine is paying.
        const escaping = index < 0 ? 1 : exhaustEscaping(layout, index, stats.thrust);
        add({ name: "Thrust", value: `${n((stats.thrust * escaping) / 1e6, 2)} MN` });
        if (escaping < 1) add({ name: "into the ship", value: `${n((stats.thrust * (1 - escaping)) / 1e6, 2)} MN`, sub: true });
    }
    if (stats.exhaustVelocity > 0) {
        add({ name: "Isp", value: `${n(specificImpulse(stats.exhaustVelocity), 0)} s` });
        add({ name: "Fuel use", value: `${n(stats.thrust / stats.exhaustVelocity, 1)} kg/s`, title: "Flat out" });
    }
    if (spec.kind === "engine") {
        const engine = engineGeometry(spec);
        // Its firing wedge: the part of the flame worth lighting up for.
        if (spec.weapon === true)
            add({ name: "Fires within", value: `${n(weaponPlumeReach(engine, stats.thrust), 0)} m`, title: "Of the nozzle" });
        if (stats.ringPower > 0) {
            add({ name: "Ring power", value: `${n(stats.ringPower / 1e6, 2)} MW`, title: "Flat out", more: true });
            add({ name: "Unpowered", value: `${n(engine.bellDivergence * 100, 0)}%`, title: "Of its thrust", more: true });
        }
        // What the bell is doing to the gas: whether the nozzle is worth the length it takes up.
        add({ name: "Bell half-angle", value: `${n(radiansToDegrees(engine.halfAngle), 0)}°`, more: true });
        add({ name: "Bell keeps", value: `${n(engine.divergence * 100, 0)}%`, title: "Of the thrust", more: true });
        if (engine.nozzles > 1) add({ name: "Nozzles", value: `${engine.nozzles}`, more: true });
        // How far it throws and how fiercely: the trade between one long flame and a cluster of short hot ones.
        add({ name: "Flame reach", value: `${n(nozzleReach(engine, stats.thrust), 0)} m`, title: "Flat out", more: true });
        add({ name: "Flame heat", value: `${n(plumeIntensity(engine, stats.thrust) / 1000, 1)} kW/m²`, title: "Flat out", more: true });
    }

    if (readsBarrelCalibres(spec.kind) && stats.gun !== null) {
        // How long, and what being long has cost in bracing.
        const bracing = braceMass(stats.gun);
        add({ name: "Barrel", value: `${n(stats.gun.barrelLength, 2)} m`, more: true });
        if (bracing > 0) {
            add({ name: "braced", value: `${n(stats.gun.braceLength, 2)} m`, sub: true, more: true });
            add({ name: "bracing", value: tonnes(bracing), sub: true, more: true });
        }
    }
    if (isWeaponMount(spec.kind)) {
        // What it may train through and what that machine weighs: the number traded when the first is narrowed.
        const gear = stats.traverseMass;
        add({ name: "Trains", value: `${n(radiansToDegrees(mountTraverse(spec)), 1)}°`, title: "Either way", more: true });
        add({ name: "Training gear", value: gear > 0 ? tonnes(gear) : "none", more: true });
    }
    if (isHullMount(spec.kind)) {
        // What the opening leaves it, and how much of it is already barrel.
        const mount = hullMountGeometry(spec);
        add({ name: "Opening", value: `${n(radiansToDegrees(mount.traverse), 1)}°`, title: "Either way", more: true });
        add({ name: "face filled", value: `${n(((mount.outlets * mount.outletWidth) / spec.width) * 100, 0)}%`, sub: true, more: true });
    }
    const gun = stats.gun;
    return {
        rows,
        gun:
            gun === null
                ? null
                : {
                      calibre: gun.calibre,
                      barrels: gun.barrelCount,
                      roundMass: gun.roundMass,
                      shotFuel: shotFuel(gun),
                      shotEnergy: gun.shotEnergy,
                      plasmaReach: gun.plasmaReach,
                      beamPower: gun.beamPower,
                      jetThrust: gun.jetThrust,
                      muzzleSpeed: gun.muzzleSpeed,
                      roundsPerMinute: firingPeriod(gun) > 0 ? 60 / firingPeriod(gun) : 0,
                      ...arcOf(layout, index, gun.barrelLength, barrelHalfWidth(gun)),
                      halfTurn: slewTime(math.PI, TRAVERSE_TOP_RATE, mountAccel(spec, stats)),
                      // Against what its doctrine goes after, which is sized from the
                      // ship carrying it, so it needs the ship.
                      triggerRange: shipRadius > 0 ? fireRangeOf(spec, gun, shipRadius) : null,
                  },
    };
}

/** How far a mount will fire at the enemy its doctrine wants, as its design reach is. */
function fireRangeOf(spec: ModuleSpec, gun: GunStats, shipRadius: number): number {
    const targeting = resolveTargeting(spec.targeting, defaultTargeting(spec.kind));
    return nominalReach(gun, shipRadius, targeting.preferredMass) * targeting.fireRange;
}

/** How far a mount may train either way, in degrees, given what is around it. */
function arcOf(layout: readonly ModuleSpec[], index: number, reach: number, width: number): { arcLeft: number; arcRight: number } {
    if (index < 0 || layout[index] === undefined) return { arcLeft: 0, arcRight: 0 };
    // The compiler's rule: a hull mount's barrel is fouled by anything, a
    // turret's only by what is in the weapons layer.
    const hull = isHullMount(layout[index]!.kind);
    // Measured in the layout, so a plate that is thick by borrowing the depth of
    // the module it covers is in a turret's way here as it is in a battle.
    const depths = hull ? [] : layoutStats(layout);
    const raised = (spec: ModuleSpec, i: number): boolean => inWeaponsLayer(spec, depths[i]!.thickness);
    const arc = firingArc(layout, index, reach, hull ? undefined : raised, hull ? 0 : width);
    // A hull mount is held to its own opening as well as to what the ship
    // leaves it, and the panel has to say the number the ship will actually
    // train through rather than the more generous of the two.
    const spec = layout[index]!;
    const own = isHullMount(spec.kind) ? hullMountGeometry(spec).traverse : Infinity;
    return {
        arcLeft: radiansToDegrees(min(arc.left, own)),
        arcRight: radiansToDegrees(min(arc.right, own)),
    };
}

/** Both manoeuvring envelopes, sampled in the same directions. */
export interface Envelopes {
    /** Directions sampled, evenly around the circle from the bow, anticlockwise. */
    readonly samples: number;
    /**
     * The most acceleration a direction can be given, whatever that does to the
     * heading, m/s². Exact rather than searched: the achievable wrenches are a
     * zonotope, so `EngineLayout.support` is a supporting plane of it.
     */
    readonly free: Float64Array;
    /** What the ship can actually use while holding its heading, m/s². */
    readonly holding: Float64Array;
}

/**
 * The largest acceleration this design achieves in a direction with no net
 * torque — measured through the allocator the ship flies with.
 *
 * Through the allocator rather than as a linear program, deliberately. An LP
 * would report what an ideal ship could do; this reports what this one does,
 * which is the more useful answer and the only one that can go wrong in the
 * same way a battle does. It also means a dent in the curve is evidence about
 * the allocator as well as about the layout — which is what ROADMAP.md §12
 * says it is waiting for before replacing it.
 */
function trimmer(design: ShipDesign): (dirX: number, dirY: number) => number {
    const layout = design.engineLayout;
    const throttles = new Float64Array(design.engines.length);
    const result = new Allocation();

    return (dirX, dirY) => {
        const ceiling = layout.maxThrustAlong(dirX, dirY) / design.mass;
        if (!(ceiling > 0)) return 0;
        for (let step = MAGNITUDE_STEPS; step > 0; step--) {
            const accel = (ceiling * step) / MAGNITUDE_STEPS;
            const fx = accel * design.mass * dirX;
            const fy = accel * design.mass * dirY;
            layout.allocate(fx, fy, 0, throttles, result);
            if (shortfall(fx, fy, 0, result) < TOLERANCE) return accel;
        }
        return 0;
    };
}

/**
 * How each engine is throttled to push hardest at `angle` (radians from the
 * bow, anticlockwise, ship frame) without turning the ship: the point the
 * holding curve reaches in that direction, as the throttles that reach it. All
 * zero where the layout cannot push that way at all without spinning.
 */
export function holdingThrottles(design: ShipDesign, angle: number): Float64Array {
    const layout = design.engineLayout;
    const throttles = new Float64Array(design.engines.length);
    const result = new Allocation();
    const dirX = cos(angle);
    const dirY = sin(angle);
    const ceiling = layout.maxThrustAlong(dirX, dirY) / design.mass;
    if (!(ceiling > 0)) return throttles;
    for (let step = MAGNITUDE_STEPS; step > 0; step--) {
        const accel = (ceiling * step) / MAGNITUDE_STEPS;
        const fx = accel * design.mass * dirX;
        const fy = accel * design.mass * dirY;
        layout.allocate(fx, fy, 0, throttles, result);
        if (shortfall(fx, fy, 0, result) < TOLERANCE) return throttles;
    }
    throttles.fill(0);
    return throttles;
}

/**
 * The throttles the battle would burn to accelerate at `acceleration` along
 * `angle` without turning: its own allocation for that force, or, at the most
 * that holds the heading (`holding`) or beyond, `holdingThrottles`. Not those
 * scaled down: below its limits the allocator spreads a smaller push across
 * the engines differently.
 */
export function burnThrottles(design: ShipDesign, angle: number, acceleration: number, holding: number): Float64Array {
    if (!(acceleration < holding)) return holdingThrottles(design, angle);
    const throttles = new Float64Array(design.engines.length);
    if (!(acceleration > 0)) return throttles;
    const force = acceleration * design.mass;
    design.engineLayout.allocate(force * cos(angle), force * sin(angle), 0, throttles, new Allocation());
    return throttles;
}

/**
 * Both curves: the acceleration available in every direction, and how much of
 * it survives the requirement not to spin.
 *
 * Four numbers on a panel say a ship accelerates hard forwards and poorly
 * sideways; only the curve shows which diagonal it is worst in, and whether a
 * layout is merely weak abeam or has a direction it cannot push at all — the
 * dent that says an engine is missing. The gap between the two curves is the
 * other thing a panel cannot say: where the ship's thrust is not balanced
 * about its centre of mass, and what that costs it.
 *
 * Sampled from the bow and running anticlockwise, in the ship's own frame.
 */
export function envelopes(design: ShipDesign, samples: number = ENVELOPE_SAMPLES): Envelopes {
    const layout = design.engineLayout;
    const trim = trimmer(design);
    const free = new Float64Array(samples);
    const holding = new Float64Array(samples);
    for (let i = 0; i < samples; i++) {
        const angle = (TAU * i) / samples;
        const dirX = cos(angle);
        const dirY = sin(angle);
        free[i] = layout.support(dirX, dirY, 0) / design.mass;
        holding[i] = trim(dirX, dirY);
    }
    return { samples, free, holding };
}

/**
 * What a burn at `throttles` costs: its effective specific impulse, the net
 * thrust over the propellant it uses, so engines pushing against each other
 * count as waste, s; and seconds the fuel it sets out with lasts at it.
 */
export function burnFigures(design: ShipDesign, throttles: ArrayLike<number>): { isp: number; endurance: number } {
    let fx = 0;
    let fy = 0;
    let flow = 0;
    design.engines.forEach((engine, t) => {
        const force = (throttles[t] ?? 0) * engine.maxThrust;
        const exhaust = design.modules[engine.module ?? -1]?.stats.exhaustVelocity ?? 0;
        if (!(force > 0) || !(exhaust > 0)) return;
        fx += engine.dirX * force;
        fy += engine.dirY * force;
        flow += force / exhaust;
    });
    let fuel = 0;
    for (const module of design.modules) fuel += module.stats.fuel * fillOf(module.spec);
    if (!(flow > 0)) return { isp: 0, endurance: Infinity };
    return { isp: specificImpulse(Math.sqrt(fx * fx + fy * fy) / flow), endurance: fuel / flow };
}

/** The holding curve at `bearing`, radians from the bow, between its samples. */
export function holdingAt(envelope: Envelopes, bearing: number): number {
    const at = ((((bearing / TAU) * envelope.samples) % envelope.samples) + envelope.samples) % envelope.samples;
    const i = Math.floor(at);
    const t = at - i;
    return envelope.holding[i % envelope.samples]! * (1 - t) + envelope.holding[(i + 1) % envelope.samples]! * t;
}

/**
 * The acceleration a point on the thrust rosette asks for: `reach` is its
 * distance from the centre over the rosette's radius, and that share of the
 * most that holds the heading on `bearing`, up to all of it at the rim. A
 * share of what that direction has rather than of the rosette's scale, so a
 * weak direction is as finely controlled as a strong one.
 */
export function pointedThrust(
    envelope: Envelopes,
    bearing: number,
    reach: number,
): { acceleration: number; holding: number; share: number } {
    const holding = holdingAt(envelope, bearing);
    const share = holding > 0 ? min(1, max(0, reach)) : 0;
    return { acceleration: share * holding, holding, share };
}

/** The worst fraction of its thrust a layout gives up in order not to spin. */
export function headingCost(envelope: Envelopes): number {
    let worst = 0;
    for (let i = 0; i < envelope.samples; i++) {
        const free = envelope.free[i]!;
        if (!(free > 0)) continue;
        worst = max(worst, 1 - envelope.holding[i]! / free);
    }
    return worst;
}

/** Metric prefixes, largest first, with what each multiplies by. */
const PREFIXES: readonly (readonly [string, number])[] = [
    ["k", 1e3],
    ["", 1],
    ["m", 1e-3],
    ["µ", 1e-6],
    ["n", 1e-9],
];

/**
 * Figures in one unit, with the metric prefix that puts the largest between 1
 * and 1000, separated by "/": `inUnits([0.0031, 0.012], "m/s²")` is
 * "3.1/12.0 mm/s²": three significant figures for the largest, and as many places for the rest.
 */
export function inUnits(values: readonly number[], unit: string): string {
    const largest = values.reduce((m, v) => max(m, Math.abs(v)), 0);
    const [prefix, scale] = !(largest > 0) ? PREFIXES[1]! : (PREFIXES.find(([, f]) => largest >= f) ?? PREFIXES[PREFIXES.length - 1]!);
    const scaled = largest / scale;
    const places = !(largest > 0) ? 0 : scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    return `${values.map((v) => (v / scale).toFixed(places)).join("/")} ${prefix}${unit}`;
}
