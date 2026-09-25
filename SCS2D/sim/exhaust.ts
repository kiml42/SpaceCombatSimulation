import type { Bodies } from './bodies.js';
import type { ShipDesign } from './blueprint.js';
import type { Damage } from './damage.js';
import { HullPath, modulesAlong, type Boxes, type Hulls } from './hull.js';
import { cos, sin, sqrt } from './math.js';
import {
  DECK_HEIGHT,
  nozzleOffset,
  THRUST_PER_EXIT_AREA,
  thrusterGeometry,
  type ThrusterGeometry,
} from './modules.js';
import { RayHit, type SpatialGrid } from './spatialGrid.js';

/**
 * What a rocket exhaust does to whatever is standing in it.
 *
 * A thruster produces its thrust whatever its nozzle is pointed at, so without
 * this a plume is scenery: an engine buried in its own hull flies exactly as
 * well as one in clear air and merely looks absurd. That is free thrust with
 * no penalty attached, which is the shape of exploit `modules.ts` warns about
 * — evolution would pack every layout tighter by firing its engines into
 * itself. Making the plume *bite* prices it, and prices it continuously — an
 * obstruction near the tip of the flame costs a little and one at the throat
 * costs everything — because a hard edge is one a mutation cannot cross, and
 * the search wants a gradient rather than a wall.
 *
 * It cuts both ways, which is the point. A plume is as dangerous to a ship
 * that gets behind one as to the ship carrying it, so where an engine points
 * is something a designer can aim and an attacker can be caught by.
 *
 * **A buried nozzle also costs thrust.** The flame is sampled by three rays
 * across the exit, and a ray that runs into the ship's own hull hands its
 * momentum back to the hull it was pushing — the push on the blocked module
 * and the thrust off the nozzle are the same newton-seconds with opposite
 * signs, so that third of the engine is not thrust at all. What is in the way
 * on its own ship is fixed geometry, so it is worked out once when the design
 * is compiled and lands on `ThrusterSpec.escaping`, which `ThrusterLayout`
 * flies the engine at.
 *
 * **The plume the simulation burns with is the plume the renderer draws** —
 * both take their length from `plumeReach`, and the renderer's opacity from
 * `plumeIntensity`, so what is on the screen is what is doing the damage.
 */

/**
 * How far a flame carries, in widths of the nozzle it leaves, when the throat
 * is fed at the pressure `THRUST_PER_EXIT_AREA` assumes and the bell is
 * perfect.
 *
 * **A jet runs a roughly fixed number of its own widths** before it has mixed
 * into the dark, so a bigger nozzle throws a longer flame and an engine scaled
 * up bodily reaches proportionally further. Machinery that feeds the throat
 * harder lengthens it in proportion, being more gas at higher pressure, and a
 * cluster of nozzles throws flames as short as each nozzle is narrow.
 *
 * Seventeen widths, so a choked two-metre nozzle through a good bell throws
 * the fifty-odd metres every full engine used to, and everything larger
 * throws further.
 */
export const PLUME_CORE_WIDTHS = 17;

/**
 * How much of an engine's power a plume delivers to what it plays on, watts
 * per newton of thrust.
 *
 * A balance dial rather than a derivation, in the same sense as
 * `DAMAGE_ENERGY_PER_KG`: a real exhaust carries some kilowatts of jet power
 * per newton and would destroy anything sitting in it far faster than a battle
 * lasts, and nearly all of that gas flows past rather than into what it hits.
 * What is wanted is a timescale a player can see and manoeuvre against, so
 * this is chosen for the timescale and not from the physics. At this figure a
 * full-throttle plume destroys a square structure module as wide as the
 * engine in four to seven seconds at the nozzle, or roughly twice that
 * halfway out, and in thirds as the rays land. ROADMAP.md §12 keeps it open
 * with the rest of the dials.
 */
export const PLUME_POWER_PER_NEWTON = 4;

/**
 * How much of its length a flame keeps for the shape of its bell, 0 to 1.
 *
 * Gas leaving a divergent nozzle is already flying apart, and a flame spreads
 * out of existence far faster than the thrust it has lost, so this is the
 * eighth power of `divergence`: a good bell keeps most of its flame, a short
 * one loses a third, and a bare throat sprays what it has sideways and throws
 * almost nothing. Steep enough that more bell on the same machinery is a
 * visibly longer flame, which is the collimation a longer nozzle buys.
 */
export function collimation(divergence: number): number {
  const d2 = divergence * divergence;
  const d4 = d2 * d2;
  return d4 * d4;
}

/**
 * How far a plume reaches along its axis, metres. Zero for an engine that is
 * not burning.
 *
 * `PLUME_CORE_WIDTHS` of the nozzle's width, times how hard the throat is fed
 * — machinery and throttle together, read back off the force it is making —
 * times what the bell keeps of it. So a bigger nozzle, deeper machinery and a
 * longer bell each throw further, and a half-throttle burn is half the flame.
 */
export function plumeReach(force: number, exitWidth: number, divergence = 1): number {
  if (!(force > 0) || !(exitWidth > 0) || !(divergence > 0)) return 0;
  const pressure = force / (exitWidth * DECK_HEIGHT * THRUST_PER_EXIT_AREA * divergence);
  return PLUME_CORE_WIDTHS * exitWidth * pressure * collimation(divergence);
}

/**
 * How hot a flame burns where it leaves the nozzle, watts per square metre
 * of plume: one nozzle's power spread over its own triangle.
 *
 * What the renderer draws a flame's opacity from, so its size and its
 * brightness can say different things — a big engine throws a long flame
 * that is not especially fierce anywhere, and a cluster throws short ones
 * that are. Nothing in the simulation reads it: the burn goes by each ray's
 * share of the power, which fades along the flame the way the drawing does.
 */
export function plumeIntensity(geometry: ThrusterGeometry, force: number): number {
  const reach = nozzleReach(geometry, force);
  if (!(reach > 0)) return 0;
  return (PLUME_POWER_PER_NEWTON * (force / geometry.nozzles)) / (0.5 * geometry.exitWidth * reach);
}

/**
 * How many rays a plume is sampled by, across the nozzle.
 *
 * One ray down the axis says nothing about a flame's *width*: a hull off to
 * one side of a nozzle would be missed however close it was, and a nozzle
 * blocked only at its edge would read as perfectly clear. Three is the
 * cheapest count that separates the middle of the jet from its edges, which is
 * the distinction the geometry turns on — and the one that gives a blocked
 * nozzle a gradient to lose thrust along rather than an on/off.
 */
export const PLUME_RAYS = 3;

/**
 * Where each ray leaves the nozzle, as a fraction of the exit width from the
 * axis.
 *
 * The centroids of three equal bands across the exit, so each ray stands for
 * the same share of the gas and therefore the same share of the thrust and the
 * power. Nothing is weighted, because nothing needs to be.
 */
const RAY_OFFSET: readonly number[] = [-1 / 3, 0, 1 / 3];

/**
 * How many rays an engine's exhaust is sampled by: `PLUME_RAYS` for each of
 * its nozzles.
 *
 * Per nozzle rather than per engine, because a cluster is a row of separate
 * flames with ship's-eye gaps between them, and three rays stretched across
 * the whole face would fall where the fire is not.
 */
export function plumeRays(geometry: ThrusterGeometry): number {
  return PLUME_RAYS * geometry.nozzles;
}

/** Which nozzle a ray belongs to, and which of its three it is. */
function rayNozzle(ray: number): { nozzle: number; across: number } {
  const nozzle = (ray / PLUME_RAYS) | 0;
  return { nozzle, across: RAY_OFFSET[ray - nozzle * PLUME_RAYS] ?? 0 };
}

/** How far one flame reaches, given what the whole engine is producing. */
export function nozzleReach(geometry: ThrusterGeometry, force: number): number {
  // Every nozzle gets an equal share of the gas through an equal share of the
  // face, so each is fed at the same pressure the single nozzle was — and so
  // throws a flame as much shorter as it is narrower, less what its better
  // bell gives back.
  return plumeReach(force / geometry.nozzles, geometry.exitWidth, geometry.divergence);
}

/**
 * How far one ray reaches, given what the whole engine is producing.
 *
 * **Derived from the drawn plume rather than chosen**, so the picture and the
 * burn cannot part company: each flame is a triangle as wide as its own
 * nozzle, narrowing to a point at its reach, so at an offset `y` from that
 * nozzle's axis it ends where the triangle's half-width has shrunk to `y` — a
 * third of the way out for the rays at a third of the width. A plume is
 * therefore wide at the nozzle and a thin core further out, which is what a
 * wedge-shaped flame should do and what a single ray could not express.
 */
export function rayReach(ray: number, geometry: ThrusterGeometry, force: number): number {
  const { across } = rayNozzle(ray);
  const edge = 1 - 2 * (across < 0 ? -across : across);
  return edge > 0 ? nozzleReach(geometry, force) * edge : 0;
}

/** Where a ray leaves the engine, in metres across the exit face from its middle. */
export function rayOffset(ray: number, geometry: ThrusterGeometry): number {
  const { nozzle, across } = rayNozzle(ray);
  return nozzleOffset(geometry, nozzle) + across * geometry.exitWidth;
}

/**
 * What one engine's exhaust runs into on its own ship, ray by ray, and what
 * share of it gets out.
 *
 * Pure geometry over the boxes a ship is built from, so the compiler and the
 * editor can ask the same question of the same layout and get the same answer
 * — which is what stops a panel claiming a thrust the battle will not deliver.
 * `blocks` and `blockedAt` are filled with one entry per ray; the return is the
 * fraction of the exhaust that leaves the ship, in `PLUME_RAYS`ths.
 *
 * A ray stopped *beyond* the flame's own end does not count: the gas has spread
 * to nothing by then, and there is no momentum left to hand back.
 */
export function exhaustObstruction(
  boxes: Boxes,
  module: number,
  /** Thrust the nozzle throws at full throttle, newtons. */
  rating: number,
  path: HullPath,
  blocks: number[],
  blockedAt: number[],
): number {
  blocks.length = 0;
  blockedAt.length = 0;

  const engine = boxes.modules[module];
  if (engine === undefined) return 1;
  const geometry = thrusterGeometry(engine.spec);
  const rays = plumeRays(geometry);
  const dirX = cos(engine.angle);
  const dirY = sin(engine.angle);
  // The exhaust leaves by the face opposite the one the engine pushes from.
  const rootX = engine.x - dirX * engine.spec.length * 0.5;
  const rootY = engine.y - dirY * engine.spec.length * 0.5;
  // Far enough to leave the ship by any route through it.
  let far = 0;
  for (const m of boxes.modules) {
    const span = m.x * m.x + m.y * m.y;
    if (span > far) far = span;
  }
  far = sqrt(far) * 2 + 1;

  let escaped = 0;
  for (let ray = 0; ray < rays; ray++) {
    // Across the exit face, which is the exhaust direction turned a quarter.
    const across = rayOffset(ray, geometry);
    const x = rootX - dirY * across;
    const y = rootY + dirX * across;
    modulesAlong(boxes, x, y, x - dirX * far, y - dirY * far, path);

    let hit = -1;
    let at = Infinity;
    for (let k = 0; k < path.count; k++) {
      if (path.module[k]! === module) continue;
      hit = path.module[k]!;
      at = path.entry[k]!;
      break;
    }
    blocks.push(hit);
    blockedAt.push(at);
    if (!(at < rayReach(ray, geometry, rating))) escaped++;
  }
  return escaped / rays;
}

/**
 * Least share of its power a plume must land for an engine to be worth firing
 * as a weapon.
 *
 * A plume fades to nothing at its own reach, so the far end of one delivers
 * almost nothing while costing the ship the full push of the burn. An engine
 * that lit up whenever an enemy was anywhere in the flame would spend most of
 * its firing shoving itself about for no damage, so it holds until the target
 * is in the half of the plume that is worth burning — which is also what makes
 * this a close-quarters weapon rather than a second gun.
 */
export const WEAPON_PLUME_SHARE = 0.5;

/**
 * Where the plumes land, and what that costs whoever is standing in them.
 *
 * Kept apart from `Ships` for the same reason `Impacts` is: the model can be
 * driven, and tested, without one.
 */
export class Plumes {
  private readonly hit = new RayHit();

  /** Body the last `cast` landed on, or -1 if that ray met nothing. */
  body = -1;
  /** Module on that body, or -1 where the cast met a body with no hull. */
  module = -1;
  /**
   * Fraction of *one ray's* power landing there — 1 at the nozzle and 0 at
   * that ray's own end. A ray carries a third of the engine, so the share of
   * the whole plume is this over `PLUME_RAYS`.
   */
  share = 0;
  /** Where it landed, world frame, which is where its push acts. */
  x = 0;
  y = 0;
  /** The way the exhaust is travelling, world frame, unit. */
  dirX = 0;
  dirY = 0;

  /**
   * Where one ray of one engine's plume lands if it burns at `force`, filled
   * into `body`, `module`, `share` and the impact. Returns false if that ray
   * reaches nothing.
   *
   * **A ray the ship's own hull blocks never leaves it**, so it is not cast at
   * all: whatever is beyond is in the hull's shadow, and hulls are solid, so
   * nothing can be in front of it either. That is also what makes the pass
   * cheap on a ship whose nozzles are buried — the rays that would cost a cast
   * are exactly the ones that cannot reach anybody. Such a ray still *burns*
   * what it is buried in; what it does not do is push anything, because its
   * momentum has already been counted against the engine's thrust
   * (`ThrusterSpec.escaping`).
   *
   * **The first thing in the way takes all of it and shields everything
   * behind**, spent or not: a plume is gas, and a wrecked module is still a
   * wall of metal to it. That is how a shell and a ram see a hull, and unlike
   * a beam, which is stopped only by matter it can still boil away.
   *
   * Held rather than returned, so that a caller deciding whether to *fire* can
   * ask the same question a burn does and get the same answer.
   */
  cast(
    design: ShipDesign,
    thruster: number,
    ray: number,
    /** Thrust the engine is producing, or would produce, newtons. */
    force: number,
    bodies: Bodies,
    bodyIndex: number,
    grid: SpatialGrid,
    hulls: Hulls,
  ): boolean {
    this.body = -1;
    this.module = -1;
    this.share = 0;

    const spec = design.thrusters[thruster];
    if (spec === undefined || !(force > 0)) return false;
    const engine = design.modules[spec.module ?? -1];
    if (engine === undefined) return false;

    const geometry = thrusterGeometry(engine.spec);
    const reach = rayReach(ray, geometry, force);
    if (!(reach > 0)) return false;

    // What this ray runs into on its own ship, worked out when the design was
    // compiled. Inside the flame, it is the end of the ray.
    const blockedAt = spec.blockedAt?.[ray] ?? Infinity;
    const blocked = blockedAt < reach;

    const angle = bodies.angle[bodyIndex]!;
    const c = cos(angle);
    const s = sin(angle);
    const across = rayOffset(ray, geometry);
    const rootX = spec.x - spec.dirX * engine.spec.length * 0.5 - spec.dirY * across;
    const rootY = spec.y - spec.dirY * engine.spec.length * 0.5 + spec.dirX * across;
    const ux = -(spec.dirX * c - spec.dirY * s);
    const uy = -(spec.dirX * s + spec.dirY * c);
    const x0 = bodies.x[bodyIndex]! + rootX * c - rootY * s;
    const y0 = bodies.y[bodyIndex]! + rootX * s + rootY * c;

    let distance: number;
    let victimBody: number;
    let victimModule: number;
    if (blocked) {
      distance = blockedAt;
      victimBody = bodyIndex;
      victimModule = spec.blocks?.[ray] ?? -1;
    } else {
      const dx = ux * reach;
      const dy = uy * reach;
      const hit = this.hit;
      if (!grid.raycast(bodies, x0, y0, x0 + dx, y0 + dy, hit, bodyIndex, hulls)) return false;
      distance = reach * hit.t;
      victimBody = hit.bodyIndex;
      // A body with no hull to cast against has no module to burn, and
      // `Damage.absorb` says so by refusing the index.
      victimModule = hulls.describe(bodies, victimBody, x0, y0, dx, dy) ? hulls.module : -1;
    }

    const share = 1 - distance / reach;
    if (!(share > 0)) return false;
    this.body = victimBody;
    this.module = victimModule;
    this.share = share;
    this.x = x0 + ux * distance;
    this.y = y0 + uy * distance;
    this.dirX = ux;
    this.dirY = uy;
    return true;
  }

  /**
   * Burn and shove whatever every ray of one engine's plume is playing on, for
   * one step.
   *
   * **The push is the exhaust's momentum arriving**, so it acts along the
   * exhaust and at the point it lands — which means a plume on a hull's flank
   * spins it as well as pushing it, and a ship can be shoved off a firing
   * solution by an engine rather than shot off one. A ray blocked by its own
   * ship pushes nothing: that momentum was taken off the engine's thrust when
   * the design was compiled, so paying it again here would be the ship pushing
   * itself.
   */
  burn(
    design: ShipDesign,
    thruster: number,
    force: number,
    damage: Damage,
    bodies: Bodies,
    bodyIndex: number,
    grid: SpatialGrid,
    hulls: Hulls,
    dt: number,
  ): void {
    if (!(dt > 0) || !(force > 0)) return;
    const engine = design.modules[design.thrusters[thruster]?.module ?? -1];
    if (engine === undefined) return;
    // A ray is one equal slice of the engine: a third of one of its nozzles,
    // so that share of the gas, the power and the momentum.
    const rays = plumeRays(thrusterGeometry(engine.spec));
    const perRay = force / rays;
    for (let ray = 0; ray < rays; ray++) {
      if (!this.cast(design, thruster, ray, force, bodies, bodyIndex, grid, hulls)) continue;
      damage.absorb(this.body, this.module, PLUME_POWER_PER_NEWTON * perRay * this.share * dt);
      if (this.body === bodyIndex) continue;
      const impulse = perRay * this.share * dt;
      shove(bodies, this.body, this.dirX * impulse, this.dirY * impulse, this.x, this.y);
    }
  }
}

/**
 * Push a body at a world-frame point, as an impulse.
 *
 * The same thing a round does when it stops in a hull, applied to velocities
 * rather than through the force providers because this happens after the world
 * has stepped.
 */
function shove(
  bodies: Bodies,
  body: number,
  jx: number,
  jy: number,
  px: number,
  py: number,
): void {
  const mass = bodies.mass[body]!;
  if (!(mass > 0)) return;
  bodies.vx[body] = bodies.vx[body]! + jx / mass;
  bodies.vy[body] = bodies.vy[body]! + jy / mass;
  const inertia = bodies.inertia[body]!;
  if (!(inertia > 0)) return;
  const rx = px - bodies.x[body]!;
  const ry = py - bodies.y[body]!;
  bodies.angularVel[body] = bodies.angularVel[body]! + (rx * jy - ry * jx) / inertia;
}
