import { describe, expect, it } from 'vitest';
import {
  barrelHalfWidth,
  DECK_HEIGHT,
  Bodies,
  compileBlueprint,
  firingArc,
  isRaised,
  isThick,
  masked,
  moduleStats,
  moduleThickness,
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
  it('is raised for a turret or engine, and for anything else thick', () => {
    const at = { x: 0, y: 0, length: 4, width: 4 };
    expect(isRaised({ kind: 'turret', ...at })).toBe(true);
    expect(isRaised({ kind: 'beamTurret', ...at })).toBe(true);
    expect(isRaised({ kind: 'engine', ...at })).toBe(true);
    for (const kind of ['core', 'hullGun', 'hullBeam', 'structure'] as const) {
      expect(isRaised({ kind, ...at })).toBe(false);
      expect(isRaised({ kind, ...at, thick: true })).toBe(true);
    }
  });

  it('leaves a module no more than a deck across in the hull layer, marked or not', () => {
    const narrow: ModuleSpec = { kind: 'structure', x: 0, y: 0, length: 8, width: 3, thick: true };
    expect(isThick(narrow)).toBe(false);
    expect(isRaised(narrow)).toBe(false);
    expect(moduleStats(narrow).mass).toBe(moduleStats({ ...narrow, thick: false }).mass);
  });

  it('is saved where it may be chosen and refused on a turret', () => {
    const bp: Blueprint = {
      name: 'Tower',
      modules: [
        { kind: 'core', x: 0, y: 0, length: 4, width: 4, thick: true },
        { kind: 'structure', x: 4, y: 0, length: 4, width: 4, thick: true },
      ],
    };
    const file = serialiseBlueprint(bp);
    const back = parseBlueprint(file);
    expect(back.modules[0]).toMatchObject({ thick: true });
    expect(back.modules[1]).toMatchObject({ thick: true });
    const compiled = compileBlueprint(back);
    expect(compiled.modules[0]!.raised).toBe(true);
    expect(compiled.modules[1]!.raised).toBe(true);

    const turret = { ...file, modules: [{ kind: 'turret', x: 0, y: 0, length: 4, width: 4, thick: true }] };
    expect(blueprintFileProblem(turret)).toMatch(/a turret cannot be thick/);
  });
});

describe('how thick a module is', () => {
  const box = (length: number, width: number, raised = false): ModuleSpec =>
    ({ kind: 'structure', x: 0, y: 0, length, width, thick: raised });

  it('is as deep as it is across, up to a deck', () => {
    expect(moduleThickness(box(1, 2))).toBe(1);
    expect(moduleThickness(box(60, 20))).toBe(DECK_HEIGHT);
  });

  it('is not held to a deck when raised', () => {
    expect(moduleThickness(box(1, 2, true))).toBe(1);
    expect(moduleThickness(box(60, 20, true))).toBe(20);
  });

  it('is one nozzle wide for an engine, and the width for a hull weapon', () => {
    const engine: ModuleSpec = { kind: 'engine', x: 0, y: 0, length: 4, width: 12, barrels: 3 };
    expect(moduleThickness(engine)).toBe(DECK_HEIGHT);
    expect(moduleThickness({ ...engine, thick: true })).toBe(4);
    expect(moduleThickness({ kind: 'hullGun', x: 0, y: 0, length: 2, width: 8, thick: true })).toBe(8);
  });

  it('holds a turret to a deck, which it cannot be raised past', () => {
    expect(moduleThickness({ kind: 'turret', x: 0, y: 0, length: 20, width: 20 })).toBe(DECK_HEIGHT);
  });

  it('costs a thick module more wall, and encloses no more floor', () => {
    const low = box(12, 12);
    const high = moduleStats({ ...low, thick: true });
    expect(high.mass).toBeGreaterThan(moduleStats(low).mass * 1.5);
    expect(high.capacity).toBe(moduleStats(low).capacity);
  });

  it('gives a thick engine a bigger nozzle', () => {
    const thin: ModuleSpec = { kind: 'engine', x: 0, y: 0, length: 8, width: 6 };
    const thick = moduleStats({ ...thin, thick: true });
    // Twice as deep an exit, so twice the thrust for the same face.
    expect(thick.thrust).toBeCloseTo(2 * moduleStats(thin).thrust, 6);
    // Split into nozzles no deeper than a deck, it has nothing to gain.
    const split: ModuleSpec = { ...thin, barrels: 2 };
    expect(moduleStats({ ...split, thick: true }).thrust).toBeCloseTo(moduleStats(split).thrust, 6);
  });

  it('holds every barrel to the depth of the module it is in', () => {
    const wide = moduleStats({ kind: 'turret', x: 0, y: 0, length: 200, width: 200 }).gun!;
    expect(2 * wide.calibre).toBeCloseTo(DECK_HEIGHT, 9);
    const hull: ModuleSpec = { kind: 'hullGun', x: 0, y: 0, length: 120, width: 60 };
    expect(2 * moduleStats(hull).gun!.calibre).toBeCloseTo(DECK_HEIGHT, 9);
    // Raised, only the opening holds it.
    const thick = moduleStats({ ...hull, thick: true }).gun!;
    expect(2 * thick.calibre).toBeGreaterThan(2 * DECK_HEIGHT);
    expect(thick.muzzleEnergy).toBeGreaterThan(moduleStats(hull).gun!.muzzleEnergy);
  });

  it('gives a thin hull weapon nothing to gain by being raised', () => {
    const small: ModuleSpec = { kind: 'hullGun', x: 0, y: 0, length: 12, width: 2 };
    expect(moduleStats({ ...small, thick: true }).gun!.calibre).toBeCloseTo(moduleStats(small).gun!.calibre, 9);
  });
});

describe('a turret', () => {
  /** A turret at the origin facing +x, with one block dead ahead of it. */
  function ahead(raised: boolean, x: number): ModuleSpec[] {
    return [
      { kind: 'turret', x: 0, y: 0, length: 2, width: 2 },
      { kind: 'structure', x, y: 0, length: 4, width: 4, thick: raised },
    ];
  }

  it('trains over deck and fires over it', () => {
    const layout = ahead(false, 3);
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
    const arc = firingArc(ahead(true, 3), 0, 5, isRaised);
    expect(arc.left + arc.right).toBe(0);
  });

  it('trains no nearer an obstruction than its outer barrel allows', () => {
    // A block off to port, clear of the barrel's centre line as it swings
    // round, but not of a row of barrels either side of it.
    const layout: ModuleSpec[] = [
      { kind: 'turret', x: 0, y: 0, length: 2, width: 2 },
      { kind: 'structure', x: -4, y: 5, length: 4, width: 4, thick: true },
    ];
    const line = firingArc(layout, 0, 6, isRaised);
    const row = firingArc(layout, 0, 6, isRaised, 1.5);
    expect(row.left).toBeLessThan(line.left - 0.2);
    expect(row.right).toBeLessThan(line.right);
    const gun = moduleStats({ kind: 'turret', x: 0, y: 0, length: 6, width: 4, barrels: 4 }).gun!;
    expect(barrelHalfWidth(gun)).toBeCloseTo(1.5 * gun.barrelSpacing + gun.calibre, 9);
  });

  it('keeps separate gaps between obstructions', () => {
    const layout: ModuleSpec[] = [
      { kind: 'turret', x: 0, y: 0, length: 2, width: 2 },
      { kind: 'structure', x: 0, y: 20, length: 4, width: 4, thick: true },
      { kind: 'structure', x: 0, y: -20, length: 4, width: 4, thick: true },
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
        { kind: 'structure', x: -4, y: 0, length: 4, width: 4, thick: raised },
        { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
        { kind: 'structure', x: 4, y: 0, length: 4, width: 4, thick: raised },
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
