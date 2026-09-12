import { abs, angleDelta, atan2, cos, max, min, normalizeAngle, PI, sin, sqrt, TAU } from './math.js';
import {
  moduleProblem,
  moduleStats,
  traverseAccel,
  traverseRate,
  type GunStats,
  type ModuleSpec,
  type ModuleStats,
} from './modules.js';
import { ThrusterLayout, type ThrusterSpec } from './thrusters.js';
import type { TurretSpec } from './turrets.js';

/**
 * Blueprints: a layout of modules, and what a ship built to it turns out to be.
 *
 * A blueprint is authored data — where the modules go — and says nothing about
 * how the ship performs. Compiling one derives all of that: mass and moment of
 * inertia from the modules' own geometry, the centre of mass everything is
 * measured about, the thruster layout to solve allocation with, and each
 * turret's mount including the arc the ship's own superstructure leaves it.
 *
 * **Compile once per design, not once per ship.** Everything here is fixed for
 * as long as the layout is, so a hundred strike craft off the same blueprint
 * share one compiled design and one thruster matrix between them (DESIGN.md
 * §4). Damage does not invalidate it: a wrecked module keeps its mass and its
 * place, so only losing a thruster — or severing part of the hull — changes
 * anything derived here.
 *
 * **The centre of mass is the body's origin.** Bodies rotate about their
 * centre of mass, so a layout authored about any convenient origin is shifted
 * onto it at compile time. Doing this once here means nothing downstream —
 * thruster arms, turret mounts, the renderer — has to remember to correct for
 * it, and a torque computed from a mount position is simply right.
 */

/** Modules closer than this count as touching rather than overlapping, metres. */
const TOUCH_TOLERANCE = 1e-9;

/**
 * How close a module must be to another to count as bolted to it, metres.
 *
 * A centimetre, which is nothing at ship scale and forgiving enough that a
 * hand-edited file off by a rounding error still describes an attached ship.
 * Exact abutment is a knife edge: the authored layouts land on it only because
 * they are drawn on round numbers, and a file someone typed will not.
 *
 * This is ROADMAP.md §12's "how close counts as welded" appearing for the
 * first time, ahead of the connectivity graph that will also need it. It is a
 * game parameter rather than an implementation detail, and when connectivity
 * lands the two should be the same number rather than two that drift.
 */
const ATTACHMENT_TOLERANCE = 0.01;

/**
 * A named group of modules placed as one thing, so that several copies of it
 * share a single description.
 *
 * The point is that copies cannot drift. A ship with eight identical lateral
 * thrusters holds one thruster and eight placements of it, so making them all
 * bigger is one edit and there is no state in which seven of them are.
 *
 * An assembly of a single module is the ordinary "shared part" case, and is
 * deliberately not a separate concept — one mechanism covers a repeated
 * thruster and a repeated wing, and having two would mean choosing between
 * them every time and converting between them eventually.
 *
 * Assemblies may contain instances of other assemblies, which is what makes a
 * whole mirrored ship expressible: a side is an assembly containing the wing
 * assembly, and the ship is that side placed twice.
 */
export interface Assembly {
  modules: readonly Placement[];
  /** Why this grouping exists. See `ModuleSpec.notes`. */
  notes?: string;
}

/**
 * One placement of an assembly: where it goes, and nothing about what it is.
 *
 * An instance deliberately cannot override any of the assembly's own values.
 * "Linked" then means *identical*, with no per-field exceptions to track and
 * no way for two copies to be almost the same. Wanting one copy different
 * means forking it into its own assembly, which is an explicit act rather than
 * a quiet divergence.
 */
export interface AssemblyInstance {
  /** Name of the assembly in the blueprint's own table. */
  use: string;
  /** Where the assembly's origin lands, in the frame doing the placing. */
  x: number;
  y: number;
  /** How far the assembly is turned, radians. */
  angle?: number;
  /** Reflect across the instance frame's own x-axis before placing it. */
  mirror?: boolean;
  /**
   * Modules this copy carries and the assembly does not, placed in the same
   * frame as the assembly's own — so they move and reflect with it, which is
   * the thing that cannot be had by placing a module in the parent instead.
   *
   * Purely additive, deliberately. It is how one copy differs from another
   * without an instance ever overriding a value, so "linked" keeps meaning
   * "identical" about everything the assembly defines, and the differences
   * between copies are all in one place and all visible.
   *
   * It is also what the editor's unlink is built from: taking a part out of
   * the definition and handing every instance its own copy leaves the ship
   * unchanged and each copy separately editable.
   */
  extra?: readonly Placement[];
  /**
   * How many copies to place in a row, each `step` on from the last.
   *
   * This is what a long repeated structure is written as — a wing of six
   * identical segments is one segment and a count, so lengthening the wing is
   * one number. It replaces what would otherwise be reached for instead: an
   * assembly containing *itself*, stopped by a depth limit. Repetition says
   * the same thing more plainly, cannot make a cycle, and leaves the size of a
   * ship visible in its file rather than needing the file to be expanded to
   * find out.
   *
   * `repeat` and `step` come as a pair, since a count without a step piles
   * copies on top of one another and a step without a count does nothing.
   * Capped at `MAX_REPEAT` per instance, with `MAX_EXPANDED_MODULES` behind it
   * because nesting multiplies: sixteen levels of sixty-four would be a number
   * no cap on a single instance could catch.
   */
  repeat?: number;
  step?: AssemblyStep;
  /** Why this copy is here. See `ModuleSpec.notes`. */
  notes?: string;
}

/**
 * How far along to move between the copies of a repeated instance.
 *
 * Applied in each copy's *own* frame rather than the instance's, so a step
 * carrying an angle walks the copies round an arc or a spiral rather than
 * along a line — a ring of turrets costs the same as a row of them.
 */
export interface AssemblyStep {
  x: number;
  y: number;
  angle?: number;
}

/** Something a layout puts somewhere: a module itself, or a copy of a group. */
export type Placement = ModuleSpec | AssemblyInstance;

export function isInstance(placement: Placement): placement is AssemblyInstance {
  return 'use' in placement;
}

export interface Blueprint {
  name: string;
  /**
   * What the layout places. Mostly modules; an entry with a `use` is a copy of
   * one of the `assemblies` below, and `expandBlueprint` resolves it.
   */
  modules: readonly Placement[];
  /** Groups this layout places by reference. */
  assemblies?: Readonly<Record<string, Assembly>>;
  /** Why the ship is shaped this way. See `ModuleSpec.notes`. */
  notes?: string;
}

/** A module in a compiled design: what was authored, plus what it works out to. */
export interface DesignModule {
  readonly spec: ModuleSpec;
  readonly stats: ModuleStats;
  /** Centre of the module relative to the centre of mass, body frame. */
  readonly x: number;
  readonly y: number;
  /** Facing, radians, body frame. */
  readonly angle: number;
}

/** A turret mount in a compiled design, ready to be added to a `Turrets` store. */
export interface DesignTurret {
  /** Index into the design's modules. */
  readonly module: number;
  /** Everything but the body it belongs to, which is only known at spawn. */
  readonly mount: Omit<TurretSpec, 'owner'>;
  readonly gun: GunStats;
}

export interface ShipDesign {
  readonly name: string;
  readonly modules: readonly DesignModule[];
  /** Total mass, kg. */
  readonly mass: number;
  /** Moment of inertia about the centre of mass, kg·m². */
  readonly inertia: number;
  /** Bounding-circle radius about the centre of mass, metres. */
  readonly radius: number;
  /** Where the centre of mass sat in the blueprint's own frame, metres. */
  readonly centreOfMassX: number;
  readonly centreOfMassY: number;
  readonly thrusters: readonly ThrusterSpec[];
  /** Shared by every ship built to this design. */
  readonly thrusterLayout: ThrusterLayout;
  readonly turrets: readonly DesignTurret[];
}

/** Corner offsets of a module, body frame, written into `out` as x,y pairs. */
function corners(m: ModuleSpec, out: number[]): void {
  const a = m.angle ?? 0;
  const c = cos(a);
  const s = sin(a);
  const hl = m.length * 0.5;
  const hw = m.width * 0.5;
  let k = 0;
  for (let i = 0; i < 4; i++) {
    // (+,+), (+,-), (-,-), (-,+) so the corners come out in order round the box.
    const dl = i < 2 ? hl : -hl;
    const dw = i === 0 || i === 3 ? hw : -hw;
    out[k++] = m.x + dl * c - dw * s;
    out[k++] = m.y + dl * s + dw * c;
  }
}

/**
 * Whether two oriented boxes overlap, by the separating-axis test.
 *
 * Boxes that merely touch do not overlap: modules are meant to abut, and a
 * layout drawn on round numbers puts their faces exactly together.
 */
export function modulesOverlap(a: ModuleSpec, b: ModuleSpec): boolean {
  const ca: number[] = [];
  const cb: number[] = [];
  corners(a, ca);
  corners(b, cb);

  // Four candidate axes: the two face normals of each box. In the plane that
  // is all of them, because a box's edges are its normals rotated a quarter
  // turn.
  const angleA = a.angle ?? 0;
  const angleB = b.angle ?? 0;
  const axes = [
    cos(angleA), sin(angleA),
    -sin(angleA), cos(angleA),
    cos(angleB), sin(angleB),
    -sin(angleB), cos(angleB),
  ];

  for (let i = 0; i < axes.length; i += 2) {
    const ax = axes[i]!;
    const ay = axes[i + 1]!;

    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (let k = 0; k < 8; k += 2) {
      const pa = ca[k]! * ax + ca[k + 1]! * ay;
      const pb = cb[k]! * ax + cb[k + 1]! * ay;
      minA = min(minA, pa);
      maxA = max(maxA, pa);
      minB = min(minB, pb);
      maxB = max(maxB, pb);
    }

    if (minA - maxB >= -TOUCH_TOLERANCE || minB - maxA >= -TOUCH_TOLERANCE) {
      return false;
    }
  }
  return true;
}

/** Distance from a point to the nearest point of a module's box, metres. */
function distanceToModule(m: ModuleSpec, px: number, py: number): number {
  const a = m.angle ?? 0;
  const c = cos(a);
  const s = sin(a);
  const dx = px - m.x;
  const dy = py - m.y;
  // Into the box's own frame, where the nearest point is a clamp per axis.
  const along = dx * c + dy * s;
  const across = -dx * s + dy * c;
  const hl = m.length * 0.5;
  const hw = m.width * 0.5;
  const outAlong = abs(along) - hl;
  const outAcross = abs(across) - hw;
  if (outAlong <= 0 && outAcross <= 0) return 0;
  const ea = max(outAlong, 0);
  const eb = max(outAcross, 0);
  return sqrt(ea * ea + eb * eb);
}

/**
 * The traverse a turret has before its own ship is in the way.
 *
 * Firing arcs are a property of the layout rather than something authored per
 * mount (DESIGN.md §3): put a gun behind the superstructure and it *is*
 * blocked, and the way to give it a better field of fire is to move it, which
 * is a design decision with costs. The alternative — a number the designer
 * types — would let every turret traverse fully for free and quietly delete
 * the reason ships have silhouettes.
 *
 * What blocks is any module the barrel would sweep into: near enough to be
 * within reach, and subtending bearings the gun would otherwise train through.
 * The half-width returned is symmetric about the mount's rest bearing, and is
 * the narrowest such width over every obstruction, so a mount fouled on one
 * side loses the matching sector on the other, and one near neighbour hides
 * whatever clear sky lies past it. That is pessimistic, and deliberately so.
 * The honest model is two quantities rather than one — a traverse bound saying
 * where the barrel may physically go, and a *set* of permitted firing
 * intervals, since a gun may sweep past superstructure it must not shoot
 * through, and a mount ringed by neighbours has several such gaps. DESIGN.md
 * §12 records the shape of that change; it waits on the blueprint editor,
 * which is what would make a layout's field of fire legible to a player.
 *
 * The test is bearing-only: a module is treated as blocking the whole sector
 * it subtends, without regard for the barrel being able to pass over a low
 * module or stop short of a distant one. In a deck plan that is the right
 * first answer, because everything drawn is full deck height.
 */
export function firingArc(
  modules: readonly ModuleSpec[],
  index: number,
  reach: number,
): { left: number; right: number } {
  const mount = modules[index]!;
  const rest = normalizeAngle(mount.angle ?? 0);

  let left = 2 * PI;
  let right = 2 * PI;

  for (let i = 0; i < modules.length; i++) {
    if (i === index) continue;
    const other = modules[i]!;
    if (distanceToModule(other, mount.x, mount.y) > reach) continue;

    const c: number[] = [];
    corners(other, c);

    // Bearings to the corners, taken relative to the bearing of the centre so
    // that the interval never has to be unwrapped.
    const centre = atan2(other.y - mount.y, other.x - mount.x);
    let lo = 0;
    let hi = 0;
    for (let k = 0; k < 8; k += 2) {
      const d = angleDelta(centre, atan2(c[k + 1]! - mount.y, c[k]! - mount.x));
      lo = min(lo, d);
      hi = max(hi, d);
    }

    // The rest bearing itself is inside the blocked interval: the gun is
    // buried, and there is no arc to have. Asked about the interval directly
    // rather than about the signs of the two edges, since an interval that
    // straddles dead astern has a positive edge and a negative one without
    // containing anything near the rest bearing.
    const restFromCentre = angleDelta(centre, rest);
    if (restFromCentre >= lo && restFromCentre <= hi) return { left: 0, right: 0 };

    // How far the mount can train each way before it reaches this obstruction,
    // measured as a *sweep* rather than as a signed bearing.
    //
    // That distinction is the whole of the asymmetry. A signed bearing says
    // where an edge is; a sweep says how far you must turn to get there, and
    // those differ in the direction you are turning away from. An obstruction
    // wholly off the port beam has both its edges at positive bearings, so
    // reading one of them as the starboard limit clamps a sweep that nothing
    // is in the way of — while an obstruction dead astern is genuinely reached
    // by turning either way, and this reaches it in both.
    const dLo = angleDelta(rest, centre + lo);
    const dHi = angleDelta(rest, centre + hi);
    left = min(left, dLo >= 0 ? dLo : dLo + TAU, dHi >= 0 ? dHi : dHi + TAU);
    right = min(right, dLo <= 0 ? -dLo : TAU - dLo, dHi <= 0 ? -dHi : TAU - dHi);
  }

  if(left > PI && right > PI) {
    // There is nothing preventing the turret from rotating freely,
    // call that a half in each direction instead of a whole turn in each.
    return { left: PI, right: PI };
  }

  return {left, right};
}

/**
 * Why a blueprint could not be built, or null if it can.
 *
 * Note what this does *not* ask: that the layout hold together. A module
 * floating clear of every other one passes, contributes its mass, and flies
 * along in formation with the ship it is not attached to. Requiring
 * connectedness means first defining what joins two modules, which §4's
 * connectivity graph needs and no blueprint currently expresses — DESIGN.md
 * §12 records the shape of that answer.
 */
/** How deep assemblies may nest. Generous for a ship, and a stop for a cycle. */
const MAX_ASSEMBLY_DEPTH = 16;

/** How many copies one instance may place. A wing, not a city. */
export const MAX_REPEAT = 64;

/**
 * Ceiling on the modules a layout may expand to.
 *
 * The real defence, because `repeat` and nesting *multiply*: a per-instance cap
 * cannot see what its ancestors already asked for. Checked as modules are
 * produced rather than afterwards, so a runaway layout is refused rather than
 * built first and measured second.
 */
export const MAX_EXPANDED_MODULES = 1024;

/**
 * Fold an angle into (-pi, pi], and turn a negative zero into a positive one.
 *
 * Both halves matter for reasons that are entirely about floating point, and
 * both were found by the golden checksums rather than by reasoning. Mirroring
 * a module facing aft maps `PI` to `-PI`, and while those are the same
 * direction, `sin(-PI)` is `-1.2e-16` where `sin(PI)` is `+1.2e-16` — so an
 * aft thruster reflected onto the far beam would compile a hair differently
 * from its unreflected twin. And `-0` compares equal to `0` while having
 * different bits, which a checksum over raw doubles notices even though
 * nothing else does.
 */
function foldAngle(a: number): number {
  let r = normalizeAngle(a);
  if (r <= -PI) r += TAU;
  else if (r > PI) r -= TAU;
  return r === 0 ? 0 : r;
}

/**
 * Resolve a layout's assembly instances into the flat list of modules a ship
 * is actually built from.
 *
 * Everything downstream — mass, arcs, validation, the renderer — works on the
 * flat list, so assemblies are a way of *writing* a layout rather than a
 * property a compiled ship has. That is the whole reason they cost so little:
 * `ShipDesign` already is the resolved form, so this happens once, where
 * compilation already happens.
 *
 * A mirrored instance reflects across its own frame's x-axis: `y` and the
 * facing both negate. Reflecting rather than rotating is what makes a
 * starboard wing the *same* wing as the port one, so the two can never
 * disagree about anything but which side they are on.
 */
export function expandBlueprint(blueprint: Blueprint): ModuleSpec[] {
  const out: ModuleSpec[] = [];
  place(blueprint.modules, blueprint, 0, 0, 0, false, 0, out);
  return out;
}

function place(
  placements: readonly Placement[],
  blueprint: Blueprint,
  originX: number,
  originY: number,
  rotation: number,
  mirrored: boolean,
  depth: number,
  out: ModuleSpec[],
): void {
  if (depth > MAX_ASSEMBLY_DEPTH) {
    throw new Error(`${blueprint.name}: assemblies nested more than ${MAX_ASSEMBLY_DEPTH} deep`);
  }

  const c = cos(rotation);
  const s = sin(rotation);

  for (const placement of placements) {
    // Reflect first, then turn, then move: the assembly is built in its own
    // frame and that frame is what gets placed.
    const localY = mirrored ? -placement.y : placement.y;
    const x = originX + placement.x * c - localY * s;
    const y = originY + placement.x * s + localY * c;

    if (isInstance(placement)) {
      const assembly = blueprint.assemblies?.[placement.use];
      if (assembly === undefined) {
        throw new Error(`${blueprint.name}: no assembly named ${placement.use}`);
      }
      const own = placement.angle ?? 0;
      const turned = foldAngle(rotation + (mirrored ? -own : own));
      const flipped = mirrored !== (placement.mirror ?? false);

      const copies = placement.repeat ?? 1;
      if (copies > MAX_REPEAT) {
        throw new Error(`${blueprint.name}: ${placement.use} asks for ${copies} copies, more than ${MAX_REPEAT}`);
      }

      // The step advances in the *current copy's* frame, so each copy is
      // placed relative to the one before it rather than to the instance. With
      // a step angle that walks the row round an arc; with none it is a
      // straight line either way. Reflected along with everything else, so a
      // mirrored chain runs the other way — which is what makes the far wing
      // of a ship the same wing.
      let cx = x;
      let cy = y;
      let crot = turned;
      for (let copy = 0; copy < copies; copy++) {
        place(assembly.modules, blueprint, cx, cy, crot, flipped, depth + 1, out);
        // Extras come after what the assembly defines, in the same frame. The
        // ordering is worth noticing rather than assuming harmless: module
        // order decides thruster allocation and firing order, so moving a part
        // out of a definition and into an instance's extras moves it down the
        // list and changes the ship slightly, even though nothing about its
        // geometry has.
        if (placement.extra !== undefined) {
          place(placement.extra, blueprint, cx, cy, crot, flipped, depth + 1, out);
        }

        const step = placement.step;
        if (step === undefined || copy + 1 >= copies) continue;
        const sc = cos(crot);
        const ss = sin(crot);
        const stepY = flipped ? -step.y : step.y;
        const stepAngle = step.angle ?? 0;
        cx = cx + step.x * sc - stepY * ss;
        cy = cy + step.x * ss + stepY * sc;
        crot = foldAngle(crot + (flipped ? -stepAngle : stepAngle));
      }
      continue;
    }

    const spec: ModuleSpec = {
      kind: placement.kind,
      x,
      y,
      length: placement.length,
      width: placement.width,
    };
    const own = placement.angle ?? 0;
    const angle = foldAngle(rotation + (mirrored ? -own : own));
    if (angle !== 0 || placement.angle !== undefined) spec.angle = angle;
    if (placement.reinforcement !== undefined) spec.reinforcement = placement.reinforcement;
    if (placement.barrels !== undefined) spec.barrels = placement.barrels;
    if (placement.notes !== undefined) spec.notes = placement.notes;
    out.push(spec);
    if (out.length > MAX_EXPANDED_MODULES) {
      throw new Error(
        `${blueprint.name}: expands to more than ${MAX_EXPANDED_MODULES} modules`,
      );
    }
  }
}

/**
 * Every assembly name a layout refers to but does not define, and every cycle.
 *
 * Separated from `expandBlueprint`, which throws, because a layout being
 * edited passes through states where a reference dangles and the editor has to
 * keep drawing rather than fall over.
 */
export function assemblyProblem(blueprint: Blueprint): string | null {
  const path: string[] = [];

  function walk(placements: readonly Placement[]): string | null {
    for (const placement of placements) {
      if (!isInstance(placement)) continue;
      const assembly = blueprint.assemblies?.[placement.use];
      if (assembly === undefined) {
        return `${blueprint.name}: no assembly named ${placement.use}`;
      }
      if (path.includes(placement.use)) {
        return `${blueprint.name}: assembly ${placement.use} contains itself (${[...path, placement.use].join(' -> ')})`;
      }
      path.push(placement.use);
      const problem = walk(assembly.modules);
      path.pop();
      if (problem !== null) return problem;

      const repeat = placement.repeat;
      const step = placement.step;
      if (repeat !== undefined && (!Number.isInteger(repeat) || repeat < 1)) {
        return `${blueprint.name}: ${placement.use} repeat must be a whole number of at least 1, got ${repeat}`;
      }
      if (repeat !== undefined && repeat > MAX_REPEAT) {
        return `${blueprint.name}: ${placement.use} repeat must be at most ${MAX_REPEAT}, got ${repeat}`;
      }
      // Required together. A count with no step piles every copy on the same
      // spot, which the overlap rule would then reject with a complaint about
      // geometry rather than about the mistake actually made; a step with no
      // count silently does nothing at all.
      if ((repeat !== undefined && repeat > 1) !== (step !== undefined)) {
        return `${blueprint.name}: ${placement.use} needs repeat above 1 and step together, or neither`;
      }

      // Extras belong to the instance rather than to the assembly it places,
      // so they are walked at the enclosing path — an extra referring back to
      // the assembly that *contains* this instance is still a cycle, but one
      // referring to the assembly being placed here is not.
      if (placement.extra !== undefined) {
        const inExtra = walk(placement.extra);
        if (inExtra !== null) return inExtra;
      }
    }
    return null;
  }

  const problem = walk(blueprint.modules);
  if (problem !== null) return problem;

  // A layout that places nothing is a different complaint, made elsewhere.
  for (const [name, assembly] of Object.entries(blueprint.assemblies ?? {})) {
    if (assembly.modules.length === 0) return `${blueprint.name}: assembly ${name} is empty`;
  }
  return null;
}

/**
 * Is there structure immediately in front of this module, in its facing?
 *
 * Answered by nudging the module forward by the attachment tolerance and
 * asking whether it now overlaps — which reuses the separating-axis test and
 * so stays correct for a module mounted at any angle, rather than needing a
 * face-contact test of its own. A neighbour merely alongside is unaffected by
 * a forward nudge and correctly does not count, and nor does one touching only
 * at a corner.
 */
function structureAhead(spec: ModuleSpec, modules: readonly ModuleSpec[]): boolean {
  const angle = spec.angle ?? 0;
  const probe: ModuleSpec = {
    ...spec,
    x: spec.x + cos(angle) * ATTACHMENT_TOLERANCE,
    y: spec.y + sin(angle) * ATTACHMENT_TOLERANCE,
  };
  for (const other of modules) {
    if (other === spec) continue;
    if (other.kind !== 'structure') continue;
    if (modulesOverlap(probe, other)) return true;
  }
  return false;
}

export function blueprintProblem(blueprint: Blueprint): string | null {
  // Assemblies are resolved before anything else looks at the layout, so every
  // rule below is stated once, about the modules a ship is actually built
  // from — rather than once for a module and again for a copy of one.
  const structural = assemblyProblem(blueprint);
  if (structural !== null) return structural;

  const modules = expandBlueprint(blueprint);
  if (modules.length === 0) return `${blueprint.name}: a ship needs at least one module`;

  for (let i = 0; i < modules.length; i++) {
    const problem = moduleProblem(modules[i]!);
    if (problem !== null) return `${blueprint.name}, module ${i} — ${problem}`;
  }

  for (let i = 0; i < modules.length; i++) {
    for (let k = i + 1; k < modules.length; k++) {
      if (modulesOverlap(modules[i]!, modules[k]!)) {
        return `${blueprint.name}: modules ${i} and ${k} overlap`;
      }
    }
  }

  // An engine is bolted to the ship at the end it pushes from and exhausts out
  // of the other, so the face opposite the nozzle has to be against structure.
  // Turn one round and it is held on by its nozzle: the mounting is in the
  // exhaust and the thrust is being delivered to nothing.
  //
  // A layout is rejected for this rather than merely penalised, because it is a
  // question about how the ship is *assembled* and not about how well it runs —
  // the same kind of rule as modules not overlapping. How much a *blocked* but
  // correctly mounted nozzle should cost is a different and continuous
  // question, and ROADMAP.md §12 keeps it that way deliberately.
  for (let i = 0; i < modules.length; i++) {
    const spec = modules[i]!;
    if (spec.kind !== 'thruster') continue;
    if (!structureAhead(spec, modules)) {
      return (
        `${blueprint.name}: thruster ${i} at (${spec.x}, ${spec.y}) has no structure to push ` +
        `against — the face opposite its nozzle must be against a structure module`
      );
    }
  }

  return null;
}

/** Derive everything a ship built to this blueprint is. Throws if it could not be built. */
export function compileBlueprint(blueprint: Blueprint): ShipDesign {
  const problem = blueprintProblem(blueprint);
  if (problem !== null) throw new Error(`Invalid blueprint — ${problem}`);

  const specs = expandBlueprint(blueprint);
  const stats = specs.map(moduleStats);

  let mass = 0;
  let comX = 0;
  let comY = 0;
  for (let i = 0; i < specs.length; i++) {
    const m = stats[i]!.mass;
    mass += m;
    comX += specs[i]!.x * m;
    comY += specs[i]!.y * m;
  }
  comX /= mass;
  comY /= mass;

  const modules: DesignModule[] = [];
  const thrusters: ThrusterSpec[] = [];
  const turrets: DesignTurret[] = [];
  let inertia = 0;
  let radius = 0;
  const c: number[] = [];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const s = stats[i]!;
    const x = spec.x - comX;
    const y = spec.y - comY;
    const angle = normalizeAngle(spec.angle ?? 0);

    // Parallel axis: each module's own inertia, carried out to where it sits.
    inertia += s.inertia + s.mass * (x * x + y * y);

    corners(spec, c);
    for (let k = 0; k < 8; k += 2) {
      const dx = c[k]! - comX;
      const dy = c[k + 1]! - comY;
      radius = max(radius, sqrt(dx * dx + dy * dy));
    }

    modules.push({ spec, stats: s, x, y, angle });

    if (spec.kind === 'thruster') {
      thrusters.push({
        x,
        y,
        dirX: cos(angle),
        dirY: sin(angle),
        maxThrust: s.thrust,
      });
    } else if ((spec.kind === 'turret' || spec.kind == 'beamTurret') && s.gun !== null) {
      const gun = s.gun;
      // The breech sits at the middle of the mount and the barrel reaches out
      // from there, so the muzzle traces a circle of that radius as the gun
      // trains. Reach sets both what the barrel can foul and how fast the
      // mount may bring it round.
      const reach = gun.barrelLength;
      radius = max(radius, sqrt(x * x + y * y) + reach);

      const arc = firingArc(specs, i, reach);

      // One drive, so one figure: the rate limit is what this acceleration
      // reaches in the drive's spin-up time.
      const accel = traverseAccel(s.mass, s.inertia);

      turrets.push({
        module: i,
        mount: {
          x,
          y,
          restBearing: angle,
          leftArc: arc.left,
          rightArc: arc.right,
          maxRate: traverseRate(accel),
          maxAccel: accel,
          inertia: s.inertia,
          muzzleSpeed: gun.muzzleSpeed,
          muzzleOffset: gun.barrelLength,
        },
        gun,
      });
    }
  }

  return {
    name: blueprint.name,
    modules,
    mass,
    inertia,
    radius,
    centreOfMassX: comX,
    centreOfMassY: comY,
    thrusters,
    thrusterLayout: new ThrusterLayout(thrusters),
    turrets,
  };
}
