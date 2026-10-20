import { describe, expect, it } from 'vitest';
import { compileBlueprint, DAMAGE_ENERGY_PER_KG, type ShipDesign } from '../sim/index.js';
import { NO_TARGET } from '../sim/ships.js';
import { makeBattle } from '../scenarios/battle.js';
import { CORVETTE, GUNSHIP, SCAVENGER, TANKER } from '../scenarios/blueprints.js';
import { give } from '../scenarios/commands.js';
import { PICKET } from '../scenarios/tanker.js';

/** Ships told to fill their claws, or to give a friend what they can spare (ROADMAP.md §8 step 14, slice 2). */

/** A Scavenger whose doctrine never goes scavenging of its own accord. */
function idleScavenger(): ShipDesign {
  const doctrine = compileBlueprint(SCAVENGER).doctrine;
  return compileBlueprint({ ...SCAVENGER, doctrine: { ...doctrine, approach: { ...doctrine.approach, scavengeFuelBelow: 0 } } });
}

function wreckScene() {
  return makeBattle({ seed: 3 }, (ships, world) => {
    const s = ships.spawn(world, { design: idleScavenger(), x: -300, y: 0, angle: 0 });
    const corvette = compileBlueprint(CORVETTE);
    const wrecks = [
      [0, 150],
      [100, -250],
    ].map(([x, y]) => {
      const w = ships.spawn(world, { design: corvette, x, y, angle: 1, team: 1 });
      const body = world.bodies.indexOf(ships.body(w));
      for (const core of corvette.cores) {
        ships.damage.absorb(body, core, corvette.modules[core]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG * 0.7);
      }
      return w;
    });
    return { s, w: wrecks[0]!, other: wrecks[1]! };
  });
}

type Wrecks = ReturnType<typeof wreckScene>;
const fuelOf = (run: { ships: Wrecks['ships']; world: Wrecks['world'] }, i: number): number =>
  run.ships.fuel.left(run.world.bodies.indexOf(run.ships.body(i)));
function runUntil(run: { step(): void }, done: () => boolean, seconds: number): void {
  for (let s = 0; s < seconds * 60 && !done(); s++) run.step();
}

describe('a ship told to scavenge', () => {
  it('fills its claw from the wreck it was sent to, though its doctrine never would, and the order ends', () => {
    const run = wreckScene();
    const before = fuelOf(run, run.w);
    const untouched = fuelOf(run, run.other);
    give(run, { kind: 'order', ships: [run.s], order: { kind: 'scavenge', target: run.w }, append: false });
    expect(run.ships.errandOf(run.s)).toBe('scavenge');
    const gripped = (): boolean => run.ships.body(run.s) === run.ships.body(run.w);
    runUntil(run, gripped, 120);
    expect(gripped()).toBe(true);
    runUntil(run, () => run.ships.orderCount(run.s) === 0, 300);
    expect(run.ships.orderCount(run.s)).toBe(0);
    expect(fuelOf(run, run.w)).toBeLessThan(before);
    expect(fuelOf(run, run.other)).toBeCloseTo(untouched, 3);
  });

  it('with no target, goes to a source its doctrine would choose', () => {
    const run = wreckScene();
    give(run, { kind: 'order', ships: [run.s], order: { kind: 'scavenge', target: NO_TARGET }, append: false });
    run.step();
    expect([run.w, run.other]).toContain(run.ships.errandTarget(run.s));
  });

  it('is skipped by a ship with no claw', () => {
    const run = makeBattle({ seed: 3 }, (ships, world) => {
      const g = ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 0, y: 0 });
      const w = ships.spawn(world, { design: compileBlueprint(CORVETTE), x: 300, y: 0, team: 1 });
      return { g, w };
    });
    give(run, { kind: 'order', ships: [run.g], order: { kind: 'scavenge', target: run.w }, append: false });
    expect(run.ships.orderCount(run.g)).toBe(0);
  });

  it('takes from a friend still flying only what it holds above its own reserve', () => {
    const run = makeBattle({ seed: 3 }, (ships, world) => {
      const s = ships.spawn(world, { design: idleScavenger(), x: -200, y: 0, angle: 0 });
      const t = ships.spawn(world, { design: compileBlueprint(TANKER), x: 0, y: 0, angle: 0 });
      return { s, t };
    });
    const before = fuelOf(run, run.t);
    give(run, { kind: 'order', ships: [run.s], order: { kind: 'scavenge', target: run.t }, append: false });
    runUntil(run, () => run.ships.orderCount(run.s) === 0, 300);
    expect(fuelOf(run, run.s)).toBeGreaterThan(fuelOf(makeBattleOf(), 0));
    expect(fuelOf(run, run.t)).toBeLessThan(before);
  });
});

/** The idle Scavenger alone, for what it sets out with. */
function makeBattleOf() {
  return makeBattle({ seed: 3 }, (ships, world) => {
    ships.spawn(world, { design: idleScavenger(), x: -200, y: 0, angle: 0 });
  });
}

describe('a ship told to deliver', () => {
  /** A Picket keeping back a third of its fuel, which never delivers of its own accord. */
  const giver = (): ShipDesign =>
    compileBlueprint({ ...PICKET, doctrine: { ...PICKET.doctrine!, approach: { ...PICKET.doctrine!.approach, refuelBelow: 0.3 } } });

  function scene() {
    return makeBattle({ seed: 3 }, (ships, world) => {
      const t = ships.spawn(world, { design: compileBlueprint(TANKER), x: 0, y: 0, angle: 0.4 });
      const tb = world.bodies.indexOf(ships.body(t));
      const tanker = ships.currentStructure(t);
      // Half empty, but above its own threshold, so it is not asking.
      for (let m = 0; m < tanker.modules.length; m++) ships.fuel.vent(tb, m, ships.fuel.held(tb, m) * 0.5);
      const p = ships.spawn(world, { design: giver(), x: -200, y: 150, angle: 0 });
      const g = ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 300, y: -300 });
      return { t, p, g };
    });
  }

  it('gives the friend it was sent to all it can spare, keeping its reserve, and the order ends', () => {
    const run = scene();
    const before = fuelOf(run, run.t);
    give(run, { kind: 'order', ships: [run.p], order: { kind: 'deliver', target: run.t }, append: false });
    const docked = (): boolean => run.ships.body(run.t) === run.ships.body(run.p);
    runUntil(run, docked, 120);
    expect(docked()).toBe(true);
    runUntil(run, () => !docked(), 200);
    run.step();
    expect(fuelOf(run, run.t)).toBeGreaterThan(before);
    expect(run.ships.orderCount(run.p)).toBe(0);
    const pb = run.world.bodies.indexOf(run.ships.body(run.p));
    const core = run.ships.currentStructure(run.p).cores[0]!;
    const held = run.ships.fuel.pieceHeld(pb, core);
    expect(held / (held + run.ships.fuel.pieceRoom(pb, core))).toBeGreaterThan(0.25);
    expect(held / (held + run.ships.fuel.pieceRoom(pb, core))).toBeLessThan(0.4);
  });

  it('is passed over for a friend with no port, and skipped by a ship with none', () => {
    const run = scene();
    give(run, { kind: 'order', ships: [run.p], order: { kind: 'deliver', target: run.g }, append: false });
    expect(run.ships.orderCount(run.p)).toBe(0);
    give(run, { kind: 'order', ships: [run.g], order: { kind: 'deliver', target: run.t }, append: false });
    expect(run.ships.orderCount(run.g)).toBe(0);
  });
});
