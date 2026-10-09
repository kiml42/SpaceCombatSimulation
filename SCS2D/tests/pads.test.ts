import { describe, expect, it } from 'vitest';
import {
  compileBlueprint,
  inWeaponsLayer,
  moduleStats,
  PAD_PUMP_PER_METRE,
  readsThick,
  subDesign,
  weldDesigns,
  type Blueprint,
  type ShipDesign,
} from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import { DINKY } from '../scenarios/blueprints.js';
import { OrderCancelCondition } from '../sim/ships.js';

/** Fighters landing on a friend's pad to be filled from it (ROADMAP.md §8 step 9). */

/** A core, a big tank, and a pad on its bow big enough for a Dinky. */
function carrierOf(pad = 20, refuelBelow = 0): ShipDesign {
  const blueprint: Blueprint = {
    name: 'Carrier',
    modules: [
      { kind: 'core', x: 0, y: 0, length: 6, width: 6 },
      { kind: 'tank', x: -13, y: 0, length: 20, width: 10 },
      { kind: 'pad', x: 3 + pad / 2, y: 0, length: pad, width: pad },
    ],
  };
  const design = compileBlueprint(blueprint);
  return compileBlueprint({ ...blueprint, doctrine: { ...design.doctrine, approach: { ...design.doctrine.approach, refuelBelow } } });
}
const PAD = 2;
const TANK = 1;

function fighterOf(refuelBelow: number): ShipDesign {
  const doctrine = compileBlueprint(DINKY).doctrine;
  return compileBlueprint({ ...DINKY, doctrine: { ...doctrine, approach: { ...doctrine.approach, refuelBelow } } });
}

interface Setup {
  carrier?: ShipDesign;
  fighter?: ShipDesign;
  /** The carrier is on the other side. */
  enemy?: boolean;
  /** How much of the fighter's fuel is gone. */
  spent?: number;
  /** A second fighter, as low. */
  pair?: boolean;
}

function scene(setup: Setup = {}): ReturnType<typeof makeBattle<{ c: number; f: number; g: number }>> {
  return makeBattle({ seed: 3 }, (ships, world) => {
    const c = ships.spawn(world, { design: setup.carrier ?? carrierOf(), x: 0, y: 0, angle: 0.3, team: setup.enemy === true ? 1 : 0 });
    const lower = (i: number): void => {
      const b = world.bodies.indexOf(ships.body(i));
      const design = ships.design(i);
      for (let m = 0; m < design.modules.length; m++) ships.fuel.vent(b, m, ships.fuel.held(b, m) * (setup.spent ?? 0.8));
    };
    const fighter = setup.fighter ?? fighterOf(0.5);
    const f = ships.spawn(world, { design: fighter, x: -300, y: 200, angle: 0 });
    lower(f);
    let g = -1;
    if (setup.pair === true) {
      g = ships.spawn(world, { design: fighter, x: -300, y: -200, angle: 0 });
      lower(g);
    }
    return { c, f, g };
  });
}

type Run = ReturnType<typeof scene>;
const aboard = (run: Run, i: number): boolean => run.ships.body(run.c) === run.ships.body(i);
function runUntil(run: Run, done: () => boolean, seconds: number): void {
  for (let s = 0; s < seconds * 60 && !done(); s++) run.step();
}

describe('a pad', () => {
  it('is a deck: never thick, never in the weapons layer, with a pump that grows with its width', () => {
    const narrow = moduleStats({ kind: 'pad', x: 0, y: 0, length: 20, width: 10 });
    const wide = moduleStats({ kind: 'pad', x: 0, y: 0, length: 20, width: 20 });
    expect(readsThick('pad')).toBe(false);
    expect(inWeaponsLayer({ kind: 'pad', x: 0, y: 0, length: 20, width: 20, thick: true })).toBe(false);
    expect(narrow.pumpRate).toBeCloseTo(10 * PAD_PUMP_PER_METRE, 9);
    expect(wide.pumpRate).toBeCloseTo(2 * narrow.pumpRate, 9);
    expect(narrow.fuel).toBe(0);
  });

  it('gives back a fighter as a fighter when it lets it go', () => {
    const carrier = carrierOf();
    const dinky = compileBlueprint(DINKY);
    const docked = weldDesigns(carrier, dinky, 15, 0, 0, PAD, dinky.cores[0]!, 20, { at: 'a', kind: 'pad' });
    expect(docked.fighter).toBe(false);
    const n = carrier.modules.length;
    const own = dinky.modules.map((_, m) => n + m);
    expect(subDesign(docked, own).fighter).toBe(true);
    expect(subDesign(docked, carrier.modules.map((_, m) => m)).fighter).toBe(false);
  });
});

describe('a fighter low on fuel', () => {
  it("lands on a friend's pad, is filled from its tanks, and lifts off a fighter, touching nothing", () => {
    const run = scene();
    const carrierFuel = (): number => run.ships.fuel.held(run.world.bodies.indexOf(run.ships.body(run.c)), TANK);
    const before = carrierFuel();
    runUntil(run, () => aboard(run, run.f), 60);
    expect(aboard(run, run.f)).toBe(true);
    runUntil(run, () => !aboard(run, run.f), 30);
    expect(aboard(run, run.f)).toBe(false);
    const b = run.world.bodies.indexOf(run.ships.body(run.f));
    expect(run.ships.fuel.pieceRoom(b, run.ships.design(run.f).cores[0]!)).toBeCloseTo(0, 3);
    expect(carrierFuel()).toBeLessThan(before);
    expect(run.ships.design(run.f).fighter).toBe(true);
    expect(run.totalContacts).toBe(0);
  });

  it('lifts off at once when given an order', () => {
    const run = scene();
    runUntil(run, () => aboard(run, run.f), 60);
    expect(aboard(run, run.f)).toBe(true);
    run.ships.pushOrder(run.f, run.c, 200, 300, 20, OrderCancelCondition.None);
    for (let s = 0; s < 5; s++) run.step();
    expect(aboard(run, run.f)).toBe(false);
  });

  it('does not land on a pad it does not fit inside', () => {
    const run = scene({ carrier: carrierOf(4) });
    runUntil(run, () => aboard(run, run.f), 60);
    expect(aboard(run, run.f)).toBe(false);
  });

  it('stays out of it with doctrine that never refuels', () => {
    const run = scene({ fighter: fighterOf(0) });
    runUntil(run, () => aboard(run, run.f), 60);
    expect(aboard(run, run.f)).toBe(false);
  });

  it("leaves an enemy's pad alone", () => {
    const run = scene({ enemy: true });
    runUntil(run, () => aboard(run, run.f), 60);
    expect(aboard(run, run.f)).toBe(false);
  });

  it('takes no more than the carrier can spare', () => {
    // A carrier that keeps all but a sliver of its fuel for itself.
    const run = scene({ carrier: carrierOf(20, 0.999) });
    const carrierFuel = (): number => run.ships.fuel.left(run.world.bodies.indexOf(run.ships.body(run.c)));
    const reserve = 0.999 * carrierFuel();
    runUntil(run, () => aboard(run, run.f), 60);
    for (let s = 0; s < 600; s++) run.step();
    expect(carrierFuel()).toBeGreaterThanOrEqual(reserve - 1e-6);
  });

  it('shares one pad with another only by taking turns', () => {
    const run = scene({ pair: true });
    let both = false;
    const landed = new Set<number>();
    for (let s = 0; s < 90 * 60; s++) {
      run.step();
      for (const i of [run.f, run.g]) if (aboard(run, i)) landed.add(i);
      if (aboard(run, run.f) && aboard(run, run.g)) both = true;
    }
    expect(both).toBe(false);
    expect([...landed].sort()).toEqual([run.f, run.g].sort());
  });
});
