import { describe, expect, it } from 'vitest';
import {
  BATTERY_ENERGY_PER_VOLUME,
  BATTERY_POWER_PER_AREA,
  DAMAGE_ENERGY_PER_KG,
  GENERATOR_POWER_PER_VOLUME,
  Ships,
  World,
  compileBlueprint,
  moduleStats,
  parseBlueprint,
  serialiseBlueprint,
  type Blueprint,
} from '../sim/index.js';

const DT = 1 / 60;

/** A core with a generator astern and a battery to port, the battery set out empty. */
function plant(generator = 4, battery = 3, fill = 0): Blueprint {
  return {
    name: 'Plant',
    modules: [
      { kind: 'core', x: 0, y: 0, length: 3, width: 3 },
      { kind: 'generator', x: -1.5 - generator / 2, y: 0, length: generator, width: generator },
      { kind: 'battery', x: 0, y: 1.5 + battery / 2, length: battery, width: battery, fill },
    ],
  };
}
const GENERATOR = 1;
const BATTERY = 2;

function run(blueprint: Blueprint) {
  const world = new World({ dt: DT, seed: 1 });
  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());
  const ship = ships.spawn(world, { design: compileBlueprint(blueprint) });
  const body = world.bodies.indexOf(ships.body(ship));
  return {
    world,
    ships,
    body,
    step(seconds: number): void {
      for (let s = 0; s < seconds / DT; s++) {
        ships.command(DT, world);
        world.step();
      }
    },
  };
}

describe('a battery', () => {
  it('holds charge by its interior and passes it by its sides, so two small ones hold less and pass more', () => {
    const one = moduleStats({ kind: 'battery', x: 0, y: 0, length: 8, width: 8 });
    const half = moduleStats({ kind: 'battery', x: 0, y: 0, length: 8, width: 4 });
    expect(one.charge).toBeCloseTo(one.interior * BATTERY_ENERGY_PER_VOLUME, 3);
    expect(one.chargeRate).toBeCloseTo(BATTERY_POWER_PER_AREA * 32 * one.thickness, 3);
    expect(2 * half.charge).toBeLessThan(one.charge);
    expect(2 * half.chargeRate).toBeGreaterThan(one.chargeRate);
    expect(one.fuel).toBe(0);
    expect(one.generation).toBe(0);
  });

  it('weighs the same full or empty', () => {
    expect(compileBlueprint(plant(4, 3, 0)).launchMass).toBeCloseTo(compileBlueprint(plant(4, 3, 1)).launchMass, 6);
  });

  it('keeps how full it starts through a file', () => {
    const back = parseBlueprint(JSON.parse(JSON.stringify(serialiseBlueprint(plant(4, 3, 0.25)))));
    expect((back.modules[BATTERY] as { fill?: number }).fill).toBe(0.25);
  });
});

describe('a generator', () => {
  it('makes power by its interior, and holds nothing', () => {
    const generator = moduleStats({ kind: 'generator', x: 0, y: 0, length: 4, width: 4 });
    expect(generator.generation).toBeCloseTo(generator.interior * GENERATOR_POWER_PER_VOLUME, 3);
    expect(generator.charge).toBe(0);
  });

  it('fills the batteries on its piece of hull, without changing what the ship weighs', () => {
    const r = run(plant());
    const design = compileBlueprint(plant());
    const made = design.modules[GENERATOR]!.stats.generation;
    const mass = r.world.bodies.mass[r.body]!;
    expect(r.ships.power.held(r.body, BATTERY)).toBe(0);
    r.step(1);
    expect(r.ships.power.held(r.body, BATTERY)).toBeCloseTo(made * 1, -3);
    expect(r.world.bodies.mass[r.body]!).toBe(mass);
  });

  it('fills no faster than the battery can take it, and no fuller than full', () => {
    // A generator far bigger than the battery's wiring can take.
    const r = run(plant(12, 1));
    const battery = compileBlueprint(plant(12, 1)).modules[BATTERY]!.stats;
    r.step(0.5);
    expect(r.ships.power.held(r.body, BATTERY)).toBeLessThanOrEqual(battery.chargeRate * 0.5 + 1);
    r.step(60);
    expect(r.ships.power.held(r.body, BATTERY)).toBeCloseTo(battery.charge, 0);
  });

  it('makes nothing once it is shot out', () => {
    const r = run(plant());
    const stats = compileBlueprint(plant()).modules[GENERATOR]!.stats;
    r.ships.damage.absorb(r.body, GENERATOR, stats.hitPoints * DAMAGE_ENERGY_PER_KG * 0.8);
    r.step(1);
    expect(r.ships.power.held(r.body, BATTERY)).toBe(0);
  });
});

describe('a damaged battery', () => {
  it('loses the charge its broken cells held', () => {
    const r = run(plant(4, 3, 1));
    const stats = compileBlueprint(plant()).modules[BATTERY]!.stats;
    r.ships.damage.absorb(r.body, BATTERY, stats.hitPoints * DAMAGE_ENERGY_PER_KG * 0.5);
    // The generator tops it up to what it can still hold, and no more.
    r.step(1);
    expect(r.ships.power.held(r.body, BATTERY)).toBeCloseTo(stats.charge * 0.5, -3);
  });
});
