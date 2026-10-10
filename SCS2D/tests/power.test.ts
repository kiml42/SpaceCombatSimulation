import { describe, expect, it } from 'vitest';
import {
  BeamHits,
  Beams,
  BATTERY_ENERGY_PER_VOLUME,
  CORE_BATTERY_SHARE,
  CORE_COMPUTING_VOLUME,
  CORE_GENERATOR_SHARE,
  Projectiles,
  SpatialGrid,
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
  type ModuleSpec,
} from '../sim/index.js';
import { TURRET_CORVETTE } from './fixtures.js';

const DT = 1 / 60;

/**
 * A generator astern and a battery ahead of a core too small to carry any
 * power of its own, the battery set out empty.
 */
function plant(generator = 4, battery = 3, fill = 0): Blueprint {
  return {
    name: 'Plant',
    modules: [
      { kind: 'core', x: 0, y: 0, length: 1, width: 1 },
      { kind: 'generator', x: -0.5 - generator / 2, y: 0, length: generator, width: generator },
      { kind: 'battery', x: 0.5 + battery / 2, y: 0, length: battery, width: battery, fill },
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

/**
 * Hull beams on a plate ahead of a core too small to carry power, and a
 * generator `generator` metres long astern of it. The second beam, if any, is
 * a secondary.
 */
function beamer(generator: number, beams = 1): Blueprint {
  const modules: ModuleSpec[] = [
    { kind: 'core', x: 0, y: 0, length: 1, width: 1 },
    { kind: 'structure', x: 1, y: 0, length: 1, width: 10 },
    { kind: 'hullBeam', x: 4.5, y: 2.5, angle: 0, length: 6, width: 4 },
  ];
  if (beams > 1) modules.push({ kind: 'hullBeam', x: 4.5, y: -2.5, angle: 0, length: 6, width: 4, main: false });
  if (generator > 0) modules.push({ kind: 'generator', x: -0.5 - generator / 2, y: 0, length: generator, width: 1 });
  return { name: 'Beamer', modules };
}

/** Shots each beam fires in `seconds` at an enemy that cannot be hurt. */
function shots(blueprint: Blueprint, seconds = 30): number[] {
  const design = compileBlueprint(blueprint);
  const world = new World({ dt: DT, seed: 6 });
  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());
  const projectiles = new Projectiles(256);
  const beams = new Beams(16);
  const hits = new BeamHits();
  const grid = new SpatialGrid(64);
  const me = ships.spawn(world, { design, x: 0, y: 0, team: 0 });
  const foe = ships.spawn(world, { design: compileBlueprint(TURRET_CORVETTE), x: 850, y: 0, team: 1, invulnerable: true });
  ships.pushOrder(me, foe, 750, 950, 10);
  const count = design.turrets.map(() => 0);
  const wasLit = design.turrets.map(() => false);
  for (let s = 0; s < seconds / DT; s++) {
    ships.command(DT, world);
    grid.rebuild(world.bodies);
    ships.fire(world, projectiles, beams, grid, hits);
    design.turrets.forEach((_, t) => {
      const lit = ships.turrets.lit[ships.turretIndexOf(me, t)] === 1;
      if (lit && !wasLit[t]) count[t]!++;
      wasLit[t] = lit;
    });
  }
  return count;
}

describe('a beam', () => {
  it('fires once and then never again with no power to refill its bank', () => {
    expect(shots(beamer(0))[0]).toBe(1);
  });

  it('fires as often as its piece of hull has the power for', () => {
    const small = shots(beamer(1))[0]!;
    const big = shots(beamer(4))[0]!;
    expect(small).toBeGreaterThan(1);
    expect(big).toBeGreaterThan(small * 2);
  });

  it('serves the main battery first when there is not enough to go round', () => {
    // About one beam's worth of plant for two.
    const [main, secondary] = shots(beamer(8, 2));
    expect(main).toBeGreaterThan(secondary! * 2);
  });
});

describe('a core', () => {
  it('carries a generator and a battery in its room past its computing', () => {
    const core = moduleStats({ kind: 'core', x: 0, y: 0, length: 4, width: 6 });
    const spare = core.interior - CORE_COMPUTING_VOLUME;
    expect(core.generation).toBeCloseTo(spare * CORE_GENERATOR_SHARE * GENERATOR_POWER_PER_VOLUME, 3);
    expect(core.charge).toBeCloseTo(spare * CORE_BATTERY_SHARE * BATTERY_ENERGY_PER_VOLUME, 3);
    expect(core.chargeRate).toBeGreaterThan(0);
    // None in one no bigger than its computing.
    const small = moduleStats({ kind: 'core', x: 0, y: 0, length: 1, width: 1 });
    expect(small.generation).toBe(0);
    expect(small.charge).toBe(0);
  });

  it('powers a beam bolted to it on its own', () => {
    const blueprint: Blueprint = {
      name: 'Core and beam',
      modules: [
        { kind: 'core', x: 0, y: 0, length: 4, width: 6 },
        { kind: 'hullBeam', x: 5, y: 0, angle: 0, length: 6, width: 4 },
      ],
    };
    expect(shots(blueprint)[0]).toBeGreaterThan(3);
  });
});
