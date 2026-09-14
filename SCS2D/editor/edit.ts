import {
  isInstance,
  math,
  type AssemblyInstance,
  type Blueprint,
  type ModuleOrigin,
  type ModulePath,
  type ModuleSpec,
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
