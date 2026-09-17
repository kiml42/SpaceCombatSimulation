import { abs, atan2, cos, max, min, pow, sin, sqrt } from './math.js';

/**
 * Terminal ballistics: what happens where a round meets a plate.
 *
 * A pure function of the round, the plate and the angle between them
 * (DESIGN.md §4). It decides **perforate**, **embed** or **deflect**, and
 * returns what is left — the residual speed the round carries on with, and the
 * energy the plate absorbed. It knows nothing about ships, modules, hit points
 * or what damage is: the damage model spends what this returns, and keeping
 * the two apart is what lets this be decided from local surface properties
 * alone, in the projectile pass, without any bookkeeping.
 *
 * **The law is de Marre**, the empirical perforation formula worked out for
 * naval armour and still the standard reference for a hard round against a
 * steel plate. It gives a *limit velocity*: the speed below which a round of
 * this mass and calibre does not get through this thickness.
 *
 *     v_limit = K · t^0.7 · d^0.75 / √m
 *
 * The exponents are the law and are not ours to choose; `DE_MARRE_K` is the
 * plate, and is the one number here that is a choice. What the form says is
 * worth reading off it, because it is what makes gun design interesting:
 * penetration goes as `m^0.5 / d^0.75` at a given speed, so a *heavy round for
 * its calibre* is what gets through armour. A gun that fires a dense slug
 * beats a gun that fires a fat light one, and both beat neither — which is the
 * trade §4's scaling laws already price in mass and rate of fire.
 *
 * Obliquity is handled as **line-of-sight thickness**: a plate met at an angle
 * is thicker in the direction of travel by `1 / cos θ`. That is the whole of
 * the angle model, deliberately — it is exact for the geometry, where the
 * effects it leaves out (a round turning into or away from the plate as it
 * bites) are empirical corrections nobody can calibrate without test data this
 * project does not have. ROADMAP.md §12 keeps the refinement open.
 */

/**
 * De Marre's constant for this universe's armour steel, SI.
 *
 * Calibrated against a 16-inch naval rifle: a 1,225 kg shell of 0.406 m
 * calibre arriving at 700 m/s perforates about 0.4 m of belt armour, which is
 * the Iowa class against its own protection at battle range. Everything else
 * follows from the law — a 160 mm round of 90 kg at 560 m/s gets through about
 * 12 cm, so the reinforcement dial (§4: wall thickness × reinforcement) spans
 * "paper to that gun" at 1 and "immune to it" at about 6.
 *
 * The form is the physics and this is the material, so moving it is a balance
 * decision about how hard armour is in this game rather than a correction —
 * which is why it is one named constant and not a number inside the law.
 */
export const DE_MARRE_K = 91_460;

/**
 * How far off the normal a round has to arrive to skid off a plate it could
 * not get through, radians.
 *
 * 65°, which is in the band where real shot starts to ricochet rather than
 * bite. The literature makes the critical angle depend on the plate's
 * thickness relative to the round's calibre — a thin plate is easier to skid
 * off than a thick one — and that refinement is left to ROADMAP.md §12 rather
 * than guessed at here: one constant that is honestly a constant beats two
 * that are honestly neither.
 *
 * It applies only to a round that *failed* to perforate. A round with enough
 * speed to get through the line-of-sight thickness goes through, however
 * oblique the plate — which is why a heavy gun does not care about sloped
 * armour the way a light one does.
 */
export const RICOCHET_ANGLE = 1.134464;

/**
 * How nearly along a face counts as along it — a guard on the division by the
 * cosine, not a tolerance for sloppiness. A millionth of a radian from the
 * face is a line-of-sight thickness a million times the plate's, which no
 * round survives and no arithmetic represents usefully.
 */
const EDGE_ON = 1e-6;

/** What a round did to the plate it met. */
export enum Terminal {
  /** Stopped in the plate. Everything it had went into it. */
  Embed = 0,
  /** Skidded off. The plate took the part of the energy that was normal to it. */
  Deflect = 1,
  /** Got through, with something left. */
  Perforate = 2,
}

export interface Strike {
  outcome: Terminal;
  /**
   * Speed the round carries on at, m/s. Zero when it embeds; what is left
   * after the plate when it perforates; its tangential speed when it skids.
   */
  residualSpeed: number;
  /**
   * Energy the plate took, joules — the round's kinetic energy less whatever
   * it left with. This is what the damage model spends, and it is a *loss*
   * rather than a share, so nothing has to be conserved twice.
   */
  energy: number;
}

/**
 * What a round of `mass` kg and `calibre` m arriving at `speed` m/s does to a
 * plate `thickness` m thick, met at `incidence` radians from its normal.
 *
 * `incidence` is the angle between the round's path and the plate's normal, so
 * zero is square-on and a right angle is along the face. It is taken as an
 * absolute: which side of the normal a round arrives from decides where it
 * goes next, which is the caller's arithmetic, not the plate's.
 */
export function strike(
  mass: number,
  calibre: number,
  speed: number,
  thickness: number,
  incidence: number,
): Strike {
  const energy = 0.5 * mass * speed * speed;
  // A plate with no thickness stops nothing, which is the ordinary case for a
  // shot leaving a hole it has already made.
  if (!(thickness > 0) || !(mass > 0) || !(calibre > 0)) {
    return { outcome: Terminal.Perforate, residualSpeed: speed, energy: 0 };
  }

  const slant = abs(cos(incidence));
  // Edge-on: the round is travelling along the face and meets no thickness of
  // it at all. Treated as a skid rather than as infinite armour, which is what
  // the division would otherwise produce.
  if (slant < EDGE_ON) {
    return { outcome: Terminal.Deflect, residualSpeed: speed, energy: 0 };
  }

  const lineOfSight = thickness / slant;
  const limit = (DE_MARRE_K * pow(lineOfSight, 0.7) * pow(calibre, 0.75)) / sqrt(mass);

  if (speed > limit) {
    // What is left is what the limit did not take, in energy: the round spends
    // exactly the energy of a round arriving at the limit speed, which is what
    // makes the limit a limit.
    const residualSpeed = sqrt(speed * speed - limit * limit);
    return {
      outcome: Terminal.Perforate,
      residualSpeed,
      energy: 0.5 * mass * limit * limit,
    };
  }

  if (abs(incidence) > RICOCHET_ANGLE) {
    // A skid: the plate takes the part of the round's motion that was going
    // into it, and the round leaves with the part that was going along it.
    const along = abs(sin(incidence)) * speed;
    return {
      outcome: Terminal.Deflect,
      residualSpeed: along,
      energy: energy - 0.5 * mass * along * along,
    };
  }

  return { outcome: Terminal.Embed, residualSpeed: 0, energy };
}

/**
 * Where a deflected round goes: its path mirrored about the surface normal.
 *
 * The honest answer for a skid is along the face rather than mirrored — a
 * round that ricochets off armour follows the plate rather than bouncing like
 * a billiard ball — and the two agree at the grazing angles a ricochet
 * actually happens at, where the mirrored direction *is* nearly along the
 * face. Mirroring is used because it needs no decision about which way along
 * the face the round went, and because at 65° and beyond the difference is
 * small. §12 has the refinement.
 *
 * `dx, dy` is the round's direction and `nx, ny` the outward unit normal of
 * the surface it struck. The result is a unit direction.
 */
export function deflected(
  dx: number,
  dy: number,
  nx: number,
  ny: number,
): { x: number; y: number } {
  const dot = dx * nx + dy * ny;
  const rx = dx - 2 * dot * nx;
  const ry = dy - 2 * dot * ny;
  const length = sqrt(rx * rx + ry * ry);
  if (!(length > 0)) return { x: dx, y: dy };
  return { x: rx / length, y: ry / length };
}

/**
 * The angle between a round's path and a surface's normal, radians — zero
 * square-on, a right angle along the face.
 *
 * Both are unit vectors and the normal points *out* of the surface, so a round
 * arriving from outside gives a negative dot product; the sign is dropped
 * because incidence is about how oblique the meeting is, not which side it
 * happened on.
 */
export function incidenceAngle(dx: number, dy: number, nx: number, ny: number): number {
  // Capped, since a dot product a shade over one from rounding would make the
  // arccos a NaN.
  return acos(min(1, abs(dx * nx + dy * ny)));
}

/**
 * Arccosine, built from our own `atan2` rather than taken from `Math`.
 *
 * `Math.acos` is implementation-defined in the ECMAScript spec, like every
 * other transcendental, and this one feeds an angle that decides whether a
 * round skids off — so two engines disagreeing in the last bit could disagree
 * about a battle. `atan2(√(1 − c²), c)` is the identity, and `sqrt` and
 * arithmetic are both exactly specified.
 */
function acos(c: number): number {
  return atan2(sqrt(max(0, 1 - c * c)), c);
}
