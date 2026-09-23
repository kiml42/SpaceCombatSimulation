import {
  Allocation,
  HullPath,
  exhaustObstruction,
  firingArc,
  math,
  moduleCentre,
  moduleStats,
  radiansToDegrees,
  shortfall,
  thrusterGeometry,
  traverseAccel,
  traverseRate,
  type ModuleSpec,
  type ShipDesign,
} from '../sim/index.js';

const { cos, sin, max, TAU } = math;

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
  /**
   * Linear acceleration available while holding a heading, m/s², in each of
   * the ship's four senses.
   *
   * Holding, rather than the greater figure a ship willing to spin could
   * project, because every order carries an approach angle (DESIGN.md §2) — a
   * ship that can only accelerate by tumbling cannot obey one. The difference
   * between the two is `headingCost`, and the envelope draws both.
   */
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
  /**
   * The largest fraction of its thrust this layout gives up in order not to
   * spin, over all directions. Zero on a ship whose thrust is balanced about
   * its centre of mass in every direction it can push.
   *
   * This is the readable form of what KSP shows as a centre of thrust offset
   * from the centre of mass. It has to be a cost rather than an offset because
   * the misalignment never *becomes* a spin here: allocation is asked for zero
   * torque and trims the imbalance with whatever thrusters have authority
   * left. So what a badly balanced layout loses is acceleration, and it loses
   * it hardest where the trimming thrusters are already at full throttle.
   */
  headingCost: number;
  turrets: TurretReadout[];
}

export function designStats(design: ShipDesign, envelope: Envelopes): DesignStats {
  const layout = design.thrusterLayout;
  const mass = design.mass;
  const inertia = design.inertia;
  const trim = trimmer(design);

  return {
    mass,
    inertia,
    radius: design.radius,
    moduleCount: design.modules.length,
    thrusterCount: design.thrusters.length,
    // +x is the bow and +y is to port, matching the frame the layouts are
    // drawn in.
    accelFore: trim(1, 0),
    accelAft: trim(-1, 0),
    accelPort: trim(0, 1),
    accelStarboard: trim(0, -1),
    turnLeft: layout.maxTorque(1) / inertia,
    turnRight: layout.maxTorque(-1) / inertia,
    fullAuthority: layout.hasFullAuthority(),
    headingCost: headingCost(envelope),
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
 * How many directions an envelope is sampled in. Smooth at the size the
 * rosette is drawn, and the holding curve costs an allocation per step per
 * direction, so this is the figure that decides what an edit costs.
 */
export const ENVELOPE_SAMPLES = 48;

/**
 * Magnitudes tried per direction when finding what a layout can hold.
 *
 * A **downward scan**, not a bisection, and the difference is not fussiness:
 * allocation is a heuristic rather than an exact solver (ROADMAP.md §12), so
 * whether a demand is met is *not* monotonic in its magnitude — the corvette's
 * diagonal is met at 6.4 m/s² and missed at 6.0. Bisection assumes monotonic
 * feasibility and would land wherever its first branch happened to send it.
 * Scanning down from the ceiling asks a well-posed question instead: the
 * largest demand this layout actually meets.
 *
 * The resolution that buys — a hundredth of the ceiling — is half a pixel at
 * the size the curve is drawn, which is the only place the answer is read.
 */
const MAGNITUDE_STEPS = 96;

/** How much of a demand may go unmet and still count as met. */
const TOLERANCE = 1e-6;

/** What one module is, on its own, rather than what it contributes to a ship. */
export interface ModuleReadout {
  /** Rows to show, already worded and in units a player reads. */
  rows: [string, string][];
  /** The gun, when the module is a turret and its geometry makes one. */
  gun: TurretReadout | null;
}

/**
 * What a group weighs, and what all its copies weigh together.
 *
 * Mass is the one figure that means the same thing about a group as it does
 * about a module: it is a sum, so a part of a ship has one. Nothing else on
 * the module panel does — capacity and armour describe a wall, hit points
 * belong to a module that can be shot off on its own, and thrust and a gun's
 * figures are about where a module points, which a bag of modules has no
 * single answer for.
 *
 * Read from `moduleStats`, the same derivation the ship totals are summed
 * from, so a group's mass and the change removing it would make to the ship
 * are the same number by construction.
 */
/**
 * What share of one engine's exhaust leaves the ship, for a layout the editor
 * holds as bare specs rather than as a compiled design.
 *
 * The same call the compiler makes, over the same geometry — the specs are in
 * the blueprint's own frame rather than about the centre of mass, and the
 * question is entirely relative, so the answer is the same.
 */
function exhaustEscaping(
  layout: readonly ModuleSpec[],
  index: number,
  rating: number,
): number {
  if (index < 0 || index >= layout.length) return 1;
  const modules = layout.map((spec) => {
    const centre = moduleCentre(spec);
    return { spec, stats: moduleStats(spec), x: centre.x, y: centre.y, angle: spec.angle ?? 0, index: 0 };
  });
  return exhaustObstruction({ modules }, index, rating, new HullPath(), [], []);
}

export function groupMass(modules: readonly ModuleSpec[]): number {
  let total = 0;
  for (const spec of modules) total += moduleStats(spec).mass;
  return total;
}

/**
 * The selected module's own figures.
 *
 * Read from `moduleStats`, which is the same derivation the ship totals are
 * summed from, so a module's mass here and the change it makes to the ship's
 * mass are the same number by construction rather than by agreement.
 *
 * The arc a turret can train through is a property of the module's
 * *surroundings* rather than of the module, so it needs the layout the module
 * sits in. It is worked out with `firingArc` — the same call `compileBlueprint`
 * makes — rather than read off a compiled design, which would mean mapping a
 * layout index onto a design that may have dropped modules it could not
 * measure.
 */
export function moduleReadout(
  spec: ModuleSpec,
  layout: readonly ModuleSpec[] = [],
  index = -1,
): ModuleReadout {
  const stats = moduleStats(spec);
  const rows: [string, string][] = [
    ['Mass', `${(stats.mass / 1000).toLocaleString('en-GB', { maximumFractionDigits: 2 })} t`],
    ['Capacity', `${stats.capacity.toLocaleString('en-GB', { maximumFractionDigits: 1 })} m²`],
    ['Armour', `${(stats.wallThickness * 1000).toLocaleString('en-GB', { maximumFractionDigits: 0 })} mm`],
    ['Hit points', stats.hitPoints.toLocaleString('en-GB', { maximumFractionDigits: 0 })],
  ];
  if (stats.thrust > 0) {
    // What the nozzle throws, and — where some of it runs into the ship — what
    // is left over to fly on. An engine part-buried in its own hull hands that
    // share of its momentum straight back, so the two figures differ and the
    // ship gets the second one. Worth saying here rather than only in the
    // envelope, because the envelope cannot say *which* engine is paying.
    const thrown = `${(stats.thrust / 1e6).toLocaleString('en-GB', { maximumFractionDigits: 2 })} MN`;
    const escaping = index < 0 ? 1 : exhaustEscaping(layout, index, stats.thrust);
    rows.push([
      'Thrust',
      escaping >= 1
        ? thrown
        : `${((stats.thrust * escaping) / 1e6).toLocaleString('en-GB', { maximumFractionDigits: 2 })} MN ` +
          `of ${thrown} — the rest fires into the ship`,
    ]);
  }
  if (spec.kind === 'thruster') {
    // What the bell is doing to the gas, which is the one number that says
    // whether the nozzle is worth the length it takes up. A designer shrinking
    // a bell sees the thrust fall before they see the ship fly worse.
    const engine = thrusterGeometry(spec);
    rows.push([
      'Bell',
      `${radiansToDegrees(engine.halfAngle).toLocaleString('en-GB', { maximumFractionDigits: 0 })}° ` +
        `half-angle, keeping ${(engine.divergence * 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })}% ` +
        `of the thrust${engine.nozzles > 1 ? ` across ${engine.nozzles} nozzles` : ''}`,
    ]);
  }
  const gun = stats.gun;
  return {
    rows,
    gun:
      gun === null
        ? null
        : {
            calibre: gun.calibre,
            barrels: gun.barrelCount,
            roundMass: gun.roundMass,
            muzzleSpeed: gun.muzzleSpeed,
            roundsPerMinute: gun.cycleTime > 0 ? 60 / gun.cycleTime : 0,
            ...arcOf(layout, index, gun.barrelLength),
            traverseRate: radiansToDegrees(traverseRate(traverseAccel(stats.mass, stats.inertia))),
          },
  };
}

/** How far a mount may train either way, in degrees, given what is around it. */
function arcOf(
  layout: readonly ModuleSpec[],
  index: number,
  reach: number,
): { arcLeft: number; arcRight: number } {
  if (index < 0 || layout[index] === undefined) return { arcLeft: 0, arcRight: 0 };
  const arc = firingArc(layout, index, reach);
  return { arcLeft: radiansToDegrees(arc.left), arcRight: radiansToDegrees(arc.right) };
}

/** Both manoeuvring envelopes, sampled in the same directions. */
export interface Envelopes {
  /** Directions sampled, evenly around the circle from the bow, anticlockwise. */
  readonly samples: number;
  /**
   * The most acceleration a direction can be given, whatever that does to the
   * heading, m/s². Exact rather than searched: the achievable wrenches are a
   * zonotope, so `ThrusterLayout.support` is a supporting plane of it.
   */
  readonly free: Float64Array;
  /** What the ship can actually use while holding its heading, m/s². */
  readonly holding: Float64Array;
}

/**
 * The largest acceleration this design achieves in a direction with no net
 * torque — measured through the allocator the ship flies with.
 *
 * Through the allocator rather than as a linear program, deliberately. An LP
 * would report what an ideal ship could do; this reports what this one does,
 * which is the more useful answer and the only one that can go wrong in the
 * same way a battle does. It also means a dent in the curve is evidence about
 * the allocator as well as about the layout — which is what ROADMAP.md §12
 * says it is waiting for before replacing it.
 */
function trimmer(design: ShipDesign): (dirX: number, dirY: number) => number {
  const layout = design.thrusterLayout;
  const throttles = new Float64Array(design.thrusters.length);
  const result = new Allocation();

  return (dirX, dirY) => {
    const ceiling = layout.maxThrustAlong(dirX, dirY) / design.mass;
    if (!(ceiling > 0)) return 0;
    for (let step = MAGNITUDE_STEPS; step > 0; step--) {
      const accel = (ceiling * step) / MAGNITUDE_STEPS;
      const fx = accel * design.mass * dirX;
      const fy = accel * design.mass * dirY;
      layout.allocate(fx, fy, 0, throttles, result);
      if (shortfall(fx, fy, 0, result) < TOLERANCE) return accel;
    }
    return 0;
  };
}

/**
 * Both curves: the acceleration available in every direction, and how much of
 * it survives the requirement not to spin.
 *
 * Four numbers on a panel say a ship accelerates hard forwards and poorly
 * sideways; only the curve shows which diagonal it is worst in, and whether a
 * layout is merely weak abeam or has a direction it cannot push at all — the
 * dent that says a thruster is missing. The gap between the two curves is the
 * other thing a panel cannot say: where the ship's thrust is not balanced
 * about its centre of mass, and what that costs it.
 *
 * Sampled from the bow and running anticlockwise, in the ship's own frame.
 */
export function envelopes(design: ShipDesign, samples: number = ENVELOPE_SAMPLES): Envelopes {
  const layout = design.thrusterLayout;
  const trim = trimmer(design);
  const free = new Float64Array(samples);
  const holding = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    const angle = (TAU * i) / samples;
    const dirX = cos(angle);
    const dirY = sin(angle);
    free[i] = layout.support(dirX, dirY, 0) / design.mass;
    holding[i] = trim(dirX, dirY);
  }
  return { samples, free, holding };
}

/** The worst fraction of its thrust a layout gives up in order not to spin. */
export function headingCost(envelope: Envelopes): number {
  let worst = 0;
  for (let i = 0; i < envelope.samples; i++) {
    const free = envelope.free[i]!;
    if (!(free > 0)) continue;
    worst = max(worst, 1 - envelope.holding[i]! / free);
  }
  return worst;
}
