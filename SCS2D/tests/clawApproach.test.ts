import { describe, expect, it } from 'vitest';
import {
  asteroidBlueprint,
  compileBlueprint,
  DAMAGE_ENERGY_PER_KG,
  NEUTRAL_TEAM,
  parseBlueprint,
  serialiseBlueprint,
  type Blueprint,
  type ModuleSpec,
} from '../sim/index.js';
import { Rng } from '../sim/rng.js';
import { makeBattle } from '../scenarios/battle.js';
import { CORVETTE, REPLICATOR, SCAVENGER } from '../scenarios/blueprints.js';

/** Claw ships coming in square to what they grip, and building only anchored. */

/** The Replicator with its slipway set to build only anchored or not. */
function replicator(buildAnchored: boolean): Blueprint {
  return {
    ...REPLICATOR,
    modules: REPLICATOR.modules.map((m) => {
      if (!('kind' in m) || m.kind !== 'slipway') return m;
      const { buildAnchored: _, ...rest } = m;
      return buildAnchored ? { ...rest, buildAnchored } : rest;
    }),
  };
}

/** A still rock, and a Replicator `x` out from it, facing it. */
function atRock(design: Blueprint, x = 600) {
  return makeBattle({ seed: 7 }, (ships, world) => {
    const rock = asteroidBlueprint('Rock', { radius: 250, kernel: true, ore: 0.35, ice: 0.25, corners: 10, rings: 3 }, new Rng(5));
    const a = ships.spawn(world, { design: compileBlueprint(rock), x: 0, y: 0, team: NEUTRAL_TEAM });
    const m = ships.spawn(world, { design: compileBlueprint(design), x, y: 120, angle: 2.5, team: 0 });
    return { a, m };
  });
}

/** Whether any ship is being printed on a slipway. */
function printing(run: ReturnType<typeof atRock>): boolean {
  for (let i = 0; i < run.ships.highWater; i++) if (run.ships.isAlive(i) && run.ships.isPrinting(i)) return true;
  return false;
}

describe('a slipway that builds only anchored', () => {
  it('builds nothing while its ship flies free, where one that builds anywhere starts at once', () => {
    const free = (anchored: boolean) => {
      const run = makeBattle({ seed: 7 }, (ships, world) => ({
        m: ships.spawn(world, { design: compileBlueprint(replicator(anchored)), x: 0, y: 0, team: 0 }),
      }));
      for (let t = 0; t < 60 * 60; t++) run.step();
      for (let i = 0; i < run.ships.highWater; i++) if (run.ships.isAlive(i) && run.ships.isPrinting(i)) return true;
      return false;
    };
    expect(free(false)).toBe(true);
    expect(free(true)).toBe(false);
  });

  it('sends a ship with nothing to mine to anchor, square to the rock and whole, and builds held', () => {
    const run = atRock(replicator(true));
    const moored = () => run.ships.isMoored(run.m) && run.ships.parkedCarrier(run.m) === run.a;
    for (let t = 0; t < 180 * 60 && !moored(); t++) run.step();
    expect(moored()).toBe(true);
    // Every one of its modules, its claws included, still on it.
    expect(run.ships.currentStructure(run.m).modules.length).toBe(compileBlueprint(REPLICATOR).modules.length);
    for (let s = 0; s < 120 * 60 && !printing(run); s++) run.step();
    expect(printing(run)).toBe(true);
    // Its claw holds on while it builds.
    for (let s = 0; s < 60 * 60; s++) run.step();
    expect(moored()).toBe(true);
  });

  it('keeps whether it builds only anchored in a file', () => {
    const raw = serialiseBlueprint(replicator(true)) as { modules: Record<string, unknown>[] };
    const slipway = raw.modules.find((m) => m['kind'] === 'slipway')!;
    expect(slipway['buildAnchored']).toBe(true);
    const back = parseBlueprint(JSON.parse(JSON.stringify(raw)));
    expect((back.modules.find((m) => 'kind' in m && m.kind === 'slipway') as ModuleSpec).buildAnchored).toBe(true);
  });
});

describe('a claw ship closing on a source', () => {
  it('takes hold of a wreck turning slowly, on its first run in', () => {
    const run = makeBattle({ seed: 3 }, (ships, world) => {
      const s = ships.spawn(world, { design: compileBlueprint(SCAVENGER), x: -300, y: 0, angle: 0 });
      ships.fuel.vent(world.bodies.indexOf(ships.body(s)), 1, 15_000);
      const corvette = compileBlueprint(CORVETTE);
      const w = ships.spawn(world, { design: corvette, x: 0, y: 0, angle: 1, angularVel: 0.05, team: 1 });
      const body = world.bodies.indexOf(ships.body(w));
      for (const core of corvette.cores) ships.damage.absorb(body, core, corvette.modules[core]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG);
      return { s, w };
    });
    for (let t = 0; t < 120 * 60 && run.ships.body(run.s) !== run.ships.body(run.w); t++) run.step();
    expect(run.ships.body(run.s)).toBe(run.ships.body(run.w));
    expect(run.ships.hasControl(run.s)).toBe(true);
  });

  it('brings a heavy ship in slower than a light one, so its claw is not driven home and torn off', () => {
    const speed = (design: Blueprint) => {
      const run = atRock(design, 400);
      const ships = run.ships as unknown as {
        clawArrival(bodies: unknown, b: number, claw: number): number;
        workingClaw(i: number, b: number): number;
      };
      const b = run.world.bodies.indexOf(run.ships.body(run.m));
      return ships.clawArrival(run.world.bodies, b, ships.workingClaw(run.m, b));
    };
    // The same hull, its holds full and all but empty.
    const loaded = (fill: number): Blueprint => ({
      ...REPLICATOR,
      modules: REPLICATOR.modules.map((m) => ('kind' in m && m.kind === 'hold' ? { ...m, fill } : m)),
    });
    expect(speed(loaded(1))).toBeLessThan(speed(loaded(0.1)));
    expect(speed(SCAVENGER)).toBeCloseTo(2.5, 6);
  });
});
