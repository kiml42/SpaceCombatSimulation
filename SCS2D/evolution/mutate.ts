import {
  blueprintProblem,
  compileDraft,
  contactWidth,
  isInstance,
  MAX_REPEAT,
  modulesOverlap,
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
  DEFAULT_NOZZLE_SHARE,
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
  moduleProblem,
  mountTraverse,
  isHullMount,
  MODULE_KINDS,
  moduleCentre,
  refitModule,
  shapeModule,
  type ModuleKind,
  type ModuleSpec,
} from '../sim/modules.js';
import { pushNeighbours, sharedFace, shiftSeam, type SharedFace } from '../sim/push.js';
import { Rng } from '../sim/rng.js';

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
 * the opposite face stays against whatever it was attached to, and everything
 * moves in whole grid steps, so faces that were flush land flush again.
 */

/** How far a child may be from its parent, and how hard to try. */
export interface MutationLimits {
  /** Most numbers changed in one generation. At least one is always attempted. */
  readonly numbers: number;
  /** Largest fractional change to a number that is not on the grid. */
  readonly magnitude: number;
  /** Chance of also making one structural edit: a module added, removed or copied. */
  readonly structural: number;
  /** Chance of the child's name drifting a letter from its parent's (`driftName`). */
  readonly rename: number;
  /** What positions and sizes move in, metres. */
  readonly grid: number;
  /** What angles turn in, radians. */
  readonly turn: number;
  /** Dry mass a child may not exceed, kg. */
  readonly massBudget: number;
  /** Candidates drawn before giving up and returning the parent. */
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
   * How often a doctrine number is the one changed, against a number in the
   * build at one. Zero freezes that part of the doctrine.
   */
  readonly doctrine: DoctrineWeights;
  /**
   * How often each sort of number in the build is the one changed, against
   * each other and the doctrine. Zero freezes it: a run with `move`, `resize`,
   * `refit`, `fittings` and `fighter` at zero, and no structural edits, keeps
   * how a ship is built and tunes everything else.
   */
  readonly build: BuildWeights;
}

export type KindWeights = Readonly<Record<ModuleKind, number>>;

/**
 * - `targeting`: what the ship goes after.
 * - `approach`: the range it fights at, how hard it flies there, and ramming.
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
const AVOIDANCE_FIELDS: readonly string[] = ['separation', 'separationRadii'];

/**
 * What the operator reaches for, unless a run says otherwise.
 *
 * **Weighted by what is worth having at the size a guess arrives in.** A new
 * module is half a metre square, and the kinds are nothing like equal at that
 * size: thrust follows the nozzle's area, so six small engines are six small
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
  // has over a turret — a far bigger bore for the width — is worth nothing at
  // half a metre, and what it costs — almost nowhere to point — is a cost at
  // any size, so a lineage that wants one has to grow it.
  hullGun: 2,
  hullBeam: 1,
  core: 1,
};

/**
 * Bounded edit distance, as DESIGN.md §7 asks for: a handful of numbers, none
 * of them moved far, and at most one module added or removed. A descendant is
 * then recognisably one, which is what makes a lineage worth looking at.
 *
 * The grid is the editor's own, so a mutant is a layout a person could have
 * drawn and could sit down and carry on editing.
 */
export const DEFAULT_LIMITS: MutationLimits = {
  numbers: 3,
  magnitude: 0.25,
  structural: 0.3,
  rename: 0.1,
  grid: 0.5,
  turn: PI / 12,
  massBudget: Infinity,
  attempts: 24,
  kinds: DEFAULT_KINDS,
  doctrine: DEFAULT_DOCTRINE_WEIGHTS,
  build: DEFAULT_BUILD_WEIGHTS,
};

/** A child, and what was done to its parent to get it. */
export interface Mutant {
  readonly blueprint: Blueprint;
  /**
   * One sentence per change, in the order they were made. Empty means every
   * candidate was refused and the parent is being returned unchanged, which
   * is the one outcome a caller has to notice.
   */
  readonly edits: readonly string[];
  /** Candidates drawn, the accepted one included. */
  readonly attempts: number;
}

/**
 * Breed one blueprint from another.
 *
 * The generator is drawn from on every attempt, accepted or not, so a run is
 * reproducible from its seed but the draws a child costs are not fixed.
 */
export function mutate(parent: Blueprint, rng: Rng, limits?: Partial<MutationLimits>): Mutant {
  // Merged a key at a time, so naming one kind's weight does not silently
  // zero the four not mentioned.
  const bounds: MutationLimits = {
    ...DEFAULT_LIMITS,
    ...limits,
    kinds: { ...DEFAULT_LIMITS.kinds, ...limits?.kinds },
    doctrine: doctrineWeights(limits?.doctrine),
    build: { ...DEFAULT_LIMITS.build, ...limits?.build },
  };

  // Whether this is a structural generation is decided once, outside the
  // retry, and every attempt then tries to deliver that kind of child.
  //
  // Deciding it per attempt looks equivalent and is not. A structural edit is
  // refused far more often than a change to a number, and a candidate is
  // accepted or refused whole — so bundling the two has the rare edit dragged
  // down by its own difficulty *and* the common one carried through on the
  // attempts the rare one lost. Measured on the shipped fleet, that put a
  // module added or removed into one generation in twenty-five, against the
  // three in ten asked for here.
  // Drawn from a generator of its own, seeded from where the run's stands, so
  // a name drifting never moves a draw the design depends on.
  const naming = new Rng(rng.clone().nextUint32() ^ 0x4e414d45);
  let spent = 0;
  if (rng.chance(bounds.structural)) {
    const child = breed(parent, rng, bounds, true);
    if (child !== null) return renamed(child, naming, bounds.rename);
    // Nowhere to put anything and nothing that can be spared: a dense little
    // hull has generations where this is simply true. Breeding a child that
    // differs in its numbers beats handing back a copy of its parent.
    spent = bounds.attempts;
  }

  const child = breed(parent, rng, bounds, false);
  return child === null ? { blueprint: parent, edits: [], attempts: spent + bounds.attempts } : renamed(child, naming, bounds.rename);
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

/** Draw candidates of one kind until one is a ship, or the budget runs out. */
function breed(
  parent: Blueprint,
  rng: Rng,
  bounds: MutationLimits,
  structural: boolean,
): Mutant | null {
  for (let attempt = 1; attempt <= bounds.attempts; attempt++) {
    const draft = cloneBlueprint(parent);
    const edits: string[] = [];

    if (structural) {
      const edit = restructure(draft, rng, bounds);
      if (edit !== null) edits.push(edit);
    }

    // Drawn without replacement, so a candidate cannot turn the same knob
    // twice — which is not merely untidy: two draws on one number can cancel
    // each other out exactly, and the child is then its parent with a
    // changelog saying otherwise.
    const available = knobs(draft);
    const wanted = 1 + rng.nextInt(max(1, bounds.numbers));
    for (let i = 0; i < wanted && available.length > 0; i++) {
      const at = drawKnob(available, bounds, rng);
      if (at < 0) break;
      const edit = renumber(available.splice(at, 1)[0]!, draft, rng, bounds);
      if (edit !== null) edits.push(edit);
    }

    if (edits.length === 0) continue;
    if (buildable(draft.blueprint, bounds.massBudget)) {
      return { blueprint: draft.blueprint, edits, attempts: attempt };
    }
  }
  return null;
}

/**
 * Which knob to turn, by index, or -1 if every one left is weighted zero.
 * Evenly unless something is weighted, so a run at the defaults draws exactly
 * as it always has.
 */
function drawKnob(available: readonly Knob[], bounds: MutationLimits, rng: Rng): number {
  if (allOnes(bounds.doctrine) && allOnes(bounds.build)) return rng.nextInt(available.length);
  let total = 0;
  for (const knob of available) total += max(0, knobWeight(knob, bounds));
  if (!(total > 0)) return -1;
  let draw = rng.nextFloat() * total;
  for (let i = 0; i < available.length; i++) {
    draw -= max(0, knobWeight(available[i]!, bounds));
    if (draw < 0) return i;
  }
  return available.length - 1;
}

function allOnes(weights: Readonly<Record<string, number>>): boolean {
  return Object.values(weights).every((weight) => weight === 1);
}

function knobWeight(knob: Knob, { doctrine, build }: MutationLimits): number {
  switch (knob.at) {
    case 'doctrine':
      if (ESCORT_FIELDS.includes(knob.field)) return doctrine.escort;
      if (AVOIDANCE_FIELDS.includes(knob.field)) return doctrine.avoidance;
      return doctrine[knob.half];
    case 'gunnery':
      return doctrine.gunnery;
    case 'slide':
    case 'angle':
    case 'place':
    case 'mirror':
      return build.move;
    case 'face':
    case 'seam':
      return build.resize;
    case 'shape':
    case 'vertex':
      return build.shape;
    case 'kind':
      return build.refit;
    case 'barrels':
    case 'nozzle':
    case 'barrelCalibres':
    case 'thick':
      return build.fittings;
    case 'reinforcement':
    case 'sealing':
    case 'drainPriority':
    case 'traverse':
    case 'fuse':
    case 'fragments':
    case 'burstSpeed':
    case 'weapon':
      return build.tuning;
    case 'fighter':
      return build.fighter;
  }
}

/** Whether a candidate is a ship, and one the budget can afford. */
function buildable(blueprint: Blueprint, massBudget: number): boolean {
  if (blueprintProblem(blueprint) !== null) return false;
  if (massBudget === Infinity) return true;
  // Dry mass is what a ship costs, there being no abstract points value for
  // anything (DESIGN.md §2). Compiling is the only way to know it.
  return compileDraft(blueprint).mass <= massBudget;
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

// -- Numbers ---------------------------------------------------------------

/**
 * One knob a number lives behind.
 *
 * A knob per *field* rather than per module means a ship with many modules
 * has its geometry mutated more often than its doctrine, which is right: it
 * has more geometry to get wrong.
 */
type Knob =
  | { readonly at: 'doctrine'; readonly half: 'targeting' | 'approach'; readonly field: string }
  | { readonly at: 'fighter' }
  | { readonly at: 'reinforcement'; readonly site: ModuleSite }
  | { readonly at: 'kind'; readonly site: ModuleSite }
  | { readonly at: 'barrels'; readonly site: ModuleSite }
  | { readonly at: 'nozzle'; readonly site: ModuleSite }
  | { readonly at: 'barrelCalibres'; readonly site: ModuleSite }
  | { readonly at: 'traverse'; readonly site: ModuleSite }
  | { readonly at: 'fuse'; readonly site: ModuleSite }
  | { readonly at: 'fragments'; readonly site: ModuleSite }
  | { readonly at: 'burstSpeed'; readonly site: ModuleSite }
  | { readonly at: 'gunnery'; readonly site: ModuleSite }
  | { readonly at: 'weapon'; readonly site: ModuleSite }
  | { readonly at: 'thick'; readonly site: ModuleSite }
  | { readonly at: 'sealing'; readonly site: ModuleSite }
  | { readonly at: 'drainPriority'; readonly site: ModuleSite }
  | { readonly at: 'angle'; readonly site: ModuleSite }
  | { readonly at: 'face'; readonly site: ModuleSite }
  | { readonly at: 'shape'; readonly site: ModuleSite }
  | { readonly at: 'vertex'; readonly site: ModuleSite }
  | { readonly at: 'seam'; readonly site: ModuleSite }
  | { readonly at: 'slide'; readonly site: ModuleSite }
  | { readonly at: 'place'; readonly site: InstanceSite }
  | { readonly at: 'mirror'; readonly site: InstanceSite };

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

function knobs(draft: Draft): Knob[] {
  const out: Knob[] = [];
  // Only what a hull reads: a ship's aim weights choose a part of a target,
  // and nothing but a mount does that — a knob on one would be a draw that
  // cannot change the battle, and an edit accepted for changing nothing.
  for (const field of SHIP_TARGETING_FIELDS) out.push({ at: 'doctrine', half: 'targeting', field });
  for (const field of APPROACH_FIELDS) out.push({ at: 'doctrine', half: 'approach', field });
  // Even while the layout rules it out: the flag is ignored until it does not.
  out.push({ at: 'fighter' });

  for (const list of draft.lists) {
    for (let i = 0; i < list.placements.length; i++) {
      const placement = list.placements[i]!;
      const where = `${list.label}[${i}]`;
      if (isInstance(placement)) {
        const site: InstanceSite = { instance: placement, where };
        out.push({ at: 'place', site }, { at: 'mirror', site });
        continue;
      }
      const site: ModuleSite = { spec: placement, where, list: list.placements, label: list.label };
      out.push(
        { at: 'reinforcement', site },
        { at: 'face', site },
        { at: 'seam', site },
        { at: 'slide', site },
        { at: 'kind', site },
      );
      if (placement.kind !== 'structure' && placement.kind !== 'tank' && placement.kind !== 'core') {
        out.push({ at: 'angle', site });
      }
      // Shape, for the two archetypes that may have corners: a box with two
      // free faces can lose the corner between them, and a triangle can walk
      // one of its corners along an edge.
      if (canShape(placement.kind)) {
        if (isTriangle(placement)) out.push({ at: 'vertex', site });
        else out.push({ at: 'shape', site });
      }
      if (canThicken(placement)) out.push({ at: 'thick', site });
      if (readsSealing(placement.kind)) out.push({ at: 'sealing', site });
      if (readsDrainPriority(placement.kind)) out.push({ at: 'drainPriority', site });
      if (placement.kind === 'turret' || placement.kind === 'beamTurret') {
        out.push({ at: 'barrels', site });
      }
      if (isWeaponMount(placement.kind)) {
        // How much arc a weapon is built for, which on a hull mount is mass
        // as well as coverage — a fixed gun carries no training gear, and
        // whether that trade is worth taking is exactly what a run is for.
        out.push({ at: 'traverse', site }, { at: 'gunnery', site });
      }
      // What a gun fires: shells or solid shot, and for shells how they burst.
      if (readsFuse(placement.kind)) out.push({ at: 'fragments', site });
      if (firesShells(placement)) out.push({ at: 'fuse', site }, { at: 'burstSpeed', site });
      // The outlet count divides a hull mount's opening between more of them.
      if (isHullMount(placement.kind)) out.push({ at: 'barrels', site });
      if (readsBarrelCalibres(placement.kind)) out.push({ at: 'barrelCalibres', site });
      if (placement.kind === 'engine') {
        // An engine's outlets are counted by the same field a gun's barrels
        // are, so a cluster is something a line can find.
        out.push({ at: 'weapon', site }, { at: 'barrels', site }, { at: 'nozzle', site });
      }
    }
  }
  return out;
}

/**
 * Turn one of a mount's own targeting numbers.
 *
 * **One knob with the field drawn inside it, rather than a knob per field.**
 * Everywhere else in here a knob is a field, so that a ship with more
 * geometry has its geometry mutated more often — but a mount has twelve
 * numbers of its own, so a broadside of eight would have its gunnery turned
 * five times as often as everything about the hull put together.
 *
 * A value that lands back on what the archetype does is taken out rather than
 * written down, so a lineage that has wandered back to the default says so,
 * and the block a mount carries stays the list of things it actually wants
 * differently.
 */
function retarget(site: ModuleSite, rng: Rng, bounds: MutationLimits): string | null {
  const field = MOUNT_TARGETING_FIELDS[rng.nextInt(MOUNT_TARGETING_FIELDS.length)]!;
  const base = defaultTargeting(site.spec.kind) as unknown as Record<string, number>;
  const held = site.spec.targeting as Record<string, number> | undefined;
  const was = held?.[field] ?? base[field]!;
  const scale = max(abs(was), abs(base[field]!)) || TYPICAL.targeting;
  let now = was + bounds.magnitude * scale * rng.nextRange(-1, 1);
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

function renumber(knob: Knob, draft: Draft, rng: Rng, bounds: MutationLimits): string | null {
  switch (knob.at) {
    case 'doctrine':
      return turnDoctrine(draft, knob.half, knob.field, rng, bounds);
    case 'fighter':
      return enlist(draft.blueprint);
    case 'reinforcement':
      return reinforce(knob.site, rng, bounds);
    case 'kind':
      return refit(knob.site, rng, bounds);
    case 'barrels':
      return rebarrel(knob.site, rng);
    case 'nozzle':
      return rebell(knob.site, rng, bounds);
    case 'barrelCalibres':
      return relength(knob.site, rng, bounds);
    case 'gunnery':
      return retarget(knob.site, rng, bounds);
    case 'traverse':
      return retrain(knob.site, rng, bounds);
    case 'fuse':
      return refuse(knob.site, rng, bounds);
    case 'fragments':
      return refragment(knob.site, rng, bounds);
    case 'burstSpeed':
      return recharge(knob.site, rng, bounds);
    case 'weapon':
      return rearm(knob.site);
    case 'thick':
      return thicken(knob.site);
    case 'sealing':
      return reseal(knob.site, rng, bounds);
    case 'drainPriority':
      return reprioritise(knob.site, rng);
    case 'angle':
      return turnModule(knob.site, rng, bounds);
    case 'face':
      return moveFace(knob.site, draft, rng, bounds);
    case 'shape':
      return cutCorner(knob.site);
    case 'vertex':
      return moveVertex(knob.site, rng, bounds);
    case 'seam':
      return moveSeam(knob.site, rng, bounds);
    case 'slide':
      return slide(knob.site, rng, bounds);
    case 'place':
      return movePlacement(knob.site, rng, bounds);
    case 'mirror':
      return reflect(knob.site);
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
  rng: Rng,
  bounds: MutationLimits,
): string | null {
  const held = draft.doctrine[half];
  const reference = (
    DEFAULT_DOCTRINE[half] as unknown as Record<string, number>
  )[field]!;
  const scale = max(abs(held[field]!), abs(reference)) || TYPICAL[half];
  const was = held[field]!;
  let now = was + bounds.magnitude * scale * rng.nextRange(-1, 1);
  // Some fields are a size or a distance rather than a weight, and none of
  // those means anything at or below zero. Which they are is the doctrine's
  // own business, not this file's: a rule copied here would be a second
  // opinion about what a doctrine may say, and would be wrong the first time
  // a field was added over there.
  if (POSITIVE_FIELDS.includes(field)) now = max(now, 0.01);
  const tidied = tidy(now, 3);
  // A draw small enough to round away, or one clamped back onto the floor it
  // was already sitting on. Neither is an edit, and counting it as one would
  // let a candidate that changed nothing be accepted as a child.
  if (tidied === was) return null;
  held[field] = tidied;
  return `doctrine.${half}.${field} ${was} → ${tidied}`;
}

/** Make a ship a fighter, or an ordinary ship again. A flip, as `rearm` is. */
function enlist(blueprint: Blueprint): string {
  const was = blueprint.fighter === true;
  if (was) delete blueprint.fighter;
  else blueprint.fighter = true;
  return `fighter: ${was ? 'no longer' : 'now'}`;
}

function reinforce(site: ModuleSite, rng: Rng, bounds: MutationLimits): string | null {
  const was = site.spec.reinforcement ?? 1;
  const now = max(1, tidy(was * (1 + bounds.magnitude * rng.nextRange(-1, 1)), 2));
  // Clamped against the floor, a draw downwards from bare walls changes
  // nothing. Reporting that as an edit would fill a lineage with entries
  // saying a number stayed where it was, and — worse — would let a candidate
  // that did nothing at all be accepted.
  if (now === was) return null;
  site.spec.reinforcement = now;
  return `${site.where} ${site.spec.kind}: reinforcement ${was} → ${now}`;
}

/**
 * Change what a module is, keeping the space it occupies.
 *
 * **This is the only way a lineage gets a large module of a new kind.**
 * Everything new arrives at the smallest size the grid allows and has to be
 * grown, which is right for a guess and wrong as the only path there is: a
 * hull that has spent twenty generations growing a good gun mounting should
 * be able to discover that the same mounting makes a better beam mount,
 * without starting again from half a metre. A refit keeps the geometry — the
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
 * ever have the half-metre ones it adds.
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

/**
 * Lengthen or shorten an engine's bell.
 *
 * A share rather than a length, so the knob means the same thing on a
 * fighter's engine and a capital's, and held off the far end: an engine that
 * is all bell has no block, and the layout rules would refuse it rather than
 * teach the search anything. No bell at all is a legal, bad engine.
 */
function rebell(site: ModuleSite, rng: Rng, bounds: MutationLimits): string | null {
  const was = site.spec.nozzle ?? DEFAULT_NOZZLE_SHARE;
  const now = tidy(clamp(was + bounds.magnitude * rng.nextRange(-1, 1), 0, 0.9), 3);
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
function relength(site: ModuleSite, rng: Rng, bounds: MutationLimits): string | null {
  const was = barrelCalibres(site.spec);
  const step = max(2, was * bounds.magnitude) * rng.nextRange(-1, 1);
  const now = clamp(round(was + step), 1, MAX_BARREL_CALIBRES);
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
function retrain(site: ModuleSite, rng: Rng, bounds: MutationLimits): string | null {
  const step = bounds.turn * rng.nextRange(-1, 1);
  const was = mountTraverse(site.spec);
  const now = max(0, tidy(radiansToDegrees(was + step), 3));
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

/** How often a fragments knob swaps shells for solid shot, rather than recounting them. */
const SOLID_SHOT_CHANCE = 0.2;

/** The slowest burst a nudge leaves, m/s. */
const MIN_BURST_SPEED = 1;

/** The least a sealing lining is nudged by, metres, so an unlined tank can start one. */
const SEALING_STEP = 0.01;

/**
 * Thicken or thin a tank's sealing lining, proportionally, never below none and
 * never so thick it leaves no room inside.
 */
function reseal(site: ModuleSite, rng: Rng, bounds: MutationLimits): string | null {
  const was = site.spec.sealing ?? 0;
  const scale = max(was, SEALING_STEP);
  const now = max(0, tidy(was + bounds.magnitude * scale * rng.nextRange(-1, 1), 4));
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
 * Retime a shell's fuse: a nudge scaled by the fuse itself, so a long one
 * moves as far in proportion as a short one. Zero is a fuse like any other.
 */
function refuse(site: ModuleSite, rng: Rng, bounds: MutationLimits): string | null {
  const was = site.spec.fuse ?? DEFAULT_FUSE;
  const scale = max(was, DEFAULT_FUSE);
  const now = max(0, tidy(was + bounds.magnitude * scale * rng.nextRange(-1, 1), 3));
  if (now === was) return null;
  site.spec.fuse = now;
  return `${site.where} ${site.spec.kind}: fuse ${was} s → ${now} s`;
}

/**
 * Recount a shell's fragments, or change what the gun fires. Mostly a
 * proportional nudge of at least one; sometimes a swap between shells and
 * solid shot, which is a decision rather than a quantity.
 */
function refragment(site: ModuleSite, rng: Rng, bounds: MutationLimits): string | null {
  const was = site.spec.fragments ?? DEFAULT_FRAGMENTS;
  if (was <= 1) {
    delete site.spec.fragments;
    return `${site.where} ${site.spec.kind}: shells again, ${DEFAULT_FRAGMENTS} fragments`;
  }
  if (rng.chance(SOLID_SHOT_CHANCE)) {
    site.spec.fragments = 1;
    return `${site.where} ${site.spec.kind}: solid shot`;
  }
  const step = bounds.magnitude * was * rng.nextRange(-1, 1);
  const nudge = step >= 0 ? max(1, round(step)) : min(-1, round(step));
  const now = min(MAX_FRAGMENTS, max(2, was + nudge));
  if (now === was) return null;
  site.spec.fragments = now;
  return `${site.where} ${site.spec.kind}: fragments ${was} → ${now}`;
}

/** Re-size a shell's charge by how fast it bursts, in proportion to that speed. */
function recharge(site: ModuleSite, rng: Rng, bounds: MutationLimits): string | null {
  const was = site.spec.burstSpeed ?? DEFAULT_BURST_SPEED;
  const now = max(MIN_BURST_SPEED, tidy(was + bounds.magnitude * was * rng.nextRange(-1, 1), 1));
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

function turnModule(site: ModuleSite, rng: Rng, bounds: MutationLimits): string {
  const was = site.spec.angle ?? 0;
  // Unrounded, for the reason `against` gives: a rounded right angle is a
  // module tilted a fraction of a micron into its neighbour.
  site.spec.angle = was + (rng.chance(0.5) ? bounds.turn : -bounds.turn);
  return `${site.where} ${site.spec.kind}: turned ${degrees(was)}° → ${degrees(site.spec.angle)}°`;
}

/**
 * Move one face of a module, growing or shrinking it by a grid step while the
 * opposite face stays exactly where it was.
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
function moveFace(site: ModuleSite, draft: Draft, rng: Rng, bounds: MutationLimits): string | null {
  const spec = site.spec;
  // Nothing to move on a module that is not a box: its size is its corners,
  // and changing the length and width of the box they fit inside would report
  // a change the ship has not got.
  if (isTriangle(spec)) return null;
  const before = { ...spec };
  const along = rng.chance(0.5);
  const side = rng.chance(0.5) ? 1 : -1;
  const delta = rng.chance(0.5) ? bounds.grid : -bounds.grid;

  const was = along ? spec.length : spec.width;
  const now = tidy(was + delta, 6);
  // A module shrunk out of existence is not a module removed: removal is its
  // own operator, and this one stops at the last grid step.
  if (now <= 0) return null;

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
  const centre = moduleCentre(spec);
  const angle = spec.angle ?? 0;
  const c = cos(angle);
  const sn = sin(angle);
  for (const placement of site.list) {
    if (isInstance(placement) || placement === spec) continue;
    if (!(contactWidth(spec, placement) > 0)) continue;
    const other = moduleCentre(placement);
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
 * Towards the far end of that edge or away from it, a grid step at a time, and
 * never so far as to pass the far end: three corners in a line enclose
 * nothing, and a module shrunk out of existence is removal's business.
 */
function moveVertex(site: ModuleSite, rng: Rng, bounds: MutationLimits): string | null {
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
  const step = rng.chance(0.5) ? bounds.grid : -bounds.grid;
  const now = span + step;
  // Past the far end the edge turns inside out; at it the triangle is a line.
  if (now <= bounds.grid / 2) return null;

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
 * Move the face a module shares with a neighbour, one growing by a grid step
 * as the other shrinks by it.
 *
 * It trades space between two modules — hull for engine, say — without the
 * ship getting any bigger, which otherwise takes a shrink and a grow, each of
 * which can be refused. The module that grows must have its whole face
 * against the other, so it only moves into space the other gives up.
 */
function moveSeam(site: ModuleSite, rng: Rng, bounds: MutationLimits): string | null {
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
  const delta = grow ? bounds.grid : -bounds.grid;
  const moved = shiftSeam(spec, other, seam, delta, bounds.grid);
  if (moved.a.length === spec.length && moved.a.width === spec.width) return null;

  const was = seam.a.along !== 0 ? spec.length : spec.width;
  Object.assign(spec, moved.a);
  Object.assign(other, moved.b);
  const now = seam.a.along !== 0 ? spec.length : spec.width;
  return `${site.where} ${spec.kind}: seam with ${site.label}[${index}] ${other.kind}, ${was} → ${now}`;
}

function slide(site: ModuleSite, rng: Rng, bounds: MutationLimits): string {
  const step = rng.chance(0.5) ? bounds.grid : -bounds.grid;
  const axis = rng.chance(0.5) ? 'x' : 'y';
  site.spec[axis] = tidy(site.spec[axis] + step, 6);
  return `${site.where} ${site.spec.kind}: ${axis} ${step > 0 ? '+' : ''}${step}`;
}

function movePlacement(site: InstanceSite, rng: Rng, bounds: MutationLimits): string {
  const step = rng.chance(0.5) ? bounds.grid : -bounds.grid;
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
  const out: ModuleSpec = { ...spec, x: local.x, y: flipped ? -local.y : local.y };
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
    x: instance.x + spec.x * c - localY * sn,
    y: instance.y + spec.x * sn + localY * c,
  };
  const angle = turn + own;
  if (spec.angle !== undefined || angle !== 0) out.angle = angle;
  return out;
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
function instantiate(draft: Draft, rng: Rng, bounds: MutationLimits): string | null {
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
    // Clear of the original rather than a grid step from it. A part is nearly
    // always wider than one step, so a copy nudged along lands inside the
    // thing it is a copy of and is refused every time — which is how "place
    // another one" came to be the operator that never delivered anything.
    const along = rng.chance(0.5);
    const room = clearance(draft, instance, along, bounds);
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
 * rounded up to the grid.
 *
 * Measured against a circle round each module rather than its box, so the
 * answer holds whatever angle anything is at, and read off the assembly's own
 * frame — which is the frame the offset is applied in, so a turned instance
 * needs no second thought. An assembly with anything nested inside it gets a
 * grid step and the layout rules' opinion, since measuring that properly
 * means expanding it.
 */
function clearance(
  draft: Draft,
  instance: AssemblyInstance,
  along: boolean,
  bounds: MutationLimits,
): number {
  const assembly = draft.assemblies[instance.use];
  if (assembly === undefined || assembly.modules.some(isInstance)) return bounds.grid;
  let far = 0;
  for (const placement of assembly.modules) {
    const spec = placement as ModuleSpec;
    const centre = moduleCentre(spec);
    const reach = max(spec.length, spec.width) / 2;
    far = max(far, abs(along ? centre.x : centre.y) + reach);
  }
  const wanted = 2 * far;
  return max(bounds.grid, ceilTo(wanted, bounds.grid));
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
function extend(draft: Draft, rng: Rng, bounds: MutationLimits): string | null {
  return addModule(draft, rng, bounds, false, true);
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
function restructure(draft: Draft, rng: Rng, bounds: MutationLimits): string | null {
  // A third of structural generations are about the *grouping* rather than
  // the modules. They are far more often impossible than a module edit — a
  // ship with no assemblies has five of the six unavailable — so one that
  // comes to nothing falls back to a module edit rather than costing the
  // generation its structure.
  if (rng.nextInt(3) === 0) {
    const operator = ASSEMBLY_OPERATORS[rng.nextInt(ASSEMBLY_OPERATORS.length)]!;
    const edit = operator(draft, rng, bounds);
    if (edit !== null) return edit;
  }

  const draw = rng.nextInt(4);
  if (draw < 2) return removePlacement(draft, rng);
  return addModule(draft, rng, bounds, draw === 2);
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
    for (const face of faces(anchor.spec, outward, rng)) {
      for (const along of berths(anchor.spec, face, copy, bounds, rng)) {
        const added = against(anchor.spec, face, along, kind, copy, bounds, rng);
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
 * grid like everything else the operator writes. Drawn in a random order and
 * tried until one fits, so a face with a gap in the middle of it is found
 * rather than given up on.
 */
function berths(
  anchor: ModuleSpec,
  face: number,
  copy: boolean,
  bounds: MutationLimits,
  rng: Rng,
): number[] {
  const endOn = face % 2 === 0;
  const span = endOn ? anchor.width : anchor.length;
  const across = copy ? span : bounds.grid;
  const room = span - across;
  if (!(room > 0)) return [0];

  const steps = floor(room / bounds.grid);
  const berth: number[] = [];
  for (let i = 0; i <= steps; i++) berth.push(tidy(-room / 2 + i * bounds.grid, 6));
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
  const centre = moduleCentre(anchor);
  const reach = (endOn ? anchor.length : anchor.width) / 2;
  const faceX = centre.x + nx * reach + ax * along;
  const faceY = centre.y + ny * reach + ay * along;

  // **A copy keeps its original's proportions; anything new starts as small
  // as the grid allows.** A new module is a guess, and a guess should be
  // cheap: sized from the face it is going on, a first gun on a capital
  // arrives weighing tonnes and has to justify all of it at once, where one
  // that starts at half a metre costs almost nothing and is grown a face at a
  // time by the operator that grows faces — which is the difference between
  // a lineage that can afford to try something and one that cannot.
  const across = copy ? (endOn ? anchor.width : anchor.length) : bounds.grid;
  const out = copy ? (endOn ? anchor.length : anchor.width) : bounds.grid;

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
