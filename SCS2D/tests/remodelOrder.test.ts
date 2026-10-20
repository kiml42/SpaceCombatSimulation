import { describe, expect, it } from 'vitest';
import { compileBlueprint, refitShare, slotKey, type Blueprint } from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import { DINKY, GUNSHIP, SALVAGER } from '../scenarios/blueprints.js';
import { mending, refitting } from '../scenarios/mending.js';
import { factory } from '../scenarios/carrier.js';
import { give, readLog, writeLog, type Logged } from '../scenarios/commands.js';

/** Remodelling a ship, and choosing what its pads build, mid-battle (ROADMAP.md §8 step 14, slice 2). */

/** The Gunship without its second outrigger: a version of the same blueprint, ids and all. */
const STRIPPED: Blueprint = {
  ...GUNSHIP,
  name: 'Stripped Gunship',
  modules: GUNSHIP.modules.filter((p, n, all) => !('use' in p && all.findIndex((q) => 'use' in q && q.use === p.use) !== n)),
};

describe('a remodel', () => {
  it('is measured as a refit would match it, and refused where it would not keep the core', () => {
    const share = refitShare(compileBlueprint(GUNSHIP), compileBlueprint(STRIPPED))!;
    expect(share).not.toBeNull();
    expect(share.kept).toBeLessThan(share.of);
    expect(refitShare(compileBlueprint(GUNSHIP), compileBlueprint(DINKY))).toBeNull();
  });

  it('refits each ship told to the blueprint it names', () => {
    const run = makeBattle({ seed: 3 }, (ships, world) => ({ a: ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 0, y: 0 }) }));
    give(run, { kind: 'remodel', ships: [run.a], blueprint: STRIPPED });
    expect(run.ships.blueprint(run.a).name).toBe('Stripped Gunship');
  });
});

describe('a remodel part way through a refit', () => {
  it('sets the robots to the new design, rather than to modules of the old one half built', () => {
    const run = refitting();
    for (let s = 0; s < 600; s++) run.step();
    give(run, { kind: 'remodel', ships: [0], blueprint: SALVAGER });
    expect(run.ships.blueprint(0).name).toBe(SALVAGER.name);
    for (let s = 0; s < 3000; s++) run.step();
  });
});

describe('a battle whose ships are not flown', () => {
  it('still charges robots from what its generators make, with the batteries flat', () => {
    const run = mending();
    const b = run.world.bodies.indexOf(run.ships.body(0));
    const design = run.ships.currentStructure(0);
    for (let m = 0; m < design.modules.length; m++) run.ships.power.drain(b, m, run.ships.power.held(b, m));
    for (const robot of run.ships.robots.on(b) ?? []) robot.charge = 0;
    const charge = (): number => {
      let total = 0;
      for (let m = 0; m < design.modules.length; m++) total += run.ships.power.held(b, m);
      for (const robot of run.ships.robots.on(b) ?? []) total += robot.charge;
      return total;
    };
    const before = charge();
    for (let s = 0; s < 60 * 30; s++) run.step();
    expect(charge()).toBeGreaterThan(before);
  });
});

describe('a pad told what to build', () => {
  const TINY: Blueprint = { ...DINKY, name: 'Tiny' };

  it('builds that from then on, and refuses what it could not build', () => {
    const run = factory();
    const slot = slotKey(run.ships.blueprint(0), run.ships.blueprint(0).builds![0]!.pad);
    give(run, { kind: 'craft', ships: [0], slot, blueprint: GUNSHIP });
    expect(run.ships.craftsOf(0)).toBeUndefined();
    give(run, { kind: 'craft', ships: [0], slot, blueprint: TINY });
    expect(run.ships.craftsOf(0)?.[slot]?.name).toBe('Tiny');
    const names = new Set<string>();
    for (let s = 0; s < 60 * 60; s++) {
      run.step();
      for (let i = 1; i < 16; i++) if (run.ships.isAlive(i)) names.add(run.ships.blueprint(i).name);
    }
    expect(names.has('Tiny')).toBe(true);
    expect(names.has(DINKY.name)).toBe(false);
    give(run, { kind: 'craft', ships: [0], slot, blueprint: null });
    expect(run.ships.craftsOf(0)).toBeUndefined();
  });
});

describe('a log with blueprints in it', () => {
  it('writes each blueprint once, and reads back to the same commands', () => {
    const log: Logged[] = [
      { step: 1, command: { kind: 'remodel', ships: [0], blueprint: STRIPPED } },
      { step: 5, command: { kind: 'remodel', ships: [1], blueprint: STRIPPED } },
      { step: 6, command: { kind: 'craft', ships: [2], slot: '4', blueprint: null } },
    ];
    const written = JSON.parse(JSON.stringify(writeLog(log))) as { orders: unknown[]; designs: unknown[] };
    expect(written.designs).toHaveLength(1);
    const read = readLog(written.orders, written.designs);
    expect(read).toHaveLength(3);
    const first = read[0]!.command as { blueprint: Blueprint };
    expect(compileBlueprint(first.blueprint).modules.length).toBe(compileBlueprint(STRIPPED).modules.length);
    expect((read[2]!.command as { blueprint: unknown }).blueprint).toBeNull();
  });
});
