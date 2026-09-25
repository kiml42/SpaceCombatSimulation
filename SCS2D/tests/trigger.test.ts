import { describe, expect, it } from 'vitest';
import { Bodies } from '../sim/bodies.js';
import {
  compileBlueprint,
  defaultTargeting,
  isWeaponMount,
  math,
  moduleRadius,
  Ships,
  Turrets,
  World,
  type Blueprint,
  type Placement,
  type ShipDesign,
  type Targeting,
} from '../sim/index.js';
import { CORVETTE, GUNSHIP } from '../scenarios/blueprints.js';

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
 * `spreadRadii` says which thing that is: the part it aimed at, or the ship
 * carrying it.
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
  it('allows the part it aimed at, or the whole ship, as it was told', () => {
    // The same ship twice, differing in one number: what it will accept
    // hitting. A capital at 700 m is several degrees wide and the mount one
    // aims at is a fraction of that, so the two answers are far apart.
    const range = 700;
    const strict = slackAgainst(armed({ spreadRadii: 0 }), range);
    const loose = slackAgainst(armed({ spreadRadii: 1 }), range);
    expect(strict).toBeGreaterThan(0);
    expect(loose).toBeGreaterThan(strict * 2);
    // And both are far looser than the twentieth of a degree a mount used to
    // be held to, which is the point of the change.
    expect(strict).toBeGreaterThan(0.001);
  });

  it('gives a distant target less slack than a near one', () => {
    // Angular size, so the same ship twice as far away is half as forgiving.
    const near = slackAgainst(armed({ spreadRadii: 1 }), 500);
    const far = slackAgainst(armed({ spreadRadii: 1 }), 1000);
    expect(far).toBeLessThan(near);
    expect(far).toBeGreaterThan(near / 3);
  });
});

describe('a beam’s default', () => {
  it('goes for guns and engines, and refuses plating outright', () => {
    for (const kind of ['beamTurret', 'hullBeam'] as const) {
      const beam = defaultTargeting(kind);
      expect(beam.gunWeight).toBeGreaterThan(beam.coreWeight);
      expect(beam.engineWeight).toBeGreaterThan(beam.coreWeight);
      // Negative rather than zero: a beam with nothing better left shoots at
      // the ship instead of boiling a hole in a girder.
      expect(beam.structureWeight).toBeLessThan(0);
      // And it holds its shot until it has one of them, which it can afford
      // to do because a beam arrives where it is pointed.
      expect(beam.spreadRadii).toBe(0);
    }
    // A gun is the other way about: a round that misses the mount and hits
    // the ship beside it has still done a day's work.
    expect(defaultTargeting('turret').spreadRadii).toBeGreaterThan(0);
    expect(defaultTargeting('hullGun').spreadRadii).toBeGreaterThan(0);
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
