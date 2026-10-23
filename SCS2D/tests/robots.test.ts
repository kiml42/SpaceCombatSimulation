import { describe, expect, it } from 'vitest';
import {
  compileBlueprint,
  DAMAGE_ENERGY_PER_KG,
  DamageEffect,
  joints,
  moduleStats,
  REPAIR_WASTE,
  ROBOT_BERTH_PITCH,
  ROBOT_BERTH_VOLUME,
  berthGrid,
  berthRate,
  ROBOT_BUILD_TIME,
  ROBOT_MASS,
  ROBOT_REPAIR_RATE,
  ROBOT_ROOM,
  ROBOT_SPEED,
  ROBOT_TOP_SPEED,
  ROBOT_VIEW_STRIDE,
  robotSpeedOver,
  type Blueprint,
} from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import { mending } from '../scenarios/mending.js';

/** Robots crawling a hull from their bay to mend it (ROADMAP.md §8, repair stage 3). */

/** A core at the bow, three blocks of structure, and a bay at the stern with a hold and a battery beside it. */
const LINE: Blueprint = {
  name: 'Line',
  modules: [
    { kind: 'core', x: 0, y: 0, length: 3, width: 3 },
    { kind: 'structure', x: 4, y: 0, length: 5, width: 3 },
    { kind: 'structure', x: 9, y: 0, length: 5, width: 3 },
    { kind: 'structure', x: 14, y: 0, length: 5, width: 3 },
    { kind: 'robotBay', x: 18.5, y: 0, length: 4, width: 4 },
    { kind: 'hold', x: 18.5, y: 3.5, length: 4, width: 3 },
    { kind: 'battery', x: 18.5, y: -3.5, length: 4, width: 3 },
  ],
};
const line = compileBlueprint(LINE);
const CORE = line.cores[0]!;
const of = (kind: string, n = 0): number => line.modules.map((m, k) => (m.spec.kind === kind ? k : -1)).filter((k) => k >= 0)[n]!;
const BAY = of('robotBay');
const NEAR = of('structure', 2);
const capacity = (m: number): number => line.modules[m]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG;

function scene(hurt: (absorb: (m: number, share: number) => void) => void): ReturnType<typeof makeBattle<{ a: number }>> {
  return makeBattle({ seed: 1, pilots: false }, (ships, world) => {
    const a = ships.spawn(world, { design: line, x: 0, y: 0, angle: 0 });
    const b = world.bodies.indexOf(ships.body(a));
    hurt((m, share) => ships.damage.absorb(b, m, capacity(m) * share));
    return { a };
  });
}
type Run = ReturnType<typeof scene>;
const body = (run: Run): number => run.world.bodies.indexOf(run.ships.body(run.a));
const absorbed = (run: Run, m: number): number => run.ships.damage.absorbedAt(body(run), m);
const out = (run: Run): number => {
  const places: number[] = [];
  run.ships.robotViews(run.a, places);
  return places.length / ROBOT_VIEW_STRIDE;
};

describe('a robot bay', () => {
  const bay = (length: number, width: number) => moduleStats({ kind: 'robotBay', x: 0, y: 0, length, width });

  it('berths as many robots as squares of its deck fit, in a grid, and weighs them', () => {
    expect(bay(4, 4).robots).toBe(4);
    expect(bay(7.5, 6).robots).toBe(9);
    expect(bay(5, 3).robots).toBe(2);
    expect(bay(1.5, 4).robots).toBe(0);
    for (const [length, width] of [
      [4, 4],
      [7.5, 6],
      [5, 3],
    ] as const) {
      const { across, down } = berthGrid({ kind: 'robotBay', x: 0, y: 0, length, width });
      expect(across).toBe(Math.floor(length / ROBOT_BERTH_PITCH));
      expect(down).toBe(Math.floor(width / ROBOT_BERTH_PITCH));
      expect(bay(length, width).robots).toBe(across * down);
    }
    expect(bay(4, 4).fittingMass).toBeGreaterThan(bay(4, 4).robots * ROBOT_MASS);
  });

  it('builds and refills its robots faster the more room it has behind each berth', () => {
    // The same four berths, with more bay behind each in the bigger one.
    expect(bay(5.9, 5.9).robots).toBe(bay(4, 4).robots);
    expect(berthRate(bay(5.9, 5.9))).toBeGreaterThan(berthRate(bay(4, 4)));
    const standard = bay(4, 4);
    expect(berthRate(standard)).toBeCloseTo(standard.interior / standard.robots / ROBOT_BERTH_VOLUME, 9);
    expect(berthRate(bay(1.5, 4))).toBe(0);
  });
});

describe('robots', () => {
  it('show where they are going and what they carry', () => {
    const run = scene((absorb) => absorb(CORE, 0.3));
    run.step();
    const views: number[] = [];
    run.ships.robotViews(run.a, views);
    expect(views.length).toBe(line.modules[BAY]!.stats.robots * ROBOT_VIEW_STRIDE);
    // Crawling forward, towards the core, full of both.
    const heading = views[2]!;
    expect(Math.cos(heading)).toBeLessThan(-0.9);
    expect(views[3]).toBeCloseTo(1, 6);
    expect(views[4]).toBeCloseTo(1, 6);
  });

  it('are drawn no closer to each other than a robot is long, however many crawl the same weld', () => {
    const run = scene((absorb) => absorb(CORE, 0.3));
    const views: number[] = [];
    for (let s = 0; s < 120; s++) {
      run.step();
      run.ships.robotViews(run.a, views);
      const n = views.length / ROBOT_VIEW_STRIDE;
      for (let p = 0; p < n; p++) {
        for (let q = p + 1; q < n; q++) {
          const pi = p * ROBOT_VIEW_STRIDE;
          const qi = q * ROBOT_VIEW_STRIDE;
          expect(Math.hypot(views[qi]! - views[pi]!, views[qi + 1]! - views[pi + 1]!)).toBeGreaterThan(1.2);
        }
      }
    }
  });

  it("crawl carefully over a ship's modules, and faster over broad ones such as rock, up to a cap", () => {
    const at = (across: number): number => robotSpeedOver({ kind: 'structure', x: 0, y: 0, length: 300, width: across });
    expect(at(3)).toBe(ROBOT_SPEED);
    expect(at(ROBOT_ROOM)).toBe(ROBOT_SPEED);
    expect(at(1.5 * ROBOT_ROOM)).toBeCloseTo(1.5 * ROBOT_SPEED, 9);
    expect(at(200)).toBe(ROBOT_TOP_SPEED);
  });

  it('stay in their bay while nothing needs mending', () => {
    const run = scene(() => {});
    for (let s = 0; s < 120; s++) run.step();
    expect(out(run)).toBe(0);
  });

  it('crawl out to what is damaged, mend the core first, and come home once all is whole', () => {
    // Short of ragged, which would cut the bay off from command (and so from work).
    const run = scene((absorb) => {
      absorb(CORE, 0.3);
      absorb(NEAR, 0.7);
    });
    const metal = (): number => run.ships.metal.pieceHeld(body(run), BAY);
    const shed = run.ships.damage.shedAt(body(run), CORE) + run.ships.damage.shedAt(body(run), NEAR);
    // Settled by a step, so the shedding is not counted below.
    run.step();
    const metalBefore = metal();
    const discardedBefore = run.ships.discarded;
    expect(out(run)).toBeGreaterThan(0);
    // Not mended before a robot could have crawled there from the bay.
    const reach = Math.abs(line.modules[BAY]!.x - line.modules[CORE]!.x);
    for (let s = 1; s < Math.floor((reach / ROBOT_SPEED) * 60) - 1; s++) run.step();
    expect(absorbed(run, CORE)).toBe(capacity(CORE) * 0.3);
    // The nearer structure is left until a robot is free of the core.
    let steps = 0;
    while (absorbed(run, CORE) > 0 && steps++ < 600 * 60) run.step();
    expect(absorbed(run, CORE)).toBe(0);
    while ((absorbed(run, NEAR) > 0 || out(run) > 0) && steps++ < 600 * 60) run.step();
    expect(absorbed(run, NEAR)).toBe(0);
    expect(out(run)).toBe(0);
    // What they shed went back in, with a tenth more lost.
    expect(metalBefore - metal()).toBeCloseTo(shed * (1 + REPAIR_WASTE), 3);
    expect(run.ships.discarded - discardedBefore).toBeCloseTo(shed * REPAIR_WASTE, 3);
  });

  it('run short mending their own bay, and berth there to refill', { timeout: 60_000 }, () => {
    const run = scene((absorb) => absorb(BAY, 0.6));
    for (const robot of run.ships.robots.on(body(run))!) robot.metal = 10;
    let steps = 0;
    while (absorbed(run, BAY) > 0 && steps++ < 600 * 60) run.step();
    expect(absorbed(run, BAY)).toBe(0);
  });

  it('with only rounding left of their metal and a bay that cannot refill them, stay berthed', () => {
    // No core working, so no command reaches the bay.
    const run = scene((absorb) => absorb(CORE, 1.5));
    for (const robot of run.ships.robots.on(body(run))!) robot.metal = 1e-13;
    for (let s = 0; s < 60 * 60; s++) {
      run.step();
      expect(out(run)).toBe(0);
    }
  });

  it('come home and stay there when their hull has no metal left to mend with', () => {
    const run = scene((absorb) => absorb(NEAR, 0.5));
    const b = body(run);
    run.ships.metal.drain(b, NEAR, run.ships.metal.pieceHeld(b, NEAR));
    expect(run.ships.metal.pieceHeld(b, NEAR)).toBe(0);
    let steps = 0;
    while (out(run) === 0 && steps++ < 60 * 60) run.step();
    while (out(run) > 0 && steps++ < 120 * 60) run.step();
    expect(out(run)).toBe(0);
    for (let s = 0; s < 60 * 60; s++) {
      run.step();
      expect(out(run)).toBe(0);
    }
    expect(absorbed(run, NEAR)).toBeGreaterThan(0);
  });

  it('mend their own bay before structure, since it makes every other job quicker', { timeout: 60_000 }, () => {
    const run = scene((absorb) => {
      absorb(BAY, 0.3);
      absorb(NEAR, 0.3);
    });
    let steps = 0;
    while (absorbed(run, BAY) > 0 && steps++ < 600 * 60) run.step();
    expect(absorbed(run, BAY)).toBe(0);
    expect(absorbed(run, NEAR)).toBe(capacity(NEAR) * 0.3);
  });

  it('plug every hole in a tank they mend, however wide', { timeout: 60_000 }, () => {
    const TANKED: Blueprint = {
      name: 'Tanked',
      modules: [...LINE.modules, { kind: 'tank', x: 23, y: 0, length: 5, width: 4 }],
    };
    const tanked = compileBlueprint(TANKED);
    const tank = tanked.modules.findIndex((m) => m.spec.kind === 'tank');
    const run = makeBattle({ seed: 1, pilots: false }, (ships, world) => {
      const a = ships.spawn(world, { design: tanked, x: 0, y: 0, angle: 0 });
      const b = world.bodies.indexOf(ships.body(a));
      // Too wide for any lining to close, and the damage the round that made it did.
      ships.fuel.hole(b, { module: tank, x: 2.5, y: 0, nx: 1, ny: 0, width: 0.5, floor: 0.5, closing: 0, rate: 0 });
      ships.damage.absorb(b, tank, tanked.modules[tank]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG * 0.2);
      return { a };
    });
    const b = (): number => run.world.bodies.indexOf(run.ships.body(run.a));
    expect(run.ships.fuel.leaksOf(b())).toHaveLength(1);
    let steps = 0;
    while (run.ships.fuel.leaksOf(b()).length > 0 && steps++ < 120 * 60) run.step();
    expect(run.ships.fuel.leaksOf(b())).toHaveLength(0);
    const held = run.ships.fuel.held(b(), tank);
    for (let s = 0; s < 60; s++) run.step();
    expect(run.ships.fuel.held(b(), tank)).toBe(held);
  });

  it('mend no faster than the robots there can work', () => {
    const run = scene((absorb) => absorb(NEAR, 0.5));
    let steps = 0;
    while (absorbed(run, NEAR) > 0 && steps++ < 600 * 60) run.step();
    const robots = line.modules[BAY]!.stats.robots;
    expect(steps / 60).toBeGreaterThanOrEqual((capacity(NEAR) * 0.5) / (ROBOT_REPAIR_RATE * robots));
  });

  it('work on for a ship that has lost control, and give it back', () => {
    const run = scene((absorb) => {
      absorb(CORE, 0.9);
      absorb(NEAR, 0.5);
    });
    expect(run.ships.hasControl(run.a)).toBe(false);
    let steps = 0;
    while ((absorbed(run, CORE) > 0 || absorbed(run, NEAR) > 0) && steps++ < 600 * 60) run.step();
    expect(absorbed(run, CORE)).toBe(0);
    expect(absorbed(run, NEAR)).toBe(0);
    expect(run.ships.hasControl(run.a)).toBe(true);
  });

  it('mend the ragged spine that cuts their bay off from command', () => {
    // Torn past ragged beside the bay, so no command reaches it.
    const run = scene((absorb) => absorb(NEAR, 2));
    run.step();
    expect(run.ships.damage.remaining(body(run), BAY, DamageEffect.Tending)).toBe(0);
    expect(out(run)).toBeGreaterThan(0);
    let steps = 0;
    while (absorbed(run, NEAR) > 0 && steps++ < 600 * 60) run.step();
    expect(absorbed(run, NEAR)).toBe(0);
    expect(run.ships.damage.remaining(body(run), BAY, DamageEffect.Tending)).toBe(1);
  });

  it('cut off from their bay are lost with the piece they were on', () => {
    const run = scene((absorb) => absorb(CORE, 0.3));
    // Out on the hull, past the bay's neighbour, then the spine is cut behind them.
    for (let s = 0; s < 3 * 60; s++) run.step();
    const berths = line.modules[BAY]!.stats.robots;
    const outside = out(run);
    expect(outside).toBe(berths);
    const b = body(run);
    const all = joints(line);
    const cut = all.findIndex((j) => (j.a === NEAR || j.b === NEAR) && (j.a === BAY || j.b === BAY));
    run.ships.damage.cutWeld(b, cut, all[cut]!.width * 2);
    run.step();
    expect(run.world.bodies.count).toBe(2);
    let left = 0;
    for (let k = 0; k < run.world.bodies.highWater; k++) left += run.ships.robots.on(k)?.length ?? 0;
    expect(left).toBe(berths - outside);
  });

  it('mend a battered ship whole and come home, never stalling at a trickle', { timeout: 60_000 }, () => {
    const run = mending();
    const ships = run.ships;
    const total = (): number => {
      const b = run.world.bodies.indexOf(ships.body(0));
      let sum = 0;
      for (let m = 0; m < ships.currentStructure(0).modules.length; m++) sum += ships.damage.absorbedAt(b, m);
      return sum;
    };
    const places: number[] = [];
    for (let s = 0; s < 300 * 60; s++) run.step();
    ships.robotViews(0, places);
    expect(total()).toBe(0);
    expect(places.length).toBe(0);
  });

  describe('lost and built anew', () => {
    const HOLD = of('hold');
    const count = (run: Run): number => run.ships.robots.on(body(run))?.length ?? 0;
    const working = (run: Run, m: number): number =>
      (run.ships.robots.on(body(run)) ?? []).filter((r) => r.mode === 2 && r.target === m).length;

    it('are lost with a module destroyed under them, and their bay builds them again', () => {
      const run = scene((absorb) => absorb(HOLD, 0.3));
      const berths = line.modules[BAY]!.stats.robots;
      let steps = 0;
      while (working(run, HOLD) === 0 && steps++ < 60 * 60) run.step();
      const caught = working(run, HOLD);
      expect(caught).toBeGreaterThan(0);
      const mass = run.world.bodies.mass[body(run)]!;
      const discarded = run.ships.discarded;
      // Torn apart while they are on it.
      run.ships.damage.absorb(body(run), HOLD, capacity(HOLD) * 2);
      run.step();
      expect(count(run)).toBe(berths - caught);
      expect(mass - run.world.bodies.mass[body(run)]!).toBeGreaterThanOrEqual(caught * ROBOT_MASS - 1e-6);
      expect(run.ships.discarded - discarded).toBeGreaterThanOrEqual(caught * ROBOT_MASS - 1e-6);
      // Built again, one at a time, no sooner than a bay can.
      steps = 0;
      while (count(run) < berths && steps++ < 600 * 60) run.step();
      expect(count(run)).toBe(berths);
      expect(steps / 60).toBeGreaterThanOrEqual((caught * ROBOT_BUILD_TIME) / berthRate(line.modules[BAY]!.stats) - 1);
    });

    it('are not lost going to mend a module already destroyed', () => {
      const run = scene((absorb) => absorb(HOLD, 1.5));
      const berths = line.modules[BAY]!.stats.robots;
      let steps = 0;
      while (absorbed(run, HOLD) > 0 && steps++ < 600 * 60) run.step();
      expect(absorbed(run, HOLD)).toBe(0);
      expect(count(run)).toBe(berths);
    });

    it('in a bay that is destroyed are lost, and none are built', () => {
      const run = scene(() => {});
      run.step();
      run.ships.damage.absorb(body(run), BAY, capacity(BAY) * 2);
      run.step();
      expect(count(run)).toBe(0);
      for (let s = 0; s < (ROBOT_BUILD_TIME + 5) * 60; s++) run.step();
      expect(count(run)).toBe(0);
    });
  });
});
