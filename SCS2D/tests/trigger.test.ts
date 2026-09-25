import { describe, expect, it } from 'vitest';
import { Bodies } from '../sim/bodies.js';
import {
  compileBlueprint,
  defaultTargeting,
  isWeaponMount,
  math,
  moduleRadius,
  NO_TARGET,
  Ships,
  Turrets,
  World,
  type Blueprint,
  type Placement,
  type ShipDesign,
  type Targeting,
} from '../sim/index.js';
import { BARE_CORE, CORVETTE, GUNSHIP } from '../scenarios/blueprints.js';

/**
 * When a weapon pulls the trigger.
 *
 * A mount used to wait until it was pointing within a twentieth of a degree of
 * the bearing it was commanded, which is a question about the mount and not
 * about the battle: the same tolerance is absurdly strict against a capital
 * two hundred metres off and looser than the target is wide against a fighter
 * at two kilometres. What it waits for now is that the shot would land on the
 * thing its doctrine asked for — which is the target's angular size, and
 * therefore a different number every step.
 *
 * Which thing that is comes from the doctrine's own refusals rather than a
 * setting beside them: a mount that refuses nothing may hit any part of the
 * ship it is shooting at, and one that has refused something is sure only of
 * the part it picked.
 */

const DT = 1 / 60;
const DEGREE = math.PI / 180;

/** A hull for a bare mount to sit on. */
function mount(): { bodies: Bodies; index: number } {
  const bodies = new Bodies();
  const id = bodies.create({ x: 0, y: 0, angle: 0, mass: 1000, inertia: 50_000, radius: 20 });
  return { bodies, index: bodies.indexOf(id) };
}

/**
 * The corvette with one instruction on every gun it has, wherever it is
 * written — a mount inside an assembly is still a mount.
 */
function armed(targeting: Partial<Targeting>): ShipDesign {
  const rewrite = (placements: readonly Placement[]): Placement[] =>
    placements.map((placement) => {
      if (!('kind' in placement)) return placement;
      if (!isWeaponMount(placement.kind)) return placement;
      return { ...placement, targeting };
    });
  const assemblies: Record<string, { modules: Placement[] }> = {};
  for (const [name, assembly] of Object.entries(CORVETTE.assemblies ?? {})) {
    assemblies[name] = { ...assembly, modules: rewrite(assembly.modules) };
  }
  const blueprint: Blueprint = {
    ...CORVETTE,
    modules: rewrite(CORVETTE.modules),
    assemblies,
  };
  return compileBlueprint(blueprint);
}

/**
 * How much slack one ship's first mount is given against a mark at a range.
 *
 * Read off the turret store after a command step rather than counted in
 * rounds, because a gun with a clear shot at a ship that is not going
 * anywhere fires at its cycle rate whatever the trigger allows — the trigger
 * only shows up in what it *lets through*, so that is what to measure.
 */
function slackAgainst(shooter: ShipDesign, range: number): number {
  const world = new World({ dt: DT, seed: 11 });
  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());
  const mine = ships.spawn(world, { design: shooter, x: 0, y: 0, team: 0 });
  ships.spawn(world, {
    design: compileBlueprint(GUNSHIP),
    x: range,
    y: 0,
    angle: math.HALF_PI,
    team: 1,
  });
  ships.command(DT, world);
  return ships.turrets.fireSlack[ships.turretIndexOf(mine, 0)]!;
}

describe('how much of a target counts as on target', () => {
  it('is the target’s own angular size rather than a constant', () => {
    // The mechanism, on the store itself: a mount fires within the slack it
    // was given, and without one is held to pointing where it was told.
    const { bodies, index } = mount();
    const turrets = new Turrets();
    const t = turrets.add({ owner: index, x: 0, y: 0, maxRate: 0, maxAccel: 0 });

    // Commanded a degree away with a mount that cannot slew, so whether it
    // may fire is entirely a question of what it is allowed to be off by.
    turrets.commandWorldBearing(bodies, t, DEGREE);
    turrets.step(DT, bodies);
    expect(turrets.readyToFire(t)).toBe(false);
    turrets.allowSlack(t, 2 * DEGREE);
    expect(turrets.readyToFire(t)).toBe(true);
    turrets.allowSlack(t, 0.5 * DEGREE);
    expect(turrets.readyToFire(t)).toBe(false);
  });

  it('gives up the slack when it gives up the target', () => {
    // Or a mount would go on firing at the sky it was left pointing at.
    const { index } = mount();
    const turrets = new Turrets();
    const t = turrets.add({ owner: index, x: 0, y: 0, maxRate: 1, maxAccel: 1 });
    turrets.allowSlack(t, 1);
    turrets.returnToRest(t);
    expect(turrets.fireSlack[t]).toBe(0);
  });
});

describe('what a doctrine will accept hitting', () => {
  it('is the whole ship for a mount that refuses nothing, and the part for one that does', () => {
    // The same ship twice, differing only in whether it has written something
    // off. A capital at 700 m is several degrees wide and the mount one aims
    // at is a fraction of that, so the two answers are far apart — and no
    // number said so: the refusal did.
    const range = 700;
    const selective = slackAgainst(armed({ structureWeight: -1 }), range);
    const indiscriminate = slackAgainst(armed({ structureWeight: 20 }), range);
    expect(selective).toBeGreaterThan(0);
    expect(indiscriminate).toBeGreaterThan(selective * 2);
    // And both are far looser than the twentieth of a degree a mount used to
    // be held to, which is the point of the change.
    expect(selective).toBeGreaterThan(0.001);
  });

  it('gives a distant target less slack than a near one', () => {
    // Angular size, so the same ship twice as far away is half as forgiving.
    const near = slackAgainst(armed({ structureWeight: 20 }), 500);
    const far = slackAgainst(armed({ structureWeight: 20 }), 1000);
    expect(far).toBeLessThan(near);
    expect(far).toBeGreaterThan(near / 3);
  });
});

describe('a beam’s default', () => {
  it('goes for guns and engines, and lights up while it is still training', () => {
    for (const kind of ['beamTurret', 'hullBeam'] as const) {
      const beam = defaultTargeting(kind);
      expect(beam.gunWeight).toBeGreaterThan(beam.coreWeight);
      expect(beam.engineWeight).toBeGreaterThan(beam.coreWeight);
      // Zero rather than below it: plating is not worth aiming at and not
      // worth staying on a stripped hull for, but a beam holding its fire
      // until a gun is under the emitter would throw away the sweep it makes
      // on the way there — and that sweep costs it nothing, since a beam
      // burns continuously rather than in shots.
      expect(beam.structureWeight).toBe(0);
    }
    // Which is to say a beam refuses nothing, and so is no more selective at
    // the trigger than a gun: both fire at anything on the hull they are
    // pointed at. Stated over every weight rather than the one, since it is
    // the absence of *any* refusal that leaves the trigger loose.
    for (const kind of ['beamTurret', 'hullBeam'] as const) {
      const beam = defaultTargeting(kind);
      for (const weight of [beam.coreWeight, beam.engineWeight, beam.gunWeight, beam.structureWeight]) {
        expect(weight).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('a part a doctrine refuses', () => {
  /**
   * A mount with one instruction, against one mark, and what it does about it.
   *
   * Returns which ship the mount settled on and whether it is pointing at its
   * own rest bearing — which is what standing down looks like from outside.
   */
  function facing(
    targeting: Partial<Targeting>,
    marks: readonly { design: ShipDesign; x: number; y: number }[],
  ): { target: number; resting: boolean } {
    const world = new World({ dt: DT, seed: 7 });
    const ships = new Ships();
    world.addForceProvider(ships.forceProvider());
    const mine = ships.spawn(world, { design: armed(targeting), x: 0, y: 0, team: 0 });
    for (const mark of marks) {
      ships.spawn(world, { design: mark.design, x: mark.x, y: mark.y, angle: math.HALF_PI, team: 1 });
    }
    // Long enough for the mount to have chosen and trained.
    for (let i = 0; i < 240; i++) {
      ships.command(DT, world);
      world.step();
    }
    const ti = ships.turretIndexOf(mine, 0);
    return {
      target: ships.targetOfTurret(world.bodies, mine, 0),
      resting: ships.turrets.fireSlack[ti] === 0,
    };
  }

  const bareCore = compileBlueprint(BARE_CORE);
  const gunship = compileBlueprint(GUNSHIP);

  it('is not a target, rather than a target shot at anyway', () => {
    // A doctrine that will shoot at nothing but engines, against a ship that
    // has none. Shooting at the hull instead would be shooting at exactly the
    // modules it just refused, so there is nothing here for it.
    const refused = facing(
      { coreWeight: -1, gunWeight: -1, structureWeight: -1, engineWeight: 100 },
      [{ design: bareCore, x: 600, y: 0 }],
    );
    expect(refused.target).toBe(NO_TARGET);
    expect(refused.resting).toBe(true);

    // The same mount against the same ship, minus the refusal: it engages.
    const willing = facing({ engineWeight: 100 }, [{ design: bareCore, x: 600, y: 0 }]);
    expect(willing.target).not.toBe(NO_TARGET);
  });

  it('tells zero from below zero: leave it alone, against mind not to hit it', () => {
    // Three meanings, and the middle one is the point. Zero is *not worth a
    // shot*: the mount will not aim at such a module and a ship with nothing
    // else left stops being a target, but it is not being careful — it goes
    // on firing at anything on a hull that does have something worth
    // shooting. Below zero is the careful one.
    const onlyCore = [{ design: bareCore, x: 600, y: 0 }];
    expect(facing({ coreWeight: 100 }, onlyCore).target).not.toBe(NO_TARGET);
    expect(facing({ coreWeight: 0, gunWeight: 100 }, onlyCore).target).toBe(NO_TARGET);
    expect(facing({ coreWeight: -1, gunWeight: 100 }, onlyCore).target).toBe(NO_TARGET);

    // And the difference between the two of them is at the trigger, against a
    // ship there *is* something to shoot at: the one that only declines to
    // aim fires at anything on the hull, the one that minds fires at its
    // part.
    const range = 700;
    const declines = slackAgainst(armed({ structureWeight: 0 }), range);
    const minds = slackAgainst(armed({ structureWeight: -1 }), range);
    expect(declines).toBeGreaterThan(minds * 2);
  });

  it('sends the mount to something it will shoot at instead', () => {
    // Two marks, the nearer one nothing but a core it has refused. Proximity
    // would take the near one on every other measure, so this is the refusal
    // deciding rather than the ranking.
    const near = facing({ coreWeight: -1, gunWeight: 100, engineWeight: 100 }, [
      { design: bareCore, x: 500, y: 0 },
      { design: gunship, x: 1100, y: 0 },
    ]);
    expect(near.target).not.toBe(NO_TARGET);
    // The second spawn is the bare core, the third the gunship.
    expect(near.target).toBe(2);
  });
});

describe('how big a module looks', () => {
  it('is its bounding circle, which is the box’s worst case', () => {
    const square = moduleRadius({ kind: 'structure', x: 0, y: 0, length: 6, width: 6 });
    expect(square).toBeCloseTo(Math.sqrt(72) / 2, 9);
    // Longer is bigger, whichever way the module is turned — which is the
    // property a gun needs, since it does not know the target's heading when
    // it asks.
    const long = moduleRadius({ kind: 'structure', x: 0, y: 0, length: 12, width: 6 });
    expect(long).toBeGreaterThan(square);
  });
});
