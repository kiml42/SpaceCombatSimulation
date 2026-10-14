import { describe, expect, it } from 'vitest';
import { compileBlueprint, expandFleet, isWeaponMount, serialiseBlueprint, serialiseFleet, type ShipDesign } from '../sim/index.js';
import { fittingsOf, generationSize, type GenerationRecord, type IndividualRecord } from '../evolution/run.js';
import { BEAM_CARRIER, CORVETTE, DINKY } from '../scenarios/blueprints.js';
import { LINE_OF_BATTLE } from '../scenarios/fleets.js';

/** What the evolution page's size chart reads off a generation when asked for weapons and engines. */

function counted(name: keyof typeof LINE_OF_BATTLE.designs | string, blueprint = LINE_OF_BATTLE.designs[name]!): [number, number] {
  const tally = (design: ShipDesign): [number, number] =>
    (design.aboard ?? []).reduce<[number, number]>(
      ([w, e], fighter) => {
        const [fw, fe] = tally(fighter.design);
        return [w + fw, e + fe];
      },
      [design.modules.filter((m) => isWeaponMount(m.spec.kind)).length, design.modules.filter((m) => m.spec.kind === 'engine').length],
    );
  return tally(compileBlueprint(blueprint));
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

  it('counts the fighters a carrier sets out with', () => {
    const carrier = compileBlueprint(BEAM_CARRIER);
    expect(carrier.aboard?.length ?? 0).toBeGreaterThan(0);
    const own = carrier.modules.filter((m) => isWeaponMount(m.spec.kind)).length;
    const fittings = fittingsOf(ship(1, BEAM_CARRIER));
    expect(fittings.weapons).toBeGreaterThan(own);
    expect(fittings.weapons).toBe(counted('', BEAM_CARRIER)[0]);
  });

  it('counts a design that will not compile as nothing, rather than failing', () => {
    const broken = { id: 1, fitness: 1, mass: 1, blueprint: { ...serialiseBlueprint(DINKY), modules: [] } } as unknown as IndividualRecord;
    expect(fittingsOf(broken)).toEqual({ ships: 1, weapons: 0, engines: 0 });
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
