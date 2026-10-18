import { describe, expect, it } from 'vitest';
import { NO_BUDGET, padFighterNames, Rng, type Fleet } from '../sim/index.js';
import { mutate } from '../evolution/mutate.js';
import { fleetFits, mutateFleet, type FleetMutationLimits, type FleetOperator } from '../evolution/fleetMutate.js';
import { BARE_CORE, DINKY } from '../scenarios/blueprints.js';
import { SHIPYARD } from '../scenarios/shipyard.js';
import { FACTORY } from '../scenarios/carrier.js';
import { addShip, emptyFleet } from '../editor/fleetEdit.js';

/** Evolution breeding pads and the fighters they keep (ROADMAP.md §8 step 12, slice 1). */

const LIMITS = { radius: 500, maxShips: 24, budget: NO_BUDGET };

/** Limits that make only the one change: a design, every ship's move, or one change to what the fleet is made of. */
function only(change: FleetOperator | 'design' | 'move'): Partial<FleetMutationLimits> {
  const operators = { add: 0, remove: 0, fork: 0, merge: 0, swap: 0, pad: 0 };
  if (change === 'design') return { design: 1, move: 0, change: 0, operators };
  if (change === 'move') return { design: 0, move: 1, change: 0, operators };
  operators[change] = 1;
  return { design: 0, move: 0, change: 1, operators };
}

/** A Factory alone: its Dinky is only kept by its pad, and flown by no ship. */
function factoryFleet(): Fleet {
  return addShip(emptyFleet('Factory'), FACTORY, 0, 0);
}

describe('a pad bred', () => {
  it('has how many it keeps nudged, never below none', () => {
    let nudged = 0;
    for (let seed = 1; seed <= 300 && nudged === 0; seed++) {
      const child = mutate(FACTORY, new Rng(seed));
      if (!child.edits.some((edit) => /pad: keeps/.test(edit))) continue;
      nudged++;
      for (const m of child.blueprint.modules) if ('kind' in m && m.kind === 'pad') expect(m.keep ?? 0).toBeGreaterThanOrEqual(0);
    }
    expect(nudged).toBeGreaterThan(0);
  });
});

describe('a fleet bred with a carrier in it', () => {
  it('breeds a fighter only a pad keeps', () => {
    let bred = false;
    for (let seed = 1; seed <= 100 && !bred; seed++) {
      const child = mutateFleet(factoryFleet(), new Rng(seed), { ...LIMITS, ...only('design') });
      bred = child.edits.some((edit) => edit.startsWith('Dinky:'));
      expect(fleetFits(child.fleet, LIMITS)).toBe(true);
    }
    expect(bred).toBe(true);
  });

  it('points a pad at another fighter, a copy of its own, or a new bare core, each fit to fight', () => {
    const seen = new Set<string>();
    const fleet = addShip(factoryFleet(), { ...DINKY, name: 'Gnat' }, 60, 0);
    for (let seed = 1; seed <= 60; seed++) {
      const child = mutateFleet(fleet, new Rng(seed), { ...LIMITS, ...only('pad') });
      if (child.edits.length === 0) continue;
      expect(fleetFits(child.fleet, LIMITS)).toBe(true);
      const to = padFighterNames(child.fleet.designs['Factory']!)[0]!;
      expect(child.fleet.designs[to]?.fighter).toBe(true);
      seen.add(to === 'Gnat' ? 'other' : to.startsWith('Dinky') ? 'copy' : to.startsWith('Fighter') ? 'new' : to);
    }
    expect([...seen].sort()).toEqual(['copy', 'new', 'other']);
  });

  it('points a slipway at another ship, a copy of its own, or a new bare core, each fit to fight', () => {
    const seen = new Set<string>();
    const fleet = addShip(addShip(emptyFleet('Yard'), SHIPYARD, 0, 0), BARE_CORE, 80, 0);
    for (let seed = 1; seed <= 60; seed++) {
      const child = mutateFleet(fleet, new Rng(seed), { ...LIMITS, ...only('pad') });
      if (child.edits.length === 0) continue;
      expect(fleetFits(child.fleet, LIMITS)).toBe(true);
      const to = padFighterNames(child.fleet.designs['Shipyard']!)[0]!;
      expect(child.fleet.designs[to]?.fighter).not.toBe(true);
      seen.add(to === BARE_CORE.name ? 'other' : to.startsWith('Scavenger') ? 'copy' : to.startsWith('Ship') ? 'new' : to);
    }
    expect([...seen].sort()).toEqual(['copy', 'new', 'other']);
  });

  it('leaves a fleet with no pad as it would have bred it', () => {
    const fleet: Fleet = { name: 'F', designs: { Dinky: DINKY }, ships: [{ design: 'Dinky', x: 0, y: 0 }] };
    const plain = mutateFleet(fleet, new Rng(3));
    const without = mutateFleet(fleet, new Rng(3), { operators: { add: 1, remove: 1, fork: 0.5, merge: 0.5, swap: 0.5, pad: 0 } });
    expect(JSON.stringify(plain)).toEqual(JSON.stringify(without));
  });
});
