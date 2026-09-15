import {
  blueprintProblems,
  compileDraft,
  expandWithOrigins,
  placementAt,
  samePlacement,
  type Blueprint,
  type ModuleOrigin,
  type ModulePath,
  type ModuleSpec,
  type Placement,
  type ShipDesign,
} from '../sim/index.js';
import { cloneBlueprint } from './edit.js';

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

/** How many steps back an editor can go. */
export const HISTORY_LIMIT = 100;

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
}

function derive(blueprint: Blueprint): Derived {
  const problems = blueprintProblems(blueprint);
  let modules: readonly ModuleSpec[] = [];
  let origins: readonly ModuleOrigin[] = [];
  try {
    const expansion = expandWithOrigins(blueprint);
    modules = expansion.modules;
    origins = expansion.origins;
  } catch {
    // Already reported: an expansion that throws is the first thing
    // `blueprintProblems` complains about.
    return { modules, origins, design: null, underivable: problems[0] ?? null, problems };
  }
  try {
    return { modules, origins, design: compileDraft(blueprint), underivable: null, problems };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { modules, origins, design: null, underivable: why, problems };
  }
}

export class EditorDocument {
  private current: Blueprint;
  private derived: Derived;
  private readonly past: Blueprint[] = [];
  private readonly future: Blueprint[] = [];

  /**
   * The placement being edited, or null. A *placement* and not a drawn module:
   * selecting one of eight copies of a thruster selects the thruster, because
   * that is the thing an edit would change.
   */
  private selected: ModulePath | null = null;

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
    this.current = cloneBlueprint(blueprint);
    this.derived = derive(this.current);
  }

  get blueprint(): Blueprint {
    return this.current;
  }

  get view(): Derived {
    return this.derived;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Make a change, keeping the layout as it was on the undo stack. */
  apply(next: Blueprint): void {
    this.past.push(this.current);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future.length = 0;
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
    this.set(next);
  }

  /** Load a different ship. The history does not follow: it belonged to the old one. */
  replace(blueprint: Blueprint): void {
    this.past.length = 0;
    this.future.length = 0;
    this.selected = null;
    this.set(cloneBlueprint(blueprint));
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (previous === undefined) return false;
    this.future.push(this.current);
    this.set(previous);
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.current);
    this.set(next);
    return true;
  }

  get selection(): ModulePath | null {
    return this.selected;
  }

  /** Select the placement that drew module `index`, or clear the selection. */
  selectModule(index: number): void {
    this.selected = this.derived.origins[index]?.path ?? null;
    this.grabbed = this.selected === null ? 0 : index;
  }

  select(path: ModulePath | null): void {
    this.selected = path;
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
    const path = this.selected;
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
    const path = this.selected;
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

  private set(blueprint: Blueprint): void {
    this.current = blueprint;
    this.derived = derive(blueprint);
    // A selection that no longer draws anything is gone, not merely stale.
    // Keeping it would leave the properties panel editing a placement the
    // player cannot see.
    if (this.selected !== null && this.selectedModules().length === 0) this.selected = null;
  }
}
