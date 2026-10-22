import { describe, expect, it } from 'vitest';
import {
  asteroidBlueprint,
  blueprintProblem,
  compileBlueprint,
  generateMap,
  moduleProblem,
  moduleStats,
  rockModule,
  wellPull,
  type MapSettings,
} from '../sim/index.js';
import { Rng } from '../sim/rng.js';
import { outlineAxes } from '../sim/shape.js';
import { joints } from '../sim/connectivity.js';
import { asteroidField, FIELD } from '../scenarios/asteroidField.js';

describe('rock', () => {
  it('holds shares of ore and ice that are no more than all of it', () => {
    const wedge = [0, 0, 40, 0, 50, 30, -5, 25];
    expect(moduleProblem(rockModule(wedge, 0.3, 0.2))).toBeNull();
    expect(moduleProblem(rockModule(wedge, 0.7, 0.4))).toMatch(/shares/);
    expect(moduleProblem(rockModule(wedge, -0.1, 0))).toMatch(/shares/);
  });

  it('is solid and stands in both layers', () => {
    const stats = moduleStats(rockModule([0, 0, 40, 0, 50, 30, -5, 25], 0, 0));
    expect(stats.interior).toBe(0);
    expect(stats.thickness).toBeGreaterThan(3);
  });

  it('is welded at a seam no stronger than a hull plate is, however deep the rock', () => {
    const design = compileBlueprint(asteroidBlueprint('A', { radius: 300, kernel: true, ore: 0.2, ice: 0.1 }, new Rng(3)));
    const seams = joints(design);
    expect(seams.length).toBeGreaterThan(design.modules.length);
    // Width times a plate's thickness, times the weld's impulse per area.
    for (const seam of seams) expect(seam.strength).toBeLessThan(seam.width * 0.021 * 3e6);
  });
});

describe('a quadrilateral that is not a box', () => {
  it('offers every edge as an axis, where a box offers two', () => {
    const out: number[] = [];
    expect(outlineAxes([1, -1, 1, 1, -1, 1, -1, -1], 4, out)).toBe(2);
    expect(outlineAxes([0, 0, 40, 0, 50, 30, -5, 25], 4, out)).toBe(4);
  });
});

describe('an asteroid', () => {
  it('always comes out a valid hull, major or minor, whatever it is drawn from', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const kernel of [true, false]) {
        const blueprint = asteroidBlueprint('A', { radius: kernel ? 250 : 70, kernel, ore: 0.4, ice: 0.3 }, new Rng(seed));
        expect(blueprintProblem(blueprint), `seed ${seed}, kernel ${kernel}`).toBeNull();
        expect(blueprint.modules.filter((m) => 'kind' in m && m.kind === 'kernel').length).toBe(kernel ? 1 : 0);
      }
    }
  });

  it('runs its ore and ice richer on one side than the other', () => {
    const rock = asteroidBlueprint('A', { radius: 250, kernel: true, ore: 0.25, ice: 0.25 }, new Rng(7)).modules.filter(
      (m) => 'kind' in m && m.kind === 'rock',
    );
    const ore = rock.map((m) => (m as { ore?: number }).ore ?? 0);
    expect(Math.max(...ore)).toBeGreaterThan(0.4);
    expect(Math.min(...ore)).toBeLessThan(0.1);
  });
});

describe('a map', () => {
  const clear = [
    { x: -1800, y: -240, radius: 950 },
    { x: 1800, y: 240, radius: 650 },
  ];

  it('is the same map from the same seed', () => {
    expect(JSON.stringify(generateMap(FIELD, 42, clear))).toBe(JSON.stringify(generateMap(FIELD, 42, clear)));
    expect(JSON.stringify(generateMap(FIELD, 42, clear))).not.toBe(JSON.stringify(generateMap(FIELD, 43, clear)));
  });

  it('pulls at a major’s surface as hard as it was asked', () => {
    const map = generateMap({ majors: 1, majorSize: 300, majorSpread: 0, surfaceGravity: 0.8 }, 1, []);
    const well = map.wells[0]!;
    expect(wellPull({ ...well, x: 0, y: 0 }, 300, 0) * 300).toBeCloseTo(0.8, 9);
  });

  it('puts a well under each major and none under a minor', () => {
    const map = generateMap(FIELD, 5, clear);
    expect(map.wells.length).toBe(2);
    expect(map.asteroids.filter((a) => a.rides !== undefined).length).toBe(2);
    expect(map.rails).toBeDefined();
  });

  it('keeps clear of where the ships start', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const map = generateMap(FIELD, seed, clear);
      for (const rock of map.asteroids) {
        const reach = compileBlueprint(rock.blueprint).radius;
        for (const c of clear) expect(Math.hypot(rock.x - c.x, rock.y - c.y), `seed ${seed}`).toBeGreaterThan(c.radius + reach * 0.8);
      }
    }
  });

  it('scatters minors with nothing to orbit', () => {
    const settings: MapSettings = { minors: 6, minorSize: 50 };
    const map = generateMap(settings, 3, clear);
    expect(map.wells.length).toBe(0);
    expect(map.asteroids.length).toBe(6);
  });
});

describe('a battle in an asteroid field', () => {
  it('fights among majors riding their wells and minors falling round them', () => {
    const run = asteroidField();
    const b = run.world.bodies;
    let majors = 0;
    let minors = 0;
    for (let i = 0; i < run.ships.count; i++) {
      const k = b.indexOf(run.ships.body(i));
      if (run.ships.teamOf(i) !== -1) continue;
      if (b.pinned[k] === 1) majors++;
      else minors++;
    }
    expect(majors).toBe(2);
    expect(minors).toBe(8);
    for (let t = 0; t < 600; t++) run.step();
    for (let i = 0; i < run.ships.count; i++) {
      const k = b.indexOf(run.ships.body(i));
      if (b.pinned[k] === 1) expect(b.mass[k]).toBe(0);
    }
  });

  it('lets rock knocked off a major go free, and keeps the kernel pinned', () => {
    const run = asteroidField();
    const b = run.world.bodies;
    const major = (() => {
      for (let i = 0; i < run.ships.count; i++) if (b.pinned[b.indexOf(run.ships.body(i))] === 1) return i;
      return -1;
    })();
    const body = b.indexOf(run.ships.body(major));
    const design = run.ships.currentStructure(major);
    const before = design.modules.length;
    // Every seam into one wedge cut through, as enough fire along them would.
    const wedge = design.modules.findIndex((m) => m.spec.kind === 'rock');
    const all = joints(design);
    for (let j = 0; j < all.length; j++) {
      const joint = all[j]!;
      if (joint.a === wedge || joint.b === wedge) run.ships.damage.cutWeld(body, j, joint.width * 2);
    }
    for (let t = 0; t < 5; t++) run.step();
    expect(run.totalSevered).toBeGreaterThan(0);
    expect(run.ships.currentStructure(major).modules.length).toBe(before - 1);
    expect(b.pinned[body]).toBe(1);
    expect(run.ships.currentStructure(major).modules.some((m) => m.spec.kind === 'kernel')).toBe(true);
  });
});
