import type { ShipDesign } from './blueprint.js';
import { joints } from './connectivity.js';
import { length } from './math.js';
import { ROBOT_CHARGE, ROBOT_LOAD } from './modules.js';

/**
 * Robots that crawl a hull mending it (ROADMAP.md §8, repair stage 3).
 *
 * A robot is not a body: it is a place on its hull, moving module to module
 * across the welds the hull was built with, never across a seam. It sets out
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
  /** The module it is going to mend, or -1. */
  target: number;
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
}

/** Where to go next across a design's welds: each module's neighbours, and the distances to them. */
interface Graph {
  readonly next: readonly (readonly number[])[];
  readonly far: readonly (readonly number[])[];
}

const graphs = new WeakMap<ShipDesign, Graph>();

function graphOf(design: ShipDesign): Graph {
  const known = graphs.get(design);
  if (known !== undefined) return known;
  const next: number[][] = design.modules.map(() => []);
  const far: number[][] = design.modules.map(() => []);
  for (const joint of joints(design)) {
    if (joint.seam === true) continue;
    const a = design.modules[joint.a]!;
    const b = design.modules[joint.b]!;
    const d = length(a.x - b.x, a.y - b.y);
    next[joint.a]!.push(joint.b);
    far[joint.a]!.push(d);
    next[joint.b]!.push(joint.a);
    far[joint.b]!.push(d);
  }
  const graph = { next, far };
  graphs.set(design, graph);
  return graph;
}

/**
 * Distances over the welds from module `from` to every module, and the module
 * each is reached from, into `dist` and `prev` (sized to the design). Modules
 * `crosses` refuses are not walked through. Unreachable is Infinity.
 */
export function walk(design: ShipDesign, from: number, dist: Float64Array, prev: Int32Array, crosses: (m: number) => boolean): void {
  const n = design.modules.length;
  const { next, far } = graphOf(design);
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
  }
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

/** Every body's robots, by body index. */
export class Robots {
  private readonly of: (Robot[] | null)[] = [];

  /** A fresh hull's robots: every bay full, every robot berthed and ready. */
  register(bodyIndex: number, design: ShipDesign, carried?: Robot[]): void {
    if (carried !== undefined) {
      this.of[bodyIndex] = carried.length > 0 ? carried : null;
      return;
    }
    const robots: Robot[] = [];
    for (let m = 0; m < design.modules.length; m++) {
      const count = design.modules[m]!.stats.robots;
      for (let r = 0; r < count; r++) robots.push(berthed(m));
    }
    this.of[bodyIndex] = robots.length > 0 ? robots : null;
  }

  /** A body's robots, or null for none. */
  on(bodyIndex: number): Robot[] | null {
    return this.of[bodyIndex] ?? null;
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
      robot.idleAt = -1;
      robot.path = null;
      robot.leg = 0;
      robot.along = 0;
      if (robot.mode !== RobotMode.Berthed) robot.mode = at === bay ? RobotMode.Berthed : RobotMode.Home;
      out.push(robot);
    }
    this.of[bodyIndex] = left.length > 0 ? left : null;
    return out;
  }

  forget(bodyIndex: number): void {
    this.of[bodyIndex] = null;
  }
}

/** A robot in its bay, set out stocked as a ship sets out with its stores full. */
function berthed(bay: number): Robot {
  return { bay, at: bay, mode: RobotMode.Berthed, target: -1, path: null, leg: 0, along: 0, metal: ROBOT_LOAD, charge: ROBOT_CHARGE, refill: 0, idleAt: -1 };
}
