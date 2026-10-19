import { describe, expect, it } from 'vitest';
import { compileBlueprint, DAMAGE_ENERGY_PER_KG, ROBOT_LOAD, type ShipDesign } from '../sim/index.js';
import type { Robot } from '../sim/robots.js';
import { makeBattle } from '../scenarios/battle.js';
import { CORVETTE } from '../scenarios/blueprints.js';
import { LEECH, BREAKER } from '../scenarios/salvage.js';

const OWN = BREAKER.modules.length;

const salvager = compileBlueprint(BREAKER);

interface Setup {
  /** The other hull's cores are left sound, so it is still flown. */
  live?: boolean;
  /** Put the other hull in the world first. */
  first?: boolean;
}

/** A salvager drifting bow first into `other`'s stern, `other` torn open everywhere and its cores out unless `live`. */
function approach(other: ShipDesign, setup: Setup = {}) {
  return makeBattle({ seed: 1 }, (ships, world) => {
    const gap = salvager.radius + other.radius + 1;
    const spawn = () => ships.spawn(world, { design: salvager, x: -gap / 2, y: 0, angle: 0, vx: 0.6 });
    const pre = setup.first === true ? -1 : spawn();
    const b = ships.spawn(world, { design: other, x: gap / 2, y: 0, angle: 0, vx: -0.6, team: 1 });
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

  it('carries what it takes off home, and only there puts it in the holds', { timeout: 60_000 }, () => {
    const corvette = compileBlueprint(CORVETTE);
    const run = approach(corvette);
    runFor(run, 10, () => modules(run) > OWN);
    const robots = (): Robot[] => (run.ships as unknown as { robots: { on(b: number): Robot[] } }).robots.on(body(run));
    let carried = 0;
    let unloads = 0;
    for (let s = 0; s < 600 * 60; s++) {
      const before = held(run);
      const cargo = robots().map((r) => r.cargo);
      run.step();
      const after = robots().map((r) => r.cargo);
      for (const r of robots()) expect(r.cargo).toBeLessThanOrEqual(ROBOT_LOAD + 1e-6);
      carried = Math.max(carried, ...after);
      if (held(run) > before + 1e-6) {
        // What went into the holds came out of robots that had got home.
        const dropped = cargo.reduce((sum, kg, r) => sum + Math.max(0, kg - after[r]!), 0);
        expect(dropped).toBeCloseTo(held(run) - before, 3);
        unloads++;
      }
    }
    expect(carried).toBeCloseTo(ROBOT_LOAD, 3);
    expect(unloads).toBeGreaterThan(4);
  });

  it('takes a module apart as it was built, backwards: its fittings out, then its walls down a step at a time', { timeout: 60_000 }, () => {
    const leech = compileBlueprint(LEECH);
    const run = approach(leech);
    runFor(run, 10, () => modules(run) > OWN);
    const tank = (): { share: number; unbuilt: number } | null => {
      const design = run.ships.design(run.a);
      for (let m = OWN; m < design.modules.length; m++) {
        if (design.modules[m]!.index !== 1) continue;
        return { share: design.modules[m]!.shell?.share ?? 1, unbuilt: run.ships.damage.unbuiltAt(body(run), m) };
      }
      return null;
    };
    const shares: number[] = [];
    let emptied = false;
    for (let s = 0; s < 600 * 60 && tank() !== null; s++) {
      run.step();
      const now = tank();
      if (now === null) break;
      if (now.share === 1 && now.unbuilt > 0) emptied = true;
      if (shares[shares.length - 1] !== now.share) shares.push(now.share);
    }
    expect(emptied).toBe(true);
    expect(tank()).toBeNull();
    // Every step of its walls, from whole down, then gone.
    expect(shares.map((share) => Math.round(share * 10))).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
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
