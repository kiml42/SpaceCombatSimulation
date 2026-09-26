import {
  blueprintProblem,
  compileDraft,
  expandBlueprint,
  expandFleet,
  fleetProblem,
  math,
  modulesOverlap,
  type Blueprint,
  type Fleet,
  type ModuleSpec,
  type PlacedShip,
  type ShipDesign,
} from '../sim/index.js';
import { cloneFleet, differs } from './fleetEdit.js';
import { History } from './history.js';
import { moduleAt } from './edit.js';

/**
 * The fleet being worked on, what it works out to, and the way back — the
 * fleet editor's `EditorDocument`, and like it free of any canvas or panel.
 */

const { cos, sin, sqrt } = math;

export interface DesignLine {
  name: string;
  count: number;
  /** Of one ship, kg. */
  mass: number;
}

export interface FleetView {
  /** Every ship the fleet puts on the field, groups flattened. */
  ships: readonly PlacedShip[];
  /** Compiled, per ship; null where its design will not compile. */
  designs: readonly (ShipDesign | null)[];
  /** Each ship's modules in the fleet's frame, for hit tests and overlap. */
  hulls: readonly (readonly ModuleSpec[])[];
  /** Everything wrong, listed rather than enforced. */
  problems: readonly string[];
  /** Ships some problem names. */
  faulty: readonly number[];
  /** Designs whose embedded copy differs from the library's of the same name. */
  stale: readonly string[];
  mass: number;
  lines: readonly DesignLine[];
}

/** The library copy of a design, or null. What an out-of-sync warning compares with. */
export type LibraryLookup = (name: string) => Blueprint | null;

function derive(fleet: Fleet, lookup: LibraryLookup): FleetView {
  const problems: string[] = [];
  const faulty = new Set<number>();

  const expansionProblem = fleetProblem(fleet);
  if (expansionProblem !== null) {
    return { ships: [], designs: [], hulls: [], problems: [expansionProblem], faulty: [], stale: [], mass: 0, lines: [] };
  }
  const ships = expandFleet(fleet);

  const compiled = new Map<string, { design: ShipDesign | null; modules: ModuleSpec[] }>();
  const stale: string[] = [];
  for (const [name, blueprint] of Object.entries(fleet.designs)) {
    const problem = blueprintProblem(blueprint);
    if (problem !== null) problems.push(`${name} would not fly: ${problem}`);
    let design: ShipDesign | null = null;
    let modules: ModuleSpec[] = [];
    try {
      modules = expandBlueprint(blueprint);
      design = compileDraft(blueprint);
    } catch {
      // Named by `blueprintProblem` above.
    }
    compiled.set(name, { design, modules });
    const library = lookup(name);
    if (library !== null && differs(blueprint, library)) stale.push(name);
  }

  const designs = ships.map((ship) => compiled.get(ship.design)?.design ?? null);
  const hulls = ships.map((ship) => placeModules(compiled.get(ship.design)?.modules ?? [], ship));
  ships.forEach((ship, i) => {
    if (designs[i] === null) faulty.add(i);
    else if (blueprintProblem(fleet.designs[ship.design]!) !== null) faulty.add(i);
  });

  for (let i = 0; i < ships.length; i++) {
    for (let k = i + 1; k < ships.length; k++) {
      if (!hullsOverlap(ships[i]!, designs[i]!, hulls[i]!, ships[k]!, designs[k]!, hulls[k]!)) continue;
      problems.push(`${ships[i]!.path} and ${ships[k]!.path} overlap at the start`);
      faulty.add(i);
      faulty.add(k);
    }
  }
  for (const name of stale) problems.push(`${name} differs from the library's ${name}`);

  const lines: DesignLine[] = [];
  let mass = 0;
  ships.forEach((ship, i) => {
    const each = designs[i]?.mass ?? 0;
    mass += each;
    const line = lines.find((l) => l.name === ship.design);
    if (line === undefined) lines.push({ name: ship.design, count: 1, mass: each });
    else line.count++;
  });

  return {
    ships,
    designs,
    hulls,
    problems,
    faulty: [...faulty].sort((a, b) => a - b),
    stale,
    mass,
    lines,
  };
}

/** A design's modules, turned and moved to where this ship stands. */
function placeModules(modules: readonly ModuleSpec[], ship: PlacedShip): ModuleSpec[] {
  const c = cos(ship.angle);
  const s = sin(ship.angle);
  return modules.map((m) => ({
    ...m,
    x: ship.x + m.x * c - m.y * s,
    y: ship.y + m.x * s + m.y * c,
    angle: (m.angle ?? 0) + ship.angle,
  }));
}

/** Where a ship's centre of mass stands in the fleet's frame. */
export function centreOf(ship: PlacedShip, design: ShipDesign): { x: number; y: number } {
  const c = cos(ship.angle);
  const s = sin(ship.angle);
  return {
    x: ship.x + design.centreOfMassX * c - design.centreOfMassY * s,
    y: ship.y + design.centreOfMassX * s + design.centreOfMassY * c,
  };
}

function hullsOverlap(
  a: PlacedShip,
  da: ShipDesign | null,
  ha: readonly ModuleSpec[],
  b: PlacedShip,
  db: ShipDesign | null,
  hb: readonly ModuleSpec[],
): boolean {
  if (da === null || db === null) return false;
  const ca = centreOf(a, da);
  const cb = centreOf(b, db);
  const dx = ca.x - cb.x;
  const dy = ca.y - cb.y;
  if (sqrt(dx * dx + dy * dy) >= da.radius + db.radius) return false;
  for (const ma of ha) for (const mb of hb) if (modulesOverlap(ma, mb)) return true;
  return false;
}

export class FleetDocument {
  private readonly history: History<Fleet>;
  private derived: FleetView;
  /** Picked entries of the fleet's own `ships`, first picked first. */
  private selected: number[] = [];

  constructor(
    fleet: Fleet,
    private readonly lookup: LibraryLookup,
  ) {
    this.history = new History(cloneFleet(fleet));
    this.derived = derive(this.history.current, lookup);
  }

  get fleet(): Fleet {
    return this.history.current;
  }

  get view(): FleetView {
    return this.derived;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  get selection(): readonly number[] {
    return this.selected;
  }

  apply(next: Fleet): void {
    this.history.apply(next);
    this.set();
  }

  amend(next: Fleet): void {
    this.history.amend(next);
    this.set();
  }

  replace(fleet: Fleet): void {
    this.history.replace(cloneFleet(fleet));
    this.selected = [];
    this.set();
  }

  undo(): boolean {
    if (!this.history.undo()) return false;
    this.set();
    return true;
  }

  redo(): boolean {
    if (!this.history.redo()) return false;
    this.set();
    return true;
  }

  /** Recompute, e.g. after the library changed under an out-of-sync check. */
  refresh(): void {
    this.set();
  }

  select(entries: readonly number[]): void {
    this.selected = [...entries];
  }

  toggle(entry: number): void {
    const at = this.selected.indexOf(entry);
    if (at >= 0) this.selected.splice(at, 1);
    else this.selected.push(entry);
  }

  /**
   * The entry a point on the field would pick, or -1: a hull under it, else
   * the nearest ship within `slop` metres, so a fighter too small to see can
   * still be clicked.
   */
  entryAt(x: number, y: number, slop = 0): number {
    const { ships, hulls, designs } = this.derived;
    for (let i = ships.length - 1; i >= 0; i--) {
      if (moduleAt(hulls[i]!, x, y) >= 0) return ships[i]!.entry;
    }
    let best = -1;
    let bestDistance = slop;
    ships.forEach((ship, i) => {
      const design = designs[i];
      if (design == null) return;
      const centre = centreOf(ship, design);
      const distance = sqrt((centre.x - x) ** 2 + (centre.y - y) ** 2);
      if (distance <= bestDistance) {
        best = ship.entry;
        bestDistance = distance;
      }
    });
    return best;
  }

  /** The flattened ships an entry puts on the field. */
  shipsOf(entry: number): number[] {
    const out: number[] = [];
    this.derived.ships.forEach((ship, i) => {
      if (ship.entry === entry) out.push(i);
    });
    return out;
  }

  /** How far an entry's ships reach from its origin, metres. */
  reachOf(entry: number): number {
    const origin = this.fleet.ships[entry];
    if (origin === undefined) return 0;
    let reach = 0;
    for (const i of this.shipsOf(entry)) {
      const design = this.derived.designs[i];
      if (design == null) continue;
      const centre = centreOf(this.derived.ships[i]!, design);
      const dx = centre.x - origin.x;
      const dy = centre.y - origin.y;
      reach = Math.max(reach, sqrt(dx * dx + dy * dy) + design.radius);
    }
    return reach;
  }

  private set(): void {
    this.derived = derive(this.history.current, this.lookup);
    const count = this.history.current.ships.length;
    this.selected = this.selected.filter((i) => i < count);
  }
}
