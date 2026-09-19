import { describe, expect, it } from 'vitest';
import {
  Ships,
  World,
  compileBlueprint,
  joints,
  type Blueprint,
  type ModuleSpec,
  type ShipDesign,
} from '../sim/index.js';

/**
 * Hulls coming apart.
 *
 * The graph that decides *where* a hull parts is tested on its own; what is
 * here is what happens when it does — that the pieces carry the momentum,
 * the spin and the scars they had a moment earlier, that the surviving ship
 * does not jump, and that a piece with nobody on it behaves like matter
 * rather than like a ship.
 */

function structure(x: number, y: number, length: number, width: number): ModuleSpec {
  return { kind: 'structure', x, y, length, width };
}

/**
 * Three boxes in a row. The tip is joined by 2 m of weld and the tail by 4 m,
 * so there is a weak end and a strong one and which breaks is not a toss-up.
 */
const CHAIN: Blueprint = {
  name: 'Chain',
  modules: [structure(0, 0, 10, 4), structure(-10, 0, 10, 4), structure(8, 0, 6, 2)],
};

const design: ShipDesign = compileBlueprint(CHAIN);
/** The weld holding the tip on. */
const TIP_JOINT = joints(design).find((j) => j.a === 0 && j.b === 2)!;

interface Scene {
  world: World;
  ships: Ships;
  ship: number;
  body: number;
}

function scene(vx = 30, vy = -10, spin = 0.4): Scene {
  const world = new World({ dt: 1 / 60, seed: 1 });
  const ships = new Ships();
  const ship = ships.spawn(world, { design, x: 100, y: 40, angle: 0.3, vx, vy, angularVel: spin, team: 1 });
  return { world, ships, ship, body: world.bodies.indexOf(ships.body(ship)) };
}

/** Mass, momentum and angular momentum about the world origin, over everything. */
function totals(scene: Scene): { mass: number; px: number; py: number; l: number } {
  const b = scene.world.bodies;
  let mass = 0;
  let px = 0;
  let py = 0;
  let l = 0;
  for (let i = 0; i < b.highWater; i++) {
    if (b.alive[i] === 0) continue;
    mass += b.mass[i]!;
    px += b.mass[i]! * b.vx[i]!;
    py += b.mass[i]! * b.vy[i]!;
    l += b.inertia[i]! * b.angularVel[i]!;
    l += b.mass[i]! * (b.x[i]! * b.vy[i]! - b.y[i]! * b.vx[i]!);
  }
  return { mass, px, py, l };
}

/** Where a module of a ship is in the world, which a sever must not change. */
function moduleAt(scene: Scene, ship: number, module: number): { x: number; y: number } {
  const b = scene.world.bodies;
  const i = b.indexOf(scene.ships.body(ship));
  const m = scene.ships.design(ship).modules[module]!;
  const c = Math.cos(b.angle[i]!);
  const s = Math.sin(b.angle[i]!);
  return { x: b.x[i]! + m.x * c - m.y * s, y: b.y[i]! + m.x * s + m.y * c };
}

/** Put enough into a module to part every weld holding it. */
function wreck(scene: Scene, module: number, joules: number): void {
  scene.ships.damage.absorb(scene.body, module, joules);
}

describe('severing a hull', () => {
  it('leaves an undamaged ship alone', () => {
    const s = scene();
    expect(s.ships.sever(s.world)).toBe(0);
    expect(s.ships.count).toBe(1);
  });

  it('leaves a damaged ship alone while its welds hold', () => {
    const s = scene();
    wreck(s, 2, TIP_JOINT.strength * 0.9);
    expect(s.ships.sever(s.world)).toBe(0);
    expect(s.ships.design(s.ship).modules).toHaveLength(3);
  });

  it('takes the piece off at the weld that gave way', () => {
    const s = scene();
    wreck(s, 2, TIP_JOINT.strength * 1.1);
    expect(s.ships.sever(s.world)).toBe(1);
    expect(s.ships.count).toBe(2);
    // The ship keeps the two boxes the crew is on; the tip goes.
    expect(s.ships.design(s.ship).modules).toHaveLength(2);
    expect(s.ships.design(s.ship + 1).modules).toHaveLength(1);
  });

  it('conserves mass, momentum and angular momentum', () => {
    const s = scene();
    const before = totals(s);
    wreck(s, 2, TIP_JOINT.strength * 1.1);
    s.ships.sever(s.world);
    const after = totals(s);
    expect(after.mass).toBeCloseTo(before.mass, 9);
    expect(after.px).toBeCloseTo(before.px, 9);
    expect(after.py).toBeCloseTo(before.py, 9);
    expect(after.l).toBeCloseTo(before.l, 6);
  });

  it('leaves every module exactly where it was', () => {
    const s = scene();
    const tail = moduleAt(s, s.ship, 1);
    const tip = moduleAt(s, s.ship, 2);
    wreck(s, 2, TIP_JOINT.strength * 1.1);
    s.ships.sever(s.world);
    // The tail is the ship's second module still; the tip is the whole of the
    // piece that came off.
    expect(moduleAt(s, s.ship, 1).x).toBeCloseTo(tail.x, 9);
    expect(moduleAt(s, s.ship, 1).y).toBeCloseTo(tail.y, 9);
    expect(moduleAt(s, s.ship + 1, 0).x).toBeCloseTo(tip.x, 9);
    expect(moduleAt(s, s.ship + 1, 0).y).toBeCloseTo(tip.y, 9);
  });

  it('carries the damage across with the modules that took it', () => {
    const s = scene();
    wreck(s, 2, TIP_JOINT.strength * 1.1);
    wreck(s, 1, 1000);
    s.ships.sever(s.world);
    const chunkBody = s.world.bodies.indexOf(s.ships.body(s.ship + 1));
    expect(s.ships.damage.absorbedAt(chunkBody, 0)).toBeCloseTo(TIP_JOINT.strength * 1.1, 6);
    expect(s.ships.damage.absorbedAt(s.body, 1)).toBeCloseTo(1000, 9);
  });

  it('gives the piece to nobody: it is not flown and does not shoot', () => {
    const s = scene();
    wreck(s, 2, TIP_JOINT.strength * 1.1);
    s.ships.sever(s.world);
    const chunk = s.ship + 1;
    expect(s.ships.isDerelict(chunk)).toBe(true);
    expect(s.ships.isDisabled(chunk)).toBe(true);

    // A ship with no orders brakes to a halt, so a piece that is still
    // drifting a second later is one nobody is flying.
    const b = s.world.bodies;
    const i = b.indexOf(s.ships.body(chunk));
    const speed = Math.hypot(b.vx[i]!, b.vy[i]!);
    for (let step = 0; step < 60; step++) {
      s.ships.command(1 / 60, s.world);
      s.world.step();
    }
    expect(Math.hypot(b.vx[i]!, b.vy[i]!)).toBeCloseTo(speed, 6);
  });

  it('keeps the ship it was: same body, same team, same orders', () => {
    const s = scene();
    s.ships.pushOrder(s.ship, 7, 100, 400, 50);
    const id = s.ships.body(s.ship);
    wreck(s, 2, TIP_JOINT.strength * 1.1);
    s.ships.sever(s.world);
    expect(s.ships.body(s.ship)).toBe(id);
    expect(s.ships.teamOf(s.ship)).toBe(1);
    expect(s.ships.orderCount(s.ship)).toBe(1);
  });

  it('re-measures the ship that is left', () => {
    const s = scene();
    wreck(s, 2, TIP_JOINT.strength * 1.1);
    s.ships.sever(s.world);
    const b = s.world.bodies;
    const left = s.ships.design(s.ship);
    expect(b.mass[s.body]).toBeCloseTo(left.mass, 9);
    expect(b.inertia[s.body]).toBeCloseTo(left.inertia, 9);
    expect(b.radius[s.body]).toBeCloseTo(left.radius, 9);
    expect(left.mass).toBeLessThan(design.mass);
  });

  it('breaks a piece that is itself in pieces on the same pass', () => {
    // Wreck the middle box so hard that both its welds go at once: the hull
    // is in three pieces, not two, and none of them waits a step.
    const s = scene();
    const worst = Math.max(...joints(design).map((j) => j.strength));
    wreck(s, 0, worst * 1.1);
    expect(s.ships.sever(s.world)).toBe(2);
    expect(s.ships.count).toBe(3);
    for (const ship of [s.ship + 1, s.ship + 2]) {
      expect(s.ships.design(ship).modules).toHaveLength(1);
    }
  });
});
