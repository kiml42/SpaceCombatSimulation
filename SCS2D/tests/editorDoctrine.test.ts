import { describe, expect, it } from 'vitest';
import {
  compileBlueprint,
  DEFAULT_DOCTRINE,
  defaultTargeting,
  serialiseBlueprint,
  APPROACH_FIELDS,
  holdBand,
  MOUNT_TARGETING_FIELDS,
  SHIP_TARGETING_FIELDS,
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
  MOUNT_SECTIONS,
  sectionEntries,
  SHIP_SECTIONS,
  type DoctrineContext,
  type DoctrineEntry,
  type DoctrineValues,
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
  const fields = (entries: readonly DoctrineEntry[]): string[] => entries.map((e) => `${e.half}.${e.field}`).sort();

  it('asks a weapon every field a gun reads, once each', () => {
    // A mount steers nothing, so the urge to stay with a consort is not its
    // business — offering it would be the panel inviting a number that
    // changes nothing about the ship.
    expect(fields(sectionEntries(MOUNT_SECTIONS))).toEqual(MOUNT_TARGETING_FIELDS.map((f) => `mount.${f}`).sort());
  });

  it('asks a ship every field a hull reads, once each, and nothing about where a shot lands', () => {
    expect(fields(sectionEntries(SHIP_SECTIONS))).toEqual(
      [...SHIP_TARGETING_FIELDS.map((f) => `targeting.${f}`), ...APPROACH_FIELDS.map((f) => `approach.${f}`)].sort(),
    );
    // A ship chooses a ship; only a mount chooses a part of one, and only a
    // mount is drawn to what its ship is fighting.
    const offered = sectionEntries(SHIP_SECTIONS).map((e) => e.field);
    for (const field of ['coreWeight', 'engineWeight', 'gunWeight', 'structureWeight', 'focusWeight', 'fireRange']) {
      expect(offered).not.toContain(field);
    }
  });

  it('keeps what goes together together: escorting and ramming have sections of their own', () => {
    const section = (title: string) => SHIP_SECTIONS.find((s) => s.title === title)!;
    expect(sectionEntries([section('Escorting')]).map((e) => e.field)).toEqual([
      'escortWeight',
      'escortMinRadii',
      'escortRadii',
      'escort',
    ]);
    expect(sectionEntries([section('Ramming')]).map((e) => e.field)).toEqual(['ramRadii', 'ramArmed']);
  });

  it('gives every offered number a label and a step', () => {
    for (const row of [...sectionEntries(MOUNT_SECTIONS), ...sectionEntries(SHIP_SECTIONS)]) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.hint.length).toBeGreaterThan(0);
      expect(row.step).toBeGreaterThan(0);
    }
  });
});

describe('what the panel shows of a ship’s doctrine', () => {
  const ship: DoctrineContext = {
    mass: 200_000,
    radius: 30,
    reach: 2000,
    accelFore: 4,
    accelAft: 2,
    brakeHolding: 2,
    brakeTurned: 5,
    guns: 4,
  };
  const values = (approach: Partial<Doctrine['approach']>, targeting: Partial<Doctrine['targeting']> = {}): DoctrineValues => ({
    targeting: { ...DEFAULT_DOCTRINE.targeting, ...targeting },
    approach: { ...DEFAULT_DOCTRINE.approach, ...approach },
  });
  const row = (field: string): DoctrineEntry => sectionEntries(SHIP_SECTIONS).find((e) => e.field === field)!;
  const shown = (field: string, v: DoctrineValues): boolean => row(field).shown?.(v) ?? true;

  it('hides what a setting above it has made mean nothing', () => {
    // Not escorting at all: how close, how far and who to escort are moot.
    for (const field of ['escortMinRadii', 'escortRadii', 'escort']) {
      expect(shown(field, values({}, { escortWeight: 0 }))).toBe(false);
      expect(shown(field, values({}, { escortWeight: 50 }))).toBe(true);
    }
    expect(shown('ramArmed', values({ ramRadii: 0 }))).toBe(false);
    expect(shown('ramArmed', values({ ramRadii: 2 }))).toBe(true);
    expect(shown('separationRadii', values({ separation: 0 }))).toBe(false);
    expect(shown('preferredMass', values({}, { massWeight: 0 }))).toBe(false);
    expect(shown('escortWeight', values({}, { escortWeight: 0 }))).toBe(true);
  });

  it('says what a relative number comes to for this ship', () => {
    const v = values({ standoff: 0.5, escortMinRadii: 1, ramRadii: 2, ramArmed: 0.5 }, { preferredMass: 4 });
    const said = (field: string): string => row(field).absolute!(v, ship)!;
    expect(said('standoff')).toBe('no further than 1,000 m');
    expect(said('preferredMass')).toBe('≈ 800 t');
    // The enemy it wants is four times its mass, so twice its radius.
    expect(said('standoffRadii')).toBe(`${(DEFAULT_DOCTRINE.approach.standoffRadii * 60).toLocaleString('en-GB')} m off the skin of the size it wants`);
    const band = holdBand(v.approach, ship.reach, 60);
    expect(said('tolerance')).toBe(`holds ${Math.round(band.min).toLocaleString('en-GB')} m–${Math.round(band.max).toLocaleString('en-GB')} m, centre to centre`);
    expect(said('escortMinRadii')).toBe('covers friends of 30 m radius or more');
    expect(said('ramRadii')).toBe('within 120 m of the skin of the size it wants');
    expect(said('ramArmed')).toBe('with 2 of 4 guns working, or fewer');
    expect(said('accelerate')).toBe(`≈ ${(DEFAULT_DOCTRINE.approach.accelerate * 4).toFixed(2)} m/s² ahead`);
  });

  it('says how hard it brakes both ways when it turns to burn, and one way when it does not', () => {
    const brake = (approach: Partial<Doctrine['approach']>): string => row('brake').absolute!(values(approach), ship)!;
    expect(brake({ brake: 0.5, burnWeight: 2 })).toBe('≈ 1.00 m/s² with its guns on, ≈ 2.50 turned onto its mains');
    expect(brake({ brake: 0.5, burnWeight: 0 })).toBe('≈ 1.00 m/s² with its guns on');
  });

  it('says how far a gun fires', () => {
    const fire = sectionEntries(MOUNT_SECTIONS).find((e) => e.field === 'fireRange')!;
    expect(fire.absolute!(values({}), { ...ship, fireRange: 1234 })).toBe('fires within 1,234 m of the size it wants');
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
    // The preference for engines is the gun's, not the ship's: §3's mission
    // kill, since a fighter that cannot destroy a capital can still strand one.
    expect((DINKY.doctrine ?? DEFAULT_DOCTRINE).targeting.engineWeight).toBe(
      DEFAULT_DOCTRINE.targeting.engineWeight,
    );
    const design = compileBlueprint(DINKY);
    expect(design.turrets[0]!.targeting.engineWeight).toBeGreaterThan(
      defaultTargeting('hullGun').engineWeight,
    );
    expect(design.turrets[0]!.targeting.engineWeight).toBeGreaterThan(
      design.turrets[0]!.targeting.gunWeight,
    );
  });
});
