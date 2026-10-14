import { describe, expect, it } from 'vitest';
import { compileBlueprint, expandFleet, serialiseBlueprint, serialiseFleet } from '../sim/index.js';
import { fittingsOf, generationSize, type GenerationRecord, type IndividualRecord } from '../evolution/run.js';
import { CORVETTE, DINKY } from '../scenarios/blueprints.js';
import { LINE_OF_BATTLE } from '../scenarios/fleets.js';

/** What the evolution page's size chart reads off a generation when asked for weapons and engines. */

const WEAPONS = ['turret', 'beamTurret', 'hullGun', 'hullBeam'];

function counted(name: keyof typeof LINE_OF_BATTLE.designs | string, blueprint = LINE_OF_BATTLE.designs[name]!): [number, number] {
  const modules = compileBlueprint(blueprint).modules;
  return [modules.filter((m) => WEAPONS.includes(m.spec.kind)).length, modules.filter((m) => m.spec.kind === 'engine').length];
}

const ship = (fitness: number, blueprint = CORVETTE): IndividualRecord =>
  ({ id: fitness, fitness, mass: 1, blueprint: serialiseBlueprint(blueprint) }) as unknown as IndividualRecord;

describe('what an individual fields', () => {
  it('counts a ship’s weapons and engines, every copy of a repeated assembly included', () => {
    const [weapons, engines] = counted('', CORVETTE);
    expect(weapons).toBeGreaterThan(0);
    expect(engines).toBeGreaterThan(0);
    expect(fittingsOf(ship(1))).toEqual({ ships: 1, weapons, engines });
  });

  it('counts every ship of a fleet', () => {
    const record = { id: 1, fitness: 1, mass: 1, fleet: serialiseFleet(LINE_OF_BATTLE) } as unknown as IndividualRecord;
    let weapons = 0;
    let engines = 0;
    const ships = expandFleet(LINE_OF_BATTLE);
    for (const entry of ships) {
      const [w, e] = counted(entry.design);
      weapons += w;
      engines += e;
    }
    expect(fittingsOf(record)).toEqual({ ships: ships.length, weapons, engines });
  });

  it('reads the fittest and the mean off a generation', () => {
    const generation = { individuals: [ship(1, CORVETTE), ship(2, DINKY)] } as unknown as GenerationRecord;
    const size = generationSize(generation);
    const [cw, ce] = counted('', CORVETTE);
    const [dw, de] = counted('', DINKY);
    expect(size.bestWeapons).toBe(dw);
    expect(size.bestEngines).toBe(de);
    expect(size.meanWeapons).toBeCloseTo((cw + dw) / 2, 12);
    expect(size.meanEngines).toBeCloseTo((ce + de) / 2, 12);
  });
});
