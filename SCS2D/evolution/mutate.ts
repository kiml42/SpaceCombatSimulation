import {
  blueprintProblem,
  compileDraft,
  contactWidth,
  expandBlueprint,
  isInstance,
  MAX_REPEAT,
  modulesOverlap,
  settleIds,
  topId,
  type Assembly,
  type AssemblyInstance,
  type Blueprint,
  type Placement,
} from '../sim/blueprint.js';
import {
  APPROACH_FIELDS,
  DEFAULT_DOCTRINE,
  defaultTargeting,
  MOUNT_TARGETING_FIELDS,
  NON_NEGATIVE_FIELDS,
  ORDERED_FIELDS,
  POSITIVE_FIELDS,
  SHIP_TARGETING_FIELDS,
  TARGETING_FIELDS,
  toDoctrine,
  type Doctrine,
  type Targeting,
} from '../sim/doctrine.js';
import { abs, clamp, cos, floor, HALF_PI, max, min, PI, round, sin, sqrt } from '../sim/math.js';
import { canShape, isTriangle, TRIANGLE_CORNERS, triangleOf, wedge } from '../sim/shape.js';
import { degreesToRadians, radiansToDegrees } from '../sim/blueprintFile.js';
import {
  barrelCalibres,
  DEFAULT_NOZZLE_WIDTHS,
  MAX_BARREL_CALIBRES,
  readsBarrelCalibres,
  isWeaponMount,
  canThicken,
  DEFAULT_BURST_SPEED,
  DEFAULT_FRAGMENTS,
  DEFAULT_FUSE,
  firesShells,
  MAX_FRAGMENTS,
  readsFuse,
  readsSealing,
  readsDrainPriority,
  readsFill,
  readsCraft,
  moduleProblem,
  mountTraverse,
  isHullMount,
  MODULE_KINDS,
  blockCentre,
  bodySpec,
  moduleCentre,
  refitModule,
  shapeModule,
  type ModuleKind,
  type ModuleSpec,
} from '../sim/modules.js';
import { pushNeighbours, sharedFace, shiftSeam, type SharedFace } from '../sim/push.js';
import { Rng } from '../sim/rng.js';
import { affords, billOf, isLimited, NO_BUDGET, type Budget } from '../sim/bill.js';

/**
 * How one blueprint becomes a different one: the operator a generation is
 * bred with.
 *
 * **What it changes is the layout's own text.** A module written inside an
 * assembly is written once however many copies are placed, so mutating it
 * changes every copy — which is the point of assemblies and the reason a
 * lineage stays legible instead of drifting into eight slightly different
 * engines. The same holds in reverse: a placement moved is one copy moved.
 *
 * **The layout rules are the arbiter.** Nothing here knows what makes a ship
 * buildable; it makes a candidate and asks `blueprintProblem`. A candidate
 * that is refused is thrown away and another is drawn, rather than repaired —
 * a repair rule would be a second opinion about what a ship is, and the two
 * would disagree eventually.
 *
 * That makes the acceptance rate the thing to watch rather than the validity:
 * a ship is a tight packing of boxes, so a careless edit nearly always
 * detaches something or drives it through its neighbour. Two rules do most of
 * the work of keeping the rate usable — sizes change by moving *one face*, so
 * the opposite face stays against whatever it was attached to, and an edit
 * that breaks the ship is undone on its own rather than taking the rest of the
 * child with it.
 */

/** How far a child may be from its parent, and how hard to try. */
export interface MutationLimits {
  /**
   * How far a number drifts, as a share of its own scale: the spread of the
   * bell every number is drawn from, every generation (`drift`).
   */
  readonly magnitude: number;
  /**
   * Draws within this many spreads of zero change nothing, so a number is as
   * often left alone as nudged, and a nudge is never too small to matter.
   */
  readonly deadZone: number;
  /** Chance a draw comes from a bell `TAIL_WIDTH` times as wide: the rare large mutation. */
  readonly tail: number;
  /** Chance each placement has its geometry changed: a face, a seam, a slide or a turn. */
  readonly geometry: number;
  /** Chance each switch — a kind, a flag, a count of barrels — flips. */
  readonly switches: number;
  /**
   * How far geometry moves, and how big a new module arrives, as a share of
   * the ship's median module size (`shipScale`).
   */
  readonly size: number;
  /** How far a module turns when it turns by less than a right angle, radians. */
  readonly turn: number;
  /** Chance of also making one structural edit: a module added, removed or copied. */
  readonly structural: number;
  /**
   * Chance of a small engine bolted to the hull, rolled again after each one
   * added, so two come a chance squared as often as one (`addThrusters`).
   */
  readonly thrusters: number;
  /** Chance of the child's name drifting a letter from its parent's (`driftName`). */
  readonly rename: number;
  /** What a child may not cost more than, in metal, fuel or build time. */
  readonly budget: Budget;
  /** Draws of a structural edit, or of a whole child, before giving up. */
  readonly attempts: number;
  /**
   * How likely each kind is to be what the operator reaches for, as relative
   * weights. A kind weighted zero is one a lineage can never grow into.
   *
   * It governs both a module added and a module refitted, which are the same
   * question asked twice — what is worth trying here — and answering them
   * apart would mean a run told to breed engines still turning its engines
   * into gun mounts half the time.
   */
  readonly kinds: KindWeights;
  /**
   * How far each part of the doctrine drifts, as a multiple of `magnitude`.
   * Zero freezes it.
   */
  readonly doctrine: DoctrineWeights;
  /**
   * How far each sort of number in the build drifts, and how often each sort
   * of switch flips, as multiples of the defaults. Zero freezes it: a run with
   * `move`, `resize`, `refit`, `fittings` and `fighter` at zero, and no
   * structural edits, keeps how a ship is built and tunes everything else.
   */
  readonly build: BuildWeights;
}

export type KindWeights = Readonly<Record<ModuleKind, number>>;

/**
 * - `targeting`: what the ship goes after.
 * - `approach`: the range it fights at, how hard it flies there, ramming and
 *   refuelling.
 * - `escort`: whether it covers friends, and how closely.
 * - `avoidance`: how far it keeps out of everybody's way.
 * - `gunnery`: each weapon's own target preferences.
 */
export type DoctrineWeights = Readonly<
  Record<'targeting' | 'approach' | 'escort' | 'avoidance' | 'gunnery', number>
>;

/**
 * - `move`: where a module or part sits, which way it faces, and mirroring.
 * - `resize`: a module's length and width, and the seams between modules.
 * - `refit`: a module becoming another kind, of the kinds weighted above.
 * - `fittings`: what would take real work on the craft to change — barrels,
 *   their length, nozzles and thickness.
 * - `tuning`: its loadout, which can change on a design someone drew —
 *   reinforcement, sealing, drain priority, traverse, fuses, fragments, burst speed, and an
 *   engine used as a weapon.
 * - `fighter`: whether the ship is a fighter, which changes how it is flown
 *   and how others target it.
 * - `shape`: whether structure and tanks become triangles — arriving as a
 *   wedge, losing a corner, or walking one. Zero keeps every module a box,
 *   which is also the cheapest a run can be: a hull with wedges in it compiles
 *   about half as dear again as the same hull in boxes.
 *
 * How many times a row repeats is a structural edit, not a number.
 */
export type BuildWeights = Readonly<
  Record<'move' | 'resize' | 'refit' | 'fittings' | 'tuning' | 'fighter' | 'shape', number>
>;

/** Every number as likely as every other, doctrine or build. */
export const DEFAULT_DOCTRINE_WEIGHTS: DoctrineWeights = {
  targeting: 1,
  approach: 1,
  escort: 1,
  avoidance: 1,
  gunnery: 1,
};

/** Doctrine weights in full, the defaults filling in whatever is not given. */
export function doctrineWeights(given?: Partial<DoctrineWeights>): DoctrineWeights {
  return { ...DEFAULT_DOCTRINE_WEIGHTS, ...given };
}

export const DEFAULT_BUILD_WEIGHTS: BuildWeights = {
  move: 1,
  resize: 1,
  refit: 1,
  fittings: 1,
  tuning: 1,
  fighter: 1,
  shape: 1,
};

/** Approach fields that are about covering a friend, and the targeting urge to. */
const ESCORT_FIELDS: readonly string[] = ['escortWeight', 'escortRadii', 'escort', 'escortMinRadii'];
const AVOIDANCE_FIELDS: readonly string[] = ['separation', 'separationRadii', 'avoidHorizon', 'dodgeSpeed'];

/**
 * What the operator reaches for, unless a run says otherwise.
 *
 * **Weighted by what is worth having at the size a guess arrives in.** A new
 * module is small beside the ship it joins — half its median module — and the
 * kinds are nothing like equal at that size: thrust follows the nozzle's area, so six small engines are six small
 * engines' worth of push and, being spread about the hull, are torque as well
 * — where six small guns are six peashooters that a single grown mount beats
 * outright, and six small plates of structure are ballast. A gun and a hull
 * both want *size*, which mutation gets to by growing one module over many
 * generations rather than by adding more of them, so the kinds that pay off
 * small are the ones worth trying often.
 *
 * Structure stays common because it is what everything else bolts to and how
 * a hull reaches somewhere new; a core is rare because a hull needs one and
 * rarely wants three — though a second is exactly what makes a ship survive
 * being cut in half, so the chance is not zero.
 */
export const DEFAULT_KINDS: KindWeights = {
  engine: 5,
  structure: 4,
  // Fuel is what an engine is worth anything with, past what a core carries.
  tank: 2,
  turret: 2,
  beamTurret: 1,
  // A weapon let into the hull is a weapon: it wants size for exactly the
  // reason a turret does, so it is reached for as often and no more. What it
  // has over a turret — a far bigger bore for the width — is worth little at
  // the size it arrives, and what it costs — almost nowhere to point — is a cost at
  // any size, so a lineage that wants one has to grow it.
  hullGun: 2,
  hullBeam: 1,
  core: 1,
  // Rare: worth anything only to a doctrine that goes after wrecks, which a
  // lineage has to find as well.
  claw: 1,
  // A pad serves other ships, so it pays only in a fleet that carries
  // fighters, and a port only with another ship's to meet it: a small chance
  // each, since selection throws out one that does not pay.
  pad: 0.5,
  port: 0.5,
  // Metal is what a gun is worth anything with, past what a core carries.
  hold: 2,
  // Power is what a beam is worth anything with, past what a core carries.
  battery: 1,
  generator: 1,
  // Mends a ship rather than fighting with it, which a long fight can pay for.
  robotBay: 0.5,
  // A slipway builds only once a fleet points it at a ship, and pays only if
  // that ship earns its build time back in the battle: as rare as a pad.
  slipway: 0.5,
};

/**
 * Every number drifts a little every generation, most of the geometry is left
 * alone, and now and then something moves a long way.
 *
 * Nudging everything a little rather than a few things a lot is what keeps
 * pace with a ship that has more numbers on it: a fixed handful of edits is
 * lost on a hull with a hundred knobs. The lineage stays recognisable because
 * the nudges are small, and the tail is what gets it out of a local optimum.
 */
export const DEFAULT_LIMITS: MutationLimits = {
  magnitude: 0.05,
  deadZone: 0.5,
  tail: 0.05,
  geometry: 0.25,
  switches: 0.02,
  size: 0.5,
  turn: PI / 12,
  structural: 0.3,
  thrusters: 0.3,
  rename: 0.1,
  budget: NO_BUDGET,
  attempts: 24,
  kinds: DEFAULT_KINDS,
  doctrine: DEFAULT_DOCTRINE_WEIGHTS,
  build: DEFAULT_BUILD_WEIGHTS,
};

/** How much wider the tail's bell is than the ordinary one. */
const TAIL_WIDTH = 5;

/** A child, and what was done to its parent to get it. */
export interface Mutant {
  readonly blueprint: Blueprint;
  /**
   * One sentence per change, in the order they were made. Empty means nothing
   * could be changed and the parent is being returned, which is the one
   * outcome a caller has to notice.
   */
  readonly edits: readonly string[];
  /** Draws of a whole child, and of a structural edit, the accepted one included. */
  readonly attempts: number;
}

/**
 * Breed one blueprint from another.
 *
 * **Each edit is kept only if the ship is still a ship**, as if someone were
 * moving things about in the editor and pressing undo whenever it went red,
 * then carrying on with the next part. A candidate is not thrown away whole
 * for one bad edit, which is what lets a big ship take many at once: refused
 * together, a dozen edits that each pass three times in four would deliver
 * one child in thirty.
 *
 * The generator is drawn from on every edit, kept or not, so a run is
 * reproducible from its seed but the draws a child costs are not fixed.
 */
export function mutate(written: Blueprint, rng: Rng, limits?: Partial<MutationLimits>): Mutant {
  // Bred from with an id on every placement, and giving one to every placement
  // it adds or copies, so a child can be matched module by module to its parent.
  const parent = settleIds(written);
  // Merged a key at a time, so naming one kind's weight does not silently
  // zero the four not mentioned.
  const bounds: MutationLimits = {
    ...DEFAULT_LIMITS,
    ...limits,
    kinds: { ...DEFAULT_LIMITS.kinds, ...limits?.kinds },
    doctrine: doctrineWeights(limits?.doctrine),
    build: { ...DEFAULT_LIMITS.build, ...limits?.build },
  };
  // Drawn from a generator of its own, seeded from where the run's stands, so
  // a name drifting never moves a draw the design depends on.
  const naming = new Rng(rng.clone().nextUint32() ^ 0x4e414d45);
  const scale = shipScale(parent, bounds.size);

  // A structural edit is drawn on a fresh copy until one is a ship, before
  // anything else is changed, so the rare hard edit is not crowded out by the
  // easy ones or blamed for their failures.
  let draft: Draft | null = null;
  const edits: string[] = [];
  let spent = 0;
  if (rng.chance(bounds.structural)) {
    while (draft === null && spent < bounds.attempts) {
      spent++;
      const candidate = cloneBlueprint(parent);
      const edit = restructure(candidate, rng, bounds, scale);
      if (edit !== null && buildable(candidate.blueprint, bounds.budget)) {
        draft = candidate;
        edits.push(edit);
      }
    }
  }
  draft ??= cloneBlueprint(parent);
  addThrusters(draft, rng, bounds, scale, edits);

  for (let attempt = 1; attempt <= bounds.attempts; attempt++) {
    vary(draft, rng, bounds, scale, edits);
    if (edits.length > 0) {
      return renamed({ blueprint: settleIds(draft.blueprint, topId(parent)), edits, attempts: spent + attempt }, naming, bounds.rename);
    }
  }
  return { blueprint: written, edits: [], attempts: spent + bounds.attempts };
}

/** The longest a name drifts to. */
const LONGEST_NAME = 24;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Sometimes change a letter of the child's name, add one or take one away.
 *
 * So a lineage names itself: two lines bred from the same founder drift apart
 * in name as they do in build, and a design forty generations on reads as a
 * relative of its founder rather than as the founder with a number on. Nothing
 * reads a name but people, so this is the only draw a child can have that
 * changes nothing about how it fights.
 */
function renamed(child: Mutant, rng: Rng, chance: number): Mutant {
  if (!rng.chance(chance)) return child;
  const was = child.blueprint.name;
  const now = driftName(was, rng);
  if (now === was) return child;
  // Not an edit: the edits are what changed about the design, which they
  // bound and which a run's weights choose between, and a name is neither.
  return { ...child, blueprint: { ...child.blueprint, name: now } };
}

/** One letter changed, added or taken away, keeping the case of what it replaces. */
export function driftName(name: string, rng: Rng): string {
  const letter = (like: string | undefined): string => {
    const drawn = LETTERS[rng.nextInt(LETTERS.length)]!;
    return like !== undefined && like !== like.toLowerCase() ? drawn.toUpperCase() : drawn;
  };
  const at = rng.nextInt(max(1, name.length));
  const op = rng.nextInt(3);
  if (op === 0 && name.length < LONGEST_NAME) return name.slice(0, at + 1) + letter(undefined) + name.slice(at + 1);
  if (op === 1 && name.length > 2 && name[at] !== ' ') return name.slice(0, at) + name.slice(at + 1);
  const old = name[at];
  if (old === undefined || !/[a-z]/i.test(old)) return name;
  return name.slice(0, at) + letter(old) + name.slice(at + 1);
}

/**
 * Drift a draft: some of its geometry, now and then a switch, and every
 * number. Each edit that breaks the ship is undone where it was made.
 */
function vary(draft: Draft, rng: Rng, bounds: MutationLimits, scale: Scale, edits: string[]): void {
  for (const part of parts(draft)) {
    if (!rng.chance(bounds.geometry)) continue;
    const edit = attempt(draft, bounds, () => reshape(part, draft, rng, bounds, scale));
    if (edit !== null) edits.push(edit);
  }

  // A refit changes which numbers a module has, so the numbers come after.
  for (const knob of switches(draft)) {
    if (!rng.chance(min(1, bounds.switches * switchWeight(knob, bounds)))) continue;
    const edit = attempt(draft, bounds, () => flip(knob, draft, rng, bounds));
    if (edit !== null) edits.push(edit);
  }

  settle(draft, rng, bounds, numbers(draft), edits);
}

/**
 * Drift numbers all at once, since one nearly never breaks a ship and a layout
 * check apiece would be most of what breeding costs; if they do, each half
 * again, so one bad draw costs a few checks rather than one per number.
 */
function settle(draft: Draft, rng: Rng, bounds: MutationLimits, knobs: readonly NumberKnob[], edits: string[]): void {
  if (knobs.length === 0) return;
  const before = capture(draft);
  const drifted: string[] = [];
  for (const knob of knobs) {
    const edit = renumber(knob, draft, rng, bounds);
    if (edit !== null) drifted.push(edit);
  }
  if (drifted.length === 0) return;
  if (buildable(draft.blueprint, bounds.budget)) {
    edits.push(...drifted);
    return;
  }
  restore(draft, before);
  if (knobs.length === 1) return;
  const half = knobs.length >> 1;
  settle(draft, rng, bounds, knobs.slice(0, half), edits);
  settle(draft, rng, bounds, knobs.slice(half), edits);
}

/**
 * Make one edit, and take it back if the ship is no longer one — or if the
 * edit came to nothing, since an operator may have changed something before
 * finding it could not finish.
 */
function attempt(draft: Draft, bounds: MutationLimits, apply: () => string | null): string | null {
  const before = capture(draft);
  const edit = apply();
  if (edit !== null && buildable(draft.blueprint, bounds.budget)) return edit;
  restore(draft, before);
  return null;
}

/** Everything an edit that leaves the list of placements alone can change. */
interface Snapshot {
  readonly placements: Placement[][];
  readonly targeting: Record<string, number>;
  readonly approach: Record<string, number>;
  readonly fighter: boolean;
}

/**
 * Shallow copies are enough: nothing in here writes into a nested object
 * (a step, a block of targeting, a list of corners), only replaces it.
 */
function capture(draft: Draft): Snapshot {
  return {
    placements: draft.lists.map((list) => list.placements.map((placement) => ({ ...placement }))),
    targeting: { ...draft.doctrine.targeting },
    approach: { ...draft.doctrine.approach },
    fighter: draft.blueprint.fighter === true,
  };
}

/** In place, because sites drawn for later edits hold the placements by reference. */
function restore(draft: Draft, snapshot: Snapshot): void {
  draft.lists.forEach((list, i) => {
    list.placements.forEach((placement, j) => {
      const was = snapshot.placements[i]![j]!;
      for (const key of Object.keys(placement)) delete (placement as unknown as Record<string, unknown>)[key];
      Object.assign(placement, was);
    });
  });
  Object.assign(draft.doctrine.targeting, snapshot.targeting);
  Object.assign(draft.doctrine.approach, snapshot.approach);
  if (snapshot.fighter) draft.blueprint.fighter = true;
  else delete draft.blueprint.fighter;
}

// -- Drawing ---------------------------------------------------------------

/**
 * A change drawn from a bell `width` wide: zero inside the dead zone, and now
 * and then from the wider bell of the tail.
 *
 * The bell is the sum of four uniform draws, which is close enough to a
 * normal for this and needs no logarithm, so it is the same on every engine.
 */
export function drift(rng: Rng, bounds: Pick<MutationLimits, 'deadZone' | 'tail'>, width: number): number {
  if (!(width > 0)) return 0;
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += rng.nextFloat();
  // Four uniforms have a variance of a third; this makes it one.
  const z = (sum - 2) * SQRT_3;
  const wide = rng.chance(bounds.tail) ? TAIL_WIDTH : 1;
  if (abs(z) < bounds.deadZone) return 0;
  return z * width * wide;
}

const SQRT_3 = sqrt(3);

/**
 * The yardstick a ship's geometry moves by: half its median module, give or
 * take `size`.
 *
 * A fixed step cannot be right at both ends of the fleet — half a metre is a
 * third of a Dinky and nothing at all to a Gunship's 33-metre gun — which is
 * the editor's own grid finding (DECISIONS.md, 2026-09-24) arrived at again.
 * A median rather than a mean, so one great spine does not decide it.
 */
export interface Scale {
  /** The spread of a face moved, a slide or a seam, metres. */
  readonly spread: number;
  /**
   * What geometry is rounded to: a tenth of the spread, on the editor's ladder
   * of 1, 2 and 5. Fine enough to read as continuous, coarse enough that two
   * faces can land flush again by chance and a file stays legible.
   */
  readonly quantum: number;
  /** The side of a new module. */
  readonly arrival: number;
}

export function shipScale(blueprint: Blueprint, size: number = DEFAULT_LIMITS.size): Scale {
  // By area: the module a point picked anywhere on the hull most likely lies
  // in. A plain median would be pulled down by every small module added, and
  // since new modules arrive at half of it, a lineage would shrink its own
  // yardstick generation by generation.
  const modules = expandBlueprint(blueprint)
    .map((spec) => ({ side: sqrt(spec.length * spec.width), area: spec.length * spec.width }))
    .sort((a, b) => a.side - b.side);
  let total = 0;
  for (const module of modules) total += module.area;
  let median = 1;
  let seen = 0;
  for (const module of modules) {
    seen += module.area;
    median = module.side;
    if (seen >= total / 2) break;
  }
  const spread = max(1e-3, size * median);
  const quantum = ladder(spread / 10);
  return { spread, quantum, arrival: max(quantum, roundTo(spread, quantum)) };
}

/** The largest of 1, 2 or 5 times a power of ten not above `value`. */
function ladder(value: number): number {
  let step = 1;
  while (step > value && step > 1e-6) step /= 10;
  while (step * 10 <= value) step *= 10;
  if (step * 5 <= value) step *= 5;
  else if (step * 2 <= value) step *= 2;
  return tidy(step, 9);
}

function roundTo(value: number, quantum: number): number {
  return tidy(round(value / quantum) * quantum, 6);
}

/** A geometric change: a drift of the ship's spread, rounded to its quantum. */
function stretch(rng: Rng, bounds: MutationLimits, scale: Scale, weight: number): number {
  return roundTo(drift(rng, bounds, scale.spread * weight), scale.quantum);
}

/** Whether a candidate is a ship, and one the budget can afford. */
function buildable(blueprint: Blueprint, budget: Budget): boolean {
  if (blueprintProblem(blueprint) !== null) return false;
  if (!isLimited(budget)) return true;
  // What it sets out with is what it costs, there being no abstract points
  // value for anything (DESIGN.md §2), so fuel and metal it starts without are
  // saved. Compiling is the only way to know it.
  return affords(budget, billOf(compileDraft(blueprint)));
}

// -- The layout, in a form that can be edited ------------------------------

/**
 * A blueprint being worked on, with every list of placements written in it
 * collected as the walk that copied them found them.
 *
 * Holding the lists is what makes the operators short: a module is mutated
 * through the array it is written in, so removing it or adding a neighbour
 * beside it needs no path machinery. The label is what an edit is reported
 * against, since "module 7" of the expanded ship is not a thing anyone can
 * find in the file.
 */
interface Draft {
  readonly blueprint: Blueprint;
  /**
   * Mutable, because an operator that groups modules into a new assembly adds
   * a list the knobs drawn after it should be able to reach.
   */
  readonly lists: PlacementList[];
  /**
   * The assembly table, as the one object the blueprint also holds — so an
   * assembly written here is written on the child without anything being
   * reattached.
   */
  readonly assemblies: Record<string, Assembly>;
  /** Materialised on the child, so every field is a knob. */
  doctrine: MutableDoctrine;
}

interface PlacementList {
  readonly label: string;
  readonly placements: Placement[];
}

interface MutableDoctrine {
  targeting: Record<string, number>;
  approach: Record<string, number>;
}

function cloneBlueprint(parent: Blueprint): Draft {
  const lists: PlacementList[] = [];
  const doctrine = spreadDoctrine(toDoctrine(parent.doctrine));

  const assemblies: Record<string, Assembly> = {};
  for (const [name, assembly] of Object.entries(parent.assemblies ?? {})) {
    const modules = clonePlacements(assembly.modules, name, lists);
    assemblies[name] =
      assembly.notes === undefined ? { modules } : { modules, notes: assembly.notes };
  }

  const blueprint: Blueprint = {
    name: parent.name,
    modules: clonePlacements(parent.modules, 'layout', lists),
    doctrine: doctrine as unknown as Doctrine,
  };
  if (parent.notes !== undefined) blueprint.notes = parent.notes;
  if (parent.fighter === true) blueprint.fighter = true;
  // Its fighters ride along unbred, as the fleet's designs do.
  if (parent.hangar !== undefined) blueprint.hangar = parent.hangar;
  if (Object.keys(assemblies).length > 0) blueprint.assemblies = assemblies;

  return { blueprint, lists, assemblies, doctrine };
}

/**
 * Take stock after an edit to the grouping: drop the definitions nothing
 * places any more, and collect the lists again.
 *
 * **Reachability, not a count of instances**, because the instances of an
 * assembly can themselves be written inside another one — so letting a part
 * go can orphan a second part that only that part placed, and a count taken
 * before the first was removed says the second is still in use. Walked from
 * the layout each time instead, which cannot be wrong about that or about
 * anything else it would have to be kept in step with.
 *
 * The lists are rebuilt for the same reason: an operator that patched them by
 * hand would leave the knobs drawn afterwards pointing at placements that are
 * no longer on the ship, and an edit to one of those is an edit that changes
 * nothing while claiming to have changed something.
 */
function refresh(draft: Draft): void {
  const wanted = new Set<string>();
  const lists: PlacementList[] = [];

  const walk = (placements: readonly Placement[], label: string): void => {
    lists.push({ label, placements: placements as Placement[] });
    for (const placement of placements) {
      if (!isInstance(placement)) continue;
      if (wanted.has(placement.use)) continue;
      wanted.add(placement.use);
      const assembly = draft.assemblies[placement.use];
      if (assembly !== undefined) walk(assembly.modules, placement.use);
    }
  };
  walk(draft.blueprint.modules, 'layout');

  for (const name of Object.keys(draft.assemblies)) {
    if (!wanted.has(name)) delete draft.assemblies[name];
  }
  draft.lists.length = 0;
  draft.lists.push(...lists);

  // The one place the blueprint is written to rather than built, since
  // `Blueprint` is readable as an immutable value everywhere else. A layout
  // with no assemblies leaves the key out rather than carrying an empty one,
  // so grouping a module and ungrouping it again gives the file it started
  // with.
  const writable = draft.blueprint as { assemblies?: Record<string, Assembly> };
  if (Object.keys(draft.assemblies).length > 0) writable.assemblies = draft.assemblies;
  else delete writable.assemblies;
}

function clonePlacements(
  placements: readonly Placement[],
  label: string,
  lists: PlacementList[],
): Placement[] {
  const copies: Placement[] = [];
  lists.push({ label, placements: copies });
  for (const placement of placements) {
    if (!isInstance(placement)) {
      copies.push({ ...placement });
      continue;
    }
    const instance: AssemblyInstance = { ...placement };
    if (placement.step !== undefined) instance.step = { ...placement.step };
    copies.push(instance);
  }
  return copies;
}

function spreadDoctrine(doctrine: Doctrine): MutableDoctrine {
  return {
    targeting: { ...doctrine.targeting } as unknown as Record<string, number>,
    approach: { ...doctrine.approach } as unknown as Record<string, number>,
  };
}

// -- Knobs -----------------------------------------------------------------

/** A number that drifts every generation, by a share of its own scale. */
type NumberKnob =
  | { readonly at: 'doctrine'; readonly half: 'targeting' | 'approach'; readonly field: string }
  | { readonly at: 'gunnery'; readonly site: ModuleSite; readonly field: string }
  | {
      readonly at:
        | 'reinforcement'
        | 'nozzle'
        | 'barrelCalibres'
        | 'traverse'
        | 'fuse'
        | 'fragments'
        | 'burstSpeed'
        | 'sealing'
        | 'fill'
        | 'keep';
      readonly site: ModuleSite;
    };

/** A decision rather than a quantity, flipped now and then. */
type SwitchKnob =
  | { readonly at: 'fighter' }
  | { readonly at: 'scale' }
  | {
      readonly at: 'kind' | 'barrels' | 'weapon' | 'main' | 'thick' | 'drainPriority' | 'shape' | 'solid';
      readonly site: ModuleSite;
    }
  | { readonly at: 'mirror'; readonly site: InstanceSite };

/** One way a placement's geometry can change. */
type Reshape = 'face' | 'seam' | 'slide' | 'quarter' | 'angle' | 'vertex';

/** A placement whose geometry may change, as one unit. */
type Part = { readonly module: ModuleSite } | { readonly instance: InstanceSite };

interface ModuleSite {
  readonly spec: ModuleSpec;
  readonly where: string;
  /** The list it is written in, whose other placements a face can push. */
  readonly list: Placement[];
  readonly label: string;
}

interface InstanceSite {
  readonly instance: AssemblyInstance;
  readonly where: string;
}

/** Every placement written in the draft, once each however often it is placed. */
function parts(draft: Draft): Part[] {
  const out: Part[] = [];
  for (const list of draft.lists) {
    for (let i = 0; i < list.placements.length; i++) {
      const placement = list.placements[i]!;
      const where = `${list.label}[${i}]`;
      if (isInstance(placement)) out.push({ instance: { instance: placement, where } });
      else out.push({ module: { spec: placement, where, list: list.placements, label: list.label } });
    }
  }
  return out;
}

function moduleSites(draft: Draft): ModuleSite[] {
  const out: ModuleSite[] = [];
  for (const part of parts(draft)) if ('module' in part) out.push(part.module);
  return out;
}

/** Whether a kind has a facing that matters, so turning it is a change. */
function hasFacing(kind: ModuleKind): boolean {
  return (
    kind !== 'structure' &&
    kind !== 'tank' &&
    kind !== 'hold' &&
    kind !== 'core' &&
    kind !== 'battery' &&
    kind !== 'generator' &&
    kind !== 'robotBay'
  );
}

/** The ways a module's geometry can change. */
function reshapes(spec: ModuleSpec): Reshape[] {
  if (isTriangle(spec)) return ['seam', 'slide', 'vertex', ...(hasFacing(spec.kind) ? (['angle'] as const) : [])];
  const out: Reshape[] = ['face', 'seam', 'slide', 'quarter'];
  if (hasFacing(spec.kind)) out.push('angle');
  return out;
}

function reshapeWeight(reshape: Reshape, { build }: MutationLimits): number {
  switch (reshape) {
    case 'face':
    case 'seam':
      return build.resize;
    case 'slide':
    case 'quarter':
    case 'angle':
      return build.move;
    case 'vertex':
      return build.shape;
  }
}

/** Change one placement's geometry, by one of the ways open to it, drawn by weight. */
function reshape(part: Part, draft: Draft, rng: Rng, bounds: MutationLimits, scale: Scale): string | null {
  if ('instance' in part) {
    return bounds.build.move > 0 ? movePlacement(part.instance, rng, bounds, scale) : null;
  }
  const site = part.module;
  const open = reshapes(site.spec);
  let total = 0;
  for (const way of open) total += max(0, reshapeWeight(way, bounds));
  if (!(total > 0)) return null;
  let draw = rng.nextFloat() * total;
  let way = open[open.length - 1]!;
  for (const each of open) {
    draw -= max(0, reshapeWeight(each, bounds));
    if (draw < 0) {
      way = each;
      break;
    }
  }
  const weight = reshapeWeight(way, bounds);
  switch (way) {
    case 'face':
      return moveFace(site, draft, rng, bounds, scale, weight);
    case 'seam':
      return moveSeam(site, rng, bounds, scale, weight);
    case 'slide':
      return slide(site, rng, bounds, scale, weight);
    case 'quarter':
      return quarterTurn(site, rng);
    case 'angle':
      return turnModule(site, rng, bounds, weight);
    case 'vertex':
      return moveVertex(site, rng, bounds, scale, weight);
  }
}

function switches(draft: Draft): SwitchKnob[] {
  // Even while the layout rules it out: the flag is ignored until it does not.
  const out: SwitchKnob[] = [{ at: 'fighter' }, { at: 'scale' }];
  for (const part of parts(draft)) {
    if ('instance' in part) {
      out.push({ at: 'mirror', site: part.instance });
      continue;
    }
    const site = part.module;
    const spec = site.spec;
    out.push({ at: 'kind', site });
    // A box with two free faces can lose the corner between them.
    if (canShape(spec.kind) && !isTriangle(spec)) out.push({ at: 'shape', site });
    if (canThicken(spec)) out.push({ at: 'thick', site });
    if (readsDrainPriority(spec.kind)) out.push({ at: 'drainPriority', site });
    // The outlet count divides a hull mount's opening between more of them,
    // and an engine's are counted by the same field a gun's barrels are.
    if (spec.kind === 'turret' || spec.kind === 'beamTurret' || isHullMount(spec.kind) || spec.kind === 'engine') {
      out.push({ at: 'barrels', site });
    }
    if (isWeaponMount(spec.kind)) out.push({ at: 'main', site });
    if (spec.kind === 'engine') {
      out.push({ at: 'weapon', site });
      // Main means nothing on an engine until it is a weapon.
      if (spec.weapon === true) out.push({ at: 'main', site });
    }
    if (readsFuse(spec.kind)) out.push({ at: 'solid', site });
  }
  return out;
}

function switchWeight(knob: SwitchKnob, { build }: MutationLimits): number {
  switch (knob.at) {
    case 'fighter':
      return build.fighter;
    case 'scale':
      return build.resize;
    case 'kind':
      return build.refit;
    case 'shape':
      return build.shape;
    case 'barrels':
    case 'thick':
      return build.fittings;
    case 'weapon':
    case 'main':
    case 'drainPriority':
    case 'solid':
      return build.tuning;
    case 'mirror':
      return build.move;
  }
}

function flip(knob: SwitchKnob, draft: Draft, rng: Rng, bounds: MutationLimits): string | null {
  switch (knob.at) {
    case 'fighter':
      return enlist(draft.blueprint);
    case 'scale':
      return rescale(draft, rng, bounds);
    case 'kind':
      return refit(knob.site, rng, bounds);
    case 'shape':
      return cutCorner(knob.site);
    case 'thick':
      return thicken(knob.site);
    case 'drainPriority':
      return reprioritise(knob.site, rng);
    case 'barrels':
      return rebarrel(knob.site, rng);
    case 'main':
      return promote(knob.site);
    case 'weapon':
      return rearm(knob.site);
    case 'solid':
      return reload(knob.site);
    case 'mirror':
      return reflect(knob.site);
  }
}

function numbers(draft: Draft): NumberKnob[] {
  const out: NumberKnob[] = [];
  // Only what a hull reads: a ship's aim weights choose a part of a target,
  // and nothing but a mount does that — a knob on one would be a draw that
  // cannot change the battle, and an edit accepted for changing nothing.
  for (const field of SHIP_TARGETING_FIELDS) out.push({ at: 'doctrine', half: 'targeting', field });
  for (const field of APPROACH_FIELDS) out.push({ at: 'doctrine', half: 'approach', field });
  for (const site of moduleSites(draft)) {
    const spec = site.spec;
    out.push({ at: 'reinforcement', site });
    if (readsSealing(spec.kind)) out.push({ at: 'sealing', site });
    // Batteries set out full: charge is not in the budget.
    if (readsFill(spec.kind) && spec.kind !== 'battery') out.push({ at: 'fill', site });
    // How many of its craft a pad or slipway keeps: nothing to count without one.
    if (readsCraft(spec.kind) && spec.craft !== undefined) out.push({ at: 'keep', site });
    if (isWeaponMount(spec.kind)) {
      // How much arc a weapon is built for, which on a hull mount is mass
      // as well as coverage — a fixed gun carries no training gear, and
      // whether that trade is worth taking is exactly what a run is for.
      out.push({ at: 'traverse', site });
      for (const field of MOUNT_TARGETING_FIELDS) out.push({ at: 'gunnery', site, field });
    }
    // What a gun fires: shells or solid shot, and for shells how they burst.
    if (readsFuse(spec.kind) && (spec.fragments ?? DEFAULT_FRAGMENTS) > 1) out.push({ at: 'fragments', site });
    if (firesShells(spec)) out.push({ at: 'fuse', site }, { at: 'burstSpeed', site });
    if (readsBarrelCalibres(spec.kind)) out.push({ at: 'barrelCalibres', site });
    if (spec.kind === 'engine') out.push({ at: 'nozzle', site });
  }
  return out;
}

function numberWeight(knob: NumberKnob, { doctrine, build }: MutationLimits): number {
  switch (knob.at) {
    case 'doctrine':
      if (ESCORT_FIELDS.includes(knob.field)) return doctrine.escort;
      if (AVOIDANCE_FIELDS.includes(knob.field)) return doctrine.avoidance;
      return doctrine[knob.half];
    case 'gunnery':
      return doctrine.gunnery;
    case 'nozzle':
    case 'barrelCalibres':
      return build.fittings;
    default:
      return build.tuning;
  }
}

/**
 * Turn one of a mount's own targeting numbers.
 *
 * A value that lands back on what the archetype does is taken out rather than
 * written down, so a lineage that has wandered back to the default says so,
 * and the block a mount carries stays the list of things it actually wants
 * differently.
 */
function retarget(site: ModuleSite, field: string, jitter: Jitter): string | null {
  const base = defaultTargeting(site.spec.kind) as unknown as Record<string, number>;
  const held = site.spec.targeting as Record<string, number> | undefined;
  const was = held?.[field] ?? base[field]!;
  const scale = max(abs(was), abs(base[field]!)) || TYPICAL.targeting;
  let now = was + jitter(scale);
  if (POSITIVE_FIELDS.includes(field)) now = max(now, 0.01);
  const tidied = tidy(now, 3);
  if (tidied === was) return null;
  const next: Record<string, number> = { ...held };
  if (tidied === base[field]) delete next[field];
  else next[field] = tidied;
  if (Object.keys(next).length === 0) delete site.spec.targeting;
  else site.spec.targeting = next as Partial<Targeting>;
  return `${site.where} ${site.spec.kind}: ${field} ${was} → ${tidied}`;
}

/** A drift of a number by a share of the scale given. */
type Jitter = (scale: number) => number;

function renumber(knob: NumberKnob, draft: Draft, rng: Rng, bounds: MutationLimits): string | null {
  const width = bounds.magnitude * numberWeight(knob, bounds);
  if (!(width > 0)) return null;
  const jitter: Jitter = (scale) => drift(rng, bounds, width * scale);
  if (knob.at === 'doctrine') return turnDoctrine(draft, knob.half, knob.field, jitter);
  // A module's own number is checked against the module at once, which is
  // cheap, so it is not left to fail the whole batch.
  const spec = knob.site.spec;
  const was = { ...spec };
  const edit = renumberModule(knob, jitter);
  if (edit !== null && moduleProblem(spec) !== null) {
    for (const key of Object.keys(spec)) delete (spec as unknown as Record<string, unknown>)[key];
    Object.assign(spec, was);
    return null;
  }
  return edit;
}

function renumberModule(knob: Exclude<NumberKnob, { at: 'doctrine' }>, jitter: Jitter): string | null {
  switch (knob.at) {
    case 'gunnery':
      return retarget(knob.site, knob.field, jitter);
    case 'reinforcement':
      return reinforce(knob.site, jitter);
    case 'nozzle':
      return rebell(knob.site, jitter);
    case 'barrelCalibres':
      return relength(knob.site, jitter);
    case 'traverse':
      return retrain(knob.site, jitter);
    case 'fuse':
      return refuse(knob.site, jitter);
    case 'fragments':
      return refragment(knob.site, jitter);
    case 'burstSpeed':
      return recharge(knob.site, jitter);
    case 'sealing':
      return reseal(knob.site, jitter);
    case 'fill':
      return refill(knob.site, jitter);
    case 'keep':
      return rekeep(knob.site, jitter);
  }
}

/**
 * How big a number is in one half of a doctrine: the mean of the defaults
 * that are not zero.
 *
 * It is the scale to perturb a field by when the field itself offers none —
 * one whose default *is* zero, where both the held value and the reference
 * are nothing to take a fraction of. Without it such a field is not merely
 * slow to discover but unreachable: every draw is a fraction of zero, so it
 * rounds to no change and is refused, and "off by default" quietly means "off
 * for ever". `escortWeight` is the field that makes the point — a population
 * that cannot find it can never be interested in an objective, whatever the
 * match is scoring.
 *
 * The mean of the rest rather than a constant, because what a weight has to
 * compete with is the other weights: a step that cannot be seen beside them
 * is no more use than no step at all.
 */
function typical(half: 'targeting' | 'approach'): number {
  const values = DEFAULT_DOCTRINE[half] as unknown as Record<string, number>;
  const fields = half === 'targeting' ? TARGETING_FIELDS : APPROACH_FIELDS;
  let total = 0;
  let count = 0;
  for (const field of fields) {
    const value = abs(values[field as string]!);
    if (value > 0) {
      total += value;
      count++;
    }
  }
  return count > 0 ? total / count : 1;
}

const TYPICAL = { targeting: typical('targeting'), approach: typical('approach') };

/**
 * Perturb a doctrine number.
 *
 * Scaled by the default doctrine's own value for the field rather than by
 * what the parent holds, so a weight that has reached zero can come back —
 * scaling by the held value alone makes zero an absorbing state, and "ignore
 * this entirely" is a setting a lineage should be able to change its mind
 * about.
 */
function turnDoctrine(
  draft: Draft,
  half: 'targeting' | 'approach',
  field: string,
  jitter: Jitter,
): string | null {
  const held = draft.doctrine[half];
  const reference = (
    DEFAULT_DOCTRINE[half] as unknown as Record<string, number>
  )[field]!;
  const scale = max(abs(held[field]!), abs(reference)) || TYPICAL[half];
  const was = held[field]!;
  let now = was + jitter(scale);
  // Some fields are a size or a distance rather than a weight, and none of
  // those means anything at or below zero. Which they are is the doctrine's
  // own business, not this file's: a rule copied here would be a second
  // opinion about what a doctrine may say, and would be wrong the first time
  // a field was added over there.
  if (POSITIVE_FIELDS.includes(field)) now = max(now, 0.01);
  if (NON_NEGATIVE_FIELDS.includes(field)) now = max(now, 0);
  const tidied = tidy(now, 3);
  // A draw small enough to round away, or one clamped back onto the floor it
  // was already sitting on. Neither is an edit.
  if (tidied === was) return null;
  // Nor one that crosses the other end of its band.
  for (const [lower, upper] of ORDERED_FIELDS) {
    if ((field === lower && tidied > held[upper]!) || (field === upper && tidied < held[lower]!)) return null;
  }
  held[field] = tidied;
  return `doctrine.${half}.${field} ${was} → ${tidied}`;
}

/** The most a whole ship is scaled by in one draw, as a share of `magnitude`. */
const SCALE_SHARE = 0.4;

/**
 * Make the whole ship bigger or smaller: every module's size and position,
 * every corner, and every placement of an assembly and the step between its
 * copies, by one factor about the layout's origin.
 *
 * What resizing module by module cannot do in any number of generations
 * without breaking the ship on the way: a hull whose parts are in proportion
 * at one size can be tried at another in a single step, and the welds survive
 * because contact scales with everything else. The scaling laws do not, so a
 * bigger ship is not a magnified one — its walls, guns and engines are what
 * their new sizes buy — and that is the question the draw asks.
 */
function rescale(draft: Draft, rng: Rng, bounds: MutationLimits): string | null {
  const factor = tidy(1 + drift(rng, { ...bounds, deadZone: 0 }, bounds.magnitude * SCALE_SHARE), 3);
  if (factor === 1 || !(factor > 0)) return null;
  const by = (value: number): number => tidy(value * factor, 4);
  for (const list of draft.lists) {
    for (const placement of list.placements) {
      placement.x = by(placement.x);
      placement.y = by(placement.y);
      if (isInstance(placement)) {
        if (placement.step !== undefined) placement.step = { ...placement.step, x: by(placement.step.x), y: by(placement.step.y) };
        continue;
      }
      if (placement.vertices !== undefined) {
        // A triangle's box is derived from its corners, and its corners kept
        // centred on it, so it goes back through the shaping rather than being
        // scaled field by field.
        const shaped = shapeModule(placement, placement.vertices.map((v) => v * factor));
        if (shaped === null) return null;
        Object.assign(placement, shaped);
        continue;
      }
      placement.length = by(placement.length);
      placement.width = by(placement.width);
    }
  }
  return `whole ship scaled by ${factor}`;
}

/** Make a ship a fighter, or an ordinary ship again. A flip, as `rearm` is. */
function enlist(blueprint: Blueprint): string {
  const was = blueprint.fighter === true;
  if (was) delete blueprint.fighter;
  else blueprint.fighter = true;
  return `fighter: ${was ? 'no longer' : 'now'}`;
}

function reinforce(site: ModuleSite, jitter: Jitter): string | null {
  const was = site.spec.reinforcement ?? 1;
  const now = max(1, tidy(was + jitter(was), 2));
  // Clamped against the floor, a draw downwards from bare walls changes
  // nothing, and is not an edit.
  if (now === was) return null;
  site.spec.reinforcement = now;
  return `${site.where} ${site.spec.kind}: reinforcement ${was} → ${now}`;
}

/**
 * Change what a module is, keeping the space it occupies.
 *
 * **This is the only way a lineage gets a large module of a new kind.**
 * Everything new arrives small and has to be grown, which is right for a
 * guess and wrong as the only path there is: a
 * hull that has spent twenty generations growing a good gun mounting should
 * be able to discover that the same mounting makes a better beam mount,
 * without starting again from nothing. A refit keeps the geometry — the
 * position, the size, the facing, the armour — and changes only what it is
 * for.
 *
 * **An engine is the awkward one.** Its position is its mounting face rather
 * than the middle of its box, so `refitModule` keeps the centre rather than
 * the coordinates. Every kind faces the way what sticks out of it points, so
 * a weapon refitted as an engine keeps its facing and its bell goes where the
 * barrel was. Refitted from a structure or a core, which have no outward
 * face, which way a new engine points is a free choice, so a quarter turn is
 * drawn here and the attempts try different ones.
 *
 * Neither is a nicety: without them a refit into an engine is refused every
 * time, so the one route to a *large* engine is closed and a lineage can only
 * ever have the small ones it adds.
 */
function refit(site: ModuleSite, rng: Rng, bounds: MutationLimits): string | null {
  const was = site.spec.kind;
  const to = pickKind(rng, bounds.kinds, was);
  if (to === null) return null;
  const turn = to === 'engine' && !isWeaponMount(was) ? rng.nextInt(4) * HALF_PI : 0;
  Object.assign(site.spec, refitModule(site.spec, to, turn));
  // **Fields the new kind does not read are kept, not cleared.** They are what
  // this module was, and a lineage that refits a tuned engine into a gun
  // mount and back should get its bell rather than the default: twenty
  // generations of learning survive the detour. Nothing downstream reads a
  // dormant field, `moduleProblem` allows it, and `serialiseBlueprint` leaves
  // it out — so a saved ship still says exactly what it is.
  return `${site.where}: ${was} refitted as ${to}`;
}


/**
 * Add or remove a barrel.
 *
 * Deliberately uncapped. A multi-barrel mount is under-penalised as the
 * scaling laws stand (ROADMAP.md §12), and a lineage that goes to twenty
 * barrels is the GA saying so — which is the answer that question is waiting
 * for, and a cap here would hide it.
 */
function rebarrel(site: ModuleSite, rng: Rng): string | null {
  const was = site.spec.barrels ?? 1;
  const now = max(1, was + (rng.chance(0.5) ? 1 : -1));
  if (now === was) return null;
  site.spec.barrels = now;
  return `${site.where} ${site.spec.kind}: barrels ${was} → ${now}`;
}

/** Past a few exit widths a bell buys almost no more aim. */
const MOST_NOZZLE_WIDTHS = 4;

/**
 * Lengthen or shorten an engine's bell.
 *
 * In exit widths, as the layout has it, so the knob means the same thing on a
 * fighter's engine and a capital's. No bell at all is a legal, bad engine.
 */
function rebell(site: ModuleSite, jitter: Jitter): string | null {
  const was = site.spec.nozzle ?? DEFAULT_NOZZLE_WIDTHS;
  const now = tidy(clamp(was + jitter(1), 0, MOST_NOZZLE_WIDTHS), 3);
  if (now === was) return null;
  site.spec.nozzle = now;
  return `${site.where} ${site.spec.kind}: nozzle ${was} → ${now}`;
}

/**
 * Lengthen or shorten a gun's barrels, by a fraction of what they are — a
 * calibre matters as much on a stub as ten do on a long gun — and by enough
 * to move off a stub at all.
 * Whole calibres, held inside what any barrel may be; one too long for a hull
 * gun's own mount is refused by the layout rules like any other misfit.
 */
function relength(site: ModuleSite, jitter: Jitter): string | null {
  const was = barrelCalibres(site.spec);
  const now = clamp(round(was + jitter(max(was, COUNT_SCALE))), 1, MAX_BARREL_CALIBRES);
  if (now === was) return null;
  site.spec.barrelCalibres = now;
  return `${site.where} ${site.spec.kind}: barrel ${was} → ${now} calibres`;
}

/**
 * Widen or narrow the arc a weapon is built for.
 *
 * In degrees rather than in radians, because the grid a person edits on is
 * degrees and a lineage that lands on 17.3° of traverse is describing a mount
 * nobody would draw. Held at zero from below, which is a real answer — a gun
 * welded to the ship, carrying no training gear — and unbounded above, where
 * the mount's own archetype quietly takes over.
 */
function retrain(site: ModuleSite, jitter: Jitter): string | null {
  const was = mountTraverse(site.spec);
  const now = max(0, tidy(radiansToDegrees(was + jitter(max(was, HALF_PI))), 3));
  const asDegrees = tidy(radiansToDegrees(was), 3);
  if (now === asDegrees) return null;
  site.spec.traverse = degreesToRadians(now);
  return `${site.where} ${site.spec.kind}: traverse ${asDegrees}° → ${now}°`;
}

/**
 * How often a newly added structure or tank arrives as a wedge rather than a
 * box. A minority, because a box is the right guess nearly everywhere and a
 * wedge is the one worth being able to reach.
 */
const SHAPED_ARRIVAL_CHANCE = 0.15;

/**
 * The least a count drifts against, so a short barrel or a few fragments can
 * still move by whole ones.
 */
const COUNT_SCALE = 20;

/** The slowest burst a nudge leaves, m/s. */
const MIN_BURST_SPEED = 1;

/** The least a sealing lining is nudged by, metres, so an unlined tank can start one. */
const SEALING_STEP = 0.01;

/**
 * Thicken or thin a tank's sealing lining, proportionally, never below none and
 * never so thick it leaves no room inside.
 */
function reseal(site: ModuleSite, jitter: Jitter): string | null {
  const was = site.spec.sealing ?? 0;
  const now = max(0, tidy(was + jitter(max(was, SEALING_STEP)), 4));
  if (now === was || moduleProblem({ ...site.spec, sealing: now }) !== null) return null;
  site.spec.sealing = now;
  return `${site.where} ${site.spec.kind}: sealing ${was * 1000} mm → ${now * 1000} mm`;
}

/** Move a tank one place earlier or later in the order its ship drains them. */
function reprioritise(site: ModuleSite, rng: Rng): string | null {
  const was = site.spec.drainPriority ?? 0;
  const now = was + (rng.chance(0.5) ? 1 : -1);
  site.spec.drainPriority = now;
  return `${site.where} ${site.spec.kind}: drain priority ${was} → ${now}`;
}

/**
 * Start a tank fuller or emptier, by up to `magnitude` of a full load, never
 * past either end. Full is left unsaid.
 */
function refill(site: ModuleSite, jitter: Jitter): string | null {
  const was = site.spec.fill ?? 1;
  const now = tidy(min(1, max(0, was + jitter(1))), 3);
  if (now === was) return null;
  if (now < 1) site.spec.fill = now;
  else delete site.spec.fill;
  return `${site.where} ${site.spec.kind}: starts ${round(was * 100)}% full → ${round(now * 100)}%`;
}

/**
 * Change how many of its fighter a pad keeps: a nudge scaled by the count, of
 * at least one either way, and never below none, which is left unsaid.
 */
function rekeep(site: ModuleSite, jitter: Jitter): string | null {
  const was = site.spec.keep ?? 0;
  const step = jitter(max(was, 1));
  const now = max(0, was + (step >= 0 ? max(1, round(step)) : min(-1, round(step))));
  if (now === was) return null;
  if (now > 0) site.spec.keep = now;
  else delete site.spec.keep;
  return `${site.where} ${site.spec.kind}: keeps ${was} ${site.spec.craft} → ${now}`;
}

/**
 * Retime a shell's fuse: a nudge scaled by the fuse itself, so a long one
 * moves as far in proportion as a short one. Zero is a fuse like any other.
 */
function refuse(site: ModuleSite, jitter: Jitter): string | null {
  const was = site.spec.fuse ?? DEFAULT_FUSE;
  const now = max(0, tidy(was + jitter(max(was, DEFAULT_FUSE)), 3));
  if (now === was) return null;
  site.spec.fuse = now;
  return `${site.where} ${site.spec.kind}: fuse ${was} s → ${now} s`;
}

/**
 * Recount a shell's fragments, or change what the gun fires. Mostly a
 * proportional nudge of at least one; sometimes a swap between shells and
 * solid shot, which is a decision rather than a quantity.
 */
function refragment(site: ModuleSite, jitter: Jitter): string | null {
  const was = site.spec.fragments ?? DEFAULT_FRAGMENTS;
  const now = min(MAX_FRAGMENTS, max(2, round(was + jitter(max(was, COUNT_SCALE)))));
  if (now === was) return null;
  site.spec.fragments = now;
  return `${site.where} ${site.spec.kind}: fragments ${was} → ${now}`;
}

/**
 * Swap shells for solid shot, or back: a decision rather than a quantity,
 * so a switch rather than a drift.
 */
function reload(site: ModuleSite): string {
  if ((site.spec.fragments ?? DEFAULT_FRAGMENTS) <= 1) {
    delete site.spec.fragments;
    return `${site.where} ${site.spec.kind}: shells again, ${DEFAULT_FRAGMENTS} fragments`;
  }
  site.spec.fragments = 1;
  return `${site.where} ${site.spec.kind}: solid shot`;
}

/** Re-size a shell's charge by how fast it bursts, in proportion to that speed. */
function recharge(site: ModuleSite, jitter: Jitter): string | null {
  const was = site.spec.burstSpeed ?? DEFAULT_BURST_SPEED;
  const now = max(MIN_BURST_SPEED, tidy(was + jitter(was), 1));
  if (now === was) return null;
  site.spec.burstSpeed = now;
  return `${site.where} ${site.spec.kind}: burst ${was} m/s → ${now} m/s`;
}

/**
 * Point an engine at things, or stop.
 *
 * A flip rather than a nudge, because the thing being mutated is a decision
 * and not a quantity — there is no half-armed engine to land on. It is cheap
 * for the search to try in both directions, which is what a knob with two
 * positions and no cost of its own should be: the fitness of the ship decides
 * whether being shoved about by one's own exhaust was worth the damage.
 */
function rearm(site: ModuleSite): string {
  const was = site.spec.weapon === true;
  if (was) delete site.spec.weapon;
  else site.spec.weapon = true;
  return `${site.where} ${site.spec.kind}: ${was ? 'no longer' : 'now'} a weapon`;
}

/**
 * Put a weapon in the main battery, or take it out: a flip, as `rearm` is.
 */
function promote(site: ModuleSite): string {
  const was = site.spec.main !== false;
  if (was) site.spec.main = false;
  else delete site.spec.main;
  return `${site.where} ${site.spec.kind}: ${was ? 'no longer' : 'now'} main`;
}

/**
 * Make a module thick, or thin again.
 *
 * A flip, as `rearm` is. Thick is heavier wall and a bigger barrel or nozzle,
 * and it stands in the weapons layer: cover for turrets, in their way and in
 * reach of enemy ones. Whether that is worth it is the fitness's call.
 */
function thicken(site: ModuleSite): string {
  const was = site.spec.thick === true;
  if (was) delete site.spec.thick;
  else site.spec.thick = true;
  return `${site.where} ${site.spec.kind}: made ${was ? 'thin' : 'thick'}`;
}

function turnModule(site: ModuleSite, rng: Rng, bounds: MutationLimits, weight: number): string | null {
  const was = site.spec.angle ?? 0;
  const by = drift(rng, bounds, bounds.turn * weight);
  if (by === 0) return null;
  // Unrounded, for the reason `against` gives: a rounded right angle is a
  // module tilted a fraction of a micron into its neighbour.
  site.spec.angle = was + by;
  return `${site.where} ${site.spec.kind}: turned ${degrees(was)}° → ${degrees(site.spec.angle)}°`;
}

/**
 * Turn a box a quarter about one of its corners, so it lies the other way in
 * the same corner: the corner stays put, and so does as much of the two
 * edges that meet there as the shorter side covers.
 *
 * Nearly every other turn takes a welded module apart, since a box tilted at
 * all drives a corner into its neighbour. Kept in the corner, a module tucked
 * between two others can still be tucked between them afterwards. On a kind
 * with no facing it is the box's length and width swapping; on one with a
 * facing it is a real quarter turn, either way, since both lie the same.
 */
function quarterTurn(site: ModuleSite, rng: Rng): string | null {
  const spec = site.spec;
  if (spec.length === spec.width && !hasFacing(spec.kind)) return null;
  const centre = blockCentre(spec);
  const angle = spec.angle ?? 0;
  const c = cos(angle);
  const s = sin(angle);
  const sx = rng.chance(0.5) ? 1 : -1;
  const sy = rng.chance(0.5) ? 1 : -1;
  // The kept corner, then the new middle back from it along the same two
  // edges, with the box's extents along them swapped.
  const lx = sx * (spec.length - spec.width) / 2;
  const ly = sy * (spec.width - spec.length) / 2;
  const middle = { x: centre.x + c * lx - s * ly, y: centre.y + s * lx + c * ly };

  const turned: ModuleSpec = { ...spec, x: 0, y: 0 };
  if (hasFacing(spec.kind)) {
    turned.angle = angle + (rng.chance(0.5) ? HALF_PI : -HALF_PI);
  } else {
    turned.length = spec.width;
    turned.width = spec.length;
  }
  // From the middle back to the position the kind is written by, which for
  // an engine is the face it is bolted on by.
  const offset = blockCentre(turned);
  spec.x = tidy(middle.x - offset.x, 6);
  spec.y = tidy(middle.y - offset.y, 6);
  if (turned.angle !== undefined) spec.angle = turned.angle;
  spec.length = turned.length;
  spec.width = turned.width;
  return `${site.where} ${spec.kind}: a quarter turn about its ${cornerName(sx > 0 ? (sy > 0 ? 0 : 3) : sy > 0 ? 1 : 2)} corner`;
}

/**
 * Move one face of a module, growing or shrinking it by a drift of the ship's
 * spread while the
 * opposite face stays exactly where it was. The face is one with nothing welded
 * to it where there is one, and it moves towards making the module square more
 * often than not, the more so the less square it is.
 *
 * This is the operator that makes geometry worth mutating at all. Scaling a
 * module about its centre moves both its faces, so it comes away from the
 * neighbour on one side and drives into the neighbour on the other, and
 * essentially every draw is refused. Moving one face keeps half the module's
 * attachments by construction.
 *
 * Whatever sits against the face moves with it (`pushNeighbours`), so growing
 * into a neighbour pushes it aside rather than being refused, and shrinking
 * away from one pulls it along rather than leaving it adrift.
 */
function moveFace(
  site: ModuleSite,
  draft: Draft,
  rng: Rng,
  bounds: MutationLimits,
  scale: Scale,
  weight: number,
): string | null {
  const spec = site.spec;
  // Nothing to move on a module that is not a box: its size is its corners,
  // and changing the length and width of the box they fit inside would report
  // a change the ship has not got.
  if (isTriangle(spec)) return null;
  const before = { ...spec };
  // A face nothing is welded to, where there is one, so growing needs nothing pushed.
  const open = openFaces(site);
  let free = 0;
  for (const each of open) if (each) free++;
  let face = rng.nextInt(free > 0 ? free : 4);
  if (free > 0) for (let f = 0; f <= face; f++) if (!open[f]) face++;
  const along = face % 2 === 0;
  const side = face < 2 ? 1 : -1;
  const size = abs(stretch(rng, bounds, scale, weight));
  if (size === 0) return null;

  // Towards square, the likelier the further from it: a sliver of a turret,
  // whose bore its short side sets, all but always grows across.
  const was = along ? spec.length : spec.width;
  const other = along ? spec.width : spec.length;
  const towards = was < other ? 1 : -1;
  const square = was < other ? was / other : other / was;
  const delta = rng.chance(1 - square / 2) ? towards * size : -towards * size;
  const now = tidy(was + delta, 6);
  // A module shrunk out of existence is not a module removed: removal is its
  // own operator, and this one stops a quantum short of nothing.
  if (now < scale.quantum) return null;

  // Where the module's *position* has to go for the other face to stay put.
  // An engine is held on by the face behind it, at -x, and its position is
  // the middle of that face, so lengthening one from the bell end moves
  // nothing at all — every other case moves the box's centre by half the change.
  let localX = 0;
  let localY = 0;
  if (along) {
    if (spec.kind === 'engine') localX = side > 0 ? 0 : -delta;
    else localX = (side * delta) / 2;
  } else {
    localY = (side * delta) / 2;
  }

  const angle = spec.angle ?? 0;
  const c = cos(angle);
  const s = sin(angle);
  spec.x = tidy(spec.x + c * localX - s * localY, 6);
  spec.y = tidy(spec.y + s * localX + c * localY, 6);
  if (along) spec.length = now;
  else spec.width = now;

  // Moved in place, because other knobs drawn for this candidate hold the
  // neighbours by reference.
  let pushed = 0;
  const index = site.list.indexOf(spec);
  if (index >= 0) {
    const moved = pushNeighbours(site.list, index, draft.assemblies, before, spec);
    for (let j = 0; j < moved.length; j++) {
      if (moved[j] === site.list[j]) continue;
      site.list[j]!.x = moved[j]!.x;
      site.list[j]!.y = moved[j]!.y;
      pushed++;
    }
  }

  const change = `${site.where} ${spec.kind}: ${along ? 'length' : 'width'} ${was} → ${now}`;
  return pushed === 0 ? change : `${change}, moving ${pushed} alongside`;
}

/**
 * Which of a box's four faces have nothing welded to them, as `[+x, +y, -x, -y]`.
 *
 * By where a neighbour's middle lies relative to this module's, in this
 * module's own frame, once the two are known to touch at all. That is a
 * heuristic and deliberately so: a module welded across a corner can be
 * counted against either face it straddles. What it feeds is a *draw*, not a
 * law — the layout rules still decide whether what comes out is a ship — and
 * being wrong costs one refused candidate rather than a wrong answer.
 */
function openFaces(site: ModuleSite): boolean[] {
  const spec = site.spec;
  const open = [true, true, true, true];
  const centre = blockCentre(spec);
  const angle = spec.angle ?? 0;
  const c = cos(angle);
  const sn = sin(angle);
  for (const placement of site.list) {
    if (isInstance(placement) || placement === spec) continue;
    if (!(contactWidth(spec, placement) > 0)) continue;
    const other = blockCentre(placement);
    const dx = other.x - centre.x;
    const dy = other.y - centre.y;
    // Into this module's own frame, where a face is an axis.
    const localX = dx * c + dy * sn;
    const localY = -dx * sn + dy * c;
    if (abs(localX) >= abs(localY)) open[localX >= 0 ? 0 : 2] = false;
    else open[localY >= 0 ? 1 : 3] = false;
  }
  return open;
}

/**
 * Cut the corner off a box between two free faces, leaving a right triangle.
 *
 * **The two faces that go are the two nothing is welded to**, so the legs of
 * what is left are the faces that were holding the module on and every weld
 * it had survives at its full width. That is the whole reason this is the
 * shape a lineage may reach for: the general case — a corner moved anywhere —
 * changes two edges at once and takes apart whatever was welded along them,
 * which is what kept shape out of evolution at all (ROADMAP.md §12).
 *
 * It needs exactly two free faces and they must be adjacent. Three or four
 * free faces means the module is barely held on and which corner to cut is a
 * guess rather than a reading; two opposite faces have no corner between them.
 */
function cutCorner(site: ModuleSite): string | null {
  const spec = site.spec;
  if (!canShape(spec.kind) || isTriangle(spec)) return null;

  const open = openFaces(site);
  const free: number[] = [];
  for (let f = 0; f < 4; f++) if (open[f]!) free.push(f);
  if (free.length !== 2) return null;
  // Adjacent, not opposite: +x with -x has no corner between them.
  const [a, b] = [free[0]!, free[1]!];
  if ((a + 2) % 4 === b) return null;

  // The corner where the two free faces meet, and the two that stay.
  const hl = spec.length / 2;
  const hw = spec.width / 2;
  const corners: readonly (readonly [number, number])[] = [
    [hl, hw],
    [-hl, hw],
    [-hl, -hw],
    [hl, -hw],
  ];
  // Face 0 is +x, 1 is +y, 2 is -x, 3 is -y; the corner they share is the one
  // both their signs agree with.
  const sx = (f: number): number => (f === 0 ? 1 : f === 2 ? -1 : 0);
  const sy = (f: number): number => (f === 1 ? 1 : f === 3 ? -1 : 0);
  const cx = sx(a) + sx(b);
  const cy = sy(a) + sy(b);
  const cut = corners.findIndex(([x, y]) => (x > 0) === (cx > 0) && (y > 0) === (cy > 0));
  if (cut < 0) return null;

  const kept = corners.filter((_, i) => i !== cut).flatMap(([x, y]) => [x, y]);
  const shaped = shapeModule(spec, kept);
  if (shaped === null) return null;
  Object.assign(spec, shaped);
  return `${site.where} ${spec.kind}: cut the ${cornerName(cut)} corner off, leaving a wedge`;
}

/** Which corner of a box, by the quadrant it is in, for an edit to name. */
function cornerName(corner: number): string {
  return ['bow port', 'stern port', 'stern starboard', 'bow starboard'][corner] ?? 'a';
}

/**
 * Walk one of a triangle's corners along one of the two edges that meet there.
 *
 * **Along an edge rather than anywhere**, which is what makes shape something
 * a lineage can be trusted with. A corner moved freely swings both its edges
 * and unsticks whatever was welded to either; moved along one of them, that
 * edge keeps its line exactly — only its length changes — so a neighbour
 * welded along it stays welded. The edge to keep is drawn evenly between the
 * two, so a corner that is holding the module on keeps its edge half the time
 * and the other half the candidate is thrown out by the layout rules, which is
 * the ordinary price of a draw.
 *
 * Towards the far end of that edge or away from it, by a drift of the ship's
 * spread, and
 * never so far as to pass the far end: three corners in a line enclose
 * nothing, and a module shrunk out of existence is removal's business.
 */
function moveVertex(
  site: ModuleSite,
  rng: Rng,
  bounds: MutationLimits,
  scale: Scale,
  weight: number,
): string | null {
  const spec = site.spec;
  const triangle = triangleOf(spec);
  if (triangle === null) return null;

  const corner = rng.nextInt(TRIANGLE_CORNERS);
  // The two corners this one shares an edge with; one of them is kept.
  const keep = rng.chance(0.5) ? (corner + 1) % TRIANGLE_CORNERS : (corner + 2) % TRIANGLE_CORNERS;
  const px = triangle[corner * 2]!;
  const py = triangle[corner * 2 + 1]!;
  const kx = triangle[keep * 2]!;
  const ky = triangle[keep * 2 + 1]!;

  const ex = px - kx;
  const ey = py - ky;
  const span = sqrt(ex * ex + ey * ey);
  if (!(span > 0)) return null;
  const step = stretch(rng, bounds, scale, weight);
  if (step === 0) return null;
  const now = span + step;
  // Past the far end the edge turns inside out; at it the triangle is a line.
  if (now <= scale.quantum) return null;

  const moved = [...triangle];
  moved[corner * 2] = kx + (ex / span) * now;
  moved[corner * 2 + 1] = ky + (ey / span) * now;
  const shaped = shapeModule(spec, moved);
  if (shaped === null) return null;
  Object.assign(spec, shaped);
  return (
    `${site.where} ${spec.kind}: corner ${corner + 1} walked ` +
    `${step > 0 ? 'out along' : 'back along'} its edge to corner ${keep + 1}`
  );
}

/**
 * Move the face a module shares with a neighbour, one growing as the other
 * shrinks by the same.
 *
 * It trades space between two modules — hull for engine, say — without the
 * ship getting any bigger, which otherwise takes a shrink and a grow, each of
 * which can be refused. The module that grows must have its whole face
 * against the other, so it only moves into space the other gives up.
 */
function moveSeam(site: ModuleSite, rng: Rng, bounds: MutationLimits, scale: Scale, weight: number): string | null {
  const spec = site.spec;
  const partners: { index: number; other: ModuleSpec; seam: SharedFace }[] = [];
  for (let j = 0; j < site.list.length; j++) {
    const other = site.list[j]!;
    if (other === spec || isInstance(other)) continue;
    const seam = sharedFace(spec, other);
    if (seam !== null && (seam.aWithinB || seam.bWithinA)) partners.push({ index: j, other, seam });
  }
  if (partners.length === 0) return null;
  const { index, other, seam } = partners[rng.nextInt(partners.length)]!;
  // This module grows when its face is within the other's, the other when
  // its is; when both are, either.
  const grow = seam.aWithinB && (!seam.bWithinA || rng.chance(0.5));
  const by = abs(stretch(rng, bounds, scale, weight));
  if (by === 0) return null;
  const moved = shiftSeam(spec, other, seam, grow ? by : -by, scale.quantum);
  if (moved.a.length === spec.length && moved.a.width === spec.width) return null;

  const was = seam.a.along !== 0 ? spec.length : spec.width;
  Object.assign(spec, moved.a);
  Object.assign(other, moved.b);
  const now = seam.a.along !== 0 ? spec.length : spec.width;
  return `${site.where} ${spec.kind}: seam with ${site.label}[${index}] ${other.kind}, ${was} → ${now}`;
}

/**
 * Slide a module along one of its own axes, so one welded along a face slides
 * along it — and stop it against whatever it would run into, as a drag in
 * the editor stops against a neighbour, rather than drive it through and
 * have the edit refused.
 */
function slide(site: ModuleSite, rng: Rng, bounds: MutationLimits, scale: Scale, weight: number): string | null {
  const by = stretch(rng, bounds, scale, weight);
  if (by === 0) return null;
  const along = rng.chance(0.5);
  const angle = (site.spec.angle ?? 0) + (along ? 0 : HALF_PI);
  const spec = site.spec;
  const from = { x: spec.x, y: spec.y };
  const dx = cos(angle) * by;
  const dy = sin(angle) * by;
  const neighbours = site.list.filter((p): p is ModuleSpec => !isInstance(p) && p !== spec);
  const clear = (t: number): boolean => {
    const moved = { ...spec, x: from.x + dx * t, y: from.y + dy * t };
    return !neighbours.some((neighbour) => modulesOverlap(moved, neighbour));
  };
  let t = 1;
  if (!clear(1) && clear(0)) {
    // The furthest it gets before touching, to well inside the tolerance on
    // what counts as touching.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (clear(mid)) lo = mid;
      else hi = mid;
    }
    t = lo;
  }
  const moved = tidy(by * t, 6);
  if (moved === 0) return null;
  spec.x = tidy(from.x + dx * t, 6);
  spec.y = tidy(from.y + dy * t, 6);
  const stopped = t < 1 ? `, stopping against a neighbour` : '';
  return `${site.where} ${spec.kind}: slid ${moved} m ${along ? 'along' : 'across'} itself${stopped}`;
}

function movePlacement(site: InstanceSite, rng: Rng, bounds: MutationLimits, scale: Scale): string | null {
  const step = stretch(rng, bounds, scale, bounds.build.move);
  if (step === 0) return null;
  const axis = rng.chance(0.5) ? 'x' : 'y';
  site.instance[axis] = tidy(site.instance[axis] + step, 6);
  return `${site.where} ${site.instance.use}: ${axis} ${step > 0 ? '+' : ''}${step}`;
}

/**
 * Lengthen or shorten a repeated row — the cheapest structural change there
 * is, and its own inverse.
 */
function repeat(draft: Draft, rng: Rng): string | null {
  const sites = instanceSites(draft).filter((site) => site.instance.step !== undefined);
  if (sites.length === 0) return null;
  const { list, index, instance } = sites[rng.nextInt(sites.length)]!;
  const was = instance.repeat ?? 1;
  const now = was + (rng.chance(0.5) ? 1 : -1);
  if (now < 1 || now > MAX_REPEAT) return null;
  instance.repeat = now;
  return `${list.label}[${index}] ${instance.use}: repeat ${was} → ${now}`;
}

// -- Assemblies ------------------------------------------------------------

/**
 * Grouping, as something a lineage can discover.
 *
 * An assembly is the one construction in a layout that says *these are the
 * same part* (DESIGN.md §3). Everything downstream follows from that: a
 * module written in an assembly is written once however many copies are
 * placed, so mutating it mutates every copy, and a wing that grows a gun
 * grows it on both wings. Without these operators a lineage could only ever
 * mutate the grouping it was handed — a ship bred from a bare core could
 * never have a pair of anything, only two things that happened to look alike
 * and drifted apart the moment either was touched.
 *
 * Four things are possible, and each has its inverse, because an operator
 * that can only ever add structure is a ratchet: a run would fill with
 * assemblies it could not take back, and by the time the grouping was wrong
 * there would be no way down from it. So grouping has ungrouping, and placing
 * another instance has dropping one.
 *
 * **Every one of them is written in a frame, and the frame is why the maths
 * is here at all.** A module inside an assembly is positioned in the
 * assembly's own frame, which the instance then turns, reflects and moves —
 * so taking a module into an assembly means expressing where it already is in
 * that frame, and letting one out means the reverse. Get it wrong and the
 * module silently moves, which is a candidate the layout rules throw away
 * without saying why.
 */

/**
 * Where a placement written beside an instance sits in that instance's frame.
 *
 * Exported for the test that pins it against `expandBlueprint`, which is the
 * only thing that says whether it is right: these two are a hand-written
 * inverse of the composition `place` does, and a sign wrong in either moves a
 * module silently — the candidate is then refused by the layout rules for
 * overlapping something, which says nothing at all about why.
 */
export function intoInstanceFrame(spec: ModuleSpec, instance: AssemblyInstance): ModuleSpec {
  const turn = instance.angle ?? 0;
  const flipped = instance.mirror ?? false;
  const c = cos(turn);
  const sn = sin(turn);
  const dx = spec.x - instance.x;
  const dy = spec.y - instance.y;
  const local = { x: dx * c + dy * sn, y: -dx * sn + dy * c };
  const spun = (spec.angle ?? 0) - turn;
  const out: ModuleSpec = { ...spec, x: framed(local.x), y: framed(flipped ? -local.y : local.y) };
  if (spec.angle !== undefined || spun !== 0) out.angle = flipped ? -spun : spun;
  return out;
}

/** The reverse: where a placement inside an instance sits beside it. */
export function outOfInstanceFrame(spec: ModuleSpec, instance: AssemblyInstance): ModuleSpec {
  const turn = instance.angle ?? 0;
  const flipped = instance.mirror ?? false;
  const c = cos(turn);
  const sn = sin(turn);
  const localY = flipped ? -spec.y : spec.y;
  const own = flipped ? -(spec.angle ?? 0) : (spec.angle ?? 0);
  const out: ModuleSpec = {
    ...spec,
    x: framed(instance.x + spec.x * c - localY * sn),
    y: framed(instance.y + spec.x * sn + localY * c),
  };
  const angle = turn + own;
  if (spec.angle !== undefined || angle !== 0) out.angle = angle;
  return out;
}

/**
 * A position worked out through a frame, rounded as the parser rounds a
 * triangle's: nine places, so a file written from it reads back unchanged.
 */
function framed(value: number): number {
  return tidy(value, 9);
}

/** A name no assembly in this layout has, and a person can read. */
function freeName(draft: Draft): string {
  for (let i = 1; ; i++) {
    const name = `part${i}`;
    if (draft.assemblies[name] === undefined) return name;
  }
}

/** Every instance written anywhere in the layout, with the list holding it. */
function instanceSites(draft: Draft): { list: PlacementList; index: number; instance: AssemblyInstance }[] {
  const out: { list: PlacementList; index: number; instance: AssemblyInstance }[] = [];
  for (const list of draft.lists) {
    for (let i = 0; i < list.placements.length; i++) {
      const placement = list.placements[i]!;
      if (isInstance(placement)) out.push({ list, index: i, instance: placement });
    }
  }
  return out;
}

/**
 * Make one module a part of its own: an assembly holding it, placed where it
 * was.
 *
 * **It changes nothing about the ship, and that is the point.** What it
 * changes is what the *next* generation can do — the module can now be placed
 * again, reflected onto the other side, or mutated once and have the change
 * appear on every copy. A neutral edit is the only way a lineage reaches
 * those, since there is no single mutation that both invents a grouping and
 * pays off immediately.
 *
 * One module rather than several, because which several is a question with a
 * very large answer and no obvious one. A part grows by absorbing its
 * neighbours afterwards, one at a time.
 */
function group(draft: Draft, rng: Rng): string | null {
  const sites: { list: PlacementList; index: number; spec: ModuleSpec }[] = [];
  for (const list of draft.lists) {
    for (let i = 0; i < list.placements.length; i++) {
      const placement = list.placements[i]!;
      if (!isInstance(placement)) sites.push({ list, index: i, spec: placement });
    }
  }
  if (sites.length === 0) return null;

  const chosen = sites[rng.nextInt(sites.length)]!;
  const name = freeName(draft);
  // The module goes to the assembly's origin and the instance takes its
  // position, so where it lands is exactly where it already was.
  const inner: ModuleSpec = { ...chosen.spec, x: 0, y: 0 };
  draft.assemblies[name] = { modules: [inner] };
  const instance: AssemblyInstance = { use: name, x: chosen.spec.x, y: chosen.spec.y };
  chosen.list.placements[chosen.index] = instance;
  refresh(draft);
  return `${chosen.list.label}[${chosen.index}] ${chosen.spec.kind}: made a part of its own, ${name}`;
}

/**
 * Dissolve one instance back into the layout that placed it.
 *
 * The inverse of grouping, and as neutral: the modules land exactly where
 * they were. What it is for is a lineage that has grouped the wrong things —
 * being stuck with a part is being stuck with every copy of it moving
 * together for ever.
 *
 * Only a plain instance is dissolved: one copy, and nothing nested inside. The
 * rest would be the same arithmetic several times over for an edit that is
 * rarely the one wanted, and a lineage reaches them by taking the repeat down
 * first.
 */
function ungroup(draft: Draft, rng: Rng): string | null {
  const sites = instanceSites(draft).filter((site) => {
    const instance = site.instance;
    if ((instance.repeat ?? 1) !== 1) return false;
    const assembly = draft.assemblies[instance.use];
    return assembly !== undefined && assembly.modules.every((placement) => !isInstance(placement));
  });
  if (sites.length === 0) return null;

  const chosen = sites[rng.nextInt(sites.length)]!;
  const assembly = draft.assemblies[chosen.instance.use]!;
  const loosened = assembly.modules.map((placement) =>
    outOfInstanceFrame({ ...(placement as ModuleSpec) }, chosen.instance),
  );
  const name = chosen.instance.use;
  chosen.list.placements.splice(chosen.index, 1, ...loosened);
  refresh(draft);
  return `${chosen.list.label}[${chosen.index}] ${name}: dissolved into ${loosened.length} loose modules`;
}

/**
 * Move a module into an assembly placed beside it.
 *
 * How a module that has been *grown* joins a part: twenty generations of a
 * good gun mounting keep their size, their armour and their angle on the way
 * in, which nothing else here offers.
 *
 * **In practice it only ever works on a part placed once, and that is not a
 * defect so much as the shape of the problem.** Where the module sits is
 * where it has to fit, so a part placed twice needs that spot free beside
 * *both* instances — and the second is usually somebody else's hull. Four
 * thousand children drawn from the shipped catamaran and corvette absorbed a
 * module into a part placed more than once exactly none of the time. Growing
 * a shared part is `extend`'s job; this is for the step before, while a part
 * is still one copy being assembled out of what is already there.
 */
function absorb(draft: Draft, rng: Rng): string | null {
  const sites: { list: PlacementList; index: number; spec: ModuleSpec; instance: AssemblyInstance }[] = [];
  for (const list of draft.lists) {
    const instances = list.placements.filter(isInstance);
    if (instances.length === 0) continue;
    for (let i = 0; i < list.placements.length; i++) {
      const placement = list.placements[i]!;
      if (isInstance(placement)) continue;
      for (const instance of instances) {
        // A reference with no definition behind it is a layout the rules will
        // refuse anyway; absorbing into it would only hide why.
        if (draft.assemblies[instance.use] === undefined) continue;
        sites.push({ list, index: i, spec: placement, instance });
      }
    }
  }
  if (sites.length === 0) return null;

  const chosen = sites[rng.nextInt(sites.length)]!;
  const name = chosen.instance.use;
  const assembly = draft.assemblies[name]!;
  const inner = intoInstanceFrame(chosen.spec, chosen.instance);
  const modules = [...assembly.modules, inner];
  draft.assemblies[name] = assembly.notes === undefined
    ? { modules }
    : { modules, notes: assembly.notes };
  chosen.list.placements.splice(chosen.index, 1);
  refresh(draft);
  return `${chosen.list.label}[${chosen.index}] ${chosen.spec.kind}: taken into ${name}`;
}

/**
 * Which way is *out* of the ship, in a part's own frame.
 *
 * **A new module on a part has to fit at every instance of it, not just one.**
 * A part is written once and placed several times, so a face pointing inboard
 * is a face with the hull against it in every copy, and a candidate put there
 * is refused every time — where a face on the part's outer edge is free in all
 * of them or none. Nothing in an assembly's own coordinates says which way
 * that is, so it is read off where the instances sit: the direction from the
 * middle of the layout placing them to the instance itself, turned back into
 * the frame the part is written in.
 *
 * Averaged over the instances, and the averaging is the point rather than a
 * detail. A mirrored pair sits on opposite sides of the ship and *agrees*
 * about which local direction is outboard, since the frame is reflected along
 * with the position — so a wing and its mirror image both say "away from the
 * hull is this way" and the average is that way rather than nothing. Copies
 * that genuinely disagree average towards nothing, which is the honest answer:
 * there is no face that is outboard for all of them.
 *
 * Null for the layout itself, which is placed nowhere and has no outboard.
 */
function outwardOf(draft: Draft, list: PlacementList): { x: number; y: number } | null {
  if (draft.assemblies[list.label] === undefined) return null;
  let x = 0;
  let y = 0;
  let found = 0;
  for (const site of instanceSites(draft)) {
    if (site.instance.use !== list.label) continue;
    const turn = site.instance.angle ?? 0;
    const c = cos(turn);
    const sn = sin(turn);
    const local = {
      x: site.instance.x * c + site.instance.y * sn,
      y: -site.instance.x * sn + site.instance.y * c,
    };
    x += local.x;
    y += (site.instance.mirror ?? false) ? -local.y : local.y;
    found++;
  }
  if (found === 0) return null;
  const size = x * x + y * y;
  // A part sitting on the middle line has no outboard, and a pair that
  // disagrees has cancelled itself out. Either way there is nothing to prefer.
  return size > 1e-12 ? { x: x / found, y: y / found } : null;
}

/**
 * The faces of an anchor, outermost first.
 *
 * The order is only ever a preference: every face is still tried, since a
 * candidate refused at the outer edge for some other reason should not stop
 * the operator finding a place at all.
 */
function faces(anchor: ModuleSpec, outward: { x: number; y: number } | null, rng: Rng): number[] {
  const first = rng.nextInt(4);
  const order = [0, 1, 2, 3].map((i) => (first + i) % 4);
  if (outward === null) return order;
  const angle = anchor.angle ?? 0;
  // A stable sort, so faces that are equally outboard keep the draw's order.
  return order.sort((a, b) => outwardness(angle, b, outward) - outwardness(angle, a, outward));
}

function outwardness(angle: number, face: number, outward: { x: number; y: number }): number {
  const normal = angle + (face * PI) / 2;
  return cos(normal) * outward.x + sin(normal) * outward.y;
}

/**
 * Place another copy of a part that is already in the layout.
 *
 * Reflected across the axis the instance is written about as often as it is
 * simply moved along, because a reflection is the edit worth having: a ship
 * is symmetric or it flies crabwise, and reaching a matching pair of wings by
 * drawing the same offsets twice is a thing a random walk does not do.
 */
function instantiate(draft: Draft, rng: Rng, _bounds: MutationLimits, scale: Scale): string | null {
  const sites = instanceSites(draft);
  if (sites.length === 0) return null;

  const chosen = sites[rng.nextInt(sites.length)]!;
  const instance = chosen.instance;
  const copy: AssemblyInstance = { ...instance };
  if (instance.step !== undefined) copy.step = { ...instance.step };
  delete copy.notes;

  const reflected = rng.chance(0.5);
  if (reflected) {
    // The whole copy turned over: where it sits, which way it faces, and
    // which way a repeated row of it runs.
    copy.y = -instance.y;
    copy.mirror = !(instance.mirror ?? false);
    if (instance.angle !== undefined) copy.angle = -instance.angle;
    if (copy.step !== undefined) {
      copy.step = {
        ...copy.step,
        y: -copy.step.y,
        ...(copy.step.angle === undefined ? {} : { angle: -copy.step.angle }),
      };
    }
  } else {
    // Clear of the original rather than a nudge from it. A part is nearly
    // always wider than a nudge, so a copy nudged along lands inside the
    // thing it is a copy of and is refused every time — which is how "place
    // another one" came to be the operator that never delivered anything.
    const along = rng.chance(0.5);
    const room = clearance(draft, instance, along, scale);
    const step = rng.chance(0.5) ? room : -room;
    if (along) copy.x = instance.x + step;
    else copy.y = instance.y + step;
  }

  chosen.list.placements.push(copy);
  refresh(draft);
  return `${chosen.list.label}[${chosen.index}] ${instance.use}: ${
    reflected ? 'a reflected instance' : 'another instance'
  } placed`;
}

/**
 * How far along an axis a copy has to sit to be clear of the original,
 * rounded up to the ship's quantum.
 *
 * Measured against a circle round each module rather than its box, so the
 * answer holds whatever angle anything is at, and read off the assembly's own
 * frame — which is the frame the offset is applied in, so a turned instance
 * needs no second thought. An assembly with anything nested inside it gets a
 * new module's width and the layout rules' opinion, since measuring that properly
 * means expanding it.
 */
function clearance(
  draft: Draft,
  instance: AssemblyInstance,
  along: boolean,
  scale: Scale,
): number {
  const assembly = draft.assemblies[instance.use];
  if (assembly === undefined || assembly.modules.some(isInstance)) return scale.arrival;
  let far = 0;
  for (const placement of assembly.modules) {
    const spec = bodySpec(placement as ModuleSpec);
    const centre = moduleCentre(spec);
    const reach = max(spec.length, spec.width) / 2;
    far = max(far, abs(along ? centre.x : centre.y) + reach);
  }
  const wanted = 2 * far;
  return max(scale.quantum, ceilTo(wanted, scale.quantum));
}

/** The next multiple of `step` at or above `value`. */
function ceilTo(value: number, step: number): number {
  return step > 0 ? floor((value + step - 1e-9) / step) * step : value;
}

/**
 * Grow a part by putting a *new* module on it.
 *
 * The counterpart to absorbing, and the one to reach for when a part is
 * placed more than once. Absorbing takes a module that is already on the
 * ship, so where it sits is where it has to fit — beside the one instance it
 * was next to, and inside every other instance, which is usually somebody
 * else's hull. Measured over lineages of the shipped fleet, absorbing into a
 * part placed twice landed between a seventh and a sixteenth as often per
 * chance offered as absorbing into one placed once, which is that sentence
 * in numbers.
 *
 * A new module has no such history: it goes where there is room, and going on
 * the part's outer edge by preference (`outwardOf`) is a place likely to be
 * free at every instance rather than at one. So a wing grows a gun on both
 * wings, which is the whole point of the part being one thing.
 *
 * Absorbing is kept beside it rather than replaced, because it is still the
 * only way a module that has been *grown* — twenty generations of a good gun
 * mounting — joins a part. What it is not is the way to grow a pair.
 */
function extend(draft: Draft, rng: Rng, bounds: MutationLimits, scale: Scale): string | null {
  return addModule(draft, rng, bounds, scale, false, true);
}

/**
 * Take one copy of a part off the ship.
 *
 * The inverse of placing another, and it has to exist for the same reason
 * ungrouping does: an operator that can add a wing and never take one off is
 * a ratchet, and a lineage that has grown a limb it cannot afford would have
 * to shed it a module at a time while carrying the cost all the way down.
 *
 * The definition goes with the last copy of it. A part nothing places is
 * dead weight in the file rather than on the ship, but it is still something
 * every later generation walks past.
 */
function dropInstance(draft: Draft, rng: Rng): string | null {
  const sites = instanceSites(draft);
  if (sites.length === 0) return null;

  const chosen = sites[rng.nextInt(sites.length)]!;
  const name = chosen.instance.use;
  chosen.list.placements.splice(chosen.index, 1);
  refresh(draft);
  return `${chosen.list.label}[${chosen.index}] ${name}: an instance dropped`;
}

/**
 * The operators that work on the grouping, drawn between evenly.
 *
 * Evenly, and listed so that each sits beside its inverse: what keeps a
 * lineage able to change its mind is that every way of adding structure costs
 * the same draw as the way of taking it back. Growing a part has no inverse
 * of its own listed here because it does not need one — a module on a part is
 * taken off by the ordinary removal, which works through an assembly's list
 * like any other.
 */
const ASSEMBLY_OPERATORS: readonly ((
  draft: Draft,
  rng: Rng,
  bounds: MutationLimits,
  scale: Scale,
) => string | null)[] = [group, ungroup, absorb, extend, instantiate, dropInstance, repeat];

/**
 * Turn an instance over where it stands.
 *
 * A number rather than a structural edit, because it is one: nothing is added
 * or taken away, and what changes is which way round a part sits — the same
 * sort of change as moving it.
 */
function reflect(site: InstanceSite): string | null {
  const was = site.instance.mirror ?? false;
  if (was) delete site.instance.mirror;
  else site.instance.mirror = true;
  return `${site.where} ${site.instance.use}: ${was ? 'no longer' : 'now'} mirrored`;
}

// -- Structure -------------------------------------------------------------

/**
 * Add, copy or remove one module.
 *
 * Drawn evenly between taking one off and putting one on, which is a
 * calibration rather than a principle: what has to come out even is the
 * *accepted* mix, and how often each is accepted depends on how easily a new
 * module finds somewhere it fits. `mutation.test.ts` pins it by breeding a
 * lineage and checking it neither withers nor runs away — and it earns its
 * place, having caught the ratio drifting to two to one the moment a bug that
 * was refusing half of all additions was fixed.
 */
function restructure(draft: Draft, rng: Rng, bounds: MutationLimits, scale: Scale): string | null {
  // A third of structural generations are about the *grouping* rather than
  // the modules. They are far more often impossible than a module edit — a
  // ship with no assemblies has five of the six unavailable — so one that
  // comes to nothing falls back to a module edit rather than costing the
  // generation its structure.
  if (rng.nextInt(3) === 0) {
    const operator = ASSEMBLY_OPERATORS[rng.nextInt(ASSEMBLY_OPERATORS.length)]!;
    const edit = operator(draft, rng, bounds, scale);
    if (edit !== null) return edit;
  }

  const draw = rng.nextInt(4);
  if (draw < 2) return removePlacement(draft, rng);
  return addModule(draft, rng, bounds, scale, draw === 2);
}

/**
 * Take one module out.
 *
 * A module and never a placement of an assembly, because taking out an
 * instance takes out everything in it — a wing, or a side of a ship — which
 * is a larger edit than one generation is allowed. What it costs is that a
 * lineage cannot drop a whole limb in one go, and it has to shed it a module
 * at a time instead.
 *
 * No thought is given to what the module was holding on: a limb left floating
 * is caught by the layout rules and the candidate is thrown away, which is the
 * same answer a cleverer rule would reach and is one the rules already own.
 */
function removePlacement(draft: Draft, rng: Rng): string | null {
  const sites: { list: PlacementList; index: number; spec: ModuleSpec }[] = [];
  for (const list of draft.lists) {
    for (let i = 0; i < list.placements.length; i++) {
      const placement = list.placements[i]!;
      if (!isInstance(placement)) sites.push({ list, index: i, spec: placement });
    }
  }
  if (sites.length <= 1) return null;

  const chosen = sites[rng.nextInt(sites.length)]!;
  chosen.list.placements.splice(chosen.index, 1);
  return `${chosen.list.label}[${chosen.index}] ${chosen.spec.kind}: removed`;
}

/**
 * Bolt a module onto a face of one that is already there.
 *
 * Against a face rather than anywhere, because a module has to touch the ship
 * to be part of it: dropping one at a random position is a draw that is
 * refused essentially always. It goes into the same list as the module it is
 * attached to, so a module added inside an assembly appears on every copy of
 * it — a wing that grows a gun grows it on both wings.
 *
 * The faces are tried in a random order and the first one nothing is already
 * sitting on wins. That is not the layout rules being second-guessed: they
 * still decide, and they see collisions this cannot — between an assembly's
 * modules and the ship around it, which are written in different frames. It
 * is a filter over the obviously hopeless, and without it most of what this
 * operator draws is a module inside its own neighbour.
 */
function addModule(
  draft: Draft,
  rng: Rng,
  bounds: MutationLimits,
  scale: Scale,
  copy: boolean,
  onlyParts = false,
): string | null {
  const anchors: { list: PlacementList; spec: ModuleSpec; index: number }[] = [];
  for (const list of draft.lists) {
    if (onlyParts && draft.assemblies[list.label] === undefined) continue;
    for (let i = 0; i < list.placements.length; i++) {
      const placement = list.placements[i]!;
      // A box only: every berth below is measured as a face so far either side
      // of the module's middle, and a triangle has neither the face nor the
      // symmetry — its corners are an author's, and no operator here can draw
      // one or reason about one (ROADMAP.md §12).
      if (!isInstance(placement) && !isTriangle(placement)) {
        anchors.push({ list, spec: placement, index: i });
      }
    }
  }
  if (anchors.length === 0) return null;

  const firstAnchor = rng.nextInt(anchors.length);
  for (let a = 0; a < anchors.length; a++) {
    const anchor = anchors[(firstAnchor + a) % anchors.length]!;
    const neighbours = anchor.list.placements.filter(
      (placement): placement is ModuleSpec => !isInstance(placement) && placement !== anchor.spec,
    );
    const kind = copy ? anchor.spec.kind : pickKind(rng, bounds.kinds);
    if (kind === null) return null;
    const outward = outwardOf(draft, anchor.list);
    // A copy of something that points goes beside it, never in front of it or
    // behind it, where one would fire into the other.
    const beside = copy && points(kind);
    for (const face of faces(anchor.spec, outward, rng)) {
      if (beside && face % 2 === 0) continue;
      for (const along of berths(anchor.spec, face, copy, scale, rng)) {
        const added = against(anchor.spec, face, along, kind, copy, bounds, scale, rng);
        if (neighbours.some((neighbour) => modulesOverlap(added, neighbour))) continue;
        anchor.list.placements.push(added);
        // Said out loud, because a wedge and a box are the same line of the
        // file otherwise and the changelog is what a run is read back through.
        const shaped = isTriangle(added) ? ' as a wedge' : '';
        return (
          `${anchor.list.label}[${anchor.index}] ${anchor.spec.kind}: ` +
          `${copy ? `copied onto` : `a ${kind} added${shaped} to`} its ${faceName(face)} face`
        );
      }
    }
  }
  return null;
}

/** The most thrusters one child gets, however the rolls go. */
const MOST_THRUSTERS = 8;
/** Places tried for each thruster before it is given up on. */
const THRUSTER_TRIES = 8;
/** A thruster's side, as a share of a new module's. */
const THRUSTER_SHARE = 0.5;

/**
 * Bolt small engines onto the hull, facing out, as many as the rolls say.
 *
 * **A ship turns by firing engines on one side, so it needs several.** One
 * engine at a time, added or refitted, has to be worth keeping alone before a
 * second can join it, and alone it mostly spins the ship and spoils its
 * gunnery. Arriving several at once and small, they can turn a ship as well as
 * push it, leaving the main drive to the engines `addModule` brings.
 *
 * A place that would not be a ship is skipped and another tried, and a
 * thruster with nowhere to go is skipped without ending the rolls.
 */
function addThrusters(draft: Draft, rng: Rng, bounds: MutationLimits, scale: Scale, edits: string[]): void {
  if (!(bounds.kinds.engine > 0)) return;
  const side = max(scale.quantum, roundTo(scale.arrival * THRUSTER_SHARE, scale.quantum));
  const small: Scale = { ...scale, arrival: side };
  for (let n = 0; n < MOST_THRUSTERS && rng.chance(bounds.thrusters); n++) {
    for (let tries = 0; tries < THRUSTER_TRIES; tries++) {
      const edit = addThruster(draft, rng, bounds, small);
      // Every thruster costs the same, so one the budget refuses anywhere it refuses everywhere.
      if (edit === UNAFFORDABLE) return;
      if (edit !== null) {
        edits.push(edit);
        break;
      }
    }
  }
}

const UNAFFORDABLE = Symbol('unaffordable');

/** One thruster on a random box, or null if that box will not take it. */
function addThruster(draft: Draft, rng: Rng, bounds: MutationLimits, scale: Scale): string | null | typeof UNAFFORDABLE {
  const anchors: { list: PlacementList; spec: ModuleSpec; index: number }[] = [];
  for (const list of draft.lists) {
    for (let i = 0; i < list.placements.length; i++) {
      const placement = list.placements[i]!;
      if (!isInstance(placement) && !isTriangle(placement)) anchors.push({ list, spec: placement, index: i });
    }
  }
  if (anchors.length === 0) return null;
  const anchor = anchors[rng.nextInt(anchors.length)]!;
  const placements = anchor.list.placements;
  // The first free spot on the anchor's faces, since a face with a neighbour
  // flush against it is inside the hull rather than on it.
  for (const face of faces(anchor.spec, outwardOf(draft, anchor.list), rng)) {
    // Never in an engine's flame or a gun's line of fire.
    if (face === 0 && points(anchor.spec.kind)) continue;
    for (const along of berths(anchor.spec, face, false, scale, rng)) {
      const added = against(anchor.spec, face, along, 'engine', false, bounds, scale, rng);
      if (placements.some((other) => !isInstance(other) && modulesOverlap(added, other))) continue;
      placements.push(added);
      const ship = blueprintProblem(draft.blueprint) === null;
      if (ship && (!isLimited(bounds.budget) || affords(bounds.budget, billOf(compileDraft(draft.blueprint))))) {
        return `${anchor.list.label}[${anchor.index}] ${anchor.spec.kind}: an engine added as a thruster to its ${faceName(face)} face`;
      }
      placements.pop();
      return ship ? UNAFFORDABLE : null;
    }
  }
  return null;
}

/**
 * Where along a face a new module might go, in the order they are tried.
 *
 * **A face is a row of berths, not a single spot.** Fixed at the middle, a
 * face can hold exactly one module ever: a second draw lands on top of the
 * first, is refused, and the operator goes off to find another face — so a
 * bank of engines down one side, or a battery of mounts along a beam, is a
 * thing no lineage could ever be bred towards however long it ran. Sliding
 * along the face makes every free stretch of hull available and a crowded one
 * simply full.
 *
 * Every berth keeps the module wholly on the face it is bolted to, so what
 * comes back is a real weld rather than a corner touch, and they are on the
 * ship's quantum like everything else the operator writes. Drawn in a random order and
 * tried until one fits, so a face with a gap in the middle of it is found
 * rather than given up on.
 */
function berths(
  anchor: ModuleSpec,
  face: number,
  copy: boolean,
  scale: Scale,
  rng: Rng,
): number[] {
  const endOn = face % 2 === 0;
  const span = endOn ? anchor.width : anchor.length;
  const across = copy ? span : min(span, scale.arrival);
  const room = span - across;
  if (!(room > 0)) return [0];

  const steps = floor(room / scale.quantum);
  const berth: number[] = [];
  for (let i = 0; i <= steps; i++) berth.push(tidy(-room / 2 + i * scale.quantum, 6));
  // Drawn without replacement, so a crowded face is searched rather than
  // sampled: the same spot offered twice is a draw wasted.
  const order: number[] = [];
  while (berth.length > 0 && order.length < MOORINGS) {
    order.push(berth.splice(rng.nextInt(berth.length), 1)[0]!);
  }
  return order;
}

/** How many places along one face are tried before moving to the next. */
const MOORINGS = 6;

/**
 * A module of the given kind, flush against one face of another.
 *
 * `face` counts quarter turns from the anchor's own facing, so face 0 is
 * whatever the anchor calls forward and the sides follow round.
 */
function against(
  anchor: ModuleSpec,
  face: number,
  along: number,
  kind: ModuleKind,
  copy: boolean,
  bounds: MutationLimits,
  scale: Scale,
  rng: Rng,
): ModuleSpec {
  const angle = anchor.angle ?? 0;
  const normalAngle = angle + (face * PI) / 2;
  const nx = cos(normalAngle);
  const ny = sin(normalAngle);
  // Along the face is the normal turned a quarter, which is where `along`
  // slides the new module to.
  const ax = -ny;
  const ay = nx;
  const endOn = face % 2 === 0;
  const centre = blockCentre(anchor);
  const reach = (endOn ? anchor.length : anchor.width) / 2;
  const faceX = centre.x + nx * reach + ax * along;
  const faceY = centre.y + ny * reach + ay * along;

  // **A copy keeps its original's proportions; anything new arrives a square
  // half the ship's median module across**, no wider than the face it is on.
  // A guess should be cheap, so it is not sized from the face — a first gun
  // on a capital would arrive weighing tonnes — but nor so small that it is a
  // dot on a big hull, cheap to carry and impossible for anything to hit, as
  // a fixed half metre was on the Gunship.
  const across = copy ? (endOn ? anchor.width : anchor.length) : min(endOn ? anchor.width : anchor.length, scale.arrival);
  const out = copy ? (endOn ? anchor.length : anchor.width) : scale.arrival;

  // **A copy of an engine or a hull weapon is the same thing again, beside
  // it**: the same way round, a width over, so two engines make a bank firing
  // the same way and two guns a battery. Bolted to a face pointing out of it,
  // as a new one is, a copy on the bell or the muzzle sat in its original's
  // flame or line of fire, and one on the back pointed the other way —
  // measured over the stock fleet's lineages, more than half of all copied
  // engines left an engine firing into the ship.
  if (copy && points(kind)) {
    const { notes: _notes, ...same } = anchor;
    return { ...same, x: tidy(anchor.x + nx * anchor.width, 6), y: tidy(anchor.y + ny * anchor.width, 6) };
  }

  // Which way a module has to face to be *held on* by this face is the
  // archetype's business, and two of them answer differently.
  //
  // An engine and a hull weapon both face *out*, bell or barrel into clear
  // air, held on by the block behind it. An engine's position is the middle
  // of the face it is bolted on by, so it sits exactly on the anchor's face;
  // a hull weapon's is its middle, half its depth out. Nothing refuses an
  // engine pointed the other way; it is simply the only way round worth
  // guessing, since the other burns the ship it is bolted to. Everything else
  // has no front and sits on the face, half its own depth out, lying along it.
  // **The angle is not rounded, and that is load-bearing.** Positions are
  // tidied because they are worked out through sines and cosines and land on
  // values no file should carry; an angle is not, because a module sits
  // against its neighbour's face and two boxes that merely touch must not
  // count as overlapping. Rounding a right angle to six places tilts a module
  // by three ten-millionths of a radian, which puts a corner of it some
  // eighty nanometres inside the hull it is bolted to — and the overlap test
  // is exact, so the layout is refused. It once cost every engine, whose angle
  // was then a right angle plus half a turn and so never one of the two values
  // that survive rounding: not one could be added to any face of any ship. Angles are exact in
  // radians here and exact in degrees in the file, which is where legibility
  // was the concern in the first place.
  const added: ModuleSpec =
    kind === 'engine'
      ? {
          kind,
          x: tidy(faceX, 6),
          y: tidy(faceY, 6),
          angle: normalAngle,
          length: out,
          width: across,
        }
      : isHullMount(kind)
        ? {
            kind,
            x: tidy(faceX + (nx * out) / 2, 6),
            y: tidy(faceY + (ny * out) / 2, 6),
            angle: normalAngle,
            length: out,
            width: across,
          }
        : {
            kind,
            x: tidy(faceX + (nx * out) / 2, 6),
            y: tidy(faceY + (ny * out) / 2, 6),
            angle: endOn ? angle : angle + PI / 2,
            length: endOn ? out : across,
            width: endOn ? across : out,
          };
  if (copy && anchor.reinforcement !== undefined) added.reinforcement = anchor.reinforcement;
  if (copy && anchor.barrels !== undefined) added.barrels = anchor.barrels;

  // **Some of what is added arrives as a wedge rather than a box.** A triangle
  // is otherwise unreachable from a box hull: the only operator that can take
  // a corner off needs two free faces, and a module freshly bolted on has
  // three — so without this a lineage founded on rectangles could reach a
  // wedge only by growing out past its own neighbours first. Arriving shaped
  // puts the shape in the population's reach from the first generation, and
  // the ones that are no use are thrown out by the same selection as anything
  // else.
  //
  // The wedge filling its own box, which is the shape the editor's tick box
  // makes and the one every other triangle is a corner or two away from.
  if (canShape(kind) && bounds.build.shape > 0 && rng.chance(SHAPED_ARRIVAL_CHANCE)) {
    const shaped = shapeModule(added, wedge(added));
    if (shaped !== null) return shaped;
  }
  return added;
}

/** Whether a kind points somewhere — an engine's bell, a hull weapon's muzzle — so a copy must not go in front of it. */
function points(kind: ModuleKind): boolean {
  return kind === 'engine' || isHullMount(kind);
}

/** Which face of a module a thing went on, in the module's own terms. */
function faceName(outward: number): string {
  return ['bow', 'port', 'stern', 'starboard'][outward] ?? 'bow';
}

/**
 * Draw a kind by weight, optionally excluding the one a module already is.
 *
 * Null when there is nothing to draw: every weight zero, or the only kind
 * with any weight being the one excluded. A caller that asked for a change
 * and cannot have one reports no edit rather than an edit that changed
 * nothing.
 */
function pickKind(rng: Rng, weights: KindWeights, except?: ModuleKind): ModuleKind | null {
  let total = 0;
  for (const kind of MODULE_KINDS) if (kind !== except) total += max(0, weights[kind]);
  if (total <= 0) return null;
  let draw = rng.nextRange(0, total);
  for (const kind of MODULE_KINDS) {
    if (kind === except) continue;
    draw -= max(0, weights[kind]);
    if (draw < 0) return kind;
  }
  // Only reachable when the draw lands exactly on the total, which a float
  // range can do at its top end.
  for (let i = MODULE_KINDS.length - 1; i >= 0; i--) {
    const kind = MODULE_KINDS[i]!;
    if (kind !== except && weights[kind] > 0) return kind;
  }
  return null;
}

// -- Arithmetic ------------------------------------------------------------

/**
 * Round to a number of decimal places.
 *
 * Positions are worked out through sines and cosines and land on values no
 * file should have to carry. Six places is a micrometre — four orders below
 * the tolerance that decides whether two modules are touching, so tidying can
 * never be what makes a layout valid or invalid.
 */
function tidy(value: number, places: number): number {
  let scale = 1;
  for (let i = 0; i < places; i++) scale *= 10;
  return round(value * scale) / scale;
}

function degrees(radians: number): number {
  return tidy((radians / PI) * 180, 3);
}
