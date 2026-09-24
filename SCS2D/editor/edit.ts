import {
  expandBlueprint,
  isInstance,
  moduleCentre,
  samePlacement,
  math,
  placementAt,
  pushNeighbours,
  type Assembly,
  type AssemblyInstance,
  type Blueprint,
  type ModuleOrigin,
  type ModulePath,
  type ModuleSpec,
  type PathStep,
  type Placement,
} from '../sim/index.js';

const { cos, sin, round, abs, normalizeAngle } = math;

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

/**
 * Delete the copy that was selected, rather than the part it is a copy of.
 *
 * The same split as `positionHandle`, and for the same reason: when a module
 * is the whole of an assembly, the unit on the ship is the *copy*, so deleting
 * one should leave the others. Deleting the shared module instead made every
 * copy vanish at once, which is never what pressing Delete on one of them
 * meant. When the assembly holds other modules, the module is part of a group
 * and deleting it takes it out of every copy of that group, which is what
 * deleting part of a group has to mean.
 *
 * Taking the last instance takes the assembly with it, so a layout does not
 * accumulate definitions nothing places.
 */
export function removeCopy(blueprint: Blueprint, origin: ModuleOrigin): Blueprint | null {
  const handle = positionHandle(blueprint, origin);
  const removed = removePlacement(blueprint, handle.origin.path);
  if (removed === null || !handle.perCopy) return removed;

  const name = enteredAssembly(origin.path)?.step.assembly;
  if (name === undefined || countInstances(removed, name) > 0) return removed;
  const copy = removed as unknown as MutableBlueprint;
  delete copy.assemblies?.[name];
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
 * Turn a facing in the blueprint's frame into the one to write on a placement.
 *
 * The inverse of what the expansion did: a module in a mirrored group is
 * written with the facing that comes out reflected, so turning a drawn copy
 * clockwise turns the written module anticlockwise. Kept beside
 * `toPlacementFrame` because the two are the same conversion for the two
 * things a drag can change.
 */
export function toPlacementAngle(origin: ModuleOrigin, angle: number): number {
  const own = angle - origin.rotation;
  return normalizeAngle(origin.mirrored ? -own : own);
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
 * Resize a drawn module: its size on the part, and `dx`/`dy` (blueprint frame)
 * on the module within its own frame, as `resizedTo` works them out — so every
 * copy of a shared part moves alike, mirrored where the copy is.
 *
 * With `push`, whatever sits against a face that moved goes with it, among the
 * placements written beside this copy's position (`pushNeighbours`). A copy
 * that is one of a repeated row pushes nothing, since its neighbours differ
 * from copy to copy.
 */
export function resizePlacement(
  blueprint: Blueprint,
  origin: ModuleOrigin,
  length: number,
  width: number,
  dx: number,
  dy: number,
  push: boolean,
): Blueprint | null {
  const position = positionHandle(blueprint, origin).origin;
  const sized = updatePlacement(blueprint, origin.path, (p) => ({ ...p, length, width }));
  if (sized === null) return null;
  const moved = dx === 0 && dy === 0 ? sized : movePlacement(sized, origin, dx, dy);
  if (moved === null || !push) return moved;

  const was = containing(blueprint as unknown as MutableBlueprint, position.path);
  const copy = cloneBlueprint(moved) as unknown as MutableBlueprint;
  const now = containing(copy, position.path);
  if (was === null || now === null) return moved;
  const before = boxOf(was.list[was.index]!, blueprint.assemblies);
  const after = boxOf(now.list[now.index]!, copy.assemblies);
  if (before === null || after === null) return moved;
  const pushed = pushNeighbours(now.list, now.index, copy.assemblies, before, after);
  now.list.splice(0, now.list.length, ...pushed);
  return copy as unknown as Blueprint;
}

/** A placement as the one box it draws in its list's frame, or null if it is not one. */
function boxOf(
  placement: Placement,
  assemblies: Readonly<Record<string, Assembly>> | undefined,
): ModuleSpec | null {
  if (!isInstance(placement)) return placement;
  if ((placement.repeat ?? 1) > 1) return null;
  const drawn = expandBlueprint({ name: '', modules: [placement], assemblies: assemblies ?? {} });
  return drawn.length === 1 ? drawn[0]! : null;
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
 * Where a placement is written: which definition's list it sits in, and
 * whether it sits there directly.
 *
 * Two placements can be grouped only if they answer the same `root` and both
 * sit one step inside it, because that is what "the same list" means — the
 * new instance has to go somewhere, and it goes where they were.
 */
function writtenIn(path: ModulePath): { root: string; direct: boolean } {
  const entered = enteredAssembly(path);
  const from = entered === null ? 0 : entered.at + 1;
  return { root: entered?.step.assembly ?? '', direct: path.length - from === 1 };
}

/** The path naming a placement's parent list, which a sibling is appended to. */
function siblingOf(path: ModulePath, index: number): ModulePath {
  return [...path.slice(0, -1), { index, copy: 0 }];
}

/**
 * Why these modules cannot be made into a group, or null if they can.
 *
 * The first origin is the one the group will be built around, so order
 * matters and the caller has to pass them in the order they were picked.
 */
export function groupProblem(
  blueprint: Blueprint,
  origins: readonly ModuleOrigin[],
): string | null {
  if (origins.length < 2) return 'Select two or more modules to group them';

  const first = writtenIn(origins[0]!.path);
  for (const origin of origins) {
    const placement = placementAt(blueprint, origin.path);
    if (placement === null) return 'One of the modules is no longer there';
    // Grouping instances would nest one assembly inside another, which the
    // format allows and this does not yet build.
    if (isInstance(placement)) return 'A group can only be made out of modules, not other groups';
    const here = writtenIn(origin.path);
    if (!here.direct || here.root !== first.root) {
      return 'All of the modules have to be in the same group already';
    }
  }
  return null;
}

/**
 * Make an assembly out of several modules, and place it once where they were.
 *
 * The half of shared parts that `duplicatePlacement` cannot reach: that one
 * makes an assembly out of a *single* module, so a ship can have shared parts
 * but not shared *structures*. This is what a mirrored wing needs — build one
 * side, group it, place the group again with `mirror` set, and the two sides
 * cannot disagree about anything except which side they are on.
 *
 * **The first module picked is the origin**, and that is a choice worth
 * stating because it is not the obvious one. The centre of the selection would
 * be tidier on screen, but a group is usually a thing hanging off a single
 * connecting module — a wing off its root, a turret and its barbette — and
 * that module is the one whose position means something. Making it the origin
 * means mirroring turns the group about the part that joins it to the ship,
 * which is where a shipwright would put the hinge.
 *
 * **Members keep the order they were written in**, not the order they were
 * clicked, so that the group's internals stay as close to the original ship as
 * they can be.
 *
 * **The instance is appended**, like every other placement this editor makes,
 * because module order is part of the ship: thrusters are allocated over the
 * columns in order and turrets fire in order. Grouping therefore moves the
 * grouped modules to the end of the expansion, and a ship whose layout is
 * order-sensitive will fly slightly differently afterwards. Nothing about its
 * geometry moves.
 */
export function groupPlacements(
  blueprint: Blueprint,
  origins: readonly ModuleOrigin[],
): { blueprint: Blueprint; path: ModulePath } | null {
  if (groupProblem(blueprint, origins) !== null) return null;

  const copy = cloneBlueprint(blueprint) as unknown as MutableBlueprint;
  const pivot = containing(copy, origins[0]!.path);
  if (pivot === null) return null;
  const list = pivot.list;
  const at = list[pivot.index]!;
  const originX = at.x;
  const originY = at.y;

  const indices: number[] = [];
  for (const origin of origins) {
    const found = containing(copy, origin.path);
    if (found === null || found.list !== list) return null;
    if (!indices.includes(found.index)) indices.push(found.index);
  }
  indices.sort((a, b) => a - b);

  // Re-expressed about the origin, so the assembly is written in its own frame
  // and the instance carries where that frame lands.
  const members: Placement[] = indices.map((index) => {
    const member = list[index]!;
    return { ...member, x: member.x - originX, y: member.y - originY };
  });

  const name = unusedAssemblyName(copy, 'group');
  copy.assemblies = { ...copy.assemblies, [name]: { modules: members } };

  // Descending, so that removing one does not move the next.
  for (let i = indices.length - 1; i >= 0; i--) list.splice(indices[i]!, 1);
  const index = list.length;
  list.push({ use: name, x: originX, y: originY } as AssemblyInstance);

  return {
    blueprint: copy as unknown as Blueprint,
    path: siblingOf(origins[0]!.path, index),
  };
}

/** How tall the assembly is, so a second copy can be put clear of the first. */
function assemblySpan(blueprint: Blueprint, name: string): number {
  const modules = blueprint.assemblies?.[name]?.modules ?? [];
  let lo = 0;
  let hi = 0;
  let seen = false;
  for (const member of modules) {
    // An instance has a pose and no size of its own; its own contents would
    // need the whole expansion, and a rough span is all this is for.
    const half = isInstance(member) ? 0 : (member as ModuleSpec).width / 2;
    const low = member.y - half;
    const high = member.y + half;
    if (!seen || low < lo) lo = low;
    if (!seen || high > hi) hi = high;
    seen = true;
  }
  const span = hi - lo;
  // Something rather than nothing, for a group with no height to speak of.
  return span > 1 ? span : 1;
}

/**
 * Place a group a second time, alongside the copy that was selected.
 *
 * The instance counterpart of `duplicatePlacement`, and the step that makes
 * grouping worth anything: one definition placed twice is a pair that cannot
 * drift apart, and setting `mirror` on the second is what makes it the other
 * side rather than the same side again.
 */
export function duplicateInstance(
  blueprint: Blueprint,
  path: ModulePath,
): { blueprint: Blueprint; path: ModulePath } | null {
  const placement = placementAt(blueprint, path);
  if (placement === null || !isInstance(placement)) return null;

  const copy = cloneBlueprint(blueprint) as unknown as MutableBlueprint;
  const found = containing(copy, path);
  if (found === null) return null;
  const instance = found.list[found.index] as AssemblyInstance;
  const index = found.list.length;
  found.list.push({ ...instance, y: instance.y + assemblySpan(blueprint, instance.use) });
  return { blueprint: copy as unknown as Blueprint, path: siblingOf(path, index) };
}

/**
 * Every instance a module was placed through, outermost first.
 *
 * A group inside a group is reached one level at a time, so clicking picks the
 * outermost and clicking again goes in — which is how a person expects to get
 * at a wing before getting at a bracket on it.
 */
export function instanceChain(path: ModulePath): ModulePath[] {
  const out: ModulePath[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const step = path[i]!;
    // Either hop is through an instance: `assembly` reaches its definition and
    // `extra` reaches what this copy carries on top of it.
    if (step.into === undefined) continue;
    out.push([...path.slice(0, i), { index: step.index, copy: step.copy }]);
  }
  return out;
}

/**
 * An instance addressed as an origin, so that the ordinary move and edit
 * functions work on it.
 *
 * The frame is taken from the expansion rather than worked out again, which is
 * what makes it exact: `instanceFrame` is the frame the innermost instance on
 * a module's path was written in, so any module this instance placed directly
 * carries the answer. An instance placing nothing but other instances has no
 * such module and gets null — it cannot be dragged, which is honest rather
 * than approximate.
 */
export function instanceHandle(
  origins: readonly ModuleOrigin[],
  path: ModulePath,
): ModuleOrigin | null {
  for (const origin of origins) {
    const inner = instanceOf(origin);
    if (inner === null || !samePlacement(inner, path)) continue;
    const frame = origin.instanceFrame;
    if (frame === null) continue;
    return { path, rotation: frame.rotation, mirrored: frame.mirrored, instanceFrame: null };
  }
  return null;
}

/**
 * Why these modules cannot be added to this group, or null if they can.
 */
export function addToGroupProblem(
  blueprint: Blueprint,
  instance: ModulePath,
  modules: readonly ModulePath[],
): string | null {
  const placed = placementAt(blueprint, instance);
  if (placed === null || !isInstance(placed)) return 'Pick one group to add to';
  if (blueprint.assemblies?.[placed.use] === undefined) return 'That group has no definition';
  if (modules.length === 0) return 'Pick some modules to add';

  const where = writtenIn(instance);
  for (const path of modules) {
    const module = placementAt(blueprint, path);
    if (module === null) return 'One of the modules is no longer there';
    if (isInstance(module)) return 'Only modules can be added to a group, not other groups';
    const here = writtenIn(path);
    if (!here.direct || here.root !== where.root) {
      return 'The modules have to be written alongside the group';
    }
  }
  return null;
}

/**
 * Move modules into a group that is already placed.
 *
 * The other way to build up a group: rather than picking everything and
 * grouping it at once, add to one that exists. What makes it more than a list
 * operation is the frame — the modules are written in the parent's frame and
 * the group's are written in the group's, so each one has to be re-expressed
 * through the instance's pose on the way in. Getting that wrong moves the
 * ship, and moves it in a way that only shows up on a turned or reflected
 * group, which is exactly the kind that gets built once and trusted.
 *
 * **A group placed more than once gains a module in every copy**, so adding
 * one part to a wing placed twice puts two parts on the ship. That is the
 * bargain rather than a surprise — it is why the group is worth having — but
 * it is the reason this is not simply a tidier way to write the same layout.
 */
export function addToGroup(
  blueprint: Blueprint,
  instance: ModulePath,
  modules: readonly ModulePath[],
): { blueprint: Blueprint; path: ModulePath } | null {
  if (addToGroupProblem(blueprint, instance, modules) !== null) return null;

  const copy = cloneBlueprint(blueprint) as unknown as MutableBlueprint;
  const found = containing(copy, instance);
  if (found === null) return null;
  const placed = found.list[found.index] as AssemblyInstance;
  const definition = copy.assemblies?.[placed.use];
  if (definition === undefined) return null;

  // The instance's own pose, which everything going in has to be expressed
  // through. Both the modules and the instance are written in the same frame,
  // so whatever that frame is cancels and only the instance's own pose is left.
  const turn = placed.angle ?? 0;
  const flipped = placed.mirror === true;
  const c = cos(-turn);
  const sn = sin(-turn);

  const indices: number[] = [];
  for (const path of modules) {
    const at = containing(copy, path);
    if (at === null || at.list !== found.list) return null;
    if (!indices.includes(at.index)) indices.push(at.index);
  }
  indices.sort((a, b) => a - b);

  for (const index of indices) {
    const module = found.list[index] as ModuleSpec;
    const dx = module.x - placed.x;
    const dy = module.y - placed.y;
    // Undo the placement: translate, then turn back, then unreflect — the
    // reverse of the order `place` applies them in.
    const localX = dx * c - dy * sn;
    const localY = dx * sn + dy * c;
    const own = (module.angle ?? 0) - turn;
    const member: ModuleSpec = {
      ...module,
      x: localX,
      y: flipped ? -localY : localY,
    };
    if (module.angle !== undefined || own !== 0) member.angle = flipped ? -own : own;
    definition.modules.push(member);
  }

  // Descending, so that removing one does not move the next. The instance
  // itself is never among them: it is not in `modules`.
  for (let i = indices.length - 1; i >= 0; i--) found.list.splice(indices[i]!, 1);

  // Every module taken out from ahead of the instance moves it down one, so
  // the path handed back is not the one passed in. Without this the caller
  // keeps selecting whatever slid into the old slot.
  const ahead = indices.filter((index) => index < found.index).length;
  const last = instance[instance.length - 1]!;
  const path: ModulePath = [
    ...instance.slice(0, -1),
    { ...last, index: found.index - ahead },
  ];
  return { blueprint: copy as unknown as Blueprint, path };
}

/**
 * The instance that placed this module, or null if nothing did.
 *
 * What makes a group's own properties reachable at all: clicking a module
 * selects the module, and the pose — where the group sits, how far it is
 * turned, whether it is reflected — belongs to the instance above it.
 */
export function instanceOf(origin: ModuleOrigin): ModulePath | null {
  const entered = enteredAssembly(origin.path);
  if (entered === null) return null;
  const steps = origin.path.slice(0, entered.at + 1);
  const last = steps[steps.length - 1]!;
  // Named rather than descended through, so the last step drops the hop.
  return [...steps.slice(0, -1), { index: last.index, copy: last.copy }];
}

/** Reflect an instance, or stop reflecting it. */
export function setMirror(
  blueprint: Blueprint,
  path: ModulePath,
  mirror: boolean,
): Blueprint | null {
  const placement = placementAt(blueprint, path);
  if (placement === null || !isInstance(placement)) return null;
  return updatePlacement(blueprint, path, (current) => {
    const instance = { ...(current as AssemblyInstance) };
    if (mirror) instance.mirror = true;
    else delete instance.mirror;
    return instance;
  });
}

/**
 * Set how many copies an instance places, and the step between them.
 *
 * The two are one edit because the format makes them one thing: a count above
 * one without a step piles every copy on the same spot, and a step without a
 * count does nothing at all, so a layout carrying one and not the other is
 * refused. Dropping back to a single copy therefore takes the step with it.
 *
 * What a repeat *is* worth saying here, since the panel has room for four
 * numbers and not for this: a repeated instance is a long structure written as
 * a count, so a wing of six identical bays is one bay and the number six, and
 * lengthening it is one edit rather than five placements to keep in step. The
 * step is applied in each copy's own frame, so a step angle walks the copies
 * round an arc and a ring of mounts costs no more to write than a row.
 */
export function setRepetition(
  blueprint: Blueprint,
  path: ModulePath,
  repeat: number,
  step: { x: number; y: number; angle?: number } | null,
): Blueprint | null {
  const placement = placementAt(blueprint, path);
  if (placement === null || !isInstance(placement)) return null;
  return updatePlacement(blueprint, path, (current) => {
    const instance = { ...(current as AssemblyInstance) };
    if (repeat > 1 && step !== null) {
      instance.repeat = repeat;
      instance.step = step;
    } else {
      delete instance.repeat;
      delete instance.step;
    }
    return instance;
  });
}

/**
 * How far a set of drawn modules reaches along a direction, metres.
 *
 * What it is for: a step that puts the next copy of a group beyond the last
 * one rather than on top of it. Turning a single instance into a repeat needs
 * *some* step, and a step of nothing is the one answer guaranteed to be wrong
 * — every copy would land on the first and the layout would complain about
 * geometry rather than about the number just typed.
 *
 * Measured over every module's own corners after its own rotation, so a group
 * of turned parts is measured by what it actually covers.
 */
export function extentAlong(specs: readonly ModuleSpec[], rotation: number): number {
  const ax = cos(rotation);
  const ay = sin(rotation);
  let low = Infinity;
  let high = -Infinity;
  for (const spec of specs) {
    const angle = spec.angle ?? 0;
    const c = cos(angle);
    const s = sin(angle);
    const hl = spec.length / 2;
    const hw = spec.width / 2;
    const mid = moduleCentre(spec);
    for (const [dl, dw] of [
      [hl, hw],
      [hl, -hw],
      [-hl, hw],
      [-hl, -hw],
    ] as const) {
      const x = mid.x + dl * c - dw * s;
      const y = mid.y + dl * s + dw * c;
      const along = x * ax + y * ay;
      if (along < low) low = along;
      if (along > high) high = along;
    }
  }
  return high > low ? high - low : 0;
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

/**
 * What stops a group being called this, or null if nothing does.
 *
 * A group's name is its key in the assemblies table and the `use` every
 * instance names it by, so the only rules are the ones that keep the table a
 * table: something has to be written, and two groups cannot share a name
 * without one of them disappearing into the other.
 */
export function renameProblem(blueprint: Blueprint, path: ModulePath, name: string): string | null {
  const placed = placementAt(blueprint, path);
  if (placed === null || !isInstance(placed)) return 'Only a group has a name';
  const wanted = name.trim();
  if (wanted === '') return 'A group needs a name';
  if (wanted === placed.use) return null;
  if (blueprint.assemblies?.[wanted] !== undefined) return `Another group is already called ${wanted}`;
  return null;
}

/**
 * Rename the group an instance places, everywhere it is named.
 *
 * The name is worth editing because it is the only thing about a group that
 * says what it is *for* — an assembly is otherwise a list of modules and a
 * number of copies — and a layout accumulates `group`, `group2`, `group3`
 * faster than anyone can keep track of.
 *
 * Every instance is renamed with it, at every depth, because the name is a
 * reference rather than a label: a `use` left pointing at the old name places
 * nothing at all. The table keeps its order, so the file's diff is the name
 * and not a reshuffle.
 */
export function renameAssembly(
  blueprint: Blueprint,
  path: ModulePath,
  name: string,
): Blueprint | null {
  if (renameProblem(blueprint, path, name) !== null) return null;
  const placed = placementAt(blueprint, path) as AssemblyInstance;
  const wanted = name.trim();
  if (wanted === placed.use) return blueprint;

  const copy = cloneBlueprint(blueprint) as unknown as MutableBlueprint;
  const definitions = copy.assemblies;
  if (definitions?.[placed.use] === undefined) return null;

  const renamed: Record<string, { modules: Placement[]; notes?: string }> = {};
  for (const [key, assembly] of Object.entries(definitions)) {
    renamed[key === placed.use ? wanted : key] = assembly;
  }
  copy.assemblies = renamed;

  const walk = (list: Placement[]): void => {
    for (const entry of list) {
      if (!isInstance(entry)) continue;
      const instance = entry as unknown as { use: string; extra?: Placement[] };
      if (instance.use === placed.use) instance.use = wanted;
      if (instance.extra !== undefined) walk(instance.extra);
    }
  };
  walk(copy.modules);
  for (const assembly of Object.values(renamed)) walk(assembly.modules);

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
    const mid = moduleCentre(m);
    const dx = x - mid.x;
    const dy = y - mid.y;
    const along = dx * c - dy * s;
    const across = dx * s + dy * c;
    if (abs(along) <= m.length * 0.5 && abs(across) <= m.width * 0.5) return i;
  }
  return -1;
}
