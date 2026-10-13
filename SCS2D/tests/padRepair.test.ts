import { describe, expect, it } from 'vitest';
import {
  compileBlueprint,
  DAMAGE_ENERGY_PER_KG,
  PAD_REPAIR_PER_METRE,
  REPAIR_WASTE,
  type Blueprint,
  type ShipDesign,
} from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import { DINKY } from '../scenarios/blueprints.js';

/** A pad mending what lands on it (ROADMAP.md §8, repair stage 2). */

const PAD_WIDTH = 20;

/** A core, a tank, a hold, a battery, and a pad on its bow big enough for a Dinky. */
function carrierOf(rechargeBelow = 0): ShipDesign {
  const blueprint: Blueprint = {
    name: 'Carrier',
    modules: [
      { kind: 'core', x: 0, y: 0, length: 6, width: 6 },
      { kind: 'tank', x: -13, y: 0, length: 20, width: 10 },
      { kind: 'hold', x: -6, y: 8, length: 8, width: 6 },
      { kind: 'battery', x: -6, y: -8, length: 8, width: 6 },
      { kind: 'pad', x: 3 + PAD_WIDTH / 2, y: 0, length: PAD_WIDTH, width: PAD_WIDTH },
    ],
  };
  const design = compileBlueprint(blueprint);
  return compileBlueprint({ ...blueprint, doctrine: { ...design.doctrine, approach: { ...design.doctrine.approach, rechargeBelow } } });
}
const HOLD = 2;

const dinky = compileBlueprint(DINKY);
const fighter = compileBlueprint({ ...DINKY, doctrine: { ...dinky.doctrine, approach: { ...dinky.doctrine.approach, refuelBelow: 0.5 } } });
const CORE = fighter.cores[0]!;
const GUN = fighter.modules.findIndex((m) => m.spec.kind === 'hullGun');
const capacity = (m: number): number => fighter.modules[m]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG;

/** A Dinky low on fuel, its core half spent and its gun hit twice as hard as breaks it. */
function scene(carrier = carrierOf()): ReturnType<typeof makeBattle<{ c: number; f: number }>> {
  return makeBattle({ seed: 3 }, (ships, world) => {
    const c = ships.spawn(world, { design: carrier, x: 0, y: 0, angle: 0.3 });
    const f = ships.spawn(world, { design: fighter, x: -300, y: 200, angle: 0 });
    const b = world.bodies.indexOf(ships.body(f));
    for (let m = 0; m < fighter.modules.length; m++) ships.fuel.vent(b, m, ships.fuel.held(b, m) * 0.8);
    ships.damage.absorb(b, CORE, capacity(CORE) * 0.5);
    ships.damage.absorb(b, GUN, capacity(GUN) * 2);
    return { c, f };
  });
}

type Run = ReturnType<typeof scene>;
const aboard = (run: Run): boolean => run.ships.body(run.c) === run.ships.body(run.f);
function runUntil(run: Run, done: () => boolean, seconds: number): void {
  for (let s = 0; s < seconds * 60 && !done(); s++) run.step();
}
/** What fighter module `m` has absorbed, wherever the fighter is. */
function absorbed(run: Run, m: number): number {
  const b = run.world.bodies.indexOf(run.ships.body(run.f));
  return run.ships.damage.absorbedAt(b, aboard(run) ? run.ships.design(run.c).modules.length - fighter.modules.length + m : m);
}

describe('a pad', () => {
  it('mends what lands on it, core first, and holds it until it is whole', () => {
    const run = scene();
    const hold = (): number => run.ships.metal.pieceHeld(run.world.bodies.indexOf(run.ships.body(run.c)), HOLD);
    runUntil(run, () => aboard(run), 60);
    expect(aboard(run)).toBe(true);
    const at = run.world.bodies.indexOf(run.ships.body(run.f));
    const n = carrierOf().modules.length;
    const shed = run.ships.damage.shedAt(at, n + GUN) + run.ships.damage.shedAt(at, n + CORE);
    expect(shed).toBeGreaterThan(0);
    const metalBefore = hold();
    const discardedBefore = run.ships.discarded;
    // A step in: the core is being mended, the gun not yet touched.
    expect(capacity(CORE) * 0.5).toBeGreaterThan((PAD_REPAIR_PER_METRE * PAD_WIDTH) / 60);
    run.step();
    expect(absorbed(run, CORE)).toBeLessThan(capacity(CORE) * 0.5);
    expect(absorbed(run, GUN)).toBe(capacity(GUN) * 2);
    let steps = 1;
    for (; steps < 120 * 60 && aboard(run); steps++) run.step();
    expect(aboard(run)).toBe(false);
    expect(absorbed(run, CORE)).toBe(0);
    expect(absorbed(run, GUN)).toBe(0);
    // No quicker than the pad works.
    const damage = capacity(CORE) * 0.5 + capacity(GUN) * 2;
    expect(steps / 60).toBeGreaterThanOrEqual(damage / (PAD_REPAIR_PER_METRE * PAD_WIDTH) - 0.1);
    // The metal they had shed went back into them, and a tenth more was lost.
    expect(metalBefore - hold()).toBeGreaterThanOrEqual(shed * (1 + REPAIR_WASTE) - 1e-6);
    expect(run.ships.discarded - discardedBefore).toBeCloseTo(shed * REPAIR_WASTE, 3);
  });

  it('mends from what its carrier keeps back for itself', () => {
    // A carrier keeping back every joule it holds.
    const run = scene(carrierOf(1));
    runUntil(run, () => aboard(run), 60);
    expect(aboard(run)).toBe(true);
    runUntil(run, () => !aboard(run), 120);
    expect(absorbed(run, GUN)).toBe(0);
  });

  it('lets go of what it cannot mend for want of metal, rather than holding it', () => {
    const run = scene();
    runUntil(run, () => aboard(run), 60);
    expect(aboard(run)).toBe(true);
    // Not a kilogram left aboard the carrier.
    const empty = (): boolean => {
      const b = run.world.bodies.indexOf(run.ships.body(run.c));
      for (let m = 0; m < run.ships.design(run.c).modules.length; m++) run.ships.metal.drain(b, m, run.ships.metal.held(b, m));
      return !aboard(run);
    };
    runUntil(run, empty, 30);
    expect(aboard(run)).toBe(false);
    expect(absorbed(run, GUN)).toBeGreaterThan(0);
  });
});
