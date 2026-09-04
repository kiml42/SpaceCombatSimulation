import { PI, sqrt } from './math.js';

/**
 * Parametric ship modules: a few archetypes with continuous parameters, rather
 * than a catalogue of discrete parts (DESIGN.md §4).
 *
 * Every module is a box: `length` along the way it faces, `width` across, and
 * the deck height below — the third dimension the plane does not draw but does
 * account for. Its walls are a constant thickness, so a module does not get
 * proportionally sturdier by being drawn bigger, and everything else follows
 * from geometry:
 *
 * - **mass** from the volume of the walls, plus whatever machinery the
 *   archetype needs,
 * - **capacity** from the interior area left inside them,
 * - **strength** from wall thickness and reinforcement.
 *
 * The point of doing it this way is that balancing becomes *designing scaling
 * laws* instead of tuning a table of hundreds of part stats — and that a
 * genetic algorithm searching shape rather than a part index has something
 * continuous to search. The cost is that a mispriced exponent is an exploit:
 * if capacity grows as the square of size and mass only as the first power,
 * every ship worth building is one enormous module. Watch for that whenever a
 * law here changes; the GA will find it within a few generations.
 *
 * **The constants are calibrated against real hardware, not chosen for feel.**
 * That is what SI units are for (DESIGN.md §4): each one below records the
 * thing it was checked against, so a later change can be argued with rather
 * than merely preferred. They are a first cut — the numbers that make the
 * game good will differ, and moving them is expected — but they start
 * somewhere defensible and every derived figure can be sanity-checked against
 * a real ship or gun.
 */

/**
 * Unmodelled hull thickness, metres. The plane is a deck plan viewed from
 * above (DESIGN.md §3), so a module's third dimension is never drawn — but it
 * is what makes wall volumes and therefore masses honest.
 */
export const DECK_HEIGHT = 3;

/** Structural material density, kg/m³. Steel. */
export const HULL_DENSITY = 7800;

/**
 * Wall thickness at reinforcement 1, metres. Constant across module sizes, so
 * that scale reads honestly: a bigger tank is a bigger *thin-walled* tank, and
 * the only way to buy thickness is to pay for it.
 */
export const BASE_WALL_THICKNESS = 0.02;

/**
 * Thrust per unit of nozzle exit area, N/m². An RS-25 delivers about 2.2 MN
 * through a 4.2 m² exit, so half a megapascal; a tenth of that is a plausible
 * figure for an engine sized for endurance rather than for lifting itself off
 * a planet.
 */
export const THRUST_PER_EXIT_AREA = 5e4;

/**
 * Engine machinery mass per newton of thrust, kg/N. The RS-25 manages
 * 1.5e-3 (3.2 t for 2.2 MN); this is deliberately a little worse.
 */
export const ENGINE_MASS_PER_NEWTON = 2e-3;

/**
 * Bore as a fraction of the mount's width. A triple 16-inch turret is about
 * 10 m across the barbette for a 0.406 m bore, and a 5-inch mount about 4 m
 * for 0.127 m: both land near a twenty-fifth.
 */
export const CALIBRE_FRACTION = 0.04;

/**
 * Barrel length in calibres. Naval rifles run 45–55; the middle of that range
 * is the usual compromise between muzzle velocity and a barrel that can be
 * trained without the ship's own structure fouling it.
 */
export const BARREL_CALIBRES = 50;

/** Shell length in calibres. A real armour-piercing shell is 4–5. */
export const SHELL_CALIBRES = 4.5;

/**
 * Mean shell density, kg/m³. Below the density of steel because a shell is
 * ogive-nosed and part hollow, so it does not fill its own bounding cylinder.
 */
export const SHELL_DENSITY = 6200;

/**
 * Muzzle energy per unit of bore volume, J/m³. Calibrated on the 16"/50: a
 * 1225 kg shell at 762 m/s is 356 MJ from 2.6 m³ of bore. Solid propellant
 * holds around 6.4 GJ/m³, so this is a couple of per cent of the bore filled
 * with charge at realistic efficiency — which is about right.
 */
export const CHARGE_ENERGY_PER_BORE_VOLUME = 1.4e8;

/**
 * Loading cycle time per metre of calibre, seconds. A 16" gun manages a round
 * every 30 s and a 5" mount several times a minute; one number cannot honour
 * both, and this sits between them. The most obviously provisional constant
 * here, and the one a rate-of-fire exploit would come through.
 */
export const CYCLE_TIME_PER_CALIBRE = 40;

/**
 * Traverse torque the mount ring can deliver per kilogram of turret, N·m/kg.
 * Set so that a heavy turret reaches its rate limit in a couple of seconds.
 */
export const TRAVERSE_TORQUE_PER_KG = 2;

/**
 * Speed limit at the muzzle end of the barrel, m/s, which is what actually
 * constrains a mount: the tip of a long gun travels far further per degree
 * than a short one. A 16" turret trains at about 4°/s with a 15 m reach, or
 * roughly a metre a second.
 */
export const TRAVERSE_TIP_SPEED = 1.5;

export type ModuleKind = 'structure' | 'thruster' | 'turret';

/**
 * One module in a layout: what it is, where it sits, and how big it is.
 *
 * Positions are in the blueprint's own frame with an arbitrary origin;
 * compiling a blueprint re-expresses them about the centre of mass.
 */
export interface ModuleSpec {
  kind: ModuleKind;
  /** Centre of the module, metres. */
  x: number;
  y: number;
  /**
   * Which way it faces, radians, in the blueprint frame. This is the module's
   * local +x: the direction a thruster pushes the ship and the bearing a
   * turret rests at.
   */
  angle?: number;
  /** Extent along the facing, metres. */
  length: number;
  /** Extent across the facing, metres. */
  width: number;
  /**
   * Wall thickness multiplier, at least 1. Buying reinforcement buys armour
   * and structural strength, and pays for it in mass — which is the whole of
   * the armour trade-off.
   */
  reinforcement?: number;
}

/** What a gun derived from a turret module's geometry can do. */
export interface GunStats {
  /** Bore diameter, metres. */
  calibre: number;
  /** Muzzle to breech, metres. */
  barrelLength: number;
  /** Mass of one round, kg. */
  roundMass: number;
  /** Muzzle velocity, m/s. */
  muzzleSpeed: number;
  /** Kinetic energy of one round at the muzzle, joules. */
  muzzleEnergy: number;
  /** Seconds between rounds. */
  cycleTime: number;
}

/** Everything the scaling laws derive from a module's geometry. */
export interface ModuleStats {
  /** Wall thickness after reinforcement, metres. Also the armour it presents. */
  wallThickness: number;
  /** Volume of structural material in the walls, m³. */
  wallVolume: number;
  /** Mass of that structure, kg. */
  structureMass: number;
  /** Mass of the archetype's machinery and fittings, kg. */
  fittingMass: number;
  /** Structure plus fittings, kg. */
  mass: number;
  /** Floor area left inside the walls, m². What a store can hold. */
  capacity: number;
  /**
   * Moment of inertia about the module's own centre, kg·m². The box formula
   * in the plane; the deck height does not enter a rotation about the vertical
   * axis.
   */
  inertia: number;
  /**
   * Damage the module absorbs before it stops working. Its structure mass in
   * kilograms — matter is what stops a shell, so there is no separate
   * toughness constant to invent. A destroyed module keeps that matter and
   * goes on stopping shells (DESIGN.md §4); this is only the threshold at
   * which it stops *functioning*.
   */
  hitPoints: number;
  /** Thrust at full throttle, newtons. Zero unless the module is a thruster. */
  thrust: number;
  /** Gun derived from the mount, or null unless the module is a turret. */
  gun: GunStats | null;
}

/**
 * Why a module cannot exist, or null if it can.
 *
 * Separate from `moduleStats` so that an editor can report the problem rather
 * than catch an exception, and so the reasons live in one place.
 */
export function moduleProblem(spec: ModuleSpec): string | null {
  if (!(spec.length > 0) || !(spec.width > 0)) {
    return `${spec.kind}: length and width must be positive, got ${spec.length}x${spec.width}`;
  }
  const reinforcement = spec.reinforcement ?? 1;
  if (!(reinforcement >= 1)) {
    return `${spec.kind}: reinforcement must be at least 1, got ${reinforcement}`;
  }
  const thickness = BASE_WALL_THICKNESS * reinforcement;
  const smallest = spec.length < spec.width ? spec.length : spec.width;
  const limiting = smallest < DECK_HEIGHT ? smallest : DECK_HEIGHT;
  if (2 * thickness >= limiting) {
    return (
      `${spec.kind}: walls ${thickness.toFixed(3)} m thick leave no interior in a ` +
      `${spec.length}x${spec.width} m module`
    );
  }
  return null;
}

/** The scaling laws, applied. Throws if the module could not exist. */
export function moduleStats(spec: ModuleSpec): ModuleStats {
  const problem = moduleProblem(spec);
  if (problem !== null) throw new Error(`Invalid module — ${problem}`);

  const reinforcement = spec.reinforcement ?? 1;
  const wallThickness = BASE_WALL_THICKNESS * reinforcement;

  // The walls are what is left of the box once the interior is hollowed out of
  // it, on all six faces — so a long thin module carries proportionally more
  // wall for the space it encloses, which is the pressure that stops layouts
  // being made of splinters.
  const outer = spec.length * spec.width * DECK_HEIGHT;
  const inner =
    (spec.length - 2 * wallThickness) *
    (spec.width - 2 * wallThickness) *
    (DECK_HEIGHT - 2 * wallThickness);
  const wallVolume = outer - inner;
  const structureMass = wallVolume * HULL_DENSITY;

  const capacity =
    (spec.length - 2 * wallThickness) * (spec.width - 2 * wallThickness);

  let fittingMass = 0;
  let thrust = 0;
  let gun: GunStats | null = null;

  if (spec.kind === 'thruster') {
    // Thrust comes out of the nozzle, so it scales with the area of the face
    // the exhaust leaves through — the module's width by the deck height. A
    // thruster therefore gets stronger by being made *wider*, and gains
    // nothing from being made longer, which is what stops "just stretch it"
    // being the answer to every propulsion problem.
    thrust = THRUST_PER_EXIT_AREA * spec.width * DECK_HEIGHT;
    fittingMass = thrust * ENGINE_MASS_PER_NEWTON;
  } else if (spec.kind === 'turret') {
    gun = gunStats(spec.length, spec.width);
    // The gun itself: a barrel is a thick-walled tube, taken here as steel
    // filling the annulus between the bore and an outside diameter of twice
    // the calibre.
    const outerDiameter = 2 * gun.calibre;
    const barrelSection =
      PI * 0.25 * (outerDiameter * outerDiameter - gun.calibre * gun.calibre);
    fittingMass = barrelSection * gun.barrelLength * HULL_DENSITY;
  }

  const mass = structureMass + fittingMass;
  const inertia =
    (mass * (spec.length * spec.length + spec.width * spec.width)) / 12;

  return {
    wallThickness,
    wallVolume,
    structureMass,
    fittingMass,
    mass,
    capacity,
    inertia,
    hitPoints: structureMass,
    thrust,
    gun,
  };
}

/**
 * The gun a turret mount of this size carries.
 *
 * The bore is set by how wide the mount is, and the barrel by how long the
 * gun can be for that bore — so a turret is described by the same two numbers
 * as every other module, and its weapon falls out of them. Everything after
 * that is physics: charge energy scales with the volume of bore it fills,
 * shell mass with the cube of calibre, and muzzle velocity is whatever
 * dividing one by the other leaves.
 *
 * The trade this produces is the real one. Widening the mount buys a heavier
 * shell that hits harder but flies slower and reloads less often; lengthening
 * it buys velocity — flatter trajectory, shorter flight time, less lead to
 * misjudge — at the cost of a longer barrel that traverses more sluggishly.
 */
export function gunStats(mountLength: number, mountWidth: number): GunStats {
  const calibre = mountWidth * CALIBRE_FRACTION;
  // The barrel wants to be as long as its calibre allows, but a mount cannot
  // carry a gun longer than itself without fouling the rest of the ship.
  const wanted = calibre * BARREL_CALIBRES;
  const barrelLength = wanted < mountLength ? wanted : mountLength;

  const boreArea = PI * 0.25 * calibre * calibre;
  const roundMass = boreArea * (calibre * SHELL_CALIBRES) * SHELL_DENSITY;
  const muzzleEnergy = CHARGE_ENERGY_PER_BORE_VOLUME * boreArea * barrelLength;
  const muzzleSpeed = sqrt((2 * muzzleEnergy) / roundMass);

  return {
    calibre,
    barrelLength,
    roundMass,
    muzzleSpeed,
    muzzleEnergy,
    cycleTime: CYCLE_TIME_PER_CALIBRE * calibre,
  };
}

/**
 * Traverse rate limit for a mount of this mass and reach, radians per second.
 *
 * The limit is a speed at the muzzle rather than an angular rate, because that
 * is what the barrel's structure actually cares about — which makes a long gun
 * slower to bring round than a short one of the same weight, for a reason
 * rather than by fiat.
 */
export function traverseRate(reach: number): number {
  return TRAVERSE_TIP_SPEED / reach;
}

/** Traverse acceleration limit, radians per second squared. */
export function traverseAccel(mass: number, inertia: number): number {
  return (TRAVERSE_TORQUE_PER_KG * mass) / inertia;
}
