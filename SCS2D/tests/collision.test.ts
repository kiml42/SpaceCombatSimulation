import { describe, expect, it } from 'vitest';
import { Bodies } from '../sim/bodies.js';
import { Collisions, Contacts, RESTITUTION, findContacts, resolveContacts } from '../sim/collision.js';
import { compileBlueprint, type ShipDesign } from '../sim/index.js';
import type { HullDesigns } from '../sim/hull.js';
import { CORVETTE, DINKY } from '../scenarios/blueprints.js';
import { ram } from '../scenarios/ram.js';

/**
 * Hulls meeting each other.
 *
 * The geometry half asks what the shot tests already ask — did these two
 * really meet, or only their bounding circles — and the physics half is the
 * invariants: momentum and angular momentum are conserved across an impulse,
 * and two hulls that met are coming apart afterwards.
 */

const corvette: ShipDesign = compileBlueprint(CORVETTE);
const dinky: ShipDesign = compileBlueprint(DINKY);

/**
 * The corvette runs from x = -12.9 to x = +12.1 and is 17 m across, inside a
 * bounding circle of 14.6 m. So two of them nose to tail are clear at 25 m
 * apart and overlapping at anything less, and two abeam at 20 m have circles
 * that overlap by a good margin with three metres of vacuum between the hulls.
 */
const NOSE_TO_TAIL = 25;

interface Ship {
  design: ShipDesign;
  x: number;
  y: number;
  angle?: number;
  vx?: number;
  vy?: number;
  spin?: number;
  /** Immovable, like a test fixture's battery. */
  fixed?: boolean;
}

function world(...ships: Ship[]): { bodies: Bodies; hulls: HullDesigns; contacts: Contacts } {
  const bodies = new Bodies();
  const designs: ShipDesign[] = [];
  for (const ship of ships) {
    bodies.create({
      x: ship.x,
      y: ship.y,
      angle: ship.angle ?? 0,
      vx: ship.vx ?? 0,
      vy: ship.vy ?? 0,
      angularVel: ship.spin ?? 0,
      mass: ship.fixed === true ? 0 : ship.design.mass,
      inertia: ship.fixed === true ? 0 : ship.design.inertia,
      radius: ship.design.radius,
    });
    designs.push(ship.design);
  }
  const hulls: HullDesigns = { designOf: (body) => designs[body] ?? null };
  return { bodies, hulls, contacts: new Contacts() };
}

/** Total linear momentum, which an impulse between two bodies cannot change. */
function momentum(bodies: Bodies): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let i = 0; i < bodies.highWater; i++) {
    x += bodies.mass[i]! * bodies.vx[i]!;
    y += bodies.mass[i]! * bodies.vy[i]!;
  }
  return { x, y };
}

/** Total angular momentum about the origin, spin included. */
function angularMomentum(bodies: Bodies): number {
  let total = 0;
  for (let i = 0; i < bodies.highWater; i++) {
    total += bodies.mass[i]! * (bodies.x[i]! * bodies.vy[i]! - bodies.y[i]! * bodies.vx[i]!);
    total += bodies.inertia[i]! * bodies.angularVel[i]!;
  }
  return total;
}

describe('finding contacts', () => {
  it('finds nothing between hulls that are clear of each other', () => {
    const w = world({ design: corvette, x: 0, y: 0 }, { design: corvette, x: 400, y: 0 });
    findContacts(w.bodies, w.hulls, w.contacts);
    expect(w.contacts.count).toBe(0);
  });

  it('finds nothing when only the bounding circles meet', () => {
    // The point of testing the hull rather than the circle. A corvette's circle
    // reaches its bow, so two of them abeam overlap as circles while their
    // hulls are three metres of vacuum apart.
    const abeam = 20;
    expect(abeam).toBeLessThan(corvette.radius * 2);
    const w = world({ design: corvette, x: 0, y: 0 }, { design: corvette, x: 0, y: abeam });

    findContacts(w.bodies, w.hulls, w.contacts);
    expect(w.contacts.count).toBe(0);
  });

  it('finds one contact where two hulls really do overlap', () => {
    // Half a metre of overlap, nose to tail: the shallow meeting a real
    // collision is, rather than one hull buried in another.
    const w = world(
      { design: corvette, x: 0, y: 0 },
      { design: corvette, x: NOSE_TO_TAIL - 0.5, y: 0 },
    );
    findContacts(w.bodies, w.hulls, w.contacts);

    expect(w.contacts.count).toBe(1);
    expect(w.contacts.a[0]).toBe(0);
    expect(w.contacts.b[0]).toBe(1);
    expect(w.contacts.depth[0]).toBeGreaterThan(0);
    // Pushed apart along the line they are overlapping on, from a towards b.
    expect(w.contacts.nx[0]).toBeCloseTo(1, 9);
    expect(w.contacts.ny[0]).toBeCloseTo(0, 9);
    // And it names what met, for a damage model to spend the hit on.
    expect(w.contacts.moduleA[0]).toBeGreaterThanOrEqual(0);
    expect(w.contacts.moduleB[0]).toBeGreaterThanOrEqual(0);
  });

  it('ignores a body with no hull, which is a mass rather than a shape', () => {
    const bodies = new Bodies();
    bodies.create({ x: 0, y: 0, mass: 1, inertia: 1, radius: 50 });
    bodies.create({ x: 1, y: 0, mass: 1, inertia: 1, radius: 50 });
    const contacts = new Contacts();
    findContacts(bodies, { designOf: () => null }, contacts);
    expect(contacts.count).toBe(0);
  });

  it('keeps the pairs in body order, so resolution is reproducible', () => {
    const w = world(
      { design: corvette, x: 0, y: 0 },
      { design: corvette, x: NOSE_TO_TAIL - 0.5, y: 0 },
      { design: corvette, x: (NOSE_TO_TAIL - 0.5) * 2, y: 0 },
    );
    findContacts(w.bodies, w.hulls, w.contacts);
    expect(w.contacts.count).toBeGreaterThan(1);
    for (let k = 0; k < w.contacts.count; k++) {
      expect(w.contacts.a[k]!).toBeLessThan(w.contacts.b[k]!);
      if (k > 0) {
        const previous = w.contacts.a[k - 1]! * 1e6 + w.contacts.b[k - 1]!;
        expect(previous).toBeLessThan(w.contacts.a[k]! * 1e6 + w.contacts.b[k]!);
      }
    }
  });
});

describe('resolving a collision', () => {
  it('conserves momentum and angular momentum', () => {
    // The invariant that catches a sign error in the arms or the spin terms:
    // the two impulses are equal and opposite at one point, so neither total
    // can move.
    // A fighter crashing into a corvette's flank, both already turning.
    const w = world(
      { design: corvette, x: 0, y: 0, vx: 120, spin: 0.2 },
      { design: dinky, x: 7.5, y: 4.5, vx: -40, spin: -0.1 },
    );
    const p = momentum(w.bodies);
    const l = angularMomentum(w.bodies);

    findContacts(w.bodies, w.hulls, w.contacts);
    expect(w.contacts.count).toBe(1);
    resolveContacts(w.bodies, w.contacts);

    const after = momentum(w.bodies);
    expect(after.x).toBeCloseTo(p.x, 6);
    expect(after.y).toBeCloseTo(p.y, 6);
    expect(angularMomentum(w.bodies)).toBeCloseTo(l, 6);
  });

  it('leaves two hulls coming apart rather than closing', () => {
    const w = world(
      { design: corvette, x: 0, y: 0, vx: 200 },
      { design: corvette, x: NOSE_TO_TAIL - 0.5, y: 0, vx: -200 },
    );
    findContacts(w.bodies, w.hulls, w.contacts);
    resolveContacts(w.bodies, w.contacts);

    // Both reversed, and the closing speed is now an opening one.
    expect(w.bodies.vx[0]!).toBeLessThan(0);
    expect(w.bodies.vx[1]!).toBeGreaterThan(0);
  });

  it('gives back only what it is told to, so a ram is not a bounce', () => {
    const w = world(
      { design: corvette, x: 0, y: 0, vx: 100 },
      { design: corvette, x: NOSE_TO_TAIL - 0.5, y: 0, vx: -100 },
    );
    findContacts(w.bodies, w.hulls, w.contacts);
    resolveContacts(w.bodies, w.contacts);

    const opening = w.bodies.vx[1]! - w.bodies.vx[0]!;
    // Equal masses meeting head on: the separation speed is the closing speed
    // times the restitution, and most of the energy is gone.
    expect(opening).toBeCloseTo(200 * RESTITUTION, 6);
  });

  it('turns an off-centre hit into a spin', () => {
    // Struck well off the centre line: the arm from the centre of mass is what
    // makes a glancing blow tumble a ship rather than only shove it.
    const w = world(
      { design: corvette, x: 0, y: 0, vx: 150 },
      { design: dinky, x: 7.5, y: 4.5, vx: -150 },
    );
    findContacts(w.bodies, w.hulls, w.contacts);
    expect(w.contacts.count).toBe(1);
    resolveContacts(w.bodies, w.contacts);

    expect(w.bodies.angularVel[0]).not.toBe(0);
    expect(w.bodies.angularVel[1]).not.toBe(0);
  });

  it('bounces off something immovable without moving it', () => {
    const w = world(
      { design: corvette, x: 0, y: 0, vx: 150 },
      { design: corvette, x: NOSE_TO_TAIL - 0.5, y: 0, fixed: true },
    );
    findContacts(w.bodies, w.hulls, w.contacts);
    resolveContacts(w.bodies, w.contacts);

    expect(w.bodies.vx[0]!).toBeLessThan(0);
    expect(w.bodies.vx[1]!).toBe(0);
    expect(w.bodies.x[1]!).toBe(NOSE_TO_TAIL - 0.5);
  });

  it('pushes two hulls out of each other', () => {
    const gap = NOSE_TO_TAIL - 1;
    const w = world({ design: corvette, x: 0, y: 0 }, { design: corvette, x: gap, y: 0 });
    findContacts(w.bodies, w.hulls, w.contacts);
    expect(w.contacts.depth[0]!).toBeGreaterThan(0);

    // Closing, so the contact is live rather than one they are leaving.
    w.bodies.vx[0] = 10;
    w.bodies.vx[1] = -10;
    resolveContacts(w.bodies, w.contacts);
    expect(w.bodies.x[1]! - w.bodies.x[0]!).toBeGreaterThan(gap);
  });

  it('leaves alone two hulls that are already separating', () => {
    // They met last step and are on their way out: hitting them again would
    // add energy the collision never had.
    const w = world(
      { design: corvette, x: 0, y: 0, vx: -50 },
      { design: corvette, x: NOSE_TO_TAIL - 0.5, y: 0, vx: 50 },
    );
    const collisions = new Collisions();
    collisions.step(w.bodies, w.hulls);
    expect(collisions.contacts.count).toBe(1);
    expect(w.bodies.vx[0]).toBe(-50);
    expect(w.bodies.vx[1]).toBe(50);
  });
});

describe('a battle of nothing but collisions', () => {
  it('trades momentum between hulls without creating any', () => {
    // The `ram` scenario has no wells and no pilot, so nothing but the contact
    // solver can change a velocity. Whatever it does to four ships over three
    // thousand steps, the total has to come out where it went in.
    const run = ram();
    const before = momentum(run.world.bodies);

    for (let i = 0; i < 3000; i++) run.step();

    const after = momentum(run.world.bodies);
    expect(run.totalContacts).toBeGreaterThan(0);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('connects every attacker', () => {
    const run = ram();
    const met = new Set<number>();
    for (let i = 0; i < 3000; i++) {
      run.step();
      const contacts = run.collisions.contacts;
      for (let k = 0; k < contacts.count; k++) {
        met.add(contacts.a[k]!);
        met.add(contacts.b[k]!);
      }
    }
    // Bodies 1 to 3 are the three attackers, all aimed at the anvil. What
    // each of them ends up meeting is no longer only the anvil: the first
    // strike breaks pieces off it, and they are in the way of the next.
    expect(met.has(1)).toBe(true);
    expect(met.has(2)).toBe(true);
    expect(met.has(3)).toBe(true);
  });

  it('leaves the hulls tumbling rather than shaking', () => {
    // A contact solver that fights itself shows up as spin that keeps
    // growing, so the bound is on what a fragment carries away rather than on
    // what a hull does: a one-module piece has very little inertia, and a
    // sound knock sets it turning about once a second.
    const run = ram();
    for (let i = 0; i < 3000; i++) run.step();
    const bodies = run.world.bodies;
    for (let i = 0; i < bodies.highWater; i++) {
      if (bodies.alive[i] === 0) continue;
      expect(Number.isFinite(bodies.x[i]!)).toBe(true);
      expect(Math.abs(bodies.angularVel[i]!)).toBeLessThan(15);
      expect(Math.hypot(bodies.vx[i]!, bodies.vy[i]!)).toBeLessThan(200);
    }
  });
});
