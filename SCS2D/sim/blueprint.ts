import { abs, angleDelta, atan2, cos, max, min, normalizeAngle, PI, sin, sqrt } from './math.js';
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

export interface Blueprint {
  name: string;
  modules: readonly ModuleSpec[];
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
 * The half-width returned is symmetric about the mount's rest bearing, which
 * is what the traverse limit means, so a mount fouled on one side loses the
 * matching sector on the other. That is pessimistic, and deliberately so —
 * the honest fix is an asymmetric arc, which needs the turret store to carry
 * two limits rather than one.
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
): number {
  const mount = modules[index]!;
  const rest = normalizeAngle(mount.angle ?? 0);

  let halfWidth = PI;

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

    // Where that blocked interval sits relative to where the gun rests.
    const toLo = angleDelta(rest, centre + lo);
    const toHi = angleDelta(rest, centre + hi);

    // The rest bearing itself is inside the blocked interval: the gun is
    // buried, and there is no arc to have.
    if (toLo <= 0 && toHi >= 0) return 0;

    halfWidth = min(halfWidth, min(abs(toLo), abs(toHi)));
  }

  return halfWidth;
}

/** Why a blueprint could not be built, or null if it can. */
export function blueprintProblem(blueprint: Blueprint): string | null {
  const modules = blueprint.modules;
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

  return null;
}

/** Derive everything a ship built to this blueprint is. Throws if it could not be built. */
export function compileBlueprint(blueprint: Blueprint): ShipDesign {
  const problem = blueprintProblem(blueprint);
  if (problem !== null) throw new Error(`Invalid blueprint — ${problem}`);

  const specs = blueprint.modules;
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
    } else if (spec.kind === 'turret' && s.gun !== null) {
      const gun = s.gun;
      // The breech sits at the middle of the mount and the barrel reaches out
      // from there, so the muzzle traces a circle of that radius as the gun
      // trains. Reach sets both what the barrel can foul and how fast the
      // mount may bring it round.
      const reach = gun.barrelLength;
      radius = max(radius, sqrt(x * x + y * y) + reach);

      turrets.push({
        module: i,
        mount: {
          x,
          y,
          restBearing: angle,
          arc: firingArc(specs, i, reach),
          maxRate: traverseRate(reach),
          maxAccel: traverseAccel(s.mass, s.inertia),
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
