import type { UnreadKeys } from './unread.js';
import type { Targeting } from './doctrine.js';
import { abs, asin, atan2, cos, max, PI, round, sin, sqrt } from './math.js';
import {
  canShape,
  insetTriangle,
  MAX_CORNERS,
  normalizeShape,
  polygonArea,
  polygonMomentOfArea,
  triangleAcross,
  triangleBounds,
  triangleOf,
  triangleRadius,
  TRIANGLE_CORNERS,
} from './shape.js';

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
 * How deep one layer is, metres, and so the deepest a module in only one of
 * them can be (`moduleThickness`). The plane is a deck plan viewed from above
 * (DESIGN.md §3), so a module's third dimension is never drawn — but it is
 * what makes wall volumes and therefore masses honest.
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
 * Exhaust velocity of an ideal engine, m/s: what its gas would leave at if
 * all of it went straight out of the back.
 *
 * Futuristic on purpose. The best chemical engines manage about 4.4 km/s (an
 * Isp near 450 s); this is a drive that heats its reaction mass with something
 * far hotter than combustion, so even the worst engine `engineExhaustVelocity`
 * allows beats any flying today. It sets how long a tank lasts, and with
 * `FUEL_DENSITY` how much tank a ship needs to fight a battle on full thrust.
 */
export const EXHAUST_VELOCITY = 2e4;

/**
 * The most efficiency a small throat can lose, as a fraction of its exhaust
 * velocity.
 *
 * Losses to the walls — heat soaking into them, gas slowed against them —
 * scale with a chamber's surface and output with its volume, so a small engine
 * is the less efficient one, as small thrusters are in practice. Bounded, so
 * a tiny engine is worse rather than useless.
 */
export const SMALL_ENGINE_LOSS = 0.3;

/**
 * The throat width at which an engine has lost half of `SMALL_ENGINE_LOSS`,
 * metres. A fighter's thrusters sit below it and a capital's mains well above.
 */
export const SMALL_ENGINE_THROAT = 0.25;

/**
 * Density of reaction mass, kg/m³: liquid methane.
 *
 * A drive that only heats its propellant can throw whatever is denser and
 * easier to keep than hydrogen. Water would be denser still, and makes a tank
 * the size of a module several times heavier than the ship around it.
 */
export const FUEL_DENSITY = 420;

/**
 * Drag coefficient of a round driving through fuel. About what a fast
 * projectile meets in water.
 */
export const FUEL_DRAG_COEFFICIENT = 0.3;

/** The volume inside a module's walls and any sealing lining, m³. */
export function interiorVolume(stats: ModuleStats): number {
  return stats.interior;
}

/**
 * Density of a sealing lining, kg/m³: rubber, which swells where fuel reaches it
 * and so closes a hole punched through it.
 */
export const SEALANT_DENSITY = 1100;

/**
 * How fast a lining closes a hole, as the width it closes a second per metre of
 * lining, 1/s. A 20 mm lining closes a fragment's pinhole in under a second and
 * a shell's 200 mm gash in ten.
 */
export const SEAL_SPEED = 1;

/**
 * How wide a hole a lining can close, in its own thicknesses. Wider than this
 * and the lining swells as far as it can and the rest stays open.
 */
export const SEAL_REACH = 10;

/** Whether `sealing` means anything on this kind: what holds fuel. */
export function readsSealing(kind: ModuleKind): boolean {
  return kind === 'tank' || kind === 'core';
}

/** How thick a module's sealing lining is, metres: zero where its kind has none. */
export function liningOf(spec: ModuleSpec): number {
  return readsSealing(spec.kind) ? (spec.sealing ?? 0) : 0;
}

/** Standard gravity, m/s², for stating an exhaust velocity as a specific impulse. */
export const STANDARD_GRAVITY = 9.80665;

/**
 * How much of an engine is bell when its layout does not say.
 *
 * Half and half, which is enough expansion to be worth having (`divergence`
 * lands near 0.91 on a squarish one) while leaving a machinery block big
 * enough to bolt to on three sides.
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

/** How long before its aim point a round bursts when its mount does not say, seconds. */
export const DEFAULT_FUSE = 0.02;

/**
 * The widest bore a turret carries, metres: a tube no wider outside than the
 * deck is deep, so a barrel is always a cylinder the hull can hold. A beam's
 * housing is held to the same, being drawn as wide.
 */
export const MAX_TURRET_CALIBRE = DECK_HEIGHT / BARREL_OUTER_CALIBRES;

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
 * half times a 5x4 turret's bore and three times its muzzle energy for about
 * half as much mass again — and has twenty-odd degrees to point it through
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
 * The longest barrel that holds itself up, in calibres: a turret's barrel when
 * its layout does not say, and the length muzzle energy is calibrated at.
 * Naval rifles run 45–55, and past that a tube sags and whips when it fires.
 */
export const BARREL_CALIBRES = 50;

/**
 * A hull gun's barrel when its layout does not say, in calibres: half of an
 * 8x4 mount, the proportions the editor draws one at. A hull gun's bore comes
 * from its opening and is far wider for its mount than a turret's, so a
 * turret's fifty calibres would not fit inside one.
 */
export const DEFAULT_HULL_BARREL_CALIBRES = 10;

/** The longest barrel any gun may have, in calibres, however well braced. */
export const MAX_BARREL_CALIBRES = 100;

/**
 * Width of the bracing either side of a barrel longer than `BARREL_CALIBRES`,
 * in calibres. It runs for as long as the barrel is over that, so past it each
 * metre of barrel costs its own tube and a metre of bracing too.
 *
 * Neighbouring barrels share the bracing between them, so a row of `n` needs
 * `n + 1` strips rather than `2n` — which is the discount a multi-barrel mount
 * gets for being a row.
 */
export const BRACE_CALIBRES = 1;

/** Shell length in calibres. A real armour-piercing shell is 4–5. */
export const SHELL_CALIBRES = 4.5;

/**
 * Mean density of solid shot, kg/m³. Below the density of steel because the
 * round is ogive-nosed, so it does not fill its own bounding cylinder. A shell
 * that bursts is lighter still, for the charge it carries (`chargeShare`).
 */
export const SHELL_DENSITY = 6200;

/** Density of the bursting charge, kg/m³. A cast high explosive. */
export const EXPLOSIVE_DENSITY = 1650;

/**
 * Energy a kilogram of charge gives the casing it bursts, J/kg: the Gurney
 * energy of a typical high explosive, so a burst's speed decides how much of
 * the shell has to be charge (`chargeShare`).
 */
export const EXPLOSIVE_YIELD = 2.9e6;

/** Fragments a shell bursts into when its mount does not say. One or fewer is solid shot. */
export const DEFAULT_FRAGMENTS = 8;

/** The most fragments a shell may burst into: each is a round in flight. */
export const MAX_FRAGMENTS = 64;

/**
 * How fast fragments leave a burst when the mount does not say, m/s. About
 * a fifth of the shell is then charge, so a shell is about 84% of the mass
 * of solid shot.
 */
export const DEFAULT_BURST_SPEED = 650;

/**
 * Muzzle energy per unit of bore volume, J/m³, for a barrel `BARREL_CALIBRES`
 * long. Calibrated on the 16"/50: a 1225 kg shell at 762 m/s is 356 MJ from
 * 2.6 m³ of bore. Solid propellant holds around 6.4 GJ/m³, so this is a couple
 * of per cent of the bore filled with charge at realistic efficiency.
 *
 * Shorter barrels get it in proportion. Longer ones get less (`muzzleEnergyOf`):
 * the charge has burnt by then, and gas that is only expanding pushes less
 * the further it goes, so each calibre past fifty is worth less than the last.
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
 * Interior a core needs for itself, m³; whatever it has beyond this is fuel
 * tank, so a bare core with one engine can move (ROADMAP.md §8). A core no
 * bigger than this holds no fuel and pays nothing else for it.
 */
export const CORE_COMPUTING_VOLUME = 1;

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
  | 'tank'
  | 'core'
  | 'engine'
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
  'tank',
  'core',
  'engine',
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
   * every kind but an engine.
   *
   * An engine is the one module with a side that means something: it is held
   * on by the face it pushes from and exhausts out of the other, so that face
   * is the only part of it whose position the rest of the ship cares about.
   * Its position is therefore the middle of *that* face, and the engine runs
   * out from there along its own facing, bell last — so an engine made longer grows
   * out into the exhaust rather than half into the hull it is mounted on, and
   * lengthening one is one number rather than two. `moduleCentre` is where the
   * box actually sits, and everything geometric goes through it.
   */
  x: number;
  y: number;
  /**
   * Which way it faces, radians, in the blueprint frame. This is the module's
   * local +x, the way whatever sticks out of it points: the bearing a turret
   * rests at, a hull weapon's barrel, and an engine's bell — so an engine
   * pushes the ship the opposite way.
   */
  angle?: number;
  /** Extent along the facing, metres. */
  length: number;
  /** Extent across the facing, metres. */
  width: number;
  /**
   * Three corners, flat `x, y` pairs in the module's own frame, which make it
   * a **triangle** rather than the box its length and width describe. Hull and
   * store only (`canShape`), and absent on everything else.
   *
   * The corners are what the author places, one at a time, and the whole of
   * what the module is: its mass, its walls, what a shot crosses, what it is
   * welded to and what a turret cannot see past all come from them. What they
   * buy is a hull that can draw a prow — a shape a packing of rectangles can
   * only step towards — and they cost the two things a rectangle has that a
   * triangle does not: a face to grow by, and a face for something to stick
   * out of. That is why only the two archetypes with nothing protruding may
   * have them.
   *
   * **Centred on the triangle's own centroid and wound anticlockwise**
   * (`normalizeShape`), so `x`/`y` goes on meaning the middle the module's
   * mass acts at. `length` and `width` stay filled in as the box the corners
   * fit inside, for the format's sake — a refit, a mutation, the editor's
   * number boxes — and are derived rather than authored: that box is not
   * centred on the module's position, so nothing that asks where the matter is
   * may read them.
   */
  vertices?: readonly number[];
  /**
   * Wall thickness multiplier, at least 1. Buying reinforcement buys armour
   * and structural strength, and pays for it in mass — which is the whole of
   * the armour trade-off.
   */
  reinforcement?: number;

  /**
   * How many barrels a turret has, or how many nozzles an engine has — the
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
   * How much of an engine's length is bell, as a fraction from 0 to 1. The
   * rest is the chamber and pumps behind it, which is what the engine is
   * welded to the ship by. `DEFAULT_NOZZLE_SHARE` when unsaid.
   *
   * It cuts both ways, which is what makes it a knob rather than a slider:
   * bell length is aim bought with flow. See `engineGeometry`.
   *
   * Zero is legal and is a rocket whose bell has blown off: gas thrown in
   * every direction, about half the thrust, and a flame that goes nowhere.
   */
  nozzle?: number;

  /**
   * How long a gun's barrels are, in calibres of its bore. A turret's run out
   * from its pivot; a hull gun's take that much of the module's length and
   * leave the rest as the block that loads them. The function of the same
   * name gives the default when unsaid.
   *
   * Length is muzzle energy, less so past `BARREL_CALIBRES`, and costs steel,
   * swing and — on a hull gun — rate of fire and traverse. Past that a barrel
   * needs bracing, so each calibre costs more, and nothing may exceed
   * `MAX_BARREL_CALIBRES`. Guns only: a laser's housing has one best depth.
   */
  barrelCalibres?: number;

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
   * How long before it would reach its aim point a gun's round bursts,
   * seconds. `DEFAULT_FUSE` when absent. Zero bursts at the aim point, which
   * still counts on a miss or on what is behind the target. A shell only
   * (`firesShells`).
   */
  fuse?: number;
  /**
   * How many fragments a gun's round bursts into. `DEFAULT_FRAGMENTS` when
   * absent; one or fewer fires solid shot, all metal and never bursting. A
   * projectile gun only (`readsFuse`).
   */
  fragments?: number;
  /**
   * How fast the fragments leave the burst, m/s. `DEFAULT_BURST_SPEED` when
   * absent. Faster needs more of the shell to be charge, so a lighter shell.
   * A shell only.
   */
  burstSpeed?: number;

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
   * Whether this engine is pointed at things on purpose. Engines only.
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
   * Whether this module is free of the deck's depth (`moduleThickness`):
   * as deep as it is across, rather than held to `DECK_HEIGHT`. Nothing to a
   * module no more than a deck across, which is as deep as it is wide either
   * way (`canThicken`) — **except structure**, which may always be marked.
   *
   * What is thick stands up through the weapons layer as well as the hull
   * (`inWeaponsLayer`). Thick structure is cover: it stops turret fire at whatever
   * is behind it. A thick hull weapon or engine gets a wider barrel or
   * nozzle, and machinery that keeps growing with the square of the width. It
   * pays in wall, in turrets being able to reach it, and in the arcs of every
   * turret it stands in front of.
   *
   * **Thick structure takes its depth from what it is welded to**, which is
   * the whole of why a plate narrower than a deck may be marked at all. Held
   * to its own width, a strip of plating laid along a thick module would stand
   * a third as high as the thing it was meant to be covering and stop nothing
   * aimed at it — so a thick plate is as deep as the deepest module it
   * touches, and no thinner than it would have been on its own. It is paid for
   * at that depth: a plate standing as high as a citadel has a citadel's area
   * of wall to carry, so applique armour costs what the steel in it costs.
   *
   * A neighbour offers the depth it has *of its own* and never one it
   * borrowed, so depth does not travel: a run of plating over a hull stands as
   * high as whatever is under each part of it rather than carrying the best
   * module's depth along the run.
   */
  thick?: boolean;

  /**
   * How thick a self-sealing lining is inside the walls, metres; zero or absent
   * for none. A tank or a core only. Thicker closes a hole faster and closes a
   * wider one (`SEAL_SPEED`, `SEAL_REACH`), and weighs more and holds less.
   */
  sealing?: number;

  /**
   * Why this module is here, in the author's own words. Carried through the
   * file format and the editor, and ignored by every scaling law.
   *
   * It exists because the alternative is losing the reasoning: a layout's
   * numbers say what a ship is and never why it was drawn that way, and a
   * comment in a source file does not survive being edited by a tool.
   */
  notes?: string;
  /** Keys its file carried that nothing reads, kept to be written back (`UnreadKeys`). */
  unread?: UnreadKeys;
}

export enum GunType {
  'Projectile' = 0,
  'Beam' = 1
}

/**
 * What a shell scatters when it bursts — absent on solid shot and on a beam.
 *
 * It is what a gun is loaded with rather than what it is, so it is filled in
 * by `loaded` beside the other things the shell changes about the round.
 */
export interface BurstStats {
  /** How many fragments one round bursts into. */
  fragments: number;
  /** How wide one fragment is, metres. */
  fragmentWidth: number;
  /** How far they have spread by the time the burst reaches the aim point, metres. */
  radius: number;
}

/** What a gun derived from a turret module's geometry can do. */
export interface GunStats {
  /** What type of gun is this, projectile, beam etc. */
  type: GunType;
  /** Bore diameter, metres. */
  calibre: number;
  /** Muzzle to breech, metres. */
  barrelLength: number;
  /**
   * How much of each barrel is braced, metres, out from its root: what it
   * runs past `BARREL_CALIBRES`. Zero for a barrel that holds itself up.
   */
  braceLength: number;
  /** Width of each strip of bracing, metres. */
  braceWidth: number;
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
  /** Seconds spent reloading between shots: after a beam's burst, not including it. */
  cycleTime: number;
  /** Seconds a beam stays on. */
  beamOnTime: number;
  /** What its shell bursts into, or null for solid shot and for a beam. */
  burst: BurstStats | null;
}

/** Seconds from one shot to the next: a beam's burst, then its reload. */
export function firingPeriod(gun: GunStats): number {
  return gun.type === GunType.Beam ? gun.beamOnTime + gun.cycleTime : gun.cycleTime;
}

/** Everything the scaling laws derive from a module's geometry. */
export interface ModuleStats {
  /**
   * How deep the module is, metres — `moduleThickness`, measured in the layout
   * it sits in, so a thick plate's borrowed depth is recorded here rather than
   * worked out again. What is deeper than `DECK_HEIGHT` stands in the weapons
   * layer, and a severed chunk keeps the depth it was built with.
   */
  thickness: number;
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
  /** Thrust at full throttle, newtons. Zero unless the module is an engine. */
  thrust: number;
  /**
   * How fast the exhaust leaves along the axis, m/s: thrust per kilogram of
   * fuel a second. Zero unless the module is an engine.
   */
  exhaustVelocity: number;
  /** Fuel the module holds when full, kg, counted in `mass`. Zero unless it is a tank. */
  fuel: number;
  /** Self-sealing lining inside the walls, metres; zero for none. */
  lining: number;
  /** Volume inside the walls and the lining, m³. */
  interior: number;
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
 * How far a triangle's corners may average off the module's own position
 * before the layout is refused, metres.
 *
 * A micron, which is a hundred-thousandth of the smallest module anyone draws
 * and far above the last-bit noise a turned frame leaves. It is not a
 * tolerance for sloppy authoring: a file whose corners do not average to the
 * position it declares is one where the mass acts somewhere other than where
 * every other law thinks the module is, and that disagreement is invisible
 * until a ship flies crabwise.
 */
const CENTROID_TOLERANCE = 1e-6;

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
  if (spec.vertices !== undefined) {
    // Not dormant the way a bell is: a shape nothing reads is a module drawn
    // as something other than what it weighs, so the kind has to admit it
    // rather than carry it until a refit back.
    if (!canShape(spec.kind)) {
      return `${spec.kind}: only structure and tanks may be given corners`;
    }
    if (spec.vertices.length !== TRIANGLE_CORNERS * 2) {
      return `${spec.kind}: a shaped module takes ${TRIANGLE_CORNERS} corners as x,y pairs, got ${spec.vertices.length / 2}`;
    }
    for (const value of spec.vertices) {
      if (!Number.isFinite(value)) return `${spec.kind}: a corner is not a number`;
    }
    if (polygonArea(spec.vertices) <= 0) {
      return `${spec.kind}: three corners in a line enclose nothing`;
    }
    // The centroid is the module's position, which is what keeps `x`/`y`
    // meaning the same thing it means for a box (`normalizeShape`).
    const cx = spec.vertices[0]! + spec.vertices[2]! + spec.vertices[4]!;
    const cy = spec.vertices[1]! + spec.vertices[3]! + spec.vertices[5]!;
    if (abs(cx) > CENTROID_TOLERANCE || abs(cy) > CENTROID_TOLERANCE) {
      return `${spec.kind}: corners must be centred on the module's own middle`;
    }
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
  }
  if (spec.barrelCalibres !== undefined) {
    // Dormant on a kind that does not read it, as a bell is: only the range.
    if (!(spec.barrelCalibres > 0) || !(spec.barrelCalibres <= MAX_BARREL_CALIBRES)) {
      return `${spec.kind}: barrel must be more than 0 and at most ${MAX_BARREL_CALIBRES} calibres, got ${spec.barrelCalibres}`;
    }
  }
  if (spec.traverse !== undefined && !(spec.traverse >= 0)) {
    // Dormant on a kind that does not train, as a bell is on a gun mount: only
    // the range applies there. See `isWeaponMount`.
    return `${spec.kind}: traverse must be at least 0, got ${spec.traverse}`;
  }
  if (spec.fuse !== undefined && !(spec.fuse >= 0)) {
    return `${spec.kind}: fuse must be at least 0, got ${spec.fuse}`;
  }
  if (spec.fragments !== undefined && !(Number.isInteger(spec.fragments) && spec.fragments >= 0 && spec.fragments <= MAX_FRAGMENTS)) {
    return `${spec.kind}: fragments must be a whole number from 0 to ${MAX_FRAGMENTS}, got ${spec.fragments}`;
  }
  if (spec.sealing !== undefined && !(spec.sealing >= 0)) {
    return `${spec.kind}: sealing must be at least 0, got ${spec.sealing}`;
  }
  if (spec.burstSpeed !== undefined && !(spec.burstSpeed > 0)) {
    return `${spec.kind}: burst speed must be more than 0, got ${spec.burstSpeed}`;
  }
  const thickness = BASE_WALL_THICKNESS * reinforcement;
  if (isHullMount(spec.kind)) {
    const { barrelLength } = hullMountGeometry(spec);
    if (!(barrelLength < spec.length)) {
      const what = spec.kind === 'hullGun' ? `a ${barrelCalibres(spec)}-calibre barrel` : 'the lens housing';
      return `${spec.kind}: ${what} is ${barrelLength.toFixed(2)} m, leaving no block in a ${spec.length} m mount`;
    }
  }
  // For an engine it is the machinery block that has to be a box: the bell is
  // meant to be open at both ends. This is also what makes "all nozzle"
  // impossible by running out of block rather than by a rule of its own.
  const boxLength = spec.kind === 'engine'
    ? engineGeometry(spec).machineryLength
    : isHullMount(spec.kind)
      ? hullMountGeometry(spec).blockLength
      : spec.length;
  const smallest = boxLength < spec.width ? boxLength : spec.width;
  const thick = moduleThickness(spec);
  const limiting = smallest < thick ? smallest : thick;
  if (2 * thickness >= limiting) {
    return (
      `${spec.kind}: walls ${thickness.toFixed(3)} m thick leave no interior in a ` +
      `${boxLength}x${spec.width} m module`
    );
  }
  if (2 * (thickness + liningOf(spec)) >= limiting) {
    return `${spec.kind}: a ${(liningOf(spec) * 1000).toFixed(0)} mm sealing lining leaves no room inside`;
  }
  if (isHullMount(spec.kind)) {
    const { traverse, outletWidth } = hullMountGeometry(spec);
    // A mount whose barrel cannot move at all is a gun welded pointing one
    // way, which is a fixed gun rather than a broken module — but one whose
    // outlets have no bore left is nothing at all.
    if (!(outletWidth > 0)) return `${spec.kind}: ${spec.barrels ?? 1} outlets leave no bore`;
    if (!(traverse >= 0)) return `${spec.kind}: barrel does not fit its own opening`;
  }
  if (spec.kind === 'engine') {
    const { exitWidth, throatWidth } = engineGeometry(spec);
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
 * How big a module is to something shooting at it: half its diagonal.
 *
 * A bounding circle rather than the box, because what asks is gunnery, where
 * a target's *angular* size is the question and a box has no single one — it
 * depends which way the module is turned relative to the gun. The circle is
 * the box's worst case, so a weapon judging whether it would hit is generous
 * by at most the difference between a square and the circle round it, and
 * generous in the direction of a shot that lands somewhere on the ship rather
 * than one held back over a rounding.
 */
export function moduleRadius(spec: ModuleSpec): number {
  const triangle = triangleOf(spec);
  // A triangle's furthest corner, which is exact rather than conservative:
  // the box round it is not centred on it, so the box's half-diagonal is
  // neither a bound nor a useful approximation of one.
  if (triangle !== null) return triangleRadius(triangle);
  return sqrt(spec.length * spec.length + spec.width * spec.width) / 2;
}

/**
 * Where a module's box sits, which is its position for every kind but an
 * engine — see `ModuleSpec.x`.
 *
 * Everything that asks a geometric question about a module goes through this:
 * its corners, what it overlaps, what it blocks, where its mass acts, and
 * where it is drawn. A caller that reads `spec.x` directly for any of those is
 * asking where the module is *attached* and using the answer as though it were
 * the middle, which for an engine is half its length out.
 */
export function moduleCentre(spec: ModuleSpec): { x: number; y: number } {
  if (spec.kind !== 'engine') return { x: spec.x, y: spec.y };
  // The box runs from the mounting face against the way it pushes.
  const angle = boxAngle(spec);
  const back = spec.length / 2;
  return { x: spec.x - cos(angle) * back, y: spec.y - sin(angle) * back };
}

/**
 * The angle a module's box is laid out at, which is its facing for every kind
 * but an engine: an engine's box is laid out along the way it pushes, half a
 * turn from its facing.
 *
 * The same box either way, but not the same arithmetic. The usual engine faces
 * aft, and `sin(PI)` is 1.2e-16 rather than 0, so laying its box out at its
 * facing would put last-bit noise into every aft engine's corners — enough to
 * turn a flush joint into an overlap, and to lean a symmetric ship off its
 * spine. Laid out at the way it pushes, an aft engine is at exactly 0. So
 * every geometric question about a module's box asks this, not `angle`.
 */
export function boxAngle(spec: ModuleSpec): number {
  const angle = spec.angle ?? 0;
  if (spec.kind !== 'engine') return angle;
  const turned = angle + PI;
  return turned > PI ? turned - 2 * PI : turned;
}

/**
 * A module's corners with every face pushed `margin` metres outward, written
 * into `out` as x,y pairs, and how many there are.
 *
 * What a tolerance means geometrically: two modules count as touching when
 * each grown by half of one has reached the other. Grown by its *own* faces
 * rather than by a disc, so a box grows into a box — which is the arithmetic
 * the layout rules have always done — and a triangle keeps its corners sharp
 * instead of gaining three rounded ones a layout could then be welded by.
 *
 * A margin large enough to collapse a triangle leaves the module unchanged,
 * since a tolerance is never meant to be a size.
 */
export function grownOutline(spec: ModuleSpec, margin: number, out: number[]): number {
  const triangle = triangleOf(spec);
  if (triangle !== null) {
    const grown = insetTriangle(triangle, -margin);
    return moduleOutline(grown === null ? spec : { ...spec, vertices: grown }, out);
  }
  const grown: ModuleSpec = {
    ...spec,
    length: spec.length + 2 * margin,
    width: spec.width + 2 * margin,
  };
  // Grown about the middle it had. An engine's position is its mounting face
  // and its middle is half its length from there, so lengthening one would
  // otherwise walk it backwards into its own exhaust by the margin.
  const was = moduleCentre(spec);
  const now = moduleCentre(grown);
  grown.x += was.x - now.x;
  grown.y += was.y - now.y;
  return moduleOutline(grown, out);
}

/**
 * The module given these three corners, in its own frame, and moved so they
 * stay where the caller put them — or null if they enclose nothing, or the
 * kind may not be shaped.
 *
 * **The only way a triangle enters a layout.** The corners are re-centred on
 * their own centroid and the module is moved by the same amount, so dragging
 * one corner leaves the other two exactly where they were on the ship while
 * `x`/`y` goes on being the middle. `length` and `width` are refilled as the
 * box the corners fit inside, which keeps them derived rather than stale.
 *
 * Passing `null` for the corners makes the module the box they fitted inside,
 * which is how a triangle is squared off again.
 */
export function shapeModule(spec: ModuleSpec, vertices: readonly number[] | null): ModuleSpec | null {
  if (vertices === null) {
    const squared = { ...spec };
    const triangle = triangleOf(spec);
    delete squared.vertices;
    if (triangle === null) return squared;
    // The box the corners fitted inside, left where that box was. A triangle's
    // centroid is not the middle of that box, so leaving the position alone
    // would slide the module as it squared off.
    const bounds = triangleBounds(triangle);
    const angle = spec.angle ?? 0;
    const c = cos(angle);
    const s = sin(angle);
    squared.length = bounds.length;
    squared.width = bounds.width;
    squared.x = tidy(spec.x + bounds.x * c - bounds.y * s);
    squared.y = tidy(spec.y + bounds.x * s + bounds.y * c);
    return squared;
  }
  if (!canShape(spec.kind)) return null;
  const shape = normalizeShape(vertices);
  if (shape === null) return null;
  const angle = spec.angle ?? 0;
  const c = cos(angle);
  const s = sin(angle);
  const bounds = triangleBounds(shape.vertices);
  return {
    ...spec,
    // The shift is in the module's own frame; its position is in the layout's.
    x: tidy(spec.x + shape.dx * c - shape.dy * s),
    y: tidy(spec.y + shape.dx * s + shape.dy * c),
    length: bounds.length,
    width: bounds.width,
    vertices: shape.vertices,
  };
}

/**
 * A module's corners in the frame its layout is written in, written into `out`
 * as x,y pairs, and how many there are.
 *
 * **The one place a module turns into geometry.** Everything that asks a
 * geometric question — what a shot crosses, what two modules overlap along,
 * what a turret cannot see past, what the renderer fills — comes through here,
 * so a box and a triangle are the same question asked of a different number of
 * corners rather than two code paths that can drift apart. A caller that
 * rebuilds a rectangle from `length` and `width` instead draws a module the
 * simulation does not have.
 *
 * A box gives its four corners about the middle of the box, which an engine's
 * position is not; a triangle gives its three about its centroid, which its
 * position is. Both come out wound anticlockwise, so `outlineAxes` can take
 * the outward normals of either.
 *
 * `out` is written in place and truncated to the count, so a caller that keeps
 * one array across a loop allocates nothing (non-negotiable 4).
 */
export function moduleOutline(spec: ModuleSpec, out: number[]): number {
  const angle = boxAngle(spec);
  const c = cos(angle);
  const s = sin(angle);
  const mid = moduleCentre(spec);
  const triangle = triangleOf(spec);

  if (triangle !== null) {
    for (let i = 0; i < triangle.length; i += 2) {
      const x = triangle[i]!;
      const y = triangle[i + 1]!;
      out[i] = mid.x + x * c - y * s;
      out[i + 1] = mid.y + x * s + y * c;
    }
    out.length = TRIANGLE_CORNERS * 2;
    return TRIANGLE_CORNERS;
  }

  const hl = spec.length * 0.5;
  const hw = spec.width * 0.5;
  // (+l,-w), (+l,+w), (-l,+w), (-l,-w): wound anticlockwise, as a triangle is
  // stored, so that `outlineAxes` takes outward normals from either — and
  // starting on the bow face, so a box's two axes come out along its length
  // and then across it, which is the order the layout rules try them in.
  for (let i = 0; i < MAX_CORNERS; i++) {
    const dl = i < 2 ? hl : -hl;
    const dw = i === 0 || i === 3 ? -hw : hw;
    out[i * 2] = mid.x + dl * c - dw * s;
    out[i * 2 + 1] = mid.y + dl * s + dw * c;
  }
  out.length = MAX_CORNERS * 2;
  return MAX_CORNERS;
}

/**
 * The module as another kind, in the same box.
 *
 * The centre is what is kept, not the coordinates: an engine's position is its
 * mounting face, so changing the kind alone would slide it half its length.
 *
 * The facing is kept: every kind faces the way whatever sticks out of it
 * points, so what faced out of the ship still does. `turn` is any rotation
 * the caller wants on top.
 *
 * Fields the new kind does not read are kept, so swapping back restores them.
 */
export function refitModule(spec: ModuleSpec, to: ModuleKind, turn = 0): ModuleSpec {
  const centre = moduleCentre(spec);
  const next: ModuleSpec = { ...spec, kind: to };
  // Corners are the one field a refit cannot keep dormant: a kind with a bell
  // or a barrel coming out of a face has to have the face. The module becomes
  // the box its corners fitted inside, which is the same room on the hull.
  if (next.vertices !== undefined && !canShape(to)) delete next.vertices;
  if (turn !== 0) {
    // Folded into (-π, π], so a file says 180 rather than 540 after a few turns.
    let angle = (spec.angle ?? 0) + turn;
    while (angle > PI) angle -= 2 * PI;
    while (angle <= -PI) angle += 2 * PI;
    next.angle = angle;
  }
  const placed = moduleCentre({ ...next, x: 0, y: 0 });
  next.x = tidy(centre.x - placed.x);
  next.y = tidy(centre.y - placed.y);
  return next;
}

/** Rounds away the last-bit noise a turn leaves, so a file does not gain 1e-16s. */
function tidy(value: number): number {
  const tidied = round(value * 1e9) / 1e9;
  return tidied === 0 ? 0 : tidied;
}

/**
 * An engine's two halves, and what the bell's shape does to the gas.
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
 * Expansion buys efficiency as well as thrust, from the same number: see
 * `engineExhaustVelocity`.
 */
export interface EngineGeometry {
  /** Nozzles across the exit face, at least one. */
  nozzles: number;
  /** The bell's share of the module's length, 0 to 1. */
  share: number;
  /** Length of the machinery block, metres. Always positive. */
  machineryLength: number;
  /** Length of the bell, metres. Zero for a throat with nothing on it. */
  nozzleLength: number;
  /** The share of the face each nozzle sits in, metres, centre to centre. */
  pitch: number;
  /** Exit width of one nozzle, metres: as wide as it is deep, so no wider than its pitch. */
  exitWidth: number;
  /** Exit height of every nozzle, metres: the engine's thickness. */
  exitHeight: number;
  /** Throat width of one nozzle, metres. */
  throatWidth: number;
  /** Bell half-angle, radians. A right angle when there is no bell. */
  halfAngle: number;
  /** Momentum kept along the axis, `(1 + cos a) / 2`: 0.5 to 1. */
  divergence: number;
}

/** An engine's halves and its bell geometry. Engines only. */
export function engineGeometry(spec: ModuleSpec): EngineGeometry {
  const nozzles = spec.barrels ?? 1;
  const share = spec.nozzle ?? DEFAULT_NOZZLE_SHARE;
  const nozzleLength = spec.length * share;
  const pitch = spec.width / nozzles;
  // Square: a thin engine's bell is held to a deck both ways.
  const exitWidth = moduleThickness(spec);
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
    pitch,
    exitWidth,
    exitHeight: exitWidth,
    throatWidth,
    halfAngle,
    divergence: (1 + axial) * 0.5,
  };
}

/**
 * How fast an engine's exhaust leaves along its axis, m/s.
 *
 * `EXHAUST_VELOCITY`, less what the bell throws sideways — the same
 * `divergence` that costs it thrust, since gas going the wrong way pushes
 * nothing whatever it was fed — and less what a small throat loses to its
 * walls. A long bell on a big throat is the efficient engine.
 */
export function engineExhaustVelocity(geometry: EngineGeometry): number {
  const small = SMALL_ENGINE_THROAT / (SMALL_ENGINE_THROAT + geometry.throatWidth);
  return EXHAUST_VELOCITY * geometry.divergence * (1 - SMALL_ENGINE_LOSS * small);
}

/** An exhaust velocity as a specific impulse, seconds. */
export function specificImpulse(exhaustVelocity: number): number {
  return exhaustVelocity / STANDARD_GRAVITY;
}

/**
 * The machinery block as a box in its own right, for the questions that are
 * about how the engine is *held on*: what it overlaps, what it is welded to.
 *
 * An engine's position is the middle of the face it pushes from, so the
 * block shares that position and is simply shorter — which is what makes this
 * a change of one field rather than a second geometry.
 */
export function engineMachinery(spec: ModuleSpec): ModuleSpec {
  return { ...spec, length: engineGeometry(spec).machineryLength };
}

/**
 * Where one nozzle's axis sits across the exit face, metres from the middle.
 *
 * Each at the middle of its share of the face. They tile it when they are
 * no deeper than a deck, and sit apart on a thin engine wider than that.
 */
export function nozzleOffset(geometry: EngineGeometry, index: number): number {
  return (index - (geometry.nozzles - 1) * 0.5) * geometry.pitch;
}

/**
 * Material in an engine's bells, m³.
 *
 * Every bell is an open-ended tapered duct: two flanks running down the slant
 * and a roof and floor spanning the taper, in skin a fraction of hull plate
 * thick. Nothing is enclosed, which is the point — a bell holds no cargo, has
 * no interior to hollow out, and weighs a small fraction of what the same
 * length of machinery block does.
 */
function nozzleSkinVolume(geometry: EngineGeometry, wallThickness: number): number {
  const { nozzles, nozzleLength, exitWidth, exitHeight, throatWidth } = geometry;
  if (!(nozzleLength > 0)) return 0;
  const flare = (exitWidth - throatWidth) * 0.5;
  const slant = sqrt(nozzleLength * nozzleLength + flare * flare);
  const meanWidth = (exitWidth + throatWidth) * 0.5;
  const area = 2 * slant * exitHeight + 2 * meanWidth * nozzleLength;
  return area * wallThickness * NOZZLE_SKIN_FRACTION * nozzles;
}


/**
 * An engine's moment about its own centre, kg·m².
 *
 * Two pieces sitting at different places along the engine, so the box formula
 * over the whole declared length would be wrong twice over: it puts the heavy
 * machinery further aft than it is, and it treats a light bell as though it
 * were packed as densely as the block. A cluster of bells is spread across the
 * face as well, which the single-box formula cannot see at all.
 */
function engineInertia(
  spec: ModuleSpec,
  geometry: EngineGeometry,
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
  /** The barrel's share of the module's length. */
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
  // No wider than the opening leaves room for, nor than the mount is deep:
  // an outlet is always a cylinder the hull can hold.
  const opening = HULL_BARREL_WIDTH_CAP * (outlets > 1 ? outletSpacing : spec.width);
  const depth = moduleThickness(spec);
  const cap = opening < depth ? opening : depth;
  const outletWidth = each < cap ? each : cap;
  const barrelWidth = (outlets - 1) * outletSpacing + outletWidth;
  // A gun's barrel is as many calibres as it says; a lens housing is as deep
  // as a turret's, since a shallower one is better in every way.
  const barrelLength =
    spec.kind === 'hullBeam'
      ? outletWidth * BEAM_EMITTER_APERTURES
      : (barrelCalibres(spec) * outletWidth) / BARREL_OUTER_CALIBRES;
  const share = barrelLength / spec.length;
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

/** Whether `fuse` means anything on this kind: a gun that fires rounds. */
export function readsFuse(kind: ModuleKind): boolean {
  return kind === 'turret' || kind === 'hullGun';
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
  return kind === 'engine';
}

/** Whether `barrelCalibres` means anything on this kind: a gun with a barrel. */
export function readsBarrelCalibres(kind: ModuleKind): boolean {
  return kind === 'turret' || kind === 'hullGun';
}

/** How many calibres long a gun's barrels are: what it says, or its archetype's default. */
export function barrelCalibres(spec: ModuleSpec): number {
  if (spec.barrelCalibres !== undefined) return spec.barrelCalibres;
  return spec.kind === 'hullGun' ? DEFAULT_HULL_BARREL_CALIBRES : BARREL_CALIBRES;
}

/**
 * Kinetic energy a bore gives its round, joules: in proportion to the bore's
 * volume up to `BARREL_CALIBRES`, and past it `2√x − 1` of that for `x` times
 * the length, which meets the line there without a kink.
 */
function muzzleEnergyOf(calibre: number, calibres: number): number {
  const boreArea = PI * 0.25 * calibre * calibre;
  const x = calibres / BARREL_CALIBRES;
  const share = x > 1 ? 2 * sqrt(x) - 1 : x;
  return CHARGE_ENERGY_PER_BORE_VOLUME * boreArea * calibre * BARREL_CALIBRES * share;
}

/** How much of each barrel `calibres` long needs bracing, metres. */
function braceLengthOf(calibre: number, calibres: number): number {
  return calibres > BARREL_CALIBRES ? (calibres - BARREL_CALIBRES) * calibre : 0;
}

/**
 * The steel bracing a gun's barrels, kg, for the whole row: `n + 1` strips,
 * each as deep as a barrel is wide, since neighbours share the one between
 * them.
 */
export function braceMass(gun: GunStats): number {
  const section = gun.braceWidth * BARREL_OUTER_CALIBRES * gun.calibre;
  return (gun.barrelCount + 1) * section * gun.braceLength * HULL_DENSITY;
}

/** Whether `barrels` means anything on this kind: barrels, outlets or nozzles. */
export function countsOutlets(kind: ModuleKind): boolean {
  return kind === 'turret' || kind === 'beamTurret' || kind === 'engine' || isHullMount(kind);
}

/** Whether `weapon` means anything on this kind. Only an engine has a plume to point. */
export function readsWeapon(kind: ModuleKind): boolean {
  return kind === 'engine';
}

/** Whether `thick` means anything on this kind: everything but a turret, which is held to a deck. */
export function readsThick(kind: ModuleKind): boolean {
  return kind !== 'turret' && kind !== 'beamTurret';
}

/**
 * Whether a module stands in the weapons layer (DESIGN.md §3), and so blocks
 * turrets and can be hit by them. Every module is in the hull layer.
 *
 * Turrets always are, and so is anything deeper than one layer — which is what
 * being thick buys. `touching` is what a thick plate borrows, as
 * `moduleThickness` reads it: a plate is cover once it stands as high as the
 * module it is covering, and not before.
 */
export function inWeaponsLayer(spec: ModuleSpec, touching = 0): boolean {
  if (spec.kind === 'turret' || spec.kind === 'beamTurret') return true;
  return moduleThickness(spec, touching) > DECK_HEIGHT;
}

/** Whether a module is marked thick, on a kind and a size where that means anything. */
export function isThick(spec: ModuleSpec): boolean {
  return spec.thick === true && canThicken(spec);
}

/**
 * Whether marking a module thick would make it any deeper.
 *
 * False for one no more than a deck across, since its own width already leaves
 * it inside a single layer — **except structure**, whose depth comes from what
 * it is welded to rather than from its own width, so a plate of any size may
 * be marked. See `ModuleSpec.thick`.
 */
export function canThicken(spec: ModuleSpec): boolean {
  if (!readsThick(spec.kind)) return false;
  return spec.kind === 'structure' || acrossOf(spec) > DECK_HEIGHT;
}

/**
 * How deep a module is, metres: as deep as it is across, and no deeper than
 * a deck unless it is thick.
 *
 * Across is the smaller of length and width for a box; the width alone for a
 * hull weapon, whose length is mostly barrel; and one nozzle's width for an
 * engine, so each bell is as deep as it is wide. A turret is held to a deck.
 *
 * `touching` is the depth of the deepest module this one is welded to, which
 * only thick structure reads — a plate stands as high as what it covers, and
 * falls back on its own width when nothing it touches is deeper. `layoutStats`
 * is what works that out, so a module asked about on its own is as deep as it
 * is across.
 */
export function moduleThickness(spec: ModuleSpec, touching = 0): number {
  const across = acrossOf(spec);
  if (!isThick(spec)) return across < DECK_HEIGHT ? across : DECK_HEIGHT;
  return across > touching ? across : touching;
}

function acrossOf(spec: ModuleSpec): number {
  if (spec.kind === 'engine') return spec.width / (spec.barrels ?? 1);
  if (isHullMount(spec.kind)) return spec.width;
  const triangle = triangleOf(spec);
  // The narrowest way through a triangle, which is what the box's smaller side
  // is for a box: a long thin wedge is a thin module however far it reaches.
  if (triangle !== null) return triangleAcross(triangle);
  return spec.length < spec.width ? spec.length : spec.width;
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
 * The derivations are the turret's — a bore, a barrel so many calibres long
 * to accelerate a shell down, a shell that is so many calibres long — and only
 * what sets the bore differs: it comes from the **opening** rather than from a
 * fraction of the mount, since there is no ring to fit inside. The barrel
 * takes its length out of the module, so that is the trade the archetype
 * exists for: length is muzzle energy, and it is also the block it no longer
 * loads from and the traverse it no longer has.
 */
export function hullGunStats(spec: ModuleSpec): GunStats {
  const { outlets, outletWidth, outletSpacing, barrelLength, blockLength } = hullMountGeometry(spec);
  const calibre = outletWidth / BARREL_OUTER_CALIBRES;
  const calibres = barrelCalibres(spec);
  const boreArea = PI * 0.25 * calibre * calibre;
  const roundMass = boreArea * (calibre * SHELL_CALIBRES) * SHELL_DENSITY;
  const muzzleEnergy = muzzleEnergyOf(calibre, calibres);
  const muzzleSpeed = roundMass > 0 ? sqrt((2 * muzzleEnergy) / roundMass) : 0;

  return {
    type: GunType.Projectile,
    calibre,
    barrelLength,
    braceLength: braceLengthOf(calibre, calibres),
    braceWidth: BRACE_CALIBRES * calibre,
    barrelCount: outlets,
    barrelSpacing: outletSpacing,
    roundMass,
    muzzleSpeed,
    muzzleEnergy,
    beamPower: 0,
    // One block loads every tube, so its depth is measured against the bore
    // they share rather than each tube's own.
    cycleTime: hullCycleTime(calibre, blockLength * loadingDecks(spec), outlets) / outlets,
    beamOnTime: 0,
    burst: null,
  };
}

/**
 * How many decks' worth of loading gear a hull gun's block holds per metre of
 * its length: one when it is held to a deck (or narrower than one), and its
 * depth over a deck's when it is thick. The gear fills the block, so standing
 * through more of the ship buys rounds per minute as a longer block does.
 */
function loadingDecks(spec: ModuleSpec): number {
  const thin = spec.width < DECK_HEIGHT ? spec.width : DECK_HEIGHT;
  return moduleThickness(spec) / thin;
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
  const stored = BEAM_STORED_ENERGY_PER_VOLUME * blockLength * spec.width * moduleThickness(spec);
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
    braceLength: 0,
    braceWidth: 0,
    barrelCount: outlets,
    barrelSpacing: outletSpacing,
    roundMass: 0,
    muzzleSpeed: -1,
    muzzleEnergy: 0,
    beamPower: power,
    beamOnTime,
    cycleTime,
    burst: null,
  };
}

/** Whether a gun fires shells that burst, rather than solid shot: more than one fragment. */
export function firesShells(spec: ModuleSpec): boolean {
  return readsFuse(spec.kind) && (spec.fragments ?? DEFAULT_FRAGMENTS) > 1;
}

/**
 * The share of a shell's volume given to charge for its casing to leave at
 * `burstSpeed`: the casing's kinetic energy is what the charge's yield
 * supplies, `½ ρs (1−φ) v² = ρe φ Y`.
 */
export function chargeShare(burstSpeed: number): number {
  const casing = SHELL_DENSITY * burstSpeed * burstSpeed;
  return casing / (2 * EXPLOSIVE_DENSITY * EXPLOSIVE_YIELD + casing);
}

/** The mass of a round that is casing rather than charge, kg: all of it, for solid shot. */
export function casingMass(spec: ModuleSpec, roundMass: number): number {
  if (!firesShells(spec)) return roundMass;
  const share = chargeShare(spec.burstSpeed ?? DEFAULT_BURST_SPEED);
  const casing = (1 - share) * SHELL_DENSITY;
  return (roundMass * casing) / (casing + share * EXPLOSIVE_DENSITY);
}

/** Inertia about a barrel's root of `mass` of bracing running out from it. */
function braceInertia(gun: GunStats, mass: number): number {
  return (mass * gun.braceLength * gun.braceLength) / 3;
}

/**
 * A gun with what it is loaded with. Its bore is measured as solid shot; a
 * shell gives some of that volume to charge, which is far lighter than steel,
 * so for the same propellant it leaves faster with less momentum.
 *
 * This is also where the burst is described, since what a round scatters is a
 * property of what the mount loads rather than of the barrel it goes down.
 */
function loaded(gun: GunStats, spec: ModuleSpec): GunStats {
  if (!firesShells(spec)) return gun;
  const burstSpeed = spec.burstSpeed ?? DEFAULT_BURST_SPEED;
  const share = chargeShare(burstSpeed);
  const roundMass = gun.roundMass * (1 - share + (share * EXPLOSIVE_DENSITY) / SHELL_DENSITY);
  const muzzleSpeed = roundMass > 0 ? sqrt((2 * gun.muzzleEnergy) / roundMass) : 0;
  const fragments = spec.fragments ?? DEFAULT_FRAGMENTS;
  return {
    ...gun,
    roundMass,
    muzzleSpeed,
    burst: {
      fragments,
      // The casing's metal shared out, widths summing in area as `burst` does it.
      fragmentWidth: gun.calibre * sqrt((1 - share) / fragments),
      radius: burstSpeed * (spec.fuse ?? DEFAULT_FUSE)
    }
  };
}

/**
 * The scaling laws, applied. Throws if the module could not exist.
 *
 * `touching` is the depth of the deepest module this one is welded to, which
 * only thick structure reads — see `ModuleSpec.thick`. Everything else derives
 * from the module alone, so a caller with no layout to hand may leave it out.
 */
export function moduleStats(spec: ModuleSpec, touching = 0): ModuleStats {
  const problem = moduleProblem(spec);
  if (problem !== null) throw new Error(`Invalid module — ${problem}`);

  const reinforcement = spec.reinforcement ?? 1;
  const wallThickness = BASE_WALL_THICKNESS * reinforcement;

  // An engine is a box with a bell on the back of it rather than one box, and
  // only the box part is walled. Every other archetype is the box it declares.
  const engine = spec.kind === 'engine' ? engineGeometry(spec) : null;
  const mount = isHullMount(spec.kind) ? hullMountGeometry(spec) : null;
  const boxLength =
    engine !== null ? engine.machineryLength : mount !== null ? mount.blockLength : spec.length;

  // The walls are what is left of the box once the interior is hollowed out of
  // it, on all six faces — so a long thin module carries proportionally more
  // wall for the space it encloses, which is the pressure that stops layouts
  // being made of splinters.
  //
  // A triangle is the same law over its own outline: the floor it encloses in
  // place of `length x width`, and the floor left inside walls of the same
  // thickness in place of the box shrunk by two of them. It applies the same
  // pressure through the shape rather than through the proportions — the inner
  // triangle is similar to the outer one, so a sharp corner loses far more
  // area to its walls than a blunt one, and a sliver of a plate is all wall.
  const height = moduleThickness(spec, touching);
  const width = spec.width;
  const triangle = triangleOf(spec);
  const floor = triangle !== null ? polygonArea(triangle) : boxLength * width;
  const hollow = (depth: number): { floor: number; volume: number } => {
    const lid = height - 2 * depth;
    if (!(lid > 0)) return { floor: 0, volume: 0 };
    if (triangle !== null) {
      const inner = insetTriangle(triangle, depth);
      const area = inner === null ? 0 : polygonArea(inner);
      return { floor: area, volume: area * lid };
    }
    const along = boxLength - 2 * depth;
    const across = width - 2 * depth;
    if (!(along > 0) || !(across > 0)) return { floor: 0, volume: 0 };
    return { floor: along * across, volume: along * across * lid };
  };
  const walled = hollow(wallThickness);
  const outer = floor * height;
  const inner = walled.volume;
  // Bells, which are skins rather than boxes: two flanks along the slant and a
  // roof and floor over the taper, with nothing enclosed and both ends open.
  const skinVolume = engine === null ? 0 : nozzleSkinVolume(engine, wallThickness);
  const wallVolume = outer - inner + skinVolume;
  const structureMass = wallVolume * HULL_DENSITY;

  const capacity = walled.floor;
  // A sealing lining is a second skin inside the first, and what it fills is
  // room the fuel no longer has.
  const lining = liningOf(spec);
  const interior = lining > 0 ? hollow(wallThickness + lining).volume : inner;
  const liningMass = (inner - interior) * SEALANT_DENSITY;

  let fittingMass = 0;
  let thrust = 0;
  let exhaustVelocity = 0;
  let fuel = 0;
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
    fittingMass = max(CORE_MINIMUM_FITTING_MASS, CORE_MASS_PER_AREA * capacity) + liningMass;
    fuel = max(0, interior - CORE_COMPUTING_VOLUME) * FUEL_DENSITY;
  } else if (spec.kind === 'tank') {
    // A box whose whole interior is fuel. It packs the box as the box formula
    // assumes, so the inertia below already holds it.
    fittingMass = liningMass;
    fuel = interior * FUEL_DENSITY;
  } else if (engine !== null) {
    // Thrust comes out of the nozzle, so it scales with the exit area: each
    // bell square, as wide as it is deep. A thin engine wider than a deck
    // therefore needs more bells, or to be thick, to use its whole face. An
    // engine gets stronger by being made *wider*, which is what stops "just
    // stretch it" being the answer to every propulsion problem.
    //
    // **How hard that face is fed is the machinery's business**, and the
    // machinery is the block the bell was cut out of. A shallow bell leaves a
    // deep chamber with big pumps and drives more mass through the same
    // throat; a deep bell leaves an engine with nothing behind it. Bounded by
    // the throat itself, which chokes rather than passing whatever is pushed
    // at it.
    const feed = engine.machineryLength / (PUMP_DEPTH_WIDTHS * spec.width);
    const supply = feed < THROAT_CHOKE ? feed : THROAT_CHOKE;
    const exitArea = engine.nozzles * engine.exitWidth * engine.exitHeight;
    const throughput = THRUST_PER_EXIT_AREA * exitArea * supply;
    // What the bell then keeps pointed the right way. **The two pull opposite
    // ways**, which is the whole of the knob: length taken off the bell is
    // flow gained and aim lost, so the best engine is neither all bell nor all
    // chamber but somewhere inside, and an engine whose nozzle has fallen off
    // throws its gas sideways however hard it is pumping.
    thrust = throughput * engine.divergence;
    exhaustVelocity = engineExhaustVelocity(engine);
    fittingMass = throughput * ENGINE_MASS_PER_NEWTON;
  } else if (mount !== null) {
    gun = spec.kind === 'hullGun' ? loaded(hullGunStats(spec), spec) : hullBeamStats(spec);
    // The same two masses a turret carries, by the same reasoning — a tube of
    // steel or an optic out in front, and the machinery that works it behind.
    let protrudingMass: number;
    if (spec.kind === 'hullGun') {
      const outer = BARREL_OUTER_CALIBRES * gun.calibre;
      const section = PI * 0.25 * (outer * outer - gun.calibre * gun.calibre);
      protrudingMass = section * gun.barrelLength * HULL_DENSITY;
      fittingMass =
        (protrudingMass + MECHANISM_MASS_PER_CALIBRE * gun.calibre) * gun.barrelCount + braceMass(gun);
    } else {
      protrudingMass = OPTIC_AREAL_DENSITY * PI * 0.25 * gun.calibre * gun.calibre;
      fittingMass = (protrudingMass + BEAM_MASS_PER_WATT * gun.beamPower) * gun.barrelCount;
    }

    // What swings is the barrels alone, about the root they are trunnioned at
    // rather than about the middle of the module — the block does not move.
    // Each is a rod running out from that root, so it carries `m L²/3` there,
    // plus `m d²` for sitting off the centreline.
    // Bracing swings with the barrels, each barrel taking its share of it.
    const braced = braceMass(gun) / gun.barrelCount;
    rodMass = (protrudingMass + braced) * gun.barrelCount;
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
    const braceSpin = braceInertia(gun, braced);
    const braceMiddle = (braced * gun.braceLength * gun.braceLength) / 12;
    const ahead = mount.pivot + gun.barrelLength * 0.5;
    const braceAhead = mount.pivot + gun.braceLength * 0.5;
    const each = protrudingMass + braced;
    for (let barrel = 0; barrel < gun.barrelCount; barrel++) {
      const offset = (barrel - (gun.barrelCount - 1) * 0.5) * gun.barrelSpacing;
      swing += spin + braceSpin + each * offset * offset;
      // The module's own moment wants them about its centre instead, which is
      // the rod's own moment plus where its centre of mass actually sits.
      rodInertia +=
        middle + protrudingMass * ahead * ahead +
        braceMiddle + braced * braceAhead * braceAhead +
        each * offset * offset;
    }
  } else if (spec.kind === 'turret' || spec.kind === 'beamTurret') {
    gun = spec.kind === 'turret'
      ? loaded(gunStats(spec.length, spec.width, spec.barrels, barrelCalibres(spec)), spec)
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
      fittingMass = (protrudingMass + mechanismMass) * gun.barrelCount + braceMass(gun);
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
    const braced = braceMass(gun) / gun.barrelCount;
    rodMass = (protrudingMass + braced) * gun.barrelCount;
    // **A turret's ring goes all the way round whatever it is told.** The gear
    // is sized by the whole mount, since that is what turns, and a limit on
    // where it may point is programming rather than a simpler machine — so
    // unlike a hull mount's bed this does not shrink when the arc does.
    traverseMass = (structureMass + fittingMass) * TRAVERSE_GEAR_FRACTION;
    fittingMass += traverseMass;
    const spin = (protrudingMass * gun.barrelLength * gun.barrelLength) / 3 + braceInertia(gun, braced);
    const each = protrudingMass + braced;
    for (let barrel = 0; barrel < gun.barrelCount; barrel++) {
      const offset = (barrel - (gun.barrelCount - 1) * 0.5) * gun.barrelSpacing;
      rodInertia += spin + each * offset * offset;
    }
  }

  const mass = structureMass + fittingMass + fuel;
  // Everything but the barrels rotates as the box it is: walls, and machinery
  // packed inside them.
  const boxMass = mass - rodMass;
  const inertia =
    engine !== null
      ? engineInertia(spec, engine, structureMass - skinVolume * HULL_DENSITY + fittingMass,
          skinVolume * HULL_DENSITY)
      : mount !== null
        ? // The block sits half a barrel aft of the module's middle, and the
          // barrels have already been measured from there.
          (boxMass * (mount.blockLength * mount.blockLength + spec.width * spec.width)) / 12 +
          boxMass * (mount.barrelLength * 0.5) * (mount.barrelLength * 0.5) +
          rodInertia
        : triangle !== null
          ? // The shape's own second moment, per unit of the floor it encloses.
            // For a rectangle this is `(l² + w²) / 12` exactly, so the two are
            // one law rather than a box's and a special case.
            (boxMass * polygonMomentOfArea(triangle)) / floor + rodInertia
          : (boxMass * (spec.length * spec.length + spec.width * spec.width)) / 12 + rodInertia;

  return {
    thickness: height,
    wallThickness,
    wallVolume,
    structureMass,
    fittingMass,
    mass,
    capacity,
    inertia,
    hitPoints: structureMass,
    thrust,
    exhaustVelocity,
    fuel,
    lining,
    interior,
    gun,
    traverseMass,
    swingInertia: mount === null ? inertia : swing,
  };
}

/**
 * The gun a turret mount of this size carries.
 *
 * The bore is set by how wide the mount is, and the barrel is `calibres` of
 * that bore long. Everything after that is physics: charge energy scales with
 * the volume of bore it fills, less so past `BARREL_CALIBRES`, shell mass with
 * the cube of calibre, and muzzle velocity is whatever dividing one by the
 * other leaves.
 *
 * The trade this produces is the real one. Widening the mount buys a heavier
 * shell that hits harder but flies slower and reloads less often; a longer
 * barrel buys velocity — flatter trajectory, shorter flight time, less lead to
 * misjudge — at the cost of steel that traverses more sluggishly, and past
 * `BARREL_CALIBRES` of bracing as well. The barrel is not held to the mount's
 * own length: it is out over the ship, and the arc it leaves is the price.
 *
 * **Multiple barrels** put a row of what are essentially independent guns on
 * one mount, firing in turn, so the mount's rate of fire rises — twice over,
 * since each barrel is narrower than a single gun would be and a narrower gun
 * cycles faster. A row shares its bracing (`braceMass`), so long barrels cost
 * it less than they cost one gun.
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
export function gunStats(
  mountLength: number,
  mountWidth: number,
  barrelCount: number = 1,
  calibres: number = BARREL_CALIBRES,
): GunStats {
  const wide = (mountWidth * CALIBRE_FRACTION) / barrelCount;
  const calibre = wide < MAX_TURRET_CALIBRE ? wide : MAX_TURRET_CALIBRE;
  const barrelLength = calibre * calibres;

  const boreArea = PI * 0.25 * calibre * calibre;
  const roundMass = boreArea * (calibre * SHELL_CALIBRES) * SHELL_DENSITY;
  const muzzleEnergy = muzzleEnergyOf(calibre, calibres);
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
    braceLength: braceLengthOf(calibre, calibres),
    braceWidth: BRACE_CALIBRES * calibre,
    barrelCount,
    barrelSpacing,
    roundMass,
    muzzleSpeed,
    muzzleEnergy,
    beamPower: 0,
    cycleTime: (CYCLE_TIME_PER_CALIBRE * calibre) / barrelCount,
    beamOnTime: 0,
    burst: null
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
  const wide = (face * BEAM_APERTURE_FRACTION) / sqrt(barrelCount);
  const aperture = wide < MAX_TURRET_CALIBRE ? wide : MAX_TURRET_CALIBRE;
  const apertureArea = PI * 0.25 * aperture * aperture;

  // What the optic can pass without destroying itself, which is the whole of
  // what limits a beam mount's output.
  const power = OPTIC_INTENSITY_LIMIT * apertureArea;

  // The bank fills the mount, and feeds one emitter at a time.
  const depth = face < DECK_HEIGHT ? face : DECK_HEIGHT;
  const stored = BEAM_STORED_ENERGY_PER_VOLUME * mountLength * mountWidth * depth;
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
    braceLength: 0,
    braceWidth: 0,
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
    burst: null,
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

/**
 * How fast a weapon mount's drive can swing it, radians per second squared.
 *
 * A turret turns bodily, so its drive is sized by and swings the whole mount.
 * A hull mount swings only its barrels, and its drive is sized by the weapon
 * it trains rather than the block it is welded into — so a deeper block,
 * which is more loading gear behind the same barrels, trains them no faster
 * and no slower.
 */
export function mountAccel(spec: ModuleSpec, stats: ModuleStats): number {
  if (isHullMount(spec.kind)) return traverseAccel(stats.fittingMass, stats.swingInertia);
  return traverseAccel(stats.mass, stats.inertia);
}
