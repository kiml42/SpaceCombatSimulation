import {
  blueprintProblem,
  firstOverlap,
  fleetHulls,
  fleetMass,
  fleetProblem,
  fleetReach,
  isGroupUse,
  type Blueprint,
  type Fleet,
  type FleetEntry,
  type Rng,
} from '../sim/index.js';
import { max, PI, round } from '../sim/math.js';
import { mutate, type MutationLimits } from './mutate.js';

/**
 * Breeding a fleet from a fleet.
 *
 * Every operator has its inverse, so no change is a one-way door: a design is
 * mutated in every copy of it at once; a copy can be forked into a design of
 * its own and two designs merged back into one; a ship or a group can be added
 * and removed; and one can be moved or turned. Only the fleet's own entries are
 * moved, added or removed — what is inside a group changes only through its
 * designs.
 */

export interface FleetMutationLimits {
  /** How each design is mutated. Its mass budget is the fleet's, checked on the whole. */
  readonly ship: Partial<MutationLimits>;
  /** Total dry mass the fleet may not exceed, kg. */
  readonly massBudget: number;
  /** How far from its origin any hull may reach, metres. */
  readonly radius: number;
  /** Most ships a fleet may field, which bounds what a match costs. */
  readonly maxShips: number;
  /** What a position moves in, metres. */
  readonly grid: number;
  /** What a heading turns in, radians. */
  readonly turn: number;
  /** Candidates drawn before giving up and returning the parent. */
  readonly attempts: number;
  /** Relative chance of each operator. */
  readonly operators: Readonly<Record<FleetOperator, number>>;
}

export type FleetOperator = 'design' | 'move' | 'add' | 'remove' | 'fork' | 'merge';

/** Mostly the designs, as a ship's own numbers are what it mostly changes; the shape of the fleet less often. */
export const DEFAULT_FLEET_LIMITS: FleetMutationLimits = {
  ship: {},
  massBudget: Infinity,
  radius: 500,
  maxShips: 24,
  grid: 5,
  turn: PI / 12,
  attempts: 24,
  operators: { design: 6, move: 3, add: 1, remove: 1, fork: 0.5, merge: 0.5 },
};

export interface FleetMutant {
  readonly fleet: Fleet;
  /** One sentence per change. Empty means every candidate was refused and the parent is returned. */
  readonly edits: readonly string[];
  readonly attempts: number;
}

export function mutateFleet(parent: Fleet, rng: Rng, limits?: Partial<FleetMutationLimits>): FleetMutant {
  const bounds: FleetMutationLimits = {
    ...DEFAULT_FLEET_LIMITS,
    ...limits,
    operators: { ...DEFAULT_FLEET_LIMITS.operators, ...limits?.operators },
  };
  for (let attempt = 1; attempt <= bounds.attempts; attempt++) {
    const draft = clone(parent);
    const operator = pick(rng, bounds.operators);
    const edits = apply(operator, draft, rng, bounds);
    if (edits.length === 0) continue;
    if (fleetFits(draft, bounds)) return { fleet: draft, edits, attempts: attempt };
  }
  return { fleet: parent, edits: [], attempts: bounds.attempts };
}

/**
 * Whether a candidate is a fleet worth fighting: every design a ship, within
 * the budget and the deployment radius, and no two hulls on top of each other.
 */
export function fleetFits(fleet: Fleet, limits: Pick<FleetMutationLimits, 'massBudget' | 'radius' | 'maxShips'>): boolean {
  if (fleetProblem(fleet) !== null) return false;
  for (const blueprint of Object.values(fleet.designs)) if (blueprintProblem(blueprint) !== null) return false;
  const hulls = fleetHulls(fleet);
  if (hulls.length === 0 || hulls.length > limits.maxShips) return false;
  if (fleetMass(hulls) > limits.massBudget) return false;
  if (fleetReach(hulls) > limits.radius) return false;
  return firstOverlap(hulls) === null;
}

function apply(operator: FleetOperator, fleet: Fleet, rng: Rng, bounds: FleetMutationLimits): string[] {
  switch (operator) {
    case 'design':
      return mutateDesign(fleet, rng, bounds);
    case 'move':
      return move(fleet, rng, bounds);
    case 'add':
      return add(fleet, rng, bounds);
    case 'remove':
      return remove(fleet, rng);
    case 'fork':
      return fork(fleet, rng);
    case 'merge':
      return merge(fleet, rng);
  }
}

/** Mutate one design, which changes every ship built to it. */
function mutateDesign(fleet: Fleet, rng: Rng, bounds: FleetMutationLimits): string[] {
  const names = usedDesigns(fleet);
  if (names.length === 0) return [];
  const name = names[rng.nextInt(names.length)]!;
  const child = mutate(fleet.designs[name]!, rng, { ...bounds.ship, massBudget: bounds.massBudget });
  if (child.edits.length === 0) return [];
  fleet.designs[name] = { ...child.blueprint, name };
  return child.edits.map((edit) => `${name}: ${edit}`);
}

/** Move or turn one of the fleet's own entries. */
function move(fleet: Fleet, rng: Rng, bounds: FleetMutationLimits): string[] {
  if (fleet.ships.length === 0) return [];
  const index = rng.nextInt(fleet.ships.length);
  const entry = fleet.ships[index]!;
  const steps = (1 + rng.nextInt(4)) * (rng.chance(0.5) ? 1 : -1);
  const what = describe(entry);
  switch (rng.nextInt(3)) {
    case 0:
      entry.x += steps * bounds.grid;
      return [`${what} moved ${steps * bounds.grid} m along x`];
    case 1:
      entry.y += steps * bounds.grid;
      return [`${what} moved ${steps * bounds.grid} m along y`];
    default:
      entry.angle = (entry.angle ?? 0) + steps * bounds.turn;
      return [`${what} turned ${round((steps * bounds.turn * 180) / PI)}°`];
  }
}

/** Another copy of one of the fleet's entries, beside it. */
function add(fleet: Fleet, rng: Rng, bounds: FleetMutationLimits): string[] {
  if (fleet.ships.length === 0) return [];
  const source = fleet.ships[rng.nextInt(fleet.ships.length)]!;
  const copy = JSON.parse(JSON.stringify(source)) as FleetEntry;
  // Somewhere near, on the grid; one that lands on a neighbour is refused whole.
  const distance = bounds.grid * (4 + rng.nextInt(12));
  const direction = rng.nextInt(4);
  copy.x += direction === 0 ? distance : direction === 1 ? -distance : 0;
  copy.y += direction === 2 ? distance : direction === 3 ? -distance : 0;
  fleet.ships.push(copy);
  return [`${describe(source)} copied, ${distance} m off`];
}

/** Take out one of the fleet's entries, and any design nothing flies any more. */
function remove(fleet: Fleet, rng: Rng): string[] {
  if (fleet.ships.length <= 1) return [];
  const index = rng.nextInt(fleet.ships.length);
  const [gone] = fleet.ships.splice(index, 1);
  prune(fleet);
  return [`${describe(gone!)} removed`];
}

/** Give one ship a design of its own, a copy of the one it shared. The inverse of `merge`. */
function fork(fleet: Fleet, rng: Rng): string[] {
  const shared = fleet.ships
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !isGroupUse(entry) && uses(fleet, entry.design) > 1);
  if (shared.length === 0) return [];
  const { entry } = shared[rng.nextInt(shared.length)]!;
  if (isGroupUse(entry)) return [];
  const from = entry.design;
  const name = freeName(fleet, from);
  fleet.designs[name] = { ...(JSON.parse(JSON.stringify(fleet.designs[from])) as Blueprint), name };
  entry.design = name;
  return [`a ${from} forked into ${name}`];
}

/** Build every ship of one design to another instead. The inverse of `fork`. */
function merge(fleet: Fleet, rng: Rng): string[] {
  const names = usedDesigns(fleet);
  if (names.length < 2) return [];
  const gone = names.splice(rng.nextInt(names.length), 1)[0]!;
  const into = names[rng.nextInt(names.length)]!;
  const repoint = (entries: FleetEntry[]): void => {
    for (const entry of entries) if (!isGroupUse(entry) && entry.design === gone) entry.design = into;
  };
  repoint(fleet.ships);
  for (const group of Object.values(fleet.groups ?? {})) repoint(group.ships);
  delete fleet.designs[gone];
  return [`${gone} merged into ${into}`];
}

function describe(entry: FleetEntry): string {
  return isGroupUse(entry) ? `group ${entry.group}` : `a ${entry.design}`;
}

/** Designs some entry flies, in the order the fleet lists them. */
function usedDesigns(fleet: Fleet): string[] {
  return Object.keys(fleet.designs).filter((name) => uses(fleet, name) > 0);
}

/** How many entries name a design, directly or in a group. */
function uses(fleet: Fleet, name: string): number {
  let count = 0;
  const visit = (entries: readonly FleetEntry[]): void => {
    for (const entry of entries) if (!isGroupUse(entry) && entry.design === name) count += entry.repeat ?? 1;
  };
  visit(fleet.ships);
  for (const group of Object.values(fleet.groups ?? {})) visit(group.ships);
  return count;
}

function prune(fleet: Fleet): void {
  for (const name of Object.keys(fleet.designs)) if (uses(fleet, name) === 0) delete fleet.designs[name];
}

/** `name 2`, `name 3`, … — the first the fleet does not already carry. */
function freeName(fleet: Fleet, name: string): string {
  const stem = name.replace(/ \d+$/, '');
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}`;
    if (fleet.designs[candidate] === undefined) return candidate;
  }
}

function pick(rng: Rng, weights: Readonly<Record<FleetOperator, number>>): FleetOperator {
  const entries = Object.entries(weights) as [FleetOperator, number][];
  let total = 0;
  for (const [, weight] of entries) total += max(0, weight);
  let draw = rng.nextFloat() * total;
  for (const [operator, weight] of entries) {
    draw -= max(0, weight);
    if (draw < 0) return operator;
  }
  return 'design';
}

function clone(fleet: Fleet): Fleet {
  return JSON.parse(JSON.stringify(fleet)) as Fleet;
}
