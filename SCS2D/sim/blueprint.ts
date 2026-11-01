import type { UnreadKeys } from "./unread.js";
import type { Livery, UnreadLivery } from "./livery.js";
import { abs, angleDelta, asin, atan2, cos, floor, max, min, normalizeAngle, PI, sin, sqrt, TAU } from "./math.js";
import {
    GunType,
    grownOutline,
    moduleCentre,
    bodySpec,
    moduleOutline,
    moduleProblem,
    moduleStats,
    moduleThickness,
    isHullMount,
    inWeaponsLayer,
    isThick,
    mountTraverse,
    hullMountGeometry,
    engineGeometry,
    boxAngle,
    weldBox,
    mountAccel,
    traverseRate,
    fillOf,
    blockCentre,
    needsControl,
    type GunStats,
    type ModuleSpec,
    type ModuleStats,
} from "./modules.js";
import { DEFAULT_DOCTRINE, defaultTargeting, resolveTargeting, type Doctrine, type Targeting } from "./doctrine.js";
import { EngineLayout, type EngineSpec } from "./engines.js";
import { distanceToOutline, isShaped, outlineAxes, projectOutline } from "./shape.js";
import { HullPath, moduleLayers, OWN_LAYERS, WEAPONS_LAYER } from "./hull.js";
import { exhaustObstruction, weaponPlumeReach, type PlumeSlice } from "./exhaust.js";
import type { TurretSpec } from "./turrets.js";
import { padApproaches, type PadApproach } from "./padApproach.js";

/**
 * Blueprints: a layout of modules, and what a ship built to it turns out to be.
 *
 * A blueprint is authored data — where the modules go — and says nothing about
 * how the ship performs. Compiling one derives all of that: mass and moment of
 * inertia from the modules' own geometry, the centre of mass everything is
 * measured about, the engine layout to solve allocation with, and each
 * turret's mount including the arc the ship's own superstructure leaves it.
 *
 * **Compile once per design, not once per ship.** Everything here is fixed for
 * as long as the layout is, so a hundred strike craft off the same blueprint
 * share one compiled design and one engine matrix between them (DESIGN.md
 * §4). Damage does not invalidate it: a wrecked module keeps its mass and its
 * place, so only losing an engine — or severing part of the hull — changes
 * anything derived here.
 *
 * **The centre of mass is the body's origin.** Bodies rotate about their
 * centre of mass, so a layout authored about any convenient origin is shifted
 * onto it at compile time. Doing this once here means nothing downstream —
 * engine arms, turret mounts, the renderer — has to remember to correct for
 * it, and a torque computed from a mount position is simply right.
 */

/**
 * How far two modules may run into each other before it counts as overlapping,
 * metres.
 *
 * **A few millimetres is metal, not a mistake.** Where two modules meet there
 * is a weld, and a weld is thicker than either wall — so a layout whose parts
 * interpenetrate by a hair is one where the join is a little denser, not one
 * where two compartments are trying to occupy the same space. Five millimetres
 * against modules half a metre across at the very smallest is one part in a
 * hundred, nowhere near enough to eat into what either module holds.
 *
 * Small enough to be that, and large enough to absorb arithmetic. A layout is
 * built out of sines and cosines, so faces that ought to be flush miss by
 * fractions of a micron; at a nanometre, which is what this was, an angle
 * rounded for the sake of the file tilts a module eighty nanometres into its
 * neighbour and the layout is refused. Every engine a mutation tried to bolt
 * on was lost that way.
 */
const TOUCH_TOLERANCE = 0.005;

/**
 * How close a module must be to another to count as bolted to it, metres.
 *
 * A centimetre, which is nothing at ship scale and forgiving enough that a
 * hand-edited file off by a rounding error still describes an attached ship.
 * Exact abutment is a knife edge: the authored layouts land on it only because
 * they are drawn on round numbers, and a file someone typed will not.
 *
 * This is ROADMAP.md §12's "how close counts as welded". It is a game
 * parameter rather than an implementation detail, and the layout rule and the
 * connectivity graph (`connectivity.ts`) both read this one constant rather
 * than each keeping a number of their own to drift from the other.
 */
export const ATTACHMENT_TOLERANCE = 0.01;

/**
 * A named group of modules placed as one thing, so that several copies of it
 * share a single description.
 *
 * The point is that copies cannot drift. A ship with eight identical lateral
 * engines holds one engine and eight placements of it, so making them all
 * bigger is one edit and there is no state in which seven of them are.
 *
 * An assembly of a single module is the ordinary "shared part" case, and is
 * deliberately not a separate concept — one mechanism covers a repeated
 * engine and a repeated wing, and having two would mean choosing between
 * them every time and converting between them eventually.
 *
 * Assemblies may contain instances of other assemblies, which is what makes a
 * whole mirrored ship expressible: a side is an assembly containing the wing
 * assembly, and the ship is that side placed twice.
 */
export interface Assembly {
    modules: readonly Placement[];
    /** Why this grouping exists. See `ModuleSpec.notes`. */
    notes?: string;
    /** Keys its file carried that nothing reads, kept to be written back (`UnreadKeys`). */
    unread?: UnreadKeys;
}

/**
 * One placement of an assembly: where it goes, and nothing about what it is.
 *
 * An instance deliberately cannot override any of the assembly's own values.
 * "Linked" then means *identical*, with no per-field exceptions to track and
 * no way for two copies to be almost the same. Wanting one copy different
 * means forking it into its own assembly, which is an explicit act rather than
 * a quiet divergence.
 */
export interface AssemblyInstance {
    /** Which placement this is: see `ModuleSpec.id`. */
    id?: number;
    /** Name of the assembly in the blueprint's own table. */
    use: string;
    /** Where the assembly's origin lands, in the frame doing the placing. */
    x: number;
    y: number;
    /** How far the assembly is turned, radians. */
    angle?: number;
    /** Reflect across the instance frame's own x-axis before placing it. */
    mirror?: boolean;
    /**
     * How many copies to place in a row, each `step` on from the last.
     *
     * This is what a long repeated structure is written as — a wing of six
     * identical segments is one segment and a count, so lengthening the wing is
     * one number. It replaces what would otherwise be reached for instead: an
     * assembly containing *itself*, stopped by a depth limit. Repetition says
     * the same thing more plainly, cannot make a cycle, and leaves the size of a
     * ship visible in its file rather than needing the file to be expanded to
     * find out.
     *
     * `repeat` and `step` come as a pair, since a count without a step piles
     * copies on top of one another and a step without a count does nothing.
     * Capped at `MAX_REPEAT` per instance, with `MAX_EXPANDED_MODULES` behind it
     * because nesting multiplies: sixteen levels of sixty-four would be a number
     * no cap on a single instance could catch.
     */
    repeat?: number;
    step?: AssemblyStep;
    /** Why this copy is here. See `ModuleSpec.notes`. */
    notes?: string;
    /** Keys its file carried that nothing reads, kept to be written back (`UnreadKeys`). */
    unread?: UnreadKeys;
}

/**
 * How far along to move between the copies of a repeated instance.
 *
 * Applied in each copy's *own* frame rather than the instance's, so a step
 * carrying an angle walks the copies round an arc or a spiral rather than
 * along a line — a ring of turrets costs the same as a row of them.
 */
export interface AssemblyStep {
    x: number;
    y: number;
    angle?: number;
    /** Keys its file carried that nothing reads, kept to be written back (`UnreadKeys`). */
    unread?: UnreadKeys;
}

/** Something a layout puts somewhere: a module itself, or a copy of a group. */
export type Placement = ModuleSpec | AssemblyInstance;

export function isInstance(placement: Placement): placement is AssemblyInstance {
    return "use" in placement;
}

/**
 * The blueprint with every placement an id of its own: one already unique is
 * kept, and one missing, or repeating an id met earlier, takes the next above
 * every id in it and above `above` — the highest of the version it was edited
 * from, so a placement new to this one is never given the id of one that
 * went. Walked through the layout and then each assembly in turn, so of a
 * placement and its copy the original keeps its id. The same blueprint where
 * nothing needs one.
 */
export function settleIds(blueprint: Blueprint, above = 0): Blueprint {
    const lists = [blueprint.modules, ...Object.values(blueprint.assemblies ?? {}).map((a) => a.modules)];
    const seen = new Set<number>();
    let top = above;
    let missing = false;
    for (const list of lists) {
        for (const p of list) {
            const id = p.id;
            if (id === undefined || !Number.isInteger(id) || id < 1 || seen.has(id)) missing = true;
            else seen.add(id);
            if (id !== undefined && Number.isInteger(id) && id > top) top = id;
        }
    }
    if (!missing) return blueprint;
    const kept = new Set<number>();
    const settle = (list: readonly Placement[]): Placement[] =>
        list.map((p) => {
            const id = p.id;
            if (id !== undefined && Number.isInteger(id) && id >= 1 && !kept.has(id)) {
                kept.add(id);
                return p;
            }
            return { ...p, id: ++top };
        });
    const modules = settle(blueprint.modules);
    if (blueprint.assemblies === undefined) return { ...blueprint, modules };
    const assemblies: Record<string, Assembly> = {};
    for (const [name, assembly] of Object.entries(blueprint.assemblies))
        assemblies[name] = { ...assembly, modules: settle(assembly.modules) };
    return { ...blueprint, modules, assemblies };
}

/**
 * Each module of the expanded layout's lasting name: the ids of the
 * placements down its path, and which copy of each instance it came through,
 * so the same module of two versions of a design has the same key, and the
 * copies of one written module have keys of their own. In expansion order.
 */
/** What refitting a ship built to one design to another would do (`refitPlan`). */
export interface RefitPlan {
    /** Modules of the new design's expanded layout that would be built, by index. */
    readonly built: readonly number[];
    /** Modules of the old design's expanded layout that would be taken down, as laid out there. */
    readonly takenDown: readonly ModuleSpec[];
    /** Why a ship could not be refitted to it at all (`Ships.refit`), or null. */
    readonly refused: string | null;
    /** Whether the new design has a robot bay, without which a refit to it is never finished. */
    readonly bay: boolean;
}

/**
 * What a ship built to `from` would do refitted to `to`, as `Ships.refit`
 * matches them: a module of the one with the same key in the other, laid out
 * the same, is kept, the rest of `to` built, the rest of `from` taken down.
 * Null where either cannot be laid out.
 */
export function refitPlan(from: Blueprint, to: Blueprint): RefitPlan | null {
    let was: ModuleSpec[];
    let now: ModuleSpec[];
    let wasKeys: string[];
    let nowKeys: string[];
    try {
        was = expandBlueprint(from);
        now = expandBlueprint(to);
        wasKeys = moduleKeys(from);
        nowKeys = moduleKeys(to);
    } catch {
        return null;
    }
    const kept = new Set<number>();
    const takenDown: ModuleSpec[] = [];
    const as = keptAs(
        was.map((spec, m) => ({ key: wasKeys[m], spec })),
        now.map((spec, k) => ({ key: nowKeys[k], spec })),
    );
    as.forEach((k, m) => (k >= 0 ? kept.add(k) : takenDown.push(was[m]!)));
    const built: number[] = [];
    for (let k = 0; k < now.length; k++) if (!kept.has(k)) built.push(k);
    const refused = !now.some((m) => m.kind === "core")
        ? "it has no core to be flown from"
        : kept.size === 0
          ? "it keeps nothing of the ship to build the rest against"
          : null;
    return { built, takenDown, refused, bay: now.some((m) => m.kind === "robotBay") };
}

/**
 * How much of a ship built to `from` a refit to `to` would keep, as
 * `Ships.refit` matches compiled designs: the modules kept, of how many, and
 * whether `to` has a robot bay, without which nothing would build the rest.
 * Null where it would refuse: either design without keys, or nothing of
 * `from` kept to build against.
 */
export function refitShare(from: ShipDesign, to: ShipDesign): { kept: number; of: number; bay: boolean } | null {
    const wasKeys = from.keys;
    const nowKeys = to.keys;
    if (wasKeys === undefined || nowKeys === undefined) return null;
    const as = keptAs(
        from.modules.map((module) => ({ key: wasKeys[module.index], spec: module.spec })),
        to.modules.map((module) => ({ key: nowKeys[module.index], spec: module.spec })),
    );
    const kept = as.filter((k) => k >= 0).length;
    return kept === 0 ? null : { kept, of: from.modules.length, bay: to.modules.some((m) => m.spec.kind === "robotBay") };
}

/**
 * Which module of `now` each of `was` is kept as by a refit, or -1: the one
 * with its key, laid out the same, and failing that any left laid out the
 * same, as when a placement is moved out of an assembly. A null in `was` is
 * kept as nothing.
 */
export function keptAs(
    was: readonly ({ key: string | undefined; spec: ModuleSpec } | null)[],
    now: readonly { key: string | undefined; spec: ModuleSpec }[],
): number[] {
    const byKey = new Map<string, number>();
    now.forEach((module, k) => module.key !== undefined && byKey.set(module.key, k));
    const taken = new Uint8Array(now.length);
    const as = was.map((module) => {
        const k = module?.key === undefined ? undefined : byKey.get(module.key);
        if (k === undefined || JSON.stringify(module!.spec) !== JSON.stringify(now[k]!.spec)) return -1;
        taken[k] = 1;
        return k;
    });
    const bySpec = new Map<string, number[]>();
    now.forEach((module, k) => {
        if (taken[k] === 1) return;
        const spec = JSON.stringify(module.spec);
        const list = bySpec.get(spec);
        if (list === undefined) bySpec.set(spec, [k]);
        else list.push(k);
    });
    was.forEach((module, m) => {
        if (module === null || as[m]! >= 0) return;
        const k = bySpec.get(JSON.stringify(module.spec))?.shift();
        if (k !== undefined) as[m] = k;
    });
    return as;
}

/** The highest id any placement of a blueprint has; 0 for none. */
export function topId(blueprint: Blueprint): number {
    let top = 0;
    for (const list of [blueprint.modules, ...Object.values(blueprint.assemblies ?? {}).map((a) => a.modules)]) {
        for (const p of list) if (p.id !== undefined && p.id > top) top = p.id;
    }
    return top;
}

export function moduleKeys(written: Blueprint): string[] {
    // A file with no ids reads as one given them in order, as its first edit would give them.
    const blueprint = settleIds(written);
    return expandWithOrigins(blueprint).origins.map((origin) => {
        let list = blueprint.modules;
        const parts: string[] = [];
        for (const step of origin.path) {
            const p = list[step.index]!;
            const id = String(p.id);
            if (isInstance(p)) {
                parts.push(`${id}.${step.copy}`);
                list = blueprint.assemblies![p.use]!.modules;
            } else parts.push(id);
        }
        return parts.join("/");
    });
}

/**
 * One hop down a layout, addressing an entry of a placement list.
 *
 * A path of these is how the editor names a placement: the flat list a ship is
 * built from has thrown away which assembly each module was written in, and
 * "the eighth module" is not something a player can edit, because seven of the
 * eight may be copies of one engine.
 */
export interface PathStep {
    /** Index into the placement list at this level. */
    readonly index: number;
    /** Which copy of a repeated instance this descends through; 0 otherwise. */
    readonly copy: number;
    /**
     * Present on a step that descends into an instance's assembly; absent on the
     * last step, which names a placement rather than descending through one.
     */
    readonly into?: "assembly";
    /**
     * The assembly this step descends into, when it descends into one.
     *
     * Carried because an assembly's modules are written *once* however many
     * instances place them, so which instance a path happened to arrive through
     * is not part of what it names. Without the name here, saying whether two
     * paths reach the same placement would need the blueprint to hand.
     */
    readonly assembly?: string;
}

/** Where a placement is written, from the blueprint's own module list down. */
export type ModulePath = readonly PathStep[];

/**
 * Where one expanded module came from: the placement that wrote it, and the
 * frame that placement was made in.
 *
 * The frame is what an editor needs to turn a drag into an edit. A module
 * inside a mirrored, turned assembly moves on screen along one axis and is
 * *written* along another, and the transform between the two is known here —
 * in the walk that applied it — and nowhere else.
 */
export interface ModuleOrigin {
    readonly path: ModulePath;
    /** Rotation of the placing frame, radians. */
    readonly rotation: number;
    /** Whether that frame is reflected across its own x-axis. */
    readonly mirrored: boolean;
    /**
     * The frame the innermost instance on the path was written in, or null if
     * the module was not placed through one.
     *
     * What it is for: an instance is where a *copy* of a shared part keeps its
     * own position, and moving one copy therefore means moving the instance
     * rather than the module. That edit has to be expressed in the frame the
     * instance was written in, which is one level out from the module's own.
     */
    readonly instanceFrame: Frame | null;
}

/** A placing frame: how far it is turned, and whether it is reflected. */
export interface Frame {
    readonly rotation: number;
    readonly mirrored: boolean;
}

/** A layout resolved to modules, each paired with where it was written. */
export interface Expansion {
    readonly modules: ModuleSpec[];
    /** One per module, in the same order. */
    readonly origins: ModuleOrigin[];
}

export interface Blueprint {
    name: string;
    /**
     * What the layout places. Mostly modules; an entry with a `use` is a copy of
     * one of the `assemblies` below, and `expandBlueprint` resolves it.
     */
    modules: readonly Placement[];
    /** Groups this layout places by reference. */
    assemblies?: Readonly<Record<string, Assembly>>;
    /** Why the ship is shaped this way. See `ModuleSpec.notes`. */
    notes?: string;
    /**
     * What a craft of this design does when it has no orders. Left out, it
     * fights by `DEFAULT_DOCTRINE`.
     */
    doctrine?: Doctrine;
    /**
     * A strike craft (DESIGN.md §3): it flies in the weapons layer, and takes
     * the hull layer as well only when its doctrine commits it. Ignored on a
     * ship with a turret or anything thick (`fighterProblem`).
     */
    fighter?: boolean;
    /**
     * What its pads and slipways build, by name: copies, so the file stands
     * alone, as a fleet carries its designs. Flat: what these build is found
     * here too, or is this ship, which is never one of them.
     */
    hangar?: Readonly<Record<string, Blueprint>>;
    /** How it is painted flying alone; in a fleet, the fleet's livery is worn instead. */
    livery?: Livery;
    /** A livery its file carried that could not be read, kept to write back (`readLivery`). */
    unreadLivery?: UnreadLivery;
    /** Keys its file carried that nothing reads, kept to be written back (`UnreadKeys`). */
    unread?: UnreadKeys;
    /** The same, inside its doctrine block, in the block's own shape. */
    unreadDoctrine?: UnreadKeys;
}

/** A module in a compiled design: what was authored, plus what it works out to. */
export interface DesignModule {
    readonly spec: ModuleSpec;
    readonly stats: ModuleStats;
    /**
     * Which module of the expanded layout this was.
     *
     * Not always its own position in `modules`: a draft compile leaves out what
     * it cannot measure, so the two lists part company the moment a size is
     * typed down to zero. Anything holding an index into the layout — an editor
     * pointing at the module under the cursor — needs this to find the module
     * here, and re-deriving which ones were dropped would be a second copy of
     * that rule waiting to disagree with the first.
     */
    readonly index: number;
    /** Centre of the module relative to the centre of mass, body frame. */
    readonly x: number;
    readonly y: number;
    /**
     * The angle the box is laid out at, radians, body frame (`boxAngle`): the
     * facing for every kind but an engine, whose box is laid out along the way
     * it pushes.
     */
    readonly angle: number;
    /** In the weapons layer (`inWeaponsLayer`): hit by turrets, and in their way. */
    readonly weaponsLayer: boolean;
    /** The module this one is of the design it was compiled in; absent when that is this design. */
    readonly origin?: Compiled;
    /** Present while only that module's walls are going up (`shellOf`). */
    readonly shell?: Shell;
}

/** A module of a compiled design, which is what a severed or rebuilt module still is. */
export interface Compiled {
    readonly design: ShipDesign;
    readonly module: number;
}

/** How far a module's walls are up: across `share` of it, from edge `face` of its outline. */
export interface Shell {
    readonly share: number;
    readonly face: number;
    /**
     * The whole module, laid out in this design's frame: what the walls grow
     * into while nothing of its compiled design is whole to measure it from, as
     * a fighter's core laid down on a pad.
     */
    readonly placed?: ModuleSpec;
}

/** What a module carries over from the design it was cut or welded from. */
interface Mark {
    readonly origin: Compiled;
    readonly shell?: Shell;
}

/** Where module `m` of a design was compiled. */
export function originOf(design: ShipDesign, m: number): Compiled {
    return design.modules[m]!.origin ?? { design, module: m };
}

/**
 * The ways in to pad `m` of `design`, as its compiled design worked them out:
 * none for a module that is no pad. Their angles are in the compiled design's
 * frame: `approachTurn` turns them into this one's.
 */
export function approachesOf(design: ShipDesign, m: number): PadApproach[] {
    const origin = originOf(design, m);
    return (origin.design.approaches ?? []).filter((a) => a.pad === origin.module);
}

/** How far module `m` of `design` is turned from where its compiled design has it. */
export function approachTurn(design: ShipDesign, m: number): number {
    const origin = originOf(design, m);
    return design.modules[m]!.angle - origin.design.modules[origin.module]!.angle;
}

/** Whether module `a` of one design and module `b` of another are the same module of the same compiled design. */
export function sameOrigin(da: ShipDesign, a: number, db: ShipDesign, b: number): boolean {
    const oa = da.modules[a]!.origin;
    const ob = db.modules[b]!.origin;
    return (oa?.design ?? da) === (ob?.design ?? db) && (oa?.module ?? a) === (ob?.module ?? b);
}

function markOf(design: ShipDesign, m: number): Mark {
    const shell = design.modules[m]!.shell;
    return shell === undefined ? { origin: originOf(design, m) } : { origin: originOf(design, m), shell };
}

/** A turret mount in a compiled design, ready to be added to a `Turrets` store. */
export interface DesignTurret {
    /** Index into the design's modules. */
    readonly module: number;
    /** Everything but the body it belongs to, which is only known at spawn. */
    readonly mount: Omit<TurretSpec, "owner">;
    readonly gun: GunStats;
    /** How far this mount alone is worth shooting at, metres. */
    readonly reach: number;
    /** What this mount goes after: its archetype's doctrine, with its own overrides. */
    readonly targeting: Targeting;
    /**
     * Fires in the hull layer, so hits every module rather than only weapons-layer
     * ones. A hull weapon; never a turret.
     */
    readonly hullLayer: boolean;
    /** Part of the main battery (`ModuleSpec.main`). */
    readonly main: boolean;
}

export interface ShipDesign {
    readonly name: string;
    readonly modules: readonly DesignModule[];
    /** Total mass with every store full, kg: what a body's mass is measured down from as it spends. */
    readonly mass: number;
    /** Mass as it sets out, kg: less what its stores start without (`ModuleSpec.fill`). What a budget counts. */
    readonly launchMass: number;
    /** Moment of inertia about the centre of mass, kg·m². */
    readonly inertia: number;
    /** Bounding-circle radius about the centre of mass, metres. */
    readonly radius: number;
    /** Where the centre of mass sat in the blueprint's own frame, metres. */
    readonly centreOfMassX: number;
    readonly centreOfMassY: number;
    readonly engines: readonly EngineSpec[];
    /**
     * Which of those the designer meant to point at things, as indices into
     * `engines`. Almost always empty, which is why it is a list rather than a
     * flag on each: flying a ship then costs one length check instead of a walk
     * over every engine it has.
     */
    readonly weaponEngines: readonly number[];
    /** Those of `weaponEngines` in the main battery. */
    readonly mainWeaponEngines: readonly number[];
    /** Shared by every ship built to this design. */
    readonly engineLayout: EngineLayout;
    /**
     * The way it pushes hardest, body frame, radians: its main thrust axis,
     * which it points at a target when its guns do not care which way it faces.
     * The bow for a ship with no engines.
     */
    readonly thrustBearing: number;
    readonly turrets: readonly DesignTurret[];
    /**
     * The modules that fly this ship, as indices into `modules`.
     *
     * A ship is controlled from a core, so this is what decides which piece of
     * a hull goes on being a ship when the rest comes off, and what has to be
     * shot out to leave a hulk. More than one is a design decision: a ship
     * built with two cores survives being cut between them as two ships.
     */
    readonly cores: readonly number[];
    /**
     * For each module, the cores whose reach (`ModuleStats.controlRadius`) its
     * block touches, as indices into `modules`; null for a module that needs no
     * core (`needsControl`). A module works while one of them does. Absent on a
     * design built by hand, where every module is in reach.
     */
    readonly coveredBy?: readonly (readonly number[] | null)[];
    /**
     * How far out this ship's main guns are worth using, metres.
     *
     * Derived from the guns themselves rather than configured: a round is worth
     * firing while the lead it needs is still a guess worth making, which is a
     * couple of seconds of flight, and a beam arrives instantly and is limited
     * by how long it has to be held on one spot. An engine marked as a weapon
     * counts too, for as far as its flame is worth firing. Zero for a ship with
     * neither.
     *
     * Doctrine's ranges are fractions of this, so one doctrine means the same
     * thing on a fighter and on a capital.
     */
    readonly reach: number;
    /** What a ship of this design does when it has no orders. */
    readonly doctrine: Doctrine;
    /** Flies as a strike craft: asked for, and nothing on it rules it out. */
    readonly fighter: boolean;
    /**
     * Which body each module came from, for a hull that is two or more welded
     * together (`weldDesigns`); absent for one built in one piece. Faces only
     * join within a piece: pieces are held by their seams alone.
     */
    readonly pieces?: readonly number[];
    /** Where the pieces hooked onto each other, by module index. */
    readonly seams?: readonly Seam[];
    /**
     * The pieces that were fighters when they were welded on, so a fighter
     * that lets go of a carrier's pad comes away a fighter.
     */
    readonly fighterPieces?: readonly number[];
    /** The fighters it sets out with docked on its pads. Absent for none. */
    readonly aboard?: readonly Aboard[];
    /** The ways in to each of its pads, worked out from the layout as compiled. Absent for none. */
    readonly approaches?: readonly PadApproach[];
    /** The fighters its pads build, and how many of each they keep. Absent for none. */
    readonly builds?: readonly PadBuild[];
    /** The ships its slipways build, and how many of each they keep. Absent for none. */
    readonly yards?: readonly SlipwayBuild[];
    /**
     * Each module of the expanded layout's lasting name (`moduleKeys`), by
     * `DesignModule.index`: what a refit matches one version of a design to the
     * next by. Only on a design compiled from a blueprint.
     */
    readonly keys?: readonly string[];
}

/** The part a dock is made by: a claw gripping, a pad a fighter has landed on, two ports mated, or a slipway building. */
export type DockKind = "claw" | "pad" | "port" | "slipway";

/** Which of two welded hulls, if either, holds the other, and by what. */
export interface DockAt {
    /** `a` for the first hull's module, `b` for the second's. */
    readonly at: "a" | "b";
    readonly kind: DockKind;
}

/** Two modules of different pieces, hooked together by a ragged edge or held by a dock. */
export interface Seam {
    readonly a: number;
    readonly b: number;
    /** How much edge is caught, metres: what the seam's section is cut from. */
    readonly width: number;
    /** Module `a` is a dock holding `b`, which holds harder and carries a fuel line. */
    readonly dock?: DockKind;
}

/** A seam with its modules renumbered, keeping what it is. */
function renumbered(seam: Seam, a: number, b: number): Seam {
    return seam.dock !== undefined ? { a, b, width: seam.width, dock: seam.dock } : { a, b, width: seam.width };
}

/** How welded pieces hold together, carried by a design through a sever. */
interface Joins {
    readonly pieces: readonly number[];
    readonly seams: readonly Seam[];
    /** The pieces that were fighters when they were welded on. */
    readonly fighterPieces?: readonly number[];
}

/**
 * Whether two oriented boxes overlap, by the separating-axis test.
 *
 * Boxes that merely touch do not overlap: modules are meant to abut, and a
 * layout drawn on round numbers puts their faces exactly together.
 */
export function modulesOverlap(a: ModuleSpec, b: ModuleSpec): boolean {
    const ca: number[] = [];
    const cb: number[] = [];
    return outlinesOverlap(ca, moduleOutline(a, ca), cb, moduleOutline(b, cb));
}

/** `modulesOverlap` on outlines already drawn, for a check that asks it of every pair. */
function outlinesOverlap(ca: readonly number[], countA: number, cb: readonly number[], countB: number): boolean {
    // The candidate axes are the two shapes' edge normals, which in the plane is
    // all of them. A box contributes two, since its four edges are two pairs of
    // opposites; a triangle contributes three.
    const axes: number[] = [];
    const more: number[] = [];
    const used = outlineAxes(ca, countA, axes);
    const extra = outlineAxes(cb, countB, more);
    for (let i = 0; i < extra * 2; i++) axes[used * 2 + i] = more[i]!;

    for (let i = 0; i < (used + extra) * 2; i += 2) {
        const ax = axes[i]!;
        const ay = axes[i + 1]!;
        projectOutline(ca, countA, ax, ay, spanA);
        projectOutline(cb, countB, ax, ay, spanB);
        if (spanA.lo - spanB.hi >= -TOUCH_TOLERANCE || spanB.lo - spanA.hi >= -TOUCH_TOLERANCE) {
            return false;
        }
    }
    return true;
}

/** Scratch for the separating-axis tests, so a layout check allocates less. */
const spanA = { lo: 0, hi: 0 };
const spanB = { lo: 0, hi: 0 };

/** Distance from a point to the nearest point of a module's outline, metres. */
function distanceToModule(m: ModuleSpec, px: number, py: number): number {
    m = bodySpec(m);
    if (isShaped(m)) {
        const c: number[] = [];
        return distanceToOutline(c, moduleOutline(m, c), px, py);
    }
    const a = boxAngle(m);
    const c = cos(a);
    const s = sin(a);
    const mid = moduleCentre(m);
    const dx = px - mid.x;
    const dy = py - mid.y;
    // Into the box's own frame, where the nearest point is a clamp per axis —
    // the same answer the outline gives, without walking four edges for it.
    const along = dx * c + dy * s;
    const across = -dx * s + dy * c;
    const hl = m.length * 0.5;
    const hw = m.width * 0.5;
    const outAlong = abs(along) - hl;
    const outAcross = abs(across) - hw;
    if (outAlong <= 0 && outAcross <= 0) return 0;
    const ea = max(outAlong, 0);
    const eb = max(outAcross, 0);
    return sqrt(ea * ea + eb * eb);
}

/**
 * How far a corner's bearing widens for something `pad` metres either side of
 * a line from the mount: the line clears the corner once it is `pad` off it,
 * which is the corner grown into a disc of that radius. Far corners need
 * little; one within `pad` of the mount blocks every bearing near it.
 */
function cornerMargin(pad: number, dx: number, dy: number): number {
    if (!(pad > 0)) return 0;
    const r = sqrt(dx * dx + dy * dy);
    return r <= pad ? PI : asin(pad / r);
}

/**
 * The traverse a mount has before its own ship is in the way of its barrel.
 *
 * Firing arcs are a property of the layout rather than something authored per
 * mount (DESIGN.md §3): put a gun behind the superstructure and it *is*
 * blocked, and the way to give it a better field of fire is to move it.
 *
 * What blocks is any module `blocks` admits that the barrel would sweep into:
 * within `reach`, and subtending bearings the gun would otherwise train
 * through. Each side stops at the nearest such module, since a barrel cannot
 * pass through one. Where the mount may *fire* is a separate and wider
 * question, answered by `triggerMask`.
 *
 * The test is bearing-only: a module blocks the whole sector it subtends,
 * widened by `pad` metres either side for barrels that are not a line — a
 * row of them swings as wide as its outer barrel (`barrelHalfWidth`).
 */
/**
 * Where a mount trains, in the frame its spec is written in: what its arc and
 * its trigger mask are measured about. A turret's is the middle of its box; a
 * hull gun's is the root of its barrel, since the block is welded into the
 * ship and only the barrel moves; a hull beam's is the middle of its lenses,
 * each of which turns about its own centre (`HullMountGeometry.trains`).
 */
export function mountPoint(spec: ModuleSpec): { x: number; y: number } {
    const centre = moduleCentre(spec);
    if (!isHullMount(spec.kind)) return centre;
    const trains = hullMountGeometry(spec).trains;
    const angle = boxAngle(spec);
    return { x: centre.x + cos(angle) * trains, y: centre.y + sin(angle) * trains };
}

export function firingArc(
    modules: readonly ModuleSpec[],
    index: number,
    reach: number,
    blocks: (module: ModuleSpec, index: number) => boolean = () => true,
    pad = 0,
): { left: number; right: number } {
    const mount = modules[index]!;
    const from = mountPoint(mount);
    const rest = normalizeAngle(mount.angle ?? 0);

    let left = 2 * PI;
    let right = 2 * PI;

    for (let i = 0; i < modules.length; i++) {
        if (i === index) continue;
        const other = modules[i]!;
        if (!blocks(other, i)) continue;
        const distance = distanceToModule(other, from.x, from.y);
        if (distance > sqrt(reach * reach + pad * pad)) continue;

        const c: number[] = [];
        const count = moduleOutline(other, c);

        // Bearings to the corners, taken relative to the bearing of the centre so
        // that the interval never has to be unwrapped.
        const mid = moduleCentre(other);
        const centre = atan2(mid.y - from.y, mid.x - from.x);
        let lo = 0;
        let hi = 0;
        for (let k = 0; k < count * 2; k += 2) {
            const d = angleDelta(centre, atan2(c[k + 1]! - from.y, c[k]! - from.x));
            const margin = cornerMargin(pad, c[k]! - from.x, c[k + 1]! - from.y);
            lo = min(lo, d - margin);
            hi = max(hi, d + margin);
        }

        // The rest bearing itself is inside the blocked interval: the gun is
        // buried, and there is no arc to have. Asked about the interval directly
        // rather than about the signs of the two edges, since an interval that
        // straddles dead astern has a positive edge and a negative one without
        // containing anything near the rest bearing.
        const restFromCentre = angleDelta(centre, rest);
        if (restFromCentre >= lo && restFromCentre <= hi) return { left: 0, right: 0 };

        // How far the mount can train each way before it reaches this obstruction,
        // measured as a *sweep* rather than as a signed bearing.
        //
        // That distinction is the whole of the asymmetry. A signed bearing says
        // where an edge is; a sweep says how far you must turn to get there, and
        // those differ in the direction you are turning away from. An obstruction
        // wholly off the port beam has both its edges at positive bearings, so
        // reading one of them as the starboard limit clamps a sweep that nothing
        // is in the way of — while an obstruction dead astern is genuinely reached
        // by turning either way, and this reaches it in both.
        const dLo = angleDelta(rest, centre + lo);
        const dHi = angleDelta(rest, centre + hi);
        left = min(left, dLo >= 0 ? dLo : dLo + TAU, dHi >= 0 ? dHi : dHi + TAU);
        right = min(right, dLo <= 0 ? -dLo : TAU - dLo, dHi <= 0 ? -dHi : TAU - dHi);
    }

    if (left > PI && right > PI) {
        // There is nothing preventing the turret from rotating freely,
        // call that a half in each direction instead of a whole turn in each.
        return { left: PI, right: PI };
    }

    return { left, right };
}

/**
 * The bearings a mount may point along but must not fire along, because its
 * own ship is downrange: every sector subtended by a module `blocks` admits,
 * at any distance.
 *
 * `pad` widens every sector by that many metres either side, for a shot that
 * leaves off the mount's centre line.
 *
 * Flat pairs `[start, end, …]`, radians from the rest bearing, sorted by
 * start, with each start in [-π, π) and its end after it. Overlaps are merged.
 * Compiled once: it is a property of the layout, not of a step.
 */
export function triggerMask(
    modules: readonly ModuleSpec[],
    index: number,
    blocks: (module: ModuleSpec, index: number) => boolean,
    pad = 0,
): number[] {
    const mount = modules[index]!;
    const from = mountPoint(mount);
    const rest = normalizeAngle(mount.angle ?? 0);
    const sectors: { start: number; end: number }[] = [];
    const c: number[] = [];

    for (let i = 0; i < modules.length; i++) {
        if (i === index) continue;
        const other = modules[i]!;
        if (!blocks(other, i)) continue;
        // Standing inside it: nowhere is clear.
        const distance = distanceToModule(other, from.x, from.y);
        if (distance === 0) return [-PI, PI];

        const count = moduleOutline(other, c);
        const mid = moduleCentre(other);
        const centre = atan2(mid.y - from.y, mid.x - from.x);
        let lo = 0;
        let hi = 0;
        // Widened by what a shot leaves the centre line by: an outer barrel, and
        // the width of the shot itself.
        for (let k = 0; k < count * 2; k += 2) {
            const d = angleDelta(centre, atan2(c[k + 1]! - from.y, c[k]! - from.x));
            const margin = cornerMargin(pad, c[k]! - from.x, c[k + 1]! - from.y);
            lo = min(lo, d - margin);
            hi = max(hi, d + margin);
        }
        const turned = normalizeAngle(angleDelta(rest, centre) + lo);
        const start = turned >= PI ? turned - TAU : turned;
        sectors.push({ start, end: start + (hi - lo) });
    }

    sectors.sort((a, b) => a.start - b.start);
    const out: number[] = [];
    for (const sector of sectors) {
        const last = out.length - 1;
        if (last > 0 && sector.start <= out[last]!) {
            out[last] = max(out[last]!, sector.end);
        } else {
            out.push(sector.start, sector.end);
        }
    }
    return out;
}

const everyModule = (): boolean => true;

/** How far off a mount's centre line its outer barrel's wall reaches, metres. */
export function barrelHalfWidth(gun: GunStats): number {
    // A tube is twice its calibre across, as the renderer draws it.
    return ((gun.barrelCount - 1) / 2) * gun.barrelSpacing + gun.calibre;
}

/** How far off a mount's centre line its shots may leave, metres. */
export function shotSpread(gun: GunStats): number {
    return ((gun.barrelCount - 1) / 2) * gun.barrelSpacing + gun.calibre / 2;
}

/**
 * Why a blueprint could not be built, or null if it can.
 *
 * Note what this does *not* ask: that the layout hold together. A module
 * floating clear of every other one passes, contributes its mass, and flies
 * along in formation with the ship it is not attached to. Requiring
 * connectedness means first defining what joins two modules, which §4's
 * connectivity graph needs and no blueprint currently expresses — DESIGN.md
 * §12 records the shape of that answer.
 */
/** How deep assemblies may nest. Generous for a ship, and a stop for a cycle. */
const MAX_ASSEMBLY_DEPTH = 16;

/** How many copies one instance may place. A wing, not a city. */
/**
 * How hard a gunner assumes a target might jink, m/s².
 *
 * **What sets a gun's useful reach, together with the target's effective size
 * (`lethalRadius`).**
 * Against something that does not manoeuvre, a shot is accurate at any range:
 * the solution is exact and the round simply takes a while. What spoils it is
 * the target changing its velocity after the trigger, and the spread of where
 * it might then be grows as ½·a·t² — so the shot lands while the cloud is
 * still smaller than the target, and misses once it is not. Setting the two
 * equal gives the flight time worth taking, `√(2r/a)`, and multiplying by the
 * muzzle velocity turns it into a distance.
 *
 * So a gun's reach is not a property of the gun alone. A big ship is worth
 * shooting at from much further off than a small one — twice the radius is
 * √2 the range — which is why a fighter has to close and a capital does not.
 * What counts as the target's size is `lethalRadius`, since a bursting shell
 * is allowed to miss by as much as its fragments cover.
 *
 * **It is an assumption about the class of thing being shot at rather than a
 * measurement of the target**, because a gunner cannot know what an enemy has
 * left in its engines. Ten is a little above what the shipped fleet manages
 * (a corvette makes 4.4 m/s², a TIE 12.9), which is the cautious direction:
 * assume more dodge than there is and the gun holds its fire slightly early.
 */
const EVASION_ACCEL = 10;

/**
 * How far a beam is worth using, metres.
 *
 * A beam arrives instantly at any range, so nothing about its flight limits
 * it; what limits it is having to hold the emitter on one spot long enough to
 * burn through, which gets harder the further off the target is.
 *
 * It is a hard limit rather than a preference — a mount holds its fire at
 * what lies beyond it — so it has to be generous enough to cover the fight rather than
 * tuned to where a beam is most effective. Five kilometres is twice the
 * longest a gun turret is willing to shoot at these muzzle velocities, which
 * keeps a beam mount from standing down while the guns beside it are working.
 */
const BEAM_REACH = 5000;

/**
 * How far a miss may be and still land something, metres: the target's own
 * radius for solid shot, and for a shell whatever its burst covers.
 *
 * **A bursting shell does not have to arrive at the target, only near it**,
 * which is the whole point of fusing one — so what the reach above should be
 * measured against is the burst, not the hull. Without this a gun firing at
 * something fighter-sized concludes it must be nearly on top of it, and the
 * gunship's battery holds its fire against a Dinky at ranges where its shells
 * would in fact be bursting in the fighter's lap.
 *
 * What bounds it is density rather than extent. Fragments radiate from the
 * burst, so by the time they are `m` away the `n` of them are spread around a
 * circumference of `2πm` and the gaps between them are `2πm/n`; one still
 * meets a target of radius `r` while that gap is no wider than the `2(r+w)` it
 * presents to a fragment `w` across, which is `m ≤ n(r+w)/π`. Hence the count:
 * **a shell that splits into more, smaller pieces covers more ground**, which
 * it pays for in what each one carries.
 *
 * Capped by where the fragments have actually got to by the aim point
 * (`burst.radius`, the burst speed over the fuse), since nothing can be caught
 * by a cloud that has not reached it. The cap is what stops a long fuse buying
 * reach on its own — past it a longer one only spreads the same metal thinner
 * — though it is a soft edge in truth: fragments fly on for `fragmentLife`
 * rather than stopping at the cloud's rim, so this is the conservative reading.
 *
 * Never less than the target itself: a burst is a bonus and never a penalty,
 * and against a hull bigger than the cloud it is the hull that is being aimed
 * at anyway.
 */
export function lethalRadius(gun: GunStats, targetRadius: number): number {
    const burst = gun.burst;
    if (burst === null) return targetRadius;
    const covered = (burst.fragments * (targetRadius + burst.fragmentWidth)) / PI;
    return max(targetRadius, min(covered, burst.radius));
}

/**
 * How far this gun is worth shooting at something of that size, metres.
 *
 * A ship's reach is the best of these, and a mount's own reach is this — the
 * distinction is what lets a capital hold at artillery range while its
 * close-in mounts pick targets they can actually hit.
 *
 * A beam does not travel, so nothing about a flight time bounds it and the
 * target's size does not come into it: what limits a beam is holding the
 * emitter on one spot long enough to burn through.
 */
export function reachAgainst(gun: GunStats, targetRadius: number): number {
    if (gun.type === GunType.Beam) return BEAM_REACH;
    return gun.muzzleSpeed * sqrt((2 * lethalRadius(gun, targetRadius)) / EVASION_ACCEL);
}

/**
 * How far this gun is worth shooting at **the sort of thing its doctrine goes
 * after**, metres — the figure to use when there is no target in hand.
 *
 * A pilot deciding how close to fly, and an editor drawing a ring round a
 * ship it has never fought, both need a reach before there is anything to
 * measure one against. Taking a constant for it would be inventing an enemy;
 * the doctrine has already named one, as a multiple of the chooser's own mass.
 *
 * **Mass becomes size by assuming the target is built like the ship judging
 * it**: area goes as the square of a length, so a hull of `n` times the mass
 * is `√n` times the radius. That is an approximation and worth saying so —
 * across the shipped fleet the implied constant spans a factor of three,
 * mostly because a long thin hull has a large bounding radius for its mass —
 * but it is an approximation in service of a nominal figure, and the real
 * reach is worked out against the real target wherever there is one.
 */
export function nominalReach(gun: GunStats, ownRadius: number, preferredMass: number): number {
    return reachAgainst(gun, ownRadius * sqrt(preferredMass > 0 ? preferredMass : 1));
}

export const MAX_REPEAT = 64;

/**
 * Ceiling on the modules a layout may expand to.
 *
 * The real defence, because `repeat` and nesting *multiply*: a per-instance cap
 * cannot see what its ancestors already asked for. Checked as modules are
 * produced rather than afterwards, so a runaway layout is refused rather than
 * built first and measured second.
 */
export const MAX_EXPANDED_MODULES = 1024;

/**
 * Fold an angle into (-pi, pi], and turn a negative zero into a positive one.
 *
 * Both halves matter for reasons that are entirely about floating point, and
 * both were found by the golden checksums rather than by reasoning. Mirroring
 * a module facing aft maps `PI` to `-PI`, and while those are the same
 * direction, `sin(-PI)` is `-1.2e-16` where `sin(PI)` is `+1.2e-16` — so an
 * aft engine reflected onto the far beam would compile a hair differently
 * from its unreflected twin. And `-0` compares equal to `0` while having
 * different bits, which a checksum over raw doubles notices even though
 * nothing else does.
 */
export function foldAngle(a: number): number {
    let r = normalizeAngle(a);
    if (r <= -PI) r += TAU;
    else if (r > PI) r -= TAU;
    return r === 0 ? 0 : r;
}

/**
 * Resolve a layout's assembly instances into the flat list of modules a ship
 * is actually built from.
 *
 * Everything downstream — mass, arcs, validation, the renderer — works on the
 * flat list, so assemblies are a way of *writing* a layout rather than a
 * property a compiled ship has. That is the whole reason they cost so little:
 * `ShipDesign` already is the resolved form, so this happens once, where
 * compilation already happens.
 *
 * A mirrored instance reflects across its own frame's x-axis: `y` and the
 * facing both negate. Reflecting rather than rotating is what makes a
 * starboard wing the *same* wing as the port one, so the two can never
 * disagree about anything but which side they are on.
 */
export function expandBlueprint(blueprint: Blueprint): ModuleSpec[] {
    const out: ModuleSpec[] = [];
    place(blueprint.modules, blueprint, 0, 0, 0, false, 0, out, null, [], null);
    // As the bodies they make, barrels and bells and all: what the layout rules,
    // the compiler and everything after them measure.
    return out.map(bodySpec);
}

/**
 * The same expansion, with each module paired to the placement that wrote it.
 *
 * Separate from `expandBlueprint` because everything the simulation does works
 * on the flat list and would only be paying for a second array; separate from
 * a walk of its own because a second walk is a second set of rules about
 * mirroring and repetition, and the two would drift. An editor
 * selecting a module needs to reach the *placement* — which may be one
 * engine drawn eight times — and it has to be this walk that says so.
 */
export function expandWithOrigins(blueprint: Blueprint): Expansion {
    const modules: ModuleSpec[] = [];
    const origins: ModuleOrigin[] = [];
    place(blueprint.modules, blueprint, 0, 0, 0, false, 0, modules, origins, [], null);
    return { modules, origins };
}

/**
 * Where a placement is *written*: the assembly whose definition contains it,
 * and where the path picks up inside that definition.
 *
 * Everything before the last hop into an assembly says how this copy was
 * reached, not what it is. A wing placed four times is four instances of one
 * assembly, and the modules inside it were typed once — so a path through the
 * third instance and a path through the first name the same thing.
 */
function definition(path: ModulePath): { root: string; from: number } {
    for (let i = path.length - 1; i >= 0; i--) {
        const step = path[i]!;
        if (step.into === "assembly") return { root: step.assembly ?? "", from: i + 1 };
    }
    // No hop into an assembly: the placement is written in the layout itself,
    // which is the one definition with no name.
    return { root: "", from: 0 };
}

/**
 * Whether two paths name the same placement — the same text in the file, which
 * is the thing an edit changes.
 *
 * Copies of a shared part answer true, and that is the whole point: an editor
 * that could not tell would let a player drag one wing of a mirrored pair and
 * be surprised by the other.
 */
export function samePlacement(a: ModulePath, b: ModulePath): boolean {
    const da = definition(a);
    const db = definition(b);
    if (da.root !== db.root) return false;
    if (a.length - da.from !== b.length - db.from) return false;
    for (let i = 0; i + da.from < a.length; i++) {
        const sa = a[da.from + i]!;
        const sb = b[db.from + i]!;
        if (sa.index !== sb.index || sa.into !== sb.into || sa.assembly !== sb.assembly) return false;
    }
    return true;
}

/**
 * The placement a path names, or null if the path does not lead anywhere —
 * which it will not, the moment a layout is edited under a stale selection.
 */
export function placementAt(blueprint: Blueprint, path: ModulePath): Placement | null {
    let list: readonly Placement[] = blueprint.modules;
    for (let i = 0; i < path.length; i++) {
        const step = path[i]!;
        const entry = list[step.index];
        if (entry === undefined) return null;
        if (i === path.length - 1) return entry;
        if (!isInstance(entry)) return null;
        const assembly = blueprint.assemblies?.[entry.use];
        if (assembly === undefined) return null;
        list = assembly.modules;
    }
    return null;
}

function place(
    placements: readonly Placement[],
    blueprint: Blueprint,
    originX: number,
    originY: number,
    rotation: number,
    mirrored: boolean,
    depth: number,
    out: ModuleSpec[],
    // Provenance is recorded only when someone asked for it, and the trail is
    // one array pushed and popped down the walk rather than a new one per level.
    origins: ModuleOrigin[] | null,
    trail: PathStep[],
    // The frame the instance that led here was written in — one level out from
    // this one, and null at the top, where nothing led here.
    instanceFrame: Frame | null,
): void {
    if (depth > MAX_ASSEMBLY_DEPTH) {
        throw new Error(`${blueprint.name}: assemblies nested more than ${MAX_ASSEMBLY_DEPTH} deep`);
    }

    const c = cos(rotation);
    const s = sin(rotation);

    for (let index = 0; index < placements.length; index++) {
        const placement = placements[index]!;
        // Reflect first, then turn, then move: the assembly is built in its own
        // frame and that frame is what gets placed.
        const localY = mirrored ? -placement.y : placement.y;
        const x = originX + placement.x * c - localY * s;
        const y = originY + placement.x * s + localY * c;

        if (isInstance(placement)) {
            const assembly = blueprint.assemblies?.[placement.use];
            if (assembly === undefined) {
                throw new Error(`${blueprint.name}: no assembly named ${placement.use}`);
            }
            const own = placement.angle ?? 0;
            const turned = foldAngle(rotation + (mirrored ? -own : own));
            const flipped = mirrored !== (placement.mirror ?? false);

            const copies = placement.repeat ?? 1;
            if (copies > MAX_REPEAT) {
                throw new Error(`${blueprint.name}: ${placement.use} asks for ${copies} copies, more than ${MAX_REPEAT}`);
            }

            // The step advances in the *current copy's* frame, so each copy is
            // placed relative to the one before it rather than to the instance. With
            // a step angle that walks the row round an arc; with none it is a
            // straight line either way. Reflected along with everything else, so a
            // mirrored chain runs the other way — which is what makes the far wing
            // of a ship the same wing.
            let cx = x;
            let cy = y;
            let crot = turned;
            for (let copy = 0; copy < copies; copy++) {
                // The instance is written in *this* list, so this level's frame is the
                // one an edit to its position has to be expressed in.
                const writtenIn: Frame = { rotation, mirrored };
                trail.push({ index, copy, into: "assembly", assembly: placement.use });
                place(assembly.modules, blueprint, cx, cy, crot, flipped, depth + 1, out, origins, trail, writtenIn);
                trail.pop();

                const step = placement.step;
                if (step === undefined || copy + 1 >= copies) continue;
                const sc = cos(crot);
                const ss = sin(crot);
                const stepY = flipped ? -step.y : step.y;
                const stepAngle = step.angle ?? 0;
                cx = cx + step.x * sc - stepY * ss;
                cy = cy + step.x * ss + stepY * sc;
                crot = foldAngle(crot + (flipped ? -stepAngle : stepAngle));
            }
            continue;
        }

        const spec: ModuleSpec = {
            kind: placement.kind,
            x,
            y,
            length: placement.length,
            width: placement.width,
        };
        const own = placement.angle ?? 0;
        const angle = foldAngle(rotation + (mirrored ? -own : own));
        if (angle !== 0 || placement.angle !== undefined) spec.angle = angle;
        if (placement.vertices !== undefined) {
            // A mirrored copy's corners are reflected across its own frame's x-axis,
            // exactly as its facing is: a wing's raked prow has to rake the other way
            // on the far wing. Reflecting reverses the winding, so the last two are
            // swapped back to keep every outline anticlockwise.
            spec.vertices = mirrored
                ? [
                      placement.vertices[0]!,
                      -placement.vertices[1]!,
                      placement.vertices[4]!,
                      -placement.vertices[5]!,
                      placement.vertices[2]!,
                      -placement.vertices[3]!,
                  ]
                : placement.vertices;
        }
        if (placement.reinforcement !== undefined) spec.reinforcement = placement.reinforcement;
        if (placement.barrels !== undefined) spec.barrels = placement.barrels;
        if (placement.nozzle !== undefined) spec.nozzle = placement.nozzle;
        if (placement.barrelCalibres !== undefined) spec.barrelCalibres = placement.barrelCalibres;
        if (placement.traverse !== undefined) spec.traverse = placement.traverse;
        if (placement.fuse !== undefined) spec.fuse = placement.fuse;
        if (placement.fragments !== undefined) spec.fragments = placement.fragments;
        if (placement.burstSpeed !== undefined) spec.burstSpeed = placement.burstSpeed;
        if (placement.weapon !== undefined) spec.weapon = placement.weapon;
        if (placement.main !== undefined) spec.main = placement.main;
        if (placement.thick !== undefined) spec.thick = placement.thick;
        if (placement.ore !== undefined) spec.ore = placement.ore;
        if (placement.ice !== undefined) spec.ice = placement.ice;
        if (placement.sealing !== undefined) spec.sealing = placement.sealing;
        if (placement.drainPriority !== undefined) spec.drainPriority = placement.drainPriority;
        if (placement.fill !== undefined) spec.fill = placement.fill;
        if (placement.computing !== undefined) spec.computing = placement.computing;
        if (placement.robotsPerBerth !== undefined) spec.robotsPerBerth = placement.robotsPerBerth;
        if (placement.craft !== undefined) spec.craft = placement.craft;
        if (placement.docked !== undefined) spec.docked = placement.docked;
        if (placement.keep !== undefined) spec.keep = placement.keep;
        if (placement.buildAnchored !== undefined) spec.buildAnchored = placement.buildAnchored;
        // Mirrored, a slipway lays its ship the other way round.
        if (placement.craftAngle !== undefined) spec.craftAngle = mirrored ? -placement.craftAngle : placement.craftAngle;
        if (placement.targeting !== undefined) spec.targeting = placement.targeting;
        if (placement.notes !== undefined) spec.notes = placement.notes;
        out.push(spec);
        if (origins !== null) {
            origins.push({ path: [...trail, { index, copy: 0 }], rotation, mirrored, instanceFrame });
        }
        if (out.length > MAX_EXPANDED_MODULES) {
            throw new Error(`${blueprint.name}: expands to more than ${MAX_EXPANDED_MODULES} modules`);
        }
    }
}

/**
 * Every assembly name a layout refers to but does not define, and every cycle.
 *
 * Separated from `expandBlueprint`, which throws, because a layout being
 * edited passes through states where a reference dangles and the editor has to
 * keep drawing rather than fall over.
 */
export function assemblyProblem(blueprint: Blueprint): string | null {
    const path: string[] = [];

    function walk(placements: readonly Placement[]): string | null {
        for (const placement of placements) {
            if (!isInstance(placement)) continue;
            const assembly = blueprint.assemblies?.[placement.use];
            if (assembly === undefined) {
                return `${blueprint.name}: no assembly named ${placement.use}`;
            }
            if (path.includes(placement.use)) {
                return `${blueprint.name}: assembly ${placement.use} contains itself (${[...path, placement.use].join(" -> ")})`;
            }
            path.push(placement.use);
            const problem = walk(assembly.modules);
            path.pop();
            if (problem !== null) return problem;

            const repeat = placement.repeat;
            const step = placement.step;
            if (repeat !== undefined && (!Number.isInteger(repeat) || repeat < 1)) {
                return `${blueprint.name}: ${placement.use} repeat must be a whole number of at least 1, got ${repeat}`;
            }
            if (repeat !== undefined && repeat > MAX_REPEAT) {
                return `${blueprint.name}: ${placement.use} repeat must be at most ${MAX_REPEAT}, got ${repeat}`;
            }
            // Required together. A count with no step piles every copy on the same
            // spot, which the overlap rule would then reject with a complaint about
            // geometry rather than about the mistake actually made; a step with no
            // count silently does nothing at all.
            if ((repeat !== undefined && repeat > 1) !== (step !== undefined)) {
                return `${blueprint.name}: ${placement.use} needs repeat above 1 and step together, or neither`;
            }
        }
        return null;
    }

    const problem = walk(blueprint.modules);
    if (problem !== null) return problem;

    // A layout that places nothing is a different complaint, made elsewhere.
    for (const [name, assembly] of Object.entries(blueprint.assemblies ?? {})) {
        if (assembly.modules.length === 0) return `${blueprint.name}: assembly ${name} is empty`;
    }
    return null;
}

/**
 * How wide the weld between two modules is: the length of the faces they have
 * in contact, in metres, or zero when they are not joined at all.
 *
 * By the separating-axis test, so it stays correct at any mounting angle. The
 * axis of least overlap is the one the two face each other across, and the
 * perpendicular one measures along the join. Modules within
 * `ATTACHMENT_TOLERANCE` of touching count as touching, applied half to each
 * so that the answer cannot depend on which of them was asked.
 *
 * **Contact at a corner is not a joint.** Two boxes meeting at a point share
 * no face, so this measures nothing there, and the layout rule and the
 * connectivity graph agree about it because both ask this one question. A
 * corner weld would be a joint of no width, which is not a weak joint but an
 * absent one.
 *
 * Measured about the middle of each box, which an engine's position is not:
 * growing an engine about the point it is *mounted* by would add its whole
 * skin astern and have an engine reaching towards its own exhaust.
 */
export function contactWidth(spec: ModuleSpec, other: ModuleSpec): number {
    // Only the part of each that may be welded at all, which is the whole of
    // most modules and a hull weapon's block: a barrel out in the open is not
    // somewhere to hang a ship from.
    return weldedWidth(weldBox(spec), weldBox(other));
}

/** `contactWidth` between two modules' weld boxes (`weldBox`), for a check that asks it of every pair. */
export function weldedWidth(a: ModuleSpec, b: ModuleSpec): number {
    const half = ATTACHMENT_TOLERANCE * 0.5;
    // Two boxes are measured as extents either side of their centres, which is
    // the same figure the spans give and the one a box has always been measured
    // by. A shape that is not symmetric about its own middle has no such extent,
    // so a pair with a triangle in it goes by the spans.
    const boxes = !isShaped(a) && !isShaped(b);
    const ac = moduleCentre(a);
    const bc = moduleCentre(b);
    const dx = bc.x - ac.x;
    const dy = bc.y - ac.y;
    if (boxes) {
        // Plainly out of reach of each other, by more than rounding could close:
        // most pairs in a big layout, and far cheaper to rule out than to measure.
        const reach = (sqrt(a.length * a.length + a.width * a.width) + sqrt(b.length * b.length + b.width * b.width)) * 0.5 + 2 * half;
        if (dx * dx + dy * dy > reach * reach * 1.0001 + 1e-6) return 0;
    }
    // Each grown by half the tolerance on its own faces, which is what "within
    // a hundredth of touching counts as touching" means geometrically — and
    // leaves a triangle's corners sharp rather than rounding them into
    // something a layout could then be welded by. Boxes are measured from
    // their extents instead, so need no outlines.
    const grownA: number[] = [];
    const grownB: number[] = [];
    const countA = boxes ? 0 : grownOutline(a, half, grownA);
    const countB = boxes ? 0 : grownOutline(b, half, grownB);
    const aux = cos(boxAngle(a));
    const auy = sin(boxAngle(a));
    const bux = cos(boxAngle(b));
    const buy = sin(boxAngle(b));
    const axes: number[] = [];
    let count: number;
    if (boxes) {
        // A box's normals are its facing turned, which is exactly the pair its
        // corners give and is what a box's faces have always been taken as.
        axes.push(aux, auy, -auy, aux, bux, buy, -buy, bux);
        count = 8;
    } else {
        const more: number[] = [];
        const used = outlineAxes(grownA, countA, axes);
        const extra = outlineAxes(grownB, countB, more);
        for (let i = 0; i < extra * 2; i++) axes[used * 2 + i] = more[i]!;
        count = (used + extra) * 2;
    }

    let least = Infinity;
    let nx = 0;
    let ny = 0;
    for (let k = 0; k < count; k += 2) {
        const px = axes[k]!;
        const py = axes[k + 1]!;
        const overlap = boxes
            ? boxShare(
                  a.length * 0.5 + half,
                  a.width * 0.5 + half,
                  aux,
                  auy,
                  b.length * 0.5 + half,
                  b.width * 0.5 + half,
                  bux,
                  buy,
                  dx,
                  dy,
                  px,
                  py,
              )
            : share(grownA, countA, grownB, countB, px, py);
        if (overlap <= 0) return 0;
        if (overlap < least) {
            least = overlap;
            nx = px;
            ny = py;
        }
    }

    // Along the join rather than across it, and no wider than the narrower of
    // the two: a small module welded to the middle of a big one is joined by
    // all of itself and by only part of the other. Measured on the modules
    // themselves, since the tolerance is for deciding whether there is a joint
    // and not for how much steel is in it.
    const px = -ny;
    const py = nx;
    if (boxes) {
        const ea = boxExtent(a.length * 0.5, a.width * 0.5, aux, auy, px, py);
        const eb = boxExtent(b.length * 0.5, b.width * 0.5, bux, buy, px, py);
        return weldWidth(min(ea + eb - abs(dx * px + dy * py), min(ea, eb) * 2), min(ea, eb) * 2);
    }
    // A shape's extents overlap along the join wherever it touches, a corner
    // included, so it is welded by the faces it actually has against the other.
    const ca: number[] = [];
    const cb: number[] = [];
    const realA = moduleOutline(a, ca);
    const realB = moduleOutline(b, cb);
    return faceContact(ca, realA, cb, realB);
}

/**
 * The least of the shorter of two faces in contact that makes a weld: less is
 * a corner, or a sliver of face, and holds nothing. A share of the face
 * rather than a length, so a fighter's thrusters and a capital's plates are
 * held to the same rule.
 */
export const WELD_SHARE = 0.1;

/** The narrowest contact that is not rounding, metres: two faces turned by an angle whose sine and cosine round meet by about 1e-16 m. */
const CONTACT_FLOOR = 1e-9;

/** A contact `width` along faces the shorter of which is `edge` long, or zero where it is less than `WELD_SHARE` of it. */
function weldWidth(width: number, edge: number): number {
    return width > CONTACT_FLOOR && width >= WELD_SHARE * edge - 1e-9 ? width : 0;
}

/**
 * The longest stretch of face two outlines have against each other, metres:
 * an edge of one lying along an edge of the other, facing it, no further off
 * than `ATTACHMENT_TOLERANCE`, no more than `FACE_SKEW` out of parallel, and
 * at least `WELD_SHARE` of the shorter of the two edges.
 * Two faces laid a hair out of true are in contact for as much of them as
 * lies within the tolerance. Both outlines are wound anticlockwise
 * (`moduleOutline`), so two faces in contact run opposite ways.
 */
function faceContact(ca: readonly number[], countA: number, cb: readonly number[], countB: number): number {
    let best = 0;
    for (let i = 0; i < countA; i++) {
        const px = ca[2 * i]!;
        const py = ca[2 * i + 1]!;
        const k = (i + 1) % countA;
        const ex = ca[2 * k]! - px;
        const ey = ca[2 * k + 1]! - py;
        const span = sqrt(ex * ex + ey * ey);
        if (!(span > 0)) continue;
        const ux = ex / span;
        const uy = ey / span;
        for (let j = 0; j < countB; j++) {
            const l = (j + 1) % countB;
            const qx = cb[2 * j]! - px;
            const qy = cb[2 * j + 1]! - py;
            const fx = cb[2 * l]! - px;
            const fy = cb[2 * l + 1]! - py;
            const run = sqrt((fx - qx) * (fx - qx) + (fy - qy) * (fy - qy));
            if (!(run > 0) || !((fx - qx) * ux + (fy - qy) * uy < 0)) continue;
            // How far off this one's line each end of the other's edge is.
            const d0 = qx * uy - qy * ux;
            const d1 = fx * uy - fy * ux;
            if (abs(d1 - d0) > FACE_SKEW * run) continue;
            // The stretch of it within the tolerance, as a share of the way along it.
            let t0 = 0;
            let t1 = 1;
            if (d1 !== d0) {
                const ta = (-ATTACHMENT_TOLERANCE - d0) / (d1 - d0);
                const tb = (ATTACHMENT_TOLERANCE - d0) / (d1 - d0);
                t0 = max(0, min(ta, tb));
                t1 = min(1, max(ta, tb));
            } else if (abs(d0) > ATTACHMENT_TOLERANCE) {
                continue;
            }
            if (!(t1 > t0)) continue;
            const s0 = qx * ux + qy * uy;
            const s1 = fx * ux + fy * uy;
            const from = s0 + (s1 - s0) * t0;
            const to = s0 + (s1 - s0) * t1;
            const along = weldWidth(min(span, max(from, to)) - max(0, min(from, to)), min(span, run));
            if (along > best) best = along;
        }
    }
    return best;
}

/** How far out of parallel two faces may lie and still be welded, as the sine of the angle between them: about half a degree. */
const FACE_SKEW = 0.01;

/**
 * How much of an axis two outlines both cover, metres, and negative where
 * there is daylight between them.
 *
 * Taken as the overlap of their two spans rather than as extents either side
 * of their centres, which is the same figure — and the only one of the two a
 * shape that is not symmetric about its own middle can give.
 */
function share(ca: readonly number[], countA: number, cb: readonly number[], countB: number, px: number, py: number): number {
    projectOutline(ca, countA, px, py, spanA);
    projectOutline(cb, countB, px, py, spanB);
    return min(spanA.hi, spanB.hi) - max(spanA.lo, spanB.lo);
}

/** `share` where neither module is a triangle: extents either side of a centre. */
function boxShare(
    ahl: number,
    ahw: number,
    aux: number,
    auy: number,
    bhl: number,
    bhw: number,
    bux: number,
    buy: number,
    dx: number,
    dy: number,
    px: number,
    py: number,
): number {
    return boxExtent(ahl, ahw, aux, auy, px, py) + boxExtent(bhl, bhw, bux, buy, px, py) - abs(dx * px + dy * py);
}

/** A box's extent along `(nx, ny)` from its own centre, metres. */
function boxExtent(hl: number, hw: number, ux: number, uy: number, nx: number, ny: number): number {
    // The width axis is the length axis turned a quarter turn, so its dot with
    // the probe is the cross product of the two.
    return hl * abs(ux * nx + uy * ny) + hw * abs(-uy * nx + ux * ny);
}

/**
 * Whether two modules, by their weld boxes, are bolted together: their faces
 * touching, or within the attachment tolerance of touching.
 */
function boxesAttached(a: ModuleSpec, b: ModuleSpec): boolean {
    return weldedWidth(a, b) > 0;
}

/**
 * The modules that cannot be reached from the ship's first core, as one group
 * per separate piece.
 *
 * **The ship is whatever the first core is attached to.** A core module is
 * what flies a ship, so it is the anchor the rest of a layout traces back to
 * — the real answer to "which module is the ship", where the first module in
 * the list was once a stand-in for it.
 *
 * Anchored by one core and not by all of them, deliberately, because a
 * blueprint describes **one** ship: a layout in two pieces with a core in
 * each is two ships, and is authored as two blueprints. That the pieces would
 * each fly perfectly well is exactly the point — it is why the complaint is
 * that they are separate rather than that they are adrift.
 *
 * Modules whose geometry cannot be measured are left out of the graph
 * entirely, the way `compileDraft` leaves them out of a ship: a module typed
 * down to zero size touches nothing, and reporting it as adrift as well as
 * unmeasurable is two complaints about one mistake. A layout with no
 * measurable core has no anchor at all, so nothing is adrift — the missing
 * core is the complaint, and it is made elsewhere.
 *
 * Attachment here is the same `contactWidth` the connectivity graph is built
 * from, so a layout this accepts is one that holds together once it is being
 * shot at — a ship blessed by a rule the welds disagreed with would come
 * apart at the first scratch.
 */
function detachedGroups(modules: readonly ModuleSpec[]): number[][] {
    const live: number[] = [];
    for (let i = 0; i < modules.length; i++) {
        if (moduleProblem(modules[i]!) === null) live.push(i);
    }

    const anchor = live.find((index) => modules[index]!.kind === "core");
    if (anchor === undefined) return [];
    // Each weld box, and the bounds of it grown by the tolerance, worked out
    // once: two whose grown bounds are apart cannot be touching.
    const boxes: ModuleSpec[] = [];
    const bounds: number[][] = [];
    for (const index of live) {
        const box = weldBox(modules[index]!);
        boxes[index] = box;
        const corners: number[] = [];
        const count = grownOutline(box, ATTACHMENT_TOLERANCE * 0.5, corners);
        let lx = Infinity;
        let ly = Infinity;
        let hx = -Infinity;
        let hy = -Infinity;
        for (let c = 0; c < count * 2; c += 2) {
            lx = min(lx, corners[c]!);
            hx = max(hx, corners[c]!);
            ly = min(ly, corners[c + 1]!);
            hy = max(hy, corners[c + 1]!);
        }
        bounds[index] = [lx, ly, hx, hy];
    }
    const attachedTo = (a: number, b: number): boolean => {
        const p = bounds[a]!;
        const q = bounds[b]!;
        if (p[0]! > q[2]! || q[0]! > p[2]! || p[1]! > q[3]! || q[1]! > p[3]!) return false;
        return boxesAttached(boxes[a]!, boxes[b]!);
    };

    const attached = new Set<number>([anchor]);
    const frontier = [anchor];

    while (frontier.length > 0) {
        const at = frontier.pop()!;
        for (const other of live) {
            if (attached.has(other)) continue;
            if (!attachedTo(at, other)) continue;
            attached.add(other);
            frontier.push(other);
        }
    }

    // The stragglers, gathered into the pieces they form, so that a wing that
    // came off is one complaint rather than one per module of it.
    const groups: number[][] = [];
    const placed = new Set<number>();
    for (const index of live) {
        if (attached.has(index) || placed.has(index)) continue;
        const group = [index];
        placed.add(index);
        for (let k = 0; k < group.length; k++) {
            for (const other of live) {
                if (attached.has(other) || placed.has(other)) continue;
                if (!attachedTo(group[k]!, other)) continue;
                placed.add(other);
                group.push(other);
            }
        }
        group.sort((a, b) => a - b);
        groups.push(group);
    }
    return groups;
}

/**
 * Something wrong with a layout, and which modules it is wrong about.
 *
 * The indices are why this exists rather than a bare message: an editor draws
 * the offending modules in red, and a sentence naming "modules 3 and 7" is a
 * puzzle on a ship of forty. They index the *expansion* — the modules a ship
 * would be built from — which is the same list `expandWithOrigins` gives
 * places in the layout for.
 */
/** A design's bounding box in its own body frame, about its centre of mass. */
export interface Footprint {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
}

const footprints = new WeakMap<ShipDesign, Footprint>();

export function footprintOf(design: ShipDesign): Footprint {
    const known = footprints.get(design);
    if (known !== undefined) return known;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const corners: number[] = [];
    for (const module of design.modules) {
        const n = moduleOutline(module.spec, corners) * 2;
        for (let k = 0; k < n; k += 2) {
            const x = corners[k]! - design.centreOfMassX;
            const y = corners[k + 1]! - design.centreOfMassY;
            minX = min(minX, x);
            maxX = max(maxX, x);
            minY = min(minY, y);
            maxY = max(maxY, y);
        }
    }
    const found = { minX, maxX, minY, maxY };
    footprints.set(design, found);
    return found;
}

/** A fighter that sets out docked on a pad (`ModuleSpec.docked`). */
export interface Aboard {
    /** The pad, as an index into the carrier's modules. */
    readonly pad: number;
    readonly design: ShipDesign;
}

/** A fighter a pad builds, and how many of it the pad keeps in the fight (`ModuleSpec.keep`). */
export interface PadBuild extends Aboard {
    readonly keep: number;
}

/** A ship a slipway builds, and how many of it the slipway keeps in the fight (`ModuleSpec.keep`). */
export interface SlipwayBuild {
    /** The slipway, as an index into the builder's modules. */
    readonly slipway: number;
    readonly design: ShipDesign;
    readonly keep: number;
}

/**
 * How a slipway lays out the ship it builds (`ModuleSpec.craftAngle`): the way
 * the slipway faces, as a unit vector in the ship's own frame, and the ship's
 * extent along that way and across it, about its centre of mass. Unturned,
 * along is the ship's x and across its y.
 */
export interface Berth {
    readonly ax: number;
    readonly ay: number;
    readonly minAlong: number;
    readonly maxAlong: number;
    readonly minAcross: number;
    readonly maxAcross: number;
}

/** How slipway `slipway` lays out ship `craft`. */
export function berthOf(craft: ShipDesign, slipway: ModuleSpec): Berth {
    const turn = slipway.craftAngle ?? 0;
    if (turn === 0) {
        const box = footprintOf(craft);
        return { ax: 1, ay: 0, minAlong: box.minX, maxAlong: box.maxX, minAcross: box.minY, maxAcross: box.maxY };
    }
    // The slipway's facing turned back into the ship's frame.
    const ax = cos(turn);
    const ay = -sin(turn);
    let minAlong = Infinity;
    let maxAlong = -Infinity;
    let minAcross = Infinity;
    let maxAcross = -Infinity;
    const corners: number[] = [];
    for (const module of craft.modules) {
        const n = moduleOutline(module.spec, corners) * 2;
        for (let k = 0; k < n; k += 2) {
            const x = corners[k]! - craft.centreOfMassX;
            const y = corners[k + 1]! - craft.centreOfMassY;
            const along = x * ax + y * ay;
            const across = y * ax - x * ay;
            minAlong = min(minAlong, along);
            maxAlong = max(maxAlong, along);
            minAcross = min(minAcross, across);
            maxAcross = max(maxAcross, across);
        }
    }
    return { ax, ay, minAlong, maxAlong, minAcross, maxAcross };
}

/**
 * The strip a slipway builds its craft into, in the frame its spec is laid out
 * in: out from its face along its facing, as long as the craft lies along it
 * and as wide as it lies across, on the slipway's centre line. It is finished
 * when its far end reaches the face.
 */
export function slipwayStrip(slipway: ModuleSpec, craft: ShipDesign): ModuleSpec {
    const berth = berthOf(craft, slipway);
    const length = berth.maxAlong - berth.minAlong;
    const angle = slipway.angle ?? 0;
    const out = slipway.length / 2 + length / 2;
    return {
        kind: "structure",
        x: slipway.x + out * cos(angle),
        y: slipway.y + out * sin(angle),
        angle,
        length,
        width: berth.maxAcross - berth.minAcross,
    };
}

/** Whether a ship lies no wider across a slipway than it is, as the slipway lays it out. */
export function slipwayHolds(craft: ShipDesign, slipway: ModuleSpec): boolean {
    const berth = berthOf(craft, slipway);
    return berth.maxAcross - berth.minAcross <= slipway.width + 1e-9;
}

/**
 * Why slipway `spec`, in `layout`, cannot build ship `craft` as it lays it
 * out, or null if it can: what fits through it and has room to come out.
 */
export function slipwayProblem(craft: ShipDesign, spec: ModuleSpec, layout: readonly ModuleSpec[]): string | null {
    const name = craft.name;
    if (!slipwayHolds(craft, spec)) {
        const berth = berthOf(craft, spec);
        const across = (berth.maxAcross - berth.minAcross).toFixed(1);
        const way = (spec.craftAngle ?? 0) === 0 ? "across the beam" : "across this slipway";
        return `${name} is ${across} m ${way}, wider than this slipway (${spec.width.toFixed(1)} m)`;
    }
    if (!inWeaponsLayer(spec) && craft.modules.some((m) => m.weaponsLayer)) {
        return `${name} stands in the weapons layer, so this slipway must be thick to build it`;
    }
    const strip = slipwayStrip(spec, craft);
    if (layout.some((other) => other !== spec && modulesOverlap(other, strip))) {
        return `the ${strip.length.toFixed(1)} m it builds ${name} out into is not clear of this ship's hull`;
    }
    return null;
}

/**
 * The designs a ship's pads and slipways build, found by name and compiled
 * once each. A name is the ship's own, so a ship can build itself, or one in
 * its hangar, which is flat: what a hangar's designs build is found in the
 * same hangar. So designs that build each other are one design each, however
 * they name each other, rather than copies nested without end.
 */
class Crafts {
    private readonly compiled = new Map<string, ShipDesign | string>();
    private readonly checked = new Set<string>();

    constructor(private readonly ship: Blueprint) {}

    /** Whether `blueprint` is the one this set finds by its name. */
    holds(blueprint: Blueprint): boolean {
        return this.blueprint(blueprint.name) === blueprint;
    }

    /** A design being checked is not checked again on the way: its faults are its own. */
    checking(name: string): void {
        this.checked.add(name);
    }

    /** The design as compiled so far, set before what it builds is, so what builds it back finds it. */
    begin(name: string, design: ShipDesign): void {
        this.compiled.set(name, design);
    }

    /** The design already compiled under `name`, if any. */
    known(name: string): ShipDesign | undefined {
        const known = this.compiled.get(name);
        return typeof known === "string" ? undefined : known;
    }

    /** Design `name` compiled, why it cannot be, or undefined if there is none of that name. */
    design(name: string): ShipDesign | string | undefined {
        const known = this.compiled.get(name);
        if (known !== undefined) return known;
        const blueprint = this.blueprint(name);
        if (blueprint === undefined) return undefined;
        if (!this.checked.has(name)) {
            this.checked.add(name);
            const fault = faultsWith(blueprint, this)[0];
            if (fault !== undefined) {
                const problem = `${name} cannot be built: ${fault.message}`;
                this.compiled.set(name, problem);
                return problem;
            }
        }
        // Checking may have compiled it, through something that builds it back.
        const now = this.compiled.get(name);
        if (now !== undefined) return now;
        try {
            return compileWith(blueprint, this);
        } catch (error) {
            const problem = `${name} cannot be built: ${error instanceof Error ? error.message : String(error)}`;
            this.compiled.set(name, problem);
            return problem;
        }
    }

    private blueprint(name: string): Blueprint | undefined {
        return name === this.ship.name ? this.ship : this.ship.hangar?.[name];
    }
}

const twins = new WeakMap<ShipDesign, ShipDesign>();

/**
 * The same design under another identity. Modules know which design they came
 * from by identity, so a ship printing itself prints a twin, and the builder
 * and the ship welded to it while it is built never mistake each other's
 * modules for their own.
 */
export function twinOf(design: ShipDesign): ShipDesign {
    let twin = twins.get(design);
    if (twin === undefined) {
        twin = { ...design };
        twins.set(design, twin);
    }
    return twin;
}

/** The ship a slipway builds, compiled, or why it cannot be. Null for a slipway that names none. */
function slipwayCraft(crafts: Crafts, spec: ModuleSpec, layout: readonly ModuleSpec[]): ShipDesign | string | null {
    if (spec.kind !== "slipway" || spec.craft === undefined) return null;
    const name = spec.craft;
    const design = crafts.design(name);
    if (design === undefined) return `no ship named ${name} in the hangar`;
    if (typeof design === "string") return design;
    if (design.fighter) return `${name} is a fighter, which a pad builds`;
    if ((design.aboard?.length ?? 0) > 0) return `${name} sets out with fighters docked, which a ship built in battle cannot`;
    return slipwayProblem(design, spec, layout) ?? design;
}

/** Whether a fighter's footprint fits inside a pad, lying along the pad's facing. */
export function padHolds(fighter: ShipDesign, pad: ModuleSpec): boolean {
    const box = footprintOf(fighter);
    return box.maxX - box.minX <= pad.length && box.maxY - box.minY <= pad.width;
}

/** The fighter a pad tends, compiled, or why it cannot. Null for a pad that names none. */
function padFighter(crafts: Crafts, spec: ModuleSpec): ShipDesign | string | null {
    if (spec.kind !== "pad" || spec.craft === undefined) return null;
    const name = spec.craft;
    const design = crafts.design(name);
    if (design === undefined) return `no fighter named ${name} in the hangar`;
    if (typeof design === "string") return design;
    if (!design.fighter) return `${name} is not a fighter`;
    if ((design.aboard?.length ?? 0) > 0) return `${name} carries fighters of its own, which a docked fighter may not`;
    if (!padHolds(design, spec)) {
        const box = footprintOf(design);
        return (
            `${name} (${(box.maxX - box.minX).toFixed(1)} × ${(box.maxY - box.minY).toFixed(1)} m) is too big ` +
            `for this pad (${spec.length.toFixed(1)} × ${spec.width.toFixed(1)} m)`
        );
    }
    return design;
}

/**
 * Where a fighter set out on a pad lies, in the carrier's body frame about its
 * centre of mass: its own centre of mass and heading, its footprint centred on
 * the pad and lying along the pad's facing.
 */
export function aboardPose(carrier: ShipDesign, aboard: Aboard): { x: number; y: number; angle: number } {
    const pad = carrier.modules[aboard.pad]!;
    const box = footprintOf(aboard.design);
    const bx = (box.minX + box.maxX) / 2;
    const by = (box.minY + box.maxY) / 2;
    const c = cos(pad.angle);
    const s = sin(pad.angle);
    return { x: pad.x - (bx * c - by * s), y: pad.y - (bx * s + by * c), angle: pad.angle };
}

/** What a design costs a budget, kg: its launch mass and every fighter it sets out with. */
export function budgetMass(design: ShipDesign): number {
    let mass = design.launchMass;
    for (const aboard of design.aboard ?? []) mass += aboard.design.launchMass;
    return mass;
}

export interface BlueprintFault {
    readonly message: string;
    /** Empty when the complaint is about the layout as a whole rather than a part of it. */
    readonly modules: readonly number[];
}

/**
 * Everything wrong with a layout, rather than the first thing.
 *
 * An editor shows a problems list, and a list of one that grows back as each
 * entry is fixed makes a layout feel further from valid than it is — you
 * cannot tell whether you are one move from a working ship or ten. The
 * simulation only ever wants to know *whether* a layout is buildable, which is
 * what `blueprintProblem` remains for.
 *
 * The structural complaints are the exception and still stop everything: a
 * layout that names a missing assembly or contains itself cannot be expanded,
 * so there are no modules to find anything else wrong with.
 */
export function blueprintFaults(blueprint: Blueprint): BlueprintFault[] {
    return faultsWith(blueprint, new Crafts(blueprint));
}

/** `blueprintFaults`, finding what its pads and slipways build in `crafts`. */
function faultsWith(blueprint: Blueprint, crafts: Crafts): BlueprintFault[] {
    crafts.checking(blueprint.name);
    // Assemblies are resolved before anything else looks at the layout, so every
    // rule below is stated once, about the modules a ship is actually built
    // from — rather than once for a module and again for a copy of one.
    const structural = assemblyProblem(blueprint);
    if (structural !== null) return [{ message: structural, modules: [] }];

    let modules: ModuleSpec[];
    try {
        modules = expandBlueprint(blueprint);
    } catch (error) {
        // Depth and expansion-size limits are enforced by the walk itself, since
        // both are about what the whole expansion comes to rather than about any
        // one placement. Reaching one is a problem to report, not a crash.
        return [{ message: error instanceof Error ? error.message : String(error), modules: [] }];
    }

    const faults: BlueprintFault[] = [];
    if (modules.length === 0) {
        faults.push({ message: `${blueprint.name}: a ship needs at least one module`, modules: [] });
    }

    for (let i = 0; i < modules.length; i++) {
        const problem = moduleProblem(modules[i]!);
        if (problem !== null) {
            faults.push({ message: `${blueprint.name}, module ${i} — ${problem}`, modules: [i] });
        }
    }

    // Each outline drawn once, and a pair whose bounds are apart never tested:
    // apart, they cannot overlap.
    const outlines = modules.map((module) => {
        const corners: number[] = [];
        const count = moduleOutline(module, corners);
        let lx = Infinity;
        let ly = Infinity;
        let hx = -Infinity;
        let hy = -Infinity;
        for (let c = 0; c < count * 2; c += 2) {
            lx = min(lx, corners[c]!);
            hx = max(hx, corners[c]!);
            ly = min(ly, corners[c + 1]!);
            hy = max(hy, corners[c + 1]!);
        }
        return { corners, count, lx, ly, hx, hy };
    });
    for (let i = 0; i < modules.length; i++) {
        const a = outlines[i]!;
        for (let k = i + 1; k < modules.length; k++) {
            const b = outlines[k]!;
            if (a.lx > b.hx || b.lx > a.hx || a.ly > b.hy || b.ly > a.hy) continue;
            if (outlinesOverlap(a.corners, a.count, b.corners, b.count)) {
                faults.push({ message: `${blueprint.name}: modules ${i} and ${k} overlap`, modules: [i, k] });
            }
        }
    }

    for (let i = 0; i < modules.length; i++) {
        const fighter = padFighter(crafts, modules[i]!);
        if (typeof fighter === "string") {
            faults.push({ message: `${blueprint.name}, module ${i} — pad: ${fighter}`, modules: [i] });
        }
        const craft = slipwayCraft(crafts, modules[i]!, modules);
        if (typeof craft === "string") {
            faults.push({ message: `${blueprint.name}, module ${i} — slipway: ${craft}`, modules: [i] });
        }
    }

    // A ship is flown from a core, so a layout without one is a hull and not a
    // ship. It is the anchor every other rule about how the layout hangs
    // together is stated against, which is why it is checked before them. A
    // layout with nothing in it at all is one mistake and is already one
    // complaint, so it does not earn this one as well. An asteroid is the one
    // hull that is meant to have none, and its kernel or rock says so.
    const asteroid = modules.some((spec) => spec.kind === "kernel" || spec.kind === "rock");
    if (modules.length > 0 && !asteroid && !modules.some((spec) => spec.kind === "core" && moduleProblem(spec) === null)) {
        faults.push({
            message:
                `${blueprint.name}: no core — a ship needs at least one core module to be flown from, ` +
                `and a hull built around two survives being cut between them as two ships`,
            modules: [],
        });
    }

    // A ship is one connected assembly of modules. A piece touching nothing is
    // either a module dropped somewhere it does not belong or a wing left behind
    // when its root moved, and both are invisible on a busy layout until
    // something is drawn round them.
    for (const group of detachedGroups(modules)) {
        const which = group.join(", ");
        faults.push({
            message:
                group.length === 1
                    ? `${blueprint.name}: module ${which} touches nothing — every module must be attached ` +
                      `to the ship's core, through its neighbours or directly`
                    : `${blueprint.name}: modules ${which} are a separate piece, attached to each other but ` +
                      `not to the rest of the ship`,
            modules: group,
        });
    }

    return faults;
}

/** Everything wrong with a layout, as sentences. */
export function blueprintProblems(blueprint: Blueprint): string[] {
    return blueprintFaults(blueprint).map((fault) => fault.message);
}

/** Why a layout cannot be built into a ship, or null if it can. */
export function blueprintProblem(blueprint: Blueprint): string | null {
    return blueprintProblems(blueprint)[0] ?? null;
}

/** Derive everything a ship built to this blueprint is. Throws if it could not be built. */
export function compileBlueprint(blueprint: Blueprint): ShipDesign {
    // One set for both, so what checking compiled is not compiled again.
    const crafts = new Crafts(blueprint);
    const problem = faultsWith(blueprint, crafts)[0]?.message;
    if (problem !== undefined) throw new Error(`Invalid blueprint — ${problem}`);
    return compileWith(blueprint, crafts);
}

/**
 * Derive the same design from a layout that has *not* been accepted.
 *
 * A layout is routinely invalid while it is being worked on — you often have
 * to drag one module through another to get it past — and the whole value of
 * an editor is that the picture and the numbers it shows are the ones the
 * battle would use. So the complaints `blueprintProblem` makes about how a
 * ship goes together are set aside here, and only what makes a design
 * *underivable* is refused: a layout with no modules, and a module whose
 * geometry has no interior, which would otherwise be measured as NaN and
 * poison every total on the panel.
 *
 * A module whose geometry cannot be measured — a size typed down to zero on
 * the way to typing a smaller one — is **left out rather than refused**, so
 * the rest of the ship goes on being drawn and measured around the hole. It
 * is left out and not substituted, because there is no size it could be given
 * that would not be a lie about what the layout says. `blueprintProblems`
 * names it, which is where the player finds out.
 *
 * Nothing that spawns a ship may call this. Overlapping hull and an engine
 * mounted to nothing are real defects and compile perfectly happily; the guard
 * against them is `compileBlueprint`, which is the only door into a battle —
 * and it admits nothing this would have to leave out, since `blueprintProblem`
 * has already refused a layout with an unmeasurable module in it.
 */
export function compileDraft(blueprint: Blueprint): ShipDesign {
    return compileWith(blueprint, new Crafts(blueprint));
}

/** `compileDraft`, finding what its pads and slipways build in `crafts`. */
function compileWith(blueprint: Blueprint, crafts: Crafts): ShipDesign {
    const own = crafts.holds(blueprint) ? crafts.known(blueprint.name) : undefined;
    if (own !== undefined) return own;
    const expanded = expandBlueprint(blueprint);
    if (expanded.length === 0) throw new Error(`${blueprint.name}: a ship needs at least one module`);
    const specs = expanded.filter((spec) => moduleProblem(spec) === null);
    if (specs.length === 0) {
        throw new Error(`${blueprint.name}: no module has geometry that can be measured`);
    }

    // Where each kept module sat in the expansion, since a draft compile may
    // have dropped some of it.
    const layoutIndex: number[] = [];
    for (let i = 0; i < expanded.length; i++) {
        if (moduleProblem(expanded[i]!) === null) layoutIndex.push(i);
    }

    const design = designFrom(
        blueprint.name,
        specs,
        layoutStats(specs),
        layoutIndex,
        blueprint.doctrine ?? DEFAULT_DOCTRINE,
        undefined,
        blueprint.fighter === true && fighterProblem(specs) === null,
    );
    // Filled in as what it builds is found, so a design that builds itself, or
    // builds one that builds it, is handed this one rather than another copy.
    // Its pads before its slipways: whether it sets out with fighters aboard is
    // what a slipway building it asks.
    const out: { -readonly [K in keyof ShipDesign]: ShipDesign[K] } = { ...design, keys: moduleKeys(blueprint) };
    if (crafts.holds(blueprint)) crafts.begin(blueprint.name, out);
    const aboard: Aboard[] = [];
    const builds: PadBuild[] = [];
    const yards: SlipwayBuild[] = [];
    const approaches: PadApproach[] = [];
    for (let m = 0; m < specs.length; m++) {
        const spec = specs[m]!;
        if (spec.kind === "pad") approaches.push(...padApproaches(design, m));
        const fighter = padFighter(crafts, spec);
        if (fighter === null || typeof fighter === "string") continue;
        if (spec.docked === true) aboard.push({ pad: m, design: fighter });
        const keep = floor(spec.keep ?? 0);
        if (keep > 0) builds.push({ pad: m, design: fighter, keep });
    }
    if (aboard.length > 0) out.aboard = aboard;
    if (approaches.length > 0) out.approaches = approaches;
    if (builds.length > 0) out.builds = builds;
    for (let m = 0; m < specs.length; m++) {
        const spec = specs[m]!;
        const keep = floor(spec.keep ?? 0);
        const craft = slipwayCraft(crafts, spec, specs);
        if (craft !== null && typeof craft !== "string" && keep > 0) yards.push({ slipway: m, design: craft, keep });
    }
    if (yards.length > 0) out.yards = yards;
    return out;
}

/**
 * Every module's figures, measured in the layout they sit in.
 *
 * Only one thing a module is makes it ask about its neighbours — thick
 * structure takes its depth from what it is welded to (`ModuleSpec.thick`) —
 * so a layout with no thick plate in it costs exactly what measuring each
 * module on its own costs, and one with a plate pays for the contact test the
 * connectivity graph already runs.
 */
export function layoutStats(specs: readonly ModuleSpec[]): ModuleStats[] {
    const stats: ModuleStats[] = [];
    for (let i = 0; i < specs.length; i++) stats.push(statsInLayout(specs, i));
    return stats;
}

/** One module's figures, measured in the layout it sits in. */
export function statsInLayout(specs: readonly ModuleSpec[], i: number): ModuleStats {
    return moduleStats(specs[i]!, touchingDepth(specs, i));
}

/**
 * The depth of the deepest module this one is welded to, or zero where nothing
 * reads it.
 *
 * What a neighbour offers is the depth it has of its *own* — `moduleThickness`
 * with nothing borrowed — and never one it borrowed itself. That is what stops
 * depth travelling: a run of plates over a hull each stand as high as the
 * module under them rather than passing the best one along the run, and the
 * answer cannot depend on the order the modules happen to be written in.
 */
function touchingDepth(specs: readonly ModuleSpec[], i: number): number {
    const spec = specs[i]!;
    if (spec.kind !== "structure" || !isThick(spec)) return 0;
    let deepest = 0;
    for (let j = 0; j < specs.length; j++) {
        if (j === i) continue;
        const offered = moduleThickness(specs[j]!);
        if (offered <= deepest) continue;
        if (contactWidth(spec, specs[j]!) > 0) deepest = offered;
    }
    return deepest;
}

/**
 * Why these modules cannot fly as a fighter, or null. A turret or anything
 * thick stands up out of the deck a strike craft skims (DESIGN.md §3).
 */
export function fighterProblem(specs: readonly ModuleSpec[]): string | null {
    for (const spec of specs) {
        if (spec.kind === "turret" || spec.kind === "beamTurret") return "a fighter carries no turrets";
        if (isThick(spec)) return "a fighter has nothing thick";
    }
    return null;
}

/**
 * Which cores reach each module (`ShipDesign.coveredBy`): those whose circle
 * touches its block, leaving out a barrel or a bell.
 */
function coverage(specs: readonly ModuleSpec[], stats: readonly ModuleStats[], cores: readonly number[]): (number[] | null)[] {
    return specs.map((spec) => {
        if (!needsControl(spec.kind)) return null;
        const block = spec.body === true ? weldBox(spec) : spec;
        const centre = blockCentre(spec);
        const angle = boxAngle(block);
        const c = cos(angle);
        const s = sin(angle);
        return cores.filter((core) => {
            const at = blockCentre(specs[core]!);
            const dx = at.x - centre.x;
            const dy = at.y - centre.y;
            const out = max(0, abs(dx * c + dy * s) - block.length / 2);
            const across = max(0, abs(dy * c - dx * s) - block.width / 2);
            const reach = stats[core]!.controlRadius;
            return out * out + across * across <= reach * reach;
        });
    });
}

/**
 * The design that part of a ship makes on its own, once the rest has come off.
 *
 * Everything is derived again from the modules that are left — mass, the
 * centre of mass they turn about, inertia, bounding radius, which engines
 * and guns went with them — because a chunk is a ship-shaped thing that
 * happens to have no working core, and nothing downstream should have to ask whether
 * the design it holds came from a blueprint or from a break.
 *
 * Firing arcs are worked out against the modules that remain, so a mount whose
 * obstruction has been shot away really does gain the arc. Each module keeps
 * the layout index it had in the ship it came off, so a path back to the
 * blueprint that authored it survives the split.
 */
export function subDesign(design: ShipDesign, keep: readonly number[]): ShipDesign {
    if (keep.length === 0) throw new Error(`${design.name}: a piece needs at least one module`);
    const specs: ModuleSpec[] = [];
    const stats: ModuleStats[] = [];
    const layoutIndex: number[] = [];
    const marks: Mark[] = [];
    for (let k = 0; k < keep.length; k++) {
        const module = design.modules[keep[k]!]!;
        specs.push(module.spec);
        stats.push(module.stats);
        layoutIndex.push(module.index);
        marks.push(markOf(design, keep[k]!));
    }
    let joins: Joins | undefined;
    if (design.pieces !== undefined) {
        const at = new Map<number, number>();
        keep.forEach((module, k) => at.set(module, k));
        const seams: Seam[] = [];
        for (const seam of design.seams ?? []) {
            const a = at.get(seam.a);
            const b = at.get(seam.b);
            if (a !== undefined && b !== undefined) seams.push(renumbered(seam, a, b));
        }
        const pieces = keep.map((module) => design.pieces![module]!);
        const fighterPieces = (design.fighterPieces ?? []).filter((piece) => pieces.includes(piece));
        joins = fighterPieces.length > 0 ? { pieces, seams, fighterPieces } : { pieces, seams };
    }
    // A piece of a fighter is still small enough to be one, and so is a piece
    // made only of what were fighters when they came aboard.
    const fighters = joins?.fighterPieces;
    const fighter = design.fighter || (fighters !== undefined && joins!.pieces.every((piece) => fighters.includes(piece)));
    return designFrom(design.name, specs, stats, layoutIndex, design.doctrine, joins, fighter, marks);
}

/**
 * The design as it flies: every module out of all its cores' reach
 * (`ShipDesign.coveredBy`) pushing nothing and carrying no gun, so the figures
 * worked out from it are the ones a battle would see. The same design when
 * everything is in reach.
 */
export function inReachDesign(design: ShipDesign): ShipDesign {
    const out = design.coveredBy?.some((cores) => cores !== null && cores.length === 0) === true;
    if (!out) return design;
    const modules = design.modules.map((module, m) =>
        design.coveredBy![m]?.length === 0 ? { ...module, stats: { ...module.stats, thrust: 0, gun: null } } : module,
    );
    const flying = subDesign(
        { ...design, modules },
        modules.map((_, m) => m),
    );
    // What a hangar and the rest of the layout say is unchanged.
    return {
        ...design,
        modules: flying.modules,
        engines: flying.engines,
        turrets: flying.turrets,
        engineLayout: flying.engineLayout,
        thrustBearing: flying.thrustBearing,
        weaponEngines: flying.weaponEngines,
        mainWeaponEngines: flying.mainWeaponEngines,
        reach: flying.reach,
    };
}

/**
 * One hull made of two, welded where module `a` of the first met module `b` of
 * the second. The second's modules follow the first's, moved into the first's
 * blueprint frame by `dx`, `dy` and turned by `dangle`, so every index into the
 * first design still means the same module. `dock` says which of the two, if
 * either, holds the other, and by what.
 */
export function weldDesigns(
    first: ShipDesign,
    second: ShipDesign,
    dx: number,
    dy: number,
    dangle: number,
    a: number,
    b: number,
    width: number,
    dock: DockAt | null = null,
): ShipDesign {
    const c = cos(dangle);
    const s = sin(dangle);
    const specs: ModuleSpec[] = first.modules.map((module) => module.spec);
    const stats: ModuleStats[] = first.modules.map((module) => module.stats);
    const layoutIndex = first.modules.map((module) => module.index);
    const marks = first.modules.map((_, m) => markOf(first, m));
    const moved = (spec: ModuleSpec): ModuleSpec => ({
        ...spec,
        x: dx + spec.x * c - spec.y * s,
        y: dy + spec.x * s + spec.y * c,
        angle: (spec.angle ?? 0) + dangle,
    });
    second.modules.forEach((_, m) => {
        const mark = markOf(second, m);
        const placed = mark.shell?.placed;
        marks.push(placed === undefined ? mark : { ...mark, shell: { ...mark.shell!, placed: moved(placed) } });
    });
    for (const module of second.modules) {
        specs.push(moved(module.spec));
        stats.push(module.stats);
        layoutIndex.push(module.index);
    }
    const n = first.modules.length;
    const firstPieces = first.pieces ?? first.modules.map(() => 0);
    const offset = firstPieces.reduce((most, piece) => max(most, piece), 0) + 1;
    const pieces = [...firstPieces, ...(second.pieces ?? second.modules.map(() => 0)).map((piece) => piece + offset)];
    const seams: Seam[] = [
        ...(first.seams ?? []),
        ...(second.seams ?? []).map((seam) => renumbered(seam, seam.a + n, seam.b + n)),
        dock === null
            ? { a, b: b + n, width }
            : dock.at === "a"
              ? { a, b: b + n, width, dock: dock.kind }
              : { a: b + n, b: a, width, dock: dock.kind },
    ];
    const fighterPieces = [
        ...(first.fighter ? [...new Set(firstPieces)] : (first.fighterPieces ?? [])),
        ...(second.fighter ? [...new Set(second.pieces ?? [0])] : (second.fighterPieces ?? [])).map((piece) => piece + offset),
    ];
    const joins: Joins = fighterPieces.length > 0 ? { pieces, seams, fighterPieces } : { pieces, seams };
    // Two fighters welded are still small enough to be one.
    return designFrom(first.name, specs, stats, layoutIndex, first.doctrine, joins, first.fighter && second.fighter, marks);
}

/**
 * A design with module `at` put in place of what it has there, or added after
 * its last when `at` is its length: the same module of `origin`, whole or as a
 * shell, on piece `piece` of a welded hull. Every other module keeps its index.
 */
export function rebuiltDesign(
    design: ShipDesign,
    at: number,
    spec: ModuleSpec,
    stats: ModuleStats,
    origin: Compiled,
    shell: Shell | null,
    piece = 0,
): ShipDesign {
    const specs = design.modules.map((module) => module.spec);
    const all = design.modules.map((module) => module.stats);
    const layoutIndex = design.modules.map((module) => module.index);
    const marks = design.modules.map((_, m) => markOf(design, m));
    specs[at] = spec;
    all[at] = stats;
    layoutIndex[at] = origin.design.modules[origin.module]!.index;
    marks[at] = shell === null ? { origin } : { origin, shell };
    let joins: Joins | undefined;
    if (design.pieces !== undefined) {
        const pieces = design.pieces.slice();
        pieces[at] = piece;
        joins = {
            pieces,
            seams: design.seams ?? [],
            ...(design.fighterPieces === undefined ? {} : { fighterPieces: design.fighterPieces }),
        };
    }
    return designFrom(design.name, specs, all, layoutIndex, design.doctrine, joins, design.fighter, marks);
}

/** A module of a compiled design, whole or as a shell, laid out in a new design's frame. */
export interface PartOf {
    readonly spec: ModuleSpec;
    readonly stats: ModuleStats;
    readonly origin: Compiled;
    readonly shell: Shell | null;
}

/** One hull of `parts`, each a module of another compiled design: part of a ship being built. */
export function partsDesign(name: string, doctrine: Doctrine, parts: readonly PartOf[]): ShipDesign {
    return designFrom(
        name,
        parts.map((p) => p.spec),
        parts.map((p) => p.stats),
        parts.map((p) => p.origin.design.modules[p.origin.module]!.index),
        doctrine,
        undefined,
        false,
        parts.map((p) => (p.shell === null ? { origin: p.origin } : { origin: p.origin, shell: p.shell })),
    );
}

/** A welded hull with `more` seams than it has: further holds between its pieces. */
export function seamedDesign(design: ShipDesign, more: readonly Seam[]): ShipDesign {
    if (more.length === 0 || design.pieces === undefined) return design;
    const joins: Joins = {
        pieces: design.pieces,
        seams: [...(design.seams ?? []), ...more],
        ...(design.fighterPieces === undefined ? {} : { fighterPieces: design.fighterPieces }),
    };
    return designFrom(
        design.name,
        design.modules.map((module) => module.spec),
        design.modules.map((module) => module.stats),
        design.modules.map((module) => module.index),
        design.doctrine,
        joins,
        design.fighter,
        design.modules.map((_, m) => markOf(design, m)),
    );
}

/**
 * A design with the modules `origins` names said to be those modules of
 * another compiled design instead, and every other as it was: the same hull,
 * matched to a new version of what it is built to (a refit). Shells stay shells.
 */
export function remarkedDesign(design: ShipDesign, origins: readonly (Compiled | null)[]): ShipDesign {
    const marks = design.modules.map((_, m) => {
        const mark = markOf(design, m);
        const origin = origins[m];
        return origin === null || origin === undefined ? mark : { ...mark, origin };
    });
    const joins: Joins | undefined =
        design.pieces === undefined
            ? undefined
            : {
                  pieces: design.pieces,
                  seams: design.seams ?? [],
                  ...(design.fighterPieces === undefined ? {} : { fighterPieces: design.fighterPieces }),
              };
    return designFrom(
        design.name,
        design.modules.map((module) => module.spec),
        design.modules.map((module) => module.stats),
        design.modules.map((module) => module.index),
        design.doctrine,
        joins,
        design.fighter,
        marks,
    );
}

/**
 * The way a layout pushes hardest: of the ways its engines push, the one the
 * whole layout gives the most along, the first of any tie.
 */
function thrustBearing(engines: readonly EngineSpec[], layout: EngineLayout): number {
    let best = 0;
    let bearing = 0;
    for (const engine of engines) {
        const along = layout.maxThrustAlong(engine.dirX, engine.dirY);
        if (along > best) {
            best = along;
            bearing = atan2(engine.dirY, engine.dirX);
        }
    }
    return bearing;
}

/**
 * Measure a design from modules that have already been chosen and measured.
 *
 * The half of compiling that both a blueprint and a severed chunk need, so
 * that a piece of a ship is measured by exactly the rules the whole ship was.
 */
function designFrom(
    name: string,
    specs: readonly ModuleSpec[],
    stats: readonly ModuleStats[],
    layoutIndex: readonly number[],
    doctrine: Doctrine = DEFAULT_DOCTRINE,
    joins?: Joins,
    fighter = false,
    marks?: readonly Mark[],
): ShipDesign {
    const centres = specs.map(moduleCentre);
    let mass = 0;
    let unfilled = 0;
    let comX = 0;
    let comY = 0;
    for (let i = 0; i < specs.length; i++) {
        const m = stats[i]!.mass;
        mass += m;
        unfilled += (stats[i]!.fuel + stats[i]!.metal) * (1 - fillOf(specs[i]!));
        comX += centres[i]!.x * m;
        comY += centres[i]!.y * m;
    }
    comX /= mass;
    comY /= mass;

    // Which modules stand up into the weapons layer, by index: read from the
    // depth each was measured at rather than from its spec, so a plate that
    // borrowed its height from the module it covers is in the way of a turret.
    const raised = (_spec: ModuleSpec, i: number): boolean => inWeaponsLayer(specs[i]!, stats[i]!.thickness);

    const modules: DesignModule[] = [];
    const engines: EngineSpec[] = [];
    const turrets: DesignTurret[] = [];
    const cores: number[] = [];
    let inertia = 0;
    let radius = 0;
    const c: number[] = [];

    for (let i = 0; i < specs.length; i++) {
        const spec = specs[i]!;
        const s = stats[i]!;
        // The middle of the box rather than where the module is attached: this is
        // what carries its mass, what the renderer draws about, and — for a
        // engine — a point on the same line of action as its mounting, so the
        // force and torque it delivers are the same either way.
        const x = centres[i]!.x - comX;
        const y = centres[i]!.y - comY;
        // An engine's is the way it pushes (`boxAngle`), which is what its box,
        // its thrust and its plume are all laid out along.
        const angle = normalizeAngle(boxAngle(spec));

        // Parallel axis: each module's own inertia, carried out to where it sits.
        inertia += s.inertia + s.mass * (x * x + y * y);

        const count = moduleOutline(spec, c);
        for (let k = 0; k < count * 2; k += 2) {
            const dx = c[k]! - comX;
            const dy = c[k + 1]! - comY;
            radius = max(radius, sqrt(dx * dx + dy * dy));
        }

        modules.push({
            spec,
            stats: s,
            x,
            y,
            angle,
            index: layoutIndex[i]!,
            // From the depth it was measured at, so a plate that borrowed its height
            // from the module it covers is cover, and a severed chunk keeps what it
            // was built with rather than re-deriving it from what is left.
            weaponsLayer: inWeaponsLayer(spec, s.thickness),
            ...(marks === undefined ? {} : { origin: marks[i]!.origin }),
            ...(marks?.[i]?.shell === undefined ? {} : { shell: marks[i]!.shell }),
        });

        if (spec.kind === "core") {
            cores.push(modules.length - 1);
        } else if (spec.kind === "engine") {
            engines.push({
                x,
                y,
                dirX: cos(angle),
                dirY: sin(angle),
                maxThrust: s.thrust,
                module: modules.length - 1,
                weapon: spec.weapon === true,
            });
        } else if (isHullMount(spec.kind) && s.gun !== null) {
            const gun = s.gun;
            const mount = hullMountGeometry(spec);
            // A hull weapon trains ahead of its block, not about the middle of the
            // module — the block is welded into the ship and only the barrel or the
            // lenses move. Everything downstream measures from the mount point, so
            // this is where the mount point goes.
            const px = x + cos(angle) * mount.trains;
            const py = y + sin(angle) * mount.trains;
            radius = max(radius, sqrt(px * px + py * py) + gun.barrelLength);

            // Three limits, and the narrowest wins. The barrel has to stay inside
            // the opening it comes out of, which is the archetype's own bound and is
            // usually single figures; the layout may ask for less than that, and
            // pays less for the bed; and the ship may be in the way of even that,
            // which is the question every mount is asked.
            //
            // In the hull layer, so every module is in its way — the barrel's, and
            // the round's all the way downrange.
            const arc = firingArc(specs, i, mount.muzzle);
            const mask = triggerMask(specs, i, everyModule, shotSpread(gun));
            const limit = mountTraverse(spec);
            const accel = mountAccel(spec, s);

            turrets.push({
                module: i,
                mount: {
                    x: px,
                    y: py,
                    restBearing: angle,
                    leftArc: min(arc.left, limit),
                    rightArc: min(arc.right, limit),
                    maxRate: traverseRate(accel),
                    maxAccel: accel,
                    inertia: s.swingInertia,
                    muzzleSpeed: gun.muzzleSpeed,
                    muzzleOffset: mount.muzzle,
                    ...(spec.kind === "hullBeam" ? { outletsFixed: true } : {}),
                    mask,
                },
                gun,
                // Filled once the hull's radius is final, which this loop is still
                // growing: a mount's reach is measured against a target the size the
                // *ship* expects, and the ship is not finished being measured yet.
                reach: 0,
                targeting: resolveTargeting(spec.targeting, defaultTargeting(spec.kind)),
                hullLayer: true,
                main: spec.main !== false,
            });
        } else if ((spec.kind === "turret" || spec.kind === "beamTurret") && s.gun !== null) {
            const gun = s.gun;
            // The breech sits at the middle of the mount and the barrel reaches out
            // from there, so the muzzle traces a circle of that radius as the gun
            // trains — which is what the shot leaves from, and what the hull's
            // bounding circle has to contain.
            radius = max(radius, sqrt(x * x + y * y) + gun.barrelLength);

            // Above the deck, so only what stands up into the weapons layer is in
            // its way: within a barrel's length for where it may train, and at any
            // range for where it may fire. A beam's housing is a stub, so a beam
            // trains nearly freely and its mask does the work.
            const arc = firingArc(specs, i, gun.barrelLength, raised, barrelHalfWidth(gun));
            const mask = triggerMask(specs, i, raised, shotSpread(gun));

            // One drive, so one figure: the rate limit is what this acceleration
            // reaches in the drive's spin-up time.
            const accel = mountAccel(spec, s);

            turrets.push({
                module: i,
                mount: {
                    x,
                    y,
                    restBearing: angle,
                    leftArc: min(arc.left, mountTraverse(spec)),
                    rightArc: min(arc.right, mountTraverse(spec)),
                    maxRate: traverseRate(accel),
                    maxAccel: accel,
                    inertia: s.inertia,
                    muzzleSpeed: gun.muzzleSpeed,
                    muzzleOffset: gun.barrelLength,
                    mask,
                },
                gun,
                // Filled once the hull's radius is final, which this loop is still
                // growing: a mount's reach is measured against a target the size the
                // *ship* expects, and the ship is not finished being measured yet.
                reach: 0,
                targeting: resolveTargeting(spec.targeting, defaultTargeting(spec.kind)),
                hullLayer: false,
                main: spec.main !== false,
            });
        }
    }

    // **Two reaches, from one law and two different expectations.**
    //
    // A mount's is against the size of thing *it* goes after, since that is what
    // it will be shooting at. The ship's is against the size *its own doctrine*
    // goes after, because what the ship's reach decides is how close its pilot
    // flies — and the pilot flies at what the hull chose, not at what the
    // point-defence guns are watching for.
    //
    // Both as far as each mount's doctrine says it will fire (`fireRange`), so a
    // ship whose guns hold their fire for a sure thing closes to where it is.
    const expects = (preferredMass: number, mount: DesignTurret): number =>
        nominalReach(mount.gun, radius, preferredMass) * mount.targeting.fireRange;
    for (let t = 0; t < turrets.length; t++) {
        const mount = turrets[t]!;
        turrets[t] = { ...mount, reach: expects(mount.targeting.preferredMass, mount) };
    }

    // The main battery's alone, so a ship flies to where its big guns bite
    // rather than to where its point defence reaches.
    let reach = 0;
    for (const turret of turrets) {
        if (turret.main) reach = max(reach, expects(doctrine.targeting.preferredMass, turret));
    }

    const weaponEngines: number[] = [];
    const mainWeaponEngines: number[] = [];
    for (let t = 0; t < engines.length; t++) {
        const engine = engines[t]!;
        if (engine.weapon !== true) continue;
        weaponEngines.push(t);
        const spec = modules[engine.module ?? -1]?.spec;
        if (spec === undefined || spec.main === false) continue;
        mainWeaponEngines.push(t);
        // As far as the flame lands the share it fires for, so a torch ship's
        // doctrine closes to where its engine burns rather than to the skin.
        reach = max(reach, weaponPlumeReach(engineGeometry(spec), engine.maxThrust));
    }

    // What each engine exhausts into, across each nozzle. A plume needs it every step
    // and nothing in a battle can change it: an engine firing into its own hull
    // is firing into it for as long as the hull is one piece, and a piece cut
    // off is a design of its own that works this out again.
    //
    // What comes out of it is `escaping` — the share of the exhaust that leaves
    // the ship at all, and therefore the share of the rated thrust the ship
    // actually gets. Exhaust stopped by the ship's own structure hands its
    // momentum straight back, so it is not thrust; structure beyond the flame's
    // own end meets nothing left to hand back, and does not count.
    const exhaust = new HullPath();
    // A fighter aboard a carrier flies over its deck: a piece that came aboard a
    // fighter is in the weapons layer alone, and a plume meets only what shares
    // a layer with its engine.
    const fighterPieces = joins?.fighterPieces;
    const layersAt = (m: number): number =>
        fighterPieces?.includes(joins!.pieces[m]!) === true ? WEAPONS_LAYER : moduleLayers(modules[m]!, OWN_LAYERS);
    for (const engine of engines) {
        const slices: PlumeSlice[] = [];
        const own = layersAt(engine.module!);
        const meets = fighterPieces === undefined ? undefined : (m: number): boolean => (layersAt(m) & own) !== 0;
        const escaping = exhaustObstruction({ modules }, engine.module!, engine.maxThrust, exhaust, slices, meets);
        engine.slices = slices;
        engine.escaping = escaping;
    }

    const layout = new EngineLayout(engines);
    return {
        name,
        modules,
        reach,
        doctrine,
        fighter,
        mass,
        launchMass: mass - unfilled,
        inertia,
        radius,
        centreOfMassX: comX,
        centreOfMassY: comY,
        engines,
        weaponEngines,
        mainWeaponEngines,
        engineLayout: layout,
        thrustBearing: thrustBearing(engines, layout),
        turrets,
        cores,
        coveredBy: coverage(specs, stats, cores),
        ...(joins === undefined ? {} : { pieces: joins.pieces, seams: joins.seams }),
        ...(joins?.fighterPieces === undefined ? {} : { fighterPieces: joins.fighterPieces }),
    };
}
