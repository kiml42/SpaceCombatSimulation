import {
  blueprintFaults,
  compileDraft,
  expandWithOrigins,
  isInstance,
  placementAt,
  samePlacement,
  type Blueprint,
  type BlueprintFault,
  type ModuleOrigin,
  type ModulePath,
  type ModuleSpec,
  type Placement,
  type ShipDesign,
} from '../sim/index.js';
import { cloneBlueprint, instanceChain } from './edit.js';
import { History } from './history.js';

/**
 * The layout being worked on, everything derived from it, and the way back to
 * how it was.
 *
 * Deliberately knows nothing about a canvas or a panel. What it holds is the
 * answer to "what is true of the ship right now", which is a question a test
 * can ask as easily as a page can — and the interesting failures of an editor
 * are all in this half: a selection surviving an edit that removed what it
 * pointed at, an undo that half-restores, a derived figure that goes stale.
 */

/**
 * A box to draw around one drawn copy of a group.
 *
 * Copies are told apart because they are edited apart: dragging the selection
 * moves the copy that was clicked and leaves the others, exactly as a shared
 * module's copies behave.
 */
export interface GroupOutline {
  /** The drawn modules this copy of the group puts on the ship. */
  modules: number[];
  /** The copy that was clicked, rather than one of the others it is placed as. */
  primary: boolean;
  /** Drawn because something inside it is selected, rather than being selected itself. */
  context: boolean;
}

/** The innermost group a placement is written in, by name. */
function enclosingAssembly(path: ModulePath): string | null {
  for (let i = path.length - 1; i >= 0; i--) {
    const step = path[i]!;
    if (step.into === 'assembly' && step.assembly !== undefined) return step.assembly;
  }
  return null;
}

export { HISTORY_LIMIT } from './history.js';

/** Everything read off the current layout, recomputed whenever it changes. */
export interface Derived {
  /** The layout resolved to the modules a ship would be built from. */
  modules: readonly ModuleSpec[];
  /** Where each of those was written. Same order. */
  origins: readonly ModuleOrigin[];
  /**
   * The compiled design, or null when the layout is too broken to measure at
   * all — which is a much smaller set of layouts than the invalid ones. A ship
   * with modules overlapping still compiles, and has to: dragging one module
   * through another is how you get it past.
   */
  design: ShipDesign | null;
  /** Why there is no design, when there is none. */
  underivable: string | null;
  /** Everything wrong with the layout, shown rather than enforced. */
  problems: readonly string[];
  /**
   * The drawn modules some problem names, in the order they are drawn.
   *
   * The problems list says what is wrong and this says *where*: a sentence
   * about "modules 3 and 7" is a puzzle on a ship of forty, and the canvas can
   * answer it at a glance.
   */
  faulty: readonly number[];
}

/** The drawn modules named by any fault, deduplicated and in drawing order. */
function faultyModules(faults: readonly BlueprintFault[], count: number): number[] {
  const flagged = new Set<number>();
  for (const fault of faults) for (const index of fault.modules) flagged.add(index);
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (flagged.has(i)) out.push(i);
  return out;
}

function derive(blueprint: Blueprint): Derived {
  const faults = blueprintFaults(blueprint);
  const problems = faults.map((fault) => fault.message);
  let modules: readonly ModuleSpec[] = [];
  let origins: readonly ModuleOrigin[] = [];
  try {
    const expansion = expandWithOrigins(blueprint);
    modules = expansion.modules;
    origins = expansion.origins;
  } catch {
    // Already reported: an expansion that throws is the first thing
    // `blueprintFaults` complains about.
    return {
      modules,
      origins,
      design: null,
      underivable: problems[0] ?? null,
      problems,
      faulty: [],
    };
  }
  const faulty = faultyModules(faults, modules.length);
  try {
    return {
      modules,
      origins,
      design: compileDraft(blueprint),
      underivable: null,
      problems,
      faulty,
    };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { modules, origins, design: null, underivable: why, problems, faulty };
  }
}

export class EditorDocument {
  private readonly history: History<Blueprint>;
  private derived: Derived;

  /**
   * The placements being edited, in the order they were picked. A *placement*
   * and not a drawn module: selecting one of eight copies of a thruster
   * selects the thruster, because that is the thing an edit would change.
   *
   * An ordered list rather than a set, and the order is load-bearing: the
   * first one picked is the module a group is built around, so which module
   * was clicked first has to survive all the way to `groupPlacements`.
   *
   * The properties panel edits one placement at a time, so everything that
   * reads a single selection reads the first of these. Picking several is for
   * the operations that act on a *set* — grouping, today.
   */
  private selected: ModulePath[] = [];

  /**
   * Which drawn copy was picked, when the selection is shared.
   *
   * It decides the frame an edit is expressed in, and so it is not a detail of
   * the highlight: a mirrored wing dragged towards the bow moves *aft* in the
   * frame its modules are written in, and dragging the starboard copy while
   * the port one's frame was used would send it the wrong way.
   */
  private grabbed = 0;

  constructor(blueprint: Blueprint) {
    this.history = new History(cloneBlueprint(blueprint));
    this.derived = derive(this.history.current);
  }

  get blueprint(): Blueprint {
    return this.history.current;
  }

  private get current(): Blueprint {
    return this.history.current;
  }

  get view(): Derived {
    return this.derived;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** Make a change, keeping the layout as it was on the undo stack. */
  apply(next: Blueprint): void {
    this.history.apply(next);
    this.set(next);
  }

  /**
   * Make a change that continues the last one, without a second undo step.
   *
   * A drag is one action to the player and several hundred blueprints to the
   * editor. Without this, undo walks back through the pointer's path a pixel
   * at a time — technically a faithful history, and useless.
   */
  amend(next: Blueprint): void {
    this.history.amend(next);
    this.set(next);
  }

  /** Load a different ship. The history does not follow: it belonged to the old one. */
  replace(blueprint: Blueprint): void {
    this.selected = [];
    this.history.replace(cloneBlueprint(blueprint));
    this.set(this.history.current);
  }

  undo(): boolean {
    if (!this.history.undo()) return false;
    this.set(this.history.current);
    return true;
  }

  redo(): boolean {
    if (!this.history.redo()) return false;
    this.set(this.history.current);
    return true;
  }

  /** The placement an edit would change: the first one picked, or null. */
  get selection(): ModulePath | null {
    return this.selected[0] ?? null;
  }

  /** Everything picked, in the order it was picked. */
  get selections(): readonly ModulePath[] {
    return this.selected;
  }

  /** Select the placement that drew module `index`, or clear the selection. */
  selectModule(index: number): void {
    const path = this.derived.origins[index]?.path;
    this.selected = path === undefined ? [] : [path];
    this.grabbed = path === undefined ? 0 : index;
  }

  /**
   * Add the placement that drew module `index` to the selection, or take it
   * out again if it is already there.
   *
   * By placement and not by drawn module, so that picking a second copy of a
   * part already selected removes it rather than adding a duplicate — the two
   * copies are one placement, and an edit could not tell them apart anyway.
   */
  toggleModule(index: number): void {
    const path = this.derived.origins[index]?.path;
    if (path === undefined) return;
    const at = this.selected.findIndex((each) => samePlacement(each, path));
    if (at >= 0) {
      this.selected.splice(at, 1);
      if (this.grabbed === index) this.grabbed = 0;
      return;
    }
    this.selected.push(path);
    this.grabbed = index;
  }

  /**
   * Select a placement that a particular drawn module led to.
   *
   * The index is kept as the grabbed copy even when the path names something
   * above the module — a group dragged by one of its parts has to be written
   * in that part's frame, and the highlight has to brighten the copy under the
   * pointer rather than whichever one the layout drew first.
   */
  selectAt(index: number, path: ModulePath | null): void {
    this.selected = path === null ? [] : [path];
    this.grabbed = path === null ? 0 : index;
  }

  /** Add a placement to the selection, or take it out if it is already there. */
  togglePath(path: ModulePath | null): void {
    if (path === null) return;
    const at = this.selected.findIndex((each) => samePlacement(each, path));
    if (at >= 0) this.selected.splice(at, 1);
    else this.selected.push(path);
  }

  /** The selected group, when exactly one thing is selected and it is a group. */
  selectedGroupPath(): ModulePath | null {
    if (this.selected.length !== 1) return null;
    const path = this.selected[0]!;
    return this.isGroup(path) ? path : null;
  }

  /**
   * The one selected group and the loose modules picked alongside it, which is
   * what adding to a group needs.
   */
  groupAndLooseSelection(): { group: ModulePath; modules: ModulePath[] } | null {
    const groups = this.selected.filter((path) => this.isGroup(path));
    if (groups.length !== 1) return null;
    const modules = this.selected.filter((path) => !this.isGroup(path));
    if (modules.length === 0) return null;
    return { group: groups[0]!, modules };
  }

  select(path: ModulePath | null): void {
    this.selected = path === null ? [] : [path];
    this.grabbed = 0;
  }

  /**
   * The selected placement as it is *written*, or null.
   *
   * Not the drawn module, which is a different thing wearing the same values:
   * an expanded module carries the coordinates and facing it ended up at after
   * its assembly was turned and reflected, while the placement carries the
   * ones somebody typed. The panel edits what was typed.
   */
  get selectedPlacement(): Placement | null {
    const path = this.selection;
    if (path === null) return null;
    return placementAt(this.current, path);
  }

  /**
   * Which drawn modules the selection accounts for.
   *
   * More than one means the selection is shared, and the count is the honest
   * way to say so: rather than reasoning about whether a path passes through
   * an assembly or a repeat, ask how many modules the layout actually drew
   * from it.
   */
  selectedModules(): number[] {
    const path = this.selection;
    if (path === null) return [];
    const out: number[] = [];
    for (let i = 0; i < this.derived.origins.length; i++) {
      if (samePlacement(this.derived.origins[i]!.path, path)) out.push(i);
    }
    // The copy that was picked comes first, so a caller asking for "the"
    // selected module gets the one under the pointer rather than whichever
    // copy the layout happened to draw first.
    const picked = out.indexOf(this.grabbed);
    if (picked > 0) {
      out.splice(picked, 1);
      out.unshift(this.grabbed);
    }
    return out;
  }

  /** The origin of the picked copy, which carries the frame an edit is written in. */
  selectedOrigin(): ModuleOrigin | null {
    const drawn = this.selectedModules();
    if (drawn.length === 0) return null;
    return this.derived.origins[drawn[0]!] ?? null;
  }

  /**
   * One origin per picked placement, in the order they were picked — which is
   * what an operation over the whole selection needs, and what carries the
   * "first one picked" that decides a group's origin.
   */
  selectedOrigins(): ModuleOrigin[] {
    const out: ModuleOrigin[] = [];
    for (const path of this.selected) {
      const found = this.derived.origins.find((origin) => samePlacement(origin.path, path));
      if (found !== undefined) out.push(found);
    }
    return out;
  }

  /**
   * Whether a placement accounts for a drawn module: either it wrote it, or it
   * is an instance somewhere above it.
   *
   * The second half is what makes a group selectable at all. An instance draws
   * nothing itself — its assembly's modules do — so a test that only asked
   * "did this placement write that module" would call every group selection
   * dead, and the panel editing one would close on its own first edit.
   */
  private accountsFor(path: ModulePath, drawn: ModulePath): boolean {
    return samePlacement(drawn, path) || this.under(drawn, path);
  }

  /** Whether one placement is written inside another — at any depth. */
  private under(inner: ModulePath, outer: ModulePath): boolean {
    for (let k = 1; k < inner.length; k++) {
      const step = inner[k - 1]!;
      // Named rather than descended through, so the hop is dropped.
      const ancestor = [...inner.slice(0, k - 1), { index: step.index, copy: step.copy }];
      if (samePlacement(ancestor, outer)) return true;
    }
    return false;
  }

  /**
   * What clicking a drawn module should select: the group it is in, or the
   * module itself once you are already in that group.
   *
   * A grouped module is part of a thing before it is a module, and the thing
   * is what you usually want — dragging a wing should move the wing. So a
   * click lands on the outermost group and a second one goes in, a level at a
   * time, which is how a person expects to get at a wing before getting at a
   * bracket on it.
   *
   * "Already in that group" counts a sibling too, not only the group itself:
   * once you are working inside a wing, clicking its other parts should reach
   * them rather than throwing you back out to the wing each time.
   */
  resolveClick(index: number): ModulePath | null {
    const origin = this.derived.origins[index];
    if (origin === undefined) return null;
    const chain: ModulePath[] = [...instanceChain(origin.path), origin.path];

    let depth = 0;
    for (let i = 0; i < chain.length; i++) {
      const level = chain[i]!;
      const inside = this.selected.some(
        (path) => samePlacement(path, level) || this.under(path, level),
      );
      if (inside) depth = i + 1;
    }
    return chain[depth < chain.length ? depth : chain.length - 1] ?? null;
  }

  /** Whether the selection already accounts for this drawn module. */
  covers(index: number): boolean {
    const path = this.derived.origins[index]?.path;
    if (path === undefined) return false;
    return this.selected.some((each) => this.accountsFor(each, path));
  }

  /** Whether a selected placement is a group rather than a module. */
  private isGroup(path: ModulePath): boolean {
    const placement = placementAt(this.current, path);
    return placement !== null && isInstance(placement);
  }

  /**
   * The drawn modules of each selected group, one list per group.
   *
   * Kept apart from the loose modules because the two are shown differently:
   * a group is one thing and is outlined once, where several modules picked
   * separately are several things and are outlined separately. Reading that
   * off the shape of the selection rather than off a flag means the picture
   * cannot disagree with what an edit would do.
   */
  selectedGroups(): GroupOutline[] {
    const out: GroupOutline[] = [];
    const drawn: string[] = [];
    for (const path of this.selected) {
      if (!this.isGroup(path)) continue;
      const placement = placementAt(this.current, path);
      if (placement === null || !isInstance(placement)) continue;
      if (drawn.includes(placement.use)) continue;
      drawn.push(placement.use);
      out.push(...this.outlinesOf(placement.use, false));
    }
    // A module picked inside a group keeps its group's box, faintly: the thing
    // being edited is one part *of* something, and which something is what
    // decides where a drag of the group's own panel would take it.
    for (const path of this.selected) {
      if (this.isGroup(path)) continue;
      const use = enclosingAssembly(path);
      if (use === null || drawn.includes(use)) continue;
      drawn.push(use);
      out.push(...this.outlinesOf(use, true));
    }
    return out;
  }

  /**
   * One outline per drawn copy of an assembly.
   *
   * Per copy rather than one box over every module the selection accounts for,
   * because a group placed twice is two things in two places and a single box
   * round both would enclose most of the ship. The copy under the pointer is
   * the selection; the rest are drawn as copies, the same distinction the
   * module highlight makes between the one grabbed and the others it moves
   * with.
   */
  private outlinesOf(use: string, context: boolean): GroupOutline[] {
    const byCopy = new Map<string, GroupOutline>();
    for (let i = 0; i < this.derived.origins.length; i++) {
      const path = this.derived.origins[i]!.path;
      for (let k = 0; k < path.length - 1; k++) {
        const step = path[k]!;
        if (step.into !== 'assembly' || step.assembly !== use) continue;
        const key = path
          .slice(0, k + 1)
          .map((each) => `${each.index}.${each.copy}.${each.into ?? ''}`)
          .join('/');
        const found = byCopy.get(key);
        if (found === undefined) byCopy.set(key, { modules: [i], primary: false, context });
        else found.modules.push(i);
        break;
      }
    }
    const outlines = [...byCopy.values()];
    if (!context) {
      const grabbed = outlines.find((outline) => outline.modules.includes(this.grabbed));
      (grabbed ?? outlines[0])!.primary = true;
    }
    return outlines;
  }

  /** The drawn modules of the selected placements that are not groups. */
  selectedLoose(): number[] {
    const out: number[] = [];
    for (const path of this.selected) {
      if (this.isGroup(path)) continue;
      for (const index of this.drawnFor(path)) if (!out.includes(index)) out.push(index);
    }
    const picked = out.indexOf(this.grabbed);
    if (picked > 0) {
      out.splice(picked, 1);
      out.unshift(this.grabbed);
    }
    return out;
  }

  /** Every drawn module a placement accounts for. */
  private drawnFor(path: ModulePath): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.derived.origins.length; i++) {
      if (this.accountsFor(path, this.derived.origins[i]!.path)) out.push(i);
    }
    return out;
  }

  /**
   * Every drawn module the selection accounts for, for the highlight.
   *
   * Distinct from `selectedModules`, which answers only for the placement the
   * panel is editing: a shared part selected once is drawn eight times and all
   * eight are highlighted, so is everything else picked alongside it, and so is
   * every module of a selected group.
   */
  highlightedModules(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.derived.origins.length; i++) {
      const path = this.derived.origins[i]!.path;
      if (this.selected.some((each) => this.accountsFor(each, path))) out.push(i);
    }
    // The copy that was picked comes first, as it does in `selectedModules`,
    // because the overlay draws the first one brightest and that should be the
    // one under the pointer.
    const picked = out.indexOf(this.grabbed);
    if (picked > 0) {
      out.splice(picked, 1);
      out.unshift(this.grabbed);
    }
    return out;
  }

  /** How many drawn modules a placement accounts for, groups included. */
  accountedFor(path: ModulePath): number {
    return this.drawnFor(path).length;
  }

  private set(blueprint: Blueprint): void {
    this.derived = derive(blueprint);
    // A selection that no longer draws anything is gone, not merely stale.
    // Keeping it would leave the properties panel editing a placement the
    // player cannot see. Checked per placement, since an edit can remove one
    // of several picked and leave the rest standing — and through
    // `accountsFor`, so that editing a group's own pose does not dismiss the
    // panel that just made the edit.
    this.selected = this.selected.filter((path) => this.drawnFor(path).length > 0);
  }
}
