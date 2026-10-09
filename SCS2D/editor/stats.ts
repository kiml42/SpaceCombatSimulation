import {
  Allocation,
  specificImpulse,
  readsSealing,
  fillOf,
  SEAL_REACH,
  SEAL_SPEED,
  HullPath,
  exhaustObstruction,
  firingArc,
  firingPeriod,
  barrelHalfWidth,
  barrelCalibres,
  braceMass,
  readsBarrelCalibres,
  inWeaponsLayer,
  math,
  AttackArcs,
  bestAttackBearings,
  designArcs,
  boxAngle,
  moduleCentre,
  moduleStats,
  layoutStats,
  statsInLayout,
  radiansToDegrees,
  hullMountGeometry,
  isHullMount,
  isWeaponMount,
  mountTraverse,
  nozzleReach,
  weaponPlumeReach,
  plumeIntensity,
  shortfall,
  engineGeometry,
  mountAccel,
  traverseRate,
  defaultTargeting,
  nominalReach,
  resolveTargeting,
  type GunStats,
  type ModuleSpec,
  type ShipDesign,
} from '../sim/index.js';

const { cos, sin, max, min, TAU } = math;

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
  /**
   * How far it will fire at the enemy its doctrine wants, metres, as its
   * firing wedge is drawn: null where the ship's size is not known.
   */
  triggerRange?: number | null;
}

export interface DesignStats {
  /** Mass as it sets out, kg — the materials the ship is made of and the fuel it starts with. */
  mass: number;
  /** Fuel aboard as it sets out, kg: its tanks, and what its cores carry, each as full as it starts. */
  fuel: number;
  /** Seconds every engine could burn flat out on what it sets out with. Infinite with no engines. */
  endurance: number;
  /**
   * Change of velocity what it sets out with buys, m/s, by the rocket equation, at the
   * exhaust velocity of all its engines burning together.
   */
  deltaV: number;
  /** Moment of inertia about the centre of mass, kg·m². */
  inertia: number;
  /** Bounding-circle radius about the centre of mass, metres. */
  radius: number;
  moduleCount: number;
  engineCount: number;
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
  /**
   * Braking, m/s², two ways: holding its main guns on a target ahead of it
   * (away from its best attack bearing), and turned to put its main thrust
   * axis against its way, as a ship that turns to burn does.
   */
  brakeHolding: number;
  brakeTurned: number;
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
   * torque and trims the imbalance with whatever engines have authority
   * left. So what a badly balanced layout loses is acceleration, and it loses
   * it hardest where the trimming engines are already at full throttle.
   */
  headingCost: number;
  turrets: TurretReadout[];
}

export function designStats(design: ShipDesign, envelope: Envelopes): DesignStats {
  const layout = design.engineLayout;
  // As it sets out, so a ship that starts part full shows what it really has.
  const mass = design.launchMass;
  const inertia = design.inertia;
  const trim = trimmer(design);
  // The first of its best attack bearings: where it holds its target to fight.
  const attack = bestAttackBearings(designArcs(design, new AttackArcs()), design.thrustBearing)[0]!.bearing;
  let fuel = 0;
  let thrust = 0;
  // Kilograms a second, every engine flat out.
  let flow = 0;
  for (const module of design.modules) {
    fuel += module.stats.fuel * fillOf(module.spec);
    if (module.stats.exhaustVelocity > 0) {
      thrust += module.stats.thrust;
      flow += module.stats.thrust / module.stats.exhaustVelocity;
    }
  }
  const exhaust = flow > 0 ? thrust / flow : 0;

  return {
    mass,
    fuel,
    endurance: flow > 0 ? fuel / flow : Infinity,
    deltaV: fuel > 0 && fuel < mass ? exhaust * math.log(mass / (mass - fuel)) : 0,
    inertia,
    radius: design.radius,
    moduleCount: design.modules.length,
    engineCount: design.engines.length,
    // +x is the bow and +y is to port, matching the frame the layouts are
    // drawn in.
    accelFore: trim(1, 0),
    accelAft: trim(-1, 0),
    accelPort: trim(0, 1),
    accelStarboard: trim(0, -1),
    brakeHolding: trim(-math.cos(attack), -math.sin(attack)),
    brakeTurned: trim(math.cos(design.thrustBearing), math.sin(design.thrustBearing)),
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
        roundsPerMinute: firingPeriod(gun) > 0 ? 60 / firingPeriod(gun) : 0,
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
 * What an assembly weighs, and what all its copies weigh together.
 *
 * Mass is the one figure that means the same thing about an assembly as it does
 * about a module: it is a sum, so a part of a ship has one. Nothing else on
 * the module panel does — capacity and armour describe a wall, hit points
 * belong to a module that can be shot off on its own, and thrust and a gun's
 * figures are about where a module points, which a bag of modules has no
 * single answer for.
 *
 * Read from `moduleStats`, the same derivation the ship totals are summed
 * from, so an assembly's mass and the change removing it would make to the ship
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
  const stats = layoutStats(layout);
  const modules = layout.map((spec, i) => {
    const centre = moduleCentre(spec);
    return {
      spec,
      stats: stats[i]!,
      x: centre.x,
      y: centre.y,
      angle: boxAngle(spec),
      index: 0,
      weaponsLayer: inWeaponsLayer(spec, stats[i]!.thickness),
    };
  });
  return exhaustObstruction({ modules }, index, rating, new HullPath(), []);
}

export function assemblyMass(layout: readonly ModuleSpec[], picked: readonly number[]): number {
  let total = 0;
  // Measured in the layout rather than on their own, since a thick plate takes
  // its depth — and so its mass — from what it is welded to, which may be a
  // module outside the assembly.
  for (const index of picked) total += statsInLayout(layout, index).mass;
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
  shipRadius = 0,
): ModuleReadout {
  // In the layout where there is one, since a thick plate's depth is its
  // neighbours' business; on its own otherwise.
  const stats = layout[index] === spec ? statsInLayout(layout, index) : moduleStats(spec);
  const rows: [string, string][] = [
    ['Mass', `${(stats.mass / 1000).toLocaleString('en-GB', { maximumFractionDigits: 2 })} t`],
    // What the plan view cannot show, and what decides both the wall it
    // carries and whether a turret can reach it.
    ['Depth', `${stats.thickness.toLocaleString('en-GB', { maximumFractionDigits: 2 })} m`],
    ['Capacity', `${stats.capacity.toLocaleString('en-GB', { maximumFractionDigits: 1 })} m²`],
    ['Armour', `${(stats.wallThickness * 1000).toLocaleString('en-GB', { maximumFractionDigits: 0 })} mm`],
    ['Hit points', stats.hitPoints.toLocaleString('en-GB', { maximumFractionDigits: 0 })],
  ];
  if (stats.fuel > 0) {
    const tonnes = (kg: number): string => `${(kg / 1000).toLocaleString('en-GB', { maximumFractionDigits: 2 })} t`;
    const fill = fillOf(spec);
    rows.push([
      'Fuel',
      fill < 1
        ? `${tonnes(stats.fuel)} when full, starting with ${tonnes(stats.fuel * fill)}; the full load is counted in its mass`
        : `${tonnes(stats.fuel)}, counted in its mass`,
    ]);
  }
  if (readsSealing(spec.kind)) {
    rows.push([
      'Sealing',
      stats.lining > 0
        ? `closes a hole up to ${(stats.lining * SEAL_REACH * 1000).toLocaleString('en-GB', { maximumFractionDigits: 0 })} mm across, ` +
          `${(stats.lining * SEAL_SPEED * 1000).toLocaleString('en-GB', { maximumFractionDigits: 0 })} mm a second`
        : 'none — a hole stays open',
    ]);
  }
  if (stats.pumpRate > 0) {
    const rate = `${stats.pumpRate.toLocaleString('en-GB', { maximumFractionDigits: 0 })} kg/s`;
    const across =
      spec.kind === 'pad' ? 'into a fighter landed on it' : spec.kind === 'port' ? 'either way across a dock' : 'from what its bow grips';
    rows.push(['Pump', `${rate} ${across}`]);
  }
  if (stats.exhaustVelocity > 0) {
    // What it costs to run, which the bell and the size of the throat decide.
    rows.push([
      'Efficiency',
      `${specificImpulse(stats.exhaustVelocity).toLocaleString('en-GB', { maximumFractionDigits: 0 })} s Isp, ` +
        `${(stats.thrust / stats.exhaustVelocity).toLocaleString('en-GB', { maximumFractionDigits: 1 })} kg/s flat out`,
    ]);
  }
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
  if (isHullMount(spec.kind)) {
    // What the opening leaves it, and how much of the opening is already
    // barrel — the two numbers a designer trades against each other when they
    // decide how long a barrel to give it and how many.
    const mount = hullMountGeometry(spec);
    rows.push([
      'Opening',
      `${radiansToDegrees(mount.traverse).toLocaleString('en-GB', { maximumFractionDigits: 1 })}° ` +
        `either way, with ${(((mount.outlets * mount.outletWidth) / spec.width) * 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })}% ` +
        `of the face filled`,
    ]);
  }
  if (readsBarrelCalibres(spec.kind) && stats.gun !== null) {
    // How long, and what being long has cost in bracing.
    const gun = stats.gun;
    const bracing = braceMass(gun);
    rows.push([
      'Barrel',
      `${gun.barrelLength.toLocaleString('en-GB', { maximumFractionDigits: 2 })} m, ` +
        `${barrelCalibres(spec).toLocaleString('en-GB', { maximumFractionDigits: 1 })} calibres` +
        (bracing > 0
          ? `; ${gun.braceLength.toLocaleString('en-GB', { maximumFractionDigits: 2 })} m braced, ` +
            `${(bracing / 1000).toLocaleString('en-GB', { maximumFractionDigits: 2 })} t of bracing`
          : ''),
    ]);
  }
  if (isWeaponMount(spec.kind)) {
    // What it may train through and what that machine weighs — the second
    // being the number a designer is trading when they narrow the first, and
    // on a hull mount the reason to.
    const gear = stats.traverseMass;
    rows.push([
      'Trains',
      `${radiansToDegrees(mountTraverse(spec)).toLocaleString('en-GB', { maximumFractionDigits: 1 })}° ` +
        `either way, on ${
          gear > 0
            ? `${(gear / 1000).toLocaleString('en-GB', { maximumFractionDigits: 2 })} t of gear`
            : 'no gear at all'
        }`,
    ]);
  }
  if (spec.kind === 'engine') {
    // What the bell is doing to the gas, which is the one number that says
    // whether the nozzle is worth the length it takes up. A designer shrinking
    // a bell sees the thrust fall before they see the ship fly worse.
    const engine = engineGeometry(spec);
    rows.push([
      'Bell',
      `${radiansToDegrees(engine.halfAngle).toLocaleString('en-GB', { maximumFractionDigits: 0 })}° ` +
        `half-angle, keeping ${(engine.divergence * 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })}% ` +
        `of the thrust${engine.nozzles > 1 ? ` across ${engine.nozzles} nozzles` : ''}`,
    ]);
    // How far it throws and how fiercely, at full throttle: the trade between
    // one long flame and a cluster of short hot ones.
    rows.push([
      'Flame',
      `${nozzleReach(engine, stats.thrust).toLocaleString('en-GB', { maximumFractionDigits: 0 })} m, ` +
        `${(plumeIntensity(engine, stats.thrust) / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} kW/m²`,
    ]);
    // Its firing wedge: the part of the flame worth lighting up for.
    if (spec.weapon === true) {
      rows.push([
        'Fires within',
        `${weaponPlumeReach(engine, stats.thrust).toLocaleString('en-GB', { maximumFractionDigits: 0 })} m of the nozzle`,
      ]);
    }
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
            roundsPerMinute: firingPeriod(gun) > 0 ? 60 / firingPeriod(gun) : 0,
            ...arcOf(layout, index, gun.barrelLength, barrelHalfWidth(gun)),
            traverseRate: radiansToDegrees(traverseRate(mountAccel(spec, stats))),
            // Against what its doctrine goes after, which is sized from the
            // ship carrying it, so it needs the ship.
            triggerRange: shipRadius > 0 ? fireRangeOf(spec, gun, shipRadius) : null,
          },
  };
}

/** How far a mount will fire at the enemy its doctrine wants, as its design reach is. */
function fireRangeOf(spec: ModuleSpec, gun: GunStats, shipRadius: number): number {
  const targeting = resolveTargeting(spec.targeting, defaultTargeting(spec.kind));
  return nominalReach(gun, shipRadius, targeting.preferredMass) * targeting.fireRange;
}

/** How far a mount may train either way, in degrees, given what is around it. */
function arcOf(
  layout: readonly ModuleSpec[],
  index: number,
  reach: number,
  width: number,
): { arcLeft: number; arcRight: number } {
  if (index < 0 || layout[index] === undefined) return { arcLeft: 0, arcRight: 0 };
  // The compiler's rule: a hull mount's barrel is fouled by anything, a
  // turret's only by what is in the weapons layer.
  const hull = isHullMount(layout[index]!.kind);
  // Measured in the layout, so a plate that is thick by borrowing the depth of
  // the module it covers is in a turret's way here as it is in a battle.
  const depths = hull ? [] : layoutStats(layout);
  const raised = (spec: ModuleSpec, i: number): boolean =>
    inWeaponsLayer(spec, depths[i]!.thickness);
  const arc = firingArc(layout, index, reach, hull ? undefined : raised, hull ? 0 : width);
  // A hull mount is held to its own opening as well as to what the ship
  // leaves it, and the panel has to say the number the ship will actually
  // train through rather than the more generous of the two.
  const spec = layout[index]!;
  const own = isHullMount(spec.kind) ? hullMountGeometry(spec).traverse : Infinity;
  return {
    arcLeft: radiansToDegrees(min(arc.left, own)),
    arcRight: radiansToDegrees(min(arc.right, own)),
  };
}

/** Both manoeuvring envelopes, sampled in the same directions. */
export interface Envelopes {
  /** Directions sampled, evenly around the circle from the bow, anticlockwise. */
  readonly samples: number;
  /**
   * The most acceleration a direction can be given, whatever that does to the
   * heading, m/s². Exact rather than searched: the achievable wrenches are a
   * zonotope, so `EngineLayout.support` is a supporting plane of it.
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
  const layout = design.engineLayout;
  const throttles = new Float64Array(design.engines.length);
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
 * How each engine is throttled to push hardest at `angle` (radians from the
 * bow, anticlockwise, ship frame) without turning the ship: the point the
 * holding curve reaches in that direction, as the throttles that reach it. All
 * zero where the layout cannot push that way at all without spinning.
 */
export function holdingThrottles(design: ShipDesign, angle: number): Float64Array {
  const layout = design.engineLayout;
  const throttles = new Float64Array(design.engines.length);
  const result = new Allocation();
  const dirX = cos(angle);
  const dirY = sin(angle);
  const ceiling = layout.maxThrustAlong(dirX, dirY) / design.mass;
  if (!(ceiling > 0)) return throttles;
  for (let step = MAGNITUDE_STEPS; step > 0; step--) {
    const accel = (ceiling * step) / MAGNITUDE_STEPS;
    const fx = accel * design.mass * dirX;
    const fy = accel * design.mass * dirY;
    layout.allocate(fx, fy, 0, throttles, result);
    if (shortfall(fx, fy, 0, result) < TOLERANCE) return throttles;
  }
  throttles.fill(0);
  return throttles;
}

/**
 * Both curves: the acceleration available in every direction, and how much of
 * it survives the requirement not to spin.
 *
 * Four numbers on a panel say a ship accelerates hard forwards and poorly
 * sideways; only the curve shows which diagonal it is worst in, and whether a
 * layout is merely weak abeam or has a direction it cannot push at all — the
 * dent that says an engine is missing. The gap between the two curves is the
 * other thing a panel cannot say: where the ship's thrust is not balanced
 * about its centre of mass, and what that costs it.
 *
 * Sampled from the bow and running anticlockwise, in the ship's own frame.
 */
export function envelopes(design: ShipDesign, samples: number = ENVELOPE_SAMPLES): Envelopes {
  const layout = design.engineLayout;
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
