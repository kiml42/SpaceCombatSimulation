import {
  expandBlueprint,
  isInstance,
  math,
  placementAt,
  type Assembly,
  type AssemblyInstance,
  type Blueprint,
  type ModuleOrigin,
  type ModulePath,
  type ModuleSpec,
  type PathStep,
  type Placement,
} from '../sim/index.js';

const { cos, sin, round, abs } = math;

/**
 * Edits to a layout, as values.
 *
 * Every operation here takes a blueprint and returns a new one rather than
 * changing the one it was given. That is what makes undo a stack of
 * blueprints rather than a stack of inverse operations, and a stack of
 * inverse operations is where an editor's hardest bugs live: every action
 * needs an exact opposite, and the one that is subtly wrong corrupts the
 * document several steps after the mistake was made. A layout is a few
 * kilobytes of JSON, so keeping whole copies costs nothing worth counting.
 *
 * These are edits to how a layout is *written*, not to what it compiles to,
 * which is why they live out here and not in `sim/`. The rules about what a
 * module is and what it weighs belong to the simulation; where the text of a
 * placement sits in a file belongs to the editor.
 */

/** A blueprint under the editor's hand, with the readonly promises relaxed. */
interface MutableBlueprint {
  name: string;
  modules: Placement[];
  assemblies?: Record<string, { modules: Placement[]; notes?: string }>;
  notes?: string;
}

/** The last hop into an assembly on a path, which is where its definition begins. */
function enteredAssembly(path: ModulePath): { step: PathStep; at: number } | null {
  for (let i = path.length - 1; i >= 0; i--) {
    const step = path[i]!;
    if (step.into === 'assembly') return { step, at: i };
  }
  return null;
}

/**
 * Which placement puts *this copy* of a drawn module where it is, and the
 * frame that placement was written in.
 *
 * Usually the module itself. But when a module is the whole of an assembly —
 * which is what a shared part is, and what duplicating one produces — the
 * module sits at its assembly's origin and each instance carries a position of
 * its own. Moving one copy then means moving the instance, and moving the
 * module would shift every copy at once, which is almost never the intent.
 *
 * So position belongs to the copy and everything else — size, facing,
 * reinforcement, barrels, notes — stays shared. That is the split the format
 * already describes, since an instance may carry a pose and nothing else; this
 * is the editor agreeing with it.
 */
export interface PositionHandle {
  /** Addressed as an origin, so the same move and edit functions work on it. */
  origin: ModuleOrigin;
  /** Whether it moves this copy alone rather than every copy at once. */
  perCopy: boolean;
}

export function positionHandle(blueprint: Blueprint, origin: ModuleOrigin): PositionHandle {
  const own: PositionHandle = { origin, perCopy: false };
  const entered = enteredAssembly(origin.path);
  // Not placed through an assembly at all, or placed deeper inside one than
  // its own module list — either way the module carries its own position.
  if (entered === null || origin.path.length - entered.at !== 2) return own;

  const assembly = blueprint.assemblies?.[entered.step.assembly ?? ''];
  // An assembly holding more than this one module is a *group*, and dragging
  // one part of a group has to move that part rather than the whole group.
  if (assembly === undefined || assembly.modules.length !== 1) return own;

  const frame = origin.instanceFrame;
  if (frame === null) return own;
  return {
    origin: {
      // The instance named as a leaf, with the hop into its assembly dropped:
      // a path ending in that hop would describe the assembly's contents
      // rather than the instance, and would compare equal across every
      // instance of it.
      path: [
        ...origin.path.slice(0, entered.at),
        { index: entered.step.index, copy: entered.step.copy },
      ],
      rotation: frame.rotation,
      mirrored: frame.mirrored,
      instanceFrame: null,
    },
    perCopy: true,
  };
}

/**
 * A deep copy, through JSON.
 *
 * A blueprint is exactly the data a blueprint file holds — that is the whole
 * point of the format — so a round trip through JSON cannot lose anything that
 * would survive being saved, which makes this the copy with the smallest gap
 * between what it preserves and what matters.
 */
export function cloneBlueprint(blueprint: Blueprint): Blueprint {
  return JSON.parse(JSON.stringify(blueprint)) as Blueprint;
}

/** The list a path's last step indexes into, within a blueprint being edited. */
function containing(
  blueprint: MutableBlueprint,
  path: ModulePath,
): { list: Placement[]; index: number } | null {
  let list: Placement[] = blueprint.modules;
  for (let i = 0; i < path.length; i++) {
    const step = path[i]!;
    const entry = list[step.index];
    if (entry === undefined) return null;
    if (i === path.length - 1) return { list, index: step.index };
    if (!isInstance(entry)) return null;
    if (step.into === 'extra') {
      const extra = (entry as AssemblyInstance).extra as Placement[] | undefined;
      if (extra === undefined) return null;
      list = extra;
    } else {
      const assembly = blueprint.assemblies?.[entry.use];
      if (assembly === undefined) return null;
      list = assembly.modules;
    }
  }
  return null;
}

/**
 * Apply `change` to the placement a path names, returning a new blueprint —
 * or null if the path no longer leads anywhere, which is what a selection held
 * across an edit that removed something looks like.
 */
export function updatePlacement(
  blueprint: Blueprint,
  path: ModulePath,
  change: (placement: Placement) => Placement,
): Blueprint | null {
  const copy = cloneBlueprint(blueprint) as unknown as MutableBlueprint;
  const found = containing(copy, path);
  if (found === null) return null;
  found.list[found.index] = change(found.list[found.index]!);
  return copy as unknown as Blueprint;
}

/** Drop the placement a path names. Every copy of it goes with it. */
export function removePlacement(blueprint: Blueprint, path: ModulePath): Blueprint | null {
  const copy = cloneBlueprint(blueprint) as unknown as MutableBlueprint;
  const found = containing(copy, path);
  if (found === null) return null;
  found.list.splice(found.index, 1);
  return copy as unknown as Blueprint;
}

/**
 * Add a module to the end of the layout's own list, and say where it landed.
 *
 * The end, and not anywhere else, because module order is part of the ship:
 * thrusters are allocated over the columns in order and turrets fire in order,
 * so inserting into the middle of a working layout changes how every module
 * after it behaves. Appending is the one placement that leaves the existing
 * ship alone.
 */
export function addModule(
  blueprint: Blueprint,
  spec: ModuleSpec,
): { blueprint: Blueprint; path: ModulePath } {
  const copy = cloneBlueprint(blueprint) as unknown as MutableBlueprint;
  const index = copy.modules.length;
  copy.modules.push(spec);
  return { blueprint: copy as unknown as Blueprint, path: [{ index, copy: 0 }] };
}

/**
 * Turn a movement in the blueprint's frame into one in the frame a placement
 * was written in.
 *
 * A module inside a mirrored, turned assembly is dragged one way on screen and
 * *written* another, and this is the inverse of the transform the expansion
 * applied on the way out. Reflection is undone last because it was applied
 * first: an assembly is built in its own frame, and that frame is what gets
 * turned and placed.
 */
export function toPlacementFrame(
  origin: ModuleOrigin,
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  const c = cos(-origin.rotation);
  const s = sin(-origin.rotation);
  const localX = dx * c - dy * s;
  const localY = dx * s + dy * c;
  return { dx: localX, dy: origin.mirrored ? -localY : localY };
}

/**
 * Move a drawn module by a displacement given in the blueprint's own frame.
 *
 * What moves is the *placement*, so every copy of a shared part moves with it.
 * That is the assembly bargain working rather than failing — a wing placed
 * twice cannot have one copy dragged off the ship — and an editor owes the
 * player a warning that it is about to happen, not a different answer.
 */
export function movePlacement(
  blueprint: Blueprint,
  origin: ModuleOrigin,
  dx: number,
  dy: number,
): Blueprint | null {
  const local = toPlacementFrame(origin, dx, dy);
  return updatePlacement(blueprint, origin.path, (placement) => ({
    ...placement,
    x: placement.x + local.dx,
    y: placement.y + local.dy,
  }));
}

/**
 * Make a module into a shared part with two copies of it on the ship.
 *
 * The module becomes an assembly of its own and the layout places that
 * assembly twice, so the two are the *same part* rather than two parts that
 * happen to match: change one's size or facing and both change, with no state
 * in which one of them has been updated and the other has not. Position is the
 * exception and stays per copy, which is what `positionHandle` is about.
 *
 * Wrapping is exact — the module keeps its size, facing and everything else,
 * and the instance takes over its position — so the ship is unchanged at the
 * moment it happens apart from the copy that was asked for. The copy is
 * appended rather than inserted, because module order is part of the ship and
 * appending is the one placement that leaves the existing modules where they
 * were in it.
 *
 * Duplicating a module that is *already* the whole of an assembly places one
 * more instance of that assembly rather than wrapping it again. Without that,
 * pressing the button twice would nest a part inside a copy of itself and
 * quietly produce four.
 */
export function duplicatePlacement(
  blueprint: Blueprint,
  origin: ModuleOrigin,
): { blueprint: Blueprint; path: ModulePath } | null {
  const spec = placementAt(blueprint, origin.path);
  if (spec === null || isInstance(spec)) return null;

  const handle = positionHandle(blueprint, origin);
  if (handle.perCopy) {
    const added = appendCopy(blueprint, handle.origin.path, spec.width);
    return added === null ? null : { blueprint: added, path: origin.path };
  }

  const copy = cloneBlueprint(blueprint) as unknown as MutableBlueprint;
  const found = containing(copy, origin.path);
  if (found === null) return null;

  const name = unusedAssemblyName(copy, spec.kind);
  const definition: Assembly = { modules: [{ ...spec, x: 0, y: 0 }] };
  copy.assemblies = { ...copy.assemblies, [name]: definition as { modules: Placement[] } };

  const instance: AssemblyInstance = { use: name, x: spec.x, y: spec.y };
  found.list[found.index] = instance;
  // Alongside, by the module's own width across the frame it is placed in.
  // Somewhere visible and grabbable is the whole requirement — wherever it
  // lands, the next thing anybody does is drag it.
  found.list.push({ ...instance, y: instance.y + spec.width });

  return {
    blueprint: copy as unknown as Blueprint,
    path: [
      ...origin.path.slice(0, -1),
      { index: found.index, copy: 0, into: 'assembly', assembly: name },
      { index: 0, copy: 0 },
    ],
  };
}

/**
 * Whether a module could be unlinked: is it shared, and how many copies are
 * about to become separate parts.
 */
export function unlinkable(blueprint: Blueprint, origin: ModuleOrigin): number {
  const entered = enteredAssembly(origin.path);
  if (entered === null || origin.path.length - entered.at !== 2) return 0;
  const name = entered.step.assembly ?? '';
  if (blueprint.assemblies?.[name] === undefined) return 0;
  return countInstances(blueprint, name);
}

/**
 * Give every copy of a shared module one of its own, so they stop being the
 * same part.
 *
 * The inverse of `duplicatePlacement`, and the reason the editor can be useful
 * without being able to *build* an assembly: a part that was linked by
 * accident, or linked deliberately and then wanted different on one side, has
 * a way out. Grouping several modules into a new assembly is the harder half
 * and is not here.
 *
 * Two shapes, chosen by what would be left behind.
 *
 * **When the module is the whole of its assembly**, each instance is replaced
 * by what it expanded to, written straight into the list the instance was in,
 * and the assembly goes. That is exact: the modules come out of the same
 * expansion the ship is built from, in the same order and at the same
 * coordinates, so the ship does not change at all — not its geometry, and not
 * the order that decides thruster allocation and firing.
 *
 * **When the assembly holds other modules too**, the module is taken out of
 * the definition and handed to every instance as an `extra` of its own, which
 * is the mechanism the format has for exactly this. Two costs the caller
 * should say out loud rather than let the player discover: the part is gone
 * from the assembly, so a *new* instance will not have it; and extras are
 * placed after the assembly's own modules, so the part moves down the
 * expansion order — a slightly different ship, though nothing about its
 * geometry has moved.
 */
export function unlinkPlacement(blueprint: Blueprint, origin: ModuleOrigin): Blueprint | null {
  const entered = enteredAssembly(origin.path);
  if (entered === null || origin.path.length - entered.at !== 2) return null;
  const name = entered.step.assembly ?? '';
  const assembly = blueprint.assemblies?.[name];
  if (assembly === undefined) return null;

  const moduleIndex = origin.path[origin.path.length - 1]!.index;
  const spec = assembly.modules[moduleIndex];
  if (spec === undefined || isInstance(spec)) return null;

  const copy = cloneBlueprint(blueprint) as unknown as MutableBlueprint;

  if (assembly.modules.length === 1) {
    // Expanded in isolation, which reuses the one walk that knows how an
    // instance's rotation, reflection and repeat compose with what it places.
    // The result is in the frame the instance itself was written in, which is
    // the list it is being spliced into.
    eachList(copy, (list) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const entry = list[i]!;
        if (!isInstance(entry) || entry.use !== name) continue;
        const inline = expandBlueprint({
          name: blueprint.name,
          assemblies: blueprint.assemblies ?? {},
          modules: [entry],
        });
        list.splice(i, 1, ...inline);
      }
    });
    delete copy.assemblies?.[name];
    return copy as unknown as Blueprint;
  }

  const definition = copy.assemblies?.[name];
  if (definition === undefined) return null;
  definition.modules.splice(moduleIndex, 1);
  eachList(copy, (list) => {
    for (const entry of list) {
      if (!isInstance(entry) || entry.use !== name) continue;
      const instance = entry as AssemblyInstance & { extra?: Placement[] };
      instance.extra = [...(instance.extra ?? []), { ...spec }];
    }
  });
  return copy as unknown as Blueprint;
}

/** Every placement list in a layout: the ship's, each assembly's, and each instance's extras. */
function eachList(blueprint: MutableBlueprint, visit: (list: Placement[]) => void): void {
  const walk = (list: Placement[]): void => {
    visit(list);
    for (const entry of list) {
      if (isInstance(entry) && entry.extra !== undefined) walk(entry.extra as Placement[]);
    }
  };
  walk(blueprint.modules);
  for (const assembly of Object.values(blueprint.assemblies ?? {})) walk(assembly.modules);
}

/** How many times a layout places a named assembly, counting every copy of a repeat. */
function countInstances(blueprint: Blueprint, name: string): number {
  let total = 0;
  const walk = (list: readonly Placement[]): void => {
    for (const entry of list) {
      if (!isInstance(entry)) continue;
      if (entry.use === name) total += entry.repeat ?? 1;
      if (entry.extra !== undefined) walk(entry.extra);
    }
  };
  walk(blueprint.modules);
  for (const assembly of Object.values(blueprint.assemblies ?? {})) walk(assembly.modules);
  return total;
}

/** Place one more copy of the instance a path names, alongside it. */
function appendCopy(blueprint: Blueprint, path: ModulePath, across: number): Blueprint | null {
  const copy = cloneBlueprint(blueprint) as unknown as MutableBlueprint;
  const found = containing(copy, path);
  if (found === null) return null;
  const instance = found.list[found.index]!;
  found.list.push({ ...instance, y: instance.y + across });
  return copy as unknown as Blueprint;
}

/** A name for a new assembly that the layout is not already using. */
function unusedAssemblyName(blueprint: MutableBlueprint, kind: string): string {
  const taken = blueprint.assemblies ?? {};
  if (taken[kind] === undefined) return kind;
  for (let i = 2; ; i++) {
    const name = `${kind}${i}`;
    if (taken[name] === undefined) return name;
  }
}

/** Round to the nearest multiple of `step`, which is what the grid is for. */
export function snap(value: number, step: number): number {
  if (!(step > 0)) return value;
  return round(value / step) * step;
}

/**
 * Which drawn module is under a point in the blueprint's frame, or -1.
 *
 * Searched from the end, so the module drawn last — the one on top — is the
 * one picked. Modules are not meant to overlap, but a layout being worked on
 * routinely has some that do, and picking the one underneath in that moment
 * would make the overlap impossible to undo by dragging.
 */
export function moduleAt(modules: readonly ModuleSpec[], x: number, y: number): number {
  for (let i = modules.length - 1; i >= 0; i--) {
    const m = modules[i]!;
    const angle = m.angle ?? 0;
    const c = cos(-angle);
    const s = sin(-angle);
    const dx = x - m.x;
    const dy = y - m.y;
    const along = dx * c - dy * s;
    const across = dx * s + dy * c;
    if (abs(along) <= m.length * 0.5 && abs(across) <= m.width * 0.5) return i;
  }
  return -1;
}
