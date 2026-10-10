import { describe, expect, it } from 'vitest';
import { compileBlueprint, moduleStats, PORT_PUMP_PER_METRE, readsThick, type Blueprint, type ShipDesign } from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import { GUNSHIP, TANKER } from '../scenarios/blueprints.js';
import { PICKET } from '../scenarios/tanker.js';
import { OrderCancelCondition } from '../sim/ships.js';

/** Ships docking port to port with a friend to be filled from it (ROADMAP.md §8 step 9). */

function picketOf(dockBelow = 0.5, tank = 4): ShipDesign {
  const modules = PICKET.modules!.map((m, i) => (i === 1 ? { ...m, length: tank } : m));
  // A longer tank pushes the stern back with it.
  const shifted = modules.map((m, i) => (i === 1 ? { ...m, x: -2 - tank / 2 } : i === 3 ? { ...m, x: -2 - tank } : m));
  const blueprint: Blueprint = { ...PICKET, modules: shifted };
  return compileBlueprint({ ...blueprint, doctrine: { ...PICKET.doctrine!, approach: { ...PICKET.doctrine!.approach, dockBelow } } });
}

function tankerOf(dockBelow = 0.25, engines = true): ShipDesign {
  const doctrine = compileBlueprint(TANKER).doctrine;
  const modules = TANKER.modules!.filter((m) => engines || (m as { kind: string }).kind !== 'engine');
  return compileBlueprint({ ...TANKER, modules, doctrine: { ...doctrine, approach: { ...doctrine.approach, dockBelow } } });
}

interface Setup {
  picket?: ShipDesign;
  tanker?: ShipDesign;
  enemy?: boolean;
}

function scene(setup: Setup = {}): ReturnType<typeof makeBattle<{ t: number; p: number }>> {
  return makeBattle({ seed: 3 }, (ships, world) => {
    const t = ships.spawn(world, { design: setup.tanker ?? tankerOf(), x: 0, y: 0, angle: 0.4, team: setup.enemy === true ? 1 : 0 });
    const picket = setup.picket ?? picketOf();
    const p = ships.spawn(world, { design: picket, x: -200, y: 150, angle: 0 });
    const b = world.bodies.indexOf(ships.body(p));
    for (let m = 0; m < picket.modules.length; m++) ships.fuel.vent(b, m, ships.fuel.held(b, m) * 0.8);
    return { t, p };
  });
}

type Run = ReturnType<typeof scene>;
const docked = (run: Run): boolean => run.ships.body(run.t) === run.ships.body(run.p);
function runUntil(run: Run, done: () => boolean, seconds: number): void {
  for (let s = 0; s < seconds * 60 && !done(); s++) run.step();
}

describe('a port', () => {
  it('is a coupling on a hull side, never thick, with a pump that grows with its face', () => {
    const narrow = moduleStats({ kind: 'port', x: 0, y: 0, angle: 0, length: 1, width: 2 });
    const wide = moduleStats({ kind: 'port', x: 0, y: 0, angle: 0, length: 1, width: 4 });
    expect(readsThick('port')).toBe(false);
    expect(narrow.pumpRate).toBeCloseTo(2 * PORT_PUMP_PER_METRE, 9);
    expect(wide.pumpRate).toBeCloseTo(2 * narrow.pumpRate, 9);
    expect(narrow.fuel).toBe(0);
  });
});

describe('a ship low on fuel with a port', () => {
  it("docks with a friend's port face to face, is filled, and parts full", () => {
    const run = scene();
    runUntil(run, () => docked(run), 90);
    expect(docked(run)).toBe(true);
    const seam = run.ships.design(run.p).seams!.find((s) => s.dock === 'port')!;
    expect(seam).toBeDefined();
    runUntil(run, () => !docked(run), 400);
    expect(docked(run)).toBe(false);
    const b = run.world.bodies.indexOf(run.ships.body(run.p));
    expect(run.ships.fuel.pieceRoom(b, run.ships.design(run.p).cores[0]!)).toBeCloseTo(0, 3);
    expect(run.totalContacts).toBeLessThan(10);
  });

  it('idles while docked when it is the smaller, and flies the pair when it is the larger', () => {
    const throttles = (run: Run, i: number): number =>
      (run.ships as unknown as { throttles: Float64Array[] }).throttles[i]!.reduce((sum, u) => sum + u, 0);
    const small = scene();
    runUntil(small, () => docked(small), 90);
    small.step();
    expect(throttles(small, small.p)).toBe(0);
    // A picket with a tank long enough to outweigh the tanker.
    const heavy = scene({ picket: picketOf(0.5, 40) });
    runUntil(heavy, () => docked(heavy), 200);
    expect(docked(heavy)).toBe(true);
    heavy.step();
    expect(throttles(heavy, heavy.t)).toBe(0);
  });

  it('stays out of it with doctrine that never refuels', () => {
    const run = scene({ picket: picketOf(0) });
    runUntil(run, () => docked(run), 90);
    expect(docked(run)).toBe(false);
  });

  it("leaves an enemy's port alone", () => {
    const run = scene({ enemy: true });
    runUntil(run, () => docked(run), 90);
    expect(docked(run)).toBe(false);
  });

  it('takes no more than the tanker can spare', () => {
    // Engineless, so nothing but the pump takes fuel out of it.
    const run = scene({ tanker: tankerOf(0.99, false) });
    const fuel = (): number => run.ships.fuel.pieceHeld(run.world.bodies.indexOf(run.ships.body(run.t)), 0);
    const reserve = 0.99 * fuel();
    runUntil(run, () => docked(run), 90);
    expect(docked(run)).toBe(true);
    runUntil(run, () => !docked(run), 120);
    expect(docked(run)).toBe(false);
    expect(fuel()).toBeGreaterThanOrEqual(reserve - 1e-6);
    expect(fuel()).toBeLessThan(reserve + 1);
  });

  it('lets go when an armed enemy comes within reach, and stays off while it is there, if it minds', () => {
    const wary = PICKET.doctrine!.approach;
    const run = scene({ picket: compileBlueprint({ ...PICKET, doctrine: { ...PICKET.doctrine!, approach: { ...wary, dockDanger: 1 } } }) });
    runUntil(run, () => docked(run), 90);
    expect(docked(run)).toBe(true);
    const at = run.world.bodies.indexOf(run.ships.body(run.t));
    run.ships.spawn(run.world, {
      design: compileBlueprint(GUNSHIP),
      x: run.world.bodies.x[at]! + 1500,
      y: run.world.bodies.y[at]!,
      team: 1,
      invulnerable: true,
    });
    for (let s = 0; s < 5; s++) run.step();
    expect(docked(run)).toBe(false);
    let again = false;
    for (let s = 0; s < 10 * 60; s++) {
      run.step();
      if (docked(run)) again = true;
    }
    expect(again).toBe(false);
  });

  it('holds on with an armed enemy in reach by default, since docking is with a friend', () => {
    const run = scene();
    runUntil(run, () => docked(run), 90);
    expect(docked(run)).toBe(true);
    const at = run.world.bodies.indexOf(run.ships.body(run.t));
    run.ships.spawn(run.world, {
      design: compileBlueprint(GUNSHIP),
      x: run.world.bodies.x[at]! + 1500,
      y: run.world.bodies.y[at]!,
      team: 1,
      invulnerable: true,
    });
    for (let s = 0; s < 5; s++) run.step();
    expect(docked(run)).toBe(true);
  });

  it('parts at once when given an order', () => {
    const run = scene();
    runUntil(run, () => docked(run), 90);
    expect(docked(run)).toBe(true);
    run.ships.pushOrder(run.p, run.t, 200, 300, 20, OrderCancelCondition.None);
    for (let s = 0; s < 5; s++) run.step();
    expect(docked(run)).toBe(false);
  });
});
