import { describe, expect, it } from 'vitest';
import {
  blueprintProblems,
  budgetMass,
  compileBlueprint,
  DamageEffect,
  parseBlueprint,
  parseFleet,
  serialiseBlueprint,
  type Blueprint,
} from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import type { Battle } from '../scenarios/types.js';
import { BARE_CORE, DINKY } from '../scenarios/blueprints.js';
import { FACTORY, WORKSHOP } from '../scenarios/carrier.js';
import { Activity } from '../scenarios/decision.js';
import { fleetBattle } from '../scenarios/fleetBattle.js';
import coriesFile from './fixtures/cories-fleet.json' with { type: 'json' };

/** Pads building fighters from a core (ROADMAP.md §8 step 12, slice 1). */

const PAD = 2;

/** A Factory whose bow pad keeps `keep` Dinkies, setting out with one docked or not. */
function factoryOf(keep: number, docked = false): Blueprint {
  return {
    ...FACTORY,
    modules: FACTORY.modules.map((m, i) => (i === PAD ? { ...m, keep, ...(docked ? { docked: true } : {}) } : m)),
  };
}

/** A carrier and an unarmed hulk `range` off: far, by default, so its fighters wait aboard. */
function battle(carrier: Blueprint, range = 5000): Battle & { c: number } {
  return makeBattle({ seed: 5 }, (ships, world) => {
    const c = ships.spawn(world, { design: compileBlueprint(carrier), x: 0, y: 0, angle: 0.2 });
    ships.spawn(world, { design: compileBlueprint(BARE_CORE), x: range, y: 0, team: 1 });
    return { c };
  });
}

/** The ships of the carrier's side other than itself. */
function fighters(run: Battle & { c: number }): number[] {
  const out: number[] = [];
  for (let i = 0; i < run.ships.highWater; i++) {
    if (i !== run.c && run.ships.isAlive(i) && run.ships.teamOf(i) === run.ships.teamOf(run.c) && !run.ships.isDerelict(i)) out.push(i);
  }
  return out;
}

function runFor(run: Battle, seconds: number, until: () => boolean = () => false): void {
  for (let s = 0; s < seconds * 60 && !until(); s++) run.step();
}

describe('a pad that keeps fighters, in a file', () => {
  it('reads the older form, a fighter named as docked, as that fighter set out docked', () => {
    const raw = serialiseBlueprint(factoryOf(0)) as { modules: Record<string, unknown>[] };
    const { craft: _, keep: __, ...pad } = raw.modules[PAD]!;
    raw.modules[PAD] = { ...pad, docked: DINKY.name };
    const spec = parseBlueprint(raw).modules[PAD] as { craft?: string; docked?: boolean };
    expect(spec.craft).toBe(DINKY.name);
    expect(spec.docked).toBe(true);
    expect(compileBlueprint(parseBlueprint(raw)).aboard?.length).toBe(1);
  });

  it('reads `fighter`, the older name for `craft`', () => {
    const raw = serialiseBlueprint(factoryOf(3)) as { modules: Record<string, unknown>[] };
    const { craft, ...pad } = raw.modules[PAD]!;
    raw.modules[PAD] = { ...pad, fighter: craft };
    expect(parseBlueprint(raw).modules[PAD]).toMatchObject({ craft: DINKY.name, keep: 3 });
  });

  it('keeps its fighter, whether it sets out docked, and how many it keeps', () => {
    const back = parseBlueprint(JSON.parse(JSON.stringify(serialiseBlueprint(factoryOf(3, true)))));
    expect(back.modules[PAD]).toMatchObject({ craft: DINKY.name, docked: true, keep: 3 });
  });

  it('builds only what it keeps, and sets out only with what is docked', () => {
    expect(compileBlueprint(factoryOf(0)).builds).toBeUndefined();
    expect(compileBlueprint(factoryOf(0)).aboard).toBeUndefined();
    const built = compileBlueprint(factoryOf(3));
    expect(built.builds?.map((b) => [b.pad, b.keep])).toEqual([[PAD, 3]]);
    expect(built.aboard).toBeUndefined();
    expect(compileBlueprint(factoryOf(3, true)).aboard?.map((a) => a.pad)).toEqual([PAD]);
  });

  it('costs a budget only what sets out docked, whatever it keeps', () => {
    const empty = compileBlueprint(factoryOf(3));
    expect(budgetMass(empty)).toBeCloseTo(empty.launchMass, 6);
    const laden = compileBlueprint(factoryOf(3, true));
    expect(budgetMass(laden)).toBeCloseTo(laden.launchMass + compileBlueprint(DINKY).launchMass, 6);
  });

  it('is a problem when the fighter it names is missing, docked or not', () => {
    expect(blueprintProblems({ ...factoryOf(3), hangar: {} }).some((p) => /no fighter named Dinky/.test(p))).toBe(true);
  });
});

describe('a pad building the fighters it keeps', () => {
  it('lays down a core, builds the whole fighter round it, and lets it go full', () => {
    const run = battle(factoryOf(1), 600);
    const dinky = compileBlueprint(DINKY);
    runFor(run, 5);
    const [f] = fighters(run);
    expect(f).toBeDefined();
    expect(run.ships.isUnfinished(f!)).toBe(true);
    expect(run.ships.body(f!)).toBe(run.ships.body(run.c));
    runFor(run, 600, () => run.ships.body(f!) !== run.ships.body(run.c));
    expect(run.ships.body(f!)).not.toBe(run.ships.body(run.c));
    expect(run.ships.isUnfinished(f!)).toBe(false);
    expect(run.ships.design(f!).modules.length).toBe(dinky.modules.length);
    expect(run.ships.design(f!).fighter).toBe(true);
    expect(run.ships.hasControl(f!)).toBe(true);
    expect(run.ships.isDisarmed(f!)).toBe(false);
    // Only one was kept, and it is in the fight.
    runFor(run, 30);
    expect(fighters(run)).toEqual([f]);
  });

  it('keeps a whole fighter aboard, engines off, while nothing is in reach', () => {
    const run = battle(factoryOf(1));
    runFor(run, 5);
    const [f] = fighters(run);
    let burned = false;
    for (let s = 0; s < 240 * 60; s++) {
      run.step();
      burned ||= run.ships.design(f!).engines.some((_, e) => run.ships.throttleOf(f!, e) > 0);
    }
    expect(run.ships.isUnfinished(f!)).toBe(false);
    expect(run.ships.body(f!)).toBe(run.ships.body(run.c));
    expect(burned).toBe(false);
  });

  it('counts the one it set out with, and builds none while that one is in the fight', () => {
    const run = battle(factoryOf(1, true));
    const [f] = fighters(run);
    runFor(run, 120);
    expect(fighters(run)).toEqual([f]);
  });

  it('replaces a fighter that is out of the fight', () => {
    const run = battle(factoryOf(1, true), 600);
    const [f] = fighters(run);
    runFor(run, 120, () => run.ships.body(f!) !== run.ships.body(run.c));
    expect(run.ships.body(f!)).not.toBe(run.ships.body(run.c));
    // Its core shot out: a hulk, and no longer one of those kept.
    const b = run.world.bodies.indexOf(run.ships.body(f!));
    const core = run.ships.design(f!).cores[0]!;
    run.ships.damage.absorb(b, core, run.ships.damage.capacityLeft(b, core) * 2);
    expect(run.ships.hasControl(f!)).toBe(false);
    runFor(run, 5);
    const next = fighters(run).filter((g) => g !== f);
    expect(next.length).toBe(1);
    expect(run.ships.isUnfinished(next[0]!)).toBe(true);
  });

  it('builds them one at a time, until it keeps as many as it was told', () => {
    const run = battle(factoryOf(2), 600);
    runFor(run, 900, () => fighters(run).filter((f) => !run.ships.isUnfinished(f)).length >= 2);
    const done = fighters(run).filter((f) => !run.ships.isUnfinished(f));
    expect(done.length).toBe(2);
    runFor(run, 60);
    expect(fighters(run).length).toBe(2);
  });

  it('builds nothing with no metal to build with', () => {
    const run = battle({ ...factoryOf(1), modules: factoryOf(1).modules.filter((m) => !('kind' in m) || m.kind !== 'hold') });
    const b = run.world.bodies.indexOf(run.ships.body(run.c));
    run.ships.metal.drain(b, 0, run.ships.metal.left(b));
    runFor(run, 30);
    expect(fighters(run)).toEqual([]);
  });

  it('holds a fighter it is building, whatever comes near', () => {
    const run = battle(factoryOf(1));
    runFor(run, 5);
    const [f] = fighters(run);
    expect(run.ships.isUnfinished(f!)).toBe(true);
    // Its pad shot half away: still building, and still holding on.
    const b = run.world.bodies.indexOf(run.ships.body(run.c));
    const modules = run.ships.design(run.c).modules;
    const pad = modules.findIndex((m, k) => m.spec.kind === 'pad' && m.spec.craft !== undefined && run.ships.owns(run.c, k));
    run.ships.damage.absorb(b, pad, run.ships.damage.capacityLeft(b, pad) * 0.3);
    expect(run.ships.damage.remaining(b, pad, DamageEffect.Grip)).toBeGreaterThan(0);
    runFor(run, 30);
    expect(run.ships.body(f!)).toBe(run.ships.body(run.c));
  });
});

describe('the decision, for a carrier with no gun of its own', () => {
  it('is armed while it can still build an armed fighter, and not with none to build', () => {
    // Against an unarmed hulk: armed, it has won; unarmed, nobody has.
    for (const [keep, winner] of [[1, 0], [0, -1]] as const) {
      const run = battle(factoryOf(keep));
      run.step();
      expect(new Activity(2).observe(run)).toMatchObject({ winner, reason: 'disarmed' });
    }
  });

  it('is busy while it builds', () => {
    const run = battle(factoryOf(1));
    let busy = false;
    for (let s = 0; s < 120 && !busy; s++) {
      run.step();
      busy = run.ships.lastBuilt(run.c) === run.world.tick;
    }
    expect(busy).toBe(true);
  });
});

describe('a Workshop', () => {
  it('builds nothing: its pads keep no fighters', () => {
    expect(compileBlueprint(WORKSHOP).builds).toBeUndefined();
  });
});

describe('a fighter on a pad, its engines lit', () => {
  it('burns over the deck it is sat on, not into it', () => {
    const run = battle(factoryOf(1, true));
    const [f] = fighters(run);
    expect(run.ships.body(f!)).toBe(run.ships.body(run.c));
    const b = run.world.bodies.indexOf(run.ships.body(run.c));
    const modules = run.ships.design(run.c).modules;
    const pad = modules.findIndex((m, k) => m.spec.kind === 'pad' && m.spec.craft !== undefined && run.ships.owns(run.c, k));
    const before = run.ships.damage.absorbedAt(b, pad);
    // Full throttle on every engine, as if it had lit them where it sits.
    (run.ships as unknown as { throttles: Float64Array[] }).throttles[f!]!.fill(1);
    run.grid.rebuild(run.world.bodies);
    for (let s = 0; s < 60; s++) run.ships.scorch(run.world, run.grid, run.dt);
    expect(run.ships.damage.absorbedAt(b, pad)).toBe(before);
  });
});

describe('ships sharing a hull', () => {
  it('number only their own cores, so each writes its name on its own', () => {
    // Set out docked, so both cores are whole from the start.
    const run = battle(factoryOf(1, true));
    run.step();
    const [f] = fighters(run);
    expect(run.ships.body(f!)).toEqual(run.ships.body(run.c));
    for (const [i, other] of [[run.c, f!], [f!, run.c]] as const) {
      const numbers: number[] = [];
      run.ships.coreNumbers(i, numbers);
      const cores = run.ships.design(i).cores;
      // Every core is one ship's: this one numbers its own and marks the other's.
      for (let k = 0; k < cores.length; k++) {
        expect(numbers[k]! < 0, `ship ${i}, core ${cores[k]}`).toBe(run.ships.pilotAt(run.world.bodies.indexOf(run.ships.body(i)), cores[k]!) === other);
      }
      expect(numbers.filter((n) => n >= 0).length).toBe(1);
    }
  });
});


describe('robots aboard a carrier building a fighter', () => {
  it('leave the fighter being built alone, though it has no working core yet', () => {
    // The author's fleet that found it: a Factory with a robot bay, keeping four of a big fighter.
    const fleet = parseFleet(coriesFile);
    const foe = { name: 'Foe', designs: { [BARE_CORE.name]: BARE_CORE }, ships: [{ design: BARE_CORE.name, x: 0, y: 0 }] };
    const run = fleetBattle([fleet, foe], { seed: 1, range: 5000 });
    const ours = (): number[] => {
      const out: number[] = [];
      for (let i = 0; i < run.ships.highWater; i++) if (run.ships.isAlive(i) && run.ships.teamOf(i) === 0 && run.ships.isUnfinished(i)) out.push(i);
      return out;
    };
    for (let s = 0; s < 30 * 60 && ours().length === 0; s++) run.step();
    const building = ours();
    expect(building.length).toBeGreaterThan(0);
    // Long enough that, taken apart, they were gone and laid again more than once.
    for (let s = 0; s < 90 * 60; s++) run.step();
    for (const f of building) expect(run.ships.isAlive(f), `fighter ${f}`).toBe(true);
  });
});
