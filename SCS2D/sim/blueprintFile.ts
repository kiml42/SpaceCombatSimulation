import { PI, round } from './math.js';
import {
  isInstance,
  type Assembly,
  type AssemblyInstance,
  type AssemblyStep,
  type Blueprint,
  type Placement,
} from './blueprint.js';
import {
  BARREL_OUTER_CALIBRES,
  countsOutlets,
  hullMountGeometry,
  isHullMount,
  isWeaponMount,
  MODULE_KINDS,
  readsBarrelCalibres,
  readsNozzle,
  readsSealing,
  readsDrainPriority,
  readsFill,
  readsDocked,
  readsThick,
  readsFuse,
  readsWeapon,
  readsMain,
  type ModuleKind,
  type ModuleSpec,
  shapeModule,
} from './modules.js';
import { canShape, TRIANGLE_CORNERS } from './shape.js';
import {
  doctrineProblem,
  doctrineUnread,
  serialiseDoctrine,
  targetingProblem,
  TARGETING_FIELDS,
  toDoctrine,
  type Targeting,
} from './doctrine.js';
import { unreadOf, unreadWarning, writeUnread, type UnreadKeys } from './unread.js';

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



/** Keys a module may carry. Anything else is kept but unread — see `UnreadKeys`. */
const MODULE_KEYS: readonly string[] = [
  'kind',
  'x',
  'y',
  'angle',
  'length',
  'width',
  'vertices',
  'reinforcement',
  'barrels',
  'nozzle',
  'barrelCalibres',
  'traverse',
  'fuse',
  'fragments',
  'burstSpeed',
  'weapon',
  'main',
  'thick',
  'sealing',
  'drainPriority',
  'fill',
  'docked',
  'targeting',
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
  'notes',
];

const STEP_KEYS: readonly string[] = ['x', 'y', 'angle'];

const ASSEMBLY_KEYS: readonly string[] = ['modules', 'notes'];

const FILE_KEYS: readonly string[] = ['formatVersion', 'name', 'notes', 'fighter', 'doctrine', 'hangar', 'assemblies', 'modules'];

export function degreesToRadians(degrees: number): number {
  return (degrees / 180) * PI;
}

export function radiansToDegrees(radians: number): number {
  return (radians / PI) * 180;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function optionalBooleanProblem(value: unknown, what: string): string | null {
  if (value !== undefined && typeof value !== 'boolean') {
    return `${what} must be true or false, got ${JSON.stringify(value)}`;
  }
  return null;
}

function optionalStringProblem(value: unknown, what: string): string | null {
  if (value !== undefined && typeof value !== 'string') {
    return `${what} must be a string, got ${JSON.stringify(value)}`;
  }
  return null;
}

/**
 * A kind as the format names it now. Files written before engines faced along
 * their bells call one a `thruster` and give the way it pushes, so the name is
 * also the marker for turning it half round (`currentAngle`).
 */
function currentKind(kind: unknown): unknown {
  return kind === 'thruster' ? 'engine' : kind;
}

/** A module's facing in degrees, turned half round for a `thruster` written the old way. */
function currentAngle(raw: Record<string, unknown>): number | undefined {
  const angle = raw['angle'] as number | undefined;
  if (raw['kind'] !== 'thruster') return angle;
  const turned = (angle ?? 0) + 180;
  return turned > 180 ? turned - 360 : turned;
}

/**
 * Read a hull mount's barrel the way files wrote it before barrels were
 * measured in calibres: as `nozzle`, the share of the module it took. A gun's
 * becomes the same length in calibres; a lens housing's has nothing to become,
 * having one best depth. Whether there was one to read.
 */
function legacyBarrel(spec: ModuleSpec, raw: Record<string, unknown>): boolean {
  const share = raw['nozzle'];
  if (!isHullMount(spec.kind) || typeof share !== 'number') return false;
  if (spec.kind === 'hullGun' && spec.barrelCalibres === undefined) {
    const calibre = hullMountGeometry(spec).outletWidth / BARREL_OUTER_CALIBRES;
    if (calibre > 0) spec.barrelCalibres = round((share * spec.length * 1000) / calibre) / 1000;
  }
  return true;
}

function moduleShapeProblem(value: Record<string, unknown>, where: string): string | null {
  const kind = currentKind(value['kind']);
  if (typeof kind !== 'string' || !MODULE_KINDS.includes(kind as ModuleKind)) {
    return `${where}: kind must be one of ${MODULE_KINDS.join(', ')}, got ${JSON.stringify(value['kind'])}`;
  }

  const shaped = value['vertices'] !== undefined && canShape(kind as ModuleKind);
  return (
    numberProblem(value['x'], `${where}: x`) ??
    verticesProblem(value['vertices'], kind as ModuleKind, `${where}: vertices`) ??
    numberProblem(value['y'], `${where}: y`) ??
    // A shaped module's size is its corners, so it need not repeat it. The
    // keys are still written back, since every other reader of a layout —
    // a mutation, a refit, the editor's number boxes — asks a module how big
    // it is before it asks what shape.
    (shaped
      ? null
      : (numberProblem(value['length'], `${where}: length`) ??
        numberProblem(value['width'], `${where}: width`))) ??
    optionalNumberProblem(value['angle'], `${where}: angle`) ??
    optionalNumberProblem(value['reinforcement'], `${where}: reinforcement`) ??
    optionalNumberProblem(value['barrels'], `${where}: barrels`) ??
    optionalNumberProblem(value['nozzle'], `${where}: nozzle`) ??
    optionalNumberProblem(value['barrelCalibres'], `${where}: barrelCalibres`) ??
    optionalNumberProblem(value['traverse'], `${where}: traverse`) ??
    optionalNumberProblem(value['fuse'], `${where}: fuse`) ??
    optionalNumberProblem(value['fragments'], `${where}: fragments`) ??
    optionalNumberProblem(value['burstSpeed'], `${where}: burstSpeed`) ??
    optionalBooleanProblem(value['weapon'], `${where}: weapon`) ??
    optionalBooleanProblem(value['main'], `${where}: main`) ??
    optionalBooleanProblem(value['thick'], `${where}: thick`) ??
    optionalNumberProblem(value['sealing'], `${where}: sealing`) ??
    optionalNumberProblem(value['drainPriority'], `${where}: drainPriority`) ??
    optionalNumberProblem(value['fill'], `${where}: fill`) ??
    optionalStringProblem(value['docked'], `${where}: docked`) ??
    targetingProblem(value['targeting'], `${where}: targeting`) ??
    optionalStringProblem(value['notes'], `${where}: notes`)
  );
}

/**
 * The keys a module of this kind reads.
 *
 * A field its kind would never read — a `nozzle` on a turret — is not refused:
 * it is kept as unread, said as a warning, and written back as it was. In
 * memory a running mutation may leave such a field on a module, waiting for a
 * refit back; `serialiseBlueprint` writes only what the kind reads, so those
 * never reach a file.
 */
function moduleReads(kind: ModuleKind): readonly string[] {
  return MODULE_KEYS.filter((key) => {
    if (key === 'nozzle') return readsNozzle(kind);
    if (key === 'barrelCalibres') return readsBarrelCalibres(kind);
    if (key === 'barrels') return countsOutlets(kind);
    if (key === 'traverse') return isWeaponMount(kind);
    if (key === 'fuse' || key === 'fragments' || key === 'burstSpeed') return readsFuse(kind);
    if (key === 'weapon') return readsWeapon(kind);
    if (key === 'main') return readsMain(kind);
    if (key === 'thick') return readsThick(kind);
    if (key === 'sealing') return readsSealing(kind);
    if (key === 'drainPriority') return readsDrainPriority(kind);
    if (key === 'fill') return readsFill(kind);
    if (key === 'docked') return readsDocked(kind);
    if (key === 'vertices') return canShape(kind);
    return true;
  });
}

/**
 * What makes a module's corners unreadable, or null.
 *
 * Only that they are three pairs of numbers on a kind that may be shaped:
 * whether they enclose anything, and whether they are wound and centred as the
 * simulation holds them, is `moduleProblem`'s to say — and a file's corners are
 * re-centred as they are read, so an author may place them anywhere.
 */
function verticesProblem(value: unknown, kind: ModuleKind, where: string): string | null {
  if (value === undefined) return null;
  if (!canShape(kind)) return `${where}: only structure and tanks may be given corners`;
  if (!Array.isArray(value) || value.length !== TRIANGLE_CORNERS * 2) {
    return `${where}: must be ${TRIANGLE_CORNERS} corners as ${TRIANGLE_CORNERS * 2} x,y numbers`;
  }
  for (const corner of value) {
    const problem = numberProblem(corner, where);
    if (problem !== null) return problem;
  }
  return null;
}

function instanceShapeProblem(value: Record<string, unknown>, where: string): string | null {
  if (typeof value['use'] !== 'string' || value['use'] === '') {
    return `${where}: use must be the name of an assembly, got ${JSON.stringify(value['use'])}`;
  }
  const mirror = value['mirror'];
  if (mirror !== undefined && typeof mirror !== 'boolean') {
    return `${where}: mirror must be true or false, got ${JSON.stringify(mirror)}`;
  }
  const step = value['step'];
  if (step !== undefined) {
    if (!isObject(step)) return `${where}: step must be an object, got ${JSON.stringify(step)}`;
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
    const notes = optionalStringProblem(assembly['notes'], `assembly ${name}: notes`);
    if (notes !== null) return notes;
    const modules = placementsShapeProblem(assembly['modules'], `assembly ${name}: modules`);
    if (modules !== null) return modules;
  }
  return null;
}

/**
 * What makes a file unreadable, or null.
 *
 * Its *shape* only: the format version and the types. A key it does not know
 * is not one of these: it is kept and warned about (`blueprintWarnings`), so a
 * hand-edited file with a typo in it still opens. Whether the
 * layout it describes is a ship that could fly is `blueprintProblem`'s
 * question, and deliberately a separate one — a file naming an engine
 * welded to nothing is perfectly readable, and refusing to read it is what
 * makes such a ship impossible to open and put right.
 */
/** What makes a hangar unreadable, or null: an object of blueprint files, by name. */
function hangarProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return `hangar must be an object, got ${JSON.stringify(value)}`;
  for (const [name, file] of Object.entries(value)) {
    const problem = blueprintFileProblem(file);
    if (problem !== null) return `hangar, ${name}: ${problem}`;
  }
  return null;
}

export function blueprintFileProblem(value: unknown): string | null {
  if (!isObject(value)) return `a blueprint file must be an object, got ${JSON.stringify(value)}`;

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

  const fighter = optionalBooleanProblem(value['fighter'], 'fighter');
  if (fighter !== null) return fighter;

  const doctrine = doctrineProblem(value['doctrine']);
  if (doctrine !== null) return doctrine;

  const hangar = hangarProblem(value['hangar']);
  if (hangar !== null) return hangar;

  const assemblies = assembliesShapeProblem(value['assemblies']);
  if (assemblies !== null) return assemblies;

  return placementsShapeProblem(value['modules'], 'modules');
}

/** Assemble a blueprint from a file whose shape has already been checked. */
function toBlueprint(file: Record<string, unknown>): Blueprint {
  const blueprint: Blueprint = {
    name: file['name'] as string,
    modules: toPlacements(file['modules'] as unknown[]),
  };
  if (file['notes'] !== undefined) blueprint.notes = file['notes'] as string;
  if (file['fighter'] !== undefined) blueprint.fighter = file['fighter'] as boolean;
  if (file['doctrine'] !== undefined) {
    blueprint.doctrine = toDoctrine(file['doctrine']);
    const unreadDoctrine = doctrineUnread(file['doctrine']);
    if (unreadDoctrine !== undefined) blueprint.unreadDoctrine = unreadDoctrine;
  }
  const unread = unreadOf(file, FILE_KEYS);
  if (unread !== undefined) blueprint.unread = unread;

  const rawHangar = file['hangar'] as Record<string, Record<string, unknown>> | undefined;
  if (rawHangar !== undefined) {
    const hangar: Record<string, Blueprint> = {};
    for (const [name, raw] of Object.entries(rawHangar)) hangar[name] = toBlueprint(raw);
    blueprint.hangar = hangar;
  }

  const rawAssemblies = file['assemblies'] as Record<string, Record<string, unknown>> | undefined;
  if (rawAssemblies !== undefined) {
    const assemblies: Record<string, Assembly> = {};
    for (const [name, raw] of Object.entries(rawAssemblies)) {
      const assembly: Assembly = { modules: toPlacements(raw['modules'] as unknown[]) };
      if (raw['notes'] !== undefined) assembly.notes = raw['notes'] as string;
      const unreadAssembly = unreadOf(raw, ASSEMBLY_KEYS);
      if (unreadAssembly !== undefined) assembly.unread = unreadAssembly;
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
        const unreadStep = unreadOf(rawStep, STEP_KEYS);
        if (unreadStep !== undefined) step.unread = unreadStep;
        instance.step = step;
      }
      if (raw['notes'] !== undefined) instance.notes = raw['notes'] as string;
      const unreadInstance = unreadOf(raw, INSTANCE_KEYS);
      if (unreadInstance !== undefined) instance.unread = unreadInstance;
      return instance;
    }

    const kind = currentKind(raw['kind']) as ModuleKind;
    const reads = moduleReads(kind);
    const spec: ModuleSpec = {
      kind,
      x: raw['x'] as number,
      y: raw['y'] as number,
      length: (raw['length'] as number | undefined) ?? 0,
      width: (raw['width'] as number | undefined) ?? 0,
    };
    const angle = currentAngle(raw);
    if (angle !== undefined) spec.angle = degreesToRadians(angle);
    if (raw['reinforcement'] !== undefined) spec.reinforcement = raw['reinforcement'] as number;
    // Only what this kind reads; anything else is kept below as unread.
    const read = (key: string): boolean => raw[key] !== undefined && reads.includes(key);
    if (read('barrels')) spec.barrels = raw['barrels'] as number;
    if (read('nozzle')) spec.nozzle = raw['nozzle'] as number;
    if (read('barrelCalibres')) spec.barrelCalibres = raw['barrelCalibres'] as number;
    // Degrees in the file and radians in the simulation, as every other angle.
    if (read('traverse')) spec.traverse = degreesToRadians(raw['traverse'] as number);
    if (read('fuse')) spec.fuse = raw['fuse'] as number;
    if (read('fragments')) spec.fragments = raw['fragments'] as number;
    if (read('burstSpeed')) spec.burstSpeed = raw['burstSpeed'] as number;
    if (read('weapon')) spec.weapon = raw['weapon'] as boolean;
    if (read('main')) spec.main = raw['main'] as boolean;
    if (read('thick')) spec.thick = raw['thick'] as boolean;
    if (read('sealing')) spec.sealing = raw['sealing'] as number;
    if (read('drainPriority')) spec.drainPriority = raw['drainPriority'] as number;
    if (read('fill')) spec.fill = raw['fill'] as number;
    if (read('docked')) spec.docked = raw['docked'] as string;
    // Copied whole, so a key the block does not know goes back out with it.
    if (raw['targeting'] !== undefined) spec.targeting = { ...(raw['targeting'] as Partial<Targeting>) };
    if (raw['notes'] !== undefined) spec.notes = raw['notes'] as string;
    const legacy = legacyBarrel(spec, raw);
    const unread = unreadOf(raw, legacy ? [...reads, 'nozzle'] : reads);
    if (unread !== undefined) spec.unread = unread;
    if (read('vertices')) {
      // Re-centred on the corners' own middle and wound the way the simulation
      // holds them, which moves the module's position rather than the corners:
      // an author places three points on the ship and need not work out where
      // their centroid landed, nor which way round they went.
      const shaped = shapeModule(spec, raw['vertices'] as number[]);
      if (shaped !== null) return shaped;
    }
    return spec;
  });
}

/**
 * A blueprint from a parsed file, or a throw naming what makes it unreadable.
 *
 * Throwing rather than returning a union follows `moduleStats`: a caller with
 * a file it believes in should not have to unwrap, and one that does not
 * believe in it should ask `blueprintFileProblem` first.
 *
 * What comes back is a layout, not a ship: the design rules are not checked
 * here. `compileBlueprint` is where a blueprint has to be flyable, so nothing
 * invalid reaches a battle, and an editor can open a broken layout and show
 * what is wrong with it.
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
  if (blueprint.fighter !== undefined) file['fighter'] = blueprint.fighter;
  if (blueprint.doctrine !== undefined || blueprint.unreadDoctrine !== undefined) {
    // Only what it says differently from the default, so a file stays short
    // and a default that moves later moves for every ship that never had an
    // opinion about it.
    const doctrine = mergeUnread(
      blueprint.doctrine === undefined ? undefined : serialiseDoctrine(blueprint.doctrine),
      blueprint.unreadDoctrine,
    );
    if (doctrine !== undefined) file['doctrine'] = doctrine;
  }

  if (blueprint.hangar !== undefined) {
    const hangar: Record<string, unknown> = {};
    for (const [name, fighter] of Object.entries(blueprint.hangar)) hangar[name] = serialiseBlueprint(fighter);
    file['hangar'] = hangar;
  }

  if (blueprint.assemblies !== undefined) {
    const assemblies: Record<string, unknown> = {};
    for (const [name, assembly] of Object.entries(blueprint.assemblies)) {
      const raw: Record<string, unknown> = {};
      if (assembly.notes !== undefined) raw['notes'] = assembly.notes;
      raw['modules'] = assembly.modules.map(serialisePlacement);
      writeUnread(raw, assembly.unread);
      assemblies[name] = raw;
    }
    file['assemblies'] = assemblies;
  }

  file['modules'] = blueprint.modules.map(serialisePlacement);
  writeUnread(file, blueprint.unread);

  return file;
}

/** A block as serialised, with its unread keys merged back in, one level into objects. */
function mergeUnread(
  block: Record<string, unknown> | undefined,
  unread: UnreadKeys | undefined,
): Record<string, unknown> | undefined {
  if (unread === undefined) return block;
  const out: Record<string, unknown> = { ...block };
  for (const [key, value] of Object.entries(unread)) {
    const held = out[key];
    if (isObject(held) && isObject(value)) out[key] = { ...held, ...value };
    else if (held === undefined) out[key] = value;
  }
  return out;
}

/**
 * Everything in a blueprint that its file carried and nothing reads, as one
 * warning per place: so an editor can say so on opening it and again on
 * saving it, since saving writes those keys back as they were.
 */
export function blueprintWarnings(blueprint: Blueprint): string[] {
  const out: string[] = [];
  unreadWarning('the file', blueprint.unread, out);
  if (blueprint.unreadDoctrine !== undefined) {
    const { targeting, approach, ...top } = blueprint.unreadDoctrine as Record<string, unknown>;
    unreadWarning('doctrine', Object.keys(top).length > 0 ? top : undefined, out);
    unreadWarning('doctrine.targeting', isObject(targeting) ? targeting : undefined, out);
    unreadWarning('doctrine.approach', isObject(approach) ? approach : undefined, out);
  }
  for (const [name, assembly] of Object.entries(blueprint.assemblies ?? {})) {
    unreadWarning(`assembly ${name}`, assembly.unread, out);
    placementWarnings(assembly.modules, `assembly ${name}: modules`, out);
  }
  placementWarnings(blueprint.modules, 'modules', out);
  return out;
}

function placementWarnings(placements: readonly Placement[], where: string, out: string[]): void {
  placements.forEach((placement, i) => {
    const at = `${where}[${i}]`;
    unreadWarning(at, placement.unread, out);
    if (isInstance(placement)) {
      unreadWarning(`${at}: step`, placement.step?.unread, out);
      return;
    }
    if (placement.targeting !== undefined) {
      unreadWarning(
        `${at}: targeting`,
        unreadOf(placement.targeting as Record<string, unknown>, TARGETING_FIELDS),
        out,
      );
    }
  });
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
      writeUnread(step, placement.step.unread);
      raw['step'] = step;
    }
    if (placement.notes !== undefined) raw['notes'] = placement.notes;
    writeUnread(raw, placement.unread);
    return raw;
  }

  const raw: Record<string, unknown> = { kind: placement.kind, x: placement.x, y: placement.y };
  if (placement.angle !== undefined) raw['angle'] = radiansToDegrees(placement.angle);
  raw['length'] = placement.length;
  raw['width'] = placement.width;
  if (placement.vertices !== undefined && canShape(placement.kind)) {
    raw['vertices'] = [...placement.vertices];
  }
  if (placement.reinforcement !== undefined) raw['reinforcement'] = placement.reinforcement;
  // Only what this kind reads: a dormant field is a running mutation's memory
  // of what the module used to be, and a file is not the place for it.
  if (placement.barrels !== undefined && countsOutlets(placement.kind)) {
    raw['barrels'] = placement.barrels;
  }
  if (placement.nozzle !== undefined && readsNozzle(placement.kind)) {
    raw['nozzle'] = placement.nozzle;
  }
  if (placement.barrelCalibres !== undefined && readsBarrelCalibres(placement.kind)) {
    raw['barrelCalibres'] = placement.barrelCalibres;
  }
  if (placement.traverse !== undefined && isWeaponMount(placement.kind)) {
    raw['traverse'] = radiansToDegrees(placement.traverse);
  }
  if (readsFuse(placement.kind)) {
    if (placement.fuse !== undefined) raw['fuse'] = placement.fuse;
    if (placement.fragments !== undefined) raw['fragments'] = placement.fragments;
    if (placement.burstSpeed !== undefined) raw['burstSpeed'] = placement.burstSpeed;
  }
  if (placement.weapon !== undefined && readsWeapon(placement.kind)) {
    raw['weapon'] = placement.weapon;
  }
  if (placement.main !== undefined && readsMain(placement.kind)) {
    raw['main'] = placement.main;
  }
  if (placement.thick !== undefined && readsThick(placement.kind)) {
    raw['thick'] = placement.thick;
  }
  if (placement.sealing !== undefined && readsSealing(placement.kind)) {
    raw['sealing'] = placement.sealing;
  }
  if (placement.drainPriority !== undefined && readsDrainPriority(placement.kind)) {
    raw['drainPriority'] = placement.drainPriority;
  }
  if (placement.fill !== undefined && readsFill(placement.kind)) raw['fill'] = placement.fill;
  if (placement.docked !== undefined && readsDocked(placement.kind)) raw['docked'] = placement.docked;
  // Written as authored: a mount's block is already only its differences from
  // the ship it is on, so there is nothing to subtract.
  if (placement.targeting !== undefined) raw['targeting'] = { ...placement.targeting };
  if (placement.notes !== undefined) raw['notes'] = placement.notes;
  writeUnread(raw, placement.unread);
  return raw;
}
