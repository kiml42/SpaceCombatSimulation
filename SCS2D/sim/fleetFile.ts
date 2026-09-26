import {
  blueprintFileProblem,
  degreesToRadians,
  parseBlueprint,
  radiansToDegrees,
  serialiseBlueprint,
} from './blueprintFile.js';
import type { Blueprint } from './blueprint.js';
import {
  fleetProblem,
  isGroupUse,
  type Fleet,
  type FleetEntry,
  type FleetGroup,
  type FleetGroupUse,
  type FleetShip,
  type FleetStep,
} from './fleet.js';

/**
 * The fleet file format, modelled on the blueprint one: parse checks the
 * shape and throws, serialise is its inverse, degrees in the file and radians
 * in the sim. Each design is a whole blueprint file, so one can be copied out
 * into the library, or in from it, unchanged.
 */
export const FLEET_FORMAT_VERSION = 1;

const FILE_KEYS: readonly string[] = ['formatVersion', 'name', 'notes', 'designs', 'groups', 'ships'];
const SHIP_KEYS: readonly string[] = ['design', 'x', 'y', 'angle', 'repeat', 'step', 'notes'];
const USE_KEYS: readonly string[] = ['group', 'x', 'y', 'angle', 'mirror', 'repeat', 'step', 'notes'];
const STEP_KEYS: readonly string[] = ['x', 'y', 'angle'];
const GROUP_KEYS: readonly string[] = ['ships', 'notes'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownKeysProblem(value: Record<string, unknown>, allowed: readonly string[], where: string): string | null {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length === 0) return null;
  return `${where} has unknown ${extra.length > 1 ? 'keys' : 'key'} ${extra.join(', ')}`;
}

function numberProblem(value: unknown, what: string): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${what} must be a finite number, got ${JSON.stringify(value)}`;
  }
  return null;
}

function optionalNumberProblem(value: unknown, what: string): string | null {
  return value === undefined ? null : numberProblem(value, what);
}

function optionalStringProblem(value: unknown, what: string): string | null {
  if (value !== undefined && typeof value !== 'string') {
    return `${what} must be a string, got ${JSON.stringify(value)}`;
  }
  return null;
}

function nameProblem(value: unknown, what: string): string | null {
  if (typeof value !== 'string' || value === '') {
    return `${what} must be a name, got ${JSON.stringify(value)}`;
  }
  return null;
}

/** A ship or a group, told apart by which key names it, as blueprints use `use`. */
function entryProblem(value: unknown, where: string): string | null {
  if (!isObject(value)) return `${where} must be an object, got ${JSON.stringify(value)}`;
  const isUse = 'group' in value;
  if (isUse && 'design' in value) return `${where} names both a design and a group`;

  const shape = isUse
    ? unknownKeysProblem(value, USE_KEYS, where) ?? nameProblem(value['group'], `${where}: group`)
    : unknownKeysProblem(value, SHIP_KEYS, where) ?? nameProblem(value['design'], `${where}: design`);
  if (shape !== null) return shape;

  if (isUse && value['mirror'] !== undefined && typeof value['mirror'] !== 'boolean') {
    return `${where}: mirror must be true or false, got ${JSON.stringify(value['mirror'])}`;
  }
  const repeat = value['repeat'];
  if (repeat !== undefined && (typeof repeat !== 'number' || !Number.isInteger(repeat) || repeat < 1)) {
    return `${where}: repeat must be a whole number of at least 1, got ${JSON.stringify(repeat)}`;
  }
  const step = value['step'];
  if (step !== undefined) {
    if (!isObject(step)) return `${where}: step must be an object, got ${JSON.stringify(step)}`;
    const problem =
      unknownKeysProblem(step, STEP_KEYS, `${where}: step`) ??
      numberProblem(step['x'], `${where}: step x`) ??
      numberProblem(step['y'], `${where}: step y`) ??
      optionalNumberProblem(step['angle'], `${where}: step angle`);
    if (problem !== null) return problem;
  }
  return (
    numberProblem(value['x'], `${where}: x`) ??
    numberProblem(value['y'], `${where}: y`) ??
    optionalNumberProblem(value['angle'], `${where}: angle`) ??
    optionalStringProblem(value['notes'], `${where}: notes`)
  );
}

function entriesProblem(value: unknown, where: string): string | null {
  if (!Array.isArray(value)) return `${where} must be an array, got ${JSON.stringify(value)}`;
  for (let i = 0; i < value.length; i++) {
    const problem = entryProblem(value[i], `${where}[${i}]`);
    if (problem !== null) return problem;
  }
  return null;
}

function designsProblem(value: unknown): string | null {
  if (!isObject(value)) return `designs must be an object, got ${JSON.stringify(value)}`;
  for (const [name, design] of Object.entries(value)) {
    const problem = blueprintFileProblem(design);
    if (problem !== null) return `design ${name}: ${problem}`;
    // One name, not two that can disagree.
    const own = (design as Record<string, unknown>)['name'];
    if (own !== name) return `design ${name} is named ${JSON.stringify(own)} inside`;
  }
  return null;
}

function groupsProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return `groups must be an object, got ${JSON.stringify(value)}`;
  for (const [name, group] of Object.entries(value)) {
    if (!isObject(group)) return `group ${name} must be an object`;
    const problem =
      unknownKeysProblem(group, GROUP_KEYS, `group ${name}`) ??
      optionalStringProblem(group['notes'], `group ${name}: notes`) ??
      entriesProblem(group['ships'], `group ${name}: ships`);
    if (problem !== null) return problem;
  }
  return null;
}

/**
 * What makes a fleet file unreadable, or null.
 *
 * Unlike a blueprint, references are checked here too: a ship naming a design
 * the file does not carry, or a group containing itself, has no fleet to open.
 * Whether each design could fly is `blueprintProblem`'s question, left to the
 * editor to list.
 */
export function fleetFileProblem(value: unknown): string | null {
  if (!isObject(value)) return `a fleet file must be an object, got ${JSON.stringify(value)}`;

  const keys = unknownKeysProblem(value, FILE_KEYS, 'the file');
  if (keys !== null) return keys;

  if (value['formatVersion'] !== FLEET_FORMAT_VERSION) {
    return `formatVersion must be ${FLEET_FORMAT_VERSION}, got ${JSON.stringify(value['formatVersion'])}`;
  }
  const name = value['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    return `name must be a non-empty string, got ${JSON.stringify(name)}`;
  }

  const shape =
    optionalStringProblem(value['notes'], 'notes') ??
    designsProblem(value['designs']) ??
    groupsProblem(value['groups']) ??
    entriesProblem(value['ships'], 'ships');
  if (shape !== null) return shape;

  return fleetProblem(toFleet(value));
}

function toFleet(file: Record<string, unknown>): Fleet {
  const designs: Record<string, Blueprint> = {};
  for (const [name, design] of Object.entries(file['designs'] as Record<string, unknown>)) {
    designs[name] = parseBlueprint(design);
  }
  const fleet: Fleet = { name: file['name'] as string, designs, ships: toEntries(file['ships'] as unknown[]) };
  if (file['notes'] !== undefined) fleet.notes = file['notes'] as string;

  const rawGroups = file['groups'] as Record<string, Record<string, unknown>> | undefined;
  if (rawGroups !== undefined) {
    const groups: Record<string, FleetGroup> = {};
    for (const [name, raw] of Object.entries(rawGroups)) {
      const group: FleetGroup = { ships: toEntries(raw['ships'] as unknown[]) };
      if (raw['notes'] !== undefined) group.notes = raw['notes'] as string;
      groups[name] = group;
    }
    fleet.groups = groups;
  }
  return fleet;
}

function toEntries(raws: unknown[]): FleetEntry[] {
  return raws.map((value) => {
    const raw = value as Record<string, unknown>;
    let entry: FleetShip | FleetGroupUse;
    if ('group' in raw) {
      const use: FleetGroupUse = { group: raw['group'] as string, x: raw['x'] as number, y: raw['y'] as number };
      if (raw['mirror'] !== undefined) use.mirror = raw['mirror'] as boolean;
      entry = use;
    } else {
      entry = { design: raw['design'] as string, x: raw['x'] as number, y: raw['y'] as number };
    }
    if (raw['angle'] !== undefined) entry.angle = degreesToRadians(raw['angle'] as number);
    if (raw['repeat'] !== undefined) entry.repeat = raw['repeat'] as number;
    if (raw['step'] !== undefined) {
      const rawStep = raw['step'] as Record<string, unknown>;
      const step: FleetStep = { x: rawStep['x'] as number, y: rawStep['y'] as number };
      if (rawStep['angle'] !== undefined) step.angle = degreesToRadians(rawStep['angle'] as number);
      entry.step = step;
    }
    if (raw['notes'] !== undefined) entry.notes = raw['notes'] as string;
    return entry;
  });
}

/** A fleet from a parsed file, or a throw naming what makes it unreadable. */
export function parseFleet(value: unknown): Fleet {
  const problem = fleetFileProblem(value);
  if (problem !== null) throw new Error(`Invalid fleet file — ${problem}`);
  return toFleet(value as Record<string, unknown>);
}

/** What `parseFleet` reads. */
export function serialiseFleet(fleet: Fleet): Record<string, unknown> {
  const file: Record<string, unknown> = { formatVersion: FLEET_FORMAT_VERSION, name: fleet.name };
  if (fleet.notes !== undefined) file['notes'] = fleet.notes;

  const designs: Record<string, unknown> = {};
  for (const [name, design] of Object.entries(fleet.designs)) designs[name] = serialiseBlueprint(design);
  file['designs'] = designs;

  if (fleet.groups !== undefined) {
    const groups: Record<string, unknown> = {};
    for (const [name, group] of Object.entries(fleet.groups)) {
      const raw: Record<string, unknown> = {};
      if (group.notes !== undefined) raw['notes'] = group.notes;
      raw['ships'] = group.ships.map(serialiseEntry);
      groups[name] = raw;
    }
    file['groups'] = groups;
  }

  file['ships'] = fleet.ships.map(serialiseEntry);
  return file;
}

function serialiseEntry(entry: FleetEntry): Record<string, unknown> {
  const raw: Record<string, unknown> = isGroupUse(entry) ? { group: entry.group } : { design: entry.design };
  raw['x'] = entry.x;
  raw['y'] = entry.y;
  if (entry.angle !== undefined) raw['angle'] = radiansToDegrees(entry.angle);
  if (isGroupUse(entry) && entry.mirror !== undefined) raw['mirror'] = entry.mirror;
  if (entry.repeat !== undefined) raw['repeat'] = entry.repeat;
  if (entry.step !== undefined) {
    const step: Record<string, unknown> = { x: entry.step.x, y: entry.step.y };
    if (entry.step.angle !== undefined) step['angle'] = radiansToDegrees(entry.step.angle);
    raw['step'] = step;
  }
  if (entry.notes !== undefined) raw['notes'] = entry.notes;
  return raw;
}
