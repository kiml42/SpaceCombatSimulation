import { describe, expect, it } from 'vitest';
import {
  Bodies,
  compileBlueprint,
  firingArc,
  isRaised,
  masked,
  moduleStats,
  parseBlueprint,
  blueprintFileProblem,
  ProjectileHits,
  Projectiles,
  serialiseBlueprint,
  Ships,
  SpatialGrid,
  triggerMask,
  Turrets,
  World,
  type Blueprint,
  type ModuleSpec,
} from '../sim/index.js';

/**
 * The two layers (DESIGN.md §3): the deck and below, and what stands up above
 * it. Turrets fire above the deck and meet only what is raised; hull weapons
 * fire at deck height and meet everything.
 */

const PI = Math.PI;

describe('which layer a module is in', () => {
  it('is fixed by kind, except for structure and cores', () => {
    const at = { x: 0, y: 0, length: 4, width: 4 };
    expect(isRaised({ kind: 'turret', ...at })).toBe(true);
    expect(isRaised({ kind: 'beamTurret', ...at })).toBe(true);
    expect(isRaised({ kind: 'engine', ...at })).toBe(true);
    expect(isRaised({ kind: 'core', ...at })).toBe(false);
    expect(isRaised({ kind: 'core', ...at, raised: true })).toBe(true);
    expect(isRaised({ kind: 'hullGun', ...at })).toBe(false);
    expect(isRaised({ kind: 'structure', ...at })).toBe(false);
    expect(isRaised({ kind: 'structure', ...at, raised: true })).toBe(true);
  });

  it('costs raised structure more wall', () => {
    const low: ModuleSpec = { kind: 'structure', x: 0, y: 0, length: 6, width: 6 };
    const high = moduleStats({ ...low, raised: true });
    expect(high.mass).toBeGreaterThan(moduleStats(low).mass * 1.5);
    // The floor it encloses is the same: height is not storage.
    expect(high.capacity).toBe(moduleStats(low).capacity);
  });

  it('costs a raised core more wall too', () => {
    const low: ModuleSpec = { kind: 'core', x: 0, y: 0, length: 4, width: 4 };
    expect(moduleStats({ ...low, raised: true }).mass).toBeGreaterThan(moduleStats(low).mass);
  });

  it('is saved on structure and cores and refused anywhere else', () => {
    const bp: Blueprint = {
      name: 'Tower',
      modules: [
        { kind: 'core', x: 0, y: 0, length: 4, width: 4, raised: true },
        { kind: 'structure', x: 4, y: 0, length: 4, width: 4, raised: true },
      ],
    };
    const file = serialiseBlueprint(bp);
    const back = parseBlueprint(file);
    expect(back.modules[0]).toMatchObject({ raised: true });
    expect(back.modules[1]).toMatchObject({ raised: true });
    const compiled = compileBlueprint(back);
    expect(compiled.modules[0]!.raised).toBe(true);
    expect(compiled.modules[1]!.raised).toBe(true);

    const turret = { ...file, modules: [{ kind: 'turret', x: 0, y: 0, length: 4, width: 4, raised: true }] };
    expect(blueprintFileProblem(turret)).toMatch(/only structure and cores/);
  });
});

describe('a turret', () => {
  /** A turret at the origin facing +x, with one block dead ahead of it. */
  function ahead(raised: boolean, x: number): ModuleSpec[] {
    return [
      { kind: 'turret', x: 0, y: 0, length: 2, width: 2 },
      { kind: 'structure', x, y: 0, length: 2, width: 2, raised },
    ];
  }

  it('trains over deck and fires over it', () => {
    const layout = ahead(false, 1.5);
    expect(firingArc(layout, 0, 5, isRaised)).toEqual({ left: PI, right: PI });
    expect(triggerMask(layout, 0, isRaised)).toEqual([]);
  });

  it('may train past raised structure beyond its barrel, but not fire at it', () => {
    const layout = ahead(true, 20);
    expect(firingArc(layout, 0, 5, isRaised)).toEqual({ left: PI, right: PI });
    const mask = triggerMask(layout, 0, isRaised);
    expect(mask).toHaveLength(2);
    expect(masked(mask, 0)).toBe(true);
    expect(masked(mask, 0.2)).toBe(false);
    expect(masked(mask, PI)).toBe(false);
  });

  it('cannot train through raised structure within its barrel', () => {
    const arc = firingArc(ahead(true, 1.5), 0, 5, isRaised);
    expect(arc.left + arc.right).toBe(0);
  });

  it('keeps separate gaps between obstructions', () => {
    const layout: ModuleSpec[] = [
      { kind: 'turret', x: 0, y: 0, length: 2, width: 2 },
      { kind: 'structure', x: 0, y: 20, length: 2, width: 2, raised: true },
      { kind: 'structure', x: 0, y: -20, length: 2, width: 2, raised: true },
    ];
    const mask = triggerMask(layout, 0, isRaised);
    expect(mask).toHaveLength(4);
    expect(masked(mask, PI / 2)).toBe(true);
    expect(masked(mask, -PI / 2)).toBe(true);
    expect(masked(mask, 0)).toBe(false);
    expect(masked(mask, PI)).toBe(false);
  });

  it('holds its fire while its barrel points along a masked bearing', () => {
    const bodies = new Bodies();
    const body = bodies.indexOf(bodies.create({ x: 0, y: 0, mass: 1000, inertia: 1000, radius: 5 }));
    const turrets = new Turrets();
    const t = turrets.add({ owner: body, x: 0, y: 0, maxRate: 5, maxAccel: 50, mask: [-0.1, 0.1] });
    expect(turrets.firesOn(bodies, t, 0)).toBe(false);
    expect(turrets.firesOn(bodies, t, 1)).toBe(true);
    // At rest it points straight down the masked sector.
    expect(turrets.readyToFire(t)).toBe(false);
    turrets.commandWorldBearing(bodies, t, 1);
    for (let i = 0; i < 120; i++) turrets.step(1 / 60, bodies);
    expect(turrets.readyToFire(t)).toBe(true);
  });

  it('will not swing a lit beam across its own ship', () => {
    const bodies = new Bodies();
    const body = bodies.indexOf(bodies.create({ x: 0, y: 0, mass: 1000, inertia: 1000, radius: 5 }));
    const turrets = new Turrets();
    const t = turrets.add({ owner: body, x: 0, y: 0, maxRate: 5, maxAccel: 50, mask: [0.5, 0.7] });
    turrets.lit[t] = 1;
    turrets.commandWorldBearing(bodies, t, 1);
    for (let i = 0; i < 120; i++) turrets.step(1 / 60, bodies);
    expect(turrets.bearing[t]).toBeLessThan(0.5);
    turrets.lit[t] = 0;
    for (let i = 0; i < 120; i++) turrets.step(1 / 60, bodies);
    expect(turrets.bearing[t]).toBeCloseTo(1, 3);
  });
});

describe('a hull weapon', () => {
  it('is fouled by, and must not fire at, anything', () => {
    const design = compileBlueprint({
      name: 'Gun deck',
      modules: [
        { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
        { kind: 'hullGun', x: 4, y: 0, length: 4, width: 2 },
        { kind: 'structure', x: 0, y: 4, length: 4, width: 4 },
      ],
    });
    const gun = design.turrets[0]!;
    expect(gun.hullLayer).toBe(true);
    // Nothing is raised, and yet the mask is not empty.
    expect(gun.mount.mask!.length).toBeGreaterThan(0);
  });
});

describe('a round', () => {
  /** A ship of a core with a block to either side, raised or not. */
  function target(raised: boolean): { world: World; ships: Ships; grid: SpatialGrid } {
    const design = compileBlueprint({
      name: 'Target',
      modules: [
        { kind: 'structure', x: -4, y: 0, length: 4, width: 4, raised },
        { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
        { kind: 'structure', x: 4, y: 0, length: 4, width: 4, raised },
      ],
    });
    const world = new World({ dt: 1 / 60, seed: 1 });
    const ships = new Ships();
    ships.spawn(world, { design, x: 0, y: 0, team: 1 });
    const grid = new SpatialGrid(64);
    grid.rebuild(world.bodies);
    return { world, ships, grid };
  }

  /** What a round across the ship along +x meets first, or -1. */
  function firstHit(raised: boolean, weaponsLayer: boolean, y = 0): number {
    const { world, ships, grid } = target(raised);
    const projectiles = new Projectiles(4);
    const hits = new ProjectileHits();
    projectiles.spawn({ x: -40, y, vx: 1200, vy: 0, width: 0.1, ttl: 1, weaponsLayer });
    for (let i = 0; i < 10 && hits.count === 0; i++) {
      projectiles.step(1 / 60, world.bodies, grid, hits, undefined, ships.hulls);
    }
    return hits.count === 0 ? -1 : hits.module[0]!;
  }

  it('in the hull layer meets the first thing in its way', () => {
    expect(firstHit(false, false)).toBe(0);
  });

  it('in the weapons layer passes over deck', () => {
    expect(firstHit(false, true)).toBe(-1);
  });

  it('in the weapons layer meets what is raised', () => {
    expect(firstHit(true, true)).toBe(0);
  });

  it('may come back onto its own ship, but never the mount that fired it', () => {
    const { world, ships, grid } = target(true);
    const body = world.bodies.indexOf(ships.body(0));
    const projectiles = new Projectiles(4);
    const hits = new ProjectileHits();
    const design = ships.design(0);
    const left = design.modules.findIndex((m) => m.x < -1);
    const right = design.modules.findIndex((m) => m.x > 1);
    // Fired from inside the left block, along the ship to the right one.
    projectiles.spawn({
      x: design.modules[left]!.x,
      y: 0,
      vx: 1200,
      vy: 0,
      width: 0.1,
      ttl: 1,
      owner: body,
      fromModule: left,
      weaponsLayer: true,
    });
    projectiles.step(1 / 60, world.bodies, grid, hits, undefined, ships.hulls);
    expect(hits.count).toBe(1);
    expect(hits.body[0]).toBe(body);
    expect(hits.module[0]).toBe(right);
  });
});
