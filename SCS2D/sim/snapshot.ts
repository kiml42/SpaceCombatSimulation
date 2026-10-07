import type { Bodies } from './bodies.js';
import type { ShipDesign } from './blueprint.js';
import type { WellSpec } from './gravity.js';
import { NOT_INSIDE, type Projectiles } from './projectiles.js';
import type { Beams } from './beams.js';
import type { ImpactLog } from './damage.js';
import type { Ships } from './ships.js';
import type { Turrets } from './turrets.js';
import type { World } from './world.js';
import { cos, sin } from './math.js';

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
  /**
   * Which body it is — how a flash finds the hull it went off against a frame
   * or two later, when the ships have moved and the list may have changed.
   */
  body: number;
  team: number;
  /** Which of its side's ships it is, from one; zero for a ship with no such count, as in an editor. */
  serial: number;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  /** World bearing of each turret, in the design's turret order. */
  turretBearings: number[];
  /** Which of those turrets are on target and clear to shoot. */
  turretReady: boolean[];
  /**
   * Where each turret will fire: the world bearing it is aiming along, how far
   * off that it will pull the trigger (radians), and how far it is worth
   * shooting at what it is aiming at (metres; 0 for nothing). Optional, so a
   * view built by hand can leave them out.
   */
  turretAim?: number[];
  turretTrigger?: number[];
  turretTriggerReach?: number[];
  /** Which turrets are pointing into their own ship, where they will not fire. */
  turretFouled?: boolean[];
  /**
   * How full each gun is, 0 to 1 (`Ships.loadOf`), and whether it is
   * reloading rather than ready or firing. Optional, as the aim is.
   */
  turretLoad?: number[];
  turretReloading?: boolean[];
  /**
   * The band of ranges its doctrine closes to, centre to centre, against the
   * enemy it prefers, metres. Only a preview sets it.
   */
  holdMin?: number;
  holdMax?: number;
  /** Throttle held by each engine, 0 to 1, in the design's engine order. */
  throttles: number[];
  /**
   * How far along each of an engine's flames it will fire on what it finds,
   * metres (0 unless it is a weapon), and whether it is firing now. Optional,
   * as the turrets' are.
   */
  engineTriggerReach?: number[];
  engineFiring?: boolean[];
  /**
   * How much of each flame ray landed on a hull last step, as that ray's
   * share of its power — 0 where it met nothing. Every engine's rays in
   * turn, three per nozzle, starting where `plumeRayStarts` says.
   */
  landed: number[];
  /**
   * How much of each module is left, 1 untouched and 0 spent, in the design's
   * module order. A spent module is still there and still stops shells — it is
   * drawn as wreckage rather than not drawn.
   */
  integrity: number[];
  /** How full each module is of fuel, 0 to 1, and 1 for one that holds none. */
  fuel?: number[];
  /**
   * Holes fuel is leaking from, body frame: where each is, the way the fuel
   * leaves, how wide the hole is, and how fast it is going out, kg/s. On the
   * first ship riding a body only, so a hull's leaks are drawn once.
   */
  leakX?: number[];
  leakY?: number[];
  leakDirX?: number[];
  leakDirY?: number[];
  leakWidth?: number[];
  leakRate?: number[];
  /**
   * Whether the ship still has a core with control in it (§4).
   *
   * **This, and not whether the ship can fight, is what the view asks.** A
   * hull with a sound core and nothing else is a ship — it can be pushed, it
   * can be run into, it is somebody's, and in a race it is a competitor — so
   * a camera that framed only what could shoot or move would leave a whole
   * generation of engineless craft out of shot and draw them as wreckage. A
   * ship that *can* neither move nor shoot is still a mission kill and still
   * worth scoring as one; that is `Ships.isDisabled`, a question about the
   * fight rather than about the picture.
   */
  hasControl: boolean;
  /**
   * Whether this is a piece of a ship rather than a ship: no working core, no
   * pilot, no guns. What a renderer uses to keep the arrowhead icon (§ icons)
   * standing for ships that are still flown, not for the wreckage they shed.
   */
  isDerelict: boolean;
  /**
   * Which of its mounts are out, in the design's turret order. Read from the
   * gunnery rather than worked out from `integrity`, so that a gun drawn as
   * able to shoot is one that can.
   */
  turretDisabled: boolean[];
  /**
   * Which modules this view draws, in module order; absent or empty for all.
   * Two ships hooked together share a body and a design, and each draws only
   * its own side — in its own colours — so nothing is drawn twice.
   */
  drawn?: boolean[];
  /** The side each module came from, in module order; absent or empty for all `team`'s. */
  sides?: number[];
}

export class Snapshot {
  /** Steps elapsed, and simulated seconds. */
  tick = 0;
  time = 0;
  /** Seconds a step of the battle lasts: what a frame is exposed for. */
  dt = 0;

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
  projectileWidth = new Float64Array(0);
  /** 1 for a round passing through a hull, 0 for one in open flight. */
  projectileInside = new Uint8Array(0);
  /** The side whose ship fired it, or -1 where that ship is gone. */
  projectileTeam = new Int16Array(0);
  projectileCount = 0;

  /** Beams in flight, as flat pairs so a renderer can loop without objects. */
  beamStartX = new Float64Array(0);
  beamStartY = new Float64Array(0);
  beamEndX = new Float64Array(0);
  beamEndY = new Float64Array(0);
  beamWidth = new Float64Array(0);
  beamPower = new Float64Array(0);
  /** The side whose ship fired it, or -1 where that ship is gone. */
  beamTeam = new Int16Array(0);
  beamCount = 0;

  /** Each body's side while a picture is taken, so a shot can be told whose it is. */
  private bodyTeam = new Int16Array(0);

  /** Every body's side, -1 for none, sized for `bodies`; filled by `capture`. */
  teamsByBody(bodies: number): Int16Array {
    if (this.bodyTeam.length < bodies) this.bodyTeam = new Int16Array(bodies * 2);
    this.bodyTeam.fill(-1);
    return this.bodyTeam;
  }

  /**
   * Impacts since the last picture: where a hit landed and what it was worth.
   *
   * Drained from the log rather than sampled, because a frame may cover
   * several steps and a hit that happened in the middle of one is still a hit
   * somebody should see.
   */
  impactX = new Float64Array(0);
  impactY = new Float64Array(0);
  impactEnergy = new Float64Array(0);
  impactKind = new Uint8Array(0);
  /** The body each landed on, and where on it, so a flash rides the hull. */
  impactBody = new Int32Array(0);
  impactLocalX = new Float64Array(0);
  impactLocalY = new Float64Array(0);
  impactVx = new Float64Array(0);
  impactVy = new Float64Array(0);
  impactGrowth = new Float64Array(0);
  impactCount = 0;

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
  snapshot.projectileWidth = new Float64Array(size);
  snapshot.projectileInside = new Uint8Array(size);
  snapshot.projectileTeam = new Int16Array(size);
}

function growBeams(snapshot: Snapshot, needed: number): void {
  if (snapshot.beamStartX.length >= needed) return;
  const size = needed * 2;
  snapshot.beamStartX = new Float64Array(size);
  snapshot.beamStartY = new Float64Array(size);
  snapshot.beamEndX = new Float64Array(size);
  snapshot.beamEndY = new Float64Array(size);
  snapshot.beamWidth = new Float64Array(size);
  snapshot.beamPower = new Float64Array(size);
  snapshot.beamTeam = new Int16Array(size);
}

function growImpacts(snapshot: Snapshot, needed: number): void {
  if (snapshot.impactX.length >= needed) return;
  const size = needed * 2;
  snapshot.impactX = new Float64Array(size);
  snapshot.impactY = new Float64Array(size);
  snapshot.impactEnergy = new Float64Array(size);
  snapshot.impactKind = new Uint8Array(size);
  snapshot.impactBody = new Int32Array(size);
  snapshot.impactLocalX = new Float64Array(size);
  snapshot.impactLocalY = new Float64Array(size);
  snapshot.impactVx = new Float64Array(size);
  snapshot.impactVy = new Float64Array(size);
  snapshot.impactGrowth = new Float64Array(size);
}

function shipView(snapshot: Snapshot, i: number): ShipView {
  const existing = snapshot.ships[i];
  if (existing !== undefined) return existing;
  const created: ShipView = {
    design: null as unknown as ShipDesign,
    body: -1,
    team: 0,
    serial: 0,
    x: 0,
    y: 0,
    angle: 0,
    vx: 0,
    vy: 0,
    turretBearings: [],
    turretReady: [],
    turretAim: [],
    turretTrigger: [],
    turretTriggerReach: [],
    turretFouled: [],
    turretLoad: [],
    turretReloading: [],
    throttles: [],
    engineTriggerReach: [],
    engineFiring: [],
    landed: [],
    integrity: [],
    hasControl: true,
    isDerelict: false,
    turretDisabled: [],
    drawn: [],
    sides: [],
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
  beams: Beams,
  wells: readonly WellSpec[] = [],
  impacts?: ImpactLog,
): Snapshot {
  const bodies: Bodies = world.bodies;
  const turrets: Turrets = ships.turrets;

  out.tick = world.tick;
  out.time = world.tick * world.dt;
  out.dt = world.dt;
  out.wells = wells;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  // A shot knows the body that fired it, and a body its ship's side. A body
  // two hooked enemies share is the first one's.
  const bodyTeam = out.teamsByBody(bodies.highWater);
  let n = 0;
  for (let i = 0; i < ships.highWater; i++) {
    if (!ships.isAlive(i)) continue;
    const b = bodies.indexOf(ships.body(i));
    if (b < 0) continue;
    if (bodyTeam[b] === -1) bodyTeam[b] = ships.teamOf(i);

    const design = ships.design(i);
    const view = shipView(out, n++);
    view.design = design;
    view.body = b;
    view.team = ships.teamOf(i);
    view.serial = ships.serialOf(i);
    view.x = bodies.x[b]!;
    view.y = bodies.y[b]!;
    view.angle = bodies.angle[b]!;
    view.vx = bodies.vx[b]!;
    view.vy = bodies.vy[b]!;
    view.hasControl = ships.hasControl(i);
    view.isDerelict = ships.isDerelict(i);

    view.turretBearings.length = design.turrets.length;
    view.turretReady.length = design.turrets.length;
    view.turretDisabled.length = design.turrets.length;
    const aim = (view.turretAim ??= []);
    const trigger = (view.turretTrigger ??= []);
    const triggerReach = (view.turretTriggerReach ??= []);
    const fouled = (view.turretFouled ??= []);
    const load = (view.turretLoad ??= []);
    const reloading = (view.turretReloading ??= []);
    aim.length = trigger.length = triggerReach.length = fouled.length = design.turrets.length;
    load.length = reloading.length = design.turrets.length;
    for (let t = 0; t < design.turrets.length; t++) {
      const ti = ships.turretIndexOf(i, t);
      view.turretBearings[t] = turrets.worldBearing(bodies, ti);
      view.turretReady[t] = turrets.readyToFire(ti);
      aim[t] = turrets.worldTrigger(bodies, ti);
      trigger[t] = turrets.triggerHalfAngle(ti);
      triggerReach[t] = ships.triggerReach(i, t);
      fouled[t] = turrets.fouled(ti);
      load[t] = ships.loadOf(i, t);
      reloading[t] = ships.isReloading(i, t);
      view.turretDisabled[t] = ships.isTurretDisabled(i, t);
    }

    view.throttles.length = design.engines.length;
    const engineReach = (view.engineTriggerReach ??= []);
    const engineFiring = (view.engineFiring ??= []);
    engineReach.length = engineFiring.length = design.engines.length;
    for (let t = 0; t < design.engines.length; t++) {
      view.throttles[t] = ships.throttleOf(i, t);
      engineReach[t] = ships.weaponReach(i, t);
      engineFiring[t] = ships.isEngineFiring(i, t);
    }

    const rays = ships.landedRays(i);
    view.landed.length = rays.length;
    for (let r = 0; r < rays.length; r++) view.landed[r] = rays[r]!;

    view.integrity.length = design.modules.length;
    for (let m = 0; m < design.modules.length; m++) {
      view.integrity[m] = ships.damage.integrity(b, m);
    }
    const fuel = (view.fuel ??= []);
    fuel.length = design.modules.length;
    for (let m = 0; m < design.modules.length; m++) {
      const full = design.modules[m]!.stats.fuel;
      fuel[m] = full > 0 ? ships.fuel.held(b, m) / full : 1;
    }
    const lx = (view.leakX ??= []);
    const ly = (view.leakY ??= []);
    const ldx = (view.leakDirX ??= []);
    const ldy = (view.leakDirY ??= []);
    const lw = (view.leakWidth ??= []);
    const lr = (view.leakRate ??= []);
    lx.length = ly.length = ldx.length = ldy.length = lw.length = lr.length = 0;
    if (ships.ownsBody(i)) {
      for (const leak of ships.fuel.leaksOf(b)) {
        if (!(leak.rate > 0)) continue;
        const m = design.modules[leak.module];
        if (m === undefined) continue;
        const c = cos(m.angle);
        const s = sin(m.angle);
        lx.push(m.x + leak.x * c - leak.y * s);
        ly.push(m.y + leak.x * s + leak.y * c);
        ldx.push(leak.nx * c - leak.ny * s);
        ldy.push(leak.nx * s + leak.ny * c);
        lw.push(leak.width);
        lr.push(leak.rate);
      }
    }
    const drawn = (view.drawn ??= []);
    drawn.length = design.modules.length;
    for (let m = 0; m < design.modules.length; m++) drawn[m] = ships.draws(i, m);
    const sides = (view.sides ??= []);
    sides.length = design.modules.length;
    for (let m = 0; m < design.modules.length; m++) sides[m] = ships.moduleSide(i, m);

    // Only the ships still under control are framed: a camera that kept
    // wreckage in shot would pull away from the battle to hold on it.
    if (view.hasControl) {
      const r = design.radius;
      if (view.x - r < minX) minX = view.x - r;
      if (view.y - r < minY) minY = view.y - r;
      if (view.x + r > maxX) maxX = view.x + r;
      if (view.y + r > maxY) maxY = view.y + r;
    }
  }
  out.shipCount = n;

  // Unless every one of them is wreckage, in which case the wreckage is the
  // battle and framing nothing would leave the camera with infinite bounds.
  if (n > 0 && minX === Infinity) {
    for (let i = 0; i < n; i++) {
      const view = out.ships[i]!;
      const r = view.design.radius;
      if (view.x - r < minX) minX = view.x - r;
      if (view.y - r < minY) minY = view.y - r;
      if (view.x + r > maxX) maxX = view.x + r;
      if (view.y + r > maxY) maxY = view.y + r;
    }
  }

  growProjectiles(out, projectiles.count);
  let p = 0;
  for (let i = 0; i < projectiles.highWater; i++) {
    if (projectiles.alive[i] === 0) continue;
    out.projectileX[p] = projectiles.x[i]!;
    out.projectileY[p] = projectiles.y[i]!;
    out.projectileVx[p] = projectiles.vx[i]!;
    out.projectileVy[p] = projectiles.vy[i]!;
    out.projectileWidth[p] = projectiles.width[i]!;
    out.projectileInside[p] = projectiles.inside[i] === NOT_INSIDE ? 0 : 1;
    out.projectileTeam[p] = bodyTeam[projectiles.owner[i]!] ?? -1;
    p++;
  }
  out.projectileCount = p;

  growBeams(out, beams.count)
  let b = 0;
  for (let i = 0; i < beams.highWater; i++) {
    if (beams.alive[i] === 0) continue;
    out.beamStartX[b] = beams.startX[i]!;
    out.beamStartY[b] = beams.startY[i]!;
    out.beamEndX[b] = beams.endX[i]!;
    out.beamEndY[b] = beams.endY[i]!;
    out.beamWidth[b] = beams.width[i]!;
    out.beamPower[b] = beams.power[i]!;
    out.beamTeam[b] = bodyTeam[beams.owner[i]!] ?? -1;
    b++;
  }
  out.beamCount = b;

  // Drained, not copied: every impact is shown once, whatever the frame rate.
  out.impactCount = 0;
  if (impacts !== undefined) {
    growImpacts(out, impacts.count);
    for (let i = 0; i < impacts.count; i++) {
      out.impactX[i] = impacts.x[i]!;
      out.impactY[i] = impacts.y[i]!;
      out.impactEnergy[i] = impacts.energy[i]!;
      out.impactKind[i] = impacts.kind[i]!;
      out.impactBody[i] = impacts.body[i]!;
      out.impactLocalX[i] = impacts.localX[i]!;
      out.impactLocalY[i] = impacts.localY[i]!;
      out.impactVx[i] = impacts.vx[i]!;
      out.impactVy[i] = impacts.vy[i]!;
      out.impactGrowth[i] = impacts.growth[i]!;
    }
    out.impactCount = impacts.count;
    impacts.clear();
  }

  if (n === 0) {
    minX = minY = maxX = maxY = 0;
  }
  out.minX = minX;
  out.minY = minY;
  out.maxX = maxX;
  out.maxY = maxY;

  return out;
}
