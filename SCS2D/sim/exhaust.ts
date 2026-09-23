import type { Bodies } from './bodies.js';
import type { ShipDesign } from './blueprint.js';
import type { Damage } from './damage.js';
import type { Hulls } from './hull.js';
import { cos, sin } from './math.js';
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
 * **Only half of ROADMAP.md §12's answer to the buried nozzle.** A blocked
 * engine still produces its full thrust while it eats what it is pointed at;
 * losing thrust in proportion to how much of the exhaust is obstructed needs a
 * measure of *how much*, which the single axial ray below does not give.
 *
 * **The plume the simulation burns with is the plume the renderer draws** —
 * both take their length from `plumeReach`, so what is on the screen is what
 * is doing the damage.
 */

/**
 * Newtons of thrust per square metre of plume.
 *
 * The plume is a triangle as wide as the engine's exit and as long as this
 * makes it, so its *area* is proportional to the force being produced — the
 * quantity worth reading off a picture. A pleasing consequence falls out of
 * the scaling laws rather than being arranged: thrust scales with exit area,
 * so thrust per unit width is the same for every engine, and every engine
 * therefore reaches the same plume length at full throttle. A bigger engine is
 * a wider flame, not a longer one, which is what a shared exhaust velocity
 * should look like.
 */
export const PLUME_THRUST_PER_AREA = 0.5e4;

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
 * full-throttle plume reaches thirty metres and destroys a square structure
 * module as wide as the engine in four to seven seconds at the nozzle, or
 * roughly twice that halfway out. ROADMAP.md §12 keeps it open with the rest
 * of the dials.
 */
export const PLUME_POWER_PER_NEWTON = 4;

/**
 * How far a plume reaches from the nozzle, metres. Zero for an engine that is
 * not burning.
 */
export function plumeReach(force: number, exitWidth: number): number {
  if (!(force > 0) || !(exitWidth > 0)) return 0;
  return force / (exitWidth * PLUME_THRUST_PER_AREA);
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

  /** Body the last `cast` landed on, or -1 if the flame met nothing. */
  body = -1;
  /** Module on that body, or -1 where the cast met a body with no hull. */
  module = -1;
  /** Fraction of the engine's power landing there, 1 at the nozzle and 0 at the flame's end. */
  share = 0;

  /**
   * Where one engine's plume lands if it burns at `force`, filled into `body`,
   * `module` and `share`. Returns false if the flame reaches nothing.
   *
   * **The first thing in the way takes all of it and shields everything
   * behind**, spent or not: a plume is gas, and a wrecked module is still a
   * wall of metal to it. That is how a shell and a ram see a hull, and unlike
   * a beam, which is stopped only by matter it can still boil away.
   *
   * What lands falls off linearly to nothing at the plume's own reach, so an
   * obstruction is cheap at the tip of the flame and ruinous at the throat.
   * The cast is a single ray along the axis, so what is reached is what sits
   * *behind* the nozzle rather than everything the triangle covers — the hot
   * core of the plume, which is where its power is anyway.
   *
   * What the engine's own hull puts in the way was worked out when the design
   * was compiled, so the only cast here is against everything else.
   *
   * Held rather than returned, so that a caller deciding whether to *fire* can
   * ask the same question a burn does and get the same answer.
   */
  cast(
    design: ShipDesign,
    thruster: number,
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

    const reach = plumeReach(force, engine.spec.width);
    if (!(reach > 0)) return false;

    // Its own ship first, since that answer is already in hand.
    let distance = reach;
    let victimBody = -1;
    let victimModule = -1;
    const blockedAt = spec.blockedAt ?? Infinity;
    if (blockedAt < reach) {
      distance = blockedAt;
      victimBody = bodyIndex;
      victimModule = spec.blocks ?? -1;
    }

    // Then everything else, out only as far as its own hull lets the flame
    // get — so the nearer of the two wins without comparing them.
    //
    // The exhaust leaves by the face opposite the one the engine pushes from,
    // and the world is where everything but this ship lives.
    const angle = bodies.angle[bodyIndex]!;
    const c = cos(angle);
    const s = sin(angle);
    const nozzleX = spec.x - spec.dirX * engine.spec.length * 0.5;
    const nozzleY = spec.y - spec.dirY * engine.spec.length * 0.5;
    const x0 = bodies.x[bodyIndex]! + nozzleX * c - nozzleY * s;
    const y0 = bodies.y[bodyIndex]! + nozzleX * s + nozzleY * c;
    const ux = -(spec.dirX * c - spec.dirY * s);
    const uy = -(spec.dirX * s + spec.dirY * c);
    const dx = ux * distance;
    const dy = uy * distance;
    const hit = this.hit;
    if (distance > 0 && grid.raycast(bodies, x0, y0, x0 + dx, y0 + dy, hit, bodyIndex, hulls)) {
      distance *= hit.t;
      victimBody = hit.bodyIndex;
      // A body with no hull to cast against has no module to burn, and
      // `Damage.absorb` says so by refusing the index.
      victimModule = hulls.describe(bodies, victimBody, x0, y0, dx, dy) ? hulls.module : -1;
    }

    if (victimBody < 0) return false;
    const share = 1 - distance / reach;
    if (!(share > 0)) return false;
    this.body = victimBody;
    this.module = victimModule;
    this.share = share;
    return true;
  }

  /** Burn whatever one of a ship's engines is playing on, for one step. */
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
    if (!(dt > 0)) return;
    if (!this.cast(design, thruster, force, bodies, bodyIndex, grid, hulls)) return;
    damage.absorb(this.body, this.module, PLUME_POWER_PER_NEWTON * force * this.share * dt);
  }
}
