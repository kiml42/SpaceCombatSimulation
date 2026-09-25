import {
  blueprintProblem,
  compileDraft,
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
import { abs, clamp, cos, floor, HALF_PI, max, PI, round, sin } from '../sim/math.js';
import { degreesToRadians, radiansToDegrees } from '../sim/blueprintFile.js';
import {
  DEFAULT_NOZZLE_SHARE,
  isWeaponMount,
  mountTraverse,
  isHullMount,
  MODULE_KINDS,
  moduleCentre,
  type ModuleKind,
  type ModuleSpec,
} from '../sim/modules.js';
import { pushNeighbours, sharedFace, shiftSeam, type SharedFace } from '../sim/push.js';
import type { Rng } from '../sim/rng.js';

/**
 * How one blueprint becomes a different one: the operator a generation is
 * bred with.
 *
 * **What it changes is the layout's own text.** A module written inside an
 * assembly is written once however many copies are placed, so mutating it
 * changes every copy — which is the point of assemblies and the reason a
 * lineage stays legible instead of drifting into eight slightly different
 * thrusters. The same holds in reverse: a placement moved is one copy moved.
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
}

export type KindWeights = Readonly<Record<ModuleKind, number>>;

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
  thruster: 5,
  structure: 4,
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
  grid: 0.5,
  turn: PI / 12,
  massBudget: Infinity,
  attempts: 24,
  kinds: DEFAULT_KINDS,
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
  let spent = 0;
  if (rng.chance(bounds.structural)) {
    const child = breed(parent, rng, bounds, true);
    if (child !== null) return child;
    // Nowhere to put anything and nothing that can be spared: a dense little
    // hull has generations where this is simply true. Breeding a child that
    // differs in its numbers beats handing back a copy of its parent.
    spent = bounds.attempts;
  }

  const child = breed(parent, rng, bounds, false);
  return child ?? { blueprint: parent, edits: [], attempts: spent + bounds.attempts };
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
      const edit = renumber(available.splice(rng.nextInt(available.length), 1)[0]!, draft, rng, bounds);
      if (edit !== null) edits.push(edit);
    }

    if (edits.length === 0) continue;
    if (buildable(draft.blueprint, bounds.massBudget)) {
      return { blueprint: draft.blueprint, edits, attempts: attempt };
    }
  }
  return null;
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
      if (placement.extra !== undefined) walk(placement.extra, `${label}/${placement.use}`);
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
    // An instance's extras are placements written in the layout like any
    // other, so they are collected and mutated like any other.
    if (placement.extra !== undefined) {
      instance.extra = clonePlacements(placement.extra, `${label}/${placement.use}`, lists);
    }
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
  | { readonly at: 'reinforcement'; readonly site: ModuleSite }
  | { readonly at: 'kind'; readonly site: ModuleSite }
  | { readonly at: 'barrels'; readonly site: ModuleSite }
  | { readonly at: 'nozzle'; readonly site: ModuleSite }
  | { readonly at: 'traverse'; readonly site: ModuleSite }
  | { readonly at: 'gunnery'; readonly site: ModuleSite }
  | { readonly at: 'weapon'; readonly site: ModuleSite }
  | { readonly at: 'angle'; readonly site: ModuleSite }
  | { readonly at: 'face'; readonly site: ModuleSite }
  | { readonly at: 'seam'; readonly site: ModuleSite }
  | { readonly at: 'slide'; readonly site: ModuleSite }
  | { readonly at: 'place'; readonly site: InstanceSite }
  | { readonly at: 'mirror'; readonly site: InstanceSite }
  | { readonly at: 'repeat'; readonly site: InstanceSite };

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

  for (const list of draft.lists) {
    for (let i = 0; i < list.placements.length; i++) {
      const placement = list.placements[i]!;
      const where = `${list.label}[${i}]`;
      if (isInstance(placement)) {
        const site: InstanceSite = { instance: placement, where };
        out.push({ at: 'place', site }, { at: 'mirror', site });
        if (placement.step !== undefined) out.push({ at: 'repeat', site });
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
      if (placement.kind !== 'structure' && placement.kind !== 'core') {
        out.push({ at: 'angle', site });
      }
      if (placement.kind === 'turret' || placement.kind === 'beamTurret') {
        out.push({ at: 'barrels', site });
      }
      if (isWeaponMount(placement.kind)) {
        // How much arc a weapon is built for, which on a hull mount is mass
        // as well as coverage — a fixed gun carries no training gear, and
        // whether that trade is worth taking is exactly what a run is for.
        out.push({ at: 'traverse', site }, { at: 'gunnery', site });
      }
      if (isHullMount(placement.kind)) {
        // How much of the mount is barrel is the archetype's real knob, and
        // the outlet count divides the same opening between more of them. The
        // knob is `nozzle`, the same field an engine's bell is a share in:
        // one quantity, so one line finds it on either archetype.
        out.push({ at: 'barrels', site }, { at: 'nozzle', site });
      }
      if (placement.kind === 'thruster') {
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
    case 'reinforcement':
      return reinforce(knob.site, rng, bounds);
    case 'kind':
      return refit(knob.site, rng, bounds);
    case 'barrels':
      return rebarrel(knob.site, rng);
    case 'nozzle':
      return rebell(knob.site, rng, bounds);
    case 'gunnery':
      return retarget(knob.site, rng, bounds);
    case 'traverse':
      return retrain(knob.site, rng, bounds);
    case 'weapon':
      return rearm(knob.site);
    case 'angle':
      return turnModule(knob.site, rng, bounds);
    case 'face':
      return moveFace(knob.site, draft, rng, bounds);
    case 'seam':
      return moveSeam(knob.site, rng, bounds);
    case 'slide':
      return slide(knob.site, rng, bounds);
    case 'place':
      return movePlacement(knob.site, rng, bounds);
    case 'mirror':
      return reflect(knob.site);
    case 'repeat':
      return repeat(knob.site, rng);
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
 * **An engine is the awkward one, and it is worth saying why.** A thruster's
 * position is where it is *attached* — the face opposite the nozzle — where
 * every other kind's is the middle of its box, so changing the kind and
 * leaving the numbers alone slides the module half its own length and lands
 * it inside its neighbour. What is kept is therefore the space, not the
 * coordinates: the centre is measured before and put back afterwards. Which
 * way a new engine points is a free choice besides, since nothing about the
 * module it was says which face should push, so that is drawn here and the
 * attempts try different ones. Every other kind keeps the facing it had,
 * because for those it means something.
 *
 * Neither is a nicety: without them a refit into an engine is refused every
 * time, so the one route to a *large* engine is closed and a lineage can only
 * ever have the half-metre ones it adds.
 */
function refit(site: ModuleSite, rng: Rng, bounds: MutationLimits): string | null {
  const was = site.spec.kind;
  const to = pickKind(rng, bounds.kinds, was);
  if (to === null) return null;
  const centre = moduleCentre(site.spec);
  site.spec.kind = to;
  if (to === 'thruster') {
    const angle = (site.spec.angle ?? 0) + rng.nextInt(4) * HALF_PI;
    site.spec.angle = angle;
    site.spec.x = centre.x + cos(angle) * (site.spec.length / 2);
    site.spec.y = centre.y + sin(angle) * (site.spec.length / 2);
  } else if (was === 'thruster') {
    site.spec.x = centre.x;
    site.spec.y = centre.y;
  }
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
 * Lengthen or shorten what sticks out of a module: an engine's bell, or a
 * hull mount's barrel or lens housing.
 *
 * One operator, because it is one field and one quantity — how the module
 * divides between its protrusion and the block behind it. A share rather than
 * a length, so the knob means the same thing on a fighter's thruster and a
 * capital's, and held off both ends: a module that is all protrusion has no
 * block, and the layout rules would refuse it rather than teach the search
 * anything.
 */
function rebell(site: ModuleSite, rng: Rng, bounds: MutationLimits): string | null {
  const hullMount = isHullMount(site.spec.kind);
  const was = site.spec.nozzle ?? DEFAULT_NOZZLE_SHARE;
  // Held off both ends, and off the far end harder on a weapon: all barrel
  // leaves nothing to load it from, where an engine with no bell at all is a
  // rocket whose nozzle has fallen off and is a legal, bad engine.
  const low = hullMount ? 0.05 : 0;
  const now = tidy(clamp(was + bounds.magnitude * rng.nextRange(-1, 1), low, 0.9), 3);
  if (now === was) return null;
  site.spec.nozzle = now;
  const what = hullMount ? 'barrel' : 'nozzle';
  return `${site.where} ${site.spec.kind}: ${what} ${was} → ${now}`;
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
  // A thruster is held on by the face it pushes from and its position is the
  // middle of that face, so lengthening one from the nozzle end moves nothing
  // at all — every other case moves the box's centre by half the change.
  let localX = 0;
  let localY = 0;
  if (along) {
    if (spec.kind === 'thruster') localX = side > 0 ? delta : 0;
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

/** Lengthen or shorten a repeated row — the cheapest structural change there is. */
function repeat(site: InstanceSite, rng: Rng): string | null {
  const was = site.instance.repeat ?? 1;
  const now = was + (rng.chance(0.5) ? 1 : -1);
  if (now < 1 || now > MAX_REPEAT) return null;
  site.instance.repeat = now;
  return `${site.where} ${site.instance.use}: repeat ${was} → ${now}`;
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
 * Only a plain instance is dissolved: one copy, nothing nested inside, and no
 * extras of its own. The rest would be the same arithmetic several times over
 * for an edit that is rarely the one wanted, and a lineage reaches them by
 * taking the repeat down and the extras out first.
 */
function ungroup(draft: Draft, rng: Rng): string | null {
  const sites = instanceSites(draft).filter((site) => {
    const instance = site.instance;
    if ((instance.repeat ?? 1) !== 1 || instance.extra !== undefined) return false;
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
) => string | null)[] = [group, ungroup, absorb, extend, instantiate, dropInstance];

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
      if (!isInstance(placement)) anchors.push({ list, spec: placement, index: i });
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
        const added = against(anchor.spec, face, along, kind, copy, bounds);
        if (neighbours.some((neighbour) => modulesOverlap(added, neighbour))) continue;
        anchor.list.placements.push(added);
        return (
          `${anchor.list.label}[${anchor.index}] ${anchor.spec.kind}: ` +
          `${copy ? `copied onto` : `a ${kind} added to`} its ${faceName(face)} face`
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
  // A thruster is mounted facing *into* the anchor, which puts its position
  // exactly on the face and its exhaust pointing out into clear air. Nothing
  // refuses an engine pointed the other way any more; it is simply the only
  // way round worth guessing, since the other burns the ship it is bolted to.
  // A hull weapon is the mirror of that: it is held on by the block behind
  // its barrel, so it faces *out* and the barrel clears the ship. Everything
  // else has no front and sits on the face, half its own depth out, lying
  // along it.
  // **The angle is not rounded, and that is load-bearing.** Positions are
  // tidied because they are worked out through sines and cosines and land on
  // values no file should carry; an angle is not, because a module sits
  // against its neighbour's face and two boxes that merely touch must not
  // count as overlapping. Rounding a right angle to six places tilts a module
  // by three ten-millionths of a radian, which puts a corner of it some
  // eighty nanometres inside the hull it is bolted to — and the overlap test
  // is exact, so the layout is refused. It cost every thruster: mounted
  // facing *into* its anchor, a thruster's angle is a right angle plus half a
  // turn and so was never one of the two values that survive rounding, and
  // not one could be added to any face of any ship. Angles are exact in
  // radians here and exact in degrees in the file, which is where legibility
  // was the concern in the first place.
  const added: ModuleSpec =
    kind === 'thruster'
      ? {
          kind,
          x: tidy(faceX, 6),
          y: tidy(faceY, 6),
          angle: normalAngle + PI,
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
