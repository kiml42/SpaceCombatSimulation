import { describe, expect, it } from 'vitest';
import { compileBlueprint, DEFAULT_DOCTRINE, type Blueprint, type Placement } from '../sim/index.js';
import { OrderCancelCondition } from '../sim/ships.js';
import { makeBattle } from '../scenarios/battle.js';
import { CORVETTE } from '../scenarios/blueprints.js';

/** A ram order (`Ships.pushRam`) overrides the rest of a ship's movement doctrine. */

describe('a ram order', () => {
  /** Steps until the rammer first touches a target crossing its bow, or -1. */
  function stepsToContact(ram: boolean): number {
    const corvette = compileBlueprint(CORVETTE);
    // A target that keeps its guns on rather than burning clear, so this is
    // about how the rammer flies and not about the target dodging it.
    const doctrine = CORVETTE.doctrine ?? DEFAULT_DOCTRINE;
    const sitting = compileBlueprint({
      ...CORVETTE,
      doctrine: { ...doctrine, approach: { ...doctrine.approach, burnWeight: 0 } },
    });
    const battle = makeBattle({ seed: 4 }, (ships, world) => {
      const target = ships.spawn(world, { design: sitting, x: 0, y: 0, vy: 30, team: 0 });
      const rammer = ships.spawn(world, { design: corvette, x: 300, y: 0, angle: Math.PI, team: 1 });
      ships.clearOrder(rammer);
      ships.clearOrder(target);
      if (ram) ships.pushRam(rammer, target, 40, OrderCancelCondition.None);
      else ships.pushOrder(rammer, target, 0, 0, 40, OrderCancelCondition.None);
    });
    for (let i = 0; i < 60 * 30; i++) {
      battle.step();
      if (battle.collisions.contacts.count > 0) return i;
    }
    return -1;
  }

  it('flies into a moving target rather than braking to arrive alongside it', () => {
    expect(stepsToContact(true)).toBeGreaterThan(0);
  });

  it('hits sooner than an order to close to nothing', () => {
    const band = stepsToContact(false);
    const ram = stepsToContact(true);
    expect(band < 0 || ram < band).toBe(true);
  });
});

describe('an unarmed rammer', () => {
  const WEAPONS = new Set(['turret', 'beamTurret', 'hullGun', 'hullBeam']);
  /** The corvette with every weapon taken off, ramming within `radii` of its target. */
  function unarmed(radii: number): Blueprint {
    const strip = (modules: readonly Placement[]): Placement[] => modules.filter((m) => !('kind' in m && WEAPONS.has(m.kind)));
    const assemblies = Object.fromEntries(
      Object.entries(CORVETTE.assemblies ?? {}).map(([name, a]) => [name, { ...a, modules: strip(a.modules) }]),
    );
    const doctrine = CORVETTE.doctrine ?? DEFAULT_DOCTRINE;
    return {
      ...CORVETTE,
      name: 'Ram',
      assemblies,
      modules: strip(CORVETTE.modules),
      doctrine: { ...doctrine, approach: { ...doctrine.approach, ramRadii: radii, ramArmed: 0 } },
    };
  }

  /** Whether it touches an enemy within 40 s, on its own doctrine. */
  function hits(radii: number): boolean {
    const design = compileBlueprint(unarmed(radii));
    expect(design.reach).toBe(0);
    const battle = makeBattle({ seed: 4 }, (ships, world) => {
      // A target that neither rams back nor shoots, since a corvette's shells
      // knock pieces off the rammer that touch it.
      ships.spawn(world, { design: compileBlueprint(unarmed(0)), x: 0, y: 0, team: 0 });
      ships.spawn(world, { design, x: 400, y: 0, angle: Math.PI, team: 1 });
    });
    for (let i = 0; i < 60 * 40; i++) {
      battle.step();
      if (battle.collisions.contacts.count > 0) return true;
    }
    return false;
  }

  it('picks a target and rams it with nothing to shoot', () => {
    // Far enough out to ram from where it starts: nearer, it would hold its
    // doctrine's standoff instead and never close.
    expect(hits(40)).toBe(true);
  });

  it('picks nothing without a ram doctrine', () => {
    expect(hits(0)).toBe(false);
  });
});
