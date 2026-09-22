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
  TARGETING_FIELDS,
  toDoctrine,
  type Doctrine,
} from '../sim/doctrine.js';
import { abs, cos, max, PI, round, sin } from '../sim/math.js';
import { moduleCentre, type ModuleKind, type ModuleSpec } from '../sim/modules.js';
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
}

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
  const bounds: MutationLimits = { ...DEFAULT_LIMITS, ...limits };

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
  readonly lists: readonly PlacementList[];
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

  return { blueprint, lists, doctrine };
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
  | { readonly at: 'barrels'; readonly site: ModuleSite }
  | { readonly at: 'angle'; readonly site: ModuleSite }
  | { readonly at: 'face'; readonly site: ModuleSite }
  | { readonly at: 'slide'; readonly site: ModuleSite }
  | { readonly at: 'place'; readonly site: InstanceSite }
  | { readonly at: 'repeat'; readonly site: InstanceSite };

interface ModuleSite {
  readonly spec: ModuleSpec;
  readonly where: string;
}

interface InstanceSite {
  readonly instance: AssemblyInstance;
  readonly where: string;
}

function knobs(draft: Draft): Knob[] {
  const out: Knob[] = [];
  for (const field of TARGETING_FIELDS) out.push({ at: 'doctrine', half: 'targeting', field });
  for (const field of APPROACH_FIELDS) out.push({ at: 'doctrine', half: 'approach', field });

  for (const list of draft.lists) {
    for (let i = 0; i < list.placements.length; i++) {
      const placement = list.placements[i]!;
      const where = `${list.label}[${i}]`;
      if (isInstance(placement)) {
        const site: InstanceSite = { instance: placement, where };
        out.push({ at: 'place', site });
        if (placement.step !== undefined) out.push({ at: 'repeat', site });
        continue;
      }
      const site: ModuleSite = { spec: placement, where };
      out.push({ at: 'reinforcement', site }, { at: 'face', site }, { at: 'slide', site });
      if (placement.kind !== 'structure' && placement.kind !== 'core') {
        out.push({ at: 'angle', site });
      }
      if (placement.kind === 'turret' || placement.kind === 'beamTurret') {
        out.push({ at: 'barrels', site });
      }
    }
  }
  return out;
}

function renumber(knob: Knob, draft: Draft, rng: Rng, bounds: MutationLimits): string | null {
  switch (knob.at) {
    case 'doctrine':
      return turnDoctrine(draft, knob.half, knob.field, rng, bounds);
    case 'reinforcement':
      return reinforce(knob.site, rng, bounds);
    case 'barrels':
      return rebarrel(knob.site, rng);
    case 'angle':
      return turnModule(knob.site, rng, bounds);
    case 'face':
      return moveFace(knob.site, rng, bounds);
    case 'slide':
      return slide(knob.site, rng, bounds);
    case 'place':
      return movePlacement(knob.site, rng, bounds);
    case 'repeat':
      return repeat(knob.site, rng);
  }
}

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
  const scale = max(abs(held[field]!), abs(reference));
  const was = held[field]!;
  let now = was + bounds.magnitude * scale * rng.nextRange(-1, 1);
  // Two fields are a size and a distance rather than a weight, and neither
  // means anything at or below zero.
  if (field === 'preferredMass' || field === 'standoffRadii') now = max(now, 0.01);
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

function turnModule(site: ModuleSite, rng: Rng, bounds: MutationLimits): string {
  const was = site.spec.angle ?? 0;
  const now = was + (rng.chance(0.5) ? bounds.turn : -bounds.turn);
  site.spec.angle = tidy(now, 6);
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
 */
function moveFace(site: ModuleSite, rng: Rng, bounds: MutationLimits): string | null {
  const spec = site.spec;
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

  return `${site.where} ${spec.kind}: ${along ? 'length' : 'width'} ${was} → ${now}`;
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

// -- Structure -------------------------------------------------------------

/**
 * What a new module is likely to be.
 *
 * Structure is commonest because it is what the others are bolted to, and a
 * core is rare because a hull needs one and rarely wants three — though a
 * second one is exactly what makes a ship survive being cut in half, so the
 * chance is not zero.
 */
const KIND_WEIGHTS: readonly (readonly [ModuleKind, number])[] = [
  ['structure', 5],
  ['thruster', 3],
  ['turret', 3],
  ['beamTurret', 1],
  ['core', 1],
];

/**
 * Add, copy or remove one module.
 *
 * Adding is drawn for twice as often as removing, and that is a correction
 * rather than a preference. A module taken off a hull usually leaves a layout
 * the rules still accept, while one bolted on has to find somewhere it fits —
 * so an even draw is not an even outcome, and a lineage bred from one erodes:
 * it loses a module whenever it gains one and then goes on losing, until it
 * is a hull with no guns on it. What the ratio is calibrated against is the
 * *accepted* mix, which `mutation.test.ts` pins by breeding a lineage and
 * checking it neither withers nor runs away.
 */
function restructure(draft: Draft, rng: Rng, bounds: MutationLimits): string | null {
  const draw = rng.nextInt(3);
  if (draw === 0) return removePlacement(draft, rng);
  return addModule(draft, rng, bounds, draw === 1);
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
function addModule(draft: Draft, rng: Rng, bounds: MutationLimits, copy: boolean): string | null {
  const anchors: { list: PlacementList; spec: ModuleSpec; index: number }[] = [];
  for (const list of draft.lists) {
    for (let i = 0; i < list.placements.length; i++) {
      const placement = list.placements[i]!;
      if (!isInstance(placement)) anchors.push({ list, spec: placement, index: i });
    }
  }
  if (anchors.length === 0) return null;

  const firstAnchor = rng.nextInt(anchors.length);
  const firstFace = rng.nextInt(4);
  for (let a = 0; a < anchors.length; a++) {
    const anchor = anchors[(firstAnchor + a) % anchors.length]!;
    const neighbours = anchor.list.placements.filter(
      (placement): placement is ModuleSpec => !isInstance(placement) && placement !== anchor.spec,
    );
    const kind = copy ? anchor.spec.kind : pickKind(rng);
    for (let i = 0; i < 4; i++) {
      const face = (firstFace + i) % 4;
      const added = against(anchor.spec, face, kind, copy, bounds);
      if (neighbours.some((neighbour) => modulesOverlap(added, neighbour))) continue;
      anchor.list.placements.push(added);
      return (
        `${anchor.list.label}[${anchor.index}] ${anchor.spec.kind}: ` +
        `${copy ? `copied onto` : `a ${kind} added to`} its ${faceName(face)} face`
      );
    }
  }
  return null;
}

/**
 * A module of the given kind, flush against one face of another.
 *
 * `face` counts quarter turns from the anchor's own facing, so face 0 is
 * whatever the anchor calls forward and the sides follow round.
 */
function against(
  anchor: ModuleSpec,
  face: number,
  kind: ModuleKind,
  copy: boolean,
  bounds: MutationLimits,
): ModuleSpec {
  const angle = anchor.angle ?? 0;
  const normalAngle = angle + (face * PI) / 2;
  const nx = cos(normalAngle);
  const ny = sin(normalAngle);
  const endOn = face % 2 === 0;
  const centre = moduleCentre(anchor);
  const reach = (endOn ? anchor.length : anchor.width) / 2;
  const faceX = centre.x + nx * reach;
  const faceY = centre.y + ny * reach;

  // A copy keeps its original's proportions; a new module is sized from the
  // face it is going on, so what is added to a capital is capital-sized and
  // what is added to a fighter is not.
  const across = endOn ? anchor.width : anchor.length;
  const out = copy
    ? endOn
      ? anchor.length
      : anchor.width
    : max(bounds.grid, snap((endOn ? anchor.length : anchor.width) / 2, bounds.grid));

  // A thruster is held on by the face it pushes from, so it is mounted facing
  // *into* the anchor — which puts its position exactly on the face and its
  // exhaust pointing out. Everything else sits centred on the face, half its
  // own depth out.
  const added: ModuleSpec =
    kind === 'thruster'
      ? {
          kind,
          x: tidy(faceX, 6),
          y: tidy(faceY, 6),
          angle: tidy(normalAngle + PI, 6),
          length: out,
          width: across,
        }
      : {
          kind,
          x: tidy(faceX + (nx * out) / 2, 6),
          y: tidy(faceY + (ny * out) / 2, 6),
          angle: tidy(endOn ? angle : angle + PI / 2, 6),
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

function pickKind(rng: Rng): ModuleKind {
  let total = 0;
  for (const [, weight] of KIND_WEIGHTS) total += weight;
  let draw = rng.nextRange(0, total);
  for (const [kind, weight] of KIND_WEIGHTS) {
    draw -= weight;
    if (draw < 0) return kind;
  }
  return 'structure';
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

function snap(value: number, grid: number): number {
  return round(value / grid) * grid;
}

function degrees(radians: number): number {
  return tidy((radians / PI) * 180, 3);
}
