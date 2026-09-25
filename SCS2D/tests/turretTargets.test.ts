import { describe, expect, it } from 'vitest';
import {
  blueprintFileProblem,
  compileBlueprint,
  DEFAULT_DOCTRINE,
  defaultTargeting,
  isWeaponMount,
  NO_TARGET,
  parseBlueprint,
  serialiseBlueprint,
  Ships,
  World,
  type ModuleKind,
  type ShipDesign,
} from '../sim/index.js';
import { BEAM_GUNSHIP, CORVETTE, DINKY, GUNSHIP } from '../scenarios/blueprints.js';

/**
 * A mount picking its own fight.
 *
 * A broadside with an enemy on each beam cannot fight both by pointing the
 * whole ship at one of them, and what a mount can reach is a property of the
 * mount — its own arc and its own gun. So each one chooses for itself, out of
 * the same doctrine the hull uses, and `focusWeight` is what keeps a ship's
 * guns together without tying them together.
 */

const DT = 1 / 60;
const gunship = compileBlueprint(GUNSHIP);
const beamGunship = compileBlueprint(BEAM_GUNSHIP);
const corvette = compileBlueprint(CORVETTE);
const dinky = compileBlueprint(DINKY);

interface Scene {
  world: World;
  ships: Ships;
  mine: number;
  run(steps: number): void;
  aim(turret: number): number;
}

function scene(design: ShipDesign, enemies: { design: ShipDesign; x: number; y: number }[]): Scene {
  const world = new World({ dt: DT, seed: 5 });
  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());
  const mine = ships.spawn(world, { design, x: 0, y: 0, team: 0 });
  for (const e of enemies) ships.spawn(world, { design: e.design, x: e.x, y: e.y, team: 1 });
  return {
    world,
    ships,
    mine,
    run(steps: number): void {
      for (let i = 0; i < steps; i++) {
        ships.command(DT, world);
        world.step();
      }
    },
    aim(turret: number): number {
      return ships.targetOfTurret(world.bodies, mine, turret);
    },
  };
}

/**
 * Shoot every gun and every engine off a ship, leaving a hulk: something
 * that is still there, still in the way, and no longer a threat.
 */
function strip(s: Scene, ship: number): void {
  const bodies = s.world.bodies;
  const b = bodies.indexOf(s.ships.body(ship));
  const design = s.ships.design(ship);
  for (let k = 0; k < design.modules.length; k++) {
    const kind = design.modules[k]!.spec.kind;
    if (kind === 'structure') continue;
    s.ships.damage.absorb(b, k, s.ships.damage.capacityLeft(b, k));
  }
  expect(s.ships.isDisarmed(ship)).toBe(true);
  expect(s.ships.hasNoEngines(ship)).toBe(true);
}

/** Which mount of the gunship is which: nose, port beam, starboard beam. */
const NOSE = 0;
const PORT = 1;
const STARBOARD = 2;

describe('a mount choosing its own target', () => {
  it('fights an enemy on each beam at once', () => {
    // The whole point: one hull, two fights, and no amount of manoeuvring
    // would have let a single ship-wide target cover both.
    const s = scene(gunship, [
      { design: corvette, x: 0, y: 900 },
      { design: corvette, x: 0, y: -900 },
    ]);
    const toPort = 1;
    const toStarboard = 2;
    s.run(60);

    expect(gunship.turrets[PORT]!.mount.restBearing).toBeGreaterThan(0);
    expect(gunship.turrets[STARBOARD]!.mount.restBearing).toBeLessThan(0);
    expect(s.aim(PORT)).toBe(toPort);
    expect(s.aim(STARBOARD)).toBe(toStarboard);
    expect(s.aim(PORT)).not.toBe(s.aim(STARBOARD));
  });

  it('never picks what it cannot train on, however good it would be', () => {
    // An arc is a discard rather than a penalty: a target behind the
    // superstructure is not one this gun gets an opinion about.
    const s = scene(gunship, [
      { design: corvette, x: 0, y: 2000 },
      // Much nearer, much more appealing, and squarely behind the port
      // mount's obstruction.
      { design: corvette, x: 0, y: -300 },
    ]);
    s.run(60);
    expect(s.aim(PORT)).toBe(1);
  });

  it('holds its fire when nothing at all is within its arc', () => {
    const s = scene(gunship, [{ design: corvette, x: 0, y: -900 }]);
    s.run(60);
    expect(s.aim(PORT)).toBe(NO_TARGET);
    expect(s.aim(STARBOARD)).toBe(1);
  });

  it('is drawn to what its ship is fighting when it can reach both', () => {
    // `focusWeight`: the nose gun can bear on either, and concentrating on
    // what the hull chose is worth more than the difference between them.
    const s = scene(beamGunship, [
      { design: corvette, x: 2000, y: 200 },
      { design: corvette, x: 2000, y: -200 },
    ]);
    s.run(120);
    expect(s.ships.getCurrentOrder(s.mine)).toBeUndefined(); // doctrine, not orders
    // Every mount here shares the ship's doctrine, and every one of them can
    // see both, so the focus bonus is what decides — and they all agree.
    for (let t = 0; t < beamGunship.turrets.length; t++) {
      expect(beamGunship.turrets[t]!.targeting.focusWeight).toBeGreaterThan(0);
      expect(s.aim(t)).toBe(s.aim(0));
    }
  });

  it('takes the ordered target, and is not left idle when it cannot', () => {
    // An order given is an order obeyed by every mount that can train on it.
    // One that cannot is no use to the order and every use somewhere else.
    const s = scene(gunship, [
      { design: corvette, x: 0, y: 900 },
      { design: corvette, x: 0, y: -900 },
    ]);
    s.ships.pushOrder(s.mine, 1, 800, 1000, 10);
    // Briefly, before a sluggish hull has turned far enough to change which
    // mount can see what.
    s.run(30);
    expect(s.aim(NOSE)).toBe(1);
    expect(s.aim(PORT)).toBe(1);
    // The starboard mount cannot reach the ordered target from where it sits,
    // so it fights what it can.
    expect(s.aim(STARBOARD)).toBe(2);
  });

  it('drops a target the moment it stops being one', () => {
    const s = scene(gunship, [{ design: corvette, x: 2000, y: 0 }]);
    s.run(60);
    expect(s.aim(NOSE)).toBe(1);
    s.ships.remove(1);
    s.run(1);
    expect(s.aim(NOSE)).toBe(NO_TARGET);
  });

  it('reconsiders as often as it could act on the answer', () => {
    // Derived from the mount rather than configured: half a circle of
    // traverse plus a firing cycle is what it costs to swing onto something
    // new and get a shot away, so a close-in mount thinks several times a
    // second and an artillery piece thinks about as often as it can move.
    const switchSteps = (design: ShipDesign, turret: number): number => {
      const s = scene(design, [
        { design: dinky, x: 600, y: 0 },
        { design: dinky, x: 700, y: 0 },
      ]);
      s.run(300);
      const held = s.aim(turret);
      expect(held).not.toBe(NO_TARGET);
      s.ships.remove(held);
      for (let i = 0; i < 600; i++) {
        s.run(1);
        if (s.aim(turret) !== NO_TARGET) return i;
      }
      return Infinity;
    };
    // The Dinky's single mount against the gunship's main battery: one swings
    // round in a moment and reloads in a moment, the other does neither.
    expect(switchSteps(dinky, 0)).toBeLessThan(switchSteps(gunship, NOSE));
  });
});

describe('a mount with a doctrine of its own', () => {
  it('says only what it wants differently, and its archetype covers the rest', () => {
    // The whole reason a mount's block is a partial — and what it is a
    // partial *over*: the kind of weapon it is, not the hull it is bolted to.
    const design = compileBlueprint(GUNSHIP);
    const archetype = defaultTargeting('turret');
    const close = design.turrets[PORT]!.targeting;
    expect(close.preferredMass).toBeLessThan(archetype.preferredMass);
    expect(close.proximityWeight).toBeGreaterThan(archetype.proximityWeight);
    expect(close.massWeight).toBe(archetype.massWeight);
    expect(close.closingWeight).toBe(archetype.closingWeight);
    // And where it does have an opinion, it overrides: a close-in gun takes
    // no interest in what the ship as a whole is fighting.
    expect(close.focusWeight).toBe(0);
    expect(archetype.focusWeight).toBeGreaterThan(0);
    // A mount with nothing to say is its archetype exactly — and that is not
    // its ship, which is the change: the gunship's nose gun holds the fleet
    // together through `focusWeight` rather than by inheriting the hull.
    expect(design.turrets[NOSE]!.targeting).toEqual(defaultTargeting('turret'));
    expect(design.turrets[NOSE]!.targeting.focusWeight).toBeGreaterThan(
      design.doctrine.targeting.focusWeight,
    );
  });

  it('reaches every copy of a shared mount', () => {
    // The gunship's beam guns are two placements of one assembly, so this is
    // the check that a block written once is not lost on the way through.
    const design = compileBlueprint(GUNSHIP);
    expect(design.turrets[PORT]!.targeting).toEqual(design.turrets[STARBOARD]!.targeting);
  });

  it('survives a trip through a blueprint file', () => {
    const file = serialiseBlueprint(GUNSHIP);
    expect(blueprintFileProblem(file)).toBeNull();
    expect(compileBlueprint(parseBlueprint(file)).turrets[PORT]!.targeting).toEqual(
      compileBlueprint(GUNSHIP).turrets[PORT]!.targeting,
    );
  });

  it('is refused when it says something nobody can read, and named where', () => {
    const file = serialiseBlueprint(DINKY) as Record<string, unknown>;
    const modules = file['modules'] as Record<string, unknown>[];
    // Whatever the Dinky's gun is mounted on: a mount's own targeting is a
    // property of the weapon rather than of the kind of mounting.
    const mount = modules.find((m) => isWeaponMount(m['kind'] as ModuleKind))!;
    mount['targeting'] = { aggression: 4 };
    expect(blueprintFileProblem(file)).toMatch(/targeting has unknown key aggression/);
    mount['targeting'] = { preferredMass: 0 };
    expect(blueprintFileProblem(file)).toMatch(/greater than zero/);
  });

  it('splits a pair of beam mounts between two targets either could take', () => {
    // Both mounts can train on both fighters, so what separates them is where
    // they are: everything a mount asks is measured from the gun rather than
    // from the hull, and metres of it is enough to order two targets
    // differently. Without that, a broadside piles onto whichever one the
    // hull happened to prefer.
    const s = scene(compileBlueprint(GUNSHIP), [
      { design: dinky, x: 700, y: 420 },
      { design: dinky, x: 700, y: -420 },
    ]);
    s.run(60);
    expect(s.aim(PORT)).not.toBe(s.aim(STARBOARD));
    expect(s.aim(PORT)).not.toBe(NO_TARGET);
    expect(s.aim(STARBOARD)).not.toBe(NO_TARGET);
  });

  it('passes over a hulk for something that can still do something', () => {
    // A close-in gun exists for what is still dangerous. Caring about that is
    // worth more to it than the whole of its proximity preference, so a
    // drifting wreck alongside loses to a live fighter further out — which is
    // the mission kill of §3 read from the other end.
    const s = scene(compileBlueprint(GUNSHIP), [
      { design: dinky, x: 250, y: 250 },
      { design: dinky, x: 900, y: 500 },
    ]);
    strip(s, 1);
    s.run(120);
    expect(s.aim(PORT)).toBe(2);
  });

  it('sends the close-in guns after the fighter and the main gun after the capital', () => {
    // What a doctrine per mount is *for*: one hull fighting two fights at
    // once because its guns are for different things. A shell from an
    // eight-barrelled pom-pom is wasted on a capital, and the bow gun has
    // nothing better to do with a fighter than miss it.
    const capital = compileBlueprint(GUNSHIP);
    const s = scene(capital, [
      { design: corvette, x: 1400, y: 0 },
      { design: dinky, x: 1000, y: 260 },
    ]);
    s.run(60);
    expect(s.aim(NOSE)).toBe(1);
    expect(s.aim(PORT)).toBe(2);
    expect(DEFAULT_DOCTRINE.targeting.preferredMass).toBe(1);
  });
});
