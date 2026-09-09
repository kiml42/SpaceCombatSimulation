import { PI } from './math.js';
import { blueprintProblem, type Blueprint } from './blueprint.js';
import type { ModuleKind, ModuleSpec } from './modules.js';

/**
 * The blueprint file format: what a saved ship looks like, and how to get a
 * `Blueprint` back out of one that arrived from somewhere untrustworthy.
 *
 * Parsing lives here, in the simulation, because it is pure — a value in, a
 * value or a complaint out, no file system and no storage. *Loading* is the
 * host's job: reading a file, or `localStorage`, or a paste box. That split is
 * what lets the same parser serve a Node script, the browser editor and a test
 * without any of them knowing about the others.
 *
 * Two things differ deliberately between the file and the simulation:
 *
 * - **Angles are degrees in the file, radians in `sim/`.** A file people
 *   hand-edit should not contain `1.5707963267948966`. The conversion is
 *   `(degrees / 180) * PI` rather than either of the other two orderings,
 *   because it is the one that round-trips exactly most often: `d / 180` is
 *   exact whenever it is a dyadic fraction, which covers every right angle and
 *   every 45°, and multiplying `PI` by an exact power of two is exact too.
 * - **Nothing derived is stored.** Mass, arcs and ballistics are recomputed by
 *   `compileBlueprint` from the geometry, so a file cannot claim a figure its
 *   shape does not support, and an old file automatically benefits from a
 *   corrected scaling law rather than preserving the old one.
 */

/**
 * Format revision of the file itself, bumped when the *shape* changes.
 *
 * Not to be confused with a blueprint's own revision, which a campaign will
 * need so that ships already built keep flying the layout they were built to
 * (ROADMAP.md §12). Different quantities: this one says how to read the file,
 * that one says which design the file describes.
 */
export const BLUEPRINT_FORMAT_VERSION = 1;

const KINDS: readonly ModuleKind[] = ['structure', 'thruster', 'turret'];

/** Keys a module may carry. Anything else is a typo — see `unknownKeys`. */
const MODULE_KEYS: readonly string[] = [
  'kind',
  'x',
  'y',
  'angle',
  'length',
  'width',
  'reinforcement',
  'barrels',
  'notes',
];

const FILE_KEYS: readonly string[] = ['formatVersion', 'name', 'notes', 'modules'];

export function degreesToRadians(degrees: number): number {
  return (degrees / 180) * PI;
}

export function radiansToDegrees(radians: number): number {
  return (radians / PI) * 180;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Keys present that the format does not define.
 *
 * Rejected rather than ignored, because the failure they cause is silent: a
 * file saying `"barrel": 8` parses cleanly into a single-barrelled turret, and
 * nothing downstream has any way to notice that the author meant something
 * else. A complaint naming the key costs one line and saves that.
 */
function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
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

function moduleShapeProblem(value: unknown, where: string): string | null {
  if (!isObject(value)) return `${where} must be an object, got ${JSON.stringify(value)}`;

  const extra = unknownKeys(value, MODULE_KEYS);
  if (extra.length > 0) return `${where} has unknown ${extra.length > 1 ? 'keys' : 'key'} ${extra.join(', ')}`;

  if (typeof value['kind'] !== 'string' || !KINDS.includes(value['kind'] as ModuleKind)) {
    return `${where}: kind must be one of ${KINDS.join(', ')}, got ${JSON.stringify(value['kind'])}`;
  }

  return (
    numberProblem(value['x'], `${where}: x`) ??
    numberProblem(value['y'], `${where}: y`) ??
    numberProblem(value['length'], `${where}: length`) ??
    numberProblem(value['width'], `${where}: width`) ??
    optionalNumberProblem(value['angle'], `${where}: angle`) ??
    optionalNumberProblem(value['reinforcement'], `${where}: reinforcement`) ??
    optionalNumberProblem(value['barrels'], `${where}: barrels`) ??
    optionalStringProblem(value['notes'], `${where}: notes`)
  );
}

/**
 * Everything wrong with a parsed file, or null.
 *
 * Checks the file's *shape* and then hands the assembled blueprint to
 * `blueprintProblem`, so the geometry rules a hand-written layout already has
 * to satisfy apply to a loaded one too — there is one definition of a valid
 * ship, not two that can drift.
 */
export function blueprintFileProblem(value: unknown): string | null {
  if (!isObject(value)) return `a blueprint file must be an object, got ${JSON.stringify(value)}`;

  const extra = unknownKeys(value, FILE_KEYS);
  if (extra.length > 0) return `unknown ${extra.length > 1 ? 'keys' : 'key'} ${extra.join(', ')}`;

  const version = value['formatVersion'];
  if (version !== BLUEPRINT_FORMAT_VERSION) {
    return `formatVersion must be ${BLUEPRINT_FORMAT_VERSION}, got ${JSON.stringify(version)}`;
  }

  const name = value['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    return `name must be a non-empty string, got ${JSON.stringify(name)}`;
  }

  const notesProblem = optionalStringProblem(value['notes'], 'notes');
  if (notesProblem !== null) return notesProblem;

  const modules = value['modules'];
  if (!Array.isArray(modules)) return `modules must be an array, got ${JSON.stringify(modules)}`;

  for (let i = 0; i < modules.length; i++) {
    const problem = moduleShapeProblem(modules[i], `module ${i}`);
    if (problem !== null) return problem;
  }

  return blueprintProblem(toBlueprint(value, modules as Record<string, unknown>[]));
}

/** Assemble a blueprint from a file whose shape has already been checked. */
function toBlueprint(file: Record<string, unknown>, modules: Record<string, unknown>[]): Blueprint {
  const specs: ModuleSpec[] = modules.map((raw) => {
    const spec: ModuleSpec = {
      kind: raw['kind'] as ModuleKind,
      x: raw['x'] as number,
      y: raw['y'] as number,
      length: raw['length'] as number,
      width: raw['width'] as number,
    };
    // Assigned conditionally rather than written as `angle: raw.angle`, because
    // `exactOptionalPropertyTypes` distinguishes an absent optional field from
    // one present and undefined, and the two must round-trip the same way.
    if (raw['angle'] !== undefined) spec.angle = degreesToRadians(raw['angle'] as number);
    if (raw['reinforcement'] !== undefined) spec.reinforcement = raw['reinforcement'] as number;
    if (raw['barrels'] !== undefined) spec.barrels = raw['barrels'] as number;
    if (raw['notes'] !== undefined) spec.notes = raw['notes'] as string;
    return spec;
  });

  const blueprint: Blueprint = { name: file['name'] as string, modules: specs };
  if (file['notes'] !== undefined) blueprint.notes = file['notes'] as string;
  return blueprint;
}

/**
 * A blueprint from a parsed file, or a throw naming what is wrong with it.
 *
 * Throwing rather than returning a union follows `moduleStats`: a caller with
 * a file it believes in should not have to unwrap, and one that does not
 * believe in it should ask `blueprintFileProblem` first.
 */
export function parseBlueprint(value: unknown): Blueprint {
  const problem = blueprintFileProblem(value);
  if (problem !== null) throw new Error(`Invalid blueprint file — ${problem}`);
  const file = value as Record<string, unknown>;
  return toBlueprint(file, file['modules'] as Record<string, unknown>[]);
}

/** What `parseBlueprint` reads: the inverse, for saving and for export. */
export function serialiseBlueprint(blueprint: Blueprint): Record<string, unknown> {
  const file: Record<string, unknown> = {
    formatVersion: BLUEPRINT_FORMAT_VERSION,
    name: blueprint.name,
  };
  if (blueprint.notes !== undefined) file['notes'] = blueprint.notes;

  file['modules'] = blueprint.modules.map((spec) => {
    const raw: Record<string, unknown> = { kind: spec.kind, x: spec.x, y: spec.y };
    if (spec.angle !== undefined) raw['angle'] = radiansToDegrees(spec.angle);
    raw['length'] = spec.length;
    raw['width'] = spec.width;
    if (spec.reinforcement !== undefined) raw['reinforcement'] = spec.reinforcement;
    if (spec.barrels !== undefined) raw['barrels'] = spec.barrels;
    if (spec.notes !== undefined) raw['notes'] = spec.notes;
    return raw;
  });

  return file;
}
