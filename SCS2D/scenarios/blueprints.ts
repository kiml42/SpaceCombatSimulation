import { math, type Blueprint, type ModuleSpec } from '../sim/index.js';

const { HALF_PI, PI } = math;

/**
 * Ship layouts, as data.
 *
 * Two of them, which is the smallest number that can fight and the smallest
 * that can show a design difference mattering: a light ship that accelerates
 * hard and carries one gun, and a heavy one that out-ranges and out-shoots it
 * but takes a while to point.
 *
 * These are authored by hand and mean to stay legible. Every layout here is
 * drawn on round numbers with modules abutting exactly, and read best as a
 * deck plan: +x is the bow, +y is to port, and a module's `angle` is the way
 * it faces — which way a thruster pushes the ship, and where a turret's gun
 * rests.
 *
 * A thruster's exhaust leaves the *opposite* way to its push, so a mount out on
 * a wing has to push inboard: a port-side thruster pushing to port would be
 * firing into the wing it is bolted to. Nothing in the simulation stops that
 * today (§12), so it is a matter of drawing the layout honestly.
 *
 * Nothing about how these ships *perform* is written down here. Mass, moment
 * of inertia, thrust, gun ballistics and firing arcs are all derived from this
 * geometry by `compileBlueprint`, so a layout cannot claim a figure its shape
 * does not support.
 */

/** A structural box: hull, and somewhere for other modules to attach. */
function structure(x: number, y: number, length: number, width: number): ModuleSpec {
  return { kind: 'structure', x, y, length, width };
}

/** A thruster pushing the ship along `angle`. Its exhaust leaves the other way. */
function thruster(
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
): ModuleSpec {
  return { kind: 'thruster', x, y, angle, length, width };
}

/** A gun mount resting on `angle`. Its calibre and barrel come from its size. */
function turret(
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
): ModuleSpec {
  return { kind: 'turret', x, y, angle, length, width };
}

/**
 * A light escort: one main engine, one gun, and enough manoeuvring thrust to
 * turn faster than anything can track it.
 *
 * The wings exist to hold the manoeuvring thrusters out where their moment arm
 * is worth having. That they also foul the bow gun's traverse is the trade the
 * layout is making, and it is visible in the arc the design compiles to.
 */
export const CORVETTE: Blueprint = {
  name: 'Corvette',
  modules: [
    structure(0, 0, 16, 6),
    turret(10.5, 0, 0, 5, 4),
    thruster(-10, 0, 0, 4, 6),

    structure(4, 4.5, 4, 3),
    structure(4, -4.5, 4, 3),
    structure(-4, 4.5, 4, 3),
    structure(-4, -4.5, 4, 3),

    thruster(4, 7, -HALF_PI, 2, 3),
    thruster(4, -7, HALF_PI, 2, 3),
    thruster(-4, 7, -HALF_PI, 2, 3),
    thruster(-4, -7, HALF_PI, 2, 3),

    thruster(7, 4.5, PI, 2, 3),
    thruster(7, -4.5, PI, 2, 3),
  ],
};

/**
 * A damaged version of the corvette to test asymmetric mass distribution and thrust.
 */
export const DAMAGED_CORVETTE: Blueprint = {
  name: 'DamagedCorvette',
  modules: [
    structure(0, 0, 16, 6),
    turret(10.5, 0, 0, 5, 4),
    thruster(-10, 0, 0, 4, 6),

    structure(4, 4.5, 4, 3),
    structure(4, -4.5, 4, 3),
    structure(-4, 4.5, 4, 3),
    structure(-4, -4.5, 4, 3),

    thruster(4, 7, -HALF_PI, 2, 3),
    thruster(4, -7, HALF_PI, 2, 3),
    thruster(-4, 7, -HALF_PI, 2, 3),
    thruster(-4, -7, HALF_PI, 2, 3),

    thruster(7, 4.5, PI, 2, 3),
    thruster(7, -4.5, PI, 2, 3),
  ],
};

/**
 * A heavy gunship: a bow gun that fires a shell an order of magnitude heavier
 * than the corvette's, and a broadside turret on each beam for anything that
 * gets inside it.
 *
 * Twice the corvette's engines move four times its mass, so it is markedly
 * more sluggish — which is the point of having two of these to compare. The
 * beam turrets are held clear of the spine on their own mounts because a gun
 * flat against the hull has almost no traverse worth the mass it costs.
 */
export const GUNSHIP: Blueprint = {
  name: 'Gunship',
  modules: [
    structure(0, 0, 40, 10),
    turret(26, 0, 0, 12, 8),

    structure(0, 9, 8, 8),
    turret(0, 16, HALF_PI, 6, 6),
    structure(0, -9, 8, 8),
    turret(0, -16, -HALF_PI, 6, 6),

    thruster(-24, 3, 0, 8, 4),
    thruster(-24, -3, 0, 8, 4),
    
    structure(12, 7, 6, 4),
    structure(12, -7, 6, 4),
    structure(-12, 7, 6, 4),
    structure(-12, -7, 6, 4),

    thruster(12, 10, -HALF_PI, 2, 4),
    thruster(12, -10, HALF_PI, 2, 4),
    thruster(-12, 10, -HALF_PI, 2, 4),
    thruster(-12, -10, HALF_PI, 2, 4),

    thruster(16.5, 7, PI, 3, 4),
    thruster(16.5, -7, PI, 3, 4),
  ],
};

export const BLUEPRINTS = { corvette: CORVETTE, gunship: GUNSHIP } as const;

export type BlueprintName = keyof typeof BLUEPRINTS;
