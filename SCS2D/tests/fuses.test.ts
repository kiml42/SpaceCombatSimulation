import { describe, expect, it } from 'vitest';
import {
  BOTH_LAYERS,
  chargeShare,
  DEFAULT_BURST_SPEED,
  EXPLOSIVE_DENSITY,
  IMPACT_BURST,
  Impacts,
  Beams,
  BeamHits,
  blueprintFileProblem,
  blueprintWarnings,
  Bodies,
  compileBlueprint,
  DEFAULT_FUSE,
  moduleStats,
  SHELL_DENSITY,
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
import { EXPLOSIVE_YIELD } from '../sim/modules.js';
import { lethalRadius, reachAgainst } from '../sim/blueprint.js';
import { moduleStats as statsOf, type ModuleSpec } from '../sim/modules.js';
import { TURRET_CORVETTE } from './fixtures.js';
import { mutate } from '../evolution/mutate.js';

/**
 * Timed fuses (ROADMAP.md §8 step 7): a round bursts shortly before it would
 * reach what it was aimed at, into fragments that meet every module.
 */

const DT = 1 / 60;

function burstOne(fuse: number, spread = 50, fragments = 8, metal = 1): { rounds: Projectiles; before: { mass: number; px: number; py: number } } {
  const rounds = new Projectiles(64);
  const bodies = new Bodies();
  const grid = new SpatialGrid(64);
  grid.rebuild(bodies);
  // Eight kilograms, six of them casing: the charge goes to gas.
  rounds.spawn({ x: 0, y: 0, vx: 600, vy: 40, width: 0.4, ttl: 30, mass: 8, casing: 6, damage: 1e6, weaponsLayer: true, fuse, spread, fragmentLife: 1, fragments, metal });
  const before = { mass: 6, px: 6 * 600, py: 6 * 40 };
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
  it('bursts into fragments that share its casing and keep its momentum', () => {
    for (const n of [8, 5]) {
    const { rounds, before } = burstOne(0.5, 50, n);
    const fragments = live(rounds);
    expect(fragments).toHaveLength(n);
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
    }
  });

  it('gives the fragments the metal of its bore, not the charge', () => {
    const { rounds } = burstOne(0.5, 50, 5, 0.7);
    let area = 0;
    for (const i of live(rounds)) area += rounds.width[i]! ** 2;
    expect(area).toBeCloseTo(0.7 * 0.4 ** 2, 12);
  });

  it('logs a flash where it burst, as bright as its charge', () => {
    const rounds = new Projectiles(64);
    const bodies = new Bodies();
    const grid = new SpatialGrid(64);
    grid.rebuild(bodies);
    rounds.spawn({ x: 0, y: 0, vx: 600, vy: 0, width: 0.4, ttl: 30, mass: 8, casing: 6, fuse: 0.1, spread: 50, fragmentLife: 1, fragments: 8 });
    const impacts = new Impacts();
    const rng = new Rng(3);
    for (let t = 0; t < 0.1 + 2 * DT; t += DT) {
      rounds.step(DT, bodies, grid, new ProjectileHits(), undefined, undefined, rng);
      impacts.bursts(rounds);
    }
    expect(impacts.log.count).toBe(1);
    expect(impacts.log.kind[0]).toBe(IMPACT_BURST);
    // Eight kilograms, six of them casing: two of charge.
    expect(impacts.log.energy[0]).toBeCloseTo(2 * EXPLOSIVE_YIELD, 3);
    // Going on with the shell, as the gas does.
    expect(impacts.log.vx[0]).toBe(600);
    expect(impacts.log.vy[0]).toBe(0);
    // And spreading as fast as its fastest fragment leaves.
    expect(impacts.log.growth[0]).toBe(50);
  });

  it('flies on whole with one fragment or none', () => {
    expect(live(burstOne(0.5, 50, 1).rounds)).toHaveLength(1);
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
    expect(spread).toBe(DEFAULT_BURST_SPEED);
    expect(muzzle).toBeGreaterThan(0);
  });

  it('bursts at the aim point on a fuse of zero', () => {
    expect(shot(0).fuse).toBeCloseTo(shot(0.1).fuse + 0.1, 6);
  });

  it('bursts it earlier the longer its fuse', () => {
    expect(shot(0.5).fuse).toBeCloseTo(shot(0.1).fuse - 0.4, 6);
  });

  it('fires solid shot with one fragment: no burst, heavier and slower', () => {
    const turret = { kind: 'turret' as const, x: 0, y: 0, length: 6, width: 4 };
    const shell = moduleStats(turret).gun!;
    const solid = moduleStats({ ...turret, fragments: 1 }).gun!;
    const share = chargeShare(DEFAULT_BURST_SPEED);
    expect(shell.roundMass).toBeCloseTo(solid.roundMass * (1 - share + (share * EXPLOSIVE_DENSITY) / SHELL_DENSITY), 9);
    expect(solid.muzzleEnergy).toBeCloseTo(shell.muzzleEnergy, 6);
    expect(solid.muzzleSpeed).toBeLessThan(shell.muzzleSpeed);
  });

  it('gives a faster burst a lighter shell', () => {
    const turret = { kind: 'turret' as const, x: 0, y: 0, length: 6, width: 4 };
    const gentle = moduleStats({ ...turret, burstSpeed: 50 }).gun!;
    const fierce = moduleStats({ ...turret, burstSpeed: 800 }).gun!;
    expect(fierce.roundMass).toBeLessThan(gentle.roundMass * 0.9);
    expect(fierce.muzzleSpeed).toBeGreaterThan(gentle.muzzleSpeed);
    expect(chargeShare(800)).toBeGreaterThan(chargeShare(50));
  });
});

describe('a fuse under evolution', () => {
  it('is retimed, and swapped for solid shot and back', () => {
    const rng = new Rng(5);
    const seen = { retimed: false, solid: false };
    let parent: Blueprint = TURRET_CORVETTE;
    for (let i = 0; i < 1500 && !(seen.retimed && seen.solid); i++) {
      const child = mutate(parent, rng).blueprint;
      for (const p of child.modules) {
        if (!('kind' in p) || (p.kind !== 'turret' && p.kind !== 'hullGun')) continue;
        if (p.fragments === 1) seen.solid = true;
        if (p.fuse !== undefined && p.fuse !== DEFAULT_FUSE) seen.retimed = true;
      }
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

  it('is unread on a beam, said so, and refused below zero', () => {
    expect(blueprintFileProblem(ship(0.2, 'beamTurret'))).toBeNull();
    expect(blueprintWarnings(parseBlueprint(ship(0.2, 'beamTurret'))).join('\n')).toMatch(/fuse/);
    expect(() => compileBlueprint(parseBlueprint(ship(-1)))).toThrow(/fuse must be at least 0/);
  });
});


/**
 * What a burst does to how far the gun is worth firing: a shell may miss by as
 * much as its fragments cover, so it is that, not the hull, that `reachAgainst`
 * is measured against.
 */
describe('how far a burst lets a gun shoot', () => {
  const gunOf = (over: Partial<ModuleSpec> = {}) => {
    const gun = statsOf({ kind: 'turret', x: 0, y: 0, length: 8, width: 6, ...over } as ModuleSpec).gun!;
    expect(gun).not.toBeNull();
    return gun;
  };

  /** A fighter is about this across, and is what the floor exists for. */
  const POINT = 1.64;

  it('covers more than a point-like target is wide, so the gun may shoot from further off', () => {
    const shell = gunOf();
    const solid = gunOf({ fragments: 1 });
    expect(solid.burst).toBeNull();
    expect(lethalRadius(solid, POINT)).toBe(POINT);
    expect(lethalRadius(shell, POINT)).toBeGreaterThan(2 * POINT);
    expect(reachAgainst(shell, POINT)).toBeGreaterThan(reachAgainst(solid, POINT));
  });

  it('covers more ground the more pieces the shell splits into', () => {
    const few = lethalRadius(gunOf({ fragments: 4 }), POINT);
    const many = lethalRadius(gunOf({ fragments: 16 }), POINT);
    expect(many).toBeGreaterThan(few);
  });

  it('is capped by where the fragments have got to, so a long fuse buys nothing on its own', () => {
    const cloud = (fuse: number) => gunOf({ fuse }).burst!.radius;
    // Short enough that the cloud is the binding limit rather than the count.
    expect(cloud(0.005)).toBeGreaterThan(POINT);
    expect(lethalRadius(gunOf({ fuse: 0.005 }), POINT)).toBeCloseTo(cloud(0.005), 9);
    // Long enough that the count binds instead, and lengthening it does no more.
    expect(lethalRadius(gunOf({ fuse: 1 }), POINT)).toBe(lethalRadius(gunOf({ fuse: 10 }), POINT));
  });

  it('never makes a target smaller than it is', () => {
    const shell = gunOf();
    const hull = 32;
    expect(lethalRadius(shell, hull)).toBe(hull);
    expect(lethalRadius(gunOf({ fuse: 0 }), POINT)).toBe(POINT);
  });

  it('leaves a beam alone, having no round to burst', () => {
    const beam = gunOf({ kind: 'beamTurret' });
    expect(beam.burst).toBeNull();
    expect(reachAgainst(beam, POINT)).toBe(reachAgainst(beam, 1000));
  });
});
