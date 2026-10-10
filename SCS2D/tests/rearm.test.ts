import { describe, expect, it } from 'vitest';
import { compileBlueprint, type Blueprint, type ShipDesign } from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import { DINKY } from '../scenarios/blueprints.js';

/** Fighters landing on a friend's pad to take on metal for their guns, and fuel with it. */

/** A core, a big tank, and a pad on its bow big enough for a Dinky. The core carries the metal. */
function carrierOf(rearmBelow = 0): ShipDesign {
  const blueprint: Blueprint = {
    name: 'Carrier',
    modules: [
      { kind: 'core', x: 0, y: 0, length: 6, width: 6 },
      { kind: 'tank', x: -13, y: 0, length: 20, width: 10 },
      { kind: 'pad', x: 13, y: 0, length: 20, width: 20 },
    ],
  };
  const design = compileBlueprint(blueprint);
  return compileBlueprint({ ...blueprint, doctrine: { ...design.doctrine, approach: { ...design.doctrine.approach, rearmBelow } } });
}
const CORE = 0;

function fighterOf(rearmBelow: number, dockBelow = 0.5): ShipDesign {
  const doctrine = compileBlueprint(DINKY).doctrine;
  return compileBlueprint({ ...DINKY, doctrine: { ...doctrine, approach: { ...doctrine.approach, rearmBelow, dockBelow } } });
}

interface Setup {
  fighter?: ShipDesign;
  carrier?: ShipDesign;
  /** How much of the fighter's metal is gone. */
  fired?: number;
  /** How much of its fuel is gone. */
  burnt?: number;
}

function scene(setup: Setup = {}) {
  return makeBattle({ seed: 3 }, (ships, world) => {
    const c = ships.spawn(world, { design: setup.carrier ?? carrierOf(), x: 0, y: 0, angle: 0.3, team: 0 });
    const f = ships.spawn(world, { design: setup.fighter ?? fighterOf(0), x: -300, y: 200, angle: 0 });
    const b = world.bodies.indexOf(ships.body(f));
    const design = ships.design(f);
    for (let m = 0; m < design.modules.length; m++) {
      ships.metal.drain(b, m, ships.metal.held(b, m) * (setup.fired ?? 1));
      ships.fuel.vent(b, m, ships.fuel.held(b, m) * (setup.burnt ?? 0));
    }
    return { c, f };
  });
}

type Run = ReturnType<typeof scene>;
const aboard = (run: Run): boolean => run.ships.body(run.c) === run.ships.body(run.f);
const bodyOf = (run: Run, i: number): number => run.world.bodies.indexOf(run.ships.body(i));
const ownCore = (run: Run): number => run.ships.design(run.f).cores[0]!;
function runUntil(run: Run, done: () => boolean, seconds: number): void {
  for (let s = 0; s < seconds * 60 && !done(); s++) run.step();
}

describe('a fighter out of rounds', () => {
  it("lands on a friend's pad, takes metal from it, and lifts off full", () => {
    const run = scene();
    const carrierMetal = (): number => run.ships.metal.held(bodyOf(run, run.c), CORE);
    const before = carrierMetal();
    runUntil(run, () => aboard(run), 60);
    expect(aboard(run)).toBe(true);
    runUntil(run, () => !aboard(run), 30);
    expect(aboard(run)).toBe(false);
    expect(run.ships.metal.pieceRoom(bodyOf(run, run.f), ownCore(run))).toBeCloseTo(0, 3);
    expect(carrierMetal()).toBeLessThan(before);
    expect(run.ships.design(run.f).fighter).toBe(true);
  });

  it('tops up its fuel while it is there, though it came for metal', () => {
    const run = scene({ burnt: 0.3 });
    runUntil(run, () => aboard(run), 60);
    runUntil(run, () => !aboard(run), 30);
    expect(aboard(run)).toBe(false);
    expect(run.ships.fuel.pieceRoom(bodyOf(run, run.f), ownCore(run))).toBeCloseTo(0, 3);
  });

  it('never goes with a doctrine that says never', () => {
    const run = scene({ fighter: fighterOf(-1) });
    runUntil(run, () => aboard(run), 60);
    expect(aboard(run)).toBe(false);
  });
});

describe('a fighter with rounds left', () => {
  it('waits until it cannot load another by default', () => {
    const run = scene({ fired: 0.9 });
    runUntil(run, () => aboard(run), 60);
    expect(aboard(run)).toBe(false);
  });

  it('goes once it is down to the share its doctrine names', () => {
    const run = scene({ fighter: fighterOf(0.2), fired: 0.9 });
    runUntil(run, () => aboard(run), 60);
    expect(aboard(run)).toBe(true);
  });

  it('is filled with metal when low fuel sends it', () => {
    const run = scene({ fired: 0.5, burnt: 0.8 });
    runUntil(run, () => aboard(run), 60);
    expect(aboard(run)).toBe(true);
    runUntil(run, () => !aboard(run), 30);
    expect(aboard(run)).toBe(false);
    expect(run.ships.metal.pieceRoom(bodyOf(run, run.f), ownCore(run))).toBeCloseTo(0, 3);
  });
});

describe('a carrier', () => {
  it('keeps back its own share of metal', () => {
    const run = scene({ carrier: carrierOf(0.999) });
    const carrierMetal = (): number => run.ships.metal.left(bodyOf(run, run.c));
    const before = carrierMetal();
    runUntil(run, () => aboard(run), 60);
    runUntil(run, () => !aboard(run), 30);
    // It may land for nothing, but it leaves with nothing the carrier was keeping.
    expect(carrierMetal()).toBeGreaterThanOrEqual(before * 0.999 - 1e-6);
  });
});
