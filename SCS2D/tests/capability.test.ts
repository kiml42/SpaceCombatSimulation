import { describe, expect, it } from 'vitest';
import { compileBlueprint, DamageEffect, DAMAGE_ENERGY_PER_KG, shipFleet } from '../sim/index.js';
import { addCapability, EFFECTS, workingShare } from '../evolution/capability.js';
import { Match, runMatch } from '../evolution/match.js';
import { CORVETTE, DINKY, GUNSHIP } from '../scenarios/blueprints.js';
import { TURRET_DINKY } from './fixtures.js';

/** What a hull can still do, and the two scores read from it. */

describe('capability', () => {
  it('rates an untouched hull by its thrust, firepower and cores', () => {
    const design = compileBlueprint(GUNSHIP);
    const into = new Float64Array(EFFECTS);
    addCapability(into, 0, design, null, -1);
    const thrust = design.modules.reduce((sum, m) => sum + m.stats.thrust, 0);
    expect(into[DamageEffect.Thrust]).toBeCloseTo(thrust);
    expect(into[DamageEffect.FireRate]).toBeGreaterThan(0);
    expect(into[DamageEffect.Control]).toBeGreaterThan(0);
    expect(workingShare(into, into)).toEqual(1);
  });

  it('averages over the effects a hull started with', () => {
    const start = Float64Array.from([10, 0, 4]);
    expect(workingShare(Float64Array.from([5, 0, 4]), start)).toBeCloseTo(0.75);
  });
});

describe('scoring what works', () => {
  it('keeps an untouched ship fully working', () => {
    const result = runMatch([DINKY], { seed: 1, duration: 5 });
    expect(result.scores[0]!.functional).toBeCloseTo(1, 9);
    expect(result.scores[0]!.disabling).toEqual(0);
  });

  it('counts a ship its own engines hurt as hurt, and pays nobody for it', () => {
    const match = new Match([CORVETTE, shipFleet(DINKY)], { seed: 1, duration: 2 });
    const { ships, world, slots } = match.battle;
    const body = world.bodies.indexOf(ships.body(slots[0]!));
    const design = ships.design(slots[0]!);
    // Spend every engine, as a ship cooking itself would, with no shooter to credit.
    design.modules.forEach((module, m) => {
      if (module.spec.kind === 'engine') ships.damage.absorb(body, m, module.stats.hitPoints * DAMAGE_ENERGY_PER_KG);
    });
    while (!match.done) match.advance();
    const [hurt, other] = match.result().scores;
    expect(hurt!.functional).toBeLessThan(0.7);
    expect(other!.disabling).toEqual(0);
    expect(hurt!.disabling).toEqual(0);
  });

  it('pays whoever takes an opponent’s function away', () => {
    const result = runMatch([GUNSHIP, TURRET_DINKY], { seed: 11 });
    expect(Math.max(...result.scores.map((score) => score.disabling))).toBeGreaterThan(0.1);
  });
});
