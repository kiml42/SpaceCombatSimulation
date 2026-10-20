import { describe, expect, it } from 'vitest';
import { compileBlueprint, DAMAGE_ENERGY_PER_KG, type Blueprint } from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import { CORVETTE, SALVAGER } from '../scenarios/blueprints.js';
import { BREAKER } from '../scenarios/salvage.js';

/** A ship going out to take wrecks apart for their metal, by `scavengeMetalBelow`. */

/** The scrapyard's salvager with an engine and a tank, so it can go to a wreck. */
function salvager(scavengeMetalBelow: number, fuelPerMetal = 1): Blueprint {
  const blueprint: Blueprint = {
    ...BREAKER,
    modules: [
      ...BREAKER.modules,
      { kind: 'tank', x: -7.5, y: 0, length: 4, width: 4 },
      { kind: 'engine', x: -9.5, y: 0, angle: Math.PI, length: 1.5, width: 4, nozzle: 0.5 },
    ],
  };
  const doctrine = compileBlueprint(blueprint).doctrine;
  return { ...blueprint, doctrine: { ...doctrine, approach: { ...doctrine.approach, scavengeMetalBelow, fuelPerMetal } } };
}

function scene(design: Blueprint): ReturnType<typeof makeBattle<{ s: number; w: number }>> {
  return makeBattle({ seed: 7 }, (ships, world) => {
    const s = ships.spawn(world, { design: compileBlueprint(design), x: 0, y: 0, angle: 0, team: 0 });
    const corvette = compileBlueprint(CORVETTE);
    const w = ships.spawn(world, { design: corvette, x: 300, y: 40, angle: 2, team: 1 });
    // Its cores shot out: a hulk, and nothing of its own mending it.
    const body = world.bodies.indexOf(ships.body(w));
    for (const core of corvette.cores) ships.damage.absorb(body, core, corvette.modules[core]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG);
    return { s, w };
  });
}

type Run = ReturnType<typeof scene>;
/** The metal on the salvager's hull. */
const hold = (run: Run): number => {
  const b = run.world.bodies.indexOf(run.ships.body(run.s));
  return run.ships.metal.pieceHeld(
    b,
    run.ships.design(run.s).modules.findIndex((m) => m.spec.kind === 'hold'),
  );
};
function runFor(run: Run, seconds: number, done: () => boolean = () => false): void {
  for (let s = 0; s < seconds * 60 && !done(); s++) run.step();
}

describe('scavenging for metal', () => {
  it('goes to a hulk, grips it, and takes it apart into its hold', { timeout: 60_000 }, () => {
    const run = scene(salvager(0.5));
    expect(run.ships.hasControl(run.w)).toBe(false);
    const before = hold(run);
    runFor(run, 200, () => run.ships.body(run.s) === run.ships.body(run.w));
    expect(run.ships.body(run.s)).toBe(run.ships.body(run.w));
    runFor(run, 120);
    expect(hold(run) - before).toBeGreaterThan(1000);
  });

  it('is what the stock Salvager does, as it comes', { timeout: 60_000 }, () => {
    const run = scene(SALVAGER);
    const before = hold(run);
    runFor(run, 200, () => run.ships.body(run.s) === run.ships.body(run.w));
    expect(run.ships.body(run.s)).toBe(run.ships.body(run.w));
    runFor(run, 120);
    expect(hold(run) - before).toBeGreaterThan(1000);
  });

  it('stays put with scavengeMetalBelow at zero', { timeout: 60_000 }, () => {
    const run = scene(salvager(0));
    const before = hold(run);
    runFor(run, 200);
    expect(run.ships.body(run.s)).not.toBe(run.ships.body(run.w));
    expect(hold(run)).toBe(before);
  });

  it('stays put when it will burn no fuel for metal', { timeout: 60_000 }, () => {
    const run = scene(salvager(0.5, 0));
    runFor(run, 200);
    expect(run.ships.body(run.s)).not.toBe(run.ships.body(run.w));
  });
});
