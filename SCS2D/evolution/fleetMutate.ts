import {
  blueprintProblem,
  firstOverlap,
  fleetHulls,
  fleetBill,
  affords,
  NO_BUDGET,
  type Budget,
  fleetProblem,
  fleetReach,
  isGroupUse,
  type Blueprint,
  type Fleet,
  type FleetEntry,
  type Rng,
  degreesToRadians,
  radiansToDegrees,
} from '../sim/index.js';
import { max, PI, round } from '../sim/math.js';
import { BARE_CORE } from '../scenarios/blueprints.js';
import { mutate, type MutationLimits } from './mutate.js';

/**
 * An angle that a file, which holds degrees, reads back as exactly itself, so
 * the record of a fleet is the fleet that fought. Most are after one trip.
 */
export function settled(angle: number): number {
  for (let k = 0; k < 4; k++) {
    const back = degreesToRadians(radiansToDegrees(angle));
    if (back === angle) break;
    angle = back;
  }
  return angle;
}

/**
 * Breeding a fleet from a fleet.
 *
 * Every operator has its inverse, so no change is a one-way door: a design is
 * mutated in every copy of it at once; a copy can be forked into a design of
 * its own and two designs merged back into one; a ship or a group can be added
 * and removed; one can be moved or turned; and one can be swapped onto another
 * of the fleet's designs, which a second swap undoes. Only the fleet's own entries are
 * moved, added or removed — what is inside a group changes only through its
 * designs.
 *
 * A fleet may carry designs nothing flies. A ship removed leaves its design
 * behind, and a ship added may be built to any design the fleet carries, or to
 * a bare core, so a fleet can grow by one small ship rather than only by a copy
 * of one it has. Those it does not fly are not mutated, since nothing selects them.
 */

export interface FleetMutationLimits {
  /** How each design is mutated. Its budget is the fleet's, checked on the whole. */
  readonly ship: Partial<MutationLimits>;
  /** What the whole fleet may not cost more than. */
  readonly budget: Budget;
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

export type FleetOperator = 'design' | 'move' | 'add' | 'remove' | 'fork' | 'merge' | 'swap';

/** Mostly the designs, as a ship's own numbers are what it mostly changes; the shape of the fleet less often. */
export const DEFAULT_FLEET_LIMITS: FleetMutationLimits = {
  ship: {},
  budget: NO_BUDGET,
  radius: 500,
  maxShips: 24,
  grid: 5,
  turn: PI / 12,
  attempts: 24,
  operators: { design: 6, move: 3, add: 1, remove: 1, fork: 0.5, merge: 0.5, swap: 0.5 },
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
export function fleetFits(fleet: Fleet, limits: Pick<FleetMutationLimits, 'budget' | 'radius' | 'maxShips'>): boolean {
  if (fleetProblem(fleet) !== null) return false;
  for (const blueprint of Object.values(fleet.designs)) if (blueprintProblem(blueprint) !== null) return false;
  const hulls = fleetHulls(fleet);
  if (hulls.length === 0 || hulls.length > limits.maxShips) return false;
  if (!affords(limits.budget, fleetBill(hulls))) return false;
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
    case 'swap':
      return swap(fleet, rng);
  }
}

/** Mutate one design, which changes every ship built to it. */
function mutateDesign(fleet: Fleet, rng: Rng, bounds: FleetMutationLimits): string[] {
  const names = usedDesigns(fleet);
  if (names.length === 0) return [];
  const name = names[rng.nextInt(names.length)]!;
  const child = mutate(fleet.designs[name]!, rng, { ...bounds.ship, budget: bounds.budget });
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
      entry.angle = settled((entry.angle ?? 0) + steps * bounds.turn);
      return [`${what} turned ${round((steps * bounds.turn * 180) / PI)}°`];
  }
}

/** Another ship or group beside one of the fleet's: anything it carries, or a bare core. */
function add(fleet: Fleet, rng: Rng, bounds: FleetMutationLimits): string[] {
  if (fleet.ships.length === 0) return [];
  const anchor = fleet.ships[rng.nextInt(fleet.ships.length)]!;
  const groups = [...new Set(fleet.ships.filter(isGroupUse).map((entry) => entry.group))];
  const designs = Object.keys(fleet.designs);
  const core = designs.find((name) => sameAsCore(fleet.designs[name]!)) ?? null;
  const choices = designs.length + groups.length + (core === null ? 1 : 0);
  const choice = rng.nextInt(choices);
  // Somewhere near, on the grid; one that lands on a neighbour is refused whole.
  const distance = bounds.grid * (4 + rng.nextInt(12));
  const direction = rng.nextInt(4);
  const x = anchor.x + (direction === 0 ? distance : direction === 1 ? -distance : 0);
  const y = anchor.y + (direction === 2 ? distance : direction === 3 ? -distance : 0);
  let entry: FleetEntry;
  if (choice < designs.length) entry = { design: designs[choice]!, x, y };
  else if (choice < designs.length + groups.length) entry = { group: groups[choice - designs.length]!, x, y };
  else {
    const name = fleet.designs[BARE_CORE.name] === undefined ? BARE_CORE.name : freeName(fleet, BARE_CORE.name);
    fleet.designs[name] = { name, modules: JSON.parse(JSON.stringify(BARE_CORE.modules)) as Blueprint['modules'] };
    entry = { design: name, x, y };
  }
  if (anchor.angle !== undefined) entry.angle = anchor.angle;
  fleet.ships.push(entry);
  return [`${describe(entry)} added, ${distance} m off`];
}

/** Take out one of the fleet's entries. Its design stays, for an `add` to build again. */
function remove(fleet: Fleet, rng: Rng): string[] {
  if (fleet.ships.length <= 1) return [];
  const index = rng.nextInt(fleet.ships.length);
  const [gone] = fleet.ships.splice(index, 1);
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

/**
 * Build one of the fleet's own ships to another of its designs instead: a
 * line can find that one more of its frigates and one fewer of its gunships
 * does better, without the frigate design having to be bred again from the
 * gunship. Its own inverse.
 */
function swap(fleet: Fleet, rng: Rng): string[] {
  const names = usedDesigns(fleet);
  if (names.length < 2) return [];
  const ships = fleet.ships.filter((entry) => !isGroupUse(entry));
  if (ships.length === 0) return [];
  const entry = ships[rng.nextInt(ships.length)]!;
  if (isGroupUse(entry)) return [];
  const others = names.filter((name) => name !== entry.design);
  const from = entry.design;
  entry.design = others[rng.nextInt(others.length)]!;
  return [`a ${from} rebuilt as a ${entry.design}`];
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

function sameAsCore(design: Blueprint): boolean {
  return JSON.stringify(design.modules) === JSON.stringify(BARE_CORE.modules);
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
