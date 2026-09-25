import type { Targeting } from './doctrine.js';
import { asin, atan2, cos, max, PI, sin, sqrt } from './math.js';

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
 *
 * Priced against the thrust the exit area could produce through a perfect
 * bell rather than against what the engine actually delivers, because what
 * this mass *is* — chamber, pumps, plumbing — is sized by the gas flowing
 * through the throat. A bad nozzle wastes that flow sideways; it does not
 * make the machinery behind it any smaller.
 */
export const ENGINE_MASS_PER_NEWTON = 2e-3;

/**
 * A nozzle's throat as a fraction of its exit width.
 *
 * Fixed, so that expansion is bought with *length*: widening an engine widens
 * the throat with it and buys area rather than a better bell. The renderer
 * draws the taper from this same number, so the bell on the screen is the one
 * the thrust is worked out from.
 */
export const NOZZLE_THROAT_FRACTION = 0.55;

/**
 * Bell skin thickness as a fraction of hull plate.
 *
 * A nozzle is sheet held in shape by the gas going through it, not armour and
 * not a pressure vessel, so it weighs a fraction of what the machinery box of
 * the same size does. This is the whole of why a long-belled engine is the
 * lighter one.
 */
export const NOZZLE_SKIN_FRACTION = 0.35;

/**
 * Machinery depth, in the engine's own widths, that feeds the throat at
 * `THRUST_PER_EXIT_AREA`.
 *
 * Measured against the engine's own width because that is what sets the
 * throat: the chamber and pumps have to fill the hole they are behind, and a
 * wide engine needs proportionally more machinery to do it. Which makes the
 * whole law a question of *proportions*, so an engine scaled up bodily
 * behaves the same.
 *
 * A third of a width, which is about what the engines people draw actually
 * have behind them: a mounting wider than it is deep is the usual shape, and
 * the reference engine has to be one somebody would draw. Set to a whole
 * width — the depth a *rocket* has — every ship in the game is starved to a
 * third of its thrust and stops being able to cross the distances its
 * scenarios put it at. This is the constant to move if a fleet ought to be
 * generally faster or slower; it decides nothing about the *shape* of the
 * knob, which is the throat and the bell arguing.
 */
export const PUMP_DEPTH_WIDTHS = 0.35;

/**
 * The most a chamber may over-feed its own throat, as a multiple of what
 * `THRUST_PER_EXIT_AREA` passes.
 *
 * A throat chokes: past the speed of sound in it, more pressure behind it
 * stops buying more flow through it, so there is an end to what stacking
 * machinery behind a hole can do. Without this, a long thin engine is
 * unbounded thrust for the price of being long — which is the shape of
 * exploit `§12` warns about for rate of fire, arriving instead through the
 * engine.
 */
export const THROAT_CHOKE = 2;

/**
 * How much of a module is the part that sticks out, when its layout does not
 * say: an engine's bell, a hull gun's barrel, a hull beam's lens housing.
 *
 * Half and half, which on an engine is enough expansion to be worth having
 * (`divergence` lands near 0.91 on a squarish one) while leaving a machinery
 * block big enough to bolt to on three sides, and on a hull mount is enough
 * barrel to be worth firing and enough block to load it from.
 */
export const DEFAULT_NOZZLE_SHARE = 0.5;

/**
 * Bore as a fraction of the mount's width. A triple 16-inch turret is about
 * 10 m across the barbette for a 0.406 m bore, and a 5-inch mount about 4 m
 * for 0.127 m: both land near a twenty-fifth.
 */
export const CALIBRE_FRACTION = 0.04;

/** A barrel's outside diameter in calibres. A tube is thick-walled steel. */
export const BARREL_OUTER_CALIBRES = 2;

/**
 * The most of its room a hull mount's barrel or lens may fill: of the face,
 * for one; of the gap between neighbours, for several.
 *
 * A rail rather than a price. For one outlet, what it protects is the traverse
 * rule: the barrel has to stay inside the opening it comes out of as it swings,
 * and one as wide as its own mount cannot move at all. For several, it keeps
 * them apart: they spread across the face the way a turret's barrels do, one
 * gap outboard of each end, and a barrel that filled its gap would touch the
 * next one.
 *
 * Outlets share one weapon's budget the way a turret's barrels do — a gun's
 * tubes divide the bore, a beam's lenses divide the optic's area — so the cap
 * seldom binds: a gun's tubes never do, and a beam's lenses only at dozens.
 */
export const HULL_BARREL_WIDTH_CAP = 0.8;

/**
 * Bore as a fraction of a hull mount's width, before the cap.
 *
 * More than twice a turret's, because the two pay for different things. A
 * turret's bore is small because everything it does — the ring, the barbette,
 * the hoists, the mass it has to swing — scales with the bore and has to fit
 * inside a circle. A hull mount swings nothing but the tube, so what it can
 * carry is set by the hole it is let into.
 *
 * Not an order of magnitude more, though it was tried: a bore near the width
 * of its own mount gives a barrel a handful of calibres long, and a gun with a
 * bore wider than its barrel is long is a mortar throwing a ninety-tonne shell
 * at walking pace. At this figure a hull gun on an 8x4 mount carries two and a
 * half times a 5x4 turret's bore and five times its muzzle energy for a little
 * under twice its mass — and has twenty-odd degrees to point it through
 * instead of a clear sky. That is the trade the archetype is for.
 */
export const HULL_CALIBRE_FRACTION = 0.1;

/**
 * The same for a beam's optic, which is a clearer case: an optic's limit is
 * the intensity its own face can pass, so a wider one is simply a stronger
 * beam, and what stops a turret having it is having to spin it.
 */
export const HULL_APERTURE_FRACTION = 0.1;

/**
 * Mass of a weapon's training gear, as a fraction of what it has to move.
 *
 * Every weapon that trains carries the ring, the drive and the bearings that
 * train it, and until this it carried none of them: a mount's mass was its
 * barrels and the machinery that loads them, as though it were pointed by
 * hand. A tenth, which is the right order for a roller path and a drive under
 * a turret and is the constant to move if mounts come out too heavy.
 *
 * **What it is a fraction of is what actually swings.** A turret turns bodily,
 * so its gear is sized by the whole mount; a hull weapon swings its barrels
 * in a bed that does not move, so its gear is sized by the barrels alone.
 * That is most of why a hull mount is the cheaper way to carry a big bore,
 * and it is what makes a *fixed* one free.
 */
export const TRAVERSE_GEAR_FRACTION = 0.1;

/**
 * The traverse a full ring buys, radians either way: all the way round.
 *
 * A hull weapon's bed sweeps a fraction of that, and pays that fraction of
 * the gear — so a mount limited to a few degrees carries a few per cent of
 * what a turret's ring costs, and one limited to nothing carries none of it.
 */
export const FULL_TRAVERSE = PI;

/**
 * The most a hull mount may train either way whatever its proportions,
 * radians.
 *
 * The opening is the rule that does the work and this is the rule that stops
 * it being gamed. A barrel short and thin enough for its own mount clears the
 * edges at any angle, and the geometry alone would then hand it a quarter turn
 * each way — a turret's field of fire with none of a turret's costs, which is
 * the cheapest thing in the game and exactly what a search would find. What is
 * really stopping it is the mounting: a weapon on trunnions in a hull recess
 * takes its recoil through a bed that faces one way.
 */
export const HULL_MAX_TRAVERSE = 30 * (PI / 180);

/**
 * The block depth, in calibres of the round it loads, that a hull gun reloads
 * at `CYCLE_TIME_PER_CALIBRE` in — the machinery a gun of that bore expects.
 *
 * Ten, which is what half the length of an 8x4 mount comes to at the bore that
 * mount carries. So a hull gun whose layout says nothing about its
 * proportions loads at exactly a turret's rate for its calibre, and the knob
 * moves it either way from there rather than up or down from it.
 */
export const LOADING_BLOCK_CALIBRES = 10;

/**
 * The share of a loading cycle no amount of machinery shortens.
 *
 * Opening the breech, running the round in, and the barrel coming back out of
 * recoil all take as long as they take: the hoist behind them can be the size
 * of a house and the gun still cannot fire until the shell is home. A quarter,
 * so a block twice the expected depth is worth about a third off the cycle and
 * a very large one approaches four times the rate rather than an unbounded
 * one — rate of fire is the figure an evolved design would run away with, and
 * this is what stops it.
 */
export const LOADING_FLOOR = 0.25;

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
 * How long a beam mount takes to be ready again after emptying its bank,
 * seconds.
 *
 * **A time rather than a rate, and that is not a simplification.** The bank
 * holds energy in proportion to the machinery's volume, and the plant and heat
 * sinks that refill it and dump what the shot made are the same machinery — so
 * the volume cancels and what is left is a property of the technology. A big
 * mount takes no longer to recover than a small one; it simply had more to
 * spend.
 *
 * Which is the whole of why depth is worth buying on a beam: the burn grows
 * with the bank and the recovery does not, so a deep mount spends more of its
 * time firing. Set so that a hull beam of the proportions an unsaid layout
 * gets — half block, half housing — works at about the flat quarter duty that
 * `BEAM_DUTY_CYCLE` assumes, so this refines that stop-gap where it applies
 * rather than moving the balance out from under it.
 */
export const BEAM_RECHARGE_TIME = 0.7;

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
 * Control machinery mass per square metre of a core's interior, kg/m².
 *
 * A control centre is a compartment given over to computing, communications
 * and the power conditioning that keeps both alive, so what it weighs follows
 * the floor it fills rather than the walls around it. Rather less than a deck
 * packed with equipment racks, rather more than a room with consoles in it.
 */
export const CORE_MASS_PER_AREA = 150;

/**
 * Least a core's machinery can weigh, kg, however small the compartment.
 *
 * Every ship in this game is computer-flown, so a core is a processor, its
 * power supply and the aerials that reach the rest of the ship — which is why
 * the floor is low enough that half a metre square is a working control
 * centre and a fighter can carry one. It binds only below that, and the point
 * of having it at all is that a core cannot be shrunk to nothing.
 */
export const CORE_MINIMUM_FITTING_MASS = 25;

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

export type ModuleKind =
  | 'structure'
  | 'core'
  | 'thruster'
  | 'turret'
  | 'beamTurret'
  | 'hullGun'
  | 'hullBeam';

/**
 * Every archetype there is, in one order.
 *
 * A list rather than a set of literals repeated wherever one is needed: the
 * file format, a run's mutation weights, the weighted draw itself and the
 * flattener each want to walk the kinds, and four copies of the same list is
 * four places to forget when an archetype is added — which is a bug that
 * shows up as a valid ship being refused, or as a kind nothing ever builds.
 *
 * The order is load-bearing in two of them, so it is fixed here rather than
 * per caller: the draw walks it, and the flattener sorts by it.
 */
export const MODULE_KINDS: readonly ModuleKind[] = [
  'structure',
  'core',
  'thruster',
  'turret',
  'beamTurret',
  'hullGun',
  'hullBeam',
];

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
   * How many barrels a turret has, or how many nozzles a thruster has — the
   * editor calls it Nozzles there.
   *
   * The same number because it is the same idea: one mount's budget divided
   * between several outlets. `n` barrels divide a gun's bore and `n` nozzles
   * divide an engine's exit face, so neither count is free power. What a
   * cluster of small bells buys an engine is expansion — a narrow nozzle
   * collimates in less length than a wide one — and a flame combed into `n`
   * fingers rather than thrown as one sheet.
   */
  barrels?: number;

  /**
   * How much of the module's length is the part that sticks out, as a
   * fraction from 0 to 1. The rest is the block behind it, which is where the
   * machinery lives and what the module is welded to the ship by.
   * `DEFAULT_NOZZLE_SHARE` when unsaid.
   *
   * **One field for three archetypes, because it is one quantity**, the way
   * `barrels` counts a turret's barrels and a thruster's nozzles alike: on a
   * `thruster` the protrusion is the bell and the block is chamber and pumps;
   * on a `hullGun` it is the barrel and the breech and loading gear; on a
   * `hullBeam` the lens housing and the bank and the plant. The editor names
   * it for the kind it is showing. Nothing else has one.
   *
   * It cuts both ways on every kind that has it, which is what makes it a
   * knob rather than a slider: bell length is aim bought with flow, barrel
   * length is muzzle velocity bought with rate of fire and with the traverse
   * the opening leaves. See `thrusterGeometry` and `hullMountGeometry`.
   *
   * Zero on an engine is legal and is a rocket whose bell has blown off: gas
   * thrown in every direction, about half the thrust, and a flame that goes
   * nowhere.
   */
  nozzle?: number;

  /**
   * How far a weapon may train either way from where it rests, radians. The
   * archetype's own limit when unsaid: all the way round for a turret, and
   * whatever its opening leaves for a hull mount.
   *
   * **It is a limit and not a capability** — asking for more than the mount
   * can do changes nothing, and what the ship itself is in the way of still
   * applies on top. Weapons only.
   *
   * What it costs is where the two archetypes differ, and the difference is
   * the machine rather than the rule. A turret's ring goes all the way round
   * whatever it is told to do with it, so limiting one is programming and
   * weighs exactly the same. A hull weapon's bed is built for the arc it
   * sweeps, so a narrower one is a simpler machine and a lighter one — and a
   * mount told to train nothing at all is a gun welded to the ship, which is
   * how a very light hull carries a very large bore.
   */
  traverse?: number;

  /**
   * What this mount goes after, where it differs from its archetype's default.
   *
   * Only the differences, and the rest comes from the kind rather than from
   * the hull: a mount answers "which of the things I can train on do I
   * shoot", which is not the question its ship answers about where to fly,
   * and `focusWeight` is what ties the two together. This is what makes a
   * close-in mount a close-in mount — "go for something a twentieth my ship's
   * mass" on the same hull whose main battery wants something its own size —
   * rather than a second kind of turret.
   */
  targeting?: Partial<Targeting>;

  /**
   * Whether this engine is pointed at things on purpose. Thrusters only.
   *
   * An exhaust burns whatever stands in it whoever meant it to (`exhaust.ts`),
   * so this changes nothing about what a plume *does* — it changes when the
   * engine burns. A weapon engine lights up on its own account the moment an
   * enemy is close enough behind it to take a real share of the flame, whether
   * or not the pilot wanted thrust just then, and the ship wears the push.
   *
   * A flag rather than a kind of module, because an engine used this way is
   * the same engine: it is still what moves the ship, still costs what an
   * engine costs, and can still be the only thing holding a heading. What a
   * designer is choosing is a *role* for a mount already on the hull.
   */
  weapon?: boolean;

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
  /** Gun derived from the mount, or null unless the module is a weapon. */
  gun: GunStats | null;
  /**
   * Mass of the gear that trains this weapon, kg, and zero for everything
   * else. Part of `fittingMass`, named separately because it is the one part
   * of a mount that its *arc* decides rather than its bore.
   */
  traverseMass: number;
  /**
   * Moment the traverse drive has to swing, about the point it swings it,
   * kg·m². The whole module for anything that turns bodily, and the barrels
   * alone about their root for a hull mount — which is why a gun let into a
   * hull trains briskly through the very little arc it has.
   */
  swingInertia: number;
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
  if (spec.nozzle !== undefined) {
    // A module that is all protrusion has no block: no chamber to burn in, no
    // breech to load from, and nothing to bolt to the ship. Nothing of it is
    // legal and continuous — the block running out of interior is what stops
    // it well before this.
    if (!(spec.nozzle >= 0) || !(spec.nozzle < 1)) {
      return `${spec.kind}: nozzle must be from 0 to under 1, got ${spec.nozzle}`;
    }
    // On a kind that does not read it the value is dormant — kept against a
    // refit back rather than refused, see `readsNozzle` — so only the range
    // applies there.
    //
    // Where zero means something different per archetype, so does whether it
    // is allowed: an engine with no bell is a rocket whose nozzle has fallen
    // off, which is a bad engine and a real one, while a weapon with no barrel
    // is not a weapon — a bore with no length to accelerate down fires its
    // shells at nothing a second.
    if (spec.nozzle === 0 && isHullMount(spec.kind)) {
      return `${spec.kind}: a hull mount needs some barrel, got ${spec.nozzle}`;
    }
  }
  if (spec.traverse !== undefined && !(spec.traverse >= 0)) {
    // Dormant on a kind that does not train, as a bell is on a gun mount: only
    // the range applies there. See `isWeaponMount`.
    return `${spec.kind}: traverse must be at least 0, got ${spec.traverse}`;
  }
  const thickness = BASE_WALL_THICKNESS * reinforcement;
  // For an engine it is the machinery block that has to be a box: the bell is
  // meant to be open at both ends. This is also what makes "all nozzle"
  // impossible by running out of block rather than by a rule of its own.
  const boxLength = spec.kind === 'thruster'
    ? thrusterGeometry(spec).machineryLength
    : isHullMount(spec.kind)
      ? hullMountGeometry(spec).blockLength
      : spec.length;
  const smallest = boxLength < spec.width ? boxLength : spec.width;
  const limiting = smallest < DECK_HEIGHT ? smallest : DECK_HEIGHT;
  if (2 * thickness >= limiting) {
    return (
      `${spec.kind}: walls ${thickness.toFixed(3)} m thick leave no interior in a ` +
      `${boxLength}x${spec.width} m module`
    );
  }
  if (isHullMount(spec.kind)) {
    const { traverse, outletWidth } = hullMountGeometry(spec);
    // A mount whose barrel cannot move at all is a gun welded pointing one
    // way, which is a fixed gun rather than a broken module — but one whose
    // outlets have no bore left is nothing at all.
    if (!(outletWidth > 0)) return `${spec.kind}: ${spec.barrels ?? 1} outlets leave no bore`;
    if (!(traverse >= 0)) return `${spec.kind}: barrel does not fit its own opening`;
  }
  if (spec.kind === 'thruster') {
    const { exitWidth, throatWidth } = thrusterGeometry(spec);
    const skin = thickness * NOZZLE_SKIN_FRACTION;
    if (2 * skin >= throatWidth) {
      return (
        `${spec.kind}: ${spec.barrels ?? 1} nozzles across ${spec.width} m leave a ` +
        `${throatWidth.toFixed(3)} m throat, which is all skin`
      );
    }
    if (exitWidth <= 0) return `${spec.kind}: nozzles leave no exit`;
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

/**
 * A thruster's two halves, and what the bell's shape does to the gas.
 *
 * An engine is a machinery block with a bell on the back of it. The block is
 * the structural part — it holds the chamber and the pumps, it is what the
 * engine is welded to the ship by, and it is what the mounting rule asks
 * about. The bell is sheet metal in the exhaust: it weighs little, it can be
 * bolted to nothing, and its *length* is the only thing that makes an engine
 * more than a hole with gas coming out of it.
 *
 * **Expansion is the whole trade.** Gas leaving a bell of half-angle `a`
 * keeps `(1 + cos a) / 2` of its momentum along the axis and throws the rest
 * sideways — the standard divergence correction, and the reason a real nozzle
 * is a long cone rather than a short flare. A bare throat is `a = 90°` and
 * loses half of everything; lengthening the bell recovers it, steeply at
 * first and then barely, so the first metre of bell is worth a great deal and
 * the fifth is worth almost nothing. That curve is the parameter's answer to
 * "why not make it all nozzle": a long bell costs length and structure for a
 * gain that has already been had.
 *
 * It is also why nozzle *count* interacts with it. Dividing the exit face
 * between `n` bells makes each one `n` times narrower, and a narrow bell
 * collimates in a fraction of the length — so a cluster is how a stubby
 * engine gets a good nozzle, and there is a reason to choose it beyond how
 * the flame is shaped.
 *
 * Fuel is not modelled yet. When it is, expansion buys efficiency as well as
 * thrust and this is where that comes from — ROADMAP.md §12.
 */
export interface ThrusterGeometry {
  /** Nozzles across the exit face, at least one. */
  nozzles: number;
  /** The bell's share of the module's length, 0 to 1. */
  share: number;
  /** Length of the machinery block, metres. Always positive. */
  machineryLength: number;
  /** Length of the bell, metres. Zero for a throat with nothing on it. */
  nozzleLength: number;
  /** Exit width of one nozzle, metres. The nozzles tile the face. */
  exitWidth: number;
  /** Throat width of one nozzle, metres. */
  throatWidth: number;
  /** Bell half-angle, radians. A right angle when there is no bell. */
  halfAngle: number;
  /** Momentum kept along the axis, `(1 + cos a) / 2`: 0.5 to 1. */
  divergence: number;
}

/** A thruster's halves and its bell geometry. Thrusters only. */
export function thrusterGeometry(spec: ModuleSpec): ThrusterGeometry {
  const nozzles = spec.barrels ?? 1;
  const share = spec.nozzle ?? DEFAULT_NOZZLE_SHARE;
  const nozzleLength = spec.length * share;
  const exitWidth = spec.width / nozzles;
  const throatWidth = exitWidth * NOZZLE_THROAT_FRACTION;
  // How far the wall has to travel sideways over the bell's length.
  const flare = (exitWidth - throatWidth) * 0.5;
  const halfAngle = atan2(flare, nozzleLength);
  // cos of that angle without going back through a trig function, and exactly
  // zero rather than nearly so when there is no bell at all.
  const axial = nozzleLength > 0 ? nozzleLength / sqrt(nozzleLength * nozzleLength + flare * flare) : 0;
  return {
    nozzles,
    share,
    machineryLength: spec.length - nozzleLength,
    nozzleLength,
    exitWidth,
    throatWidth,
    halfAngle,
    divergence: (1 + axial) * 0.5,
  };
}

/**
 * The machinery block as a box in its own right, for the questions that are
 * about how the engine is *held on*: what it overlaps, what it is welded to.
 *
 * A thruster's position is the middle of the face it pushes from, so the
 * block shares that position and is simply shorter — which is what makes this
 * a change of one field rather than a second geometry.
 */
export function thrusterMachinery(spec: ModuleSpec): ModuleSpec {
  return { ...spec, length: thrusterGeometry(spec).machineryLength };
}

/**
 * Where one nozzle's axis sits across the exit face, metres from the middle.
 *
 * The bells tile the face rather than being spaced out across it the way
 * barrels are: a gun's barrels are thin things with ship in between, while
 * nozzles divide up a face that is entirely exhaust.
 */
export function nozzleOffset(geometry: ThrusterGeometry, index: number): number {
  return (index - (geometry.nozzles - 1) * 0.5) * geometry.exitWidth;
}

/**
 * Material in a thruster's bells, m³.
 *
 * Every bell is an open-ended tapered duct: two flanks running down the slant
 * and a roof and floor spanning the taper, in skin a fraction of hull plate
 * thick. Nothing is enclosed, which is the point — a bell holds no cargo, has
 * no interior to hollow out, and weighs a small fraction of what the same
 * length of machinery block does.
 */
function nozzleSkinVolume(geometry: ThrusterGeometry, wallThickness: number): number {
  const { nozzles, nozzleLength, exitWidth, throatWidth } = geometry;
  if (!(nozzleLength > 0)) return 0;
  const flare = (exitWidth - throatWidth) * 0.5;
  const slant = sqrt(nozzleLength * nozzleLength + flare * flare);
  const meanWidth = (exitWidth + throatWidth) * 0.5;
  const area = 2 * slant * DECK_HEIGHT + 2 * meanWidth * nozzleLength;
  return area * wallThickness * NOZZLE_SKIN_FRACTION * nozzles;
}


/**
 * A thruster's moment about its own centre, kg·m².
 *
 * Two pieces sitting at different places along the engine, so the box formula
 * over the whole declared length would be wrong twice over: it puts the heavy
 * machinery further aft than it is, and it treats a light bell as though it
 * were packed as densely as the block. A cluster of bells is spread across the
 * face as well, which the single-box formula cannot see at all.
 */
function thrusterInertia(
  spec: ModuleSpec,
  geometry: ThrusterGeometry,
  blockMass: number,
  skinMass: number,
): number {
  const { machineryLength, nozzleLength, nozzles, exitWidth } = geometry;
  // Both pieces are measured from the middle of the whole engine, which is
  // half a bell ahead of the block's middle and half a block behind the
  // bells'.
  const blockOffset = nozzleLength * 0.5;
  const bellOffset = machineryLength * 0.5;
  let inertia =
    (blockMass * (machineryLength * machineryLength + spec.width * spec.width)) / 12 +
    blockMass * blockOffset * blockOffset;

  const perBell = skinMass / nozzles;
  for (let i = 0; i < nozzles; i++) {
    const across = nozzleOffset(geometry, i);
    inertia +=
      (perBell * (nozzleLength * nozzleLength + exitWidth * exitWidth)) / 12 +
      perBell * (bellOffset * bellOffset + across * across);
  }
  return inertia;
}

/**
 * A hull mount's two halves, and the traverse its own barrel leaves it.
 *
 * A hull weapon is a **block with a barrel out of the front of it**, which is
 * the same shape an engine is and the opposite way round: the block holds the
 * breech, the loading gear or the capacitor bank, and it is the only part that
 * may be welded to anything. The barrel is out in the open and welds to
 * nothing, which is what stops a designer using a gun as a girder.
 *
 * **It trains about the point where the two meet**, not about the middle of
 * the module, because that is where the trunnions of such a mount are: the
 * block does not move and only the tube swings. So a hull gun trains quickly —
 * there is very little to swing — through almost no angle at all.
 *
 * **How little is geometry rather than a number.** The barrel has to stay
 * inside the opening it comes out of, so the far corner of a tube
 * `barrelLength` long and `barrelWidth` across, pivoted at its root, must not
 * pass the mount's own edge: `L·sin t + (w/2)·cos t <= W/2`. That is one
 * `asin` away from the limit, and it says the useful things by itself — a
 * longer barrel trains less, a fatter one trains less, a wider mount trains
 * more, and a barrel too fat for its opening does not train at all.
 */
export interface HullMountGeometry {
  /** Barrels or lenses across the face, at least one. */
  outlets: number;
  /** The barrel's share of the module's length, 0 to 1. */
  share: number;
  /** Length of the block, metres. Always positive. */
  blockLength: number;
  /** Length of the barrel or lens housing, metres. */
  barrelLength: number;
  /** Width of one barrel or lens, metres, after `HULL_BARREL_WIDTH_CAP`. */
  outletWidth: number;
  /** Centre to centre, metres: the face in `outlets + 1` gaps, as a turret's barrels. Zero for one. */
  outletSpacing: number;
  /** Across the whole row, outer edge to outer edge, metres. What swings in the opening. */
  barrelWidth: number;
  /** How far ahead of the module's centre the barrels pivot, metres. */
  pivot: number;
  /** Half-width of the traverse the opening leaves, radians. */
  traverse: number;
}

/** A hull mount's halves, its outlets and the arc its own barrel leaves it. */
export function hullMountGeometry(spec: ModuleSpec): HullMountGeometry {
  const outlets = spec.barrels ?? 1;
  const share = spec.nozzle ?? DEFAULT_NOZZLE_SHARE;
  const barrelLength = spec.length * share;
  // What a single outlet would be, and each of several split the way a
  // turret splits it: tubes divide the bore, so each is `1/n` as wide; lenses
  // divide the optic's area, so each is `1/√n` as wide.
  const single =
    spec.kind === 'hullBeam'
      ? HULL_APERTURE_FRACTION * spec.width
      : BARREL_OUTER_CALIBRES * HULL_CALIBRE_FRACTION * spec.width;
  const each = spec.kind === 'hullBeam' ? single / sqrt(outlets) : single / outlets;
  // Spread across the face as a turret's barrels are, one gap outboard of
  // each end, so neighbours stand apart rather than touching.
  const outletSpacing = outlets > 1 ? spec.width / (outlets + 1) : 0;
  const cap = HULL_BARREL_WIDTH_CAP * (outlets > 1 ? outletSpacing : spec.width);
  const outletWidth = each < cap ? each : cap;
  const barrelWidth = (outlets - 1) * outletSpacing + outletWidth;
  const blockLength = spec.length - barrelLength;

  // The corner of the swung barrel against the edge of the opening.
  const half = barrelWidth * 0.5;
  const radius = sqrt(barrelLength * barrelLength + half * half);
  const corner = atan2(half, barrelLength);
  const reach = spec.width * 0.5;
  // A barrel already as wide as its opening has nowhere to go; one small
  // enough to clear the edges at any angle is held by its mounting instead.
  const limit = radius > reach ? asin(reach / radius) - corner : HULL_MAX_TRAVERSE;

  return {
    outlets,
    share,
    blockLength,
    barrelLength,
    outletWidth,
    outletSpacing,
    barrelWidth,
    pivot: spec.length * 0.5 - barrelLength,
    traverse: limit > 0 ? (limit < HULL_MAX_TRAVERSE ? limit : HULL_MAX_TRAVERSE) : 0,
  };
}

/** Whether this kind trains a weapon, and so carries gear to train it with. */
export function isWeaponMount(kind: ModuleKind): boolean {
  return kind === 'turret' || kind === 'beamTurret' || isHullMount(kind);
}

/**
 * How far this mount may train either way, radians: what it was told, what its
 * archetype allows, and the narrower of the two.
 *
 * What the *ship* is in the way of is a separate question and a later one —
 * it belongs to the layout rather than to the module, so `compileBlueprint`
 * asks it, and this stays a property of the mount alone.
 */
export function mountTraverse(spec: ModuleSpec): number {
  const archetype = isHullMount(spec.kind) ? hullMountGeometry(spec).traverse : FULL_TRAVERSE;
  const asked = spec.traverse;
  if (asked === undefined) return archetype;
  return asked < archetype ? asked : archetype;
}

/** Whether this kind is a weapon let into the hull rather than a turret on it. */
export function isHullMount(kind: ModuleKind): boolean {
  return kind === 'hullGun' || kind === 'hullBeam';
}

/**
 * Which optional fields a kind actually reads.
 *
 * **A field a kind does not read is allowed to sit on it, holding its value.**
 * Mutation refits a module from one archetype to another and back, and a
 * lineage that has spent twenty generations tuning a bell should not lose it
 * to a spell as a gun mount — so a dormant field is kept rather than cleared,
 * and wakes with the value it had. What is *not* allowed is a dormant field in
 * a file: `serialiseBlueprint` writes only what the kind reads and the file
 * format refuses the rest, so a saved ship still says exactly what it is and a
 * hand-written `nozzle` on a turret is still a mistake rather than a secret.
 *
 * Ranges are checked on a dormant value all the same, since the point of
 * keeping one is that it is ready to be used.
 */
export function readsNozzle(kind: ModuleKind): boolean {
  return kind === 'thruster' || isHullMount(kind);
}

/** Whether `barrels` means anything on this kind: barrels, outlets or nozzles. */
export function countsOutlets(kind: ModuleKind): boolean {
  return kind === 'turret' || kind === 'beamTurret' || kind === 'thruster' || isHullMount(kind);
}

/** Whether `weapon` means anything on this kind. Only an engine has a plume to point. */
export function readsWeapon(kind: ModuleKind): boolean {
  return kind === 'thruster';
}

/**
 * The part of a module another module may be welded to.
 *
 * The whole of it for nearly everything, and the **block alone** for a hull
 * mount: a barrel sticking out of a ship is not somewhere to hang the rest of
 * the ship from, and letting it weld would make a long gun the cheapest spar
 * in the game. Both the layout rule and the connectivity graph ask
 * `contactWidth`, and `contactWidth` asks this, so the two cannot disagree
 * about what is attached to what.
 *
 * The barrel is still *there* — it takes up room, nothing may overlap it, and
 * it stops shells like any other matter. What it does not do is hold the ship
 * together.
 */
export function weldBox(spec: ModuleSpec): ModuleSpec {
  if (!isHullMount(spec.kind)) return spec;
  const { blockLength, barrelLength } = hullMountGeometry(spec);
  const angle = spec.angle ?? 0;
  const back = barrelLength * 0.5;
  return {
    ...spec,
    length: blockLength,
    x: spec.x - cos(angle) * back,
    y: spec.y - sin(angle) * back,
  };
}

/**
 * A gun let into a hull: as big a bore as the opening allows, and nowhere to
 * point it.
 *
 * The derivations are the turret's — a bore, a barrel to accelerate a shell
 * down, a shell that is so many calibres long — and only what sets the bore
 * and the barrel length differs. The bore comes from the **opening** rather
 * than from a fraction of the mount, since there is no ring to fit inside;
 * the barrel length is **authored**, as the share of the module the designer
 * gave to it, rather than being whatever the calibre wanted. That is the
 * trade the archetype exists for: length is muzzle energy, and length is also
 * the traverse it no longer has.
 */
export function hullGunStats(spec: ModuleSpec): GunStats {
  const { outlets, outletWidth, outletSpacing, barrelLength, blockLength } = hullMountGeometry(spec);
  const calibre = outletWidth / BARREL_OUTER_CALIBRES;
  const boreArea = PI * 0.25 * calibre * calibre;
  const roundMass = boreArea * (calibre * SHELL_CALIBRES) * SHELL_DENSITY;
  const muzzleEnergy = CHARGE_ENERGY_PER_BORE_VOLUME * boreArea * barrelLength;
  const muzzleSpeed = roundMass > 0 ? sqrt((2 * muzzleEnergy) / roundMass) : 0;

  return {
    type: GunType.Projectile,
    calibre,
    barrelLength,
    barrelCount: outlets,
    barrelSpacing: outletSpacing,
    roundMass,
    muzzleSpeed,
    muzzleEnergy,
    beamPower: 0,
    // One block loads every tube, so its depth is measured against the bore
    // they share rather than each tube's own.
    cycleTime: hullCycleTime(calibre, blockLength, outlets) / outlets,
    beamOnTime: 0,
  };
}

/**
 * How long a hull gun takes to load, seconds.
 *
 * **The block is the loading gear**, so how deep it is decides how fast the
 * gun works: the hoist, the rammer and the heat the breech has to lose all
 * live in it, and a gun given nothing but a barrel is one being fed by hand.
 * Measured in calibres of the round rather than in metres, because what the
 * machinery has to move is the shell — so the same proportions mean the same
 * rate of fire whatever size the mount is drawn at.
 *
 * `LOADING_FLOOR` of the cycle is fixed and the rest scales with the depth,
 * which is what makes it a trade with the barrel rather than a second way of
 * saying "bigger is better": every metre given to the barrel is a metre of
 * muzzle velocity bought with rounds per minute, and the ceiling on what
 * loading machinery can do stops a stub-barrelled mount being a free
 * autocannon.
 */
function hullCycleTime(calibre: number, blockLength: number, outlets: number): number {
  const base = CYCLE_TIME_PER_CALIBRE * calibre;
  const depth = blockLength / (LOADING_BLOCK_CALIBRES * calibre * outlets);
  // A block with no depth at all is a gun with nowhere to load from, and the
  // arithmetic would say it never fires. It is unreachable — a module needs an
  // interior to exist — but the law should not depend on that to be finite.
  if (!(depth > 0)) return base / LOADING_FLOOR;
  return base * (LOADING_FLOOR + (1 - LOADING_FLOOR) / depth);
}

/**
 * A beam let into a hull. The same shape of answer as `hullGunStats`, and the
 * same two departures from its turret: the optic is as wide as the opening
 * allows, and how deep its housing runs is authored.
 *
 * **The bank is in the block**, so giving the length to the housing takes it
 * off how long the beam can be held on. That is the beam's version of the
 * gun's trade, and it is why the same rule was worth trying on both before
 * inventing a second one.
 */
export function hullBeamStats(spec: ModuleSpec): GunStats {
  const { outlets, outletWidth, outletSpacing, barrelLength, blockLength } = hullMountGeometry(spec);
  const aperture = outletWidth;
  const apertureArea = PI * 0.25 * aperture * aperture;
  const power = OPTIC_INTENSITY_LIMIT * apertureArea;
  const stored = BEAM_STORED_ENERGY_PER_VOLUME * blockLength * spec.width * DECK_HEIGHT;
  const beamOnTime = power > 0 ? stored / power : 0;
  // **The block is the bank and the cooling, so depth buys duty rather than
  // only burst.** The burn grows with the bank behind it while the recovery
  // does not, so a mount given more block spends a larger share of its time
  // firing — where a flat duty cycle would have made a bigger bank buy a
  // longer shot and an exactly proportionally longer wait, which is no gain at
  // all on the only figure that matters over a battle.
  const cycleTime = beamOnTime + BEAM_RECHARGE_TIME;

  return {
    type: GunType.Beam,
    calibre: aperture,
    barrelLength,
    barrelCount: outlets,
    barrelSpacing: outletSpacing,
    roundMass: 0,
    muzzleSpeed: -1,
    muzzleEnergy: 0,
    beamPower: power,
    beamOnTime,
    cycleTime,
  };
}

export function moduleStats(spec: ModuleSpec): ModuleStats {
  const problem = moduleProblem(spec);
  if (problem !== null) throw new Error(`Invalid module — ${problem}`);

  const reinforcement = spec.reinforcement ?? 1;
  const wallThickness = BASE_WALL_THICKNESS * reinforcement;

  // A thruster is a box with a bell on the back of it rather than one box, and
  // only the box part is walled. Every other archetype is the box it declares.
  const engine = spec.kind === 'thruster' ? thrusterGeometry(spec) : null;
  const mount = isHullMount(spec.kind) ? hullMountGeometry(spec) : null;
  const boxLength =
    engine !== null ? engine.machineryLength : mount !== null ? mount.blockLength : spec.length;

  // The walls are what is left of the box once the interior is hollowed out of
  // it, on all six faces — so a long thin module carries proportionally more
  // wall for the space it encloses, which is the pressure that stops layouts
  // being made of splinters.
  const outer = boxLength * spec.width * DECK_HEIGHT;
  const inner =
    (boxLength - 2 * wallThickness) *
    (spec.width - 2 * wallThickness) *
    (DECK_HEIGHT - 2 * wallThickness);
  // Bells, which are skins rather than boxes: two flanks along the slant and a
  // roof and floor over the taper, with nothing enclosed and both ends open.
  const skinVolume = engine === null ? 0 : nozzleSkinVolume(engine, wallThickness);
  const wallVolume = outer - inner + skinVolume;
  const structureMass = wallVolume * HULL_DENSITY;

  const capacity = (boxLength - 2 * wallThickness) * (spec.width - 2 * wallThickness);

  let fittingMass = 0;
  let thrust = 0;
  let gun: GunStats | null = null;
  // Mass that hangs off the pivot as a rod rather than filling the box, and
  // the inertia it accounts for. Barrels, and nothing else so far.
  let rodMass = 0;
  let rodInertia = 0;
  let traverseMass = 0;
  // What the traverse drive actually has to swing, about the point it swings
  // it. The same as the module for a turret, which turns bodily; the barrels
  // alone for a hull mount, whose block is welded to the ship.
  let swing = 0;

  if (spec.kind === 'core') {
    // What flies the ship: a compartment of computing rather than a box with
    // space left in it, so its machinery is priced by the floor it fills. A
    // core buys no capability beyond being the control centre, so this mass
    // and the fragility of a small one are the whole of what stops a ship
    // carrying five of them.
    fittingMass = max(CORE_MINIMUM_FITTING_MASS, CORE_MASS_PER_AREA * capacity);
  } else if (engine !== null) {
    // Thrust comes out of the nozzle, so it scales with the area of the face
    // the exhaust leaves through — the module's width by the deck height,
    // however many bells that face is divided into. A thruster therefore gets
    // stronger by being made *wider*, which is what stops "just stretch it"
    // being the answer to every propulsion problem.
    //
    // **How hard that face is fed is the machinery's business**, and the
    // machinery is the block the bell was cut out of. A shallow bell leaves a
    // deep chamber with big pumps and drives more mass through the same
    // throat; a deep bell leaves an engine with nothing behind it. Bounded by
    // the throat itself, which chokes rather than passing whatever is pushed
    // at it.
    const feed = engine.machineryLength / (PUMP_DEPTH_WIDTHS * spec.width);
    const supply = feed < THROAT_CHOKE ? feed : THROAT_CHOKE;
    const throughput = THRUST_PER_EXIT_AREA * spec.width * DECK_HEIGHT * supply;
    // What the bell then keeps pointed the right way. **The two pull opposite
    // ways**, which is the whole of the knob: length taken off the bell is
    // flow gained and aim lost, so the best engine is neither all bell nor all
    // chamber but somewhere inside, and an engine whose nozzle has fallen off
    // throws its gas sideways however hard it is pumping.
    thrust = throughput * engine.divergence;
    fittingMass = throughput * ENGINE_MASS_PER_NEWTON;
  } else if (mount !== null) {
    gun = spec.kind === 'hullGun' ? hullGunStats(spec) : hullBeamStats(spec);
    // The same two masses a turret carries, by the same reasoning — a tube of
    // steel or an optic out in front, and the machinery that works it behind.
    let protrudingMass: number;
    if (spec.kind === 'hullGun') {
      const outer = BARREL_OUTER_CALIBRES * gun.calibre;
      const section = PI * 0.25 * (outer * outer - gun.calibre * gun.calibre);
      protrudingMass = section * gun.barrelLength * HULL_DENSITY;
      fittingMass =
        (protrudingMass + MECHANISM_MASS_PER_CALIBRE * gun.calibre) * gun.barrelCount;
    } else {
      protrudingMass = OPTIC_AREAL_DENSITY * PI * 0.25 * gun.calibre * gun.calibre;
      fittingMass = (protrudingMass + BEAM_MASS_PER_WATT * gun.beamPower) * gun.barrelCount;
    }

    // What swings is the barrels alone, about the root they are trunnioned at
    // rather than about the middle of the module — the block does not move.
    // Each is a rod running out from that root, so it carries `m L²/3` there,
    // plus `m d²` for sitting off the centreline.
    rodMass = protrudingMass * gun.barrelCount;
    // **The bed is built for the arc it sweeps**, and what has to be built to
    // move is the whole weapon: the trunnions and the drive, but also a feed
    // and a recoil path that work at every angle the gun is allowed. So the
    // gear is a share of the weapon's own machinery, times how much of its
    // own archetype's arc it asks for — and a mount told to train nothing is
    // a gun welded to the ship, carrying none of it. That is how a light hull
    // affords a heavy bore.
    // A mount whose barrel does not fit its own opening trains nothing and is
    // refused elsewhere; here it simply carries no gear rather than dividing
    // by its own zero.
    const sweep = mount.traverse > 0 ? mountTraverse(spec) / mount.traverse : 0;
    traverseMass = fittingMass * TRAVERSE_GEAR_FRACTION * sweep;
    fittingMass += traverseMass;
    const spin = (protrudingMass * gun.barrelLength * gun.barrelLength) / 3;
    const middle = (protrudingMass * gun.barrelLength * gun.barrelLength) / 12;
    const ahead = mount.pivot + gun.barrelLength * 0.5;
    for (let barrel = 0; barrel < gun.barrelCount; barrel++) {
      const offset = (barrel - (gun.barrelCount - 1) * 0.5) * gun.barrelSpacing;
      swing += spin + protrudingMass * offset * offset;
      // The module's own moment wants them about its centre instead, which is
      // the rod's own moment plus where its centre of mass actually sits.
      rodInertia += middle + protrudingMass * (ahead * ahead + offset * offset);
    }
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
    // **A turret's ring goes all the way round whatever it is told.** The gear
    // is sized by the whole mount, since that is what turns, and a limit on
    // where it may point is programming rather than a simpler machine — so
    // unlike a hull mount's bed this does not shrink when the arc does.
    traverseMass = (structureMass + fittingMass) * TRAVERSE_GEAR_FRACTION;
    fittingMass += traverseMass;
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
    engine !== null
      ? thrusterInertia(spec, engine, structureMass - skinVolume * HULL_DENSITY + fittingMass,
          skinVolume * HULL_DENSITY)
      : mount !== null
        ? // The block sits half a barrel aft of the module's middle, and the
          // barrels have already been measured from there.
          (boxMass * (mount.blockLength * mount.blockLength + spec.width * spec.width)) / 12 +
          boxMass * (mount.barrelLength * 0.5) * (mount.barrelLength * 0.5) +
          rodInertia
        : (boxMass * (spec.length * spec.length + spec.width * spec.width)) / 12 + rodInertia;

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
    traverseMass,
    swingInertia: mount === null ? inertia : swing,
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
