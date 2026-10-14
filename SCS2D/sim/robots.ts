import type { ShipDesign } from './blueprint.js';
import { joints } from './connectivity.js';
import { length } from './math.js';
import { ROBOT_CHARGE, ROBOT_LOAD, ROBOT_MASS, ROBOT_REFILL_TIME } from './modules.js';

/**
 * Robots that crawl a hull mending it (ROADMAP.md §8, repair stage 3).
 *
 * A robot is not a body: it is a place on its hull, moving module to module
 * across the welds the hull was built with, and across a seam only onto
 * wreckage it is taking apart. It sets out
 * from its bay with an allowance of metal and charge, works until either runs
 * out, and comes home to be refilled. What it does with them is `Ships`'s;
 * this holds where each robot is and how it gets about.
 */

/** How many numbers a snapshot gives each robot: x, y, heading, and the shares of its charge and metal left. */
export const ROBOT_VIEW_STRIDE = 5;

export const enum RobotMode {
  /** In its bay, being refilled or waiting for work. */
  Berthed = 0,
  /** Crawling to the module it is to mend. */
  Out = 1,
  /** On that module, mending it. */
  Working = 2,
  /** Crawling back to its bay. */
  Home = 3,
}

export interface Robot {
  /** The bay it berths in, by module of its body's design. */
  bay: number;
  /** The module it is on, or last left. */
  at: number;
  mode: RobotMode;
  /** The module it is going to mend, or build against, or -1. */
  target: number;
  /** The module of its ship's launch design it is to start building against `target`, or -1. */
  build: number;
  /** Whether `target` is wreckage it is taking apart rather than its own hull. */
  strip: boolean;
  /** Metal it has taken off wreckage and is carrying home to its bay's holds, kg. */
  cargo: number;
  /** Modules it will cross, from `at`, and how far along the leg from `path[leg]` to the next it is, m. */
  path: Int32Array | null;
  leg: number;
  along: number;
  /** What it may still spend before it must go home: metal, kg, and charge, J. */
  metal: number;
  charge: number;
  /** Seconds of refilling left while berthed. */
  refill: number;
  /** The damage version of its body when it last found nothing to mend, or -1. */
  idleAt: number;
  /**
   * The module it stood on last step, and how much of that module was left:
   * a module destroyed under it takes it with it, where one it reaches already
   * destroyed does not.
   */
  stood: number;
  stoodOn: number;
}

/** Where to go next across a design's welds, and its seams: each module's neighbours, and the distances to them. */
interface Graph {
  readonly next: readonly (readonly number[])[];
  readonly far: readonly (readonly number[])[];
  readonly seamNext: readonly (readonly number[])[];
  readonly seamFar: readonly (readonly number[])[];
}

const graphs = new WeakMap<ShipDesign, Graph>();

function graphOf(design: ShipDesign): Graph {
  const known = graphs.get(design);
  if (known !== undefined) return known;
  const next: number[][] = design.modules.map(() => []);
  const far: number[][] = design.modules.map(() => []);
  const seamNext: number[][] = design.modules.map(() => []);
  const seamFar: number[][] = design.modules.map(() => []);
  for (const joint of joints(design)) {
    const a = design.modules[joint.a]!;
    const b = design.modules[joint.b]!;
    const d = length(a.x - b.x, a.y - b.y);
    const to = joint.seam === true ? seamNext : next;
    const by = joint.seam === true ? seamFar : far;
    to[joint.a]!.push(joint.b);
    by[joint.a]!.push(d);
    to[joint.b]!.push(joint.a);
    by[joint.b]!.push(d);
  }
  const graph = { next, far, seamNext, seamFar };
  graphs.set(design, graph);
  return graph;
}

/**
 * Distances over the welds from module `from` to every module, and the module
 * each is reached from, into `dist` and `prev` (sized to the design). Modules
 * `crosses` refuses are not walked through, and a seam is crossed only where
 * `seam` allows it. Unreachable is Infinity.
 */
export function walk(
  design: ShipDesign,
  from: number,
  dist: Float64Array,
  prev: Int32Array,
  crosses: (m: number) => boolean,
  seam: (a: number, b: number) => boolean = never,
): void {
  const n = design.modules.length;
  const { next, far, seamNext, seamFar } = graphOf(design);
  dist.fill(Infinity, 0, n);
  prev.fill(-1, 0, n);
  const done = new Uint8Array(n);
  dist[from] = 0;
  // A hull is a few hundred modules at most, so a plain scan for the nearest beats a heap.
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let m = 0; m < n; m++) {
      if (done[m] === 0 && dist[m]! < best) {
        best = dist[m]!;
        u = m;
      }
    }
    if (u < 0) return;
    done[u] = 1;
    if (u !== from && !crosses(u)) continue;
    const to = next[u]!;
    const d = far[u]!;
    for (let k = 0; k < to.length; k++) {
      const v = to[k]!;
      const via = best + d[k]!;
      if (via < dist[v]!) {
        dist[v] = via;
        prev[v] = u;
      }
    }
    const over = seamNext[u]!;
    const across = seamFar[u]!;
    for (let k = 0; k < over.length; k++) {
      const v = over[k]!;
      const via = best + across[k]!;
      if (via < dist[v]! && seam(u, v)) {
        dist[v] = via;
        prev[v] = u;
      }
    }
  }
}

const never = (): boolean => false;

/** Each module's neighbours across every joint, seams included. */
const linked = new WeakMap<ShipDesign, readonly (readonly number[])[]>();

function linksOf(design: ShipDesign): readonly (readonly number[])[] {
  const known = linked.get(design);
  if (known !== undefined) return known;
  const links: number[][] = design.modules.map(() => []);
  for (const joint of joints(design)) {
    links[joint.a]!.push(joint.b);
    links[joint.b]!.push(joint.a);
  }
  linked.set(design, links);
  return links;
}

/** Whether the rest of a hull still holds together with module `m` gone. */
export function staysWhole(design: ShipDesign, m: number): boolean {
  const n = design.modules.length;
  if (n < 2) return false;
  const links = linksOf(design);
  const seen = new Uint8Array(n);
  const start = m === 0 ? 1 : 0;
  const queue = [start];
  seen[start] = 1;
  seen[m] = 1;
  let reached = 1;
  while (queue.length > 0) {
    const u = queue.pop()!;
    for (const v of links[u]!) {
      if (seen[v] === 1) continue;
      seen[v] = 1;
      reached++;
      queue.push(v);
    }
  }
  return reached === n - 1;
}

/** A module joined to `m`, the first of them; `m` itself if none is. */
export function neighbourOf(design: ShipDesign, m: number): number {
  return linksOf(design)[m]![0] ?? m;
}

/** The modules from `walk`'s start to `to`, both ends included, or null if it is unreachable. */
export function pathTo(prev: Int32Array, dist: Float64Array, to: number): Int32Array | null {
  if (!Number.isFinite(dist[to]!)) return null;
  let count = 1;
  for (let m = to; prev[m]! >= 0; m = prev[m]!) count++;
  const path = new Int32Array(count);
  let k = count - 1;
  for (let m = to; m >= 0; m = prev[m]!) path[k--] = m;
  return path;
}

/** The length of the leg out of `path[leg]`, m. */
export function legLength(design: ShipDesign, path: Int32Array, leg: number): number {
  const a = design.modules[path[leg]!]!;
  const b = design.modules[path[leg + 1]!]!;
  return length(a.x - b.x, a.y - b.y);
}

/** Every body's robots, by body index, and what each body's bays are building. */
export class Robots {
  private readonly of: (Robot[] | null)[] = [];
  private readonly designs: (ShipDesign | null)[] = [];
  /** Seconds each bay has put into the robot it is building, by module. */
  private readonly builds: (Float64Array | null)[] = [];
  /** The mass of the robots each body's bays are short of, kg, and its moment of inertia, kg·m². */
  private readonly missing: number[] = [];
  private readonly missingSpin: number[] = [];

  /**
   * A hull's robots: those `carried` over to it, or for a fresh one every bay
   * full, every robot berthed and ready; and how far each bay was through
   * building one (`built`, by module), which a remade hull keeps.
   */
  register(bodyIndex: number, design: ShipDesign, carried?: Robot[], built?: (module: number) => number): void {
    let robots: Robot[];
    if (carried !== undefined) {
      robots = carried;
    } else {
      robots = [];
      for (let m = 0; m < design.modules.length; m++) {
        const count = design.modules[m]!.stats.robots;
        for (let r = 0; r < count; r++) robots.push(stocked(m));
      }
    }
    let berths = 0;
    let missing = 0;
    let missingSpin = 0;
    for (let m = 0; m < design.modules.length; m++) {
      const count = design.modules[m]!.stats.robots;
      if (!(count > 0)) continue;
      berths += count;
      let home = 0;
      for (const robot of robots) if (robot.bay === m) home++;
      missing += (count - home) * ROBOT_MASS;
      missingSpin += (count - home) * ROBOT_MASS * spinOf(design, m);
    }
    // A hull with bays keeps a list, empty or not, so a bay that has lost every robot still builds.
    this.of[bodyIndex] = berths > 0 || robots.length > 0 ? robots : null;
    this.designs[bodyIndex] = design;
    const builds = berths > 0 ? new Float64Array(design.modules.length) : null;
    if (builds !== null && built !== undefined) for (let m = 0; m < builds.length; m++) builds[m] = built(m);
    this.builds[bodyIndex] = builds;
    this.missing[bodyIndex] = missing;
    this.missingSpin[bodyIndex] = missingSpin;
  }

  /** A body's robots, or null for a body with no bays and none aboard. */
  on(bodyIndex: number): Robot[] | null {
    return this.of[bodyIndex] ?? null;
  }

  /** Seconds each of a body's bays has put into the robot it is building, by module, or null for none. */
  buildsOn(bodyIndex: number): Float64Array | null {
    return this.builds[bodyIndex] ?? null;
  }

  /** What the robots a body's bays are short of weigh, kg. */
  missingMass(bodyIndex: number): number {
    return this.missing[bodyIndex] ?? 0;
  }

  /** Metal a body's robots are carrying home, kg: the body's until it is put in its holds. */
  cargoMass(bodyIndex: number): number {
    let kg = 0;
    for (const robot of this.of[bodyIndex] ?? []) kg += robot.cargo;
    return kg;
  }

  /** What they would add to the body's moment of inertia, kg·m². */
  missingInertia(bodyIndex: number): number {
    return this.missingSpin[bodyIndex] ?? 0;
  }

  /** Lose robot `r` of a body: its bay is a robot short. */
  lose(bodyIndex: number, r: number): void {
    const robots = this.of[bodyIndex];
    const design = this.designs[bodyIndex];
    if (!robots || !design) return;
    const robot = robots[r]!;
    robots.splice(r, 1);
    this.missing[bodyIndex] = (this.missing[bodyIndex] ?? 0) + ROBOT_MASS;
    this.missingSpin[bodyIndex] = (this.missingSpin[bodyIndex] ?? 0) + ROBOT_MASS * spinOf(design, robot.bay);
  }

  /** A new robot in bay `bay` of a body, empty until the bay has filled it. */
  build(bodyIndex: number, bay: number): void {
    const robots = this.of[bodyIndex];
    const design = this.designs[bodyIndex];
    if (!robots || !design) return;
    robots.push(empty(bay));
    this.missing[bodyIndex] = (this.missing[bodyIndex] ?? 0) - ROBOT_MASS;
    this.missingSpin[bodyIndex] = (this.missingSpin[bodyIndex] ?? 0) - ROBOT_MASS * spinOf(design, bay);
  }

  /**
   * The robots that go with a remade hull, renumbered by `moduleOf`, which
   * gives a module of the old body's design its index in the new one, or -1.
   * Only one whose bay and whose module both come over goes: it can still get
   * home. Taken from the old body, so a piece cut off takes its robots with it.
   * Anything it was walking is forgotten, and it makes for home afresh.
   */
  take(bodyIndex: number, moduleOf: (module: number) => number): Robot[] {
    const robots = this.of[bodyIndex];
    const out: Robot[] = [];
    if (robots === null || robots === undefined) return out;
    const left: Robot[] = [];
    for (const robot of robots) {
      const bay = moduleOf(robot.bay);
      const at = moduleOf(robot.at);
      if (bay < 0 || at < 0) {
        left.push(robot);
        continue;
      }
      robot.bay = bay;
      robot.at = at;
      robot.target = -1;
      robot.build = -1;
      robot.strip = false;
      robot.idleAt = -1;
      robot.stoodOn = -1;
      robot.path = null;
      robot.leg = 0;
      robot.along = 0;
      if (robot.mode !== RobotMode.Berthed) robot.mode = at === bay ? RobotMode.Berthed : RobotMode.Home;
      out.push(robot);
    }
    this.of[bodyIndex] = left;
    return out;
  }

  forget(bodyIndex: number): void {
    this.of[bodyIndex] = null;
    this.designs[bodyIndex] = null;
    this.builds[bodyIndex] = null;
    this.missing[bodyIndex] = 0;
    this.missingSpin[bodyIndex] = 0;
  }
}

/** Moment about the centre of mass per kilogram at module `m`, m². */
function spinOf(design: ShipDesign, m: number): number {
  const module = design.modules[m]!;
  const { length, width } = module.spec;
  return (length * length + width * width) / 12 + module.x * module.x + module.y * module.y;
}

/** A robot in its bay, set out stocked as a ship sets out with its stores full. */
function stocked(bay: number): Robot {
  return {
    bay,
    at: bay,
    mode: RobotMode.Berthed,
    target: -1,
    build: -1,
    strip: false,
    cargo: 0,
    path: null,
    leg: 0,
    along: 0,
    metal: ROBOT_LOAD,
    charge: ROBOT_CHARGE,
    refill: 0,
    idleAt: -1,
    stood: 1,
    stoodOn: -1,
  };
}

/** A robot just built: empty, and to be refilled before it goes anywhere. */
function empty(bay: number): Robot {
  return { ...stocked(bay), metal: 0, charge: 0, refill: ROBOT_REFILL_TIME };
}
