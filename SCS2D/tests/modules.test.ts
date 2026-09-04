import { describe, expect, it } from 'vitest';
import {
  BARREL_CALIBRES,
  BASE_WALL_THICKNESS,
  CALIBRE_FRACTION,
  DECK_HEIGHT,
  gunStats,
  HULL_DENSITY,
  moduleProblem,
  moduleStats,
  traverseAccel,
  traverseRate,
  type ModuleSpec,
} from '../sim/modules.js';

/**
 * The scaling laws are the game's balance, so what is worth testing is their
 * *shape* — which way each figure moves when a module is made bigger, and
 * where the counter-pressures are — rather than the constants, which are
 * expected to move.
 *
 * The exception is mass, which is checked against the geometry it claims to
 * come from: if wall volume is wrong then every ship's mass, inertia and
 * toughness are wrong together, and nothing downstream would look obviously
 * broken.
 */

function box(kind: ModuleSpec['kind'], length: number, width: number, reinforcement?: number): ModuleSpec {
  const spec: ModuleSpec = { kind, x: 0, y: 0, length, width };
  if (reinforcement !== undefined) spec.reinforcement = reinforcement;
  return spec;
}

describe('module geometry', () => {
  it('takes its structure mass from the volume of its walls', () => {
    const length = 10;
    const width = 4;
    const t = BASE_WALL_THICKNESS;
    const stats = moduleStats(box('structure', length, width));

    const outer = length * width * DECK_HEIGHT;
    const inner = (length - 2 * t) * (width - 2 * t) * (DECK_HEIGHT - 2 * t);

    expect(stats.wallVolume).toBeCloseTo(outer - inner, 10);
    expect(stats.structureMass).toBeCloseTo((outer - inner) * HULL_DENSITY, 6);
    expect(stats.mass).toBe(stats.structureMass);
  });

  it('leaves the interior area as capacity', () => {
    const stats = moduleStats(box('structure', 10, 4));
    const t = BASE_WALL_THICKNESS;
    expect(stats.capacity).toBeCloseTo((10 - 2 * t) * (4 - 2 * t), 10);
  });

  it('makes a bigger module proportionally lighter for the space it encloses', () => {
    // The degenerate optimum to watch for (DESIGN.md §4): capacity grows faster
    // than the wall that encloses it, so scale is rewarded and something else
    // has to push back.
    const small = moduleStats(box('structure', 5, 5));
    const large = moduleStats(box('structure', 10, 10));
    expect(large.capacity / small.capacity).toBeGreaterThan(large.mass / small.mass);
  });

  it('punishes a long thin module against a square one of the same area', () => {
    // One of the counter-pressures: perimeter, and therefore wall, grows as a
    // module is stretched, so splinters are not free.
    const square = moduleStats(box('structure', 8, 8));
    const sliver = moduleStats(box('structure', 32, 2));
    expect(sliver.capacity).toBeLessThan(square.capacity);
    expect(sliver.mass).toBeGreaterThan(square.mass);
  });

  it('buys thickness and toughness with reinforcement, and pays in mass', () => {
    const plain = moduleStats(box('structure', 10, 4));
    const armoured = moduleStats(box('structure', 10, 4, 4));

    expect(armoured.wallThickness).toBeCloseTo(4 * plain.wallThickness, 12);
    expect(armoured.hitPoints).toBeGreaterThan(plain.hitPoints);
    expect(armoured.mass).toBeGreaterThan(plain.mass);
    expect(armoured.capacity).toBeLessThan(plain.capacity);
  });

  it('rejects a module whose walls would meet in the middle', () => {
    expect(moduleProblem(box('structure', 10, 4, 200))).toMatch(/no interior/);
    expect(() => moduleStats(box('structure', 10, 4, 200))).toThrow(/no interior/);
  });

  it('rejects nonsensical dimensions and reinforcement', () => {
    expect(moduleProblem(box('structure', 0, 4))).toMatch(/positive/);
    expect(moduleProblem(box('structure', 10, -1))).toMatch(/positive/);
    expect(moduleProblem(box('structure', 10, 4, 0.5))).toMatch(/at least 1/);
    expect(moduleProblem(box('structure', 10, 4))).toBeNull();
  });
});

describe('thruster scaling', () => {
  it('takes thrust from the exit area, so width is what buys it', () => {
    const narrow = moduleStats(box('thruster', 6, 2));
    const wide = moduleStats(box('thruster', 6, 4));
    const long = moduleStats(box('thruster', 12, 2));

    expect(wide.thrust).toBeCloseTo(2 * narrow.thrust, 6);
    expect(long.thrust).toBeCloseTo(narrow.thrust, 6);
  });

  it('charges machinery mass for the thrust it produces', () => {
    const narrow = moduleStats(box('thruster', 6, 2));
    expect(narrow.fittingMass).toBeGreaterThan(0);
    expect(narrow.mass).toBeGreaterThan(narrow.structureMass);
  });

  it('gives a structure module no thrust and no gun', () => {
    const stats = moduleStats(box('structure', 6, 2));
    expect(stats.thrust).toBe(0);
    expect(stats.gun).toBeNull();
    expect(stats.fittingMass).toBe(0);
  });
});

describe('gun scaling', () => {
  it('takes its bore from the mount width and its barrel from the bore', () => {
    const gun = gunStats(40, 8);
    expect(gun.calibre).toBeCloseTo(8 * CALIBRE_FRACTION, 12);
    expect(gun.barrelLength).toBeCloseTo(gun.calibre * BARREL_CALIBRES, 12);
  });

  it('will not fit a barrel longer than the mount that carries it', () => {
    const cramped = gunStats(6, 8);
    expect(cramped.barrelLength).toBe(6);
    expect(cramped.barrelLength).toBeLessThan(cramped.calibre * BARREL_CALIBRES);
  });

  it('holds muzzle velocity roughly constant once the barrel fits', () => {
    // Charge energy scales with bore volume and shell mass with the cube of
    // calibre, so a gun of any size built to the same calibre ratio arrives at
    // the same muzzle velocity — which is what real naval guns do, and it is
    // the reason a bigger gun is bought for weight of shell rather than speed.
    const small = gunStats(100, 4);
    const large = gunStats(100, 16);
    expect(large.muzzleSpeed).toBeCloseTo(small.muzzleSpeed, 6);
    expect(large.roundMass / small.roundMass).toBeCloseTo(64, 6);
  });

  it('trades rate of fire and handiness for weight of shell', () => {
    const light = gunStats(100, 4);
    const heavy = gunStats(100, 16);
    expect(heavy.muzzleEnergy).toBeGreaterThan(light.muzzleEnergy);
    expect(heavy.cycleTime).toBeGreaterThan(light.cycleTime);
  });

  it('buys velocity with barrel length when the mount is what limits it', () => {
    const stubby = gunStats(4, 8);
    const long = gunStats(12, 8);
    expect(long.muzzleSpeed).toBeGreaterThan(stubby.muzzleSpeed);
    expect(long.roundMass).toBeCloseTo(stubby.roundMass, 12);
  });

  it('carries the mass of the barrel on the mount', () => {
    const stats = moduleStats(box('turret', 12, 8));
    expect(stats.gun).not.toBeNull();
    expect(stats.fittingMass).toBeGreaterThan(0);
    expect(stats.mass).toBeGreaterThan(stats.structureMass);
  });
});

describe('traverse limits', () => {
  it('slows a mount down as its barrel gets longer', () => {
    expect(traverseRate(4)).toBeGreaterThan(traverseRate(12));
    expect(traverseRate(4) * 4).toBeCloseTo(traverseRate(12) * 12, 12);
  });

  it('gives a heavier mount more torque but no more agility for its inertia', () => {
    const mass = 50_000;
    const inertia = 1e6;
    expect(traverseAccel(mass, inertia)).toBeGreaterThan(0);
    expect(traverseAccel(2 * mass, inertia)).toBeCloseTo(2 * traverseAccel(mass, inertia), 12);
    expect(traverseAccel(mass, 2 * inertia)).toBeCloseTo(traverseAccel(mass, inertia) / 2, 12);
  });
});
