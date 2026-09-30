import { describe, expect, it } from 'vitest';
import {
  BOTH_LAYERS,
  BURST_FRAGMENTS,
  BURST_SPREAD,
  Beams,
  BeamHits,
  blueprintFileProblem,
  Bodies,
  compileBlueprint,
  DEFAULT_FUSE,
  moduleStats,
  SOLID_SHOT_MASS,
  parseBlueprint,
  ProjectileHits,
  Projectiles,
  Rng,
  serialiseBlueprint,
  Ships,
  SpatialGrid,
  World,
  type Blueprint,
} from '../sim/index.js';
import { OrderCancelCondition } from '../sim/ships.js';
import { TURRET_CORVETTE } from './fixtures.js';
import { mutate } from '../evolution/mutate.js';

/**
 * Timed fuses (ROADMAP.md §8 step 7): a round bursts shortly before it would
 * reach what it was aimed at, into fragments that meet every module.
 */

const DT = 1 / 60;

function burstOne(fuse: number, spread = 50): { rounds: Projectiles; before: { mass: number; px: number; py: number } } {
  const rounds = new Projectiles(64);
  const bodies = new Bodies();
  const grid = new SpatialGrid(64);
  grid.rebuild(bodies);
  rounds.spawn({ x: 0, y: 0, vx: 600, vy: 40, width: 0.4, ttl: 30, mass: 8, damage: 1e6, weaponsLayer: true, fuse, spread, fragmentLife: 1 });
  const before = { mass: 8, px: 8 * 600, py: 8 * 40 };
  const rng = new Rng(3);
  for (let t = 0; t < fuse + DT; t += DT) rounds.step(DT, bodies, grid, new ProjectileHits(), undefined, undefined, rng);
  return { rounds, before };
}

function live(rounds: Projectiles): number[] {
  const out: number[] = [];
  for (let i = 0; i < rounds.highWater; i++) if (rounds.alive[i] === 1) out.push(i);
  return out;
}

describe('a fused round', () => {
  it('bursts into fragments that share its mass and keep its momentum', () => {
    const { rounds, before } = burstOne(0.5);
    const fragments = live(rounds);
    expect(fragments).toHaveLength(BURST_FRAGMENTS);
    let mass = 0;
    let px = 0;
    let py = 0;
    for (const i of fragments) {
      mass += rounds.mass[i]!;
      px += rounds.mass[i]! * rounds.vx[i]!;
      py += rounds.mass[i]! * rounds.vy[i]!;
    }
    expect(mass).toBeCloseTo(before.mass, 9);
    expect(px).toBeCloseTo(before.px, 6);
    expect(py).toBeCloseTo(before.py, 6);
  });

  it('spreads them no faster than its spread, in both layers', () => {
    const { rounds } = burstOne(0.5, 50);
    for (const i of live(rounds)) {
      expect(Math.hypot(rounds.vx[i]! - 600, rounds.vy[i]! - 40)).toBeLessThanOrEqual(50 + 1e-9);
      expect(rounds.layers[i]).toBe(BOTH_LAYERS);
      expect(rounds.fuse[i]).toBe(Infinity);
      // Its own short life, less the step it has flown since.
      expect(rounds.ttl[i]).toBeGreaterThan(1 - 2 * DT);
      expect(rounds.ttl[i]).toBeLessThanOrEqual(1);
    }
  });

  it('flies on whole with no fuse', () => {
    const rounds = new Projectiles(8);
    const bodies = new Bodies();
    const grid = new SpatialGrid(64);
    grid.rebuild(bodies);
    rounds.spawn({ x: 0, y: 0, vx: 600, vy: 0, width: 0.4, ttl: 30 });
    for (let s = 0; s < 120; s++) rounds.step(DT, bodies, grid, new ProjectileHits(), undefined, undefined, new Rng(1));
    expect(live(rounds)).toHaveLength(1);
  });
});

describe('a gun with a fuse', () => {
  function shot(fuse?: number): { fuse: number; aim: number; spread: number; muzzle: number } {
    const design = compileBlueprint(
      fuse === undefined
        ? TURRET_CORVETTE
        : {
            ...TURRET_CORVETTE,
            modules: TURRET_CORVETTE.modules.map((p) => ('kind' in p && p.kind === 'turret' ? { ...p, fuse } : p)),
          },
    );
    const world = new World({ dt: DT, seed: 4 });
    const ships = new Ships();
    world.addForceProvider(ships.forceProvider());
    const mine = ships.spawn(world, { design, x: 0, y: 0 });
    const enemy = ships.spawn(world, { design, x: 800, y: 0, team: 1 });
    ships.pushOrder(mine, enemy, 700, 900, 10, OrderCancelCondition.None);
    for (let i = 0; i < 1800; i++) ships.command(DT, world);
    const grid = new SpatialGrid(64);
    grid.rebuild(world.bodies);
    const rounds = new Projectiles(16);
    ships.fire(world, rounds, new Beams(4), grid, new BeamHits());
    const i = live(rounds)[0]!;
    const muzzle = design.turrets[0]!.gun.muzzleSpeed;
    return { fuse: rounds.fuse[i]!, aim: 800 / muzzle, spread: rounds.spread[i]!, muzzle };
  }

  it('bursts its round shortly before what it is aimed at', () => {
    const { fuse, aim, spread, muzzle } = shot();
    // Roughly the flight time to a ship eight hundred metres off, less the lead.
    expect(fuse).toBeGreaterThan(aim * 0.8 - DEFAULT_FUSE);
    expect(fuse).toBeLessThan(aim * 1.2 - DEFAULT_FUSE);
    expect(spread).toBeCloseTo(muzzle * BURST_SPREAD, 9);
  });

  it('bursts it earlier the longer its fuse', () => {
    expect(shot(0.5).fuse).toBeCloseTo(shot(0.1).fuse - 0.4, 6);
  });

  it('fires solid shot at a fuse of zero: no burst, heavier and slower', () => {
    expect(shot(0).fuse).toBe(Infinity);
    const shell = moduleStats({ kind: 'turret', x: 0, y: 0, length: 6, width: 4 }).gun!;
    const solid = moduleStats({ kind: 'turret', x: 0, y: 0, length: 6, width: 4, fuse: 0 }).gun!;
    expect(solid.roundMass).toBeCloseTo(shell.roundMass * SOLID_SHOT_MASS, 9);
    expect(solid.muzzleEnergy).toBeCloseTo(shell.muzzleEnergy, 6);
    expect(solid.muzzleSpeed).toBeLessThan(shell.muzzleSpeed);
    expect(solid.roundMass * solid.muzzleSpeed).toBeGreaterThan(shell.roundMass * shell.muzzleSpeed);
  });
});

describe('a fuse under evolution', () => {
  it('is retimed, and swapped for solid shot and back', () => {
    const rng = new Rng(5);
    const seen = { retimed: false, solid: false };
    let parent: Blueprint = TURRET_CORVETTE;
    for (let i = 0; i < 600 && !(seen.retimed && seen.solid); i++) {
      const child = mutate(parent, rng).blueprint;
      const gun = child.modules.find((p) => 'kind' in p && p.kind === 'turret') as { fuse?: number } | undefined;
      if (gun?.fuse === 0) seen.solid = true;
      else if (gun?.fuse !== undefined && gun.fuse !== DEFAULT_FUSE) seen.retimed = true;
      parent = child;
    }
    expect(seen).toEqual({ retimed: true, solid: true });
  });
});

describe('a fuse in a file', () => {
  const ship = (fuse: unknown, kind = 'turret'): Record<string, unknown> => ({
    ...(serialiseBlueprint({ name: 'Gun', modules: [{ kind: 'core', x: 0, y: 0, length: 4, width: 4 }] }) as Record<string, unknown>),
    modules: [
      { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
      { kind, x: 4, y: 0, length: 4, width: 4, fuse },
    ],
  });

  it('is kept', () => {
    const bp: Blueprint = parseBlueprint(ship(0.35));
    expect(bp.modules[1]).toMatchObject({ fuse: 0.35 });
    expect(serialiseBlueprint(bp)).toMatchObject({ modules: [{}, { fuse: 0.35 }] });
  });

  it('is refused on a beam and below zero', () => {
    expect(blueprintFileProblem(ship(0.2, 'beamTurret'))).toMatch(/only a gun has a fuse/);
    expect(() => compileBlueprint(parseBlueprint(ship(-1)))).toThrow(/fuse must be at least 0/);
  });
});
