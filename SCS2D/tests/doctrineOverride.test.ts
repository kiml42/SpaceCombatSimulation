import { describe, expect, it } from 'vitest';
import { compileBlueprint, placementOf, slotKey } from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import { GUNSHIP } from '../scenarios/blueprints.js';
import { give, parseLog, type Command } from '../scenarios/commands.js';
import { factory } from '../scenarios/carrier.js';
import { duel } from '../scenarios/duel.js';
import { Rewind } from '../scenarios/rewind.js';
import { checksumWorld } from '../sim/checksum.js';

/** Doctrine told to a ship mid-battle, over its blueprint's (ROADMAP.md §8 step 14, slice 2). */

const gunship = compileBlueprint(GUNSHIP);
const scene = () =>
  makeBattle({ seed: 3 }, (ships, world) => ({
    a: ships.spawn(world, { design: gunship, x: 0, y: 0 }),
    b: ships.spawn(world, { design: gunship, x: 0, y: 200 }),
  }));

/** The Gunship's outrigger turrets: one placement in an assembly used on each beam. */
const outriggers = gunship.turrets.flatMap((mount, t) =>
  placementOf(gunship.keys?.[gunship.modules[mount.module]!.index]) === '14' ? [t] : [],
);
const bowGun = gunship.turrets.findIndex((mount) => mount.main);

describe("a ship's doctrine, told over its blueprint's", () => {
  it("changes the ship's approach and leaves its design alone", () => {
    const run = scene();
    const before = run.ships.doctrineOf(run.a).approach.approachSpeed;
    give(run, { kind: 'doctrine', ships: [run.a], part: 'ship', field: 'approachSpeed', value: before * 2 });
    expect(run.ships.doctrineOf(run.a).approach.approachSpeed).toBe(before * 2);
    expect(run.ships.doctrineOf(run.b).approach.approachSpeed).toBe(before);
    expect(run.ships.blueprint(run.a)).toBe(gunship);
    give(run, { kind: 'doctrine', ships: [run.a], part: 'ship', field: 'approachSpeed', value: null });
    expect(run.ships.doctrineOf(run.a).approach.approachSpeed).toBe(before);
    expect(run.ships.overrideOf(run.a)).toBeUndefined();
  });

  it('tells main weapons apart from secondary ones', () => {
    const run = scene();
    give(run, { kind: 'doctrine', ships: [run.a], part: 'main', field: 'fireRange', value: 0.25 });
    expect(run.ships.mountDoctrineOf(run.a, bowGun).fireRange).toBe(0.25);
    for (const t of outriggers) expect(run.ships.mountDoctrineOf(run.a, t).fireRange).toBe(gunship.turrets[t]!.targeting.fireRange);
  });

  it('gives every copy of a placement the same doctrine, over its battery', () => {
    expect(outriggers.length).toBe(2);
    const run = scene();
    give(run, { kind: 'doctrine', ships: [run.a], part: 'secondary', field: 'fireRange', value: 0.5 });
    give(run, { kind: 'doctrine', ships: [run.a], part: 'placement:14', field: 'fireRange', value: 0.75 });
    for (const t of outriggers) expect(run.ships.mountDoctrineOf(run.a, t).fireRange).toBe(0.75);
    give(run, { kind: 'resetDoctrine', ships: [run.a], part: 'placement:14' });
    for (const t of outriggers) expect(run.ships.mountDoctrineOf(run.a, t).fireRange).toBe(0.5);
    give(run, { kind: 'resetDoctrine', ships: [run.a] });
    expect(run.ships.overrideOf(run.a)).toBeUndefined();
  });

  it('plays back the same from a log, through a rewind', () => {
    const log: Command[] = [{ kind: 'doctrine', ships: [0], part: 'ship', field: 'approachSpeed', value: 5 }];
    const rewind = new Rewind(duel());
    rewind.seek(60);
    for (const command of log) rewind.issue(command);
    rewind.seek(240);
    const told = checksumWorld(rewind.battle.world);
    rewind.seek(0);
    rewind.seek(240);
    expect(checksumWorld(rewind.battle.world)).toBe(told);
    const untold = new Rewind(duel());
    untold.seek(240);
    expect(checksumWorld(untold.battle.world)).not.toBe(told);
  });

  it('reads back from a log, and refuses a part it does not know', () => {
    const log = [
      { step: 1, command: { kind: 'doctrine', ships: [0], part: 'main', field: 'fireRange', value: 0.5 } },
      { step: 2, command: { kind: 'resetDoctrine', ships: [0], part: 'placement:14' } },
      { step: 3, command: { kind: 'keep', ships: [0], slot: '4', keep: 2 } },
      { step: 4, command: { kind: 'keep', ships: [0], slot: '4', keep: null } },
    ];
    expect(parseLog(log)).toEqual(log);
    expect(() => parseLog([{ step: 1, command: { kind: 'doctrine', ships: [0], part: 'hull', field: 'x', value: 1 } }])).toThrow();
  });
});

describe('a pad told how many to keep', () => {
  const alive = (run: ReturnType<typeof factory>): number => {
    let n = 0;
    for (let i = 0; i < 16; i++) if (run.ships.isAlive(i)) n++;
    return n;
  };

  it('builds no more than the count told, rather than its design says', () => {
    const run = factory();
    const ships = run.ships;
    const order = ships.blueprint(0).builds![0]!;
    const slot = slotKey(ships.blueprint(0), order.pad);
    give(run, { kind: 'keep', ships: [0], slot, keep: 0 });
    expect(ships.keepsOf(0)).toEqual({ [slot]: 0 });
    const built = factory();
    for (let s = 0; s < 60 * 60; s++) {
      run.step();
      built.step();
    }
    expect(alive(run)).toBe(2);
    expect(alive(built)).toBeGreaterThan(2);
    give(run, { kind: 'keep', ships: [0], slot, keep: null });
    expect(ships.keepsOf(0)).toBeUndefined();
  });
});
