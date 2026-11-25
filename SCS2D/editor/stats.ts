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
    moduleProblem,
    layoutStats,
    statsInLayout,
    radiansToDegrees,
    hullMountGeometry,
    isHullMount,
    isWeaponMount,
    nozzleReach,
    weaponPlumeReach,
    plumeIntensity,
    shortfall,
    engineGeometry,
    isPressureFed,
    PRESSURE_FED_BLOCK,
    PRESSURE_FED_EXHAUST,
    PRESSURE_FED_FLOW,
    PRESSURE_FED_THROAT,
    mountAccel,
    slewTime,
    TRAVERSE_TOP_RATE,
    defaultTargeting,
    nominalReach,
    resolveTargeting,
    billOf,
    PAD_REPAIR_PER_AREA,
    ROBOT_REPAIR_RATE,
    type Bill,
    type EngineLayout,
    type GunStats,
    type ModuleSpec,
    type ShipDesign,
} from "../sim/index.js";
import { GunType, WARHEAD_SIDE_FRAGMENTS, warheadBurst, warheadReach, warheadSideGrade } from "../sim/modules.js";

/** The least grade among a warhead's side fragments: the slowest of them, as a share of the fastest. */
function leastSideGrade(fragments: number): number {
    let least = 1;
    for (let k = 0; k < WARHEAD_SIDE_FRAGMENTS / 2; k++) least = Math.min(least, warheadSideGrade(fragments, k));
    return least;
}
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
    /** Rounds per minute the mount can manage on its own: its loading, or its bank's charging. */
    roundsPerMinute: number;
    /**
     * Rounds per minute the ship's generation keeps it to, with every powered
     * weapon firing as fast as it can (`sustainedShare`); `roundsPerMinute`
     * where that is enough, or where it draws no power.
     */
    sustainedPerMinute?: number;
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

/**
 * What a weapon draws, on average, firing as fast as it can on its own, W:
 * a beam's power for its share of the cycle, a rail gun's or lance's charge a
 * shot over its period. Nothing for a gun on fuel.
 */
export function powerDraw(gun: GunStats): number {
    const period = firingPeriod(gun);
    if (!(period > 0)) return 0;
    if (gun.type === GunType.Beam) return (gun.beamPower * gun.beamOnTime) / period;
    return gun.shotEnergy / period;
}

/**
 * The share of its own rate each powered weapon of `layout` can keep up on
 * what its generators make, every one firing as fast as it can: 1 where they
 * make enough. Batteries are left out, since they only put the shortfall off;
 * so are an engine's coils, which draw only while it burns.
 */
export function sustainedShare(layout: readonly ModuleSpec[]): number {
    let generation = 0;
    let draw = 0;
    for (let k = 0; k < layout.length; k++) {
        const stats = statsInLayout(layout, k);
        generation += stats.generation;
        if (stats.gun !== null && stats.gun !== undefined) draw += powerDraw(stats.gun);
    }
    return draw > generation ? generation / draw : 1;
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
     * Seconds to turn about from rest and stop again, on full torque one way and
     * then the other, which is the same either way round. Infinity when it
     * cannot turn both ways.
     */
    turnAbout: number;
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

/**
 * Seconds to turn `angle` from rest and stop, speeding up at `start` and
 * slowing at `stop`: the swing splits where the two meet, at a top rate of
 * √(2θ·a₁a₂/(a₁+a₂)).
 */
export function turnTime(angle: number, start: number, stop: number): number {
    if (!(start > 0) || !(stop > 0)) return Infinity;
    return Math.sqrt((2 * angle * (start + stop)) / (start * stop));
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
        turnAbout: turnTime(math.PI, layout.maxTorque(1) / inertia, layout.maxTorque(-1) / inertia),
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
    /** The setting it is most directly tuned by, under which the panel shows it where that setting is offered. */
    readonly under?: string;
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
    const kept = measured(layout, picked);
    for (const index of kept.indices) if (index >= 0) total += statsInLayout(kept.layout, index).mass;
    return total;
}

/**
 * The layout with what `compileDraft` leaves out left out — modules too small
 * to measure — and where each of `indices` is in it, -1 for one left out.
 */
function measured(layout: readonly ModuleSpec[], indices: readonly number[]): { layout: readonly ModuleSpec[]; indices: number[] } {
    if (layout.every((placed) => moduleProblem(placed) === null)) return { layout, indices: [...indices] };
    const at: number[] = [];
    const kept: ModuleSpec[] = [];
    for (const placed of layout) {
        const measurable = moduleProblem(placed) === null;
        at.push(measurable ? kept.length : -1);
        if (measurable) kept.push(placed);
    }
    return { layout: kept, indices: indices.map((index) => at[index] ?? -1) };
}

/** How an engine's fuel reaches its chamber, which is most of why its Isp is what it is. */
function feedRow(spec: ModuleSpec): ReadoutRow {
    const engine = engineGeometry(spec);
    if (!isPressureFed(engine)) {
        return { name: "feed", value: "pumped", sub: true, title: "Pumps drive its fuel into the chamber, for the full flow and Isp" };
    }
    const why =
        engine.throatWidth < PRESSURE_FED_THROAT
            ? `its throat is under ${PRESSURE_FED_THROAT} m across`
            : `its machinery is under ${PRESSURE_FED_BLOCK} m long`;
    const share = (fraction: number): string => `${Math.round(fraction * 100)}%`;
    return {
        name: "feed",
        value: "pressure-fed",
        sub: true,
        title: `No room for pumps, as ${why}: tank pressure pushes the fuel through, for ${share(PRESSURE_FED_FLOW)} of the flow and ${share(PRESSURE_FED_EXHAUST)} of the Isp, but far simpler to build`,
    };
}

/**
 * How long a pad takes to build one of `fighter`, s: its whole build bill at the
 * pad's rate, which goes by its deck, given the metal and charge to build with.
 */
export function padBuildTime(pad: ModuleSpec, fighter: ShipDesign): number {
    return (billOf(fighter).build * ROBOT_REPAIR_RATE) / (PAD_REPAIR_PER_AREA * pad.length * pad.width);
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
export function moduleReadout(
    spec: ModuleSpec,
    layout: readonly ModuleSpec[] = [],
    index = -1,
    shipRadius = 0,
    /** What a pad is set to build, if it builds any. */
    builds: ShipDesign | null = null,
): ModuleReadout {
    // Shrunk past measuring, it has no figures; the problem list says why.
    if (moduleProblem(spec) !== null) return { rows: [], gun: null };
    const kept = measured(layout, [layout[index] === spec ? index : -1]);
    layout = kept.layout;
    index = kept.indices[0]!;
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
        { name: "Hit points", under: "reinforcement", value: n(stats.hitPoints, 0), more: true },
        { name: "Armour", under: "reinforcement", value: `${n(stats.wallThickness * 1000, 0)} mm` },
        {
            name: "Build time",
            value: buildTime((buildWork(stats) * (stats.structureMass + fittingOf(stats))) / ROBOT_REPAIR_RATE),
            title: "For one robot",
        },
    ];
    const add = (row: ReadoutRow): void => void rows.push(row);
    // What the plan view cannot show, and what decides both the wall it carries and whether a turret can reach it.
    add({ name: "Depth", under: "thick", value: `${n(stats.thickness, 2)} m`, more: true });
    add({ name: "Capacity", value: `${n(stats.capacity, 1)} m²`, more: true });
    if (readsSealing(spec.kind)) {
        if (stats.lining > 0) {
            add({ name: "Seals holes to", under: "sealing", value: `${n(stats.lining * SEAL_REACH * 1000, 0)} mm`, more: true });
            add({ name: "Seals at", under: "sealing", value: `${n(stats.lining * SEAL_SPEED * 1000, 0)} mm/s`, more: true });
        } else add({ name: "Sealing", under: "sealing", value: "none", title: "A hole stays open", more: true });
    }

    // A core's stores are each bought by a share of its room; another module's by its size.
    const core = spec.kind === "core";
    const load = (name: string, held: number, show: (amount: number) => string, share: string): void => {
        if (!(held > 0)) return;
        add({ name, value: show(held), ...(core ? { under: share } : {}) });
        if (fill < 1) add({ name: "starts with", value: show(held * fill), sub: true, under: "fill" });
    };
    load("Fuel", stats.fuel, tonnes, "fuelShare");
    load("Metal", stats.metal, tonnes, "holdShare");
    load("Charge", stats.charge, megajoules, "batteryShare");
    if (spec.kind === "warhead") {
        const burst = warheadBurst(spec, stats);
        add({ name: "Yield", value: megajoules(burst.energy), title: "Full: it is the fuel it holds" });
        if (burst.slugEach > 0) {
            add({
                name: "Jet at",
                under: "fragments",
                value: `${n(burst.speed, 0)} m/s`,
                title: `Its liner's fastest part, taking ${n(burst.focus * 100, 0)}% of the yield with its slug`,
            });
            add({ name: "Each", value: `${n(burst.each, 1)} kg`, sub: true });
            add({ name: "Slug at", value: `${n(burst.slugSpeed, 0)} m/s`, title: "The rest of its liner, following the jet" });
            add({ name: "Each", value: `${n(burst.slugEach, 1)} kg`, sub: true });
        } else {
            add({
                name: "Fragments at",
                under: "spread",
                value: `${n(burst.speed, 0)} m/s`,
                title: `Ahead and the same behind, taking ${n(burst.focus * 100, 0)}% of the yield between them`,
            });
            add({ name: "Each", under: "fragments", value: `${n(burst.each, 1)} kg`, sub: true });
        }
        if (burst.sideEach > 0) {
            add({
                name: "All round at",
                value: `${n(burst.sideSpeed * leastSideGrade(burst.fragments), 0)}–${n(burst.sideSpeed, 0)} m/s`,
                title: "The rest of the yield, outside its arcs, lighter and slower away from them, into whatever is near, its own ship included",
            });
        }
        if (shipRadius > 0) {
            // As a gun's "Fires within": against the size its mount wants, as far as its doctrine goes off.
            const targeting = resolveTargeting(spec.targeting, defaultTargeting(spec.kind));
            const reach = warheadReach(spec, stats, shipRadius * Math.sqrt(targeting.preferredMass > 0 ? targeting.preferredMass : 1));
            add({ name: "Goes off within", value: `${n(reach * targeting.fireRange, 0)} m`, title: "Of what its doctrine wants" });
        }
    }
    if (stats.charge > 0) add({ name: "Charge rate", value: megawatts(stats.chargeRate), title: "In or out" });
    if (stats.generation > 0) add({ name: "Generates", value: megawatts(stats.generation), ...(core ? { under: "generatorShare" } : {}) });
    if (spec.kind === "robotBay") {
        add({ name: "Robots", value: `${stats.robots}`, title: "Berthed" });
        const moored = robotsKept(spec, stats, true);
        if (moored > stats.robots) add({ name: "while moored", under: "robotsPerBerth", value: `${moored}`, sub: true });
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
    if (spec.kind === "pad" && builds !== null) {
        add({
            name: "Builds one in",
            under: "keep",
            value: buildTime(padBuildTime(spec, builds)),
            title: "A whole fighter, given the metal and charge: a bigger deck builds faster",
        });
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
        if (spec.kind === "engine") add(feedRow(spec));
        add({ name: "Fuel use", value: `${n(stats.thrust / stats.exhaustVelocity, 1)} kg/s`, title: "Flat out" });
    }
    if (spec.kind === "engine") {
        const engine = engineGeometry(spec);
        // Its firing wedge: the part of the flame worth lighting up for.
        if (spec.weapon === true)
            add({
                name: "Fires within",
                under: "weapon",
                value: `${n(weaponPlumeReach(engine, stats.thrust), 0)} m`,
                title: "Of the nozzle",
            });
        if (stats.ringPower > 0) {
            add({ name: "Ring power", under: "magnetic", value: `${n(stats.ringPower / 1e6, 2)} MW`, title: "Flat out", more: true });
            add({
                name: "Unpowered",
                under: "magnetic",
                value: `${n(engine.bellDivergence * 100, 0)}%`,
                title: "Of its thrust",
                more: true,
            });
        }
        // What the bell is doing to the gas: whether the nozzle is worth the length it takes up.
        add({ name: "Bell half-angle", under: "nozzle", value: `${n(radiansToDegrees(engine.halfAngle), 0)}°`, more: true });
        add({ name: "Bell keeps", under: "nozzle", value: `${n(engine.divergence * 100, 0)}%`, title: "Of the thrust", more: true });
        if (engine.nozzles > 1) add({ name: "Nozzles", under: "barrels", value: `${engine.nozzles}`, more: true });
        // How far it throws and how fiercely: the trade between one long flame and a cluster of short hot ones.
        add({ name: "Flame reach", under: "nozzle", value: `${n(nozzleReach(engine, stats.thrust), 0)} m`, title: "Flat out", more: true });
        add({
            name: "Flame heat",
            under: "nozzle",
            value: `${n(plumeIntensity(engine, stats.thrust) / 1000, 1)} kW/m²`,
            title: "Flat out",
            more: true,
        });
    }

    if (readsBarrelCalibres(spec.kind) && stats.gun !== null) {
        // How long, and what being long has cost in bracing.
        const bracing = braceMass(stats.gun);
        add({ name: "Barrel", under: "barrelCalibres", value: `${n(stats.gun.barrelLength, 2)} m` });
        if (bracing > 0) {
            add({ name: "Barrel braced", under: "barrelCalibres", value: `${n(stats.gun.braceLength, 2)} m`, more: true });
            add({ name: "Barrel bracing", under: "barrelCalibres", value: tonnes(bracing), more: true });
        }
    }
    if (isWeaponMount(spec.kind)) {
        // What the machine that trains it weighs: what narrowing the traverse saves.
        const gear = stats.traverseMass;
        add({ name: "Training gear", under: "traverse", value: gear > 0 ? tonnes(gear) : "none", more: true });
    }
    if (isHullMount(spec.kind)) {
        // What the opening leaves it, and how much of it is already barrel.
        const mount = hullMountGeometry(spec);
        add({ name: "Opening", under: "traverse", value: `${n(radiansToDegrees(mount.traverse), 1)}°`, title: "Either way", more: true });
        add({
            name: "face filled",
            under: "traverse",
            value: `${n(((mount.outlets * mount.outletWidth) / spec.width) * 100, 0)}%`,
            sub: true,
            more: true,
        });
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
                      ...(powerDraw(gun) > 0 && firingPeriod(gun) > 0
                          ? { sustainedPerMinute: (60 / firingPeriod(gun)) * sustainedShare(layout) }
                          : {}),
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
     * heading, m/s². Exact rather than searched: see `pushAlong`.
     */
    readonly free: Float64Array;
    /** What the ship can actually use while holding its heading, m/s². */
    readonly holding: Float64Array;
    /**
     * How much of its propellant's worth that push gets, 0 to 1: its effective
     * exhaust velocity, net thrust over propellant burnt, over its best engine's.
     * Below 1 where engines push across or against each other to hold the
     * heading, or where weaker engines carry it.
     */
    readonly efficiency: Float64Array;
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
function trimmer(design: ShipDesign, throttles = new Float64Array(design.engines.length)): (dirX: number, dirY: number) => number {
    const layout = design.engineLayout;
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
 * The curves: the acceleration available in every direction, how much of it
 * survives the requirement not to spin, and how well that push uses its fuel.
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
    const throttles = new Float64Array(design.engines.length);
    const trim = trimmer(design, throttles);
    const free = new Float64Array(samples);
    const holding = new Float64Array(samples);
    const efficiency = new Float64Array(samples);
    const best = bestExhaust(design);
    for (let i = 0; i < samples; i++) {
        const angle = (TAU * i) / samples;
        const dirX = cos(angle);
        const dirY = sin(angle);
        free[i] = pushAlong(layout, dirX, dirY) / design.mass;
        holding[i] = trim(dirX, dirY);
        efficiency[i] = holding[i]! > 0 && best > 0 ? effectiveExhaust(design, throttles) / best : 0;
    }
    return { samples, free, holding, efficiency };
}

/**
 * `Envelopes.efficiency` at `share` of the holding push in every direction
 * rather than all of it: the allocator spreads a smaller push across the
 * engines differently, so a ship can be thriftier, or less so, at part thrust.
 */
export function efficiencyAtShare(design: ShipDesign, envelope: Envelopes, share: number): Float64Array {
    const out = new Float64Array(envelope.samples);
    const best = bestExhaust(design);
    if (!(best > 0) || !(share > 0)) return out;
    for (let i = 0; i < envelope.samples; i++) {
        const holding = envelope.holding[i]!;
        if (!(holding > 0)) continue;
        const throttles = burnThrottles(design, (TAU * i) / envelope.samples, share * holding, holding);
        out[i] = effectiveExhaust(design, throttles) / best;
    }
    return out;
}

/** An `Envelopes.efficiency` figure as the specific impulse it stands for, s. */
export function efficiencyIsp(design: ShipDesign, efficiency: number): number {
    return specificImpulse(efficiency * bestExhaust(design));
}

/** The fastest exhaust of any engine it has, m/s; 0 with none. */
function bestExhaust(design: ShipDesign): number {
    let best = 0;
    for (const engine of design.engines) best = max(best, design.modules[engine.module ?? -1]?.stats.exhaustVelocity ?? 0);
    return best;
}

/** Net thrust over propellant burnt at `throttles`, m/s, so engines pushing against each other count as waste; 0 burning nothing. */
function effectiveExhaust(design: ShipDesign, throttles: ArrayLike<number>): number {
    const { fx, fy, flow } = burnFlow(design, throttles);
    return flow > 0 ? Math.sqrt(fx * fx + fy * fy) / flow : 0;
}

/** The net force a burn at `throttles` makes, N, and the propellant it burns, kg/s. */
function burnFlow(design: ShipDesign, throttles: ArrayLike<number>): { fx: number; fy: number; flow: number } {
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
    return { fx, fy, flow };
}

/**
 * The greatest force a layout gives exactly along a unit direction, torque
 * aside: how far that ray runs inside the zonogon of achievable forces. Not
 * `EngineLayout.support`, which is the most force has *along* it whatever it
 * has across it, so on a diagonal it counts the main drive and a thruster
 * abeam at full together, and holding the heading looks to cost what is
 * really the push across.
 *
 * Each edge of the zonogon is parallel to an engine's force, so the ray is cut
 * by the nearest of the lines normal to one at that normal's support.
 */
export function pushAlong(layout: EngineLayout, dirX: number, dirY: number): number {
    let reach = layout.support(dirX, dirY, 0);
    for (let i = 0; i < layout.count; i++) {
        for (let sense = 1; sense >= -1; sense -= 2) {
            const nx = -layout.wfy[i]! * sense;
            const ny = layout.wfx[i]! * sense;
            const across = nx * dirX + ny * dirY;
            if (!(across > 1e-9 * Math.sqrt(nx * nx + ny * ny))) continue;
            reach = min(reach, layout.support(nx, ny, 0) / across);
        }
    }
    return reach;
}

/**
 * What a burn at `throttles` costs: its effective specific impulse, the net
 * thrust over the propellant it uses, so engines pushing against each other
 * count as waste, s; and seconds the fuel it sets out with lasts at it.
 */
export function burnFigures(design: ShipDesign, throttles: ArrayLike<number>): { isp: number; endurance: number } {
    const { fx, fy, flow } = burnFlow(design, throttles);
    let fuel = 0;
    for (const module of design.modules) fuel += module.stats.fuel * fillOf(module.spec);
    if (!(flow > 0)) return { isp: 0, endurance: Infinity };
    return { isp: specificImpulse(Math.sqrt(fx * fx + fy * fy) / flow), endurance: fuel / flow };
}

/** The holding curve at `bearing`, radians from the bow, between its samples. */
export function holdingAt(envelope: Envelopes, bearing: number): number {
    return curveAt(envelope.holding, bearing);
}

/** A curve sampled evenly round the circle from the bow, at `bearing`, between its samples. */
export function curveAt(values: Float64Array, bearing: number): number {
    const samples = values.length;
    const at = ((((bearing / TAU) * samples) % samples) + samples) % samples;
    const i = Math.floor(at);
    const t = at - i;
    return values[i % samples]! * (1 - t) + values[(i + 1) % samples]! * t;
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
