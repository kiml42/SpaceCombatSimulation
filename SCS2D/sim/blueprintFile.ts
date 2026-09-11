import { PI } from './math.js';
import {
  blueprintProblem,
  isInstance,
  type Assembly,
  type AssemblyInstance,
  type AssemblyStep,
  type Blueprint,
  type Placement,
} from './blueprint.js';
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

const KINDS: readonly ModuleKind[] = ['structure', 'thruster', 'turret', 'laserTurret'];

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

/** Keys an assembly instance may carry: where it goes, and nothing else. */
const INSTANCE_KEYS: readonly string[] = [
  'use',
  'x',
  'y',
  'angle',
  'mirror',
  'repeat',
  'step',
  'extra',
  'notes',
];

const STEP_KEYS: readonly string[] = ['x', 'y', 'angle'];

const ASSEMBLY_KEYS: readonly string[] = ['modules', 'notes'];

const FILE_KEYS: readonly string[] = ['formatVersion', 'name', 'notes', 'assemblies', 'modules'];

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

function moduleShapeProblem(value: Record<string, unknown>, where: string): string | null {
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

function instanceShapeProblem(value: Record<string, unknown>, where: string): string | null {
  const extra = unknownKeys(value, INSTANCE_KEYS);
  if (extra.length > 0) return `${where} has unknown ${extra.length > 1 ? 'keys' : 'key'} ${extra.join(', ')}`;

  if (typeof value['use'] !== 'string' || value['use'] === '') {
    return `${where}: use must be the name of an assembly, got ${JSON.stringify(value['use'])}`;
  }
  const mirror = value['mirror'];
  if (mirror !== undefined && typeof mirror !== 'boolean') {
    return `${where}: mirror must be true or false, got ${JSON.stringify(mirror)}`;
  }
  if (value['extra'] !== undefined) {
    const problem = placementsShapeProblem(value['extra'], `${where}: extra`);
    if (problem !== null) return problem;
  }
  const step = value['step'];
  if (step !== undefined) {
    if (!isObject(step)) return `${where}: step must be an object, got ${JSON.stringify(step)}`;
    const extraKeys = unknownKeys(step, STEP_KEYS);
    if (extraKeys.length > 0) {
      return `${where}: step has unknown ${extraKeys.length > 1 ? 'keys' : 'key'} ${extraKeys.join(', ')}`;
    }
    const problem =
      numberProblem(step['x'], `${where}: step x`) ??
      numberProblem(step['y'], `${where}: step y`) ??
      optionalNumberProblem(step['angle'], `${where}: step angle`);
    if (problem !== null) return problem;
  }

  return (
    numberProblem(value['x'], `${where}: x`) ??
    numberProblem(value['y'], `${where}: y`) ??
    optionalNumberProblem(value['angle'], `${where}: angle`) ??
    optionalNumberProblem(value['repeat'], `${where}: repeat`) ??
    optionalStringProblem(value['notes'], `${where}: notes`)
  );
}

/**
 * A placement is a module or a copy of an assembly, told apart by `use`.
 *
 * Discriminated on the key rather than on a `type` field, because the file
 * then stays the plain list of modules it was for every layout that does not
 * use assemblies, and reads as one thing per line either way.
 */
function placementShapeProblem(value: unknown, where: string): string | null {
  if (!isObject(value)) return `${where} must be an object, got ${JSON.stringify(value)}`;
  return 'use' in value
    ? instanceShapeProblem(value, where)
    : moduleShapeProblem(value, where);
}

function placementsShapeProblem(value: unknown, where: string): string | null {
  if (!Array.isArray(value)) return `${where} must be an array, got ${JSON.stringify(value)}`;
  for (let i = 0; i < value.length; i++) {
    const problem = placementShapeProblem(value[i], `${where}[${i}]`);
    if (problem !== null) return problem;
  }
  return null;
}

function assembliesShapeProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return `assemblies must be an object, got ${JSON.stringify(value)}`;

  for (const [name, assembly] of Object.entries(value)) {
    if (!isObject(assembly)) return `assembly ${name} must be an object`;
    const extra = unknownKeys(assembly, ASSEMBLY_KEYS);
    if (extra.length > 0) {
      return `assembly ${name} has unknown ${extra.length > 1 ? 'keys' : 'key'} ${extra.join(', ')}`;
    }
    const notes = optionalStringProblem(assembly['notes'], `assembly ${name}: notes`);
    if (notes !== null) return notes;
    const modules = placementsShapeProblem(assembly['modules'], `assembly ${name}: modules`);
    if (modules !== null) return modules;
  }
  return null;
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

  const assemblies = assembliesShapeProblem(value['assemblies']);
  if (assemblies !== null) return assemblies;

  const modules = placementsShapeProblem(value['modules'], 'modules');
  if (modules !== null) return modules;

  return blueprintProblem(toBlueprint(value));
}

/** Assemble a blueprint from a file whose shape has already been checked. */
function toBlueprint(file: Record<string, unknown>): Blueprint {
  const blueprint: Blueprint = {
    name: file['name'] as string,
    modules: toPlacements(file['modules'] as unknown[]),
  };
  if (file['notes'] !== undefined) blueprint.notes = file['notes'] as string;

  const rawAssemblies = file['assemblies'] as Record<string, Record<string, unknown>> | undefined;
  if (rawAssemblies !== undefined) {
    const assemblies: Record<string, Assembly> = {};
    for (const [name, raw] of Object.entries(rawAssemblies)) {
      const assembly: Assembly = { modules: toPlacements(raw['modules'] as unknown[]) };
      if (raw['notes'] !== undefined) assembly.notes = raw['notes'] as string;
      assemblies[name] = assembly;
    }
    blueprint.assemblies = assemblies;
  }

  return blueprint;
}

function toPlacements(raws: unknown[]): Placement[] {
  return raws.map((value) => {
    const raw = value as Record<string, unknown>;
    // Assigned conditionally rather than written as `angle: raw.angle`,
    // because `exactOptionalPropertyTypes` distinguishes an absent optional
    // field from one present and undefined, and the two must round-trip the
    // same way.
    if ('use' in raw) {
      const instance: AssemblyInstance = {
        use: raw['use'] as string,
        x: raw['x'] as number,
        y: raw['y'] as number,
      };
      if (raw['angle'] !== undefined) instance.angle = degreesToRadians(raw['angle'] as number);
      if (raw['mirror'] !== undefined) instance.mirror = raw['mirror'] as boolean;
      if (raw['repeat'] !== undefined) instance.repeat = raw['repeat'] as number;
      if (raw['step'] !== undefined) {
        const rawStep = raw['step'] as Record<string, unknown>;
        const step: AssemblyStep = { x: rawStep['x'] as number, y: rawStep['y'] as number };
        if (rawStep['angle'] !== undefined) step.angle = degreesToRadians(rawStep['angle'] as number);
        instance.step = step;
      }
      if (raw['extra'] !== undefined) instance.extra = toPlacements(raw['extra'] as unknown[]);
      if (raw['notes'] !== undefined) instance.notes = raw['notes'] as string;
      return instance;
    }

    const spec: ModuleSpec = {
      kind: raw['kind'] as ModuleKind,
      x: raw['x'] as number,
      y: raw['y'] as number,
      length: raw['length'] as number,
      width: raw['width'] as number,
    };
    if (raw['angle'] !== undefined) spec.angle = degreesToRadians(raw['angle'] as number);
    if (raw['reinforcement'] !== undefined) spec.reinforcement = raw['reinforcement'] as number;
    if (raw['barrels'] !== undefined) spec.barrels = raw['barrels'] as number;
    if (raw['notes'] !== undefined) spec.notes = raw['notes'] as string;
    return spec;
  });
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
  return toBlueprint(value as Record<string, unknown>);
}

/** What `parseBlueprint` reads: the inverse, for saving and for export. */
export function serialiseBlueprint(blueprint: Blueprint): Record<string, unknown> {
  const file: Record<string, unknown> = {
    formatVersion: BLUEPRINT_FORMAT_VERSION,
    name: blueprint.name,
  };
  if (blueprint.notes !== undefined) file['notes'] = blueprint.notes;

  if (blueprint.assemblies !== undefined) {
    const assemblies: Record<string, unknown> = {};
    for (const [name, assembly] of Object.entries(blueprint.assemblies)) {
      const raw: Record<string, unknown> = {};
      if (assembly.notes !== undefined) raw['notes'] = assembly.notes;
      raw['modules'] = assembly.modules.map(serialisePlacement);
      assemblies[name] = raw;
    }
    file['assemblies'] = assemblies;
  }

  file['modules'] = blueprint.modules.map(serialisePlacement);

  return file;
}

function serialisePlacement(placement: Placement): Record<string, unknown> {
  if (isInstance(placement)) {
    const raw: Record<string, unknown> = { use: placement.use, x: placement.x, y: placement.y };
    if (placement.angle !== undefined) raw['angle'] = radiansToDegrees(placement.angle);
    if (placement.mirror !== undefined) raw['mirror'] = placement.mirror;
    if (placement.repeat !== undefined) raw['repeat'] = placement.repeat;
    if (placement.step !== undefined) {
      const step: Record<string, unknown> = { x: placement.step.x, y: placement.step.y };
      if (placement.step.angle !== undefined) step['angle'] = radiansToDegrees(placement.step.angle);
      raw['step'] = step;
    }
    if (placement.extra !== undefined) raw['extra'] = placement.extra.map(serialisePlacement);
    if (placement.notes !== undefined) raw['notes'] = placement.notes;
    return raw;
  }

  const raw: Record<string, unknown> = { kind: placement.kind, x: placement.x, y: placement.y };
  if (placement.angle !== undefined) raw['angle'] = radiansToDegrees(placement.angle);
  raw['length'] = placement.length;
  raw['width'] = placement.width;
  if (placement.reinforcement !== undefined) raw['reinforcement'] = placement.reinforcement;
  if (placement.barrels !== undefined) raw['barrels'] = placement.barrels;
  if (placement.notes !== undefined) raw['notes'] = placement.notes;
  return raw;
}
