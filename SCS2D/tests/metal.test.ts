import { describe, expect, it } from 'vitest';
import {
  BeamHits,
  Beams,
  CORE_COMPUTING_VOLUME,
  METAL_DENSITY,
  Metal,
  Projectiles,
  Ships,
  SpatialGrid,
  World,
  blueprintProblem,
  compileBlueprint,
  moduleStats,
  type Blueprint,
  type ShipDesign,
} from '../sim/index.js';
import { TURRET_CORVETTE } from './fixtures.js';

const DT = 1 / 60;
const corvette = compileBlueprint(TURRET_CORVETTE);

/** Every core in a blueprint, wherever it is written, set out with nothing in it. */
function emptied(blueprint: Blueprint): Blueprint {
  const empty = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(empty);
    if (v === null || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = empty(x);
    if (out['kind'] === 'core') out['fill'] = 0;
    return out;
  };
  return empty(blueprint) as Blueprint;
}

/** A ship moving at `vx` firing on a corvette ahead of it for `seconds`, the world never stepped. */
function firing(design: ShipDesign, seconds: number, vx = 0) {
  const world = new World({ dt: DT, seed: 6 });
  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());
  const projectiles = new Projectiles(256);
  const beams = new Beams(16);
  const beamHits = new BeamHits();
  const grid = new SpatialGrid(64);
  const mine = ships.spawn(world, { design, x: 0, y: 0, vx, team: 0 });
  const enemy = ships.spawn(world, { design: corvette, x: 850, y: 0, team: 1 });
  ships.pushOrder(mine, enemy, 750, 950, 10);
  const body = world.bodies.indexOf(ships.body(mine));
  let rounds = 0;
  for (let i = 0; i < seconds / DT; i++) {
    ships.command(DT, world);
    grid.rebuild(world.bodies);
    rounds += ships.fire(world, projectiles, beams, grid, beamHits).projectilesFired;
  }
  return { world, ships, projectiles, body, rounds };
}

describe('a hold', () => {
  it('holds its interior full of metal, and weighs it', () => {
    const hold = moduleStats({ kind: 'hold', x: 0, y: 0, length: 4, width: 3 });
    const plate = moduleStats({ kind: 'structure', x: 0, y: 0, length: 4, width: 3 });
    expect(hold.metal).toBeCloseTo(hold.interior * METAL_DENSITY, 6);
    expect(hold.mass).toBeCloseTo(plate.mass + hold.metal, 6);
    expect(hold.fuel).toBe(0);
  });

  it('is a layout like any other, and may be shaped', () => {
    const layout: Blueprint = {
      name: 'Collier',
      modules: [
        { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
        { kind: 'hold', x: 4, y: 0, length: 4, width: 3, fill: 0.5 },
        { kind: 'hold', x: -2.5, y: 0, length: 1.5, width: 2, vertices: [0.5, -1, 0.5, 1, -1, 0] },
      ],
    };
    expect(blueprintProblem(layout)).toBeNull();
    const design = compileBlueprint(layout);
    const half = design.modules[1]!.stats.metal * 0.5;
    expect(design.launchMass).toBeCloseTo(design.mass - half, 6);
  });

  it('gives a core a little, past its computing', () => {
    const core = moduleStats({ kind: 'core', x: 0, y: 0, length: 4, width: 4 });
    expect(core.metal).toBeGreaterThan(0);
    const small = moduleStats({ kind: 'core', x: 0, y: 0, length: 1, width: 1 });
    expect(small.interior).toBeLessThan(CORE_COMPUTING_VOLUME);
    expect(small.metal).toBe(0);
  });
});

describe('loading a round', () => {
  it('takes the whole round or none of it', () => {
    const metal = new Metal();
    metal.register(0, corvette);
    const left = metal.left(0);
    expect(metal.load(0, 0, left * 2)).toBe(false);
    expect(metal.left(0)).toBe(left);
    expect(metal.load(0, 0, left / 4)).toBe(true);
    expect(metal.left(0)).toBeCloseTo(left * 0.75, 6);
  });
});

describe('a gun firing', () => {
  it('holds its fire with nothing to load', () => {
    expect(firing(corvette, 20).rounds).toBeGreaterThan(0);
    expect(firing(compileBlueprint(emptied(TURRET_CORVETTE)), 20).rounds).toBe(0);
  });

  it('spends a round of metal for every round fired, and the hull is lighter by it', () => {
    const s = firing(corvette, 20);
    const roundMass = corvette.turrets.find((t) => t.gun.roundMass > 0)!.gun.roundMass;
    expect(s.rounds).toBeGreaterThan(0);
    // Every gun on the corvette is the same bore, so every round weighs the same.
    for (const t of corvette.turrets) if (t.gun.roundMass > 0) expect(t.gun.roundMass).toBe(roundMass);
    expect(s.ships.metal.spentMass(s.body)).toBeCloseTo(s.rounds * roundMass, 6);
    expect(s.world.bodies.mass[s.body]).toBeCloseTo(
      corvette.mass - s.ships.fuel.spentMass(s.body) - s.ships.metal.spentMass(s.body),
      6,
    );
  });

  it('keeps the momentum of the hull and its rounds', () => {
    const vx = 40;
    const s = firing(corvette, 20, vx);
    expect(s.rounds).toBeGreaterThan(0);
    const { bodies } = s.world;
    let px = bodies.mass[s.body]! * bodies.vx[s.body]!;
    let py = bodies.mass[s.body]! * bodies.vy[s.body]!;
    for (let r = 0; r < s.projectiles.highWater; r++) {
      px += s.projectiles.mass[r]! * s.projectiles.vx[r]!;
      py += s.projectiles.mass[r]! * s.projectiles.vy[r]!;
    }
    // Fuel the pilot burned left without a world step to push anything. What
    // is left over is the hull's spin, which a round leaves with and a centre
    // of mass held still does not answer for: far less than the rounds carried.
    const carried = s.ships.metal.spentMass(s.body) * vx;
    expect(Math.abs(px - (corvette.mass - s.ships.fuel.spentMass(s.body)) * vx)).toBeLessThan(carried / 20);
    expect(Math.abs(py)).toBeLessThan(carried / 20);
  });
});
