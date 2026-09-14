import { math, radiansToDegrees, type ShipDesign } from '../sim/index.js';

const { cos, sin, TAU } = math;

/**
 * What a layout bought, in the units the simulation works in.
 *
 * Every figure here is *read* from a compiled design rather than worked out
 * again. That is the rule the editor lives or dies by: the moment this file
 * computes a mass or a thrust itself, the editor and the battle disagree about
 * the same ship, and the tool's entire value — that the picture and the
 * numbers are true — is gone. What this file is allowed to do is divide by
 * mass and convert to degrees, because an acceleration is a thing a player can
 * compare and a newton is not.
 */

/** One turret's figures, in the order the design lists its turrets. */
export interface TurretReadout {
  /** Bore, metres. */
  calibre: number;
  barrels: number;
  /** Mass of one round, kg. */
  roundMass: number;
  /** Muzzle velocity, m/s. */
  muzzleSpeed: number;
  /** Rounds per minute the mount can sustain. */
  roundsPerMinute: number;
  /** How far the mount may train off its rest bearing, degrees. */
  arcLeft: number;
  arcRight: number;
  /** Top training speed, degrees per second. */
  traverseRate: number;
}

export interface DesignStats {
  /** Dry mass, kg — the materials the ship is made of, and not a cost. */
  mass: number;
  /** Moment of inertia about the centre of mass, kg·m². */
  inertia: number;
  /** Bounding-circle radius about the centre of mass, metres. */
  radius: number;
  moduleCount: number;
  thrusterCount: number;
  /** Linear acceleration available, m/s², in each of the ship's four senses. */
  accelFore: number;
  accelAft: number;
  accelPort: number;
  accelStarboard: number;
  /** Angular acceleration available, rad/s², turning each way. */
  turnLeft: number;
  turnRight: number;
  /**
   * Whether the layout can push both ways on both axes and turn both ways. A
   * ship without it cannot hold a heading while translating, which is a design
   * error worth finding at the drawing board rather than in a battle.
   */
  fullAuthority: boolean;
  turrets: TurretReadout[];
}

export function designStats(design: ShipDesign): DesignStats {
  const layout = design.thrusterLayout;
  const mass = design.mass;
  const inertia = design.inertia;

  return {
    mass,
    inertia,
    radius: design.radius,
    moduleCount: design.modules.length,
    thrusterCount: design.thrusters.length,
    // +x is the bow and +y is to port, matching the frame the layouts are
    // drawn in.
    accelFore: layout.maxThrustAlong(1, 0) / mass,
    accelAft: layout.maxThrustAlong(-1, 0) / mass,
    accelPort: layout.maxThrustAlong(0, 1) / mass,
    accelStarboard: layout.maxThrustAlong(0, -1) / mass,
    turnLeft: layout.maxTorque(1) / inertia,
    turnRight: layout.maxTorque(-1) / inertia,
    fullAuthority: layout.hasFullAuthority(),
    turrets: design.turrets.map((turret) => {
      const gun = turret.gun;
      const mount = turret.mount;
      return {
        calibre: gun.calibre,
        barrels: gun.barrelCount,
        roundMass: gun.roundMass,
        muzzleSpeed: gun.muzzleSpeed,
        roundsPerMinute: gun.cycleTime > 0 ? 60 / gun.cycleTime : 0,
        arcLeft: radiansToDegrees(mount.leftArc ?? math.PI),
        arcRight: radiansToDegrees(mount.rightArc ?? math.PI),
        traverseRate: radiansToDegrees(mount.maxRate ?? 0),
      };
    }),
  };
}

/**
 * The manoeuvring envelope: the acceleration available in each direction
 * around the ship, sampled evenly from bow and turning anticlockwise.
 *
 * This is the shape a thruster layout really has, and it is almost never a
 * circle — four numbers on a panel say a ship accelerates hard forwards and
 * poorly sideways, but only the curve shows the diagonal it is actually worst
 * in. `ThrusterLayout.support` answers it exactly rather than by search: the
 * achievable wrenches are a zonotope, and each sample is a supporting plane of
 * it.
 *
 * Pure thrust, with no torque asked for, so the figures are what the ship can
 * do while free to turn as the thrusters see fit.
 */
export function thrustEnvelope(
  design: ShipDesign,
  samples: number,
  out: Float64Array = new Float64Array(samples),
): Float64Array {
  const layout = design.thrusterLayout;
  for (let i = 0; i < samples; i++) {
    const angle = (TAU * i) / samples;
    out[i] = layout.support(cos(angle), sin(angle), 0) / design.mass;
  }
  return out;
}
