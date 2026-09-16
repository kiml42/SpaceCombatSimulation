import { cos, PI, sin, sqrt } from './math.js';

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
 *
 * Note what they are, though: a *law* here is the functional form, while a
 * constant is a choice of material or technology. `HULL_DENSITY` is steel and
 * `CHARGE_ENERGY_PER_BORE_VOLUME` is a chemical propellant, neither of which
 * is a fact about the universe. Better materials belong to a module rather
 * than to this file, and a genuinely different technology — a railgun, whose
 * energy comes from a power supply and not a charge — is a new archetype
 * rather than a new number. ROADMAP.md §12 records how that separation works
 * when it is made.
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
 * Loading machinery mass per metre of calibre, kg/m. Every barrel needs its
 * own hoist, rammer and breech, and what those are sized by is the round they
 * move rather than the gun that fires it.
 *
 * Calibrated on the Mk 45 5"/54: a 22 t mount whose barrel is about 2 t by the
 * annulus below, leaving several tonnes of loader drum and hoist for a 0.127 m
 * bore. At the other end of the range it gives a 16"/50 sixteen tonnes of
 * loading gear per gun, against a rotating structure of some 1700 t — plausible
 * at both ends, which is the most that can be said for it.
 *
 * Linear in calibre and not in the cube of it, deliberately: a rammer is a
 * machine sized by the round's diameter and stroke, and it does not shrink to
 * a scale model of itself the way a mass of steel would.
 *
 * Note what linearity does to a multi-barrel mount, because it is exact rather
 * than approximate. Splitting a mount's bore across `n` barrels divides the
 * calibre by `n`, so `n` mechanisms each linear in calibre come to
 * `MECHANISM_MASS_PER_CALIBRE * width * CALIBRE_FRACTION` however many barrels
 * there are: the loading machinery is sized by the mount's bore *budget* and
 * not by how it is divided up. That is coherent, and it puts a floor under a
 * multi-barrel mount that the tubes alone do not — barrel steel falls away as
 * `n^-3/2` — but it is a floor and not a penalty. If barrels are to cost mass
 * rather than merely stop being free, this exponent is the dial: below linear
 * the total rises with `n`, above it the total falls. ROADMAP.md §12 holds the
 * open question.
 */
export const MECHANISM_MASS_PER_CALIBRE = 4e4;

/**
 * A laser's final optic, as a fraction of the mount's smaller face.
 *
 * Smaller than it sounds, and for a real reason: a laser weapon is mostly the
 * plant behind the mirror — pumping, power conditioning, the capacitor bank and
 * the cooling that all of it needs — so the aperture is a modest disc on the
 * front of a box full of machinery, not a telescope with a gun bolted on.
 *
 * It is the mount's *smaller* dimension for the same reason a gun's row of
 * barrels is: a turret traverses, so its footprint is the circle inscribed in
 * it. And it is a single disc rather than a row, because splitting an aperture
 * makes every part of it spread faster — see `beamGunStats`.
 *
 * This one is calibrated on the game rather than on hardware, and it is worth
 * being plain about that. What it decides is the range at which a beam starts
 * to spread — `D² / 2.44λ`, from the diffraction below — and at a twentieth of
 * the face the shipped mounts land between about 9 km and 190 km. That puts
 * the interesting part of the curve inside the engagement ranges this game
 * intends to reach, which is the whole point of the number. Pick it much larger
 * and no beam ever spreads at any range worth fighting at; much smaller and
 * every beam is diffuse before it arrives.
 */
export const BEAM_APERTURE_FRACTION = 0.05;

/**
 * Intensity the final optic can pass without destroying itself, W/m².
 *
 * This is what sets a beam mount's power: unlike a gun, whose charge could in
 * principle be made arbitrarily large, a laser is limited by its own last
 * mirror. Dielectric coatings damage somewhere around 10^7–10^8 W/m² under
 * continuous load today; at 2·10^8 this is a couple of times better, which is
 * the licence a new technology gets against one that has been optimised for
 * six centuries.
 *
 * Note what it does to the design space. Power goes as the *square* of the
 * aperture, so widening a mount buys output steeply — and the same widening
 * spreads that output over a bigger spot at short range. Which of those wins
 * is a damage-model question (ROADMAP.md §12).
 */
export const OPTIC_INTENSITY_LIMIT = 2e8;

/**
 * Energy in the mount's capacitor bank per cubic metre of mount, J/m³.
 *
 * A beam mount does not reload; it discharges. The bank is what lets it put
 * out far more power than the ship's plant can supply, for as long as the bank
 * lasts, and that is what `beamOnTime` measures.
 *
 * Supercapacitors reach something like 10 MJ/m³, so this is a few per cent of
 * the mount given over to storage and the rest to optics, pumping and cooling
 * — which is the right shape for a weapon whose real problem is heat.
 */
export const BEAM_STORED_ENERGY_PER_VOLUME = 1.2e5;

/**
 * Fraction of the time a beam mount can be firing.
 *
 * **A stop-gap until power and heat are modelled**, which are what actually
 * decide this: the bank refills at whatever the ship's plant can spare, and
 * the mount can keep it up until its heat sinks are full. Neither exists, so
 * the recharge is a flat fraction rather than a rate. When power lands, this
 * constant is what it replaces.
 */
export const BEAM_DUTY_CYCLE = 0.25;

/**
 * Depth of the emitter housing, in apertures.
 *
 * A laser has no barrel. What protrudes is the housing round the final optic,
 * and it is as deep as the optic is wide rather than fifty times. That is most
 * of why a beam mount trains faster than a gun of the same size: the mass is
 * the same box, but there is no long rod of steel held out in front of it.
 */
export const BEAM_EMITTER_APERTURES = 1.5;

/**
 * Areal density of the final optic, kg/m².
 *
 * The JWST primary manages 26 kg/m² in beryllium, but it is never slewed hard
 * and nobody shoots at it. Sixty is that mirror built to be trained at degrees
 * a second and to survive its own ship manoeuvring.
 */
export const OPTIC_AREAL_DENSITY = 60;

/**
 * Laser head, pumping and power conditioning, kg per watt of beam.
 *
 * A current fibre system runs to tens of kilograms per kilowatt all in — the
 * US Navy's HELIOS is 60 kW in several tonnes. A tenth of a kilogram per
 * kilowatt is some five hundred times better, which is a large claim and the
 * one the whole archetype rests on: it is what makes a beam mount lighter than
 * a gun, and therefore quicker onto a target.
 */
export const BEAM_MASS_PER_WATT = 1e-4;

/**
 * Traverse torque the mount ring can deliver per kilogram of turret, N·m/kg.
 * A bigger turret gets a bigger ring, so the torque available grows with the
 * mass it has to shift; what it does not grow with is how that mass is spread,
 * which is why a long-barrelled gun is sluggish and a compact one is not.
 */
export const TRAVERSE_TORQUE_PER_KG = 2;

/**
 * How long the traverse drive takes to wind a mount up from rest to its rate
 * limit, seconds. It is the whole of what sets that limit: a drive that can
 * accelerate briskly is geared to run fast, and one that cannot is not, so a
 * mount's top speed and its acceleration are the same fact stated twice.
 *
 * Two seconds puts a light mount at well over a hundred degrees a second and a
 * 16" turret at single figures — slow enough that a heavy gun needs a steady
 * platform, quick enough that a point-defence mount can hold a bearing against
 * a ship that is itself turning.
 */
export const TRAVERSE_SPINUP_TIME = 2;

export type ModuleKind = 'structure' | 'thruster' | 'turret' | 'beamTurret';

/**
 * One module in a layout: what it is, where it sits, and how big it is.
 *
 * Positions are in the blueprint's own frame with an arbitrary origin;
 * compiling a blueprint re-expresses them about the centre of mass.
 */
export interface ModuleSpec {
  kind: ModuleKind;
  /**
   * Where the module is bolted to the ship, metres — which is its centre for
   * every kind but a thruster.
   *
   * A thruster is the one module with a side that means something: it is held
   * on by the face it pushes from and exhausts out of the other, so that face
   * is the only part of it whose position the rest of the ship cares about.
   * Its position is therefore the middle of *that* face, and the engine runs
   * back from there along its own facing — so a thruster made longer grows
   * out into the exhaust rather than half into the hull it is mounted on, and
   * lengthening one is one number rather than two. `moduleCentre` is where the
   * box actually sits, and everything geometric goes through it.
   */
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

  /**
   * specifies the number of barrels for a turret.
   */
  barrels?: number;

  /**
   * Why this module is here, in the author's own words. Carried through the
   * file format and the editor, and ignored by every scaling law.
   *
   * It exists because the alternative is losing the reasoning: a layout's
   * numbers say what a ship is and never why it was drawn that way, and a
   * comment in a source file does not survive being edited by a tool.
   */
  notes?: string;
}

export enum GunType {
  'Projectile' = 0,
  'Beam' = 1
}

/** What a gun derived from a turret module's geometry can do. */
export interface GunStats {
  /** What type of gun is this, projectile, beam etc. */
  type: GunType;
  /** Bore diameter, metres. */
  calibre: number;
  /** Muzzle to breech, metres. */
  barrelLength: number;
  /** Number of barrels. */
  barrelCount: number;
  /** Centre-to-centre distance between adjacent barrels across the mount, metres. */
  barrelSpacing: number;
  /** Mass of one round, kg. */
  roundMass: number;
  /** Muzzle velocity, m/s. */
  muzzleSpeed: number;
  /** Kinetic energy of one round at the muzzle, joules. */
  muzzleEnergy: number;
  /** beam power at the muzzle, watts. */
  beamPower: number;
  /** Seconds between rounds. */
  cycleTime: number;
  /** Seconds a beam stays on. */
  beamOnTime: number;
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
   * in the plane for the module itself — the deck height does not enter a
   * rotation about the vertical axis — plus each barrel as a rod running out
   * from that centre, which is where a turret's sluggishness comes from.
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
  if (spec.barrels !== undefined) {
    // Whole barrels only. A fractional count divides the calibre and the cycle
    // time perfectly happily, so nothing downstream complains — but the firing
    // order steps through it modulo the count, landing on positions between
    // barrels, while a renderer counting whole barrels draws a different number
    // from the one the gun fires out of.
    if (!(spec.barrels >= 1) || !Number.isInteger(spec.barrels)) {
      return `${spec.kind}: barrels must be a whole number of at least 1, got ${spec.barrels}`;
    }
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
/**
 * Where a module's box sits, which is its position for every kind but a
 * thruster — see `ModuleSpec.x`.
 *
 * Everything that asks a geometric question about a module goes through this:
 * its corners, what it overlaps, what it blocks, where its mass acts, and
 * where it is drawn. A caller that reads `spec.x` directly for any of those is
 * asking where the module is *attached* and using the answer as though it were
 * the middle, which for an engine is half its length out.
 */
export function moduleCentre(spec: ModuleSpec): { x: number; y: number } {
  if (spec.kind !== 'thruster') return { x: spec.x, y: spec.y };
  const angle = spec.angle ?? 0;
  const back = spec.length / 2;
  return { x: spec.x - cos(angle) * back, y: spec.y - sin(angle) * back };
}

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
  // Mass that hangs off the pivot as a rod rather than filling the box, and
  // the inertia it accounts for. Barrels, and nothing else so far.
  let rodMass = 0;
  let rodInertia = 0;

  if (spec.kind === 'thruster') {
    // Thrust comes out of the nozzle, so it scales with the area of the face
    // the exhaust leaves through — the module's width by the deck height. A
    // thruster therefore gets stronger by being made *wider*, and gains
    // nothing from being made longer, which is what stops "just stretch it"
    // being the answer to every propulsion problem.
    thrust = THRUST_PER_EXIT_AREA * spec.width * DECK_HEIGHT;
    fittingMass = thrust * ENGINE_MASS_PER_NEWTON;
  } else if (spec.kind === 'turret' || spec.kind === 'beamTurret') {
    gun = spec.kind === 'turret'
      ? gunStats(spec.length, spec.width, spec.barrels)
      : beamGunStats(spec.length, spec.width, spec.barrels);

    // What hangs off the front of the mount, per barrel or emitter. The two
    // archetypes differ in what that is and in almost nothing else: both are a
    // mass held out ahead of the pivot, and both pay for it in traverse.
    let protrudingMass: number;
    if (spec.kind === 'turret') {
      // A barrel is a thick-walled tube, taken as steel filling the annulus
      // between the bore and an outside diameter of twice the calibre.
      const outerDiameter = 2 * gun.calibre;
      const barrelSection =
        PI * 0.25 * (outerDiameter * outerDiameter - gun.calibre * gun.calibre);
      protrudingMass = barrelSection * gun.barrelLength * HULL_DENSITY;
      // Plus the machinery behind each barrel, which every barrel needs its own
      // of and which does not scale down as steeply as the tube does.
      const mechanismMass = MECHANISM_MASS_PER_CALIBRE * gun.calibre;
      fittingMass = (protrudingMass + mechanismMass) * gun.barrelCount;
    } else {
      // A laser's mass is its optic and the plant that feeds it, and neither
      // resembles a gun's. There is no tube of steel and no loading machinery,
      // which is why a beam mount comes out lighter than a gun on the same
      // footprint — and, having nothing long held out in front, quicker round.
      protrudingMass = OPTIC_AREAL_DENSITY * PI * 0.25 * gun.calibre * gun.calibre;
      const headMass = BEAM_MASS_PER_WATT * gun.beamPower;
      fittingMass = (protrudingMass + headMass) * gun.barrelCount;
    }

    // What protrudes is the one part of a module that is not shaped like the
    // box it is declared as: each piece is a rod running outward from the pivot
    // at the mount's centre, so it contributes `m L²/3` rather than its share
    // of the box, plus `m d²` for sitting `d` off the centreline. This is what
    // makes reach cost traverse — the box formula cannot see a barrel at all,
    // and under it a long gun and a stubby one of the same weight came round
    // equally fast.
    rodMass = protrudingMass * gun.barrelCount;
    const spin = (protrudingMass * gun.barrelLength * gun.barrelLength) / 3;
    for (let barrel = 0; barrel < gun.barrelCount; barrel++) {
      const offset = (barrel - (gun.barrelCount - 1) * 0.5) * gun.barrelSpacing;
      rodInertia += spin + protrudingMass * offset * offset;
    }
  }

  const mass = structureMass + fittingMass;
  // Everything but the barrels rotates as the box it is: walls, and machinery
  // packed inside them.
  const boxMass = mass - rodMass;
  const inertia =
    (boxMass * (spec.length * spec.length + spec.width * spec.width)) / 12 +
    rodInertia;

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
 *
 * **Multiple barrels** put a row of what are essentially independent guns on
 * one mount, firing in turn, so the mount's rate of fire rises — twice over,
 * since each barrel is narrower than a single gun would be and a narrower gun
 * cycles faster. They are a little longer than one gun could be, since a row
 * of tubes braces itself.
 *
 * Two rules shape that row, and they are independent of each other. Saying so
 * is worth the space, because they look related and are not:
 *
 * - **How much bore.** A mount of a given width is allowed a fixed total bore,
 *   `width * CALIBRE_FRACTION`, and `n` barrels divide it — so calibre falls as
 *   `1/n`. This is a *budget*, not a packing constraint: the barrels never come
 *   close to filling the face, and there would be room for far more of them.
 *   What it says is that a mount of a given size is worth the same weight of
 *   metal downrange however it is arranged, and the interesting choice is
 *   whether to spend it on one heavy shell or many light ones.
 * - **Where the barrels go.** They spread evenly right across the mount face
 *   with `n + 1` equal gaps, so there is one whole gap outboard of each end
 *   barrel and the row is as wide as the mount can make it. Nothing is chosen
 *   here — the face and the barrel count between them fix the spacing, which
 *   is why there is no constant. It cannot overhang, either: the row spans
 *   `(n-1)/(n+1)` of the face and that is under 1 for every `n`.
 *
 * The face in question is the *smaller* of the mount's two dimensions, because
 * a turret traverses. At rest the row lies across the width; ninety degrees
 * round it lies along the length, and a mount wider than it is long would
 * otherwise sweep a row of barrels through whatever is beside it. Taking the
 * lesser makes the mount's footprint the circle inscribed in it, which is what
 * a barbette is.
 *
 * Note what this does *not* model: the barrels fire parallel, never converged,
 * so a barrel `d` off the mount's centreline misses the aim point by `d` at
 * every range. That is a real effect and currently a small one, ships being
 * far wider than the row; against small targets it would bite, and harmonising
 * the barrels to converge at a chosen range is the natural answer when it does.
 */
export function gunStats(mountLength: number, mountWidth: number, barrelCount: number = 1): GunStats {
  const calibre = (mountWidth * CALIBRE_FRACTION) / barrelCount;
  // The barrel wants to be as long as its calibre allows, but a mount cannot
  // carry a gun longer than itself without fouling the rest of the ship.
  const wanted = calibre * BARREL_CALIBRES * sqrt(barrelCount);
  const barrelLength = wanted < mountLength ? wanted : mountLength;

  const boreArea = PI * 0.25 * calibre * calibre;
  const roundMass = boreArea * (calibre * SHELL_CALIBRES) * SHELL_DENSITY;
  const muzzleEnergy = CHARGE_ENERGY_PER_BORE_VOLUME * boreArea * barrelLength;
  const muzzleSpeed = sqrt((2 * muzzleEnergy) / roundMass);
  // One whole gap outboard of each end barrel, so `n` barrels make `n + 1`
  // gaps. Zero rather than a notional half-face for a single barrel, which has
  // nothing to be spaced from.
  const mountFace = mountWidth < mountLength ? mountWidth : mountLength;
  const barrelSpacing = barrelCount > 1 ? mountFace / (barrelCount + 1) : 0;

  return {
    type: GunType.Projectile,
    calibre,
    barrelLength,
    barrelCount,
    barrelSpacing,
    roundMass,
    muzzleSpeed,
    muzzleEnergy,
    beamPower: 0,
    cycleTime: (CYCLE_TIME_PER_CALIBRE * calibre) / barrelCount,
    beamOnTime: 0
  };
}

/**
 * The beam a laser mount of this size projects.
 *
 * A laser is not a gun with the shell removed, and almost none of a gun's
 * arithmetic survives the translation. There is no bore, no charge, no round
 * and no barrel; what there is instead is an aperture, a power limit set by
 * that aperture, and a bank of stored energy that decides how long the mount
 * can hold the trigger down.
 *
 * **Width buys power, length buys endurance.** The optic sits across the
 * mount's smaller face and the power it can pass goes as its area, so a wider
 * mount projects a harder beam. The capacitor bank fills the mount's volume,
 * so a *longer* mount of the same width holds the beam on for longer without
 * making it any stronger. The dwell that falls out is `L/W` — an aspect ratio
 * and not a size, so a mount cannot buy endurance simply by being huge.
 *
 * That is deliberately the opposite trade from a gun, where width buys weight
 * of shell and length buys muzzle velocity. The two archetypes want differently
 * shaped mounts, which is most of what makes having both interesting.
 *
 * **What is not modelled here, and why it is worth knowing about.** A beam
 * leaving an aperture `D` at wavelength `λ` spreads at `1.22 λ / D`, so its
 * spot at range `R` is `D + 2.44 λ R / D` and the intensity that does the
 * damage is the power divided by that area. Nothing consumes intensity yet —
 * a hit is a hit — so the figure is not computed, but it is the reason the
 * aperture is sized as it is, and ROADMAP.md §12 holds the rest: that a small
 * aperture concentrates harder while a large one reaches further, that
 * wavelength moves the same curve, and that reflective armour answers it.
 *
 * **Multiple barrels are a discount, not a bargain.** `n` emitters divide the
 * optic's *area*, so each is `D/√n` across and passes `1/n` the power: the
 * mount's total output is unchanged however it is split, exactly as a gun's
 * bore budget is. What splitting costs is focus — every sub-beam spreads `√n`
 * times faster than the single optic would have. There is no reason to build
 * one until a mount can track more than one target, and if every design
 * settles on a single emitter that is the laws working rather than failing.
 */
export function beamGunStats(mountLength: number, mountWidth: number, barrelCount: number = 1): GunStats {
  // One disc, or `n` discs dividing the same area between them.
  const face = mountWidth < mountLength ? mountWidth : mountLength;
  const aperture = (face * BEAM_APERTURE_FRACTION) / sqrt(barrelCount);
  const apertureArea = PI * 0.25 * aperture * aperture;

  // What the optic can pass without destroying itself, which is the whole of
  // what limits a beam mount's output.
  const power = OPTIC_INTENSITY_LIMIT * apertureArea;

  // The bank fills the mount, and feeds one emitter at a time.
  const stored = BEAM_STORED_ENERGY_PER_VOLUME * mountLength * mountWidth * DECK_HEIGHT;
  const beamOnTime = stored / power;

  // No barrel: a housing round the optic, as deep as the optic is wide.
  const barrelLength = aperture * BEAM_EMITTER_APERTURES;

  // Emitters spread across the mount face the same way barrels do, for the
  // same reason — one whole gap outboard of each.
  const barrelSpacing = barrelCount > 1 ? face / (barrelCount + 1) : 0;

  return {
    type: GunType.Beam,
    calibre: aperture,
    barrelLength,
    barrelCount,
    barrelSpacing,
    // A beam has no round, so nothing here describes one. Negative muzzle
    // speed is how a weapon says it arrives the instant it is fired.
    roundMass: 0,
    muzzleSpeed: -1,
    muzzleEnergy: 0,
    beamPower: power,
    beamOnTime,
    cycleTime: beamOnTime / BEAM_DUTY_CYCLE,
  };
}

/**
 * Traverse rate limit, radians per second, for a mount whose drive accelerates
 * it at `accel`.
 *
 * The rate is not an independent property of the mount: it is however fast the
 * drive gets it going in `TRAVERSE_SPINUP_TIME`. So the same thing that makes a
 * turret slow to accelerate — a lot of mass held far from the pivot — makes it
 * slow at the top end, and a compact mount is quick at both.
 */
export function traverseRate(accel: number): number {
  return accel * TRAVERSE_SPINUP_TIME;
}

/**
 * Traverse acceleration limit, radians per second squared.
 *
 * Torque grows with the mount's mass and resistance with its inertia, so what
 * survives is a ratio: mass alone does not slow a mount down, but mass spread
 * out along a barrel does.
 */
export function traverseAccel(mass: number, inertia: number): number {
  return (TRAVERSE_TORQUE_PER_KG * mass) / inertia;
}
