import { describe, expect, it } from 'vitest';
import {
  BARREL_CALIBRES,
  BASE_WALL_THICKNESS,
  BEAM_APERTURE_FRACTION,
  BEAM_DUTY_CYCLE,
  BEAM_EMITTER_APERTURES,
  BEAM_MASS_PER_WATT,
  BEAM_STORED_ENERGY_PER_VOLUME,
  CALIBRE_FRACTION,
  CORE_MASS_PER_AREA,
  CORE_MINIMUM_FITTING_MASS,
  DECK_HEIGHT,
  gunStats,
  beamGunStats,
  GunType,
  HULL_DENSITY,
  OPTIC_AREAL_DENSITY,
  OPTIC_INTENSITY_LIMIT,
  MECHANISM_MASS_PER_CALIBRE,
  moduleProblem,
  moduleStats,
  traverseAccel,
  traverseRate,
  TRAVERSE_SPINUP_TIME,
  type ModuleSpec,
} from '../sim/modules.js';

/**
 * The scaling laws are the game's balance, so what is worth testing is their
 * *shape* — which way each figure moves when a module is made bigger, and
 * where the counter-pressures are — rather than the constants, which are
 * expected to move.
 *
 * The exception is mass, which is checked against the geometry it claims to
 * come from: if wall volume is wrong then every ship's mass, inertia and
 * toughness are wrong together, and nothing downstream would look obviously
 * broken.
 */

function box(kind: ModuleSpec['kind'], length: number, width: number, reinforcement?: number): ModuleSpec {
  const spec: ModuleSpec = { kind, x: 0, y: 0, length, width };
  if (reinforcement !== undefined) spec.reinforcement = reinforcement;
  return spec;
}

describe('module geometry', () => {
  it('takes its structure mass from the volume of its walls', () => {
    const length = 10;
    const width = 4;
    const t = BASE_WALL_THICKNESS;
    const stats = moduleStats(box('structure', length, width));

    const outer = length * width * DECK_HEIGHT;
    const inner = (length - 2 * t) * (width - 2 * t) * (DECK_HEIGHT - 2 * t);

    expect(stats.wallVolume).toBeCloseTo(outer - inner, 10);
    expect(stats.structureMass).toBeCloseTo((outer - inner) * HULL_DENSITY, 6);
    expect(stats.mass).toBe(stats.structureMass);
  });

  it('leaves the interior area as capacity', () => {
    const stats = moduleStats(box('structure', 10, 4));
    const t = BASE_WALL_THICKNESS;
    expect(stats.capacity).toBeCloseTo((10 - 2 * t) * (4 - 2 * t), 10);
  });

  it('makes a bigger module proportionally lighter for the space it encloses', () => {
    // The degenerate optimum to watch for (DESIGN.md §4): capacity grows faster
    // than the wall that encloses it, so scale is rewarded and something else
    // has to push back.
    const small = moduleStats(box('structure', 5, 5));
    const large = moduleStats(box('structure', 10, 10));
    expect(large.capacity / small.capacity).toBeGreaterThan(large.mass / small.mass);
  });

  it('punishes a long thin module against a square one of the same area', () => {
    // One of the counter-pressures: perimeter, and therefore wall, grows as a
    // module is stretched, so splinters are not free.
    const square = moduleStats(box('structure', 8, 8));
    const sliver = moduleStats(box('structure', 32, 2));
    expect(sliver.capacity).toBeLessThan(square.capacity);
    expect(sliver.mass).toBeGreaterThan(square.mass);
  });

  it('buys thickness and toughness with reinforcement, and pays in mass', () => {
    const plain = moduleStats(box('structure', 10, 4));
    const armoured = moduleStats(box('structure', 10, 4, 4));

    expect(armoured.wallThickness).toBeCloseTo(4 * plain.wallThickness, 12);
    expect(armoured.hitPoints).toBeGreaterThan(plain.hitPoints);
    expect(armoured.mass).toBeGreaterThan(plain.mass);
    expect(armoured.capacity).toBeLessThan(plain.capacity);
  });

  it('rejects a module whose walls would meet in the middle', () => {
    expect(moduleProblem(box('structure', 10, 4, 200))).toMatch(/no interior/);
    expect(() => moduleStats(box('structure', 10, 4, 200))).toThrow(/no interior/);
  });

  it('rejects nonsensical dimensions and reinforcement', () => {
    expect(moduleProblem(box('structure', 0, 4))).toMatch(/positive/);
    expect(moduleProblem(box('structure', 10, -1))).toMatch(/positive/);
    expect(moduleProblem(box('structure', 10, 4, 0.5))).toMatch(/at least 1/);
    expect(moduleProblem(box('structure', 10, 4))).toBeNull();
  });
});

describe('thruster scaling', () => {
  it('takes thrust from the exit area, so width is what buys it', () => {
    const narrow = moduleStats(box('thruster', 6, 2));
    const wide = moduleStats(box('thruster', 6, 4));
    const long = moduleStats(box('thruster', 12, 2));

    expect(wide.thrust).toBeCloseTo(2 * narrow.thrust, 6);
    expect(long.thrust).toBeCloseTo(narrow.thrust, 6);
  });

  it('charges machinery mass for the thrust it produces', () => {
    const narrow = moduleStats(box('thruster', 6, 2));
    expect(narrow.fittingMass).toBeGreaterThan(0);
    expect(narrow.mass).toBeGreaterThan(narrow.structureMass);
  });

  it('gives a structure module no thrust and no gun', () => {
    const stats = moduleStats(box('structure', 6, 2));
    expect(stats.thrust).toBe(0);
    expect(stats.gun).toBeNull();
    expect(stats.fittingMass).toBe(0);
  });
});

describe('core scaling', () => {
  it('charges its machinery by the floor it fills', () => {
    // Control machinery fills the compartment rather than lining its walls,
    // so twice the floor is twice the equipment.
    const small = moduleStats(box('core', 4, 4));
    const large = moduleStats(box('core', 8, 4));
    expect(small.fittingMass).toBeCloseTo(CORE_MASS_PER_AREA * small.capacity, 6);
    expect(large.fittingMass).toBeCloseTo(CORE_MASS_PER_AREA * large.capacity, 6);
    expect(large.fittingMass).toBeGreaterThan(small.fittingMass * 1.9);
  });

  it('costs more than the same box of structure, and buys nothing else', () => {
    // What stops a ship carrying five of them is that each one is dead mass:
    // no thrust, no gun, and heavier than the hull it replaces.
    const hull = moduleStats(box('structure', 4, 4));
    const flown = moduleStats(box('core', 4, 4));
    expect(flown.mass).toBeGreaterThan(hull.mass);
    expect(flown.structureMass).toBeCloseTo(hull.structureMass, 9);
    expect(flown.thrust).toBe(0);
    expect(flown.gun).toBeNull();
  });

  it('cannot be shrunk to nothing: half a metre square is a working core', () => {
    // Every ship here is computer-flown, so the floor is a processor, its
    // power supply and an aerial — low enough that a fighter can carry one.
    const tiny = moduleStats(box('core', 0.2, 0.2));
    expect(tiny.fittingMass).toBe(CORE_MINIMUM_FITTING_MASS);
    // And it binds only below that: half a metre square is past it.
    const half = moduleStats(box('core', 0.5, 0.5));
    expect(half.fittingMass).toBeGreaterThan(CORE_MINIMUM_FITTING_MASS);
  });
});

describe('gun scaling', () => {
  it('takes its bore from the mount width and its barrel from the bore', () => {
    const gun = gunStats(40, 8);
    expect(gun.calibre).toBeCloseTo(8 * CALIBRE_FRACTION, 12);
    expect(gun.barrelLength).toBeCloseTo(gun.calibre * BARREL_CALIBRES, 12);
  });

  it('will not fit a barrel longer than the mount that carries it', () => {
    const cramped = gunStats(6, 8);
    expect(cramped.barrelLength).toBe(6);
    expect(cramped.barrelLength).toBeLessThan(cramped.calibre * BARREL_CALIBRES);
  });

  it('holds muzzle velocity roughly constant once the barrel fits', () => {
    // Charge energy scales with bore volume and shell mass with the cube of
    // calibre, so a gun of any size built to the same calibre ratio arrives at
    // the same muzzle velocity — which is what real naval guns do, and it is
    // the reason a bigger gun is bought for weight of shell rather than speed.
    const small = gunStats(100, 4);
    const large = gunStats(100, 16);
    expect(large.muzzleSpeed).toBeCloseTo(small.muzzleSpeed, 6);
    expect(large.roundMass / small.roundMass).toBeCloseTo(64, 6);
  });

  it('trades rate of fire and handiness for weight of shell', () => {
    const light = gunStats(100, 4);
    const heavy = gunStats(100, 16);
    expect(heavy.muzzleEnergy).toBeGreaterThan(light.muzzleEnergy);
    expect(heavy.cycleTime).toBeGreaterThan(light.cycleTime);
  });

  it('more barrels fire quicker but are smaller', () => {
    const single = gunStats(100, 4, 1);
    const barrelCount = 8;
    const multi = gunStats(100, 4, barrelCount);
    expect(multi.calibre).toBeLessThan(single.calibre);
    expect(multi.cycleTime).toBeLessThan(single.cycleTime);
    expect(multi.cycleTime).toBeCloseTo(single.cycleTime / (barrelCount * barrelCount), 6);
    expect(multi.barrelLength).toBeLessThan(single.barrelLength);
    expect(multi.roundMass).toBeLessThan(single.roundMass);
    expect(multi.muzzleSpeed).toBeGreaterThan(single.muzzleSpeed);
    expect(multi.muzzleEnergy).toBeLessThan(single.muzzleEnergy);
    expect(single.barrelSpacing).toBe(0);
    expect(multi.barrelSpacing).toBeGreaterThan(0);
  });

  it('spreads the barrels right across the mount face, with a gap at each end', () => {
    // n barrels make n + 1 equal gaps, so the outermost barrel sits one whole
    // gap in from the edge and the row is as wide as the mount can make it.
    for (const n of [2, 3, 8, 17]) {
      const gun = gunStats(12, 8, n);
      const span = (n - 1) * gun.barrelSpacing;
      const margin = (8 - span) / 2;
      expect(margin).toBeCloseTo(gun.barrelSpacing, 12);
      expect(span).toBeLessThan(8);
    }
  });

  it('cannot overhang the mount, however many barrels are asked for', () => {
    // The whole point of deriving the spacing from the face rather than from
    // the calibre: the row spans (n-1)/(n+1) of the face, which is under one
    // for every n, so no barrel count can push a barrel past the edge.
    for (const n of [2, 8, 50, 1000]) {
      const gun = gunStats(12, 8, n);
      const outerEdge = ((n - 1) * gun.barrelSpacing) / 2 + gun.calibre / 2;
      expect(outerEdge).toBeLessThan(8 / 2);
    }
  });

  it('measures the face across the smaller dimension, because a turret traverses', () => {
    // A mount wider than it is long presents its length to the row once it has
    // traversed ninety degrees, so the lesser of the two is what the row has to
    // fit inside.
    const wide = gunStats(3, 10, 8);
    expect((wide.barrelCount - 1) * wide.barrelSpacing).toBeLessThan(3);
    // Square-on mounts are unaffected: every turret in the scenarios is longer
    // than it is wide, so this is a guard and not a change to them.
    const normal = gunStats(12, 8, 8);
    expect(normal.barrelSpacing).toBeCloseTo(8 / 9, 12);
  });

  it('leaves a single barrel unspaced', () => {
    // There is nothing to be spaced from, and reporting half a mount face as
    // the gap would be a lie the renderer could act on.
    expect(gunStats(12, 8, 1).barrelSpacing).toBe(0);
  });

  it('buys velocity with barrel length when the mount is what limits it', () => {
    const stubby = gunStats(4, 8);
    const long = gunStats(12, 8);
    expect(long.muzzleSpeed).toBeGreaterThan(stubby.muzzleSpeed);
    expect(long.roundMass).toBeCloseTo(stubby.roundMass, 12);
  });

  it('carries loading machinery for every barrel, sized by the round it moves', () => {
    const light = moduleStats(box('turret', 12, 4));
    const heavy = moduleStats(box('turret', 12, 16));
    const barrelSteel = (s: ReturnType<typeof moduleStats>) =>
      s.fittingMass - MECHANISM_MASS_PER_CALIBRE * s.gun!.calibre * s.gun!.barrelCount;

    expect(barrelSteel(light)).toBeGreaterThan(0);
    expect(barrelSteel(heavy)).toBeGreaterThan(0);
    // Linear in calibre, so a mount of four times the bore carries four times
    // the machinery — where its barrel steel, being a volume, is up sixty-four
    // fold. Machinery is what a light mount's mass is mostly made of.
    expect(heavy.fittingMass - barrelSteel(heavy)).toBeCloseTo(
      4 * (light.fittingMass - barrelSteel(light)),
      6,
    );
    expect(barrelSteel(light)).toBeLessThan(light.fittingMass - barrelSteel(light));
  });

  it('sizes the loading machinery by the mount bore budget, not the barrel count', () => {
    // The consequence of a law linear in calibre, and exact rather than
    // approximate: splitting the bore across n barrels divides the calibre by
    // n, so n mechanisms come to the same total. It puts a floor under a
    // multi-barrel mount without making barrels cost anything — ROADMAP.md §12
    // records that as an open balance question, so pin it rather than let it
    // drift unnoticed.
    const mechanism = (barrels: number) => {
      const gun = gunStats(12, 8, barrels);
      return MECHANISM_MASS_PER_CALIBRE * gun.calibre * gun.barrelCount;
    };
    expect(mechanism(8)).toBeCloseTo(mechanism(1), 6);
    expect(mechanism(1)).toBeCloseTo(MECHANISM_MASS_PER_CALIBRE * 8 * CALIBRE_FRACTION, 6);

    // And the whole mount is still lighter for having more barrels, because
    // the tubes' steel falls away and nothing yet pushes back.
    const single = moduleStats({ kind: 'turret', x: 0, y: 0, length: 12, width: 8, barrels: 1 });
    const multi = moduleStats({ kind: 'turret', x: 0, y: 0, length: 12, width: 8, barrels: 8 });
    expect(multi.mass).toBeLessThan(single.mass);
    expect(multi.fittingMass).toBeGreaterThan(mechanism(8));
  });

  it('rejects a barrel count that is not a whole number of barrels', () => {
    const turret = (barrels: number): ModuleSpec => ({ kind: 'turret', x: 0, y: 0, length: 12, width: 8, barrels });
    expect(moduleProblem(turret(0))).toMatch(/whole number/);
    expect(moduleProblem(turret(-2))).toMatch(/whole number/);
    expect(moduleProblem(turret(2.5))).toMatch(/whole number/);
    expect(moduleProblem(turret(3))).toBeNull();
  });

  it('carries the mass of the barrel on the mount', () => {
    const stats = moduleStats(box('turret', 12, 8));
    expect(stats.gun).not.toBeNull();
    expect(stats.fittingMass).toBeGreaterThan(0);
    expect(stats.mass).toBeGreaterThan(stats.structureMass);
  });
});

describe('beam mount scaling', () => {
  /**
   * A laser is not a gun with the shell removed. What it has instead is an
   * aperture, a power limit set by that aperture, and a bank of stored energy
   * that decides how long it can hold the trigger down — so these check a
   * different set of things from the projectile laws above, and deliberately
   * do not check the ones that no longer mean anything.
   */

  it('takes its aperture from the mount face, and its housing from the aperture', () => {
    const gun = beamGunStats(40, 8);
    expect(gun.calibre).toBeCloseTo(8 * BEAM_APERTURE_FRACTION, 12);
    // No barrel: a housing as deep as the optic is wide, rather than fifty
    // times. This is most of why a beam mount trains faster than a gun.
    expect(gun.barrelLength).toBeCloseTo(gun.calibre * BEAM_EMITTER_APERTURES, 12);
    expect(gun.barrelLength).toBeLessThan(gun.calibre * 2);
  });

  it('measures the aperture across the smaller face, because a turret traverses', () => {
    // A single disc has to fit the inscribed circle, the same argument that
    // sizes a gun's row of barrels.
    expect(beamGunStats(3, 10).calibre).toBeCloseTo(3 * BEAM_APERTURE_FRACTION, 12);
    expect(beamGunStats(10, 3).calibre).toBeCloseTo(3 * BEAM_APERTURE_FRACTION, 12);
  });

  it('never claims to fire a round', () => {
    const gun = beamGunStats(100, 4);
    expect(gun.type).toBe(GunType.Beam);
    expect(gun.roundMass).toBe(0);
    expect(gun.muzzleEnergy).toBe(0);
    // Negative muzzle speed is how a weapon says it arrives the instant it is
    // fired; `aimAt` reads it to know there is no lead to solve.
    expect(gun.muzzleSpeed).toBe(-1);
  });

  it('limits its power by what the optic can pass, so power goes as the area', () => {
    const gun = beamGunStats(40, 8);
    const area = Math.PI * 0.25 * gun.calibre * gun.calibre;
    expect(gun.beamPower).toBeCloseTo(OPTIC_INTENSITY_LIMIT * area, 6);
    // Twice the face is twice the aperture and therefore four times the power.
    expect(beamGunStats(40, 16).beamPower).toBeCloseTo(4 * gun.beamPower, 6);
  });

  it('holds the beam on for as long as the bank lasts', () => {
    const gun = beamGunStats(12, 6);
    const stored = BEAM_STORED_ENERGY_PER_VOLUME * 12 * 6 * DECK_HEIGHT;
    expect(gun.beamOnTime).toBeCloseTo(stored / gun.beamPower, 6);
    expect(gun.cycleTime).toBeCloseTo(gun.beamOnTime / BEAM_DUTY_CYCLE, 6);
  });

  it('buys power with the smaller face and endurance with the larger', () => {
    // The trade that makes a beam mount want a different shape from a gun,
    // where width buys weight of shell and length buys muzzle velocity. The
    // optic is sized by whichever dimension is smaller, so it is that one that
    // sets power, and the other only adds volume for the bank.
    const square = beamGunStats(6, 6);
    const stretched = beamGunStats(18, 6);
    const thickened = beamGunStats(18, 18);

    // Stretching the mount adds bank without touching the optic.
    expect(stretched.beamPower).toBe(square.beamPower);
    expect(stretched.beamOnTime).toBeCloseTo(3 * square.beamOnTime, 6);

    // Growing the smaller face adds optic, and the extra volume cannot keep
    // pace: power is up ninefold against three times the bank, so a third of
    // the dwell. A mount can be strong or persistent, not both.
    expect(thickened.beamPower).toBeCloseTo(9 * stretched.beamPower, 6);
    expect(thickened.beamOnTime).toBeCloseTo(stretched.beamOnTime / 3, 6);
  });

  it('makes dwell an aspect ratio rather than a size', () => {
    // So a mount cannot buy endurance by being huge — doubling both dimensions
    // doubles the optic's diameter, quadrupling power, against four times the
    // bank. Without this, the largest mount would simply be the best one.
    const small = beamGunStats(8, 4);
    const doubled = beamGunStats(16, 8);
    expect(doubled.beamOnTime).toBeCloseTo(small.beamOnTime, 9);
    expect(doubled.beamPower).toBeCloseTo(4 * small.beamPower, 6);
  });

  it('divides the optic between emitters rather than multiplying it', () => {
    // `n` emitters split the optic's *area*, so the mount's total output is
    // unchanged however it is divided — the same budget rule a gun's bore
    // follows. What splitting costs is focus, which nothing consumes yet.
    const single = beamGunStats(40, 8, 1);
    const n = 4;
    const multi = beamGunStats(40, 8, n);

    expect(multi.calibre).toBeCloseTo(single.calibre / Math.sqrt(n), 12);
    expect(multi.beamPower).toBeCloseTo(single.beamPower / n, 6);
    expect(n * multi.beamPower).toBeCloseTo(single.beamPower, 6);
    // Each sub-beam spreads faster, by the ratio of the apertures.
    expect(multi.calibre).toBeLessThan(single.calibre);
  });

  it('spreads the emitters right across the mount face, with a gap at each end', () => {
    for (const n of [2, 3, 8, 17]) {
      const gun = beamGunStats(12, 8, n);
      const span = (n - 1) * gun.barrelSpacing;
      const margin = (8 - span) / 2;
      expect(margin).toBeCloseTo(gun.barrelSpacing, 12);
      expect(span).toBeLessThan(8);
    }
  });

  it('leaves a single emitter unspaced', () => {
    expect(beamGunStats(12, 8, 1).barrelSpacing).toBe(0);
  });

  it('weighs its optic and its plant, and no barrel steel at all', () => {
    const stats = moduleStats(box('beamTurret', 12, 8));
    const gun = stats.gun!;
    const optic = OPTIC_AREAL_DENSITY * Math.PI * 0.25 * gun.calibre * gun.calibre;
    const head = BEAM_MASS_PER_WATT * gun.beamPower;
    expect(stats.fittingMass).toBeCloseTo(optic + head, 6);
    // The plant dominates: an optic is a disc, and the thing behind it is a
    // power station.
    expect(head).toBeGreaterThan(optic);
  });

  it('comes out lighter and quicker than the gun on the same footprint', () => {
    // The point of the archetype, and the one claim here that the simulation
    // acts on today. Nothing long is held out in front of the pivot, so the
    // rod term that makes a big gun sluggish is nearly absent.
    for (const [length, width] of [[6, 4], [12, 8], [20, 14]] as const) {
      const beam = moduleStats(box('beamTurret', length, width));
      const gun = moduleStats(box('turret', length, width));
      const rate = (s: ReturnType<typeof moduleStats>) =>
        traverseRate(traverseAccel(s.mass, s.inertia));

      expect(beam.mass, `${length}x${width}`).toBeLessThan(gun.mass);
      expect(rate(beam), `${length}x${width}`).toBeGreaterThan(rate(gun));
    }
  });
});

describe('traverse limits', () => {
  it('ties the rate limit to the acceleration that reaches it', () => {
    // Not two independent numbers: whatever the drive can accelerate, it is
    // geared to run at after TRAVERSE_SPINUP_TIME of doing so.
    expect(traverseRate(0.5)).toBeCloseTo(0.5 * TRAVERSE_SPINUP_TIME, 12);
    expect(traverseRate(1)).toBeGreaterThan(traverseRate(0.5));
  });

  it('gives a heavier mount more torque but no more agility for its inertia', () => {
    const mass = 50_000;
    const inertia = 1e6;
    expect(traverseAccel(mass, inertia)).toBeGreaterThan(0);
    expect(traverseAccel(2 * mass, inertia)).toBeCloseTo(2 * traverseAccel(mass, inertia), 12);
    expect(traverseAccel(mass, 2 * inertia)).toBeCloseTo(traverseAccel(mass, inertia) / 2, 12);
  });

  it('counts a barrel as a rod from the pivot, not as part of the box', () => {
    // The box formula is blind to barrel length, and mass cancels out of
    // `traverseAccel` exactly — so under it alone a mount's agility depended
    // on nothing but its footprint, and lengthening the gun on a mount was
    // free. Two mounts of the same footprint, one with a barrel it can only
    // just fit and one with a barrel cut short by the mount being stubby:
    const long = moduleStats(box('turret', 12, 8));
    const boxOnly = ((long.mass - barrelMass(long)) * (12 * 12 + 8 * 8)) / 12;
    expect(long.inertia).toBeGreaterThan(boxOnly);

    // And a barrel sitting off the centreline adds its offset on top, so a row
    // of barrels is harder to swing than the same steel stacked at the centre.
    const row = moduleStats({ kind: 'turret', x: 0, y: 0, length: 8, width: 6, barrels: 8 });
    const spacing = row.gun!.barrelSpacing;
    const each = barrelMass(row) / 8;
    const offsets = [];
    for (let i = 0; i < 8; i++) offsets.push((i - 3.5) * spacing);
    const lateral = offsets.reduce((sum, d) => sum + each * d * d, 0);
    expect(lateral).toBeGreaterThan(0);
    const rodSpin = (barrelMass(row) * row.gun!.barrelLength ** 2) / 3;
    expect(row.inertia).toBeCloseTo(
      ((row.mass - barrelMass(row)) * (8 * 8 + 6 * 6)) / 12 + rodSpin + lateral,
      6,
    );
  });

  it('makes a small mount quicker than a capital one, by a wide margin', () => {
    // The point of the whole law. A point-defence mount has to hold a bearing
    // against its own ship's manoeuvring; a 16" turret is allowed to need a
    // steady platform.
    const rate = (length: number, width: number, barrels = 1) => {
      const s = moduleStats({ kind: 'turret', x: 0, y: 0, length, width, barrels });
      return traverseRate(traverseAccel(s.mass, s.inertia));
    };
    expect(rate(5, 4)).toBeGreaterThan(radians(45));
    expect(rate(20, 14)).toBeLessThan(radians(5));
    expect(rate(5, 4) / rate(20, 14)).toBeGreaterThan(10);
  });
});

/** The barrel steel on a mount, kg: fittings less the loading machinery. */
function barrelMass(stats: ReturnType<typeof moduleStats>): number {
  const gun = stats.gun!;
  return stats.fittingMass - MECHANISM_MASS_PER_CALIBRE * gun.calibre * gun.barrelCount;
}

/** Degrees per second as radians per second, for a legible expectation. */
function radians(degrees: number): number {
  return (degrees / 180) * Math.PI;
}
