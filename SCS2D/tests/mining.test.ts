import { describe, expect, it } from 'vitest';
import { asteroidBlueprint, capture, compileBlueprint, NEUTRAL_TEAM, Snapshot } from '../sim/index.js';
import { Rng } from '../sim/rng.js';
import { makeBattle } from '../scenarios/battle.js';
import { mining } from '../scenarios/mining.js';
import { SCAVENGER } from '../scenarios/blueprints.js';
import { give } from '../scenarios/commands.js';

/** Metal and fuel a miner's body holds. */
function stores(run: ReturnType<typeof mining>, i: number): { metal: number; fuel: number; pinned: boolean } {
  const b = run.world.bodies.indexOf(run.ships.body(i));
  return { metal: run.ships.metal.left(b), fuel: run.ships.fuel.left(b), pinned: run.world.bodies.pinned[b] === 1 };
}

describe('mining', () => {
  it('sends salvagers to the asteroids, one anchoring to the major, and their robots mine ore into the hold', () => {
    const run = mining();
    const before = run.miners.map((i) => stores(run, i).metal);
    for (let t = 0; t < 600 * 60; t++) run.step();
    const after = run.miners.map((i) => stores(run, i));
    for (let k = 0; k < after.length; k++) expect(after[k]!.metal).toBeGreaterThan(before[k]! + 1000);
    expect(run.totalSevered).toBe(0);
    // Its thrust is much the same every way, so it can hold itself off a major's pull jaws first.
    expect(after.some((s) => s.pinned)).toBe(true);
  });

  it('passes over a major a ship cannot hold itself off, jaws first', () => {
    const run = makeBattle({ seed: 3, map: { majors: 1, majorSize: 200, surfaceGravity: 2, fuel: 0.6, metal: 0.1 } }, (ships, world) => ({
      scavenger: ships.spawn(world, { design: compileBlueprint(SCAVENGER), x: -700, y: 0, angle: 0, team: 0 }),
    }));
    // It may yet fall on to it, idle in its pull; it never sets out for it.
    for (let t = 0; t < 60 * 60; t++) {
      run.step();
      expect(run.ships.doingOf(run.scavenger)?.kind).not.toBe('scavenge');
    }
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

  it('goes for the asteroid it is told to, not the nearest', () => {
    const rock = (seed: number) =>
      compileBlueprint(asteroidBlueprint('Rock', { radius: 40, kernel: false, ore: 0.4, ice: 0.2 }, new Rng(seed)));
    const run = makeBattle({ seed: 3 }, (ships, world) => ({
      near: ships.spawn(world, { design: rock(2), x: 0, y: 0, team: NEUTRAL_TEAM }),
      far: ships.spawn(world, { design: rock(3), x: 0, y: 600, team: NEUTRAL_TEAM }),
      scavenger: ships.spawn(world, { design: compileBlueprint(SCAVENGER), x: -150, y: 0, angle: 0, team: 0 }),
    }));
    give(run, { kind: 'order', ships: [run.scavenger], order: { kind: 'scavenge', target: run.far }, append: false });
    run.step();
    expect(run.ships.doingOf(run.scavenger)).toEqual({ kind: 'scavenge', target: run.far });
  });

  it('shows what is left in an asteroid, and less of it once mined', () => {
    const run = mining();
    const left = (): number => {
      const view = capture(new Snapshot(), run.world, run.ships, run.projectiles, run.beams);
      let rock = 0;
      for (let k = 0; k < view.shipCount; k++) {
        const ship = view.ships[k]!;
        if (ship.team === NEUTRAL_TEAM) {
          expect(ship.rock).toBeDefined();
          expect(ship.rock!.ore + ship.rock!.ice).toBeLessThanOrEqual(ship.rock!.rock * (1 + 1e-9));
          rock += ship.rock!.rock;
        } else expect(ship.rock).toBeUndefined();
      }
      return rock;
    };
    const before = left();
    expect(before).toBeGreaterThan(0);
    for (let t = 0; t < 600 * 60; t++) run.step();
    expect(left()).toBeLessThan(before);
  });

  it('leaves rock alone when its doctrine sets no worth on it', () => {
    const run = mining();
    for (const i of run.miners) run.ships.setDoctrine(i, 'ship', 'rockWeight', 0);
    for (let t = 0; t < 60 * 60; t++) run.step();
    expect(run.totalWelded).toBe(0);
  });
});
