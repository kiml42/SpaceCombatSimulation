import { describe, expect, it } from 'vitest';
import { compileBlueprint, DAMAGE_ENERGY_PER_KG, DISASSEMBLY_WASTE, type ShipDesign } from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import { CORVETTE } from '../scenarios/blueprints.js';
import { LEECH, SALVAGER } from '../scenarios/salvage.js';

const OWN = SALVAGER.modules.length;

const salvager = compileBlueprint(SALVAGER);

interface Setup {
  /** The other hull's cores are left sound, so it is still flown. */
  live?: boolean;
  /** Put the other hull in the world first. */
  first?: boolean;
}

/** A salvager drifting bow first into `other`, torn open everywhere and its cores out unless `live`. */
function approach(other: ShipDesign, setup: Setup = {}) {
  return makeBattle({ seed: 1 }, (ships, world) => {
    const gap = salvager.radius + other.radius + 1;
    const spawn = () => ships.spawn(world, { design: salvager, x: -gap / 2, y: 0, angle: 0, vx: 0.6 });
    const pre = setup.first === true ? -1 : spawn();
    const b = ships.spawn(world, { design: other, x: gap / 2, y: 0, angle: Math.PI, vx: -0.6, team: 1 });
    const a = pre >= 0 ? pre : spawn();
    const body = world.bodies.indexOf(ships.body(b));
    for (let m = 0; m < other.modules.length; m++) {
      const module = other.modules[m]!;
      const core = module.spec.kind === 'core';
      if (core && setup.live === true) continue;
      ships.damage.absorb(body, m, module.stats.hitPoints * DAMAGE_ENERGY_PER_KG * (core ? 1 : 0.9));
    }
    return { a, b };
  });
}

type Run = ReturnType<typeof approach>;

const body = (run: Run): number => run.world.bodies.indexOf(run.ships.body(run.a));
const held = (run: Run): number => run.ships.metal.pieceHeld(body(run), 0);
const modules = (run: Run): number => run.ships.design(run.a).modules.length;

/** Every body's mass and everything thrown away: what nothing can create or destroy. */
function matter(run: Run): number {
  let total = run.ships.discarded;
  for (let b = 0; b < run.world.bodies.highWater; b++) if (run.world.bodies.alive[b] === 1) total += run.world.bodies.mass[b]!;
  return total;
}

function runFor(run: Run, seconds: number, done: () => boolean = () => false): void {
  for (let s = 0; s < seconds * 60 && !done(); s++) run.step();
}

describe('taking wreckage apart', () => {
  it('turns a wreck on its hull into metal in its holds, a module at a time', { timeout: 60_000 }, () => {
    const corvette = compileBlueprint(CORVETTE);
    const run = approach(corvette);
    runFor(run, 10, () => modules(run) > OWN);
    const whole = modules(run);
    expect(whole).toBe(OWN + corvette.modules.length);
    const before = held(run);
    const total = matter(run);
    runFor(run, 600);
    // Wreckage has come off, and none of its own hull.
    expect(modules(run)).toBeLessThan(whole - 3);
    const design = run.ships.design(run.a);
    for (let m = 0; m < OWN; m++) expect(design.modules[m]!.spec.kind).toBe(salvager.modules[m]!.spec.kind);
    expect(held(run)).toBeGreaterThan(before + 20_000);
    // Still one hull: nothing came away loose.
    expect(run.ships.count).toBe(2);
    expect(matter(run)).toBeCloseTo(total, -1);
  });

  it('gives what is left of a module, less the waste', { timeout: 60_000 }, () => {
    const corvette = compileBlueprint(CORVETTE);
    const run = approach(corvette);
    runFor(run, 10, () => modules(run) > OWN);
    const was = run.world.bodies.mass[body(run)]!;
    const before = held(run);
    const thrown = run.ships.discarded;
    runFor(run, 600, () => modules(run) < OWN + corvette.modules.length);
    expect(modules(run)).toBe(OWN + corvette.modules.length - 1);
    const gained = held(run) - before;
    const wasted = run.ships.discarded - thrown;
    // The hull lost the waste, and the rest of the module is metal aboard.
    expect(was - run.world.bodies.mass[body(run)]!).toBeCloseTo(wasted, 0);
    expect(wasted / (gained + wasted)).toBeCloseTo(DISASSEMBLY_WASTE, 3);
  });

  it('takes a wreck apart to nothing, and the ship it was is gone', { timeout: 60_000 }, () => {
    for (const first of [false, true]) {
      const leech = compileBlueprint(LEECH);
      const run = approach(leech, { first });
      runFor(run, 10, () => modules(run) > OWN);
      expect(modules(run)).toBe(OWN + leech.modules.length);
      // Gripped by the claw for its metal alone, with no room for fuel, and held while it comes apart.
      expect(run.ships.design(run.a).seams?.[0]?.dock).toBe('claw');
      runFor(run, 600, () => modules(run) === OWN);
      expect(modules(run)).toBe(OWN);
      expect(run.ships.count).toBe(1);
      expect(run.ships.design(run.a).modules.map((m) => m.spec.kind)).toEqual(salvager.modules.map((m) => m.spec.kind));
    }
  });

  it('never takes apart a ship still under control', { timeout: 60_000 }, () => {
    const corvette = compileBlueprint(CORVETTE);
    const run = approach(corvette, { live: true });
    runFor(run, 10, () => modules(run) > OWN);
    const whole = modules(run);
    expect(whole).toBe(OWN + corvette.modules.length);
    runFor(run, 120);
    expect(modules(run)).toBe(whole);
  });
});
