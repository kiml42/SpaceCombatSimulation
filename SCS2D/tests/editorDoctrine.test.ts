import { describe, expect, it } from 'vitest';
import {
  compileBlueprint,
  DEFAULT_DOCTRINE,
  defaultTargeting,
  serialiseBlueprint,
  TARGETING_FIELDS,
  type Doctrine,
} from '../sim/index.js';
import { DINKY } from '../scenarios/blueprints.js';
import {
  kindName,
  mountChanges,
  mountDefault,
  mountSummary,
  shipChanges,
  shipSummary,
  withMountField,
  withShipField,
  MOUNT_ROWS,
  SHIP_APPROACH_ROWS,
  SHIP_TARGETING_ROWS,
} from '../editor/doctrine.js';

/**
 * Doctrine as the editor offers it.
 *
 * The property worth testing is not that a number can be typed — it is that
 * *not* typing one leaves the blueprint saying nothing, since that is what
 * lets the whole feature be ignored. So most of what follows is about what
 * comes back out of an edit rather than what goes into it.
 */

describe('which numbers the panel offers', () => {
  it('asks a weapon everything but the one field a gun cannot use', () => {
    const offered = MOUNT_ROWS.map((row) => row.field);
    expect(offered).toEqual(TARGETING_FIELDS.filter((field) => field !== 'escortWeight'));
    // A mount steers nothing, so the urge to stay with a consort is not its
    // business — offering it would be the panel inviting a number that
    // changes nothing about the ship.
    expect(offered).not.toContain('escortWeight');
  });

  it('asks a ship nothing about where a shot lands', () => {
    const offered = SHIP_TARGETING_ROWS.map((row) => row.field);
    // A ship chooses a ship; only a mount chooses a part of one. These four
    // are read from a mount's doctrine and from nowhere else, so a hull that
    // set them would be writing a number nothing reads.
    for (const aim of ['coreWeight', 'engineWeight', 'gunWeight', 'structureWeight']) {
      expect(offered).not.toContain(aim);
    }
    expect(offered).toContain('escortWeight');
    expect(SHIP_APPROACH_ROWS.length).toBeGreaterThan(0);
  });

  it('gives every offered number a label and a step', () => {
    for (const row of [...MOUNT_ROWS, ...SHIP_TARGETING_ROWS, ...SHIP_APPROACH_ROWS]) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.hint.length).toBeGreaterThan(0);
      expect(row.step).toBeGreaterThan(0);
    }
  });
});

describe('what a box shows when it is empty', () => {
  it('is the archetype, which differs by archetype', () => {
    expect(mountDefault('hullGun', 'focusWeight')).toBe(
      defaultTargeting('hullGun').focusWeight,
    );
    // The point of the table: a hull gun is aimed by its ship and a beam
    // turret is not, so the two do not start from the same place.
    expect(mountDefault('hullGun', 'focusWeight')).toBeGreaterThan(
      mountDefault('beamTurret', 'focusWeight'),
    );
    expect(mountDefault('beamTurret', 'preferredMass')).toBeLessThan(
      mountDefault('turret', 'preferredMass'),
    );
  });
});

describe('stating a number and taking it back', () => {
  it('leaves nothing behind when the last statement goes', () => {
    const one = withMountField(undefined, 'focusWeight', 0);
    expect(one).toEqual({ focusWeight: 0 });
    const two = withMountField(one, 'preferredMass', 0.5);
    expect(withMountField(two, 'focusWeight', null)).toEqual({ preferredMass: 0.5 });
    // Emptying the last box gives no block at all rather than an empty one,
    // so a mount set back to its archetype reads like one that never had an
    // opinion — and a file written from it carries no `targeting` key.
    expect(withMountField(one, 'focusWeight', null)).toBeUndefined();
  });

  it('drops a ship doctrine that has become the default exactly', () => {
    const held = withShipField(undefined, 'approach', 'standoff', 0.9);
    expect(held?.approach.standoff).toBe(0.9);
    // Everything it did not say is still the default, so the one statement is
    // the whole of what the ship is claiming.
    expect(held?.targeting).toEqual(DEFAULT_DOCTRINE.targeting);
    expect(withShipField(held, 'approach', 'standoff', null)).toBeUndefined();
  });

  it('writes only what was stated into the file', () => {
    const doctrine = withShipField(undefined, 'targeting', 'preferredMass', 4) as Doctrine;
    const file = serialiseBlueprint({ ...DINKY, doctrine });
    expect(file['doctrine']).toEqual({ targeting: { preferredMass: 4 } });
  });
});

describe('the line the section shows while it is shut', () => {
  it('says the archetype when nothing has been touched', () => {
    expect(mountSummary('hullGun', undefined)).toBe('hull gun default');
    expect(mountSummary('beamTurret', undefined)).toBe('beam turret default');
    expect(shipSummary(undefined)).toBe('default');
    expect(kindName('hullBeam')).toBe('hull beam');
  });

  it('counts only what actually differs from the archetype', () => {
    // A box typed back to what the archetype already does is not a change,
    // however it got there — otherwise the summary would claim an edit that
    // the simulation cannot see.
    const same = { focusWeight: defaultTargeting('turret').focusWeight };
    expect(mountChanges('turret', same)).toBe(0);
    expect(mountSummary('turret', same)).toBe('turret default');
    expect(mountSummary('turret', { focusWeight: 0 })).toBe('turret, 1 change');
    expect(mountSummary('turret', { focusWeight: 0, preferredMass: 9 })).toBe('turret, 2 changes');
  });

  it('ignores a ship field no ship reads', () => {
    // The same block on a mount is one change and on a hull is none, because
    // a hull's aim weight is read by nothing.
    const aiming = withShipField(undefined, 'targeting', 'engineWeight', 150);
    expect(shipChanges(aiming)).toBe(0);
    expect(mountChanges('hullGun', { engineWeight: 150 })).toBe(1);
  });
});

describe('what the shipped fleet says now', () => {
  it('keeps the Dinky shooting at engines, from its gun rather than its hull', () => {
    // The ship says nothing and its gun says one thing, which is the whole of
    // §3's mission kill: a fighter that cannot destroy a capital can still
    // strand one.
    expect(DINKY.doctrine).toBeUndefined();
    const design = compileBlueprint(DINKY);
    expect(design.turrets[0]!.targeting.engineWeight).toBeGreaterThan(
      design.turrets[0]!.targeting.gunWeight,
    );
  });
});
