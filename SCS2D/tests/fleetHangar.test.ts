import { describe, expect, it } from 'vitest';
import {
  compileBlueprint,
  fleetBlueprint,
  hangarClashes,
  joinHangars,
  parseFleet,
  serialiseFleet,
  type Blueprint,
  type Fleet,
} from '../sim/index.js';
import { DINKY } from '../scenarios/blueprints.js';
import { FACTORY } from '../scenarios/carrier.js';
import { addShip, deleteEntries, emptyFleet, replaceDesign } from '../editor/fleetEdit.js';
import { fleetBattle } from '../scenarios/fleetBattle.js';

/** A carrier's fighters in a fleet: the fleet's designs, the hangar the portable copy. */

const PAD = 2;

/** A Factory that sets out with its Dinky docked, and keeps it. */
const LADEN: Blueprint = {
  ...FACTORY,
  name: 'Laden',
  modules: FACTORY.modules.map((m, i) => (i === PAD ? { ...m, docked: true, keep: 1 } : m)),
};

/** A Dinky that goes for fuel sooner, to tell it from the stock one. */
const base = compileBlueprint(DINKY).doctrine;
const CLIPPED: Blueprint = { ...DINKY, doctrine: { ...base, approach: { ...base.approach, refuelBelow: 0.9 } } };

describe('a carrier joining a fleet', () => {
  it('gives its hangar up: a fighter the fleet lacks is lifted into it', () => {
    const fleet = addShip(emptyFleet('F'), LADEN, 0, 0);
    expect(Object.keys(fleet.designs).sort()).toEqual(['Dinky', 'Laden']);
    expect(fleet.designs['Laden']!.hangar).toBeUndefined();
    expect(hangarClashes(fleet)).toEqual([]);
  });

  it('drops a copy the fleet already has the same, and keeps one it has differently as a clash', () => {
    const same = addShip(addShip(emptyFleet('F'), DINKY, 50, 0), LADEN, 0, 0);
    expect(same.designs['Laden']!.hangar).toBeUndefined();
    const differ = addShip(addShip(emptyFleet('F'), CLIPPED, 50, 0), LADEN, 0, 0);
    expect(Object.keys(differ.designs['Laden']!.hangar ?? {})).toEqual(['Dinky']);
    expect(hangarClashes(differ)).toEqual(["Laden carries a Dinky that is not the fleet's Dinky"]);
  });

  it('does so as a file is read, too', () => {
    const fleet: Fleet = { name: 'F', designs: { Laden: LADEN }, ships: [{ design: 'Laden', x: 0, y: 0 }] };
    const read = parseFleet(serialiseFleet(fleet));
    expect(Object.keys(read.designs).sort()).toEqual(['Dinky', 'Laden']);
    expect(read.designs['Laden']!.hangar).toBeUndefined();
  });
});

describe('a pad in a fleet', () => {
  it('flies the fleet’s design of the fighter it names', () => {
    let fleet = addShip(emptyFleet('F'), LADEN, 0, 0);
    fleet = { ...fleet, designs: { ...fleet.designs, Dinky: CLIPPED } };
    const carrier = compileBlueprint(fleetBlueprint(fleet, 'Laden'));
    expect(carrier.aboard?.[0]?.design.doctrine.approach.refuelBelow).toBe(0.9);
    expect(carrier.builds?.[0]?.design.doctrine.approach.refuelBelow).toBe(0.9);
    // And so in a battle: the one it sets out with is the fleet's.
    const run = fleetBattle([fleet, { name: 'G', designs: { Dinky: DINKY }, ships: [{ design: 'Dinky', x: 0, y: 0 }] }], {
      seed: 1,
      range: 3000,
    });
    const doctrines = (run.ships as unknown as { doctrines: { approach: { refuelBelow: number } }[] }).doctrines;
    expect(doctrines[run.slots[0]![0]! + 1]!.approach.refuelBelow).toBe(0.9);
  });

  it('keeps a fighter only a pad names, and follows it when it is renamed', () => {
    let fleet = addShip(addShip(emptyFleet('F'), LADEN, 0, 0), DINKY, 50, 0);
    // The free Dinky gone: the carrier's pad still keeps the design.
    fleet = deleteEntries(fleet, [[1]]);
    expect(Object.keys(fleet.designs).sort()).toEqual(['Dinky', 'Laden']);
    fleet = replaceDesign(fleet, 'Dinky', { ...DINKY, name: 'Gnat' });
    expect(Object.keys(fleet.designs).sort()).toEqual(['Gnat', 'Laden']);
    expect(fleet.designs['Laden']!.modules[PAD]).toMatchObject({ fighter: 'Gnat' });
    expect(compileBlueprint(fleetBlueprint(fleet, 'Laden')).builds?.length).toBe(1);
  });

  it('comes back from the ship editor as itself, the fighter it carried there the fleet’s', () => {
    const fleet = addShip(emptyFleet('F'), LADEN, 0, 0);
    // What the ship editor opens, and hands back unchanged.
    const opened = fleetBlueprint(fleet, 'Laden');
    expect(Object.keys(opened.hangar ?? {})).toEqual(['Dinky']);
    const back = replaceDesign(fleet, 'Laden', opened);
    expect(back.designs['Laden']!.hangar).toBeUndefined();
    expect(hangarClashes(back)).toEqual([]);
  });

  it('is left alone where there is nothing to join', () => {
    const fleet: Fleet = { name: 'F', designs: { Dinky: DINKY }, ships: [{ design: 'Dinky', x: 0, y: 0 }] };
    expect(joinHangars(fleet)).toBe(fleet);
  });
});
