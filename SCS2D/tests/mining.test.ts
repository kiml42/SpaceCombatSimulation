import { describe, expect, it } from 'vitest';
import { asteroidBlueprint, compileBlueprint, NEUTRAL_TEAM } from '../sim/index.js';
import { Rng } from '../sim/rng.js';
import { makeBattle } from '../scenarios/battle.js';
import { mining } from '../scenarios/mining.js';
import { SCAVENGER } from '../scenarios/blueprints.js';

/** Metal and fuel a miner's body holds. */
function stores(run: ReturnType<typeof mining>, i: number): { metal: number; fuel: number; pinned: boolean } {
  const b = run.world.bodies.indexOf(run.ships.body(i));
  return { metal: run.ships.metal.left(b), fuel: run.ships.fuel.left(b), pinned: run.world.bodies.pinned[b] === 1 };
}

describe('mining', () => {
  it('sends salvagers to the asteroids round a major, where their robots mine ore into the hold', () => {
    const run = mining();
    const before = run.miners.map((i) => stores(run, i).metal);
    for (let t = 0; t < 30 * 60 * 10; t++) run.step();
    const after = run.miners.map((i) => stores(run, i).metal);
    expect(after.some((metal, k) => metal > before[k]! + 1000)).toBe(true);
    expect(run.totalSevered).toBe(0);
    // A major pulls too hard for a ship with no thrust to hold off it jaws first.
    expect(run.miners.some((i) => stores(run, i).pinned)).toBe(false);
  });

  it('anchors to a major that barely pulls, riding its rail as it mines', () => {
    const run = mining(7, { majors: 1, majorSize: 200, surfaceGravity: 0.0005, metal: 0.4, fuel: 0.3 });
    const before = stores(run, run.miners[0]!).metal;
    for (let t = 0; t < 120 * 60; t++) run.step();
    const anchored = run.miners.map((i) => stores(run, i)).filter((s) => s.pinned);
    expect(anchored.length).toBeGreaterThan(0);
    expect(anchored[0]!.metal).toBeGreaterThan(before);
    const b = run.world.bodies;
    const body = b.indexOf(run.ships.body(run.miners[0]!));
    expect(b.mass[body]).toBe(0);
  });

  it('melts fuel out of ice with a claw alone, slowly and on its charge', () => {
    const run = makeBattle({ seed: 3 }, (ships, world) => {
      ships.spawn(world, {
        design: compileBlueprint(asteroidBlueprint('Ice', { radius: 40, kernel: false, ore: 0.1, ice: 0.6 }, new Rng(2))),
        x: 0,
        y: 0,
        team: NEUTRAL_TEAM,
      });
      return { scavenger: ships.spawn(world, { design: compileBlueprint(SCAVENGER), x: -150, y: 0, angle: 0, team: 0 }) };
    });
    // Once it grips, it and the rock are one body, so it is looked up each time.
    const fuel = (): number => run.ships.fuel.left(run.world.bodies.indexOf(run.ships.body(run.scavenger)));
    for (let t = 0; t < 30 * 60; t++) run.step();
    const early = fuel();
    for (let t = 0; t < 60 * 60; t++) run.step();
    expect(run.totalWelded).toBe(1);
    const gained = fuel() - early;
    expect(gained).toBeGreaterThan(10);
    // No faster than a claw melts it.
    expect(gained).toBeLessThanOrEqual(60 * 1 + 1e-6);
  });

  it('leaves rock alone when its doctrine sets no worth on it', () => {
    const run = mining();
    for (const i of run.miners) run.ships.setDoctrine(i, 'ship', 'rockWeight', 0);
    for (let t = 0; t < 60 * 60; t++) run.step();
    expect(run.totalWelded).toBe(0);
  });
});
