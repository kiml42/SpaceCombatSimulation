import { describe, expect, it } from 'vitest';
import {
  HullPath,
  Ships,
  World,
  compileBlueprint,
  joints,
  resolveRound,
  type Blueprint,
  type Rng,
} from '../sim/index.js';
import { LEAK_CHANCE, leakChance, leakRate, leakSpeed, type Leak } from '../sim/fuel.js';

/** A core and a tank ahead of it, and nothing to fly with: what moves it is the leak. */
const DRUM: Blueprint = {
  name: 'Drum',
  modules: [
    { kind: 'core', x: 0, y: 0, length: 2, width: 2 },
    { kind: 'tank', x: 4, y: 0, length: 6, width: 4 },
  ],
};
const TANK = 1;
const drum = compileBlueprint(DRUM);

/** Decides every hole the same way. */
const always = { nextFloat: () => 0 } as unknown as Rng;
const never = { nextFloat: () => 0.999999 } as unknown as Rng;

function scene(): { world: World; ships: Ships; ship: number; body: number } {
  const world = new World({ dt: 1 / 60, seed: 2 });
  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());
  const ship = ships.spawn(world, { design: drum, x: 0, y: 0, team: 0 });
  return { world, ships, ship, body: world.bodies.indexOf(ships.body(ship)) };
}
const step = (s: { world: World; ships: Ships }): void => {
  s.ships.command(1 / 60, s.world);
  s.world.step();
};

/** The middle of the tank's bow face, in the hull's frame. */
const tank = drum.modules[TANK]!;
const bowX = tank.x + tank.spec.length / 2;

describe('how a tank leaks', () => {
  it('is likelier to be holed the more it has been hurt', () => {
    expect(leakChance(1)).toBe(LEAK_CHANCE);
    expect(leakChance(0.5)).toBeGreaterThan(leakChance(1));
    expect(leakChance(0)).toBe(1);
  });

  it('leaks faster through a bigger hole and from a fuller tank', () => {
    expect(leakRate(0.02, 1)).toBeCloseTo(2 * leakRate(0.01, 1), 9);
    // Orifice flow goes as the square root of the pressure behind it.
    expect(leakRate(0.01, 0.25)).toBeCloseTo(leakRate(0.01, 1) / 2, 9);
    expect(leakRate(0.01, 0)).toBe(0);
    expect(leakSpeed(0.25)).toBeCloseTo(leakSpeed(1) / 2, 9);
  });
});

describe('a holed tank', () => {
  it('loses its fuel, gets lighter, and is pushed away from the hole', () => {
    const s = scene();
    s.ships.holed(s.body, TANK, 1, bowX, 0, 1, 0, 0.2, always);
    expect(s.ships.fuel.leaksOf(s.body)).toHaveLength(1);
    const full = s.ships.fuel.held(s.body, TANK);
    for (let i = 0; i < 60; i++) step(s);
    const left = s.ships.fuel.held(s.body, TANK);
    expect(left).toBeLessThan(full);
    expect(s.world.bodies.mass[s.body]).toBeCloseTo(drum.mass - (full - left), 6);
    // Fuel out of the bow, the ship pushed astern, and nowhere else.
    expect(s.world.bodies.vx[s.body]).toBeLessThan(0);
    expect(Math.abs(s.world.bodies.vy[s.body]!)).toBeLessThan(1e-9);
  });

  it('is left alone by a round the plate closes round', () => {
    const s = scene();
    s.ships.holed(s.body, TANK, 1, bowX, 0, 1, 0, 0.2, never);
    expect(s.ships.fuel.leaksOf(s.body)).toHaveLength(0);
  });

  it('cannot be holed once it is empty', () => {
    const s = scene();
    s.ships.fuel.vent(s.body, TANK, Infinity);
    s.ships.holed(s.body, TANK, 1, bowX, 0, 1, 0, 0.2, always);
    expect(s.ships.fuel.leaksOf(s.body)).toHaveLength(0);
  });

  it('keeps its hole when it is cut off the ship it was part of', () => {
    const s = scene();
    s.ships.holed(s.body, TANK, 1, bowX, 0, 1, 0, 0.2, always);
    for (const [k, joint] of joints(drum).entries()) {
      s.ships.damage.cutWeld(s.body, k, joint.width);
    }
    s.ships.sever(s.world);
    // The core flies on as the ship, and the tank is the new piece.
    const piece = s.world.bodies.indexOf(s.ships.body(s.ship + 1));
    expect(s.ships.fuel.leaksOf(s.body)).toHaveLength(0);
    expect(s.ships.fuel.leaksOf(piece)).toHaveLength(1);
    expect(s.ships.fuel.leaksOf(piece)[0]!.module).toBe(0);
  });
});

describe('a round through a tank', () => {
  /** A round down the tank's length from the bow; the holes it leaves. */
  function shoot(rng: Rng): readonly Leak[] {
    const s = scene();
    resolveRound(drum, s.ships.damage, s.world.bodies, s.body, new HullPath(), bowX + 1, 0, -1, 0, 20, 0.1, 1200, undefined, s.ships, rng);
    return s.ships.fuel.leaksOf(s.body);
  }

  it('holes the face it went in by, and not the bulkhead it goes on through', () => {
    // The core behind the tank holds fuel too, and the round goes on into it.
    expect(drum.modules[0]!.stats.fuel).toBeGreaterThan(0);
    expect(shoot(always)).toHaveLength(1);
    expect(shoot(never)).toHaveLength(0);
  });

  it('lets the fuel out back the way the round came in', () => {
    const [hole] = shoot(always);
    expect(hole!.nx).toBeCloseTo(1, 12);
    expect(hole!.ny).toBeCloseTo(0, 12);
  });
});
