import { describe, expect, it } from 'vitest';
import {
  compileBlueprint,
  DAMAGE_ENERGY_PER_KG,
  DamageEffect,
  joints,
  moduleStats,
  REPAIR_WASTE,
  ROBOT_BERTH_VOLUME,
  ROBOT_MASS,
  ROBOT_REPAIR_RATE,
  ROBOT_SPEED,
  ROBOT_VIEW_STRIDE,
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
  it('berths a robot for every berth its interior holds, and weighs them', () => {
    const small = moduleStats({ kind: 'robotBay', x: 0, y: 0, length: 4, width: 4 });
    const large = moduleStats({ kind: 'robotBay', x: 0, y: 0, length: 6, width: 6 });
    expect(small.robots).toBe(Math.floor(small.interior / ROBOT_BERTH_VOLUME));
    expect(large.robots).toBeGreaterThan(small.robots);
    expect(small.fittingMass).toBeGreaterThan(small.robots * ROBOT_MASS);
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
      for (let m = 0; m < ships.design(0).modules.length; m++) sum += ships.damage.absorbedAt(b, m);
      return sum;
    };
    const places: number[] = [];
    for (let s = 0; s < 300 * 60; s++) run.step();
    ships.robotViews(0, places);
    expect(total()).toBe(0);
    expect(places.length).toBe(0);
  });
});
