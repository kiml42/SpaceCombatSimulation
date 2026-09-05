import type { Bodies } from './bodies.js';
import type { ShipDesign } from './blueprint.js';
import type { WellSpec } from './gravity.js';
import type { Projectiles } from './projectiles.js';
import type { Ships } from './ships.js';
import type { Turrets } from './turrets.js';
import type { World } from './world.js';

/**
 * A read-only picture of the world, for anything outside the simulation to
 * draw or report on.
 *
 * This is the "snapshots out" half of the contract (DESIGN.md non-negotiable
 * 6). A renderer given the live stores could read anything, hold an index
 * across a step, or — worst — write to them; given a snapshot it can do none of
 * those. The boundary is what lets the simulation run in a worker later
 * without the renderer noticing.
 *
 * **Filled into caller-owned arrays, not allocated per frame.** A snapshot is
 * taken as often as something looks at it, which for a viewer is every frame.
 * `capture` grows the buffers when it must and otherwise reuses them, so a
 * steady-state frame allocates nothing (non-negotiable 4).
 *
 * Geometry is *not* copied. A design's module layout is fixed for the life of
 * the design, so a snapshot carries a reference to the design and the body
 * pose to draw it at; a renderer transforms the modules itself. Copying the
 * layout every frame would be copying a constant.
 */

/** One ship: which design to draw, where it is, and how its turrets are trained. */
export interface ShipView {
  design: ShipDesign;
  team: number;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  /** World bearing of each turret, in the design's turret order. */
  turretBearings: number[];
  /** Which of those turrets are on target and clear to shoot. */
  turretReady: boolean[];
  /** Throttle held by each thruster, 0 to 1, in the design's thruster order. */
  throttles: number[];
}

export class Snapshot {
  /** Steps elapsed, and simulated seconds. */
  tick = 0;
  time = 0;

  /**
   * Wells acting on the battle. Held by reference rather than copied: a well
   * does not move, and a renderer that cannot show why trajectories bend is
   * showing a bug rather than a battle.
   */
  wells: readonly WellSpec[] = [];

  ships: ShipView[] = [];
  shipCount = 0;

  /** Rounds in flight, as flat pairs so a renderer can loop without objects. */
  projectileX = new Float64Array(0);
  projectileY = new Float64Array(0);
  projectileVx = new Float64Array(0);
  projectileVy = new Float64Array(0);
  projectileCount = 0;

  /**
   * Bounding box of the *ships*, for a camera to frame.
   *
   * Only the ships. Wells are drawn but not framed: a well matters to the eye
   * while the ships are on opposite sides of it, and once they are past it,
   * holding it in shot only pushes the fight away. Projectiles are excluded
   * for a harder reason — a round that misses flies on until it expires,
   * kilometres past anything anyone is looking at, and a camera that followed
   * it would zoom out for a shot nobody cares about, shrinking the battle to a
   * few pixels exactly when it got interesting.
   */
  minX = 0;
  minY = 0;
  maxX = 0;
  maxY = 0;
}

function growProjectiles(snapshot: Snapshot, needed: number): void {
  if (snapshot.projectileX.length >= needed) return;
  const size = needed * 2;
  snapshot.projectileX = new Float64Array(size);
  snapshot.projectileY = new Float64Array(size);
  snapshot.projectileVx = new Float64Array(size);
  snapshot.projectileVy = new Float64Array(size);
}

function shipView(snapshot: Snapshot, i: number): ShipView {
  const existing = snapshot.ships[i];
  if (existing !== undefined) return existing;
  const created: ShipView = {
    design: null as unknown as ShipDesign,
    team: 0,
    x: 0,
    y: 0,
    angle: 0,
    vx: 0,
    vy: 0,
    turretBearings: [],
    turretReady: [],
    throttles: [],
  };
  snapshot.ships[i] = created;
  return created;
}

/** Take a picture of the world into `out`, reusing its buffers. */
export function capture(
  out: Snapshot,
  world: World,
  ships: Ships,
  projectiles: Projectiles,
  wells: readonly WellSpec[] = [],
): Snapshot {
  const bodies: Bodies = world.bodies;
  const turrets: Turrets = ships.turrets;

  out.tick = world.tick;
  out.time = world.tick * world.dt;
  out.wells = wells;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  let n = 0;
  for (let i = 0; i < ships.highWater; i++) {
    if (!ships.isAlive(i)) continue;
    const b = bodies.indexOf(ships.body(i));
    if (b < 0) continue;

    const design = ships.design(i);
    const view = shipView(out, n++);
    view.design = design;
    view.team = ships.teamOf(i);
    view.x = bodies.x[b]!;
    view.y = bodies.y[b]!;
    view.angle = bodies.angle[b]!;
    view.vx = bodies.vx[b]!;
    view.vy = bodies.vy[b]!;

    view.turretBearings.length = design.turrets.length;
    view.turretReady.length = design.turrets.length;
    for (let t = 0; t < design.turrets.length; t++) {
      const ti = ships.turretIndexOf(i, t);
      view.turretBearings[t] = turrets.worldBearing(bodies, ti);
      view.turretReady[t] = turrets.readyToFire(ti);
    }

    view.throttles.length = design.thrusters.length;
    for (let t = 0; t < design.thrusters.length; t++) {
      view.throttles[t] = ships.throttleOf(i, t);
    }

    const r = design.radius;
    if (view.x - r < minX) minX = view.x - r;
    if (view.y - r < minY) minY = view.y - r;
    if (view.x + r > maxX) maxX = view.x + r;
    if (view.y + r > maxY) maxY = view.y + r;
  }
  out.shipCount = n;

  growProjectiles(out, projectiles.count);
  let p = 0;
  for (let i = 0; i < projectiles.highWater; i++) {
    if (projectiles.alive[i] === 0) continue;
    out.projectileX[p] = projectiles.x[i]!;
    out.projectileY[p] = projectiles.y[i]!;
    out.projectileVx[p] = projectiles.vx[i]!;
    out.projectileVy[p] = projectiles.vy[i]!;
    p++;
  }
  out.projectileCount = p;

  if (n === 0) {
    minX = minY = maxX = maxY = 0;
  }
  out.minX = minX;
  out.minY = minY;
  out.maxX = maxX;
  out.maxY = maxY;

  return out;
}
