import { abs, angleDelta, atan2, cos, max, min, normalizeAngle, PI, sin, sqrt, TAU } from './math.js';
import {
  GunType,
  moduleCentre,
  moduleProblem,
  moduleStats,
  isHullMount,
  mountTraverse,
  hullMountGeometry,
  weldBox,
  traverseAccel,
  traverseRate,
  type GunStats,
  type ModuleSpec,
  type ModuleStats,
} from './modules.js';
import {
  DEFAULT_DOCTRINE,
  defaultTargeting,
  resolveTargeting,
  type Doctrine,
  type Targeting,
} from './doctrine.js';
import { ThrusterLayout, type ThrusterSpec } from './thrusters.js';
import { HullPath } from './hull.js';
import { exhaustObstruction } from './exhaust.js';
import type { TurretSpec } from './turrets.js';

/**
 * Blueprints: a layout of modules, and what a ship built to it turns out to be.
 *
 * A blueprint is authored data — where the modules go — and says nothing about
 * how the ship performs. Compiling one derives all of that: mass and moment of
 * inertia from the modules' own geometry, the centre of mass everything is
 * measured about, the thruster layout to solve allocation with, and each
 * turret's mount including the arc the ship's own superstructure leaves it.
 *
 * **Compile once per design, not once per ship.** Everything here is fixed for
 * as long as the layout is, so a hundred strike craft off the same blueprint
 * share one compiled design and one thruster matrix between them (DESIGN.md
 * §4). Damage does not invalidate it: a wrecked module keeps its mass and its
 * place, so only losing a thruster — or severing part of the hull — changes
 * anything derived here.
 *
 * **The centre of mass is the body's origin.** Bodies rotate about their
 * centre of mass, so a layout authored about any convenient origin is shifted
 * onto it at compile time. Doing this once here means nothing downstream —
 * thruster arms, turret mounts, the renderer — has to remember to correct for
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
 * neighbour and the layout is refused. Every thruster a mutation tried to bolt
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
 * thrusters holds one thruster and eight placements of it, so making them all
 * bigger is one edit and there is no state in which seven of them are.
 *
 * An assembly of a single module is the ordinary "shared part" case, and is
 * deliberately not a separate concept — one mechanism covers a repeated
 * thruster and a repeated wing, and having two would mean choosing between
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
   * Modules this copy carries and the assembly does not, placed in the same
   * frame as the assembly's own — so they move and reflect with it, which is
   * the thing that cannot be had by placing a module in the parent instead.
   *
   * Purely additive, deliberately. It is how one copy differs from another
   * without an instance ever overriding a value, so "linked" keeps meaning
   * "identical" about everything the assembly defines, and the differences
   * between copies are all in one place and all visible.
   *
   * It is also what the editor's unlink is built from: taking a part out of
   * the definition and handing every instance its own copy leaves the ship
   * unchanged and each copy separately editable.
   */
  extra?: readonly Placement[];
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
}

/** Something a layout puts somewhere: a module itself, or a copy of a group. */
export type Placement = ModuleSpec | AssemblyInstance;

export function isInstance(placement: Placement): placement is AssemblyInstance {
  return 'use' in placement;
}

/**
 * One hop down a layout, addressing an entry of a placement list.
 *
 * A path of these is how the editor names a placement: the flat list a ship is
 * built from has thrown away which assembly each module was written in, and
 * "the eighth module" is not something a player can edit, because seven of the
 * eight may be copies of one thruster.
 */
export interface PathStep {
  /** Index into the placement list at this level. */
  readonly index: number;
  /** Which copy of a repeated instance this descends through; 0 otherwise. */
  readonly copy: number;
  /**
   * Which of an instance's two lists the next step reads: the assembly's own
   * modules, or the extras this copy carries. Absent on the last step, which
   * names a placement rather than descending through one.
   */
  readonly into?: 'assembly' | 'extra';
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
  /** Facing, radians, body frame. */
  readonly angle: number;
}

/** A turret mount in a compiled design, ready to be added to a `Turrets` store. */
export interface DesignTurret {
  /** Index into the design's modules. */
  readonly module: number;
  /** Everything but the body it belongs to, which is only known at spawn. */
  readonly mount: Omit<TurretSpec, 'owner'>;
  readonly gun: GunStats;
  /** How far this mount alone is worth shooting at, metres. */
  readonly reach: number;
  /** What this mount goes after: its archetype's doctrine, with its own overrides. */
  readonly targeting: Targeting;
}

export interface ShipDesign {
  readonly name: string;
  readonly modules: readonly DesignModule[];
  /** Total mass, kg. */
  readonly mass: number;
  /** Moment of inertia about the centre of mass, kg·m². */
  readonly inertia: number;
  /** Bounding-circle radius about the centre of mass, metres. */
  readonly radius: number;
  /** Where the centre of mass sat in the blueprint's own frame, metres. */
  readonly centreOfMassX: number;
  readonly centreOfMassY: number;
  readonly thrusters: readonly ThrusterSpec[];
  /**
   * Which of those the designer meant to point at things, as indices into
   * `thrusters`. Almost always empty, which is why it is a list rather than a
   * flag on each: flying a ship then costs one length check instead of a walk
   * over every engine it has.
   */
  readonly weaponThrusters: readonly number[];
  /** Shared by every ship built to this design. */
  readonly thrusterLayout: ThrusterLayout;
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
   * How far out this ship's guns are worth using, metres.
   *
   * Derived from the guns themselves rather than configured: a round is worth
   * firing while the lead it needs is still a guess worth making, which is a
   * couple of seconds of flight, and a beam arrives instantly and is limited
   * by how long it has to be held on one spot. Zero for a ship with no guns.
   *
   * Doctrine's ranges are fractions of this, so one doctrine means the same
   * thing on a fighter and on a capital.
   */
  readonly reach: number;
  /** What a ship of this design does when it has no orders. */
  readonly doctrine: Doctrine;
}

/** Corner offsets of a module, body frame, written into `out` as x,y pairs. */
function corners(m: ModuleSpec, out: number[]): void {
  const a = m.angle ?? 0;
  const c = cos(a);
  const s = sin(a);
  const hl = m.length * 0.5;
  const hw = m.width * 0.5;
  // About the box's middle, which a thruster's position is not.
  const mid = moduleCentre(m);
  let k = 0;
  for (let i = 0; i < 4; i++) {
    // (+,+), (+,-), (-,-), (-,+) so the corners come out in order round the box.
    const dl = i < 2 ? hl : -hl;
    const dw = i === 0 || i === 3 ? hw : -hw;
    out[k++] = mid.x + dl * c - dw * s;
    out[k++] = mid.y + dl * s + dw * c;
  }
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
  corners(a, ca);
  corners(b, cb);

  // Four candidate axes: the two face normals of each box. In the plane that
  // is all of them, because a box's edges are its normals rotated a quarter
  // turn.
  const angleA = a.angle ?? 0;
  const angleB = b.angle ?? 0;
  const axes = [
    cos(angleA), sin(angleA),
    -sin(angleA), cos(angleA),
    cos(angleB), sin(angleB),
    -sin(angleB), cos(angleB),
  ];

  for (let i = 0; i < axes.length; i += 2) {
    const ax = axes[i]!;
    const ay = axes[i + 1]!;

    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (let k = 0; k < 8; k += 2) {
      const pa = ca[k]! * ax + ca[k + 1]! * ay;
      const pb = cb[k]! * ax + cb[k + 1]! * ay;
      minA = min(minA, pa);
      maxA = max(maxA, pa);
      minB = min(minB, pb);
      maxB = max(maxB, pb);
    }

    if (minA - maxB >= -TOUCH_TOLERANCE || minB - maxA >= -TOUCH_TOLERANCE) {
      return false;
    }
  }
  return true;
}

/** Distance from a point to the nearest point of a module's box, metres. */
function distanceToModule(m: ModuleSpec, px: number, py: number): number {
  const a = m.angle ?? 0;
  const c = cos(a);
  const s = sin(a);
  const mid = moduleCentre(m);
  const dx = px - mid.x;
  const dy = py - mid.y;
  // Into the box's own frame, where the nearest point is a clamp per axis.
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
 * The traverse a turret has before its own ship is in the way.
 *
 * Firing arcs are a property of the layout rather than something authored per
 * mount (DESIGN.md §3): put a gun behind the superstructure and it *is*
 * blocked, and the way to give it a better field of fire is to move it, which
 * is a design decision with costs. The alternative — a number the designer
 * types — would let every turret traverse fully for free and quietly delete
 * the reason ships have silhouettes.
 *
 * What blocks is any module the barrel would sweep into: near enough to be
 * within reach, and subtending bearings the gun would otherwise train through.
 * The half-width returned is symmetric about the mount's rest bearing, and is
 * the narrowest such width over every obstruction, so a mount fouled on one
 * side loses the matching sector on the other, and one near neighbour hides
 * whatever clear sky lies past it. That is pessimistic, and deliberately so.
 * The honest model is two quantities rather than one — a traverse bound saying
 * where the barrel may physically go, and a *set* of permitted firing
 * intervals, since a gun may sweep past superstructure it must not shoot
 * through, and a mount ringed by neighbours has several such gaps. DESIGN.md
 * §12 records the shape of that change; it waits on the blueprint editor,
 * which is what would make a layout's field of fire legible to a player.
 *
 * The test is bearing-only: a module is treated as blocking the whole sector
 * it subtends, without regard for the barrel being able to pass over a low
 * module or stop short of a distant one. In a deck plan that is the right
 * first answer, because everything drawn is full deck height.
 */
export function firingArc(
  modules: readonly ModuleSpec[],
  index: number,
  reach: number,
): { left: number; right: number } {
  const mount = modules[index]!;
  const from = moduleCentre(mount);
  const rest = normalizeAngle(mount.angle ?? 0);

  let left = 2 * PI;
  let right = 2 * PI;

  for (let i = 0; i < modules.length; i++) {
    if (i === index) continue;
    const other = modules[i]!;
    if (distanceToModule(other, from.x, from.y) > reach) continue;

    const c: number[] = [];
    corners(other, c);

    // Bearings to the corners, taken relative to the bearing of the centre so
    // that the interval never has to be unwrapped.
    const mid = moduleCentre(other);
    const centre = atan2(mid.y - from.y, mid.x - from.x);
    let lo = 0;
    let hi = 0;
    for (let k = 0; k < 8; k += 2) {
      const d = angleDelta(centre, atan2(c[k + 1]! - from.y, c[k]! - from.x));
      lo = min(lo, d);
      hi = max(hi, d);
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

  if(left > PI && right > PI) {
    // There is nothing preventing the turret from rotating freely,
    // call that a half in each direction instead of a whole turn in each.
    return { left: PI, right: PI };
  }

  return {left, right};
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
 * How long a round is worth chasing a target for, seconds.
 *
 * What sets a gun's useful reach. A firing solution leads the target by where
 * it will be, and the further out it is the more of a guess that lead becomes
 * — so this is a statement about when aiming stops being worth the ammunition
 * rather than about how far a round can physically travel, which is much
 * further.
 */
const ENGAGEMENT_FLIGHT_TIME = 2;

/**
 * How far a beam is worth using, metres.
 *
 * A beam arrives instantly at any range, so nothing about its flight limits
 * it; what limits it is having to hold the emitter on one spot long enough to
 * burn through, which gets harder the further off the target is.
 */
const BEAM_REACH = 1500;

/**
 * How far one gun is worth shooting at, metres.
 *
 * A ship's reach is the best of these, and a mount's own reach is this — the
 * distinction is what lets a capital hold at artillery range while its
 * close-in mounts pick targets they can actually hit.
 */
export function gunReach(gun: GunStats): number {
  return gun.type === GunType.Beam ? BEAM_REACH : gun.muzzleSpeed * ENGAGEMENT_FLIGHT_TIME;
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
 * aft thruster reflected onto the far beam would compile a hair differently
 * from its unreflected twin. And `-0` compares equal to `0` while having
 * different bits, which a checksum over raw doubles notices even though
 * nothing else does.
 */
function foldAngle(a: number): number {
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
  return out;
}

/**
 * The same expansion, with each module paired to the placement that wrote it.
 *
 * Separate from `expandBlueprint` because everything the simulation does works
 * on the flat list and would only be paying for a second array; separate from
 * a walk of its own because a second walk is a second set of rules about
 * mirroring, repetition and extras, and the two would drift. An editor
 * selecting a module needs to reach the *placement* — which may be one
 * thruster drawn eight times — and it has to be this walk that says so.
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
    if (step.into === 'assembly') return { root: step.assembly ?? '', from: i + 1 };
  }
  // No hop into an assembly: the placement is written in the layout itself,
  // which is the one definition with no name.
  return { root: '', from: 0 };
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
    if (step.into === 'extra') {
      list = entry.extra ?? [];
    } else {
      const assembly = blueprint.assemblies?.[entry.use];
      if (assembly === undefined) return null;
      list = assembly.modules;
    }
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
        trail.push({ index, copy, into: 'assembly', assembly: placement.use });
        place(assembly.modules, blueprint, cx, cy, crot, flipped, depth + 1, out, origins, trail, writtenIn);
        trail.pop();
        // Extras come after what the assembly defines, in the same frame. The
        // ordering is worth noticing rather than assuming harmless: module
        // order decides thruster allocation and firing order, so moving a part
        // out of a definition and into an instance's extras moves it down the
        // list and changes the ship slightly, even though nothing about its
        // geometry has.
        if (placement.extra !== undefined) {
          trail.push({ index, copy, into: 'extra' });
          place(placement.extra, blueprint, cx, cy, crot, flipped, depth + 1, out, origins, trail, writtenIn);
          trail.pop();
        }

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
    if (placement.reinforcement !== undefined) spec.reinforcement = placement.reinforcement;
    if (placement.barrels !== undefined) spec.barrels = placement.barrels;
    if (placement.nozzle !== undefined) spec.nozzle = placement.nozzle;
    if (placement.traverse !== undefined) spec.traverse = placement.traverse;
    if (placement.weapon !== undefined) spec.weapon = placement.weapon;
    if (placement.targeting !== undefined) spec.targeting = placement.targeting;
    if (placement.notes !== undefined) spec.notes = placement.notes;
    out.push(spec);
    if (origins !== null) {
      origins.push({ path: [...trail, { index, copy: 0 }], rotation, mirrored, instanceFrame });
    }
    if (out.length > MAX_EXPANDED_MODULES) {
      throw new Error(
        `${blueprint.name}: expands to more than ${MAX_EXPANDED_MODULES} modules`,
      );
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
        return `${blueprint.name}: assembly ${placement.use} contains itself (${[...path, placement.use].join(' -> ')})`;
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

      // Extras belong to the instance rather than to the assembly it places,
      // so they are walked at the enclosing path — an extra referring back to
      // the assembly that *contains* this instance is still a cycle, but one
      // referring to the assembly being placed here is not.
      if (placement.extra !== undefined) {
        const inExtra = walk(placement.extra);
        if (inExtra !== null) return inExtra;
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
 * Measured about the middle of each box, which a thruster's position is not:
 * growing a thruster about the point it is *mounted* by would add its whole
 * skin astern and have an engine reaching towards its own exhaust.
 */
export function contactWidth(spec: ModuleSpec, other: ModuleSpec): number {
  // Only the part of each that may be welded at all, which is the whole of
  // most modules and a hull weapon's block: a barrel out in the open is not
  // somewhere to hang a ship from.
  const a = weldBox(spec);
  const b = weldBox(other);
  const aa = a.angle ?? 0;
  const ba = b.angle ?? 0;
  const aux = cos(aa);
  const auy = sin(aa);
  const bux = cos(ba);
  const buy = sin(ba);
  const half = ATTACHMENT_TOLERANCE * 0.5;
  const ahl = a.length * 0.5 + half;
  const ahw = a.width * 0.5 + half;
  const bhl = b.length * 0.5 + half;
  const bhw = b.width * 0.5 + half;
  const ac = moduleCentre(a);
  const bc = moduleCentre(b);
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;

  const axes = [aux, auy, -auy, aux, bux, buy, -buy, bux];
  let least = Infinity;
  let nx = 0;
  let ny = 0;
  for (let k = 0; k < axes.length; k += 2) {
    const px = axes[k]!;
    const py = axes[k + 1]!;
    const ea = boxExtent(ahl, ahw, aux, auy, px, py);
    const eb = boxExtent(bhl, bhw, bux, buy, px, py);
    const overlap = ea + eb - abs(dx * px + dy * py);
    if (overlap <= 0) return 0;
    if (overlap < least) {
      least = overlap;
      nx = px;
      ny = py;
    }
  }

  // Along the join rather than across it, and no wider than the narrower of
  // the two: a small module welded to the middle of a big one is joined by
  // all of itself and by only part of the other.
  const px = -ny;
  const py = nx;
  const ea = boxExtent(a.length * 0.5, a.width * 0.5, aux, auy, px, py);
  const eb = boxExtent(b.length * 0.5, b.width * 0.5, bux, buy, px, py);
  return max(0, min(ea + eb - abs(dx * px + dy * py), min(ea, eb) * 2));
}

/** A box's extent along `(nx, ny)` from its own centre, metres. */
function boxExtent(
  hl: number,
  hw: number,
  ux: number,
  uy: number,
  nx: number,
  ny: number,
): number {
  // The width axis is the length axis turned a quarter turn, so its dot with
  // the probe is the cross product of the two.
  return hl * abs(ux * nx + uy * ny) + hw * abs(-uy * nx + ux * ny);
}

/**
 * Whether two modules are bolted together: their faces touching, or within
 * the attachment tolerance of touching.
 */
function modulesAttached(a: ModuleSpec, b: ModuleSpec): boolean {
  return contactWidth(a, b) > 0;
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

  const anchor = live.find((index) => modules[index]!.kind === 'core');
  if (anchor === undefined) return [];

  const attached = new Set<number>([anchor]);
  const frontier = [anchor];

  while (frontier.length > 0) {
    const at = frontier.pop()!;
    for (const other of live) {
      if (attached.has(other)) continue;
      if (!modulesAttached(modules[at]!, modules[other]!)) continue;
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
        if (!modulesAttached(modules[group[k]!]!, modules[other]!)) continue;
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

  for (let i = 0; i < modules.length; i++) {
    for (let k = i + 1; k < modules.length; k++) {
      if (modulesOverlap(modules[i]!, modules[k]!)) {
        faults.push({ message: `${blueprint.name}: modules ${i} and ${k} overlap`, modules: [i, k] });
      }
    }
  }

  // A ship is flown from a core, so a layout without one is a hull and not a
  // ship. It is the anchor every other rule about how the layout hangs
  // together is stated against, which is why it is checked before them. A
  // layout with nothing in it at all is one mistake and is already one
  // complaint, so it does not earn this one as well.
  if (
    modules.length > 0 &&
    !modules.some((spec) => spec.kind === 'core' && moduleProblem(spec) === null)
  ) {
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
    const which = group.join(', ');
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
  const problem = blueprintProblem(blueprint);
  if (problem !== null) throw new Error(`Invalid blueprint — ${problem}`);
  return compileDraft(blueprint);
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

  return designFrom(
    blueprint.name,
    specs,
    specs.map(moduleStats),
    layoutIndex,
    blueprint.doctrine ?? DEFAULT_DOCTRINE,
  );
}

/**
 * The design that part of a ship makes on its own, once the rest has come off.
 *
 * Everything is derived again from the modules that are left — mass, the
 * centre of mass they turn about, inertia, bounding radius, which thrusters
 * and guns went with them — because a chunk is a ship-shaped thing that
 * happens to have no crew, and nothing downstream should have to ask whether
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
  for (let k = 0; k < keep.length; k++) {
    const module = design.modules[keep[k]!]!;
    specs.push(module.spec);
    stats.push(module.stats);
    layoutIndex.push(module.index);
  }
  return designFrom(design.name, specs, stats, layoutIndex, design.doctrine);
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
): ShipDesign {
  const centres = specs.map(moduleCentre);
  let mass = 0;
  let comX = 0;
  let comY = 0;
  for (let i = 0; i < specs.length; i++) {
    const m = stats[i]!.mass;
    mass += m;
    comX += centres[i]!.x * m;
    comY += centres[i]!.y * m;
  }
  comX /= mass;
  comY /= mass;

  const modules: DesignModule[] = [];
  const thrusters: ThrusterSpec[] = [];
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
    // thruster — a point on the same line of action as its mounting, so the
    // force and torque it delivers are the same either way.
    const x = centres[i]!.x - comX;
    const y = centres[i]!.y - comY;
    const angle = normalizeAngle(spec.angle ?? 0);

    // Parallel axis: each module's own inertia, carried out to where it sits.
    inertia += s.inertia + s.mass * (x * x + y * y);

    corners(spec, c);
    for (let k = 0; k < 8; k += 2) {
      const dx = c[k]! - comX;
      const dy = c[k + 1]! - comY;
      radius = max(radius, sqrt(dx * dx + dy * dy));
    }

    modules.push({ spec, stats: s, x, y, angle, index: layoutIndex[i]! });

    if (spec.kind === 'core') {
      cores.push(modules.length - 1);
    } else if (spec.kind === 'thruster') {
      thrusters.push({
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
      // A hull weapon trains about the root of its barrel, not about the
      // middle of the module — the block is welded into the ship and only the
      // tube moves. Everything downstream measures from the mount point, so
      // this is where the mount point goes.
      const px = x + cos(angle) * mount.pivot;
      const py = y + sin(angle) * mount.pivot;
      radius = max(radius, sqrt(px * px + py * py) + gun.barrelLength);

      // Three limits, and the narrowest wins. The barrel has to stay inside
      // the opening it comes out of, which is the archetype's own bound and is
      // usually single figures; the layout may ask for less than that, and
      // pays less for the bed; and the ship may be in the way of even that,
      // which is the question every mount is asked.
      const reach = gun.type === GunType.Beam ? Infinity : gun.barrelLength;
      const arc = firingArc(specs, i, reach);
      const limit = mountTraverse(spec);
      // Only the barrels swing, so that is what the drive is sized against.
      const accel = traverseAccel(s.mass, s.swingInertia);

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
          muzzleOffset: gun.barrelLength,
        },
        gun,
        reach: gunReach(gun),
        targeting: resolveTargeting(spec.targeting, defaultTargeting(spec.kind)),
      });
    } else if ((spec.kind === 'turret' || spec.kind === 'beamTurret') && s.gun !== null) {
      const gun = s.gun;
      // The breech sits at the middle of the mount and the barrel reaches out
      // from there, so the muzzle traces a circle of that radius as the gun
      // trains — which is what the shot leaves from, and what the hull's
      // bounding circle has to contain.
      radius = max(radius, sqrt(x * x + y * y) + gun.barrelLength);

      // What can block the mount, which is a different question for the two
      // archetypes and only looks like the same one because a gun's answer is
      // also its barrel length.
      //
      // A gun is blocked by whatever its *barrel* would foul while training,
      // so only what lies within a barrel's length of the mount counts. That
      // is an approximation — ROADMAP.md §12 has the rest — and it stands in
      // for the mask on where the gun may shoot, which is a wider thing.
      //
      // A beam has nothing that sweeps: the emitter housing is a stub, and on
      // barrel length alone a beam mount would train through its own ship
      // without noticing. What blocks a beam is structure in the path of the
      // beam itself, at any distance, so every module on the hull is a
      // candidate. For a beam the two masks are therefore the same thing, and
      // this is the real one rather than a stand-in for it.
      const reach = gun.type === GunType.Beam ? Infinity : gun.barrelLength;
      const arc = firingArc(specs, i, reach);

      // One drive, so one figure: the rate limit is what this acceleration
      // reaches in the drive's spin-up time.
      const accel = traverseAccel(s.mass, s.inertia);

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
        },
        gun,
        reach: gunReach(gun),
        targeting: resolveTargeting(spec.targeting, defaultTargeting(spec.kind)),
      });
    }
  }

  let reach = 0;
  for (const turret of turrets) reach = max(reach, turret.reach);

  const weaponThrusters: number[] = [];
  for (let t = 0; t < thrusters.length; t++) {
    if (thrusters[t]!.weapon === true) weaponThrusters.push(t);
  }

  // What each engine exhausts into, ray by ray. A plume needs it every step
  // and nothing in a battle can change it: an engine firing into its own hull
  // is firing into it for as long as the hull is one piece, and a piece cut
  // off is a design of its own that works this out again.
  //
  // What comes out of it is `escaping` — the share of the exhaust that leaves
  // the ship at all, and therefore the share of the rated thrust the ship
  // actually gets. A ray stopped by the ship's own structure hands its
  // momentum straight back, so it is not thrust; a ray stopped beyond the
  // flame's own end never had anything left to hand back, and does not count.
  const exhaust = new HullPath();
  const blocks: number[] = [];
  const blockedAt: number[] = [];
  for (const thruster of thrusters) {
    const escaping = exhaustObstruction(
      { modules },
      thruster.module!,
      thruster.maxThrust,
      exhaust,
      blocks,
      blockedAt,
    );
    thruster.blocks = [...blocks];
    thruster.blockedAt = [...blockedAt];
    thruster.escaping = escaping;
  }

  return {
    name,
    modules,
    reach,
    doctrine,
    mass,
    inertia,
    radius,
    centreOfMassX: comX,
    centreOfMassY: comY,
    thrusters,
    weaponThrusters,
    thrusterLayout: new ThrusterLayout(thrusters),
    turrets,
    cores,
  };
}
